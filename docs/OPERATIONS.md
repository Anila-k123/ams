# Running AMS (with Drafting)

AMS is one codebase since the InstaDraft merge (docs/merge-plan):
- backend: Django in `Advocate-app-BE-Django`;
- frontend: React + Vite in `Advocate-app-FE-main`.

Drafting is a feature inside AMS, served under `/api/drafting/` and on the frontend at `/dashboard/drafting/*`, plus `/draft/:id` for the editor. No separate InstaDraft server is needed.

## Processes

| Process | Command (from the backend folder unless noted) | Needed |
|---|---|---|
| Backend API | `python manage.py runserver 8080` (prod: a WSGI server on `advocate_backend.wsgi`) | always |
| Frontend | `npm run dev` in `Advocate-app-FE-main` (prod: `npm run build`, serve `dist/`) | always |
| Court lookup scraper | the separate scraper service at `COURT_API_BASE` (task **PactPro Scraper**) | for every court feature |
| Notifications scheduler | `python manage.py run_scheduler` (task **PactPro Scheduler**, or `run-scheduler.bat`) | for reminders (hearings, overdue invoices, task deadlines) and retries |
| Cause-list sync | `scripts\sync_causelist.bat` (task **PactPro Cause List Sync**, 06:30 and 12:30 daily) | for the Daily Causelist and "you are listed" alerts |
| Celery worker | `celery -A advocate_backend worker -l info` | the permanent job setup (`CELERY_TASK_ALWAYS_EAGER=False`); until then the API starts its own stopgap worker process |
| Redis | any Redis at `REDIS_URL` | only with the worker |

### Keeping the scraper and scheduler running

`powershell -ExecutionPolicy Bypass -File tools\install-services.ps1` registers both as Windows scheduled tasks for the signed-in user. They start at sign-in and need no admin rights.
- Each runs under `tools\keepalive.ps1`, which restarts the process whenever it stops. A process that keeps failing straight after start is retried with a growing pause, up to 5 minutes.
- The task restarts the wrapper itself if that ever dies.
- Logs are `logs\Scraper.log` and `logs\Scheduler.log`: the process output plus a `[keepalive]` line for every start and stop, with the exit code. They roll over at 10 MB.
- It also registers **PactPro Cause List Sync**. This is a run at 06:30 and 12:30 daily, not a process kept alive. It fetches today's and tomorrow's lists for `sci chennai madurai chennai_dc` and logs to `Advocate-app-BE-Django\logs\sync_causelist.log`. It needs the scraper up. If the PC was off at 06:30, it runs when the PC is back.
- `-Status` shows each task's state and the sync's last and next run; `-Uninstall` stops and removes all three.
- The scraper runs without `--reload` here. Under `--reload`, a child process keeps the port after its parent dies, and a new scraper can't bind. Install and uninstall stop such children too.
- On a server, NSSM (Windows service) or systemd does the same job and also runs before anyone signs in.

## Database

There is **one** PostgreSQL database, `PactPro_db` (`DB_NAME`), with two schemas:
- `public`: AMS. The Spring-era tables are `managed=False`, and Django-owned apps (workspace, documents, clientaccess, …) sit alongside.
- `drf`: drafting (merged from InstaDraft). Its tables are named `"drf"."..."` and use the `pgvector` extension.

The extensions needed are `vector`, `pg_trgm` and `pgcrypto`. Migrations run once:

```
python manage.py migrate
```

After a fresh install, create the drafting permission codes and give them to the chamber roles (safe to re-run):

```
python manage.py seed_drafting_permissions
python manage.py seed_invoice_permissions
```

`seed_invoice_permissions` creates `INVOICE_ISSUE` (Accountant, Super Admin), lets the Advocate role raise invoices for accounts to issue, and takes `INVOICE_ISSUE` / `PAYMENT_CREATE` / `INVOICE_EDIT` away from the Senior Advocate, so issuing, payments and corrections all stay with accounts (see FEATURES.md §9).

The role hierarchy is **Super Admin > Senior Advocate > Advocate > Intern** (plus Accountant and Client). The middle role used to be called "Junior Advocate". On a database from before 2026-10-05, rename it once (it keeps its id, permissions and users; safe to re-run):

```
python manage.py rename_junior_role
```

**A new, separate firm** (for example a sandbox for a team to explore in). Users → Add User always adds people to the creating admin's own firm, so the first account comes from a command:

```
python manage.py create_firm --name "Sandbox Law Chambers" --admin-name "Anitha R" --admin-email anitha@example.com --senior "Ravi K <ravi@example.com>" --password Explore@2026
python manage.py create_firm ... --yes
```

Without `--yes` it only shows what it would create. The new Super Admin's firm is invisible to every other firm. Each `--senior` becomes a team of it ("Head of own practice"), and later users added by that admin from the screens join it too. It's safe to re-run; existing emails are left alone.

**History:**
- Until 2026-09-25, AMS used `advocate_db` and drafting used `pactpro`, behind a database router.
- Both were merged into `PactPro_db`: AMS's `public` plus drafting's `drf`, with every row count checked.
- The router and the second connection were removed, so filing a draft to AMS is now one transaction.
- The old databases were left untouched as backups. InstaDraft's retired login tables (`pactpro.public`) were not carried over.

