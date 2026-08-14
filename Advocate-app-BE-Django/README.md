# ⚖️ Advocate Management System — Django Backend

A **Django 5.1 + DRF** backend that is a drop-in replacement for the original Spring Boot
backend. It talks to the **same PostgreSQL database** (`advocate_db`) and reproduces the exact
REST API the React frontend expects, so the frontend runs unchanged.

## Status: core modules implemented

| Module | Endpoints | Status |
|--------|-----------|--------|
| Auth (advocates) | login, signup, logout, profile, settings, notification-settings, my-permissions, my-roles | ✅ |
| Profile | GET/PUT `/api/profile`, preferences, change-password | ✅ |
| RBAC | `/api/roles`, `/api/roles/{id}/permissions`, `/api/permissions` | ✅ |
| Clients | list (paged), my-clients, archived, search, create, update, delete (soft), restore | ✅ |
| Cases | list (paged), my-cases, search, create, update, delete (soft), restore | ✅ |
| Events | list, my-events, today, upcoming, create, delete | ✅ |
| Documents | list (paged), list, search, filter, stats, upload, download, preview, by-case, by-client, get/update/delete | ✅ |
| Dashboard | `GET /api/dashboard` (summary, charts, recents, hearings, real financials) | ✅ |
| Notifications | unread, all, mark-read | ✅ |
| Expenses | list (paged), my-expenses, by-case, search, today, monthly, create, update, delete | ✅ |
| Payments | list (paged), by-case, today, monthly, create | ✅ |
| Invoices | list (paged), my-invoices, summary, create, pay | ✅ |
| Tasks | list (paged), my-tasks, create, toggle, delete | ✅ |
| Global search | `/api/search`, `/api/search/global` (8 categories, Ctrl+K) | ✅ |
| Admin users | `/api/admin/users` CRUD + role assignment (USER_MANAGE) | ✅ |
| Profile branding | `POST /api/profile/branding/{type}`, `GET /api/profile/files/...` | ✅ |
| Reports (PDF) | `/api/reports/*` — cases, clients, expenses, invoice, receipt, client/case detail, monthly, filtered-expense, dashboard (ReportLab) | ✅ |
| Reports Center | `GET /api/reports-center`, `GET /api/reports-center/export/csv` | ✅ |
| Password reset | `/api/auth` forgot-password, verify-otp, reset-password (SHA-256+salt OTP, SMTP email) | ✅ |
| Audit log | `GET /api/audit` (paged + filters) | ✅ |
| Activity feed | `GET /api/activities`, `/api/activities/my-activities`, dashboard widget | ✅ |
| Backup & restore | `/api/backup/*` — quick/full/database/documents/reports/settings, validate, restore, history, stats, download, delete (ZIP + transactional restore) | ✅ |
| Communication | `/api/communication/*` (settings, templates CRUD, history, statistics, logs, queue, test, CSV) + `/api/whatsapp/*` (webhook, send-manual, resend) | ✅ |
| AI Assistant | `POST /api/assistant/query` — rule-based intent router (nav, summary, hearings, invoices, expenses, income, counts, search, create-modals) | ✅ |
| Real-time WebSockets | live push (bell/activity poll REST instead) | ⏳ deferred |

## Design notes

- **Database:** models are `managed=False` and map onto the existing tables — no migrations,
  existing data & accounts preserved.
- **Auth:** custom DRF JWT auth (`core/auth.py`). Tokens carry `sub` (email) + `exp` so the
  frontend's `jwt-decode` works. Passwords are verified/created with **BCrypt** (`core/passwords.py`)
  so existing Spring `$2a$` hashes keep working.
- **Permissions:** `core/permissions.RequirePermission('CODE')` reproduces Spring's
  `@RequirePermission` (resolved via advocate_roles → role_permissions → permissions).
- **Pagination:** `core/pagination.SpringStylePagination` returns `{content, totalElements,
  totalPages, ...}` with 0-indexed `page` / `size` params.
- **Documents:** files are read from / written to `../Advocate-app-BE-main/uploads/documents`
  (configurable via `DOCUMENT_UPLOAD_DIR`), so existing uploads download & preview.
- **Real-time:** Channels/ASGI is wired but WebSockets are deferred (same as the pact-pro-draft
  reference). The frontend's STOMP client degrades gracefully; the notification bell polls REST.

## Run

Prerequisites: Python 3.11, PostgreSQL running with `advocate_db` (user `postgres` / `psql_password`).

```bat
REM one-time
python -m venv venv
venv\Scripts\pip install -r requirements.txt

REM run (port 8080) — make sure the Spring backend is NOT running on 8080
run-django.bat
```

Then run the frontend as usual (`cd ../Advocate-app-FE-main && npm run dev`) and log in.

Config is read from `.env` (see `.env.example`).
