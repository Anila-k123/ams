# AUDIT_ams — Advocate Management System (Django Backend)

**Repo sub-path audited:** `Advocate-app-BE-Django/`
**Audit date:** 2026-08-04

---

## 1. Identity and auth

### AUTH_USER_MODEL

`AUTH_USER_MODEL` is **not set** in `advocate_backend/settings.py`. Django's built-in
auth framework (`django.contrib.auth`) is **not installed** (absent from
`INSTALLED_APPS`). There is no Django auth user model at all.

The "user" in this system is `core.models.Advocate`, a plain `models.Model`
(not a subclass of `AbstractUser` or `AbstractBaseUser`). It maps onto a
pre-existing PostgreSQL table created and owned by the sibling Spring Boot
backend.

### User model — verbatim source (`core/models.py`, lines 10–81)

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

    class Meta:
        managed = False
        db_table = 'advocate'

    # --- DRF/auth compatibility: request.user is an Advocate instance ---
    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    def permission_codes(self):
        """Return the set of permission name strings for this advocate,
        resolved through advocate_roles -> role_permissions -> permissions."""
        role_ids = AdvocateRole.objects.filter(
            advocate_id=self.id).values_list('role_id', flat=True)
        perm_ids = RolePermission.objects.filter(
            role_id__in=list(role_ids)).values_list('permission_id', flat=True)
        return set(Permission.objects.filter(
            id__in=list(perm_ids)).values_list('name', flat=True))

    def role_names(self):
        role_ids = AdvocateRole.objects.filter(
            advocate_id=self.id).values_list('role_id', flat=True)
        return list(Role.objects.filter(
            id__in=list(role_ids)).values_list('name', flat=True))
