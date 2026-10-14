# SaaS tenancy (Phase 2)

AMS platform -> **Firm** (tenant) -> Team -> advocates / staff -> cases, clients, documents ...

## Model

| Table | What |
|---|---|
| `firm` (`firms.Firm`) | Permanent tenant identity: `public_id` (uuid), `name`, `slug`, `status` PROVISIONING / ACTIVE / SUSPENDED / CLOSED, `legacy_root_advocate_id` (migration trace). Exists independently of any person. |
| `firm_membership` | Identity (`core.Advocate` row) in a firm: `kind` STAFF / CLIENT, `status` INVITED / ACTIVE / SUSPENDED / LEFT, `team_root_id`, `is_default`, joined/left. Unique (firm, advocate); launch rule: one ACTIVE membership per identity (partial unique index - drop it to allow several firms per person). |
| `firm_settings` | Display name, address, contacts, GSTIN/PAN, logo, colours, timezone, currency, invoice prefix / FY reset, preferences. Seeded from the root advocate's office fields, which stay on `advocate`. |
| `firm_team` | Existing team table, now with `firm_id`. Teams restrict access inside a firm; they are never the tenant boundary. |
| `firm_id` columns | On clients, cases, case_events, documents, expenses, invoices, client_payments, audit_log, notification_queue, notifications, case_note, case_task, firm_billing_profile, invoice_request, and drafting client / project / template / sample / draft_session / library_clause / playbook. Child tables (case parties, tags, hearing details, document versions/summaries, client users, client handlers) inherit through their parent (`core/tenant.py INHERITED`). `advocate_id` keeps meaning "who created it". |

## Access rule

**Access = ACTIVE membership of an ACTIVE firm + firm ownership of the row + role permissions + team scope.**

The firm is never read from the request: it comes from the authenticated identity's membership (`core/tenant.py`):

- `firm_of(user)`, `resolve_firm(user)` (raises `FirmNotFound` / `TenantAccessDenied`), `validate_firm_membership(user, firm)`.
- `team_scope(user, firm)`: the team (or every team for firm-wide roles) limited to the firm's members; `practice_ids()` returns this in firm mode.
- `scoped(qs, firm)` / `owned(qs, user)`: firm ownership filter (`firm_id`, or the parent for inherited tables). Views wrap their practice-scoped querysets in `owned(...)`.
- On every save of a tenant model (`stamp_firm`, pre_save): a new row gets its creator's firm (else its parent's), and a row linking records of two firms (case of A with client of B, document on another firm's case, task on another firm's case, ...) raises `TenantAccessDenied` (answered 403 by the DRF exception handler). Bulk/raw inserts set `firm_id` explicitly (library clauses, backup restore).
- Authentication (firm mode): no ACTIVE membership, a suspended/left membership or a non-ACTIVE firm -> 401 on every request, so existing tokens stop at once.

## Modes (`TENANCY_MODE`)

| Mode | Behaviour |
|---|---|
| `legacy` (default) | Exactly the pre-Phase-2 practice/team scoping. Tenancy code is not consulted. |
| `shadow` | Legacy scoping enforced; the firm scope is computed alongside and differences logged to logger `core.tenant` (ids counts only) and classified: `expected_authorized` (a firm-wide role now sees its whole firm), `unexpected_expansion` (ERROR - blocks rollout), `unexpected_loss`, `ownership_anomaly` (lost ids belong to another firm or are unmapped). |
| `firm` | Firm boundary enforced. Needs memberships for every user who should keep access. |

`TENANCY_COLUMNS` says whether the database has the firm_id columns. The models declare them only when it is on (always in tests and makemigrations), so an unmigrated database keeps working. shadow/firm refuse to start without it.

## Firm-level roles (Phase 3)

