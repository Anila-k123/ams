# AUDIT_ams — Advocate Management System (Django Backend)

**Repo sub-path audited:** `Advocate-app-BE-Django/`
**Audit date:** 2026-09-08 (re-audit; supersedes the 2026-08-04 revision)

> Re-check notes: since the previous revision the project gained two apps
> (`courtsearch`, `acts`), an audit-logging middleware, an OpenAI-compatible LLM
> assistant, a background scheduler, a shared-practice / team model
> (`Advocate.parent_advocate_id`, `left_on`), cross-team case transfer, and a
> (still-disabled) WebSocket path on the frontend. The database was reachable
> this time, so §9 now contains real numbers. Sections rewritten accordingly.

---

## 1. Identity and auth (highest priority)

### AUTH_USER_MODEL

`AUTH_USER_MODEL` is **not set** in `advocate_backend/settings.py`. Django's built-in
auth framework (`django.contrib.auth`) is **not installed** (absent from
`INSTALLED_APPS`). There is no Django auth user model.

The "user" is `core.models.Advocate`, a plain `models.Model` (not `AbstractUser` /
`AbstractBaseUser`). It maps onto an existing PostgreSQL table (`advocate`) whose
schema originates from the sibling Spring/Hibernate backend; `managed = False`.

### User model — verbatim source (`core/models.py`)

```python
class Advocate(models.Model):
    id = models.BigAutoField(primary_key=True)
    full_name = models.CharField(max_length=255)
    email = models.CharField(max_length=255, unique=True)
    password = models.CharField(max_length=255)
    bar_council_id = models.CharField(max_length=255, unique=True)
    phone = models.CharField(max_length=255, null=True, blank=True)
    specialization = models.CharField(max_length=255, null=True, blank=True)
    experience = models.IntegerField(default=0)
    address = models.CharField(max_length=255, null=True, blank=True)
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=255, null=True, blank=True)
    enrollment_date = models.DateField(null=True, blank=True)
    bio = models.CharField(max_length=255, null=True, blank=True)
    office_name = models.CharField(max_length=255, null=True, blank=True)
    office_address = models.CharField(max_length=255, null=True, blank=True)
    city = models.CharField(max_length=255, null=True, blank=True)
    state = models.CharField(max_length=255, null=True, blank=True)
    country = models.CharField(max_length=255, null=True, blank=True)
    pin_code = models.CharField(max_length=255, null=True, blank=True)
    office_phone = models.CharField(max_length=255, null=True, blank=True)
    office_email = models.CharField(max_length=255, null=True, blank=True)
    website = models.CharField(max_length=255, null=True, blank=True)
    gst_number = models.CharField(max_length=255, null=True, blank=True)
    pan_number = models.CharField(max_length=255, null=True, blank=True)
    profile_photo_path = models.CharField(max_length=255, null=True, blank=True)
    office_logo_path = models.CharField(max_length=255, null=True, blank=True)
    signature_path = models.CharField(max_length=255, null=True, blank=True)
    office_seal_path = models.CharField(max_length=255, null=True, blank=True)
    primary_brand_color = models.CharField(max_length=255, null=True, blank=True)
    secondary_brand_color = models.CharField(max_length=255, null=True, blank=True)
    language = models.CharField(max_length=255, null=True, blank=True)
    time_zone = models.CharField(max_length=255, null=True, blank=True)
    currency = models.CharField(max_length=255, null=True, blank=True)
    date_format = models.CharField(max_length=255, null=True, blank=True)
    auto_logout_duration = models.IntegerField(null=True, blank=True)
    default_dashboard_filter = models.CharField(max_length=255, null=True, blank=True)
    role = models.CharField(max_length=255, default='ADVOCATE')
    theme = models.CharField(max_length=255, default='light')
    whatsapp_enabled = models.BooleanField(default=False)
    email_notifications_enabled = models.BooleanField(default=False)
    browser_notifications_enabled = models.BooleanField(default=True)
```

> **NOTE — verify verbatim before integration.** The live `advocate` table has two
> columns the previously-quoted class body did NOT include:
> `parent_advocate_id` and `left_on` (confirmed via `information_schema` this
> audit — see §9 and §6). These back the shared-practice hierarchy and the
> soft-departure flag. The exact field declarations in `core/models.py` for these
> two columns were not re-quoted verbatim here — `UNKNOWN: exact declaration of
> Advocate.parent_advocate_id / Advocate.left_on`; a human should confirm the
> field types (the migration `core/enable_shared_practice.py` adds
> `parent_advocate_id`; `core/auth.py` reads `left_on`).

Compatibility shims on the class (`is_authenticated` → True, `is_anonymous` → False,
`permission_codes()`, `role_names()`) are unchanged from the prior revision and
resolve permissions through `advocate_roles → role_permissions → permissions`.
No custom manager; default `objects`.

### Organisation / firm / tenant / practice model

There is **no dedicated org/firm table.** The tenancy unit is now a **shared
practice (team)** expressed on the user model itself:

- `Advocate.parent_advocate_id` (self-referential bare `BigIntegerField`) — a member
  advocate points at the practice **head**. A NULL parent = a practice root / solo.
- `Advocate.left_on` — soft-departure timestamp; a non-NULL value means the advocate
  has left the practice (their work is retained, their tokens are rejected at auth).
- `core/practice.py` is the scoping core: `practice_ids(user)` restricts queries to
  `advocate_id IN <practice>`; `FIRM_WIDE_PERMISSION = 'FIRM_WIDE_SCOPE'` and
  `FIRM_WIDE_ROLES = {Super Admin, Accountant, Receptionist}` widen scope to the
  whole firm. Helpers: `practice_root`, `members`, `is_owner`, `has_left`,
  `mark_left`, `reinstate`, `alert_members`, `firm_wide_members`.

This is a one-level hierarchy (members report to a head), not arbitrary nesting.
The prior audit's "single-tenant / solo practitioner" description is **no longer
accurate.**

