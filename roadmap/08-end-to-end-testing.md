# 08 — End-to-end testing (both apps)

**Codebase:** both, running locally together
**Depends on:** 01–07

## Setup
- The same `INSTADRAFT_SHARED_SECRET` in both `.env` files.
- AMS: set `INSTADRAFT_BASE_URL` to the InstaDraft frontend URL. InstaDraft: set `AMS_API_URL` to the AMS API URL.
- The ports must not clash. The AMS frontend uses 5174 when 5173 is taken, so check both `.env` files and the CORS settings.
- AMS test data: a senior advocate, a junior in the same practice, a case with a client and
  an opposing party, and a task the senior has assigned to the junior.

## Journey A — task flow
1. Log in to AMS as the junior, open the task, and click "Draft in InstaDraft".
2. In the new tab: logged in as the junior, the case banner is shown, and the party names are prefilled.
3. Fill in the remaining fields, generate the draft, and edit it.
4. Click "Submit to task" and see a success message.
5. In AMS: the document is on the case (category Draft) and attached to the task. The senior can see it.
6. Edit in InstaDraft and submit again. AMS shows version 2.

## Journey B — direct flow
1. In AMS, click "InstaDraft" in the sidebar. The InstaDraft dashboard opens, logged in.
2. Start a new draft, skip the case, and generate. Downloading the .docx works, and nothing is sent to AMS.
3. Start a new draft, pick an AMS case, and click "Save to AMS". The document appears on that case.

## Negative checks
- Reuse an old `/sso?token=` link → "Link expired".
- Open a launch link more than 2 minutes after it was created → rejected.
- An advocate from another practice can't link or upload to this case (404).
- An AMS login token sent directly to the integration API is rejected, and so is an InstaDraft token sent to AMS.
- Stop AMS, then click "Save to AMS" → a clean error, and the draft isn't lost.

## Done when
All steps pass. Write the results (pass/fail + notes) at the bottom of this file.

## Results — 2026-09-23 (real data, Chrome, both apps running locally)

**Setup:** same `INSTADRAFT_SHARED_SECRET` in both `.env` files. Ports: AMS FE 5173 / BE 8080,
InstaDraft FE 5175 (pinned, strictPort) / BE 8000. InstaDraft CORS allows 5175, AMS
`INSTADRAFT_BASE_URL=http://localhost:5175`, InstaDraft `AMS_API_URL=http://localhost:8080/api`.
**Test data:**
- Senior Rajesh Kumar (AMS 68); junior Priya Nair (AMS 69, same practice).
- Case 80 `SLP(C) No. 23419/2026`, *Coromandel Exports Pvt. Ltd. vs Union of India*. The opposing
  party "Union of India" was added through the AMS parties API.
- Task 45 "Draft counter affidavit", assigned by Rajesh to Priya through the AMS tasks API.
- Browser sign-in to AMS used a server-issued login token put in localStorage (no passwords were
  available). Everything after that went through the real UI.

| # | Check | Result | Notes |
|---|-------|--------|-------|
| A1 | Junior opens the task → "Draft in InstaDraft" | PASS | New tab went `/sso` → `/draft/new?amsCaseId=80&amsTaskId=45`, no password |
| A2 | Signed in as the junior; case banner; parties prefilled | PASS | "PR" avatar; banner shows the case and task; Party A = Coromandel Exports, Party B = Union of India, Governing State = Tamil Nadu, each tagged "from AMS". **Fixed during the test:** the tags were missing (React state bug in `NewDraft.tsx`) |
| A3 | Fill in, generate, edit | PASS | Draft 103 generated (12 blocks, ~30 s); edited placeholders |
| A4 | "Submit to task" → success | PASS | "Saved to AMS · v1 · 16:42"; unsaved edits were saved first |
| A5 | AMS: on the case (Draft) and on the task; senior can see it | PASS (after fix) | On the task straight away. **Not** on the case's Documents tab for the senior at first: AMS document reads were own-uploads-only. Fixed (user-approved): reads are now practice-wide with `DOCUMENT_VIEW`. Senior sees it and downloads it (43 KB .docx) |
| A6 | Edit + resubmit → version 2 | PASS | v2, later v3/v4, all one document (AMS 56). **Fixed:** the name was "Draft 103"; now the draft's own title "Mutual Non-Disclosure Agreement", and a resend renames the AMS document |
| B1 | AMS sidebar "InstaDraft ↗" → dashboard, signed in | PASS | Landed on `/dashboard` as Rajesh ("RA"); this replaced the previous InstaDraft login in that browser |
| B2 | New draft, skip case, generate, .docx download, nothing sent | PASS | Draft 104; export endpoint → 200, real .docx (38 KB); 0 AMS documents for it |
| B3 | Pick an AMS case → "Save to AMS" → on that case | PASS | Case-picker dialog → `E.P.No.78/2024` → "Saved to AMS · v1"; AMS document 57 on case 90 with its client. Note: the court document's title came from its header line ("In The Court Of The City Civil Court, Chennai") |
| N1 | Reuse an old `/sso?token=` | PASS | 401 "Link expired."; UI shows "Link expired — go back to AMS and click the button again." and removes the token from the URL |
| N2 | Launch link older than 2 min | PASS | Token with `exp` 1 min in the past → 401 "Link expired." |
| N3 | Other-practice advocate can't link/upload to the case | PASS | Super Admin (AMS 1): context 404, launch 404, upload 404 |
| N4 | Swapped tokens | PASS | AMS login token → integration API 401 and → InstaDraft 401; InstaDraft token → AMS API 401 (normal and integration) |
| N5 | AMS down → clean error, draft kept | PASS | `AMS_API_URL` pointed at a closed port in-process (the user's AMS server was not stopped) → 502 "Could not save to AMS: AMS is not reachable right now."; draft content and AMS link fields unchanged |

**Code changed because of this run:** AMS `documents/views.py` (practice-wide reads; download needs
`DOCUMENT_VIEW` for other people's files; tokens of departed advocates rejected) with
`documents/tests.py`; AMS `integrations/views.py` (rename on resend); InstaDraft
`drafting/export/docx.py` (title from the generated text) and `frontend/src/pages/NewDraft.tsx`
("from AMS" tags). Suites: AMS 125 pass, InstaDraft 50 pass.

**Known limitations / follow-ups:**
- AMS global search (`search/views.py`) is still own-records-only for clients, cases and documents.
- Court documents may take their court header line as the title; a typed "document title" overrides it.
- Sending renders the letterhead with 3 image fetches from AMS (~10–15 s per send). Acceptable inline for now.
