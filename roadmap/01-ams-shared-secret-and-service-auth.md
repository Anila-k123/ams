# 01 — AMS: Shared secret + service-token auth

**Codebase:** AMS backend, `Advocate-app-BE-Django/`
**Depends on:** nothing
**Read first:** `roadmap/00-README.md` (token contract)

## Goal
Give AMS a second, separate signing key for InstaDraft, helpers that create and verify the
cross-app tokens, and a DRF authentication class that accepts InstaDraft's service tokens.

## Context
- AMS auth today: `core/jwt.py` (`generate_token`, `decode_token`, HS256 with `SECRET_KEY`)
  and `core/auth.py` (`AdvocateJWTAuthentication`, which loads the `Advocate` row as `request.user`).
- Settings: `JWT_ALGORITHM` and `JWT_EXPIRATION` in the project `settings.py`; values come from
  `decouple.config(...)`.
- Practice scoping helper: `core/practice.py::practice_ids(user)`.

## Tasks
1. **Settings.** Add:
   ```python
   INSTADRAFT_SHARED_SECRET = config('INSTADRAFT_SHARED_SECRET', default='')
   INSTADRAFT_BASE_URL = config('INSTADRAFT_BASE_URL', default='http://localhost:5173')
   INSTADRAFT_LAUNCH_TTL = timedelta(minutes=2)
   ```
   Add both env keys (with example values) to `.env.example` if one exists.
2. **New module `core/instadraft_tokens.py`**:
   - `make_launch_token(advocate, case_id=None, task_id=None) -> str`: claims as in the README,
     `aud='instadraft-sso'`, TTL `INSTADRAFT_LAUNCH_TTL`, random `jti`.
   - `decode_service_token(token) -> dict`: verifies the signature with
     `INSTADRAFT_SHARED_SECRET` and requires `aud='ams-api'`, `exp`, `advocateId`.
   - If the secret is empty (integration disabled), raise a clear error.
3. **New auth class `core/auth.py::InstaDraftServiceAuthentication`**:
   - Reads `Authorization: Bearer <token>` and calls `decode_service_token`.
   - Loads the `Advocate` by `advocateId`. Rejects the token if the row is missing or inactive, or
     if the `email` claim doesn't match the row.
   - Returns `(advocate, payload)`, so existing permission/practice code works unchanged.
   - Do **not** add it to the global `DEFAULT_AUTHENTICATION_CLASSES`. Only the views in file 03 use it.
4. **Tests** (`core/tests/test_instadraft_tokens.py`): round trip; wrong `aud` rejected;
   expired token rejected; token signed with the main `SECRET_KEY` rejected.

## Done when
- The tests pass.
- A normal AMS login token is rejected where a service token is required, and vice versa.
