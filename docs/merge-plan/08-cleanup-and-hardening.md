# Phase 8 — Cleanup & hardening

## Goal

Close out the merge: remove anything carried over speculatively, confirm the app is genuinely production-deployable, and run a full regression pass across both original feature sets.

## What happens

1. **Remove dead settings/config**:
   - Confirm no `INSTADRAFT_*` settings, `integrations` references, or `core/instadraft_tokens.py` traces survived Phase 07.
   - Confirm InstaDraft's original `python-decouple` dependency and `accounts`/simplejwt traces are fully gone (Phases 01-02).
   - Confirm `channels`/`CHANNEL_LAYERS` — installed but unused per the original settings comment ("wired for parity ... WebSockets deferred") — is either genuinely needed by something built during this merge or removed; don't leave it as unexplained dead weight either way.

2. **Prod-readiness check for frontend config**:
   - Confirm the merged app's `VITE_API_BASE` pattern works against a real deployed backend origin, not just local dev (AMS's `vite.config.js` has no dev proxy today, so this should already be fine — verify, don't assume).
   - Confirm `CORS_ALLOWED_ORIGINS` includes the real production frontend origin.
   - Confirm the dev port collision noted in Phase 04 (`Advocate-app-FE-main`'s Vite config and InstaDraft's both defaulted to 5173) is fully moot post-merge (one server, one config) — remove any leftover port-pinning workaround from the old two-app setup (`roadmap` step 02 pinned InstaDraft to 5175 specifically for the old integration; that pin is no longer needed).

3. **Full regression pass** — exercise, end to end, in the browser:
   - Every original AMS module: cases, clients, tasks/workspace (incl. task review states), documents, HR-adjacent apps, appeals, court search, expenses, invoices, payments, notifications, communication, dictionary, acts/lawcodes, reports, backup, audit, RBAC/role management, client-portal (`clientaccess`) role.
   - Every original InstaDraft flow: all three drafting modes, the 3-pane editor (citations, chat-edit, refine, re-draft), templates/samples/playbooks CRUD, document summary/translate, the new finalize-to-Document flow with branding.
   - Cross-cutting: login as each AMS role (advocate/staff via various `Role`/`Permission` grants, and the `CLIENT` role via `clientaccess`) and confirm route/permission behavior matches the RBAC decisions made in Phases 03/06, for both AMS's existing modules and drafting's new ones. Specifically re-verify `clientaccess/gate.py`'s deny-by-default behavior still refuses `CLIENT`-role users from every drafting endpoint (it refused the old InstaDraft integration outright per `PROGRESS.md`; confirm the merged in-process version preserves that refusal).

4. **Confirm the operational story for Celery** (opened in Phase 05) is documented somewhere real ops people will find it.

5. **Retire drafting's own client, project and member records** (decided in phase 04, when the drafting Administration screen was removed):
   - Drafting clients and projects are only mirrors of AMS clients and cases, created by `/api/drafting/link-case/` and by uploads that carry `case_id`.
   - Make `/api/drafting/clients/`, `projects/` and `members/` read-only, or remove them.
   - Drop the `Member` model and its data once nothing reads it, and remove the now-unused `draftingApi` helpers (`getAllProjects`, `getAllMembers`, …).

## Files touched

Potentially any file touched in Phases 01–07 — this is a sweep, not a new feature area.

## Done when

- Full regression checklist (above) passes.
- A production build serves correctly against a real backend deployment.
- No dead code/settings/dependencies remain from either app's pre-merge state, or from the now-fully-retired REST/SSO integration, that aren't load-bearing.
- The merge is complete — `Advocate-app-BE-Django`/`Advocate-app-FE-main` are the one codebase going forward; `pact-pro-draft` and `Advocate-app-BE-main` (the original Spring backend) are historical/archived, pending confirmation that nothing else still depends on the Spring backend's `uploads/` directory being reachable at its current path.

## As built (2026-09-24)

- **Dead config removed:**
  - Channels: the app, `CHANNEL_LAYERS`, `ASGI_APPLICATION`, and the Channels router in `asgi.py`, which is now plain Django.
  - `djangorestframework-simplejwt`: replaced in `requirements.txt` by `PyJWT`, which AMS actually uses.
  - No `integrations` or `INSTADRAFT_*` traces remain.
  - The frontend's real-time client is a pre-merge AMS feature. It is left as is, and off unless `VITE_ENABLE_WS=true`.
- **Requirements:** `anthropic` added, since drafting imports it. The duplicate `pdfplumber` is gone. `IndicTransToolkit` is marked optional.
- **Celery:** `advocate_backend/celery.py` added, so a worker can start (`celery -A advocate_backend worker`). It discovers the 7 drafting jobs. Jobs still run in-process until `CELERY_TASK_ALWAYS_EAGER=False`.
- **Operations:** documented in `docs/OPERATIONS.md`: processes, the two databases and their migrations, files, background jobs, AI keys, and a production checklist. `.env.example` now covers `COURT_API_BASE`, `DRAFTING_*`, `CELERY_TASK_ALWAYS_EAGER` and `REDIS_URL`.
- **Drafting clients, projects and members retired:**
  - The `/api/drafting/clients|projects|members/` endpoints are removed. They had no practice scope, so any drafting user could list every firm's clients and cases.
  - The `Member` model and `DraftSession.member` are dropped (migration `0003`). The 4 demo rows are backed up in the session scratchpad.
  - Uploads and sessions can no longer set the client or project directly: they follow the AMS case.
- **Client-role regression:** the gate sweep now builds real paths for DRF router routes. Before, drafting detail routes became nonsense paths whose 404s counted as passes. A strict test requires a 403 on every drafting route and method for a CLIENT user.
- **Still open (needs the owner):**
  - Move drafting media off the retired InstaDraft checkout (set `DRAFTING_MEDIA_ROOT`).
  - **Background jobs, PERMANENT SOLUTION still to do:** run Redis and a Celery worker, and set `CELERY_TASK_ALWAYS_EAGER=False` (docs/OPERATIONS.md).
    - Current stopgap (2026-09-24): `drafting/jobs.py` runs jobs in one separate worker process started by the API, instead of threads in the web server.
    - That fixed the app-wide slowness while documents processed.
    - Jobs are still lost on restart, and it doesn't suit several web workers.
  - Confirm nothing else needs the Spring backend's `uploads/` path before archiving `Advocate-app-BE-main`.
  - Do a hands-on click-through of each module's forms. The browser pass so far was load-and-render, plus the drafting and filing flows.
