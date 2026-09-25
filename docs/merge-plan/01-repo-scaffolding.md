# Phase 1 — Repo scaffolding

## Goal

Get InstaDraft's `drafting` app installed inside `Advocate-app-BE-Django` and migrating cleanly, with zero functional drafting behavior yet.

## Background

Part of merging InstaDraft (`C:\Users\Sybrant\Desktop\pact-pro-draft`) into AMS (`C:\Users\Sybrant\ams`) as one codebase. See `00-README.md` for the full decision log. The already-built `integrations` app (this repo) and InstaDraft's own `accounts`/`integrations` apps are retired in later phases (02 and 07) — not touched here.

## What happens

1. **Copy InstaDraft's business app in** as a new top-level Django app `drafting/` inside `Advocate-app-BE-Django` (AMS apps are top-level, not namespaced under an `apps/` package — e.g. `cases/`, `documents/`, `workspace/` sit directly in the repo root; follow that convention, not InstaDraft's own or the discarded plan's `apps.drafting`):
   - `backend/drafting/{models,serializers,views,urls,admin,tasks}.py` → `drafting/...`
   - `backend/drafting/export/` (DOCX renderer — real, already works, reused unmodified) → `drafting/export/`
   - `backend/drafting/providers/` (`llm.py`, `embeddings.py`) → `drafting/providers/`
   - `backend/drafting/services/` → `drafting/services/`
   - Do **not** copy `backend/accounts/` (retired, Phase 02) or `backend/integrations/` (retired, Phase 07).

2. **`INSTALLED_APPS`** (`advocate_backend/settings.py:22-56`): add `'drafting'` after the existing local apps, before `'integrations'` (which still exists until Phase 07).

3. **Dependencies** — add to AMS's `requirements.txt`: `pgvector`, `python-docx` (if not already present — the `integrations`-era DOCX work in InstaDraft used it), `celery`, `redis`, `langchain-community` + HF embeddings deps, whichever LLM SDK `LLM_ACTIVE` needs. AMS already has `channels==4.1.*` installed (unused, in-memory) — leave it, don't touch it in this phase.

4. **Settings merge** (`advocate_backend/settings.py`) — port InstaDraft's `python-decouple` `config()` calls to plain `os.getenv()` (AMS reads env vars directly, no decouple):
   - AI provider block verbatim: `LLM_PROVIDER`, `LLM_MODEL`, `LLM_ACTIVE`, `EMBED_MODEL`, `EMBED_DIM`, `SARVAM_*` — no name collisions with existing AMS settings.
   - `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND`, `CELERY_TASK_ALWAYS_EAGER = True` (eager through Phase 04 — no Redis needed yet).
   - `CORS_EXPOSE_HEADERS = ['Content-Disposition']` — new; needed later for DOCX download filenames (AMS's `CORS_ALLOWED_ORIGINS` at `settings.py:136-140` already covers dev origins, this just adds header exposure).

5. **Migration** — `drafting`'s first migration is authored fresh (not copied from InstaDraft's 36 existing migrations), and includes `CREATE SCHEMA IF NOT EXISTS drf` + `CREATE EXTENSION IF NOT EXISTS vector`. **This runs in `advocate_db`** — the same live Postgres database the original Spring backend and AMS's `managed=False` core models use. The `drf` schema is new and isolated (no existing table names collide), but confirm with whoever owns that database that creating a new schema + extension there is acceptable before running this against anything but a local/dev copy.

6. **Frontend scaffolding**: create `Advocate-app-FE-main/src/pages/Drafting/` and `Advocate-app-FE-main/src/editor/` (empty/placeholder) so Phase 04 has somewhere to land InstaDraft's ported pages. No PrimeReact dependency added yet — that's Phase 04's first real step.

## Files touched

- `Advocate-app-BE-Django/drafting/` (new)
- `Advocate-app-BE-Django/advocate_backend/settings.py`
- `Advocate-app-BE-Django/requirements.txt`
- `Advocate-app-FE-main/src/pages/Drafting/`, `Advocate-app-FE-main/src/editor/` (new, empty)

## Risk/effort

Low, mechanical — except the "new schema in a shared production-lineage database" caveat above, which needs an explicit yes from whoever owns `advocate_db` before running outside a local dev copy.

## Done when

- `python manage.py migrate` runs clean on a copy of the AMS dev database — creates the `drf` schema and pgvector extension with no errors, and does not alter any existing `managed=False` table.
- `python manage.py check` passes with `drafting` installed.
- AMS's existing functionality is unaffected — spot-check: dev server starts, `/api/advocates/login` still works.

## Next phase

`02-auth-foundation.md`
