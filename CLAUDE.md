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
| `Advocate-app-FE-main/` | Frontend — React 19 + Vite 7 + TypeScript, Red Tape design system (`src/ui`), TipTap editor. Port **5173**. |
| `Advocate-app-BE-main/` | Legacy Spring backend remnant — only `uploads/` remains. Do not add code here. |
| `roadmap/` | InstaDraft ↔ AMS integration plan (`00-README.md` … `08-*`, `PROGRESS.md`). |
| `docs/` | `DEPLOYMENT.md` (new-server setup, Windows + Linux), `DEMO_GUIDE.md`, `DEMO_AS700_2025.md` (role-by-role demo, case built live), `AI_ASSISTANT.md` (Lisa: flow, tools, permissions, masking), `DEMO_OS900_2025.md` (the meeting demo: one matter built from scratch through every role; reset with `manage.py reset_demo_client --name Kannan --firm rajesh@kumar-associates.demo --yes`), `OPERATIONS.md`, `UI_REDESIGN.md` (Red Tape design system and page migration), `DRAFT_EXPORT.md` (draft versions, redline/PDF export), `DEMO_REDLINE.md` (assign task → AI draft → review → redline, step by step), `merge-plan/` (repo merge steps 00–08). |
| Root docs | `README.md`, `ARCHITECTURE.md` (court data integration), `FEATURES.md`, `LOCAL_DEVELOPMENT.md`, `NEXT_STEPS.md`, `AUDIT_ams.md`, `INSTADRAFT_INTEGRATION_PROMPT.md` |

A third service, the **court scraper** (FastAPI, port 8000), lives in a **separate repo** (`SCRAPER_DIR`, default `C:\Users\ANILA\scrap`). While it is down, all court features (display board, cause lists, case import, Daily Status) return 503 — check port 8000 first.

## Commands

