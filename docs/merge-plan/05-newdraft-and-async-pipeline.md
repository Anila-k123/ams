# Phase 5 — NewDraft + async pipeline

## Goal

Rebuild the `NewDraft` multi-step creation flow, and turn on real asynchronous processing (Redis + a Celery worker) for `process_sample`/`generate_draft` — genuinely new operational infrastructure for AMS, which has none today (`channels` is installed but only wired for parity, running in-memory, unused).

## What happens

1. **Rebuild `NewDraft`** (PrimeReact — no library-switch decision needed here, unlike the discarded plan's AntD assumption): multi-step flow (mode selection → template/sample/library picks → case-facts form driven by `Template.slot_schema` → optional AMS case). Port the step logic from `frontend/src/pages/NewDraft.tsx`/`NewDraftScratch.tsx` as-is; this is a near-direct port since the target UI library hasn't changed.

2. **Case linkage in this flow** (revised during phase 04): there is **no drafting client/project/member picking** any more, and the drafting Administration screen was removed.
   - The wizard's last step is an optional "AMS case" picker. Reuse `src/pages/Drafting/components/CaseField.tsx` and `AmsCasePicker.tsx`, backed by `/api/drafting/ams-cases/`, which is scoped to the practice.
   - On pick, call `/api/drafting/link-case/` (`drafting/ams_cases.py`). It gets or creates the drafting Client and Project for that case and returns `prefill` fact values plus the task.
   - Send the returned `projectId` when creating the draft session.
   - Arriving from a task (`?caseId=&taskId=`, built by `newDraftUrl()`) pre-selects the case and keeps the `taskId` for phase 07's filing and review.
   - A draft with no case is allowed; it has no project, as in standalone InstaDraft.
   - The backend `clients/`, `projects/` and `members/` endpoints stay for now, because link-case and existing rows use them. Phase 08 restricts or removes them.

3. **Flip Celery to real async**:
   - `CELERY_TASK_ALWAYS_EAGER = False`.
   - Provision Redis (dev: local/docker; confirm with whoever runs AMS in production today whether this is acceptable new infra, and who monitors it — AMS has never needed a broker or worker process before).
   - Add a Celery worker process to AMS's deployment (currently doesn't exist in this repo — flag explicitly if no deployment/process-management config is found for AMS at all, since that's a bigger gap than "add a worker," it's "there may be no process story yet to add it to").
   - `process_sample` (PDF → clause extraction → embeddings) and `generate_draft` (retrieval → LLM → DraftBlock persistence) now run out-of-process.

## Files touched

- `Advocate-app-BE-Django/advocate_backend/settings.py` (`CELERY_TASK_ALWAYS_EAGER`)
- `Advocate-app-BE-Django/drafting/tasks.py`
- `Advocate-app-FE-main/src/pages/Drafting/NewDraft.tsx` (new, ported)
- Deployment/process config for the Celery worker (confirm what exists for AMS today before assuming a slot to add this into)

## Risk/effort

Medium-high. Frontend rebuild is medium (more steps/state than Phase 04's simple pages, no novel interaction patterns since PrimeReact carries over unchanged). The real risk is operational: new infrastructure, new failure modes (broker down, task silently fails, worker not running) for a team that's never run one.

## Done when

- Creating a new draft session through every mode (template+documents, documents-only, from-scratch) works end-to-end.
- With `CELERY_TASK_ALWAYS_EAGER = False` and a worker running, `process_sample`/`generate_draft` execute asynchronously — verify via the status-polling endpoint reflecting `pending` → `generating`/`processing` → `ready` with a real time gap.
- A documented answer exists for "who runs and monitors the Celery worker in production" before this phase is called done outside dev.

## Next phase

`06-three-pane-editor.md`
