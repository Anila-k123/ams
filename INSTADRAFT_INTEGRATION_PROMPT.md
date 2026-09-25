# InstaDraft ↔ Advocate Management System (AMS) — Integration Discovery Brief

You are working inside the **InstaDraft** codebase (an AI legal-document drafting product).
We are integrating InstaDraft into a separate **Advocate Management System (AMS)** so lawyers
can move seamlessly between managing cases and drafting documents. This document tells you
everything about the AMS side and asks you to report the InstaDraft side so we can design the
integration. **Do not write integration code yet — first produce the report requested at the end.**

## Target integration scenarios
1. **Assigned-task flow:** A senior advocate assigns a drafting task to a junior advocate in AMS.
   The junior clicks the task and lands in InstaDraft with the case + task context already
   loaded, then fills in the remaining draft-specific details.
2. **Direct flow:** A user opens InstaDraft directly using their AMS credentials (single sign-on),
   optionally selecting an existing AMS case to draft against.

## AMS technical facts you can rely on

### Authentication
- JWT, algorithm **HS256**, signed with the Django `SECRET_KEY` (a shared secret we can provide).
- Login: `POST /api/advocates/login` with `{ "email", "password" }` →
  `{ "token", "role", "theme", "fullName" }`.
- Token payload claims: `sub` (email), `advocateId` (int), `email`, `iat`, `exp` (default 24h TTL).
- Every authenticated request sends header `Authorization: Bearer <token>`.
- AMS can validate any token InstaDraft forwards, and InstaDraft can validate an AMS token by
  verifying the HS256 signature with the shared secret and reading `advocateId`/`email`.

### Data model & identity (the columns that matter for integration)
- Backend: Django over a **shared PostgreSQL** database; most tables are Spring-owned.
- All primary keys are **BigAutoField (int8)**.
- Three columns recur across almost every AMS table and are the natural cross-system keys:
  - `advocate_id` — the acting lawyer / owner
  - `case_id` — the matter being worked on
  - `client_id` — the client
- Firm/practice grouping: `advocate.parent_advocate_id` (NULL = practice owner).

Key AMS tables and their relevant columns:
- **advocate**: id, full_name, email, bar_council_id, phone, office_name, office_address,
  signature_path, office_logo_path, office_seal_path, gst_number, pan_number, address, city,
  state, country, pin_code, parent_advocate_id, role.
- **cases**: id, case_number, case_title, case_type, court_level, status, description,
  advocate_id, client_id. (`case_number` is unique per advocate, NOT globally.)
- **clients**: id, name, email, phone, address, advocate_id.
- **case_party**: id, case_id, advocate_id, name, role (petitioner/respondent/…), counsel,
  contact, is_opponent. (Use these for case captions/cause titles.)
- **case_task**: id, title, priority, deadline, completed, case_id, advocate_id,
  assigned_by_id (senior), assigned_to_id (junior). Drives the assigned-task scenario.
- **case_task_document**: id, task_id, document_id — links a task to the document it produced.
- **documents**: id, document_name, original_name, stored_name, file_path, file_size, file_type,
  category, description, version, status, advocate_id, case_id, client_id.
- **document_version**: document_id, version, stored_name, file_path, uploaded_by_id, note.

### Relevant AMS REST endpoints (all prefixed `/api/`, Bearer auth)
- Cases: `GET /cases`, `GET /cases/my-cases`, `GET /workspace/cases/<case_id>/summary`,
  `GET /workspace/cases/<case_id>/parties`.
- Tasks: `GET /workspace/cases/<case_id>/tasks`, `POST /workspace/tasks/create`,
  `POST /workspace/tasks/<id>/assign`, `GET /workspace/assignable-advocates`.
- Documents: `POST /documents/upload` (multipart), `GET /documents/by-case/<case_id>`,
  `GET /documents/download/<id>`.
- Profile: `GET /api/advocates/profile`, `GET /api/advocates/my-permissions`.

## What we have NOT decided (report your side so we can choose)
- Whether InstaDraft should share the AMS PostgreSQL DB or talk to AMS purely over REST.
- Where a finished draft ultimately lives (saved back into AMS `documents`, kept in InstaDraft,
  or both).

## Report we need from you (the InstaDraft side)
Please answer each of the following about the InstaDraft codebase as it exists today:

1. **Auth today:** How does InstaDraft authenticate users right now (its own login? JWT? sessions?
   OAuth?)? What is its user/account model and its columns? Can it trust an externally-issued
   HS256 JWT if given the shared secret, and map `advocateId`/`email` to (or auto-provision) an
   InstaDraft user?
2. **Data model:** List InstaDraft's core tables/models and columns — especially its user,
   matter/case, client, template, and draft/document entities. Note the DB engine and whether it
   could share AMS's PostgreSQL or must stay separate.
3. **Draft generation surface:** What inputs does InstaDraft need to generate a draft (document
   type/template, party names, court, facts, prayer, dates, custom fields…)? Enumerate the fields
   it collects per draft type. Which of these can be **prefilled** from the AMS columns listed
   above (map each AMS field → InstaDraft field), and which must the user still enter?
4. **Entry / deep-link:** Can InstaDraft be opened at a specific screen via URL with parameters
   (e.g. a token + caseId + taskId) to launch the assigned-task flow? What params/route would it
   expose? How does it currently receive external context, if at all?
5. **Draft storage & output:** How does InstaDraft store completed drafts today (DB rows, files,
   formats — DOCX/PDF)? Can it push a finished draft back to an external system via API
   (multipart upload) and/or write a row into an external `documents` table? What metadata would
   it return (file, name, type, version)?
6. **Templates & document types:** What document/draft types does InstaDraft support, and is the
   template set per-user, per-firm, or global? How would firm branding (letterhead, signature,
   seal, GST/PAN from the AMS `advocate` row) be applied?
7. **Tech stack & deployment:** Language/framework, how it's hosted, its API base URL, and its
   CORS/allowed-origins setup (so AMS's frontend at localhost:5173 / production origin can reach
   it).
8. **Proposed integration plan:** Given the above, recommend the connection style (shared DB vs
   REST + SSO) and the draft round-trip (how a draft flows from AMS task → InstaDraft → back to
   AMS `documents` linked via `case_id` and `case_task_document`). Call out gaps, risks, and
   schema changes either side would need.

Deliver this as a structured written report (Markdown), with the field-mapping in item 3 as a
table. Do not modify code until we review your report.
