# Phase 0 safety baseline

Recorded 2026-10-13, branch `phase0-safety-baseline`, before any schema change, security refactor or SaaS migration. Counts and ids only: the full inventory (with names and emails) is kept outside the repository in `C:\AMS_Baseline\2026-10-13\` and must never be committed.

How to reproduce: `python manage.py baseline_inventory --out <folder>` (read-only, see `docs/OPERATIONS.md`).

## Test and check baseline

| Check | Result |
|---|---|
| `manage.py check` | no issues |
| `manage.py test` | **372 tests, OK** (77 s). One test reaches the court scraper on `localhost:8000` (404 logged, test still passes); CI points it at a dead port |
| `manage.py makemigrations --check` | **pending model change:** `acts.ActPaper` (unmanaged model, no migration) |
| `manage.py showmigrations` | **8 drafting migrations not applied to `PactPro_db`**: 0004_draft_version … 0011_merge (see drift) |
| `manage.py check --deploy` (current `.env`) | W002 (no X-Frame middleware), W003 (no CSRF middleware), W004 (no HSTS), W008 (no SSL redirect), W009 (insecure SECRET_KEY), W018 (DEBUG on) |
| `npm run lint --max-warnings 0` | 0 errors, 0 warnings |
| `npx tsc --noEmit -p tsconfig.app.json` | 0 errors |
| `npm run build` | OK (17 s); largest chunks: DraftPage 568 kB, recharts 404 kB, index 395 kB, jspdf 386 kB |
| `npm audit --omit=dev` | 8 vulnerabilities: 1 critical (jspdf), 3 high, 4 moderate |

## Database server

- PostgreSQL 18.1 (Windows). Databases on the server: `PactPro_db` (94 MB), `leaserush`, `esg_db`, `esg_dbb`, `postgres`.
- One login role: `postgres` (superuser), used by AMS. Other applications on the server can therefore write to `PactPro_db`; not yet verified that none does.
- `pactpro_db1` (the dev instance in `run-dev.bat`) does not exist. The pre-merge databases `advocate_db` and `pactpro`, which `docs/OPERATIONS.md` says were kept as backups, are no longer on this server.
- Schema: 77 tables (public + drf), 58 foreign keys, 37 unique constraints, 11 check constraints, 295 indexes.

## Schema / model drift

| Model | Problem |
|---|---|
| drafting.DraftVersion, DraftReviewRequest, DraftReviewRound, DraftChangeDecision, DraftComment | table missing in `PactPro_db` (migrations 0004–0011 not applied): draft versions, review rounds, Import changes and comments cannot work against this database |
| acts.ActPaper | model without migration (unmanaged; table exists) |

## Practice roots (firm-mapping input)

18 advocate rows, 12 practice roots (`parent_advocate_id IS NULL`), `firm_team` empty.

| Root | Kind | Members | Data (cases / clients / docs / invoices) | Signal | Proposed |
|---|---|---|---|---|---|
| 1 | staff (Super Admin) | 2 | 16 / 1 / 4 / 2 (+130 hearings) | – | new firm? (confirm) |
| 68 | staff (Super Admin) | 1 | 9 / 9 / 7 / 5, drafting data | same GSTIN and office name as root 70 | new firm? (confirm) |
| 70 | staff (Accountant) | 0 | none | same GSTIN and office name as 68 | likely belongs to 68's firm |
| 41 | staff (Accountant) | 0 | none | – | decide (which firm does this accountant serve?) |
| 36 | staff (Senior) | 2 | none | – | new firm or team of another firm |
| 37 | staff (Senior) | 1 | none | – | new firm or team of another firm |
| 4, 28, 61 | staff (Senior) | 0 | none | – | unused / team of another firm |
| 42 | staff (Receptionist) | 0 | none, never active | – | decide |
| 77, 78 | client-portal logins | – | – | – | not firms (78 has left) |

Observation: the two Accountants (41, 70) are practice roots of their own. Their firm-wide scope therefore covers only themselves, so today they see no cases or invoices of the advocates they are meant to serve.

The mapping is a proposal only; it needs separate approval before any firm is created.

## Roles and permissions

| Role (id) | Permissions | Holders (active) | Roots using it |
|---|---|---|---|
| Super Admin (1) | 43 | 4 (4) | 1, 68 |
| Senior Advocate (2) | 36 | 8 (8) | 1, 4, 28, 36, 37, 61, 68 |
| Junior Advocate (3) | 19 | 3 (3) | 36, 37, 68 |
| Accountant (4) | 15 | 2 (2) | 41, 70 |
| Receptionist (5) | 9 | 1 (1) | 42 |
| Intern (6) | 8 | 1 (1) | 36 |
| Client (11) | 0 | 2 (1) | 77, 78 |

- 43 permission codes. Users without any role: 0. Users with `FIRM_WIDE_SCOPE`: 7.
- Receptionist: one active holder (root 42), no data, no recorded activity. Kept; decision deferred.
- In DB but not referenced in code: `PAYMENT_EDIT`, `PROFILE_EDIT`, `TASK_DELETE`.
- Effective-permission snapshot per user: `effective_permissions_snapshot.json` in the inventory folder (baseline for the Phase 3 preservation test).
- The role rename `Junior Advocate` → `Advocate` (`manage.py rename_junior_role`) has not been applied to this database; code and seed commands use the new name.

## Missing permissions

| Code | Used by | Today without it |
|---|---|---|
| `INVOICE_ISSUE` | `invoices/views.py` (create, issue request, return request), `notifications/internal_events.py`, frontend `CaseDetail.tsx`, `InvoicesPanel.tsx` | nobody can issue an invoice or an advocate-raised request; "invoice raised" alerts reach nobody |
| `CASE_ALERTS` | `core/practice.py` (alert recipients) | falls back to `CASE_VIEW`, so Accountants also receive hearing / cause-list alerts |

`seed_invoice_permissions` would also remove `INVOICE_ISSUE`, `PAYMENT_CREATE`, `INVOICE_EDIT` from Senior Advocate (deliberate design, FEATURES.md §9) and grant to role `Advocate` (exists only after `rename_junior_role`). Neither seed command may run until the exact grants are approved.

## Ownership anomalies

| Check | Result |
|---|---|
| owner ids pointing at no advocate | none |
| dangling / multi-level `parent_advocate_id` | none |
| case children owned by another root than the case | none |
| cases whose client belongs to another root | none |
| client-portal logins linked across roots | none |
| drafting templates / playbooks without owner | none |
| **drafting library clauses** | 85 active, shared by every firm: 73 come from root 68's samples, 12 have no source |
| documents whose file is missing on this server | 10 of 11 (paths point at `C:\Users\Sybrant\ams\...`, another machine) |
| document versions with foreign paths | 2 |
| files in the upload folder with no document row | 3 |
| branding images referenced | logo 1, photo 3, **signature 2, seal 1** (served without login) |
| invoice numbers | 7 invoices, formats `INV-999999` (5) and `INV-HCL-999` (2); financial years 2019-20, 2022-23, 2026-27; no duplicates within a root |
| emails used by both a staff and a client login | 0 |

## Backups

Implemented (`scripts/backup_db.ps1`, `restore_verify.ps1`), dry-run tested. Not yet run: needs an approved backup location off the system disk (this machine has only `C:`), a PostgreSQL password file, and approval to create `pactpro_restore_check`.

| Date | Backup | Restore check | Notes |
|---|---|---|---|
| – | – | – | first run pending approval |

## Isolated development / test environment (to set up in a later, approved step)

1. Restore the latest verified backup into a new database (for example `pactpro_dev`) with `pg_restore --no-owner`, never touching `PactPro_db`.
2. Create a dedicated non-superuser role for it (`ams_dev`) owning only that database.
3. Copy the uploads backup to a separate folder and point `DOCUMENT_UPLOAD_DIR` / `DRAFTING_MEDIA_ROOT` there.
4. Point `run-dev.bat`'s `.env` (ports 8081/5174) at it, with email to the console and no production AI keys.
5. Optionally anonymise personal data (names, phones, emails) before developers use it.
