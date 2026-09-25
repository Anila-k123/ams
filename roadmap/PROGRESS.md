# InstaDraft ↔ AMS Integration — Progress

Specs: `roadmap/0X-*.md`. InstaDraft repo: `C:\Users\Sybrant\Desktop\pact-pro-draft`.
Updated after each step. `[x]` done, `[ ]` to do.

## ✅ 01 — AMS: shared secret + service auth (done 2026-09-23, not committed)
- [x] `INSTADRAFT_SHARED_SECRET`, `INSTADRAFT_BASE_URL`, `INSTADRAFT_LAUNCH_TTL` in `advocate_backend/settings.py`
- [x] Env keys in `.env.example`
- [x] `core/instadraft_tokens.py`: `make_launch_token`, `decode_service_token`, `InstaDraftDisabled`
- [x] `core/auth.py::InstaDraftServiceAuthentication` (not global)
- [x] Tests: `core/test_instadraft_tokens.py` (10 pass). They're in `core/`, not `core/tests/`, because `core/tests.py` already exists
- [x] Real `INSTADRAFT_SHARED_SECRET` added to AMS `.env` (copy the same value into InstaDraft `.env` in step 04)

## ✅ 02 — AMS: launch endpoint + buttons (done 2026-09-23, not committed)
- [x] New app `integrations` (in `INSTALLED_APPS`, urls under `/api/`)
- [x] `POST /api/integrations/instadraft/launch` → `{url: <INSTADRAFT_BASE_URL>/sso?token=…}`; 404 for a case/task outside the practice, 403 for a task assigned to someone else, 503 if no secret
- [x] Tests: `integrations/tests.py` (8 pass)
- [x] CORS: InstaDraft's default origin (`localhost:5173`) is already allowed; no change needed
- [x] FE helper `src/utils/instaDraft.js::openInstaDraft` (tab opened first, closed + toast on error)
- [x] FE: "InstaDraft ↗" in the sidebar (below Tasks) + "InstaDraft" in Quick Actions
- [x] FE: ✎ "Draft in InstaDraft" on open tasks in Case detail and the Tasks page (hidden when completed/cancelled)
- [x] InstaDraft frontend pinned to port 5175 (`vite.config.ts`, strictPort); AMS `INSTADRAFT_BASE_URL=http://localhost:5175`

## ✅ 03 — AMS: integration API (done 2026-09-23, not committed)
All under `/api/integrations/instadraft/`, service-token only (`InstaDraftServiceAuthentication`), scoped by `practice_ids`.
- [x] `GET me` (+ `GET assets/<signature|logo|seal>` streams the branding image)
- [x] `GET cases?search=&page=&size=`: Spring-style pages (`content`, `totalElements`, 0-based `page`)
- [x] `GET cases/<id>/context?taskId=`: case, client, parties, task
- [x] `POST documents`: category `Draft`; same `sourceRef` + case → new version (200), else new doc (201); `taskId` links the doc to the task
- [x] `Document.external_ref` + migration `documents/0004` (**applied to the local DB**; run `migrate` on any other DB)
- [x] Storage/versioning moved to `documents/storage.py`; AMS upload + new-version views now use it
- [x] Tests: `integrations/test_api.py` (18); full suite 119 pass
- Permissions: `cases`/`context` need CASE_VIEW, `documents` needs DOCUMENT_UPLOAD (same as in AMS)

## ✅ 04 — InstaDraft: SSO login (done 2026-09-23, not committed)
- [x] Settings `AMS_SHARED_SECRET` (reads `INSTADRAFT_SHARED_SECRET`), `AMS_API_URL` (default `http://localhost:8080/api`); root `.env.example`; real secret copied into `backend/.env`
- [x] `User.ams_advocate_id` + `UsedLaunchToken(jti)`: migration `accounts/0003_ams_sso` (**applied to local DB**)
- [x] `accounts/sso.py`: verify token, single-use jti, match by AMS id → email → create (name from AMS `me`, unusable password); `make_service_token` for AMS calls
- [x] `POST /api/auth/sso/` → `{access, refresh, user, context:{caseId, taskId}}`; 401 `{error}` on failure
- [x] Tests: `accounts/tests.py` (12 pass)
- [x] FE `/sso` page (`pages/Sso.tsx`): clears old login, signs in, → `/dashboard` or `/draft/new?amsCaseId=&amsTaskId=`; "Link expired" message
- [x] **Live check:** Rajesh (AMS 68) → InstaDraft user 3 created, `/auth/me/` works, reusing the link → "Link expired."
- [x] Browser check (step 08, B1): "InstaDraft ↗" in AMS → dashboard, signed in