### FK / OneToOne / M2M relationships to the Advocate model

Real relational `ForeignKey` to `core.Advocate` (all in `core/models.py`,
`on_delete=DO_NOTHING`, `db_column='advocate_id'`, all `managed=False`):

| File | Model | Field | on_delete | null | blank |
|------|-------|-------|-----------|------|-------|
| `core/models.py` | `Client` | `advocate` | `DO_NOTHING` | True | True |
| `core/models.py` | `Case` | `advocate` | `DO_NOTHING` | False | — |
| `core/models.py` | `CaseEvent` | `advocate` | `DO_NOTHING` | False | False |
| `core/models.py` | `Document` | `advocate` | `DO_NOTHING` | False | False |
| `core/models.py` | `Expense` | `advocate` | `DO_NOTHING` | False | False |
| `core/models.py` | `Invoice` | `advocate` | `DO_NOTHING` | False | False |
| `core/models.py` | `ClientPayment` | `advocate` | `DO_NOTHING` | True | True |

(Prior revision also listed `Task` here; `Task` in current `core/models.py` uses a
bare `advocate_id` integer — see below. `UNKNOWN`: whether a relational FK still
exists on `Task`; treat as bare-int.)

**No `OneToOneField` or `ManyToManyField` to Advocate anywhere.**

Bare-integer `advocate_id` (plain `BigIntegerField`, no DB-level FK):

| App / file | Models |
|------------|--------|
| `core/models.py` | `AdvocateRole`, `RolePermission`, `PasswordResetOtp`, `AuditLog`, `Activity`, `CommunicationSettings`, `NotificationTemplate`, `NotificationHistory`, `NotificationLog`, `NotificationQueue`, `BackupHistory`, `Notification`, `Task` |
| `core/models.py` | `Advocate.parent_advocate_id` (self-referential bare int) |
| `acts/models.py` | `ActCaseLink.advocate_id` |
| `courtsearch/models.py` | `ImportedCaseRecord.advocate_id` |
| `workspace/models.py` | `CaseNote`, `CaseTag`, `CaseTask`, `CaseTaskDocument`, `CaseParty`, `RelatedCase`, `HearingDetail` (all `advocate_id`, mostly `db_index=True`) |
| `appeals/models.py` | `AppealDetection.advocate_id` (`db_index=True`) |

### AUTHENTICATION_BACKENDS

Not set. `django.contrib.auth` is not installed; the built-in `ModelBackend` is
irrelevant. Authentication is entirely the custom DRF class below.

### PASSWORD_HASHERS

Not set. Passwords are **bcrypt** (`rounds=10`) created/verified directly via the
`bcrypt` library in `core/passwords.py` (`hash_password` / `verify_password`),
kept compatible with Spring's `BCryptPasswordEncoder` (`$2a$10$…` hashes). No
Django PBKDF2 path.

### Client authentication mechanism

Custom HS256 JWT (**not** DRF SimpleJWT — that package is installed but unused).

1. `POST /api/advocates/login` (AllowAny) — `accounts/views.py` `LoginView` looks up
   `Advocate` by email, `verify_password(raw, hash)`, then `generate_token(advocate)`.
2. Subsequent requests send `Authorization: Bearer <token>`.
3. `core.auth.AdvocateJWTAuthentication` decodes, loads `Advocate` by `advocateId`
   (fallback `email`), **rejects the token if `left_on is not None`** (departed
   advocate), and caches `advocate.permission_codes()` on
   `request._advocate_permissions`.
4. `core/jwt.py`: claims `sub` (email), `advocateId`, `email`, `iat`, `exp`.
   Signed with `settings.SECRET_KEY`, `settings.JWT_ALGORITHM` (`'HS256'`).
5. Expiry: `settings.JWT_EXPIRATION` = `timedelta(milliseconds=JWT_EXPIRATION_MS)`,
   default 86400000 ms (24 h). **No refresh endpoint exists** — single long-lived
   token.

Session cookies are not used (`django.contrib.sessions` absent).

**Auth / account endpoints:**

| Method | Path | Auth |
|--------|------|------|
| POST | `/api/advocates/login` | No (AllowAny) |
| POST | `/api/advocates/signup` | No (AllowAny) — **gated off by default**, see `ALLOW_PUBLIC_SIGNUP` |
| POST | `/api/advocates/logout` | Yes (stateless; no blacklist) |
| POST | `/api/forgot-password` | No (deferred OTP stub, `accounts/urls_auth.py`) |

No OAuth. No refresh route.

### Custom permission classes / role logic

- `core/permissions.py` — `RequirePermission(*codes, require_all=False)` factory
  returning a DRF `BasePermission`. Requires authentication first; **no codes =
  "any signed-in advocate."** OR semantics by default; `require_all=True` = AND.
  Checks against `request._advocate_permissions`.
- `rbac/views.py` + `rbac/urls.py` — role/permission catalogue and admin user
  management, guarded by `RequirePermission('ROLE_MANAGE')` / `'USER_MANAGE'`.
  User create/edit sets `parent_advocate_id` via `_resolve_practice_owner`.
- `core/practice.py` — practice/firm-wide scoping (see §1 org model).
- `cases/views.py` — `TransferCaseView` (`/api/cases/transfer/<pk>`) and
  `TransferTargetsView` (`/api/cases/transfer-targets`): within-practice transfer =
  owner change; **cross-team transfer** (senior → another senior) re-owns the case,
  its children and a copy of the client, restricted to a practice owner.
- Global DRF default permission is `IsAuthenticated`
  (`UNAUTHENTICATED_USER = None`).

### Hardcoded integer-ID assumptions

`Advocate.id` is `BigAutoField` (BIGINT), matching Spring. All `advocate_id`
filters and the `advocateId` JWT claim use bare integer comparisons.
`parent_advocate_id` and every child `advocate_id` are bare BIGINTs too. There is
no UUID identity. A merge with a UUID-keyed user system would require reworking the
JWT payload, the auth lookup, and every scoping filter.