```

No custom managers. No standard Django manager (`objects` uses the default).

### Organisation / firm / tenant / workspace model

There is **no org/firm/tenant/workspace model**. This system is single-tenant:
each row in the `advocate` table is a solo practitioner who owns all their own
data. All data isolation is enforced by filtering on `advocate_id` in every query.

### FK/OneToOne/M2M relationships to the Advocate (user) model

All FK references in `core/models.py` use a raw `ForeignKey` to `Advocate`
with `on_delete=models.DO_NOTHING` (mirrors the Spring `@JoinColumn` with no
cascade). All models are `managed=False`.

| File | Model | Field | on_delete | null | blank |
|------|-------|-------|-----------|------|-------|
| `core/models.py` | `Client` | `advocate` (`db_column='advocate_id'`) | `DO_NOTHING` | True | True |
| `core/models.py` | `Case` | `advocate` (`db_column='advocate_id'`) | `DO_NOTHING` | False | False |
| `core/models.py` | `CaseEvent` | `advocate` (`db_column='advocate_id'`) | `DO_NOTHING` | False | False |
| `core/models.py` | `Document` | `advocate` (`db_column='advocate_id'`) | `DO_NOTHING` | False | False |
| `core/models.py` | `Expense` | `advocate` (`db_column='advocate_id'`) | `DO_NOTHING` | False | False |
| `core/models.py` | `Invoice` | `advocate` (`db_column='advocate_id'`) | `DO_NOTHING` | False | False |
| `core/models.py` | `ClientPayment` | `advocate` (`db_column='advocate_id'`) | `DO_NOTHING` | True | True |
| `core/models.py` | `Task` | `advocate` (`db_column='advocate_id'`) | `DO_NOTHING` | False | False |

The following models store `advocate_id` as a plain `BigIntegerField` (no ORM
FK, no cascade), effectively bare integer foreign keys:

| Model | Field |
|-------|-------|
| `PasswordResetOtp` | `advocate_id` |
| `AuditLog` | `advocate_id` |
| `Activity` | `advocate_id` |
| `CommunicationSettings` | `advocate_id` |
| `NotificationTemplate` | `advocate_id` |
| `NotificationHistory` | `advocate_id` |
| `NotificationLog` | `advocate_id` |
| `NotificationQueue` | `advocate_id` |
| `BackupHistory` | `advocate_id` |
| `Notification` | `advocate_id` |
| `AppealAlert` (appeals/models.py) | `advocate_id` |
| `CaseNote` (workspace/models.py) | `advocate_id` |
| `CaseTag` (workspace/models.py) | `advocate_id` |
| `CaseTask` (workspace/models.py) | `advocate_id` |
| `CaseTaskDocument` (workspace/models.py) | `advocate_id` |
| `CaseParty` (workspace/models.py) | `advocate_id` |
| `RelatedCase` (workspace/models.py) | `advocate_id` |

No `ManyToManyField` to the user model anywhere in the codebase.

### AUTHENTICATION_BACKENDS

Not set. Django's built-in `django.contrib.auth.backends.ModelBackend` is
irrelevant here because `django.contrib.auth` is not installed. Authentication
is handled entirely by the custom DRF class described below.

### PASSWORD_HASHERS

Not set. Django's built-in password hashers are not used. Passwords are
BCrypt hashes created and verified directly via the `bcrypt` library
(`core/passwords.py`). The hashes are Spring-generated `$2a$10$…` BCrypt
strings. There is no migration path via Django's `PBKDF2`-based system.

### Client authentication mechanism

Authentication is entirely custom JWT, **not** DRF SimpleJWT (that package is
installed but unused in settings). The flow:

1. Client `POST /api/advocates/login` → receives a signed HS256 JWT.
2. Every subsequent request must send `Authorization: Bearer <token>`.
3. `core.auth.AdvocateJWTAuthentication` decodes the token, looks up the
   `Advocate` row by `advocateId` claim (fallback: `sub`/`email`), and sets
   `request.user` to that `Advocate` instance.
4. Token payload: `sub` (email), `advocateId`, `email`, `iat`, `exp`.
5. Token is signed with `settings.SECRET_KEY` (HS256, `JWT_ALGORITHM`).
6. Expiry default: 86400000 ms (24 h), configurable via `JWT_EXPIRATION_MS`.

Session cookies are **not** used (`django.contrib.sessions` is absent from
`INSTALLED_APPS`).

**Auth endpoints:**

| Method | Path | Auth required |
|--------|------|---------------|
| POST | `/api/advocates/login` | No (AllowAny) |
| POST | `/api/advocates/signup` | No (AllowAny) |
| POST | `/api/advocates/logout` | Yes (token blacklist not implemented — stateless) |
| POST | `/api/auth/forgot-password` | No |
| POST | `/api/auth/verify-otp` | No |
| POST | `/api/auth/reset-password` | No |

No OAuth. No refresh-token endpoint.

### Custom permission classes

`core/permissions.py` — `RequirePermission(*codes, require_all=False)`:
returns a `BasePermission` subclass that checks `request._advocate_permissions`
(a `set` of permission-name strings loaded at authentication time from the
`advocate_roles → role_permissions → permissions` tables). OR semantics by
default; pass `require_all=True` for AND semantics.

Used as decorator e.g. `permission_classes=[RequirePermission('MANAGE_CASES')]`.

The global default permission class in DRF settings is
`rest_framework.permissions.IsAuthenticated`, which checks
`request.user.is_authenticated` — satisfied by the `Advocate.is_authenticated`
property.

### Hardcoded assumptions about integer user IDs

The `Advocate.id` field is `BigAutoField` (64-bit integer), matching the
Spring `BIGINT`. All `advocate_id` filters and JWT claims use bare integer
comparisons. There is no UUID-based user identity. If another system uses
non-integer or UUID user IDs, the entire auth flow, JWT payload structure,
and filter pattern would need changing.

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

There is only one settings file. No `settings/` package, no
`settings_dev.py`/`settings_prod.py` split. The production entry point is
`advocate_backend.settings` (set in both `wsgi.py` and `asgi.py`).

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
    'tasks',                          # [first-party] ⚠️ COLLISION-RISK
    'search',                         # [first-party] ⚠️ COLLISION-RISK
    'reports',                        # [first-party]
    'audit',                          # [first-party]
    'backup',                         # [first-party]
    'communication',                  # [first-party]
    'assistant',                      # [first-party]
    'appeals',                        # [first-party]
    'workspace',                      # [first-party]
]
```

