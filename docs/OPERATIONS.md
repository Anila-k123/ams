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

The role hierarchy is **Super Admin > Senior Advocate > Advocate > Intern** (plus Accountant and Client). The middle role used to be called "Advocate". On a database from before 2026-10-05, rename it once (it keeps its id, permissions and users; safe to re-run):

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

## Backups and restore verification

Scripts are in `Advocate-app-BE-Django/scripts/`. They never write to `PactPro_db` or to any other application's database on the server (`leaserush`, `esg_db`, `esg_dbb` share this PostgreSQL instance).

**Credentials:** the scripts hold no passwords. `pg_dump` / `psql` read them from the PostgreSQL password file `%APPDATA%\postgresql\pgpass.conf` (one line `localhost:5432:*:postgres:<password>`, readable only by the account that runs the backup) or from `PGPASSFILE`. Keep that file and the `.env` files out of Git and out of backups' logs.

**Backup** — `backup_db.bat` (wrapper) or `backup_db.ps1`:

```
set AMS_BACKUP_DIR=E:\AMS_Backups                  (another disk or a network share)
set AMS_MEDIA_DIR=<settings.MEDIA_ROOT>            (drafting media, optional but recommended)
scripts\backup_db.bat                              (add -DryRun to see what it would do)
```

- Works in `<dir>\inprogress\<stamp>`, then moves a finished backup to `<dir>\daily\<stamp>`; a failed one goes to `<dir>\failed\<stamp>` with its log and exit code 1. A backup counts as good only if it has a `COMPLETE` marker.
- Contents: `PactPro_db.dump` (`pg_dump -Fc`), `PactPro_db.schema.sql`, `dump_toc.txt` (proof the archive reads back), `table_counts.csv` and `schema_summary.csv` (exact row counts, constraint/index counts), `files\` (copies of `DOCUMENT_UPLOAD_DIR` and the drafting media), `manifest.sha256`, `backup.log`.
- Refuses a folder on the system drive (unless `-AllowSystemDrive` for a test), inside the repository, or on a disk/share that is not connected.
- Retention: 30 daily, 8 weekly, 12 monthly. Expired backups are only **listed** in the log; they are deleted only with `-ApplyRetention`, and the newest complete backup is never deleted.

**Restore verification** — `restore_verify.bat <backup folder> [-CreateDatabase]`:

- Target is always the isolated database `pactpro_restore_check`; any other name is refused.
- If it exists it must be empty (no tables), otherwise the script stops. It never drops or replaces a database; `-CreateDatabase` creates it when absent.
- Checks: SHA-256 manifest, `pg_restore --exit-on-error`, row counts and constraint/index counts against the backup's snapshots, document files referenced by the restored rows present in the file copy. Writes `restore_report_<stamp>.md` in the backup folder.
- Drop the check database afterwards only with approval: `dropdb pactpro_restore_check`.

**Full recovery (disaster):** stop the app and scheduler → restore the dump into a **new** database (`createdb PactPro_db_restored` + `pg_restore --no-owner --exit-on-error`) → run `restore_verify` checks against it → point `DB_NAME` at it → copy the `files\` folders back to `DOCUMENT_UPLOAD_DIR` / drafting media → start → smoke test (login, a case, a document download, an invoice, a draft). Keep the old database untouched until sign-off. Point-in-time recovery between nightly backups is not available on this server.

**Restore drill:** monthly, restore the latest backup into `pactpro_restore_check` and record the result in `docs/PHASE0_BASELINE.md`.

**Who connects to the database:** `scripts/db_activity_sampler.ps1 -OutDir <folder>` records, every 5 minutes for 7 days, which users/applications/hosts are connected to `PactPro_db` and the per-table write counters (read-only, no query text). Used to prove no other application writes to the AMS tables before they are altered.

## Phase 1 security settings and pending steps

- **Migration pending:** `accounts.0001_initial` creates `auth_attempt` (login / reset-code attempt counting). Apply it only after a verified backup (`python manage.py migrate accounts`). Until then sign-in works but the lockout is off, and the backend logs `attempt counting is OFF`.
- **`.env` on every machine:** `DEBUG` now defaults to False, and with DEBUG off the app refuses to start without a real `SECRET_KEY`. Development / test machines must say `DEBUG=True`; a production `.env` must set a long random `SECRET_KEY` (changing the key that signs tokens - `JWT_SIGNING_KEY`, else `SECRET_KEY` - logs everyone out).
- **Sessions (Phase 4):** migration `accounts.0002` (token versions). Tokens issued before Phase 4 are refused (everyone signs in once); `JWT_ACCEPT_LEGACY_UNTIL=<ISO datetime, at most 8 h ahead>` lets them run out instead. `ACCESS_TOKEN_MAX_HOURS` (8), `JWT_EXPIRATION_MS` (8 h default), `DOCUMENT_LINK_SECONDS` (60). Logout signs a person out on every device.
- **Platform (Phase 5):** migrations `accounts.0003`, `firms.0005`, `platform_admin.0001`. Create the first operator on the server console: `manage.py platform_operator create --email ... --role OWNER` (prompts for a 14+ character password, prints the authenticator secret once). Settings: `PLATFORM_TOKEN_MINUTES` (60), `INVITATION_TTL_HOURS` (72); invitation links use `CLIENT_APP_URL`. See `docs/PLATFORM.md`.
- **Platform console (Phase 6):** migrations `firms.0006` (invitation delivery status) and `platform_admin.0002` (encrypted MFA seed). Set `PLATFORM_MFA_KEY` in `.env` (Fernet key, independent of `SECRET_KEY`) **before** creating operators and back it up with the database: without it operator sign-in answers 503. Console at `/platform/login`. Failed invitation emails show as *not delivered* on the platform dashboard and firm pages; resend from there. UI tests: `npm test` (Vitest + Testing Library, `vitest.config.ts`). After restoring a database or moving servers run `manage.py platform_operator verify-key`: it confirms `PLATFORM_MFA_KEY` still reads every operator's seed (prints nothing secret).
- **Phase 9 (validation):** on every deploy run `rename_junior_role` first (Junior Advocate -> Advocate: system template and every firm copy still named so; applied to the local PactPro_db on 2026-10-14, backup `20261014_143534`), then the permission seeds (idempotent; now reach every firm's copy of a system role): `seed_admin_permissions`, `seed_alert_permissions`, `seed_firm_wide_scope`, `seed_task_permissions`, `seed_invoice_permissions`, `seed_drafting_permissions`. Once `CASE_ALERTS` exists, hearing and cause-list alerts go only to its holders (Super Admin, Senior Advocate, Advocate, Intern; not the Accountant) instead of everyone with `CASE_VIEW`. Applied to the local PactPro_db on 2026-10-14 after a dry run (backup `20261014_133222`): 24 grants, 2 removals from the Senior Advocate template only, no firm role or member lost anything. Check a database with `manage.py integrity_report` (read-only; exit 1 on an error). Browser E2E: `npm run e2e` in the frontend, against `pactpro_e2e` only (`docs/E2E.md`).
- **Phase 7 (financial integrity, `docs/RELIABILITY.md`):** migrations `invoices.0009` (`invoice_sequence`, `payment_request_key`), `invoices.0010` (invoice numbers unique per firm: adds `invoices_firm_number_uniq` / `invoices_legacy_number_uniq`, drops the server-wide `UNIQUE (invoice_number)`; no row changed), `notifications.0001` (`notification_key`, `job_run`). Background job health: `manage.py job_status` (`--failed`, `--job process_notifications`). Invitation emails sent with the console mail backend show as *not emailed (console)*, not *sent*.
- **New switches** (defaults in brackets): `DOCUMENT_MAX_UPLOAD_MB` (25), `BACKUP_MAX_UPLOAD_MB` (200), `LOGIN_LOCKOUT_ENABLED` (True), `LOGIN_MAX_FAILURES` (5), `LOGIN_MAX_FAILURES_PER_IP` (20), `LOGIN_LOCKOUT_MINUTES` (15), `OTP_MAX_FAILURES` (5), `ROLE_EDITING_LOCKED` (True), `DRAFTING_MASK_EXTERNAL` (True), `ALLOW_EXTERNAL_TRANSLATION` (False), HTTPS: `SECURE_SSL_REDIRECT`, `SECURE_HSTS_SECONDS`, `SECURE_COOKIES`, `BEHIND_HTTPS_PROXY` (all off).
- **Restricted database role:** `scripts/create_app_role.sql` creates a LOGIN role without superuser/createdb/createrole and grants it read/write on the `public` and `drf` tables (plus default privileges for future migrations). Rehearse on an isolated database first; then `DB_USER=<that role>` in `.env`, and run migrations as the owner. Not yet applied anywhere.

## SaaS tenancy migrations (Phase 2)

Not applied to the office database. On an isolated database: `migrate` (adds firm tables and nullable `firm_id` columns), set `TENANCY_COLUMNS=True`, then `plan_tenancy` -> approval -> `apply_tenancy --yes` -> `verify_tenancy`, then `TENANCY_MODE=shadow` and later `firm` with approval. Full procedure and rollback: `docs/TENANCY.md`. Run `makemigrations` normally (it always sees the tenancy columns).

## Read-only baseline inventory

```
python manage.py baseline_inventory --out C:\AMS_Baseline\<date>
```

Switches the session to READ ONLY (and stops if PostgreSQL does not confirm it), then writes JSON/CSV files: practice roots and a proposed firm mapping, roles and the role × permission matrix, every user's effective permissions, permissions the code uses but the database lacks, ownership anomalies, schema/model drift, document path patterns, invoice number formats, database roles and connections. The output contains names and emails: the command refuses a folder inside the repository. Never commit it.

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

## Subscriptions (Phase 8)

Deploy: `manage.py migrate` (subscriptions 0001-0003, metering 0002, invoices 0011), then `manage.py seed_plans`. The seeded plans are unapproved DRAFT examples: a platform owner approves and publishes real plans on Platform -> Plans. Until then new firms are created with **plan pending** (sign in, add nothing). The scheduler runs `subscription_sweep` (ended trials -> EXPIRED; releases AI/drafting requests left reserved > 2 h). `manage.py reconcile_usage [--storage]` only reports (counters vs events, stale requests, stock over limit, document rows vs files); `--apply` corrects counters and releases stale requests, never deletes data or files. `--backfill-ai --apply` fills `llm_usage.firm_id`. Never set `SUBSCRIPTION_TEST_PLANS` on a customer install (it is ignored without DEBUG anyway). Details: `docs/SUBSCRIPTIONS.md`.

## Production settings checklist

- `DEBUG=False`, a real `SECRET_KEY`, and `ALLOWED_HOSTS` set to the API host.
- `CORS_ORIGINS` set to the real frontend origin(s).
- Frontend built with `VITE_API_BASE` set to the real API origin. It's read at build time; there is no dev proxy.
- `CLIENT_APP_URL` set to the frontend origin, since client-login invite emails link there.
- `COURT_API_BASE` set to the scraper service.
- `DRAFTING_MEDIA_ROOT` set to a permanent folder, plus the drafting keys.
- Background jobs on Redis + a Celery worker (`CELERY_TASK_ALWAYS_EAGER=False`). See "PERMANENT SOLUTION" above.