---

## 2. Configuration

### Settings module directory listing

```
advocate_backend/
├── __init__.py
├── asgi.py
├── settings.py          ← single file, production entry point
├── urls.py
└── wsgi.py
```

One settings file, no dev/prod split. Production entry point is
`advocate_backend.settings` (referenced by `wsgi.py` and `asgi.py`).

### INSTALLED_APPS (verbatim, annotated)

```python
INSTALLED_APPS = [
    'django.contrib.contenttypes',    # [django]
    'django.contrib.staticfiles',     # [django]
    # Third-party
    'rest_framework',                 # [third-party]
    'corsheaders',                    # [third-party]
    'channels',                       # [third-party]
    # Local
    'core',                           # [first-party] ⚠️ COLLISION-RISK
    'accounts',                       # [first-party]
    'clients',                        # [first-party]
    'cases',                          # [first-party]
    'events',                         # [first-party]
    'documents',                      # [first-party] ⚠️ COLLISION-RISK
    'dashboard',                      # [first-party]
    'notifications',                  # [first-party]
    'rbac',                           # [first-party]
    'expenses',                       # [first-party]
    'invoices',                       # [first-party]
    'payments',                       # [first-party]
    'search',                         # [first-party] ⚠️ COLLISION-RISK
    'reports',                        # [first-party]
    'audit',                          # [first-party]
    'backup',                         # [first-party]
    'communication',                  # [first-party]
    'assistant',                      # [first-party]
    'appeals',                        # [first-party]
    'workspace',                      # [first-party]
    'courtsearch',                    # [first-party]  (new)
    'acts',                           # [first-party]  (new)
]
```

(Note: `tasks` is no longer a separate app — its endpoints are served elsewhere;
the `tasks` DB table remains, mapped by `core.Task`.) Notable absences:
`django.contrib.admin`, `django.contrib.auth`, `django.contrib.sessions`,
`django.contrib.messages`.

### App labels and collision risk

All apps use the default `app_label` (directory name); no `apps.py` overrides.
Labels likely to collide with sibling projects:

| Label | Risk |
|-------|------|
| `core` | HIGH |
| `search` | HIGH |
| `documents` | MEDIUM |
| `notifications`, `dashboard`, `reports`, `audit`, `payments`, `acts` | MEDIUM |

### MIDDLEWARE (verbatim)

```python
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',     # [django]
    'corsheaders.middleware.CorsMiddleware',             # [third-party]
    'django.middleware.common.CommonMiddleware',         # [django]
    'core.audit_middleware.AuditLogMiddleware',          # [first-party]
]
```

**First-party middleware:** `core/audit_middleware.py` `AuditLogMiddleware` — records
every state-changing request (POST/PUT/PATCH/DELETE under `/api/`, skipping auth
paths) into `audit_log` + a human-readable `activities` row; captures method, path,
status, actor email, IP (`X-Forwarded-For`), user agent, and field-level before/after
diffs (`core/audit_diff.py`). **Never records request bodies** (passwords/OTPs).
Audit failures never break the underlying request. No session/auth/CSRF middleware.

### Root urls.py (verbatim)

```python
"""Root URL config. Every app carries its full resource segment under /api/ so the
paths match the frontend EXACTLY, including bare collection paths with no trailing
slash (e.g. GET /api/clients).
"""

from django.urls import path, include
from core.views import health

urlpatterns = [
    path('api/health', health),
    path('api/', include('accounts.urls')),
    path('api/', include('clients.urls')),
    path('api/', include('cases.urls')),
    path('api/', include('events.urls')),
    path('api/', include('documents.urls')),
    path('api/', include('dashboard.urls')),
    path('api/', include('notifications.urls')),
    path('api/', include('rbac.urls')),
    path('api/', include('expenses.urls')),
    path('api/', include('invoices.urls')),
    path('api/', include('payments.urls')),
    path('api/', include('search.urls')),
    path('api/', include('reports.urls')),
    path('api/', include('audit.urls')),
    path('api/', include('backup.urls')),
    path('api/', include('communication.urls')),
    path('api/', include('assistant.urls')),
    path('api/', include('appeals.urls')),
    path('api/', include('workspace.urls')),
    path('api/', include('courtsearch.urls')),
    path('api/', include('acts.urls')),
]
```

All apps share the `/api/` prefix. No version prefix. Every included app claims
resource segments directly under `/api/` (e.g. `/api/clients`, `/api/cases`,
`/api/courtsearch/...`, `/api/acts`, `/api/assistant/...`).

### MIDDLEWARE-adjacent settings

```python
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost,127.0.0.1', cast=Csv())

CORS_ALLOWED_ORIGINS = config(
    'CORS_ORIGINS',
    default='http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174',
    cast=Csv(),
)
CORS_ALLOW_CREDENTIALS = True

# CSRF: CsrfViewMiddleware NOT installed → CSRF protection absent (pure JWT API).
# SESSION_*: django.contrib.sessions NOT installed → no session settings.

STATIC_URL = '/static/'
# STATIC_ROOT / MEDIA_URL / MEDIA_ROOT / DEFAULT_FILE_STORAGE: not set.
DATA_UPLOAD_MAX_MEMORY_SIZE  = 52428800   # ~50 MB
FILE_UPLOAD_MAX_MEMORY_SIZE  = 26214400   # ~25 MB per file (matches Spring)
```

Document uploads use `DOCUMENT_UPLOAD_DIR` (default
`BASE_DIR.parent / 'Advocate-app-BE-main' / 'uploads'`), not Django's media
framework. Court PDFs cache under `COURT_PDF_CACHE_DIR`
(default `BASE_DIR / 'court_pdf_cache'`).