Notable absences: `django.contrib.admin`, `django.contrib.auth`,
`django.contrib.sessions`, `django.contrib.messages`.

### App labels and collision risk

Every app uses the default `app_label` (directory name). No overrides in any
`apps.py`. Labels likely to collide with sibling projects:

| Label | Risk |
|-------|------|
| `core` | HIGH — extremely common app name |
| `tasks` | HIGH — common app name |
| `search` | HIGH — common app name |
| `documents` | MEDIUM — common app name |
| `notifications` | MEDIUM |
| `dashboard` | MEDIUM |
| `reports` | MEDIUM |
| `audit` | MEDIUM |
| `payments` | MEDIUM |

### MIDDLEWARE (verbatim)

```python
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',     # [django]
    'corsheaders.middleware.CorsMiddleware',             # [third-party]
    'django.middleware.common.CommonMiddleware',         # [django]
]
```

No first-party custom middleware. No session middleware, no auth middleware,
no CSRF middleware.

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
    path('api/', include('tasks.urls')),
    path('api/', include('search.urls')),
    path('api/', include('reports.urls')),
    path('api/', include('audit.urls')),
    path('api/', include('backup.urls')),
    path('api/', include('communication.urls')),
    path('api/', include('assistant.urls')),
    path('api/', include('appeals.urls')),
    path('api/', include('workspace.urls')),
]
```

All apps share the `/api/` prefix. No versioning prefix (e.g. `/api/v1/`).

### MIDDLEWARE-adjacent settings

```python
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost,127.0.0.1', cast=Csv())

CORS_ALLOWED_ORIGINS = config(
    'CORS_ORIGINS',
    default='http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174',
    cast=Csv(),
)
CORS_ALLOW_CREDENTIALS = True

# CSRF: CsrfViewMiddleware is NOT installed; CSRF protection is absent.

# SESSION_*: django.contrib.sessions is NOT installed; no session settings apply.

STATIC_URL = '/static/'
# STATIC_ROOT: not set
# MEDIA_URL: not set
# MEDIA_ROOT: not set
# DEFAULT_FILE_STORAGE: not set (default Django FileSystemStorage)
```

Document uploads use a custom `DOCUMENT_UPLOAD_DIR` setting (not
Django's media framework) pointing at the sibling Spring Boot `uploads/`
folder.

### Environment variables read by this project (names only)

| Variable | Default in code | Used for |
|----------|----------------|---------|
| `SECRET_KEY` | `<redacted>` | Django secret, JWT signing |
| `DEBUG` | `True` | Debug mode |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | Allowed host list |
| `DB_NAME` | `advocate_db` | PostgreSQL database name |
| `DB_USER` | `<redacted>` | PostgreSQL username |
| `DB_PASSWORD` | `<redacted>` | PostgreSQL password |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `JWT_EXPIRATION_MS` | `86400000` | Token expiry in ms |
| `CORS_ORIGINS` | `http://localhost:5173,...` | CORS allowed origins |
| `DOCUMENT_UPLOAD_DIR` | `../Advocate-app-BE-main/uploads` | Upload path |
| `MAIL_HOST` | `smtp.gmail.com` | SMTP host |
| `MAIL_PORT` | `587` | SMTP port |
| `MAIL_USERNAME` | `<redacted>` | SMTP username |
| `MAIL_PASSWORD` | `<redacted>` | SMTP password |
| `NOTIFICATION_SENDER_NAME` | `<redacted>` | Email from-name |
| `OTP_SALT` | `<redacted>` | OTP hashing salt |
| `OTP_EXPIRY_MINUTES` | `10` | OTP TTL |
| `OTP_RATE_LIMIT` | `5` | Max OTP requests |
| `WHATSAPP_VERIFY_TOKEN` | `<redacted>` | WhatsApp webhook verify |
| `TIME_ZONE` | `Asia/Kolkata` | Django timezone |