Note: the name has capitals, so write it quoted in `psql` / pgAdmin (`"PactPro_db"`).

## Files

- AMS documents: `DOCUMENT_UPLOAD_DIR`.
- Drafting uploads (reference documents, templates, playbook files): `DRAFTING_MEDIA_ROOT`.
  - Both are served only through the API, behind the login and practice scope, never as public `/media`.
  - The default `DRAFTING_MEDIA_ROOT` still points at the retired InstaDraft checkout (`Desktop/pact-pro-draft/backend/media`). Copy that folder somewhere permanent and set `DRAFTING_MEDIA_ROOT` before archiving InstaDraft.

## Background jobs (drafting)

These jobs run in the background (`drafting/tasks.py`):
- document processing (parse, clauses, embeddings);
- draft generation;
- summaries, translation, template parsing, playbooks and risk analysis.

They are CPU-heavy and load torch, transformers and docling (1–2 GB).

### Current setup: STOPGAP (`CELERY_TASK_ALWAYS_EAGER=True`, `DRAFTING_JOB_RUNNER=process`)

Jobs run in **one separate worker process on the same machine** (`drafting/jobs.py`). The web server starts it on the first job, and it keeps the AI libraries loaded. Page requests don't compete with jobs any more.
- Measured: the Cases call stayed at 0.08–0.24 s during a document job.
- In-web-server threads made every page slow while a job ran.

Limits of the stopgap:
- Jobs are lost if the web server stops or restarts. A document stuck at "pending" or "processing" can be prepared again from the Documents page.
- Each web server process starts its own worker. Don't use this with several web workers (gunicorn/waitress with many processes).
- There are no retries, no queue you can see, and no monitoring.

### PERMANENT SOLUTION (do this before production)

1. Run Redis and point `REDIS_URL` at it.
2. Run a Celery worker next to the API: `celery -A advocate_backend worker -l info` (on Windows add `--pool=solo` or `--pool=threads`). It needs the same `.env` and the AI packages.
3. Set `CELERY_TASK_ALWAYS_EAGER=False` and restart the API.

Jobs then go to Redis, run in the worker, survive web restarts and can be scaled and monitored. Nothing in `drafting/jobs.py` is used then.

`DRAFTING_JOB_RUNNER=thread` brings back the old in-web-server threads. It's for debugging only.

## AI packages and keys

- **Packages:** drafting needs the AI stack in `requirements.txt` (langchain, sentence-transformers, transformers, docling, anthropic and others; about 2 GB with torch).
- **Model downloads:** the embedding model (`DRAFTING_EMBED_MODEL`) is downloaded from Hugging Face on first use.
- **Keys and model names:** they use `DRAFTING_`-prefixed names (`DRAFTING_GEMINI_API_KEY`, …), because the AMS assistant uses the plain `LLM_*` / `GEMINI_*` names with other meanings. See `.env.example`.

## AI usage and cost

Every LLM call is recorded in the `llm_usage` table (app `metering`): who made it, their firm, the feature, the model, and the input and output tokens.

**Features** (the pricing buckets):

| Feature | What it covers |
|---|---|
| `chat` | Lisa's answers |
| `summary` | Document summaries |
| `draft` | Everything in drafting: generate, edit, refine, consistency check, preparing documents and templates, playbooks, risks |
| `translation` | Sarvam translation, measured in characters, not tokens |

**Reading it:**
```bat
venv\Scripts\python.exe manage.py llm_usage                    &rem by feature, all time
venv\Scripts\python.exe manage.py llm_usage --by user --from 2026-10-01 --to 2026-10-31
venv\Scripts\python.exe manage.py llm_usage --by model
```
Groups: `feature`, `operation`, `user`, `firm`, `model`. The same figures are at `GET /api/usage/summary?by=&from=&to=` (Super Admin only).

**Cost.** Set `LLM_PRICES` in `.env`: price per 1 million tokens, `[input, output]`, by model name, e.g. `{"gpt-4o-2024-08-06": [2.5, 10], "gemini-2.5-flash": [0.3, 2.5]}`. Set the currency with `LLM_PRICE_CURRENCY`. Prices are applied when the report runs, so they can change without touching recorded usage. Tokens on a model with no price are reported but left out of the cost.

**Estimated rows.** Where a provider sends no token counts (the local Flask wrapper, or a server that ignores `stream_options`), tokens are estimated at about 4 characters per token, and the row is flagged `estimated`. The report shows how many calls were estimated.

Embeddings run locally (HuggingFace) and cost nothing, so they aren't metered.

## Production settings checklist

- `DEBUG=False`, a real `SECRET_KEY`, and `ALLOWED_HOSTS` set to the API host.
- `CORS_ORIGINS` set to the real frontend origin(s).
- Frontend built with `VITE_API_BASE` set to the real API origin. It's read at build time; there is no dev proxy.
- `CLIENT_APP_URL` set to the frontend origin, since client-login invite emails link there.
- `COURT_API_BASE` set to the scraper service.
- `DRAFTING_MEDIA_ROOT` set to a permanent folder, plus the drafting keys.
- Background jobs on Redis + a Celery worker (`CELERY_TASK_ALWAYS_EAGER=False`). See "PERMANENT SOLUTION" above.