Other integration-relevant settings: `EMAIL_BACKEND` selectable via `MAIL_BACKEND`
(default real SMTP; console backend for local), `EMAIL_CONFIGURED` guard,
`ALLOW_PUBLIC_SIGNUP` (default False), `WHATSAPP_ENABLED` (default False),
`TEST_RUNNER = 'core.test_runner.ManagedModelTestRunner'`, `USE_TZ = False`.

### Environment variables read (names only, values `<redacted>`)

From `settings.py`, `assistant/llm.py`, `courtsearch/client.py`, `.env`:

`SECRET_KEY`, `DEBUG`, `ALLOWED_HOSTS`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`,
`DB_HOST`, `DB_PORT`, `JWT_EXPIRATION_MS`, `CORS_ORIGINS`, `DOCUMENT_UPLOAD_DIR`,
`COURT_PDF_CACHE_DIR`, `MAIL_BACKEND`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USE_TLS`,
`MAIL_USERNAME`, `MAIL_PASSWORD`, `MAIL_TIMEOUT`, `NOTIFICATION_SENDER_NAME`,
`OTP_SALT`, `OTP_EXPIRY_MINUTES`, `OTP_RATE_LIMIT`, `WHATSAPP_ENABLED`,
`WHATSAPP_VERIFY_TOKEN`, `ALLOW_PUBLIC_SIGNUP`, `TIME_ZONE`,
`LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`, `LLM_OPENAI_PATH`,
`LLM_TEMPERATURE`, `LLM_TIMEOUT`, `GEMINI_API_KEY`, `GEMINI_MODEL`,
`GEMINI_BASE_URL`, `COURT_API_BASE`, `COURT_API_SEARCH_TIMEOUT`,
`COURT_API_LIST_TIMEOUT`, `COURT_API_CAUSELIST_TIMEOUT`, `COURT_API_SCI_TIMEOUT`,
`COURT_API_DISTRICT_CAUSELIST_TIMEOUT`, `DJANGO_SETTINGS_MODULE`.

A `.env` file **is present** in `Advocate-app-BE-Django/` (gitignored). Its keys
were read for names only; **no values are reproduced here.**

---

## 3. Versions and dependencies

### Installed versions — from `venv` `pip freeze` (not memory)

| Package | Version |
|---------|---------|
| Python | 3.11.0 |
| Django | 5.1.15 |
| djangorestframework | 3.15.2 |
| djangorestframework-simplejwt | 5.3.1 (installed, **unused** in settings) |
| psycopg2-binary | 2.9.12 |
| PyJWT | 2.13.0 |
| bcrypt | 4.2.1 |
| channels | 4.1.0 |
| django-cors-headers | 4.4.0 |
| python-decouple | 3.8 |
| requests | 2.34.2 |
| beautifulsoup4 | 4.15.0 (soupsieve 2.9.2) |
| truststore | 0.10.4 |
| reportlab | 4.5.1 |
| pillow | 12.3.0 |
| asgiref | 3.12.1 |
| sqlparse | 0.6.0 |
| certifi | 2026.7.22 · urllib3 2.7.0 · idna 3.19 · charset-normalizer 3.5.1 · typing_extensions 4.16.0 · tzdata 2026.3 |
| celery | **Not installed** |
| redis | **Not installed** |
| channels-redis | **Not installed** |

### requirements.txt (verbatim)

```
Django==5.1.*
djangorestframework==3.15.*
djangorestframework-simplejwt==5.3.*
psycopg2-binary==2.9.*
django-cors-headers==4.4.*
python-decouple==3.8.*
bcrypt==4.2.*
channels==4.1.*
reportlab==4.*
requests==2.34.*
beautifulsoup4==4.15.*
truststore; sys_platform == "win32"  # optional: fixes gov SSL chains, import-guarded
# AI assistant uses an OpenAI-compatible LLM over the already-present `requests`.
# Backend is selectable via LLM_PROVIDER: 'local' (a local model over ngrok, LLM_BASE_URL)
# or 'gemini' (Google Gemini's OpenAI-compatible endpoint, GEMINI_API_KEY). No extra deps.
# anthropic is optional (kept for a future cloud option).
# anthropic==0.122.*
```

No `requirements-dev.txt`, no `pyproject.toml`, no `poetry.lock`. Pins are wildcard
minor ranges (`5.1.*`), so no transitive lockfile.

### Upgrade blockers

- `channels==4.1.*` — pulls in the ASGI stack; only HTTP is wired today.
- `djangorestframework-simplejwt` installed but unused (dead weight, harmless).
- Wildcard pins allow silent minor upgrades — CI could drift.
- No hard blocker to a Django 5.x point upgrade observed.

---

## 4. Data layer

### DATABASES (credentials redacted)

```python
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': config('DB_NAME', default='advocate_db'),
        'USER': config('DB_USER', default=<redacted>),      # code default: postgres
        'PASSWORD': config('DB_PASSWORD', default=<redacted>),
        'HOST': config('DB_HOST', default='localhost'),
        'PORT': config('DB_PORT', default='5432'),
    }
}
```

- Engine: PostgreSQL (psycopg2). Database: `advocate_db`. Host: localhost default.
- No `OPTIONS` (no `search_path`, no SSL options).
- The settings/`core/models.py` docstrings state this is a **drop-in over the same
  `advocate_db`** the Spring/Hibernate backend created (unmanaged models over
  existing tables). See §8 for the caveat that the Spring source is absent from the
  repo, so "same DB" cannot be independently verified — but the DB **is live and
  reachable** (see §9), and the unmanaged tables exist and hold data.

### Non-public PostgreSQL schemas

None. No `Meta.db_table` contains a `.` or quote; all tables are public-schema.

### Meta.db_table overrides