---

## 3. Versions and dependencies

### Installed versions (from venv)

| Package | Version |
|---------|---------|
| Python | 3.11.0 (venv home: `C:\Users\Sybrant\AppData\Local\Programs\Python\Python311`) |
| Django | 5.1.15 |
| djangorestframework | 3.15.2 |
| djangorestframework-simplejwt | 5.3.1 (installed but **not used** in settings) |
| psycopg2-binary | 2.9.12 |
| bcrypt | 4.2.1 |
| channels | 4.1.0 |
| reportlab | 4.5.1 |
| PyJWT | 2.13.0 |
| django-cors-headers | 4.4.0 |
| python-decouple | 3.8 (installed as `decouple.py` single-file module; `python_decouple-3.8.dist-info` present) |
| asgiref | 3.12.1 |
| pillow | 12.3.0 |
| sqlparse | 0.5.5 |
| tzdata | 2026.3 |
| celery | Not installed |
| redis | Not installed |

### Full requirements.txt

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
```

No `requirements-dev.txt`, no `pyproject.toml`, no `poetry.lock`.
No lockfile with pinned transitive dependencies.

### Upgrade blockers

- **`channels==4.1.*`** requires `daphne` or similar ASGI server for full
  WebSocket support, though currently only HTTP is wired in `asgi.py`.
- `djangorestframework-simplejwt` is installed but unused. Its presence is
  harmless but adds confusion.
- No celery, redis, or channels layer requiring a broker.
- No pinned transitive dependencies. Version ranges (`5.1.*`) allow minor
  upgrades automatically, which could introduce breakage in CI.

---

## 4. Data layer

### DATABASES config (credentials redacted)

```python
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': config('DB_NAME', default='advocate_db'),   # env var DB_NAME
        'USER': config('DB_USER', default=<redacted>),
        'PASSWORD': config('DB_PASSWORD', default=<redacted>),
        'HOST': config('DB_HOST', default='localhost'),      # localhost
        'PORT': config('DB_PORT', default='5432'),
    }
}
```

- Engine: PostgreSQL (psycopg2)
- Database name: `advocate_db`
- Host type: localhost (default), overridable via `DB_HOST`
- No `OPTIONS` (no `search_path`, no SSL options)

**Note:** The original Spring Boot backend uses **MySQL** (`advocate` database,
as shown in `LOCAL_DEVELOPMENT.md`). This Django backend targets **PostgreSQL**
(`advocate_db`). These are two different databases. The Django backend is a
rewrite/replacement, not a connector to the same DB.

### Non-public PostgreSQL schemas

None found. No `Meta.db_table` values contain a `.` or quoted schema prefix.

### Meta.db_table overrides

All `managed=False` models in `core/models.py`:

| Model | db_table |
|-------|----------|
| `Advocate` | `advocate` |
| `Client` | `clients` |
| `Case` | `cases` |
| `CaseEvent` | `case_events` |
| `Document` | `documents` |
| `Role` | `roles` |
| `Permission` | `permissions` |
| `AdvocateRole` | `advocate_roles` |
| `RolePermission` | `role_permissions` |
| `Expense` | `expenses` |
| `Invoice` | `invoices` |
| `ClientPayment` | `client_payments` |
| `Task` | `tasks` |
| `PasswordResetOtp` | `password_reset_otp` |
| `AuditLog` | `audit_log` |
| `Activity` | `activities` |
| `CommunicationSettings` | `communication_settings` |
| `NotificationTemplate` | `notification_templates` |
| `NotificationHistory` | `notification_history` |
| `NotificationLog` | `notification_logs` |
| `NotificationQueue` | `notification_queue` |
| `BackupHistory` | `backup_history` |
| `Notification` | `notifications` |

Django-managed models (create their own tables):

| Model | db_table | App |
|-------|----------|-----|
| `AppealAlert` | `appeal_alert` | `appeals` |
| `CaseNote` | `case_note` | `workspace` |
| `CaseTag` | `case_tag` | `workspace` |
| `CaseTask` | `case_task` | `workspace` |
| `CaseTaskDocument` | `case_task_document` | `workspace` |
| `CaseParty` | `case_party` | `workspace` |
| `RelatedCase` | `case_related` | `workspace` |

### DATABASE_ROUTERS / multi-DB

No `DATABASE_ROUTERS` setting. No `.using()` calls found. Single database only.

### pgvector, extensions, raw SQL, RunPython migrations

- No `pgvector` usage found.
- No raw SQL (`RunSQL`) in migrations.
- No `RunPython` data migrations.
- No materialized views or explicit extension calls.

### Migration health per app

Only two apps have Django-managed migrations:

**`appeals`** — 1 migration file:
- `0001_initial.py` — creates `AppealAlert` table. No RunPython, no RunSQL.
- Not squashed.

**`workspace`** — 3 migration files:
- `0001_initial.py` — creates `CaseNote`, `CaseTag`, `CaseTask`.
- `0002_caseparty_relatedcase.py` — adds `CaseParty`, `RelatedCase`.
- `0003_alter_casetask_case_id_casetaskdocument.py` — alters `CaseTask.case_id` to nullable; adds `CaseTaskDocument`.
- Not squashed.

All other apps (`accounts`, `cases`, `clients`, etc.) have **no migrations directory** because their models are `managed=False`.

UNKNOWN: Whether `makemigrations --check --dry-run` reports clean — cannot
run Django management commands without a live database connection and a
correctly configured environment. The migration files look complete based
on visual inspection of the model definitions.

### Model name collision risk — complete list

| Model class | App/module |
|-------------|-----------|
| `Advocate` | `core` |
| `Client` | `core` |
| `Case` | `core` |
| `CaseEvent` | `core` |
| `Document` | `core` |
| `Role` | `core` |
| `Permission` | `core` |
| `AdvocateRole` | `core` |
| `RolePermission` | `core` |
| `Expense` | `core` |
| `Invoice` | `core` |
| `ClientPayment` | `core` |
| `Task` | `core` |
| `PasswordResetOtp` | `core` |
| `AuditLog` | `core` |
| `Activity` | `core` |
| `CommunicationSettings` | `core` |
| `NotificationTemplate` | `core` |
| `NotificationHistory` | `core` |
| `NotificationLog` | `core` |
| `NotificationQueue` | `core` |
| `BackupHistory` | `core` |
| `Notification` | `core` |
| `AppealAlert` | `appeals` |
| `CaseNote` | `workspace` |
| `CaseTag` | `workspace` |
| `CaseTask` | `workspace` |
| `CaseTaskDocument` | `workspace` |
| `CaseParty` | `workspace` |
| `RelatedCase` | `workspace` |

High-risk names for cross-project collision: `Client`, `Case`, `Document`,
`Task`, `Role`, `Permission`, `Notification`, `Invoice`, `Expense`.

---

## 5. Async and runtime

### Celery

No `celery.py` found anywhere in the project. Celery is **not installed** and
**not used**. No broker or result-backend settings.

### Redis

Redis is **not installed** or configured. No Redis DB numbers assigned.
The Channels layer uses the **in-memory** backend (not Redis):

```python
CHANNEL_LAYERS = {
    'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
}
```

### Celery tasks

None — Celery is absent.

### Beat schedule

None.

### Channels — ASGI

```python
ASGI_APPLICATION = 'advocate_backend.asgi.application'
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

