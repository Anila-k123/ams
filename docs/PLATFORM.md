# Platform operators and firm onboarding (Phases 5-6)

## Who is who

| | Platform operator | Firm administrator |
|---|---|---|
| Works for | the company running AMS | one law firm |
| Identity | `platform_operator` (app `platform_admin`), not an advocate | an advocate with the firm's administrator role (clone of Super Admin) |
| Login | `POST /api/platform/auth/login` {email, password, otp} - MFA mandatory | `POST /api/advocates/login` |
| Token | audience `ams-platform`, `PLATFORM_TOKEN_MINUTES` (60) | audience `ams`, 8 h |
| Can see | firm metadata: name, slug, status, plan code, member counts, usage counts, invitations of firm administrators, platform audit | the firm's own data, by role and team |
| Can never see | cases, clients, documents, drafts, invoices, staff invitations | other firms |

A firm token is refused by `/api/platform/*` and a platform token by every firm endpoint.

## Operators (console only)

There is no default operator and no built-in password.

```
manage.py platform_operator create --email ops@company.com --role OWNER --name "..."
manage.py platform_operator set-password | reset-mfa | disable | enable --email ...
manage.py platform_operator list
```

Password: asked interactively (or `--password-env VAR`), at least 14 characters. The TOTP seed is stored **encrypted** (Fernet, `core/crypto.py`) with `PLATFORM_MFA_KEY` from `.env` - a key independent of `SECRET_KEY`; without it (or with the wrong one) `create` refuses and operator login answers 503 `MFA_UNAVAILABLE`. Generate one with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` and keep it with the backups: losing it means `reset-mfa` for every operator. `create` / `reset-mfa` print the TOTP secret and `otpauth://` URI once - add it to an authenticator app (`core/totp.py`, RFC 6238; a code is accepted once). Roles: OWNER (everything), SUPPORT (no firm creation), READONLY (read). Password change, MFA reset, disabling and logout end the operator's sessions.

## Provisioning a firm

`POST /api/platform/firms` {name, slug, adminEmail, adminName?, planCode?} with optional `Idempotency-Key` header (`firms/provisioning.py`, one transaction):

Firm (PROVISIONING) -> FirmSettings -> the firm's own default roles -> administrator identity (an existing AMS login is reused, never altered) + INVITED membership -> invitation for the firm's administrator role -> platform audit. The email (link `CLIENT_APP_URL/accept-invite?token=...`) is sent after commit. Same key + same payload returns the same firm; same key + different payload -> 409; duplicate slug -> 409.

The firm becomes **ACTIVE when its administrator accepts**. `POST /api/platform/firms/<publicId>/activate|suspend|reactivate`: activation needs an active administrator; suspension ends every member's sessions and blocks logins (data untouched); reactivation does not revive ended sessions. `GET .../usage` counts only; `GET .../invitations`, `POST .../invitations/<id>/resend|revoke` for administrator invitations; `GET /api/platform/audit`. `PATCH /api/platform/firms/<publicId>` {name, displayName, planCode, contact}. `POST /api/platform/firms` also takes `contact` {officeEmail, officePhone, officeAddress, city, state, country, pinCode, website}. `GET /api/platform/stats` (firms by status, created in 7 days, pending admin invitations, failed invitation emails, recent firms). `GET /api/platform/audit?firm=<publicId>&action=&operator=&success=true|false&limit=&before=` returns `{results, hasMore, nextBefore}` - newest first, at most 200 per page (default 50); pass `before=nextBefore` for older events. The Audit screen says whether older events exist and loads them on request. Firm detail includes contact, time zone, currency and `adminInvitation`. No deletion.

## Invitations (`firms/invitations.py`)

- 32-byte random token; only its SHA-256 is stored; never logged or audited.
- Valid `INVITATION_TTL_HOURS` (72), once; revocable; resend issues a new token.
- Delivery is recorded, never silent: after commit the email is sent with `fail_silently=False` and the invitation's `delivery_status` becomes SENT, FAILED, or CONSOLE (the console / file mail backend: printed on the server, not emailed) (`delivery_error` keeps the reason with the token redacted; `last_sent_at`). Operators and firm administrators see it and can resend.
- `GET /api/invitations/preview?token=` -> firm name, email, whether a password must be chosen. `POST /api/invitations/accept` {token, password, fullName?} -> `{accepted, email}`; it does **not** sign in - the page sends the person to `/login`, so every sign-in goes through the normal login checks. A link that can't be used answers 400 with `code` EXPIRED / REVOKED / ACCEPTED / INVALID (only the link holder learns which). Frontend page: `/accept-invite`.
- Acceptance locks the invitation row (two clicks -> one membership) and re-checks: firm not suspended/closed, roles still the firm's and enabled, one active membership per identity.
- New identity: chooses its password (rule in `core/validators.py`). Existing AMS login: must enter its **current** password - an invitation can never take over an account.

Staff (firm administrator, `USER_MANAGE`): `GET/POST /api/firm/invitations` {email, roleIds, fullName?, teamRootId?}, `POST /api/firm/invitations/<id>/resend|revoke`. Roles must be the firm's own; the escalation rules of firm roles apply (nobody grants what they don't hold; only an administrator hands out the administrator role).

Members: `POST /api/firm/members/<advocateId>/suspend|reactivate|end` - not yourself, never the last active administrator; suspending/ending ends that person's sessions; their work stays with the firm.

## Platform console (Phase 6, `src/platform/`)

Separate React module under `/platform/*` (lazy, outside the firm `ProtectedRoute`):

| Route | Needs | What |
|---|---|---|
| `/platform/login` | - | email, password, 6-digit authenticator code |
| `/platform/dashboard` | firm.read | figures from `/stats`, recent firms, recent events (audit.read) |
| `/platform/firms` | firm.read | search, status filter, plan, members, created |
| `/platform/firms/new` | firm.create | form with validation; one `Idempotency-Key` per form (a retry reuses it); result says *awaiting activation* and whether the invitation email went out |
| `/platform/firms/:id` | firm.read | identity, contact, members by status, plan (firm.update), usage counts, administrator invitation + resend (invite.manage), activate / reactivate, suspend with reason + confirmation (firm.lifecycle), the firm's platform audit |
| `/platform/audit` | audit.read | filter by action, operator, result |

Session separation: the operator token lives in **sessionStorage** (`amsPlatformToken`, `amsPlatformOperator`), sent only by
`platformApi` (`src/platform/api.ts`) to `/api/platform/`; a 401 clears only it. The firm token (localStorage `token`) is never
read or sent by the console, and the server refuses each token on the other API (audiences `ams` / `ams-platform`).
`PlatformRoute` sends anyone without an operator session - including a signed-in firm user - to `/platform/login`.

## Subscriptions (Phase 8)

Plans, entitlements, overrides and usage per firm: see `SUBSCRIPTIONS.md`. Changing a firm's subscription needs `subscription.manage` (OWNER) and a reason; `planCode` on the firm PATCH is refused (`USE_SUBSCRIPTION`). Plans themselves (Platform -> Plans, `/platform/plans`) are approved, published, retired and revised only with `plan.publish` (OWNER), each step in the platform audit. New firms: `planCode` must be a published plan; without one the firm starts **plan pending**. `testFirm: true` (synthetic firms on development / test installs with `SUBSCRIPTION_TEST_PLANS`) unlocks draft plans.

## Later phases

Firm.`plan_code` is stored for Phase 8 (subscriptions); nothing enforces it.