**core (`managed=False`):** `Advocate`→`advocate`, `Client`→`clients`,
`Case`→`cases`, `CaseEvent`→`case_events`, `Document`→`documents`, `Role`→`roles`,
`Permission`→`permissions`, `AdvocateRole`→`advocate_roles`,
`RolePermission`→`role_permissions`, `Expense`→`expenses`, `Invoice`→`invoices`,
`ClientPayment`→`client_payments`, `Task`→`tasks`,
`PasswordResetOtp`→`password_reset_otp`, `AuditLog`→`audit_log`,
`Activity`→`activities`, `CommunicationSettings`→`communication_settings`,
`NotificationTemplate`→`notification_templates`,
`NotificationHistory`→`notification_history`, `NotificationLog`→`notification_logs`,
`NotificationQueue`→`notification_queue`, `BackupHistory`→`backup_history`,
`Notification`→`notifications`.

**acts:** `Act`→`acts_act` (F), `Chapter`→`acts_chapter` (F),
`Section`→`acts_section` (F), `ActPaper`→`acts_actpaper` (F),
`ActCaseLink`→ default `acts_actcaselink` (**managed=True**).

**courtsearch (managed=True):** `CourtCaseTypes`→`courtsearch_case_types`,
`ImportedCaseRecord`→`courtsearch_imported_record`, `CauseListItem`→`causelist_item`.

**invoices (managed=True):** `InvoiceItem`→`invoice_items`.

**workspace (managed=True):** `CaseNote`→`case_note`, `CaseTag`→`case_tag`,
`CaseTask`→`case_task`, `CaseTaskDocument`→`case_task_document`,
`CaseParty`→`case_party`, `RelatedCase`→`case_related`,
`HearingDetail`→`hearing_detail`.

**appeals (managed=True):** `AppealDetection`→`appeal_detection`. (The older
`AppealAlert`/`appeal_alert` was dropped by `appeals/migrations/0003_delete_appealalert.py`.)

> Discrepancy flag: `acts.ActPaper` (`managed=False`, `acts_actpaper`) exists in
> `models.py` but is **absent** from `acts/migrations/0001_initial.py`. Harmless
> for migrations because unmanaged, but the migration does not mirror it. The
> `acts_actpaper` table exists and is populated (§9).

### DATABASE_ROUTERS / multi-DB

No `DATABASE_ROUTERS`. No `.using()` calls. Single `default` DB.

### pgvector / extensions / raw SQL / RunPython

- No `pgvector` / `VectorField`.
- No `RunSQL` or `RunPython` in any project migration (all plain
  `CreateModel`/`AlterField`).
- `acts/management/commands/index_acts_search.py` creates **pg_trgm GIN indexes**
  imperatively (via `--apply`), outside the migration framework. `core` management
  commands (`add_notification_links`, `enable_shared_practice`, `scope_case_numbers`)
  also perform imperative DDL against the Spring-owned tables — schema changes that
  are **not** captured as Django migrations.

### Migration health per app

| App | Migration files | Notes |
|-----|-----------------|-------|
| `acts` | `0001_initial.py` | Act/Chapter/Section as managed=False state + `ActCaseLink` real table |
| `appeals` | `0001_initial`, `0002_appealdetection`, `0003_delete_appealalert` | live table `appeal_detection` |
| `courtsearch` | `0001_initial`, `0002_importedcaserecord`, `0003_causelistitem`, `0004_alter_causelistitem_court_number` | — |
| `invoices` | `0001_initial` | `invoice_items` |
| `workspace` | `0001_initial`, `0002_caseparty_relatedcase`, `0003_alter_casetask_case_id_casetaskdocument`, `0004_hearingdetail` | — |
| all others (`core`, `accounts`, `clients`, `cases`, …) | none | models are `managed=False` or stubs |

None squashed. No RunPython/RunSQL anywhere.

`UNKNOWN: makemigrations --check --dry-run output.` Not run — the audit's hard
read-only constraint explicitly forbids running `makemigrations`. Visual inspection
of the five managed apps shows migrations consistent with their models, but this
should be confirmed in a live environment before integration.

### Model name collision risk — complete list

`core`: Advocate, Client, Case, CaseEvent, Document, Role, Permission, AdvocateRole,
RolePermission, Expense, Invoice, ClientPayment, Task, PasswordResetOtp, AuditLog,
Activity, CommunicationSettings, NotificationTemplate, NotificationHistory,
NotificationLog, NotificationQueue, BackupHistory, Notification.
`acts`: Act, Chapter, Section, ActPaper, ActCaseLink.
`courtsearch`: CourtCaseTypes, ImportedCaseRecord, CauseListItem.
`invoices`: InvoiceItem.
`workspace`: CaseNote, CaseTag, CaseTask, CaseTaskDocument, CaseParty, RelatedCase,
HearingDetail.
`appeals`: AppealDetection.

High-risk cross-project names: `Client`, `Case`, `Document`, `Task`, `Role`,
`Permission`, `Notification`, `Invoice`, `Expense`, `Section`, `Activity`.

---

## 5. Async and runtime

### Celery / Redis

**Neither installed nor used.** The only "Celery" match project-wide is a comment in
`appeals/management/commands/scan_appeals.py` explaining why Celery+Redis was
deliberately avoided. No broker, no result backend, no beat schedule. No Redis DB
numbers are assigned anywhere.

### Background scheduler (the async substitute)

`notifications/management/commands/run_scheduler.py` — a single long-running process
(`while True`, 5 s coarse tick) that fires two commands on independent, crash-isolated
intervals:

- `process_notifications` — default every **60 s** (`--drain-interval`, min 15).
- `scan_notifications` — default every **900 s / 15 min** (`--scan-interval`, min 60).
- `--once` runs one cycle and exits (for cron / Task Scheduler).

`process_notifications.py` drains `NotificationQueue` (QUEUED): IN_APP writes a
`Notification` row; EMAIL sends via Django `send_mail`/SMTP; WHATSAPP raises
`NotImplementedError` (mock only). Records `NotificationHistory` + a System
`Activity`; retries with backoff `[5, 30, 120]` min, then `FAILED_PERMANENTLY`.
`scan_notifications.py` calls `notifications.events.scan_due_notifications` to queue
due hearing reminders (next 2 days), overdue invoices, and overdue tasks.