Start everything (Windows): `run-project.bat` (scraper + scheduler + backend + frontend in separate windows; it skips the scraper/scheduler if they're already running).

Dev instance beside the test one (same machine): `run-dev.bat` — backend 8081, frontend 5174, DB `pactpro_db1`, emails to console, no scraper/scheduler (the test instance owns 8080/5173/`PactPro_db` and its scheduler).

Background processes: `tools\install-services.ps1` registers **PactPro Scraper** and **PactPro Scheduler** as sign-in tasks, and **PactPro Cause List Sync** (daily 06:30 and 12:30, `scripts\sync_causelist.bat`). Each runs under `tools\keepalive.ps1`, which restarts it whenever it stops and logs to `logs\<Name>.log`. Use `-Status` to check and `-Uninstall` to remove. Without the scheduler, no hearing, overdue-invoice or task-deadline reminders are sent.

Backend (`Advocate-app-BE-Django/`):
```bat
venv\Scripts\python.exe manage.py runserver 0.0.0.0:8080
venv\Scripts\python.exe manage.py test                 # all tests
venv\Scripts\python.exe manage.py test cases           # one app
venv\Scripts\python.exe manage.py test cases.tests.SomeTestCase.test_x
venv\Scripts\python.exe manage.py run_scheduler        # notifications: send queue every 60s + reminder scan every 15 min (run-scheduler.bat / PactPro Scheduler task)
```
Config via `.env` (python-decouple; copy `.env.example`): `DB_*`, `MAIL_*`, `LLM_*`, `WHATSAPP_VERIFY_TOKEN`, `LIBREOFFICE_PATH` (draft PDF export; needs LibreOffice installed, else PDF is a 503 — `docs/DRAFT_EXPORT.md`).

Export query params: never name one `format` — DRF treats `?format=` as its renderer switch and returns 404 (draft PDF uses `?output=pdf`).

Frontend (`Advocate-app-FE-main/`):
```bat
npm run dev      npm run build      npm run lint
```
API base: `VITE_API_BASE` (default `http://127.0.0.1:8080`, see `src/api/client.ts`).

## Backend architecture

- Project package: `advocate_backend/` (settings, urls). One Django app per domain: `accounts`, `clients`, `cases`, `events`, `documents`, `dashboard`, `notifications`, `rbac`, `expenses`, `invoices` (GST), `payments`, `search`, `reports`, `audit`, `backup`, `communication`, `assistant` (LLM), `appeals`, `workspace` (display board, tasks/review), `courtsearch`, `acts`, `dictionary`, `drafting`, `clientaccess`, `lawcodes` (BNS), `firms` (teams grouped into a firm, `firm_team`), `metering` (AI token usage per feature, `llm_usage`), `core` (shared helpers, `practice.py` tenancy, `finance.py` case money totals).
- **Teams and firms:** a team = a practice root (`parent_advocate_id` NULL) + its members; `firms.FirmTeam` groups teams into one firm. `practice_ids(user)` returns the user's own team, or every team of the firm for firm-wide roles (Super Admin, Accountant). One senior's team must never see another senior's cases. `manage.py make_team` splits a senior out into their own team. `manage.py create_firm` starts a **separate firm** (its own Super Admin, optional seniors); Users → Add User can't, since it always joins the creating admin's firm. User management is per firm too: `/api/admin/users…` only lists and changes accounts of the admin's own firm (`rbac.views._firm_users`); another firm's user is a 404.
- **Unmanaged models:** most models map onto tables from the original Spring app and are `managed = False` — no migrations for them; the DB must already exist. Newer tables are managed normally. To add data to a Spring-owned table, add a small managed side table keyed by the row id (e.g. `clients.ClientHandler` → `client_handler`) rather than altering it.
- **Tests** use `core.test_runner.ManagedModelTestRunner`, which flips unmanaged models to managed and builds tables from models (not migrations). Live-DB CHECK constraints are *not* reproduced in tests.
- **No scraping code in the backend.** It proxies/caches/stores/matches data from the scraper service (see `ARCHITECTURE.md`). Shared caches must never contain per-practice data — apply practice overlays after cache reads.
- **LLM assistant (Lisa)** — see `docs/AI_ASSISTANT.md`. `assistant/planner.py` answers chat (tool calling for openai/gemini, else the `context.py` brief), `tools.py` holds every lookup with its permission (`_CATALOGUE`), `privacy.py` masks, `provider.py` talks to the model (`LLM_PROVIDER`, `ASSISTANT_TOOL_CALLING`). New data or a new action for Lisa = a new `_CATALOGUE` entry with its permission, not a new block in the prompt. **Never add phrase rules for typed text**: typed messages always go to the AI; `/api/assistant/query` is for quick-button command names and the basic-mode fallback only.
- **Assistant access rule:** Lisa must never show what the user's own pages would refuse. Data reaches the prompt only through `assistant/tools.py`, inside `tools.acting_as(request.user)`; gate each block with `tools.allowed(advocate_id, <PERMISSION>)` (and `TOOL_PERMISSIONS` for tools). No process-wide caches of scope or permissions.
- **Assistant masking:** everything Lisa sends to a model goes through `assistant.privacy.Masker` (built with `Masker.for_user`), and replies through `StreamUnmasker`. Forced on for external providers (`llm.EXTERNAL_PROVIDERS`). New prompt content must be masked too; never log unmasked prompts.
- WhatsApp channel is disabled (no real Meta integration).
- **Format validation is shared.** GSTIN (pattern, state code, check digit), PAN, PIN code, phone, email and IFSC rules live in `core/validators.py` (server) and `src/utils/validators.ts` (browser). Keep the two in step. A view validates with `check_payload(request.data, {field: kind})`, which returns cleaned data or a 400 `{error, errors}`. A form shows messages with `components/FieldError.tsx`. Empty values are always allowed; "required" is the form's decision.
- **AI usage is metered** (`metering` app, `llm_usage`). Any new LLM call must go through `assistant.llm.complete_text` / `stream_answer` or drafting's `LLMProvider.complete`, which record tokens. Wrap the work in `metering.usage.metering(feature, operation, advocate_id)`; otherwise it's recorded as `unattributed`. Report with `manage.py llm_usage`.
- **Invoices: advocates raise, accounts issue.** Without `INVOICE_ISSUE` an invoice is saved as an `invoices.InvoiceRequest` (`invoice_request`), not an `invoices` row, so it stays out of every total, report, reminder and the client portal until it is issued. Code that reads `Invoice` needs no "pending" filter. `invoices/create` requires `INVOICE_ISSUE`, and issuing replays the request through the same `_create_invoice`. Invoice status is UNPAID / PARTIAL / PAID / CANCELLED: anything that totals or lists money owed must read `Invoice.objects.billable()` (not cancelled) or `.open()` (billable, not paid), and use `core.finance.invoice_balance` for what is still due. A payment against an invoice is linked in `payment_invoice`, then call `recalc_invoice_status`.
- **Case money totals are derived columns** on `cases` (`total_paid_by_client`, `total_expenses_so_far`, `balance_in_account`, `pending_from_client`). Any new code that adds, changes or deletes a payment, expense or invoice, or changes a case's fee, must call `core.finance.recalc_case_totals(case_id)`. `manage.py recalc_case_totals` repairs them.

## Frontend architecture

- Entry `src/main.jsx` → `src/App.tsx` (routes). Pages in `src/pages/` (Drafting under `src/pages/Drafting/`), shared UI in `src/components/`, API wrappers in `src/api/` and `src/services/`, state in `src/contexts/`, styles in `src/assets/styles/`.
- Migrated to TypeScript; new files should be `.ts`/`.tsx`.
- **UI: Red Tape design system** (see `docs/UI_REDESIGN.md`).
  - Tokens and component classes are in `src/ui/redtape.css`. React building blocks are in `src/ui/` (`kit`, `forms`, `overlays`, `DataTable`, `Icon`).
  - The shell is in `src/layout/`: the sidebar model is `nav.ts`, and the sidebar and Ctrl+K palette sit next to it. `pages/Dashboard.tsx` hosts the shell and the routes.
  - There is no component library: PrimeReact, PrimeFlex and PrimeIcons were removed. Page-area styles live in `src/ui/pages/*.css` and use only Red Tape tokens. Layout grids use `.cols`.
  - The approved reference prototype is `ams-redesign-demo/PactPro_UI_Redesign_Final.html`.
- **Lint:** `npm run lint` covers `.ts`/`.tsx` too (typescript-eslint parser, `eslint.config.js`). `react-hooks/rules-of-hooks` is an **error**: hooks go above any early `return` (a hook below one blanked the Users page). `exhaustive-deps` is a warning, and lint is clean: keep it at 0. Fix a dependency warning for real when that keeps behaviour. Never just add a function that's re-created every render, because that re-fetches in a loop; use a ref or `useCallback`. If an effect deliberately runs only on certain changes, keep the list and add `// eslint-disable-next-line react-hooks/exhaustive-deps -- <why>`. Type-checking stays with `tsc`.
- **Hover hints:** use the native `title` attribute (plus `aria-label` on icon-only buttons); there is no tooltip component.

## Conventions

- Match surrounding code style and comment density; comments explain *why*.
- Never commit secrets; config goes through `.env`.
- Commit/push only when asked; work on the `Developer-*` branch, PRs target `main`.