## ✅ 05 — InstaDraft: AMS IDs, case picker, prefill (done 2026-09-23, not committed)
- [x] New app `integrations`: `ams.py` client (fresh 5-min service token per call, 10s timeout, one `AmsError`, no token logging): `get_me`, `list_cases`, `get_case_context`, `upload_document` (for 07). SSO now reuses it
- [x] Migration `drafting/0032_ams_links` (**applied to local DB**): `Client.ams_client_id`, `Project.ams_case_id` (both unique), `DraftSession.ams_task_id / ams_document_id / ams_synced_at`
- [x] `GET /api/ams/cases/` and `POST /api/ams/link-case/` (AMS-linked users only; AMS 404 → 404, AMS down → 502); names re-synced on each link
- [x] `integrations/prefill.py`: party A = client, party B = first opponent, purpose = case description, governing state = advocate's state
- [x] FE: `/draft/new?amsCaseId=&amsTaskId=` links + banner (with Unlink); optional "Link an AMS case" picker; "from AMS" tag on prefilled fields; `ams_task_id` saved on the session
- [x] Tests: `integrations/tests.py` (17) + accounts (12) = 29 pass
- [x] **Live check:** Rajesh sees his 15 AMS cases; linking the same case twice → same Project 11; unknown case → 404
- Note: templates' `slot_schema` is empty today, so the form fields come from the frontend (`resolveFormFields`). Prefill therefore only fills fields the form actually shows (checked in the browser, not in `prefill.py`)
- Note: only the document-based new-draft flow uses the link; the "from scratch" flow (`?begin=scratch`) doesn't yet
- [x] Browser check (step 08, A1–A2): banner, task title, prefilled names + "from AMS" tags (tag bug fixed then)

## ✅ 06 — InstaDraft: .docx export (done 2026-09-23, not committed)
- [x] `drafting/export/docx.py::render_session_docx(session, branding=None)`: python-docx (already installed) + a small stdlib HTML converter, so no new dependencies. Handles headings, paragraphs, bold/italic/underline/strike, nested ordered/bulleted lists, tables, line breaks, text-align. A4, Times New Roman 12, black headings
- [x] Branding: logo + office name/address in the header, GSTIN/PAN in the footer, signature block (signature, seal, name, enrolment no.) at the end; bad/missing images skipped
- [x] `GET /api/drafts/<id>/export/docx/[?branding=1]`: own drafts only; filename `<title>_<date>.docx`; if AMS is down it still downloads, just without the letterhead. `ams.get_branding()` fetches the images
- [x] CORS now exposes `Content-Disposition` so the browser can read the filename
- [x] FE: "Download Word (.docx)" uses the endpoint (saves unsaved edits first); "Word on AMS letterhead" for AMS users; PDF still uses print
- [x] Tests: `drafting/export/tests.py` (11); InstaDraft total 40 pass
- [x] Smoke: every real ready draft renders; a branded sample of session 98 with Rajesh's real logo/signature/seal: `scratchpad/sample_branded.docx`
- [ ] Open a downloaded file in Word and check the formatting by eye

## ✅ 07 — InstaDraft: send to AMS (done 2026-09-23, not committed)
- [x] `POST /api/drafts/<id>/send-to-ams/ {caseId?}` (inline): renders the saved draft on the AMS letterhead, uploads with `sourceRef = session id`, stores `ams_document_id / ams_document_version / ams_synced_at`; 400 "Link an AMS case first."; `AmsError` → 502; `caseId` links an unlinked draft first
- [x] Link code factored into `integrations.views.mirror_case` (used by link-case and send)
- [x] Migration `drafting/0033_ams_document_version` (**applied to local DB**) so "v2" survives a reload
- [x] Tests (AMS mocked): success, resend, no linked case, link-then-send, AMS down, other user's draft (6); InstaDraft total 46 pass
- [x] FE: "Save to AMS" / "Submit to task" (AMS users only; saves edits first), "Saved to AMS · v2 · <time>" chip, case-picker dialog for unlinked drafts
- [x] **Live check (real AMS):** Rajesh, task 34 → case 80 `SLP(C) No. 23419/2026`: AMS document **55** "Paper-book (InstaDraft test)", category Draft, v1 → v2 on resend, linked to task 34. InstaDraft test session **101**
- [x] InstaDraft backend restarted; "Submit to task" / "Save to AMS" verified in the browser (step 08)
- Found & cleaned (2026-09-23, user-approved): task 42 and document 49 sat on Super Admin's case 41, outside Rajesh's practice; 39 case parties pointed at deleted cases 49/50/51; 2 task-document links were broken. All deleted; a re-scan finds 0 cross-practice or orphaned rows. Row backup: `scratchpad/cleanup_backup.json`
- Kept as demo: AMS document 55 (case 80, task 34) and InstaDraft draft 101

