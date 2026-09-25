# Merge InstaDraft into AMS — one codebase

## Why this exists

The InstaDraft ↔ AMS integration was originally scoped as two separate apps talking over REST + SSO (see `roadmap/00-README.md` in this repo — that integration is **already fully built and tested**, per `roadmap/PROGRESS.md`, just not committed). Manager feedback: instead, merge InstaDraft directly into AMS as **one codebase**. Same use cases (a lawyer moves between case management and drafting without friction; a finished draft gets filed as a real AMS document), different mechanism — one process instead of two services trusting each other over a signed JWT.

Two real codebases were read directly to build this plan:
- **AMS** — `C:\Users\Sybrant\ams` (`Advocate-app-BE-Django` + `Advocate-app-FE-main`). Note: `Advocate-app-BE-main` is the **original Spring Boot backend**, not a second Django variant — its `uploads/` folder is still reused by the Django backend today (`DOCUMENT_UPLOAD_DIR`), and its Postgres database (`advocate_db`) is the *same* database the Django backend now runs against, mostly via `managed=False` models mirroring the Spring/Hibernate schema.
- **InstaDraft** — `C:\Users\Sybrant\Desktop\pact-pro-draft`.

## Decisions locked in with the user

1. **Merge target: the AMS repo becomes the merged codebase.** InstaDraft's `drafting` app and its frontend pages fold into `Advocate-app-BE-Django`/`Advocate-app-FE-main`.
2. **Auth: AMS's identity model is authoritative.** `core.models.Advocate` (the real advocate/firm record — bar council id, GST/PAN, branding paths, firm hierarchy via `parent_advocate_id`) replaces InstaDraft's own `accounts.User`, which is retired.
3. **UI: full unification onto PrimeReact** (InstaDraft's existing choice). AMS's frontend has **no** component library today (hand-rolled CSS, ~35 pages) — so this isn't "migrate AMS's investment away," it's "AMS's pages get rewritten either way; pick the library that's already proven in this exact React 19 stack and needs no new pages from InstaDraft."

## What's different from a first (discarded) pass of this plan

An earlier version of this plan was written against `C:\Users\Sybrant\Desktop\advocate` — a stale, unrelated copy. It is superseded (see `SUPERSEDED.md` left in that folder). Facts that actually matter, confirmed by reading the real repo:

- **AMS has no Django auth stack at all.** No `django.contrib.auth`, no `AUTH_USER_MODEL`. `request.user` is populated by a custom `core.auth.AdvocateJWTAuthentication` as a raw `core.models.Advocate` instance. JWT is hand-rolled `PyJWT` (not simplejwt), single 24h token, **no refresh token**, claims `sub`/`advocateId`/`email` (`core/jwt.py`). Passwords are bcrypt (`core/passwords.py`), not Django's hasher.
- **Most of AMS's core tables are `managed=False`**, mapping onto the *original Spring Boot app's* Hibernate-created schema in a bare `public` Postgres schema (`Advocate`, `Client`, `Case`, `CaseEvent`, `Document`, `Role`/`Permission`/`AdvocateRole`/`RolePermission`, etc. — all in `core/models.py`). AMS's own Django-managed apps (`workspace`, `documents`, `clientaccess`, etc.) that need to reference these **do not use real DB foreign keys** — they store `advocate_id`/`case_id` as plain `BigIntegerField`s, by explicit design (`workspace/models.py` docstring), to avoid DB constraints against a schema Django doesn't own. **Drafting's new models must follow this same convention**, not the real-FK approach the first (discarded) plan assumed.
- **RBAC is custom and table-driven** (`core.models.Role`/`Permission`/`AdvocateRole`/`RolePermission`, enforced via `core.permissions.RequirePermission('CODE')` per view) — not AMS's other repo's `HasActionPermission` global gate. Adding drafting permission codes means inserting rows into these tables, not editing a `VIEW_PERMS` dict.
- **No Celery/Redis in AMS** (same conclusion as before, still true) — `channels` is installed but only wired for parity/unused (in-memory layer). Async is still genuinely new infrastructure for this app.
- **The already-built `integrations` app is real and matches this repo exactly** (unlike the discarded pass, which assumed a fictional Spring-shaped API). It already does almost everything Phase 6 below needs — reusing its scoping/versioning logic, not its HTTP wire contract, is most of that phase's work.
- **AMS's frontend has zero UI library, is plain JS (no TypeScript), React 19, react-router v7, and has no single unified API client** (three different places define `API_BASE`, mixed `fetch`/`axios`, no refresh-token flow, auth state scattered across raw `localStorage` keys rather than one context). This is a bigger frontend rewrite than the discarded plan assumed, but symmetric in scope with InstaDraft's own migration, not lopsided.

## Phase index

| # | File | What |
|---|---|---|
| 01 | `01-repo-scaffolding.md` | Install `drafting` app skeleton in AMS backend + frontend folders in AMS frontend, migrating cleanly |
| 02 | `02-auth-foundation.md` | Retire InstaDraft's `accounts` app; drafting authenticates via `AdvocateJWTAuthentication` against `core.models.Advocate` |
| 03 | `03-backend-api-parity.md` | Port drafting ViewSets/actions; wire `Project`/case linkage via AMS's plain-BigIntegerField convention; add drafting RBAC permission codes |
| 04 | `04-frontend-unification.md` | One PrimeReact app: AMS's ~35 pages + InstaDraft's ~10 pages, one auth context, one API client |
| 05 | `05-newdraft-and-async-pipeline.md` | Rebuild NewDraft flow; introduce real Celery+Redis for sample ingestion/generation |
| 06 | `06-three-pane-editor.md` | Port `/draft/:sessionId` (TipTap core reused unmodified); close RBAC gap with real permission codes |
| 07 | `07-draft-to-document-integration.md` | Finalize-draft → real AMS `Document`/`DocumentVersion`, reusing `documents/storage.py`; delete the `integrations` app and `core/instadraft_tokens.py` |
| 08 | `08-cleanup-and-hardening.md` | Dead-code sweep, prod-readiness, full regression across both original feature sets |

Work proceeds phase-by-phase with a check-in after each file before starting the next, same convention as this repo's own `roadmap/` folder.
