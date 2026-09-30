# CLAUDE.md

Guidance for Claude Code when working in this repository (AMS — Advocate Management System).

## Documentation rule (always follow)

- **Keep this file current.** When a change alters architecture, commands, conventions, env vars, or gotchas listed here, update CLAUDE.md in the same change.
- **Keep `docs/` current.** Feature, operations, or design changes must be reflected in the relevant Markdown file under `docs/` (or the root docs listed below). Add a new `docs/*.md` for a new feature area rather than leaving it undocumented.
- Update docs as part of the task, not as a follow-up.

## Repository layout

| Path | What |
|------|------|
| `Advocate-app-BE-Django/` | Backend — Django 5.1 + DRF, PostgreSQL (`PactPro_db`). Port **8080**. |
| `Advocate-app-FE-main/` | Frontend — React 19 + Vite 7 + TypeScript, PrimeReact, TipTap editor. Port **5173**. |
| `Advocate-app-BE-main/` | Legacy Spring backend remnant — only `uploads/` remains. Do not add code here. |
| `roadmap/` | InstaDraft ↔ AMS integration plan (`00-README.md` … `08-*`, `PROGRESS.md`). |
| `docs/` | `DEPLOYMENT.md` (new-server setup, Windows + Linux), `DEMO_GUIDE.md`, `OPERATIONS.md`, `merge-plan/` (repo merge steps 00–08). |
| Root docs | `README.md`, `ARCHITECTURE.md` (court data integration), `FEATURES.md`, `LOCAL_DEVELOPMENT.md`, `NEXT_STEPS.md`, `AUDIT_ams.md`, `INSTADRAFT_INTEGRATION_PROMPT.md` |

A third service, the **court scraper** (FastAPI, port 8000), lives in a **separate repo** (`SCRAPER_DIR`, default `C:\Users\ANILA\scrap`). While it is down, all court features (display board, cause lists, case import, Daily Status) return 503 — check port 8000 first.

## Commands

Start everything (Windows): `run-project.bat` (scraper + backend + frontend in separate windows).

Backend (`Advocate-app-BE-Django/`):
```bat
venv\Scripts\python.exe manage.py runserver 0.0.0.0:8080
venv\Scripts\python.exe manage.py test                 # all tests
venv\Scripts\python.exe manage.py test cases           # one app
venv\Scripts\python.exe manage.py test cases.tests.SomeTestCase.test_x
venv\Scripts\python.exe manage.py process_notifications # notifications worker (see run-scheduler.bat)
```
Config via `.env` (python-decouple; copy `.env.example`): `DB_*`, `MAIL_*`, `LLM_*`, `WHATSAPP_VERIFY_TOKEN`.

Frontend (`Advocate-app-FE-main/`):
```bat
npm run dev      npm run build      npm run lint
```
API base: `VITE_API_BASE` (default `http://127.0.0.1:8080`, see `src/api/client.ts`).

## Backend architecture

- Project package: `advocate_backend/` (settings, urls). One Django app per domain: `accounts`, `clients`, `cases`, `events`, `documents`, `dashboard`, `notifications`, `rbac`, `expenses`, `invoices` (GST), `payments`, `search`, `reports`, `audit`, `backup`, `communication`, `assistant` (LLM), `appeals`, `workspace` (display board, tasks/review), `courtsearch`, `acts`, `dictionary`, `drafting`, `clientaccess`, `lawcodes` (BNS), `core` (shared helpers, `practice.py` tenancy).
- **Unmanaged models:** most models map onto tables from the original Spring app and are `managed = False` — no migrations for them; the DB must already exist. Newer tables are managed normally.
- **Tests** use `core.test_runner.ManagedModelTestRunner`, which flips unmanaged models to managed and builds tables from models (not migrations). Live-DB CHECK constraints are *not* reproduced in tests.
- **No scraping code in the backend.** It proxies/caches/stores/matches data from the scraper service (see `ARCHITECTURE.md`). Shared caches must never contain per-practice data — apply practice overlays after cache reads.
- **LLM assistant** (`assistant/llm.py`, `tools.py`): OpenAI-compatible endpoint configured by `LLM_*` env vars (locally hosted model by default).
- WhatsApp channel is disabled (no real Meta integration).

## Frontend architecture

- Entry `src/main.jsx` → `src/App.tsx` (routes). Pages in `src/pages/` (Drafting under `src/pages/Drafting/`), shared UI in `src/components/`, API wrappers in `src/api/` and `src/services/`, state in `src/contexts/`, styles in `src/assets/styles/`.
- Migrated to TypeScript; new files should be `.ts`/`.tsx`.

## Conventions

- Match surrounding code style and comment density; comments explain *why*.
- Never commit secrets; config goes through `.env`.
- Commit/push only when asked; work on the `Developer-*` branch, PRs target `main`.
