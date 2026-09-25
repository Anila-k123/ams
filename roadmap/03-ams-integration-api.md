# 03 — AMS: Integration API for InstaDraft

**Codebase:** AMS backend, `Advocate-app-BE-Django/`
**Depends on:** 01, and the `integrations` app from 02

## Goal
A small, stable API that InstaDraft's **backend** calls with a service token
(`InstaDraftServiceAuthentication`). It hides AMS internals, so InstaDraft depends on only
this one contract.

For all views: set `authentication_classes = [InstaDraftServiceAuthentication]`, scope every query
with `practice_ids(request.user)`, and return camelCase JSON like the rest of AMS.
Prefix: `/api/integrations/instadraft/`.

## Endpoints
1. `GET me`: the advocate profile, used for branding and prefill.
   Fields: `id, fullName, email, barCouncilId, phone, officeName, officeAddress, address, city, state,
   pinCode, gstNumber, panNumber, signatureUrl, officeLogoUrl, officeSealUrl`.
   For the image URLs, add `GET assets/<kind>` (kind = signature | logo | seal). It streams the file
   from the stored path and is protected by the service token.
2. `GET cases?search=&page=`: the cases the advocate can see (same rules as `/cases/my-cases`).
   Fields: `id, caseNumber, caseTitle, caseType, courtLevel, status, clientId, clientName`. Paginated.
3. `GET cases/<case_id>/context`: everything needed for prefill, in one call:
   ```json
   { "case": {id, caseNumber, caseTitle, caseType, courtLevel, status, description},
     "client": {id, name, email, phone, address},
     "parties": [{id, name, role, counsel, contact, isOpponent}],
     "task": {id, title, priority, deadline, assignedById, assignedToId} | null }
   ```
   Takes an optional `?taskId=`. The task must belong to that case.
4. `POST documents` (multipart): saves a finished draft.
   - Fields: `file` (.docx), `documentName`, `caseId`, `clientId?`, `taskId?`,
     `description?`, `sourceRef` (the InstaDraft session id, as a string).
   - Reuse the existing upload logic in `documents/views.py::UploadDocumentView`. Factor its
     core into a function; don't duplicate the storage/versioning code. Use category `"Draft"`.
   - If a document with the same `sourceRef` already exists for that case, add a new
     `document_version` instead of creating a new document. Re-sending a draft updates it.
   - If `taskId` is given, create a `CaseTaskDocument` with `get_or_create` (same as
     `workspace/views.py::TaskDocumentsView`).
   - Returns `{ documentId, version, taskLinked: bool }`.
   - To store `sourceRef`, add a nullable `external_ref` field (CharField, indexed) to `Document`, with a
     migration.
5. Tests for each endpoint, including: access from another practice → 404; missing or expired token → 401.

## Done when
- All endpoints work with a service token and reject a normal AMS login token.
- Uploading twice with the same `sourceRef` gives version 2, not a second document.
- A task-linked upload shows up on the task in the AMS UI.