No `routing.py` file exists. WebSocket is not wired.

### Long-running / GPU-dependent work

None. The `assistant` app is a rule-based keyword-matching router, not an LLM.

### External services

| Service | Purpose | Where configured |
|---------|---------|-----------------|
| Gmail SMTP (`smtp.gmail.com:587`) | Password-reset OTP emails | `settings.py` `EMAIL_*` |
| Meta WhatsApp Cloud API (webhook only) | Receive delivery callbacks; mock send | `communication/whatsapp.py` (no outbound HTTP to Meta from this code — send is mocked) |

No LLM providers, no court data APIs, no S3, no Elasticsearch.

---

## 6. Deployment

### Docker files

No `Dockerfile` or `docker-compose.yml` in `Advocate-app-BE-Django/`.

The only Docker files in the repo are in `Advocate-app-BE-main/` (the
Java Spring Boot sibling):

- `Advocate-app-BE-main/Dockerfile`
- `Advocate-app-BE-main/docker-compose.yml`

Those were not audited here (different service).

### Process commands

From `run-django.bat`:
```bat
@echo off
REM Launch the Django backend on port 8080 (drop-in replacement for Spring Boot).
cd /d "%~dp0"
call venv\Scripts\activate.bat
python manage.py runserver 8080
```

This uses Django's development server (`runserver`). There is no
gunicorn/uvicorn/daphne config, no supervisor config, no production
process manager.