Launched by `run-scheduler.bat` → `python manage.py run_scheduler` (meant to be
wrapped by NSSM/systemd).

### Management commands (fully-qualified, one line each)

| Command | Purpose |
|---------|---------|
| `notifications run_scheduler` | Long-running timer loop driving the two jobs below |
| `notifications process_notifications` | Send queued notifications (in-app/email), record history, retry w/ backoff |
| `notifications scan_notifications` | Queue due reminders (hearings / overdue invoices / tasks) |
| `appeals scan_appeals` | Nightly sweep: check if an appeal appeared vs decided cases (live scrape; `--limit`) |
| `acts index_acts_search` | Create pg_trgm GIN indexes for Acts ILIKE search (`--apply`) |
| `courtsearch backfill_court_data` | Backfill parties+hearings for imported cases from `ImportedCaseRecord` |
| `courtsearch refresh_case_types` | Admin-only re-scrape of court case types |
| `courtsearch sync_causelist` | Pull a court's published cause list for a day (`--court/--date/--days`); run early morning |
| `core add_notification_links` | Add link columns to `notifications` + backfill |
| `core enable_shared_practice` | Add `parent_advocate_id` column; manage practice membership |
| `core prune_audit_log` | Trim audit_log/activities to retention window (default 12 mo) |
| `core scope_case_numbers` | Swap global UNIQUE on `cases.case_number` to per-advocate |
| `core seed_demo` | Seed the "Kumar & Associates" demo dataset |
| `rbac seed_admin_permissions` | Seed admin permission codes into `permissions` |
| `rbac seed_firm_wide_scope` | Seed `FIRM_WIDE_SCOPE` permission + grant to firm-wide roles |

No `@shared_task` / Celery task names exist (no broker to collide on).

### Channels — ASGI

`ASGI_APPLICATION = 'advocate_backend.asgi.application'`. Channel layer is in-memory:

```python
CHANNEL_LAYERS = {
    'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
}
```

`asgi.py` (verbatim):

```python
"""ASGI entrypoint, routed through Channels so WebSockets can be added later.

Mirrors the pact-pro-draft pattern: HTTP is served now; the 'websocket' branch
is intentionally deferred (Phase 2+). The frontend's STOMP client will simply
fail to connect and the UI degrades gracefully (it polls REST for updates).
"""

import os
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'advocate_backend.settings')

application = ProtocolTypeRouter({
    'http': get_asgi_application(),
    # 'websocket': ... (deferred)
})
```

No project `routing.py` exists. WebSocket is not wired server-side.

### Long-running / GPU-dependent work

- **AI assistant** (`assistant/llm.py`) — an OpenAI-compatible **HTTP streaming
  client** (SSE) over `requests`. **Not GPU-bound in this process**; the model runs
  remotely (a local model over an ngrok tunnel, or Google Gemini). `LLM_TIMEOUT`
  default **600 s**. No tool/function calling — it gathers advocate-scoped read-only
  context server-side (`assistant/tools.py`) and injects it into the prompt.
  Endpoints: `/api/assistant/query`, `/api/assistant/chat`.
- **Court scraping** — `courtsearch` calls out to a separate scraper service with
  long timeouts (district cause-list up to **1800 s**); kept out of page loads via
  the management commands / a dedicated refresh view (`REFRESH_TIMEOUT = 240`).

### External services

| Service | Purpose | Where |
|---------|---------|-------|
| LLM: local model over **ngrok** (OpenAI-compatible) | AI assistant, provider `local` | `assistant/llm.py` (`LLM_BASE_URL`, `LLM_OPENAI_PATH`, `LLM_MODEL`) |
| **Google Gemini** OpenAI-compat endpoint (`https://generativelanguage.googleapis.com/v1beta/openai`) | AI assistant, provider `gemini` | `assistant/llm.py` (`GEMINI_BASE_URL`, `GEMINI_MODEL`, `GEMINI_API_KEY`) |
| **Court "Case Status" scraper microservice** (FastAPI, default `http://localhost:8000`) → upstream **eCourts** (HC/DC), **Supreme Court of India**, Madras HC, cause-lists, display boards | Court search, cause-lists, order/judgement PDFs, appeal detection | `courtsearch/client.py` (`COURT_API_BASE`) |
| Gmail SMTP (`smtp.gmail.com:587`, TLS) | OTP + hearing/invoice/appeal reminders + test send | `settings.py` `EMAIL_*` |
| Meta WhatsApp Cloud API | **Disabled** (`WHATSAPP_ENABLED=False`); sender is a mock that raises `NotImplementedError` | `communication/`, `process_notifications.py` |

No S3, no Elasticsearch. Anthropic is **not** wired (commented-out optional dep only).

---

## 6. Deployment

### Docker / process manager

No `Dockerfile`, `docker-compose.yml`, nginx, gunicorn, uvicorn, daphne, or
supervisor config in `Advocate-app-BE-Django/`. (The sibling `Advocate-app-BE-main/`
now contains **only** `uploads/` — no Spring source, no Docker files — see §8.)

### Process commands

`run-django.bat`:
```bat
@echo off
REM Launch the Django backend on port 8080 (drop-in replacement for Spring Boot).
cd /d "%~dp0"
call venv\Scripts\activate.bat
REM 0.0.0.0 => listen on all interfaces so other devices on the LAN can reach it.
python manage.py runserver 0.0.0.0:8080
```

`run-scheduler.bat`:
```bat
@echo off
REM Background scheduler: delivers notifications and raises due reminders on a timer.
REM Run this in its own window alongside run-django.bat. In production, wrap it with
REM NSSM (Windows service) or systemd so it restarts on reboot/crash.
cd /d "%~dp0"
call venv\Scripts\activate.bat
python manage.py run_scheduler
```

