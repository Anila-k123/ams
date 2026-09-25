# Phase 7 — Draft → Document integration

## Goal

Wire a "finalize draft" flow that writes a real, filed AMS `Document` + `DocumentVersion` from a `DraftSession`, linked to the `Case`/`CaseTask` it was drafted against — in-process, reusing AMS's own existing document-versioning helpers instead of the REST+service-token mechanism the already-built `integrations` app used. Then delete that `integrations` app entirely, along with `core/instadraft_tokens.py` and `InstaDraftServiceAuthentication`.

## Background

This is the best-grounded phase in the whole plan, because the already-built (uncommitted) `integrations` app did this exact thing over REST, against this exact repo, and it works (`roadmap/PROGRESS.md` step 07 has a real live-tested example: advocate "Rajesh", task 34 → case 80, AMS document 55, v1 → v2 on resend). Folding it in-process means **reusing its logic, not its transport**:

- `documents/storage.py` already has `create_document`/`add_version` helpers — this is exactly the "render bytes then file it" step, already built. Use these directly instead of writing new insert logic.
- `core.models.Document.external_ref` (added by `documents/migrations/0004` specifically for this integration) already holds "the InstaDraft session id" and already drives "same ref + case → new version, else new document" — this behavior carries over unchanged, just triggered by a direct function call instead of a `POST /api/integrations/instadraft/documents`.
- `workspace/models.py`'s `CaseTaskDocument` + `workspace/review.py`'s `review.submit(task, user)` already implement "filing a draft on a delegated task auto-submits it for senior review" — reuse this unchanged; it's a real, tested feature (`roadmap/PROGRESS.md`'s "Follow-up — senior review of delegated drafts"), not new scope.
- InstaDraft's real DOCX renderer (`drafting/export/docx.py::render_session_docx(session, branding=None)`) already supports firm branding (logo, office name/address, GST/PAN, signature+seal block) — this already-built integration's `InstaDraftMeView`/`InstaDraftAssetView` fetched those fields (`full_name`, `office_logo_path`, `signature_path`, `office_seal_path`, `gst_number`, `pan_number`) over the service API. In-process, just read them directly off the `Advocate` row — **branding does not need to be dropped for this phase**, unlike the discarded plan's assumption (that assumption was based on the wrong AMS repo, which genuinely had no such fields).

## What happens

1. **Schema**: add `DraftSession.document_id = models.BigIntegerField(null=True, blank=True)` (plain integer, per the Phase 02 convention — not a real FK into `core.models.Document`).

2. **New action** `POST /api/draft-sessions/<id>/finalize/` on `DraftSessionViewSet`:
   - Require `session.project.case_id` is set (reuse the case-picker UX from Phase 05).
   - Render bytes via `render_session_docx(session, branding=advocate_branding(request.user))`, where `advocate_branding()` is a small new helper reading `full_name`/`office_name`/`office_address`/`office_logo_path`/`signature_path`/`office_seal_path`/`gst_number`/`pan_number` directly off `request.user` (the `Advocate` row) — replacing what `InstaDraftMeView`/`InstaDraftAssetView` used to fetch over HTTP.
   - Call `documents/storage.py`'s `create_document`/`add_version` directly (in-process function call, same DB transaction) with `external_ref=str(session.id)`, `case_id=session.project.case_id`, `category='Draft'` — reusing the existing "same ref + case → new version" logic unchanged.
   - If the session's project/case has a linked `CaseTask` (via however Phase 05's case-linkage UI captures a `taskId`, mirroring the already-built integration's `taskId` param): create/update `CaseTaskDocument` and call `workspace/review.py`'s `review.submit(task, user)` — same "filing = submitting for review" behavior already live-tested.
   - Set `session.document_id`, save; return the `Document` id.