### Ports

- Django backend: port **8080** (same port as the Spring Boot original).
- No nginx config.
- Public hostname: not visible from repo config.

---

## 7. Frontend

### Location

`Advocate-app-FE-main/` — React + Vite SPA.

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

Token is stored in **`localStorage`** under the key `"token"`. Email is stored
under `"localStorage.email"`. **Not httpOnly cookie** — the token is accessible
to JavaScript.

Relevant files:
- `src/api.js` — reads `localStorage.getItem("token")` and injects as
  `Authorization: Bearer <token>` header on every request.
- `src/utils/auth.jsx` — `isTokenExpired()` uses `jwt-decode` to check `exp`.
  `logoutAndRedirect()` calls `localStorage.removeItem("token")` on expiry.
- `src/App.jsx` — checks `localStorage.getItem("token")` on every render; 
  auto-redirects to `/login` on missing/expired token.

### API base URL

Defined in `src/config.js` and `src/api.js`:
```js
const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8080";
```

Configurable via `VITE_API_BASE` build-time env var. Default points to
local Spring Boot port (8080), which is also the port the Django replacement
uses.

### Routing

History-based (`BrowserRouter`): `App.jsx` imports
`BrowserRouter as Router`. No `basename` prop → base path is `/`.

---

## 8. Cross-system references

**`pact-pro-draft` / `pact-pro`** — two references found in the Django backend:

1. `advocate_backend/settings.py` line 115:
   ```python
   # --- Channels (wired for parity with pact-pro-draft; WebSockets deferred) ---
   ```

2. `advocate_backend/asgi.py` line 3 (docstring):
   ```
   Mirrors the pact-pro-draft pattern: HTTP is served now; the 'websocket' branch
   is intentionally deferred (Phase 2+).
   ```

These are **comments only** — no code-level coupling, no shared secrets,
no shared database names, no HTTP calls to the other system, no imported
modules from a sibling project.

No references to strings `pactpro`, `abstraction`, `abstract`, `draft`
(non-Django-framework), or `ams` as a system name were found in the Django
backend's Python files, migration files, or requirements.

No shared database names: this project uses `advocate_db` (PostgreSQL); the
Spring Boot sibling uses `advocate` (MySQL). They are different databases on
different engines.

No shared secrets by name found. No duplicated model definitions that look
copy-pasted from a sibling project.

---

## 9. Live data profile

**Cannot reach the database.** No database connection is available in this
audit context. All row counts, user counts, and date ranges are skipped.

The email-hash file (`AUDIT_ams_email_hashes.txt`) was **not produced** for the
same reason.

---

## 10. Uncertainty list