- Templates: the original roles (`firm_id` NULL, `is_template`), never edited. Each firm: its own copy of every template (`provision_default_roles`), plus custom roles; same names allowed in different firms.
- Firm administrator = the firm's copy of Super Admin (`is_admin`); only it may grant / revoke HIGH_RISK permissions (ROLE_MANAGE, USER_MANAGE, BACKUP_MANAGE, FIRM_WIDE_SCOPE, SETTINGS_EDIT, INVOICE_ISSUE, AUDIT_VIEW) or the admin role; the last active admin can't be removed, demote themselves or be closed.
- Endpoints (same URLs, firm mode): `GET/POST /api/roles` (`?templates=1` lists templates; POST `{name, description, permissionIds}` or `{name, cloneFrom}`), `POST /api/roles/<id>/clone`, `GET/PUT/DELETE /api/roles/<id>` (PUT `disabled` to disable), `GET/PUT /api/roles/<id>/permissions`, `GET /api/roles/<id>/members`, `/api/admin/users/<id>/roles[/<roleId>]`. Another firm's role -> 404, a template -> 403 on writes.
- Migration: `firms/0004_firm_rbac` (columns + per-firm unique name index), then `apply_firm_roles --yes` (clones templates per firm, re-points members' assignments, aborts if any effective permission would change). Unresolved identities keep their template assignments.

## Migrating an existing database (isolated database first)

1. Verified backup + isolated restore (`docs/OPERATIONS.md`).
2. `python manage.py migrate` - creates firm tables and adds nullable `firm_id` columns + indexes (`firms/0002_tenancy`, `firms/0003_core_tenant_columns` for the Spring-era tables, `workspace/0013`, `invoices/0008`, `drafting/0012`). No data changes. Then `TENANCY_COLUMNS=True`.
3. Mapping file (ids only), reviewed and approved. **Account ids differ between developers' databases, so each developer drafts and approves their own:** `python manage.py plan_tenancy --suggest firms/tenancy_mapping.local.json` writes a draft (roots sharing a GSTIN / office name grouped; groups with data or a Super Admin become firms; everything else unresolved). Edit it; `tenancy_mapping.local*.json` is git-ignored. Unknown identities go in `unresolved` (a declared root covers its team); nothing is guessed. `firms/tenancy_mapping.example.json` shows the format.
4. `python manage.py plan_tenancy --mapping <file>` - read-only dry run: firms, staff, client logins (follow their client's firm), row counts per table, unresolved identities, cross-firm references, problems (exit 1).
5. `python manage.py apply_tenancy --mapping <file> --yes` - creates firms, settings, memberships, team links; fills `firm_id` only where NULL. One transaction, repeatable. **Refuses `PactPro_db`.**
6. `python manage.py verify_tenancy [--strict]` - read-only: multiple active memberships, rows whose firm differs from their creator's, parent/child rows in different firms, and the shadow comparison for every staff identity; unexpected privilege expansion fails it.
7. Run `TENANCY_MODE=shadow` and review the log, then `firm` - each only with approval.

Rollback: `TENANCY_MODE=legacy` (columns and tables are additive and unused in legacy); `migrate firms 0001` / app migrations reverse the schema; restore from the backup as last resort.

## Local database status (2026-10-13, developer machine)

- Backup `C:/AMS_Backups/daily/20261013_135126` verified (manifest, row/constraint snapshots, dump TOC; no test restore). All pending migrations applied; business row counts unchanged.
- Approved mapping (`firms/tenancy_mapping.local.json`, from `--suggest`): Firm A = root 1 (+26, 27); Firm B = roots 68, 70 (+69), client logins 77 (active), 78 (left). Unresolved (no membership, no login in firm mode): 4, 28, 36-42, 61.
- `apply_tenancy --allow-database PactPro_db`: 1,318 rows given a firm. Still unowned (expected): audit/notification rows of unresolved accounts, 12 library clauses with no source sample, 1 drafting client + 2 projects nothing uses.
- `verify_tenancy`: consistent, no errors. Shadow run: no unexpected expansion; unexpected loss only for the unresolved accounts.
- `.env`: `TENANCY_COLUMNS=True`, `TENANCY_MODE=firm`. Rollback: `TENANCY_MODE=legacy` (+ restart).
- Phase 3 (same day): backup `C:/AMS_Backups/daily/20261013_141132` verified; `firms.0004` applied; `apply_firm_roles`: 12 firm roles (6 per firm), 9 assignments re-pointed, 0 permission differences; all 8 members' permissions equal the Phase 0 snapshot and the pre-Phase-3 snapshot.
- Note: apply created `firm_team` rows, so even legacy mode now puts accountant 70 in Firm B's scope (the intended fix).

## Firm administration UI (Phase 6)

- `GET /api/firm/current` (any member): publicId, name, displayName, logoUrl, status - the shell shows the firm name and logo
  from it (`pages/Dashboard.tsx` -> `layout/Sidebar.tsx`; refreshed on the `firm-settings-changed` window event).
- `GET/PUT /api/firm/settings` (`SETTINGS_EDIT`): display name, address, contact, GSTIN / PAN (shared validators), invoice
  prefix and numbering, time zone, currency, date format, brand colour - stored in `firms.FirmSettings`.
  `POST/DELETE /api/firm/settings/logo`: PNG / JPEG / WebP only, at most 2 MB. Page: Firm Administration -> Firm Settings.
- `GET /api/firm/members` (`USER_MANAGE`): every membership (ACTIVE, INVITED, SUSPENDED, LEFT) with roles, admin flag and
  invitation status. Page: Firm Administration -> **Team Members** (`pages/UserManagement.tsx`; the separate Members & Invitations page was merged into it): the profile table (phone, Bar Council no., practice / team) with tabs Active / Invited / Suspended / Left / Invitations. New people are only **invited** by email (they set their own password; there is no admin-set password in the UI), with the firm's own enabled roles and optional practice; invitations show delivery status with Resend / Withdraw; Edit changes profile, practice and roles; Suspend / Reactivate / Remove with confirmation; the last active administrator can't be suspended, removed or lose the administrator role, and you can't suspend or remove yourself (the server enforces the same).
- `/api/permissions` marks each permission `highRisk` (server-owned `rbac/firm_roles.HIGH_RISK`); the Roles page reads it, there is no browser copy.
- Background jobs have no request: they use `core.tenant.firm_active(firm_id)` and `can_receive(advocate_id, firm_id)` (not left, ACTIVE membership of that ACTIVE firm) - see `docs/RELIABILITY.md`.
- Roles & Permissions shows the system templates (`/api/roles?templates=1`, read-only, "use as a starting point" clones),
  copy, who holds a role (`/api/roles/<id>/members`), disable / enable, and marks high-risk permissions
  (`rbac/firm_roles.HIGH_RISK`, mirrored in `RoleManagement.tsx`).

## Client portal logins (Phase 9 fix)

A portal login is an identity with a **CLIENT** membership of the client's firm (`clientaccess.views._client_membership`). Creating or re-enabling a login makes it ACTIVE; disabling it suspends the membership and ends the client's sessions. Before this fix, logins created after firm mode was switched on had no membership and could not sign in (`NO_ACTIVE_MEMBERSHIP`).

`POST /api/admin/users` (creating an account with a password set by an administrator) is disabled: it answers **410** with code `USE_INVITATION`. Team members join only through invitations and choose their own password. Listing (`GET`) and editing (`PUT /api/admin/users/<id>`) are unchanged.