3. **Delete the `integrations` app entirely**: `views.py`, `urls.py`, its `migrations/`, tests. Delete `core/instadraft_tokens.py` and `core/test_instadraft_tokens.py`. Remove `InstaDraftServiceAuthentication` from `core/auth.py` (lines 58-99). Remove the `INSTADRAFT_SHARED_SECRET`/`INSTADRAFT_BASE_URL`/`INSTADRAFT_LAUNCH_TTL` settings and the `integrations.urls` include from root `urls.py`. **What is preserved, not deleted**: the scoping/permission patterns (`RequirePermission('DOCUMENT_UPLOAD')`, "the task's own assignee may always file on their own task" exception), `external_ref` versioning, and `review.submit()` on task-linked upload — all now called as plain Python inside the new `finalize` action instead of served as an HTTP endpoint.

4. **Frontend**: remove the InstaDraft launch buttons per Phase 04 step 5 (if not already done there); add a "Finalize to AMS" action on `DraftPage.tsx` calling the new endpoint, replacing whatever "Save to AMS"/"Submit to task" UI the already-built integration had on the InstaDraft side.

## Files touched

- `Advocate-app-BE-Django/drafting/models.py` (`DraftSession.document_id`)
- `Advocate-app-BE-Django/drafting/views.py` (`finalize` action, `advocate_branding()` helper)
- `Advocate-app-BE-Django/drafting/migrations/000N_draft_session_document_id.py`
- `Advocate-app-BE-Django/documents/storage.py` (reused, not modified, unless its signature needs a small extension)
- `Advocate-app-BE-Django/integrations/` — **deleted**
- `Advocate-app-BE-Django/core/instadraft_tokens.py`, `core/test_instadraft_tokens.py` — **deleted**
- `Advocate-app-BE-Django/core/auth.py` — `InstaDraftServiceAuthentication` removed
- `Advocate-app-BE-Django/advocate_backend/settings.py` — `INSTADRAFT_*` settings removed
- `Advocate-app-BE-Django/advocate_backend/urls.py` — `integrations` include removed
- `Advocate-app-FE-main/src/pages/Drafting/DraftPage.tsx` (finalize action)

## Risk/effort

Medium, lower than the discarded plan's estimate — the hardest parts (versioning semantics, task-review submission, branding field mapping) are already solved and tested in the `integrations` app; this phase is substantially "call it in-process" rather than "design it."

## Done when

- Creating a draft end-to-end, then finalizing it, produces a real `Document` + `DocumentVersion` visible in AMS's existing document list/case document view, with the firm's branding applied on the rendered DOCX.
- Re-finalizing the same session correctly adds a new `DocumentVersion` (v2, v3, ...) under the same `Document` via `external_ref` matching, exactly like the already-tested `integrations`-app behavior.
- Filing a draft against a delegated task correctly creates a `CaseTaskDocument` link and moves the task to `SUBMITTED` via `review.submit()`.
- No references to `integrations/`, `core/instadraft_tokens.py`, `INSTADRAFT_*` settings, or `InstaDraftServiceAuthentication` remain anywhere in the codebase.

## Next phase

`08-cleanup-and-hardening.md`

## As built (2026-09-24)

- **Endpoints:** the plan called for a new `finalize` action. The editor's existing contract was kept instead, served in-process by `drafting/filing.py`:
  - `POST /api/drafting/drafts/<id>/send-to-ams/` (`{caseId?}` links a case first);
  - `GET /api/drafting/drafts/<id>/ams-task/`.
- **Session fields:** no new `document_id` column. The session's existing `ams_document_id`, `ams_document_version` and `ams_synced_at` record the filing.
- **Rules carried over from the old `integrations` upload endpoint:**
  - practice scope;
  - DOCUMENT_UPLOAD, or the task's own assignee;
  - `external_ref` = session id, so re-filing adds a version;
  - `CaseTaskDocument` plus `review.submit()`.
- **Transactions:** the AMS document (default DB) commits before the session (drafting DB) is marked synced. Two databases can't share one transaction.
- **Deleted:**
  - `integrations/` and its tests;
  - `core/instadraft_tokens.py` and `core/test_instadraft_tokens.py`;
  - `InstaDraftServiceAuthentication`;
  - the `INSTADRAFT_*` settings and env keys;
  - the `integrations.urls` include.
- **Tests:** `workspace/test_review.py` now files through the new endpoint.