Web is Django's **dev server** (`runserver`) bound to `0.0.0.0:8080` — no
production WSGI/ASGI server. The scheduler is a second long-lived process. Helper
`scripts/*.bat` (`process_notifications`, `scan_notifications`, `scan_appeals`,
`prune_audit_log`, `run_tests`) wrap the management commands for Task Scheduler.

### Ports / hostname

- Django: **8080**, all interfaces (LAN-reachable).
- Court scraper microservice: default **8000** (`COURT_API_BASE`).
- No nginx; public hostname not defined in repo config. `.env` sets
  `VITE_API_BASE=http://192.168.1.36:8080` (a LAN IP) on the frontend side.

---

## 7. Frontend

### Location

`Advocate-app-FE-main/` — React 19 + Vite SPA.

### package.json (verbatim)

```json
{
  "name": "advocate-chat",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "@stomp/stompjs": "^7.0.0",
    "axios": "^1.12.2",
    "jspdf": "^3.0.3",
    "jwt-decode": "^4.0.0",
    "react": "^19.1.1",
    "react-big-calendar": "^1.19.4",
    "react-dom": "^19.1.1",
    "react-icons": "^5.5.0",
    "react-router-dom": "^7.9.1",
    "react-select": "^5.10.2",
    "recharts": "^3.9.0"
  },
  "devDependencies": {
    "@eslint/js": "^9.36.0",
    "@types/react": "^19.1.13",
    "@types/react-dom": "^19.1.9",
    "@vitejs/plugin-react": "^5.0.3",
    "baseline-browser-mapping": "^2.10.40",
    "eslint": "^9.36.0",
    "eslint-plugin-react-hooks": "^5.2.0",
    "eslint-plugin-react-refresh": "^0.4.20",
    "globals": "^16.4.0",
    "vite": "^7.1.7"
  },
  "allowScripts": {
    "esbuild@0.28.1": true,
    "core-js@3.49.0": true
  }
}
```

### Auth credential storage

**`localStorage`** (not httpOnly cookie — readable by JS). Written at login in
`src/pages/Login.jsx` (keys **`token`**, **`email`**, **`role`**, **`fullName`**),
from `response.data.token` of `POST /api/advocates/login`.

- `src/api.js` — `authHeaders()` reads `localStorage.token` → `Authorization:
  Bearer <token>`; token also read ad hoc in many pages/services.
- `src/utils/auth.jsx` — `isTokenExpired()` via `jwt-decode` (client only reads
  `exp`; does not verify signature); `logoutAndRedirect()` removes `token` + `email`
  (note: `role`/`fullName` are **not** cleared).
- `src/pages/Login.jsx` — the only axios interceptor: a **response** interceptor
  that redirects to login on 401 (except for the login call itself). There is **no
  request interceptor** auto-attaching the token.

### API base URL

`import.meta.env.VITE_API_BASE || "http://localhost:8080"`, defined in `src/api.js`,
`src/config.js`, `src/main.jsx` (also sets `axios.defaults.baseURL` + `window.API_BASE`)
and re-derived in ~15 service/page files. `.env` overrides to
`http://192.168.1.36:8080`.

### New backend surfaces used by FE

- courtsearch: `src/services/courtDocuments.js` → `/api/courtsearch/ecourts/document`,
  `/hc/hearing-business`, `/hc/order-pdf`.
- acts: `src/pages/Acts.jsx`, `ActDetail.jsx` → `/api/acts`, `/api/acts/{id}` etc.
  (hardcoded paths, not in `config.js`).
- assistant: `src/contexts/AssistantContext.jsx` streams SSE from
  `/api/assistant/chat` and `/api/assistant/query`; history in localStorage key
  `advocate-assistant-history`.
- **STOMP WebSocket:** `src/contexts/realtime/WebSocketProvider.jsx` configures a
  `@stomp/stompjs` client (`ws(s)://…/ws`, `Authorization` connect header,
  `/user/queue/*` subscriptions) but is **disabled by default**
  (`WS_ENABLED = VITE_ENABLE_WS === "true"`); backend serves no `/ws` endpoint, so
  the UI falls back to REST polling.

### Routing

History-based (`BrowserRouter as Router` in `src/App.jsx`); no `basename` → base
path `/`. (Vercel SPA rewrite + default Vite `base` `/`.)

---

## 8. Cross-system references

**`pact-pro` / `pact-pro-draft`** — a sibling project this codebase was patterned
after. References found (comments/docstrings only):

- `assistant/llm.py` lines 3, 17, 71, 270 — "the exact connection style used by the
  pact-pro-draft app", "mirroring pact-pro-draft", "pact-pro-draft's `_config_for()`",
  "Retries transient failures like pact-pro-draft does."
- `advocate_backend/settings.py:128` — "Channels (wired for parity with
  pact-pro-draft; WebSockets deferred)".
- `advocate_backend/asgi.py:3` — "Mirrors the pact-pro-draft pattern…".

These are structural/pattern references — no imported modules from a sibling
project, no shared secrets by name, no HTTP calls to another system.