1. **`AUTH_USER_MODEL` is not set and Django auth is not installed.** The
   `Advocate` model does not participate in Django's auth system at all. Merging
   this system with another Django project that uses `AbstractUser` will require
   a complete auth rearchitecture — the two user tables are incompatible.

2. **The Django backend targets PostgreSQL; the Spring Boot sibling targets
   MySQL.** `LOCAL_DEVELOPMENT.md` and `run-project.bat` describe a
   Spring+MySQL setup. The Django backend's `settings.py` says
   `django.db.backends.postgresql` / `advocate_db`. It is unclear whether the
   PostgreSQL database was ever populated from the MySQL one, or whether both
   are used simultaneously, or whether the Django backend is a standalone
   replacement. A human should verify which database is actually in use and
   whether it contains real data.

3. **Django's development server (`manage.py runserver`) is used as the
   process command.** There is no production WSGI/ASGI server config
   (gunicorn, uvicorn, daphne). Running `runserver` in production is unsafe.

4. **`djangorestframework-simplejwt` is installed but not configured in
   `DEFAULT_AUTHENTICATION_CLASSES`.** The actual JWT work is done by the
   custom `AdvocateJWTAuthentication`. The SimpleJWT package is dead weight;
   it should be confirmed whether it provides anything before removal.

5. **No lockfile.** `requirements.txt` uses wildcard pinning (`5.1.*`, `3.15.*`).
   There is no `pip freeze` output, `poetry.lock`, or `pip-compile`-generated
   file. Exact transitive dependency versions are UNKNOWN without running
   `pip freeze` against the installed venv.

6. **CSRF protection is absent.** `CsrfViewMiddleware` is not in `MIDDLEWARE`.
   All state-mutating endpoints are CSRF-unprotected. This is intentional for
   a pure API (JWT Bearer auth), but must be verified before merging.

7. **`USE_TZ = False`.** Naive datetimes are used throughout, matching the
   Spring `LocalDateTime` columns. Any merged system that uses `USE_TZ = True`
   will need careful datetime handling to avoid UTC-conversion bugs. The
   settings comment explicitly documents this as intentional.

8. **Passwords are BCrypt (`$2a$10$…`), not Django PBKDF2.** Any merge that
   routes users through Django's standard `authenticate()` / `check_password()`
   will fail silently because Django will not recognise the `$2a$` prefix as
   a valid Django hasher. A custom hasher wrapping `bcrypt` (or
   `bcrypt_sha256`) must be registered before any integration.

9. **WhatsApp send is mocked.** `communication/whatsapp.py` `SendManualView`
   records a `MOCK: WhatsApp accepted` response and never calls the Meta Cloud
   API. A real integration would require `whatsapp_access_token` and
   `whatsapp_phone_number_id` from `communication_settings`. A human should
   verify whether real sends are expected.

10. **`DOCUMENT_UPLOAD_DIR` defaults to `../Advocate-app-BE-main/uploads/`**
    — a path relative to the Django project that assumes the repo layout is
    exactly as packaged. In any deployment where the Spring sibling is absent
    or at a different path, document serving/upload will break.

11. **`EMAIL_HOST_PASSWORD` has a hardcoded default in `settings.py`.**
    The default value of `MAIL_PASSWORD` is a literal app-password string.
    A human should confirm whether this credential is production-live and
    rotate it if so.

12. **Migration tree cleanliness (UNKNOWN).** Could not run
    `makemigrations --check --dry-run`. Visual inspection of the two managed
    apps (`appeals`, `workspace`) shows their migrations are consistent with
    their models, but this should be verified against a live environment.

13. **`Advocate.id` is a `BigAutoField` sourced from the pre-existing Spring
    sequence.** If rows are inserted by both the Spring and Django backends
    simultaneously, sequence conflicts may occur. The mechanism for keeping
    the two backends from colliding on the same sequence is not documented.

14. **`recovery-codes.txt`** is present at the repo root. Its contents were
    not examined to avoid leaking sensitive data, but its presence should be
    reviewed before this repo is shared with other systems.