## ✅ 08 — End-to-end testing (done 2026-09-23, real data, Chrome)
- [x] Setup: same secret, URLs, ports (5173/8080, 5175/8000), CORS
- [x] Journey A: task flow as junior Priya → senior Rajesh sees it on the task and the case; v2+ on resubmit
- [x] Journey B: sidebar → dashboard; skip case + .docx download (nothing sent); pick case + Save to AMS
- [x] Negative checks: reused/expired link, other practice, swapped tokens, AMS down: all pass
- [x] Results table at the bottom of `08-end-to-end-testing.md`
- Fixed during the run: "from AMS" tags (NewDraft), practice-wide document reads in AMS (user-approved), draft title / rename on resend
- Demo data left on purpose: task 45 + party "Union of India" (case 80); AMS documents 56 (case 80 / task 45) and 57 (case 90); InstaDraft drafts 103, 104
- Follow-ups: AMS global search is own-only; court-doc titles

## ✅ Follow-up — senior review of delegated drafts (done 2026-09-23, not committed)
Why: AMS is a senior → junior/intern chamber, and chamber tools separate drafting from approving.
- [x] **Interns can file their own work:** the assignee may file a draft on their task without `DOCUMENT_UPLOAD`; anything else still needs it (`integrations/views.py`)
- [x] **Review states** on `case_task` (migration `workspace/0008`, applied): `SUBMITTED` → `APPROVED` (task completes, its documents get status APPROVED) or `CHANGES_REQUESTED` (with a note) → resubmit. Logic in `workspace/review.py`; only for tasks assigned by one person to another
- [x] Submitting = filing from InstaDraft, attaching a document in AMS, or the assignee ticking the task (no longer completes it directly)
- [x] `POST /api/workspace/tasks/<id>/review {action, note}`: the assigner, or a practice member with `TASK_ASSIGN`; never the assignee
- [x] **Notifications:** the DB CHECK constraint never allowed `TASK_ASSIGNED`, so task-assignment notifications were silently dropped. Migration `workspace/0009` (applied, reversible) allows it plus `TASK_SUBMITTED / TASK_APPROVED / TASK_CHANGES_REQUESTED`
- [x] AMS FE: `components/TaskReview.jsx`: status chips, reviewer's note, Approve / Request changes (with a comment dialog) on the Tasks page and the case page; "To review" filter; notification labels
- [x] InstaDraft: `GET /api/drafts/<id>/ams-task/`; the draft page shows "X asked for changes: …" / "Approved by X"; the chip says "Submitted for review · vN"
- [x] Tests: AMS 133 (8 new in `workspace/test_review.py`), InstaDraft 54, all pass
- [x] **Live (real data, running servers):** Priya submits draft 103 on task 45 → SUBMITTED; she can't approve her own work (403); Rajesh requests changes → InstaDraft shows his note; resubmit (v6) → SUBMITTED; Rajesh approves → task completed, doc 56 APPROVED; 4 notifications stored
- [ ] Browser look at the new chips/buttons (AMS Tasks + case page, InstaDraft banner)
- [ ] Rajesh's practice has no intern account; add one if you want to demo the intern path

