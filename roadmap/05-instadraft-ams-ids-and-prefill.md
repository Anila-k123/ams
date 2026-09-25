# 05 — InstaDraft: AMS IDs, case picker, prefill

**Codebase:** InstaDraft
**Depends on:** AMS 03, InstaDraft 04

## Goal
InstaDraft knows which AMS case, client and task a draft belongs to, and prefills what it can.

## Backend
1. **AMS client**, `integrations/ams.py`:
   - `service_token(user)`: HS256 with `AMS_SHARED_SECRET`, `aud='ams-api'`, TTL 5 min,
     `advocateId=user.ams_advocate_id`, `email`, `jti`. Minted fresh for every call.
   - Functions: `get_me(user)`, `list_cases(user, search, page)`,
     `get_case_context(user, case_id, task_id=None)`, and `upload_document(...)` (used in 07).
   - Use 10s timeouts, raise a single `AmsError` type, and never log tokens.
2. **Migrations:**
   - `Client.ams_client_id` (BigInteger, null, unique)
   - `Project.ams_case_id` (BigInteger, null, unique)
   - `DraftSession.ams_task_id` (BigInteger, null), `DraftSession.ams_document_id` (null),
     `DraftSession.ams_synced_at` (null)
3. **Endpoints** (InstaDraft auth; the user must have `ams_advocate_id`):
   - `GET /api/ams/cases/?search=`: passes through to `list_cases`.
   - `POST /api/ams/link-case/` with `{ caseId, taskId? }`: calls `get_case_context`,
     gets or creates the `Client` by `ams_client_id` and the `Project` by `ams_case_id` (updating their names),
     and returns `{ projectId, clientId, prefill, task }`.
4. **Prefill mapping**, in `integrations/prefill.py`. It is keyed by slot `key` and only fills slots
   that exist in the chosen template's `slot_schema`:
   | Slot | Source |
   |------|--------|
   | `party_a_name` | the client's name (our side) |
   | `party_b_name` | the first party with `isOpponent=true` |
   | `purpose` | `case.description` (the lawyer edits it) |
   | `governing_state` | `me.state`, if it matches an option in the slot's option set |
   Everything else stays blank. Prefilled fields are marked so the UI can show "from AMS".

## Frontend
1. `/draft/new?amsCaseId=&amsTaskId=`: call `link-case`, preselect the Client and Project, apply
   the prefill to the facts form, and show a banner: "Linked to AMS case <caseNumber> — <caseTitle>"
   (plus the task title).
2. New-draft screen (direct flow): add an optional "Link an AMS case" picker that searches with
   `GET /api/ams/cases/`. The lawyer can skip it.
3. Save `ams_task_id` on the created `DraftSession`.

## Done when
- The task button opens the new-draft screen with the case linked and the party names prefilled.
- In the direct flow, the lawyer can pick an AMS case or skip.
- Opening the same AMS case twice reuses the same Project (no duplicates).
