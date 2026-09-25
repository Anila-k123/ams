# 04 — InstaDraft: SSO login from AMS

**Codebase:** InstaDraft (Django + DRF + simplejwt backend, Vite React TS frontend)
**Depends on:** AMS files 01 and 02 (the launch token exists)
**Read first:** `roadmap/00-README.md` (token contract)

## Context (InstaDraft today)
- Login: `POST /api/auth/login/` returns a simplejwt access token (1h) and refresh token (7d). `GET /api/auth/me/` returns the current user.
- User: custom `AbstractBaseUser` in `accounts/models.py`, table `accounts_user`, logs in by `email`.
- The frontend stores `access_token` in localStorage. `RequireAuth` is in `App.tsx`. The API client
  is `frontend/src/api/client.ts` (auto-refreshes on 401).

## Backend
1. Settings: add `AMS_SHARED_SECRET = env('INSTADRAFT_SHARED_SECRET')` and `AMS_API_URL`
   (e.g. `http://localhost:8000/api`). Add both to `.env.example`.
2. Migration: add `ams_advocate_id = BigIntegerField(null=True, unique=True)` to `User`.
3. New table `accounts.UsedLaunchToken(jti unique, used_at)`, so each launch token works only once.
4. `POST /api/auth/sso/` (AllowAny), body `{ token }`:
   - Verify HS256 with `AMS_SHARED_SECRET`, requiring `aud='instadraft-sso'`, `exp` and `jti`.
   - Reject a reused `jti` (401).
   - Find the user by `ams_advocate_id`. Otherwise find them by `email` (and set `ams_advocate_id`).
     Otherwise create one (`email`, `full_name` from the AMS `me` endpoint if available, unusable password).
   - Issue a simplejwt pair with `RefreshToken.for_user(user)`.
   - Return `{ access, refresh, user, context: { caseId, taskId } }`.
5. Tests: new user provisioned; existing user matched by email; reused token; bad `aud`;
   expired token.

## Frontend
1. Add a `/sso` route (outside `RequireAuth`). It reads `token` from the query string, POSTs it to
   `/api/auth/sso/`, stores the tokens exactly as normal login does, then calls `history.replace`
   (which removes the token from the URL):
   - `context.caseId` present → `/draft/new?amsCaseId=<id>&amsTaskId=<id?>`
   - otherwise → `/dashboard`
2. Error screen: "Link expired — go back to AMS and click the button again."
3. If someone else is already logged in, log them out first, then continue.

## Done when
- The AMS direct button opens the InstaDraft dashboard, logged in as that advocate, with no password asked.
- Opening the same `/sso?token=...` link a second time fails (single use).
