# 07 — InstaDraft: Send the finished draft to AMS

**Codebase:** InstaDraft
**Depends on:** AMS 03, InstaDraft 05 and 06

## Goal
A "Save to AMS" action puts the .docx into the AMS case's documents. If the draft came
from a task, it also attaches the document to that task.

## Backend
1. `POST /api/drafts/<id>/send-to-ams/`:
   - The session's Project must have an `ams_case_id` (otherwise 400, "Link an AMS case first").
   - Render with `render_session_docx(session, branding=me)`.
   - Call `ams.upload_document(user, file, documentName, caseId, clientId, taskId=session.ams_task_id,
     sourceRef=str(session.id))`.
   - Save `ams_document_id` and `ams_synced_at`, and return `{ documentId, version, taskLinked }`.
   - Sending again updates the same AMS document as a new version (AMS handles this through
     `sourceRef`).
   - Turn any `AmsError` into a clean 502 message.
2. Run it inline, since it's a single request. Move it to Celery later only if it's slow.
3. Tests, with the AMS client mocked: success; no linked case; AMS down.

## Frontend
1. On the draft page, add a "Save to AMS" button. Show it only when the session is linked to an AMS
   case. After a successful save, show "Saved to AMS · v2 · <time>", using `ams_synced_at`.
2. When `ams_task_id` is set, the button reads "Submit to task".
3. For unlinked sessions, the button opens the case picker from file 05 first, then sends.

## Done when
- After "Submit to task", the document shows up in AMS on both the case and the task.
- Sending again creates version 2 in AMS, not a duplicate.