**`abstract` / `abstraction`** — only a domain data field (`acts.Section.abstract`,
India Code's "abstract" text) and FE labels; not the sibling "abstraction" system.
**`draft`** — besides `pact-pro-draft`, only benign demo strings in
`core/seed_demo.py`. **`ams`** — only the repo/dir name and top-level docs. No
`pactpro`/`pact_pro` (no-hyphen) hits.

**Filesystem coupling to the Spring sibling:** `DOCUMENT_UPLOAD_DIR` defaults to
`../Advocate-app-BE-main/uploads`, so the Django app reads/writes the Spring app's
uploads folder.

**Copy/re-declared schema:** `core/models.py` is a deliberate re-declaration
(`managed=False`) of the Spring/Hibernate schema. `assistant/llm.py` re-implements
`pact-pro-draft`'s LLM-client structure.

**Spring DB engine/name — UNKNOWN.** `Advocate-app-BE-main/` now contains **only
`uploads/` (a few PDFs)** — no `application.properties`/`.yml`, no `pom.xml`, no
`docker-compose`, no source. The prior audit's claim that Spring used **MySQL
(`advocate`)** was based on `LOCAL_DEVELOPMENT.md` and can no longer be verified
against Spring config (absent). The Django app **asserts** it shares Spring's
`advocate_db` PostgreSQL via unmanaged models; the DB is live and holds data (§9),
but whether Spring itself pointed at this exact DB/engine is unverifiable from files
present. Redact/verify with a human.

---

## 9. Live data profile

Database **was reachable** this audit. Connected read-only (`SET SESSION READ ONLY`)
via psycopg2 using `.env` credentials; **SELECT-only**, no writes.

| Metric | Value |
|--------|-------|
| Users (`advocate`) | **16** |
| Org/tenant table | none (practice via `parent_advocate_id`: **6** advocates have a parent across **4** distinct practice heads; **0** with `left_on` set) |
| Users with NULL/empty email | **0** |
| Duplicate email groups (lower(trim(email))) | **0** |
| Roles by `advocate.role` | ADVOCATE 14, ACCOUNTANT 1, "Super Admin" 1 |
| `roles` table rows | 6 |

**Five largest tables (by `pg_stat_user_tables` live-tuple estimate):**

| Table | ~rows |
|-------|-------|
| `acts_section` | 28,524 |
| `causelist_item` | 11,022 |
| `acts_actpaper` | 5,486 |
| `acts_act` | 1,250 |
| `audit_log` | 448 |

(next: `activities` 268, `notification_queue` 209, `case_events` 128.)

**Usage date range.** `advocate` has no `date_joined`/`created_at`; `enrollment_date`
is NULL for all 16 rows, so no user-registration timeline is available. Activity
proxies: `cases.created_at` spans **2026-02-16 → 2026-09-04**; `audit_log.created_at`
spans **2026-07-28 → 2026-09-08**; `activities.timestamp` spans
**2026-08-27 → 2026-09-07**. So real use goes back to at least February 2026.

**Email-hash file:** `AUDIT_ams_email_hashes.txt` written at repo root — **16 lines**,
one `sha256(lower(trim(email)))` per user, hashes only (no plaintext, no IDs, no
names). Its contents are intentionally not reproduced here.

---

## 10. Uncertainty list

1. **No Django auth / `AUTH_USER_MODEL`.** `Advocate` is a plain unmanaged model;
   merging with an `AbstractUser`-based project needs a full auth rearchitecture.
2. **Advocate model fields `parent_advocate_id` and `left_on` were confirmed in the
   live DB but their exact `core/models.py` field declarations were not re-quoted
   verbatim** — confirm types/nullability before relying on them.
3. **`Task` FK vs bare-int.** Prior audit listed `Task.advocate` as a relational FK;
   current models agent classifies `Task.advocate_id` as a bare int. Verify the
   actual declaration in `core/models.py`.
4. **`makemigrations --check --dry-run` not run** (hard read-only constraint forbids
   `makemigrations`). Migration-tree cleanliness is UNKNOWN; verify in a live env.
5. **Imperative DDL outside migrations.** `core/enable_shared_practice`,
   `core/scope_case_numbers`, `core/add_notification_links`, and
   `acts/index_acts_search` change schema/indexes directly. These changes are not
   captured as Django migrations — a fresh environment must run them explicitly.
6. **Spring backend source is gone** (`Advocate-app-BE-main/` = uploads only), so the
   "same `advocate_db` PostgreSQL" claim and the old "MySQL" note cannot be
   reconciled from files. Confirm which engine/DB is authoritative and who owns the
   schema/sequences now.
7. **`Advocate.id` uses a pre-existing sequence.** If both Spring and Django ever
   insert advocates, sequence-ownership must be clear. `scope_case_numbers` already
   had to move `cases.case_number` uniqueness to per-advocate — a sign of prior
   collisions; watch for similar global-unique assumptions on merge.
8. **Dev server in "production."** `runserver 0.0.0.0:8080` + a hand-rolled scheduler
   loop; no gunicorn/uvicorn/daphne, no supervisor. LAN-exposed.
9. **CSRF absent, `USE_TZ=False`, bcrypt (`$2a$`) passwords.** Intentional for this
   JWT API and Spring parity, but all three break naive integration with a
   Django-standard project (CSRF middleware order, UTC conversion, `check_password`).
10. **No lockfile; wildcard pins.** Exact transitive versions drift; §3 versions are
    from this venv's `pip freeze` and may differ elsewhere.
11. **`djangorestframework-simplejwt` installed but unused** — confirm nothing
    depends on it before removal.
12. **External scraper dependency.** `courtsearch` needs a separate FastAPI scraper
    service (`COURT_API_BASE`, default `:8000`) that itself scrapes eCourts/SCI with
    very long timeouts (≤1800 s). Availability, IP-reputation, and legal/ToS posture
    of that scraping should be reviewed. `scan_appeals` scrapes live nightly.
13. **LLM egress.** The assistant streams to a remote LLM (local-over-ngrok or
    Google Gemini). Advocate-scoped case context is placed in prompts and sent
    off-box; confirm data-egress policy. `GEMINI_API_KEY`/`LLM_API_KEY` live in
    `.env`.
14. **WhatsApp is disabled and mock-only** (`WHATSAPP_ENABLED=False`, sender raises
    `NotImplementedError`); no real Meta integration despite the config surface.
15. **`.env` present in the Django dir** (gitignored). Read for names only; verify no
    live secret was ever committed historically (settings comments say committed
    literals for `SECRET_KEY` default, `OTP_SALT`, `WHATSAPP_VERIFY_TOKEN`, and mail
    creds were removed — history should be checked and any exposed secret rotated).
16. **`recovery-codes.txt`** was reported at repo root in the prior audit — if still
    present, review/remove before sharing the repo.
```
