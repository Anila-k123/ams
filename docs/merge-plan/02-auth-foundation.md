# Phase 2 — Auth foundation

## Goal

Make drafting endpoints authenticate against AMS's real identity model — `core.models.Advocate`, via the existing `core.auth.AdvocateJWTAuthentication` — with no attempt to migrate InstaDraft's old `accounts_user` data, and no dependency on Django's own auth stack (which AMS doesn't use at all).

## Background

**This is not a Django `AUTH_USER_MODEL` swap** — correct an assumption from a discarded first pass of this plan. AMS has no `django.contrib.auth` in `INSTALLED_APPS`, no `AUTH_USER_MODEL` setting, and no `AbstractBaseUser`-based model. Authentication is entirely custom: `core.auth.AdvocateJWTAuthentication` (`core/auth.py:12-56`) decodes a hand-rolled PyJWT token (`core/jwt.py`, HS256, signed with AMS's `SECRET_KEY`, claims `sub`/`advocateId`/`email`, 24h lifetime, **no refresh token**) and sets `request.user` to a raw `core.models.Advocate` instance — a `managed=False` model mapping onto the Spring/Hibernate `advocate` table. Passwords are bcrypt (`core/passwords.py`), matching Spring's `BCryptPasswordEncoder`.

InstaDraft's own auth (`accounts.User`, simplejwt, email login, 1h/7d token pair) is retired entirely — not reconciled, not migrated.

## What happens

1. **Delete InstaDraft's `accounts` app outright** — don't copy `backend/accounts/` into AMS at all (Phase 01 already skipped it). No new user table, no simplejwt dependency for drafting.

2. **Every `drafting` model that references "the acting user"** — InstaDraft's `Sample.uploaded_by`, `DraftSession.created_by`, `DraftEdit.created_by`, `Playbook.created_by` — is rewritten to store `advocate_id` as a plain `BigIntegerField`, **not a Django FK object**, matching the exact convention AMS's own `workspace` app already uses for referencing the unmanaged `advocate`/`cases` tables (`workspace/models.py`'s documented reason: no DB-level FK constraint against a schema Django doesn't own/control). Where a "who is this" name/email is needed for display, look it up via `core.models.Advocate.objects.filter(id=advocate_id)` at read time — same pattern `workspace`/`documents` already use.

3. **Drafting's DRF views authenticate via `core.auth.AdvocateJWTAuthentication`**, not simplejwt's `JWTAuthentication`. Set this as the `DEFAULT_AUTHENTICATION_CLASSES` for the whole project (or explicitly on drafting's viewsets if AMS's other apps set it per-view — confirm AMS's actual `REST_FRAMEWORK` setting before assuming project-wide vs per-view). `request.user.id` gives the `advocate_id` to store on create.

4. **Write drafting's first migration fresh** against this state (may already be mostly done in Phase 01) — no swappable-model dance needed since drafting was never coupled to Django's auth machinery to begin with.

5. **Re-seed, don't migrate data.** Re-run InstaDraft's demo-seed management commands (`drafting/management/commands/seed_demo.py`, `seed_nda_template.py`, `load_legal_codes.py`) against the merged app, with `advocate_id` values pointing at real `Advocate` rows in the AMS dev/demo database (e.g. the existing demo accounts referenced in `roadmap/PROGRESS.md`, like "Rajesh"). Confirm no live production InstaDraft deployment exists elsewhere before assuming this is safe — nothing in either repo suggests one does.

6. **Note, don't build:** `Advocate` already has everything drafting needs (`email`, `full_name`) plus more (branding fields for later export work — signature/logo/seal paths, GST/PAN — already used by the now-being-retired `integrations` app's `InstaDraftMeView`, and reusable directly in Phase 07's branding step instead of over an API call).

## Files touched

- `Advocate-app-BE-Django/drafting/models.py`
- `Advocate-app-BE-Django/drafting/migrations/0001_initial.py`
- `Advocate-app-BE-Django/advocate_backend/settings.py` (`DEFAULT_AUTHENTICATION_CLASSES`, if project-wide)
- Demo-seed management commands (ported, adjusted to reference real `Advocate` ids)

## Risk/effort

**High risk, do first.** The risk is entirely in getting the "plain BigIntegerField, not a real FK" convention right and consistent with AMS's existing apps — get this wrong and drafting either can't be queried efficiently (no FK means no `select_related`) or ends up with a DB constraint AMS's own team doesn't want against a schema they don't control. Confirm the convention against a second real example (e.g. `documents/models.py`'s `DocumentVersion.uploaded_by_id`) before finalizing, not just `workspace`.

## Done when

- `python manage.py migrate` on a clean copy of the AMS dev DB creates `drafting`'s tables with `advocate_id`-style plain integer columns, no DB-level FK constraint into `advocate`/`cases`/`clients`.
- In a Django shell, using a real JWT issued by `/api/advocates/login`, a request to any drafting endpoint resolves `request.user` to the correct `Advocate` and a `Sample`/`DraftSession` can be created with that id.
- Demo-seed commands run successfully, producing drafting data attributable to real `Advocate` rows.
- No trace of `accounts` app, simplejwt, or InstaDraft's old JWT claim shape (`user_id`) remains anywhere in drafting's code.

## Next phase

`03-backend-api-parity.md`
