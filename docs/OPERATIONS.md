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
| Court lookup scraper | the separate scraper service at `COURT_API_BASE` | for Add Case court import |
| Celery worker | `celery -A advocate_backend worker -l info` | the permanent job setup (`CELERY_TASK_ALWAYS_EAGER=False`); until then the API starts its own stopgap worker process |
| Redis | any Redis at `REDIS_URL` | only with the worker |

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
```

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

## Production settings checklist

- `DEBUG=False`, a real `SECRET_KEY`, and `ALLOWED_HOSTS` set to the API host.
- `CORS_ORIGINS` set to the real frontend origin(s).
- Frontend built with `VITE_API_BASE` set to the real API origin. It's read at build time; there is no dev proxy.
- `CLIENT_APP_URL` set to the frontend origin, since client-login invite emails link there.
- `COURT_API_BASE` set to the scraper service.
- `DRAFTING_MEDIA_ROOT` set to a permanent folder, plus the drafting keys.
- Background jobs on Redis + a Celery worker (`CELERY_TASK_ALWAYS_EAGER=False`). See "PERMANENT SOLUTION" above.