## ✅ Follow-up — AMS users see their AMS documents in InstaDraft (done 2026-09-23, not committed)
Decisions: show what the user can see in AMS (the practice's documents, `DOCUMENT_VIEW`); uploads made in InstaDraft go into AMS too; users who don't sign in from AMS keep the shared library, and AMS users never see it.
- [x] AMS API: `GET documents` (list, PDF/DOCX, search), `GET documents/<id>`, `GET documents/<id>/file`, `POST references` (upload, `DOCUMENT_UPLOAD`, optional case). Tests: `integrations/test_documents.py` (7); AMS total 140 pass
- [x] InstaDraft: `Sample.ams_document_id / ams_version` (migration `drafting/0034`, **applied**; one copy per user); `integrations/documents.py`: `visible_samples`, `import_document` (import once, refresh on a newer AMS version), `upload_to_ams`
- [x] The Documents API, draft creation and the picker all use `visible_samples`: AMS users only see their imports; the shared library never includes AMS documents; a draft can't use a document the user can't see
- [x] AMS imports: random file names (InstaDraft `/media` has no login check) and no contract type (so nothing is copied into the shared clause library)
- [x] `GET /api/ams/documents/` (each row says whether it's prepared, and if it's current) and `POST /api/ams/documents/<id>/import/`
- [x] FE: Documents page lists AMS documents ("Prepare for drafting" / "Update to vN", then Summarize / Translate / View / Download; no delete; no contract type on upload); "Add Documents" → "My AMS Documents" with server-side search; picking prepares them
- [x] Tests: `integrations/test_documents.py` (11); InstaDraft total 65 pass
- [x] **Live:** Rajesh sees his practice's 4 AMS PDF/DOCX (incl. Priya's NDA v6); prepared `Vakalathnama.pdf` → processed (ready, 2 clauses), stored as `samples/ams/<random>.pdf`; the non-AMS admin still sees only the 3 shared documents
- [ ] Browser look at the Documents page and the picker
- Note: drafts made earlier from shared documents still open, but new drafts by AMS users can only use their AMS documents

## ✅ Client role in AMS (replaces the separate client portal; done 2026-09-24, not committed)
Decision: clients sign in to AMS itself (same `/login`) with a **Client** role; the separate `/portal` was removed.
- [x] New app `clientaccess`: `ClientUser` (advocate ↔ client) + `ClientInvite` (one-time set-password link, hashed, 72 h). Migrations `0001` (tables) and `0002` (drops the old portal tables), both **applied**
- [x] **Deny-by-default gate** (`clientaccess/gate.py`), called from every auth path (`core/auth.py` default + InstaDraft service auth, `documents/views.py` download token check). A client user can reach only `/api/client/*`, my-permissions/roles, own profile, logout, change password, preferences; everything else → 403 (downloads → 401); InstaDraft always refused
- [x] `/api/client/*`: me, overview, cases, case detail (hearings, parties, fees, invoices, shared docs), invoices + GST PDF, payments, shared documents + file, messages. Every query limited to the client's `client_id`
- [x] Firm side: client row **"Logins"** → create login (emails a set-password link; the link is shown to copy too), resend, switch off/on (`left_on`). `CLIENT_EDIT`, practice-scoped. "Share with client" on documents (`DOCUMENT_EDIT`) kept
- [x] Kept out of firm lists: User Management list/detail/roles, Role Management (Client role hidden, can't be edited/assigned), practice-head choice, notification scheduler. Clients are outside every practice (`parent_advocate_id` NULL, no permissions)
- [x] Login now refuses switched-off / departed accounts up front (before, a token was issued and rejected on the next call)
- [x] Audit: client downloads recorded against the firm (actor = client email); the middleware skips client users
- [x] FE: `/dashboard` renders the client view (`src/client/`) for role CLIENT; `/set-password` page; `/cases` redirects clients; `src/portal/` removed
- [x] Tests: `clientaccess/tests.py` (14) incl. a **sweep of every URL in AMS** as a client (all non-allowlisted → refused); AMS total 154 pass
- [x] **Live:** Anita (moved from the portal: same email/password) signs in at `http://localhost:5173/login` → client view: 2 cases, ₹45,000 due, 1 shared doc; firm APIs → 403; typing `/dashboard/tasks` → back to her home
- Demo login: **anita.rao@coromandel-portal.demo / Coromandel@2026** at the normal AMS login. Chrome may autofill the saved AMS login there; pick or type the right account
- Fixed while testing: the client view didn't appear right after login (role was read once at app start)
- Open: User Management still lists advocates of **every firm** (pre-existing; needs a "firm" concept to fix without hiding firm-wide staff like the Accountant). Court orders not in the client view yet
- [ ] Browser look at the firm-side "Logins" dialog

## Housekeeping
- [ ] Commit AMS work (nothing committed yet)
- [ ] Commit InstaDraft work
