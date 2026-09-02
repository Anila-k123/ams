"""
Django settings for the advocate_backend project.

This is a drop-in replacement for the original Spring Boot backend. It talks to
the SAME PostgreSQL database (advocate_db) using unmanaged models, and reproduces
the exact REST contract the React frontend already depends on. Config is read from
a .env file via python-decouple.
"""

from pathlib import Path
from datetime import timedelta
from decouple import config, Csv

BASE_DIR = Path(__file__).resolve().parent.parent

# --- Core security / debug ---
SECRET_KEY = config('SECRET_KEY', default='django-insecure-advocate-dev-key-change-me')
DEBUG = config('DEBUG', default=True, cast=bool)
ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost,127.0.0.1', cast=Csv())

# --- Applications ---
INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.staticfiles',
    # Third-party
    'rest_framework',
    'corsheaders',
    'channels',
    # Local
    'core',
    'accounts',
    'clients',
    'cases',
    'events',
    'documents',
    'dashboard',
    'notifications',
    'rbac',
    'expenses',
    'invoices',
    'payments',
    'search',
    'reports',
    'audit',
    'backup',
    'communication',
    'assistant',
    'appeals',
    'workspace',
    'courtsearch',
    'acts',
]

# Webhook verification token. No default: it was a committed literal, and a
# published verify token lets anyone complete Meta's webhook handshake.
WHATSAPP_VERIFY_TOKEN = config('WHATSAPP_VERIFY_TOKEN', default='')

# WhatsApp is off. There is no Meta integration behind it - the sender was a
# mock that recorded 'SENT' without sending - so the channel is disabled
# outright rather than left looking available. Flip this when the Business API
# account and message templates are actually approved.
WHATSAPP_ENABLED = config('WHATSAPP_ENABLED', default=False, cast=bool)

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
    # Records state-changing API calls into audit_log / activities. Last in the
    # chain so it sees the final response status; it reads request.user, which
    # DRF populates during view dispatch.
    'core.audit_middleware.AuditLogMiddleware',
]

ROOT_URLCONF = 'advocate_backend.urls'
WSGI_APPLICATION = 'advocate_backend.wsgi.application'
ASGI_APPLICATION = 'advocate_backend.asgi.application'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {'context_processors': []},
    },
]

# --- Database: the existing advocate_db (models are managed=False) ---
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': config('DB_NAME', default='advocate_db'),
        'USER': config('DB_USER', default='postgres'),
        'PASSWORD': config('DB_PASSWORD', default='psql_password'),
        'HOST': config('DB_HOST', default='localhost'),
        'PORT': config('DB_PORT', default='5432'),
    }
}

# --- Django REST Framework ---
# Every request is authenticated via our custom JWT auth (loads the Advocate row);
# public views (login/signup/password-reset) opt out with AllowAny.
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'core.auth.AdvocateJWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'UNAUTHENTICATED_USER': None,
    'DEFAULT_PAGINATION_CLASS': 'core.pagination.SpringStylePagination',
    'PAGE_SIZE': 20,
}

# --- JWT config (consumed by core/jwt.py + core/auth.py) ---
# The frontend jwt-decodes the token and reads `exp` and `sub` (email); it does
# NOT verify the signature, so we sign with our own SECRET_KEY.
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION = timedelta(milliseconds=config('JWT_EXPIRATION_MS', default=86400000, cast=int))

# --- CORS: allow the Vite dev server (5173 taken by another project, so 5174 too) ---
CORS_ALLOWED_ORIGINS = config(
    'CORS_ORIGINS',
    default='http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174',
    cast=Csv(),
)
CORS_ALLOW_CREDENTIALS = True

# --- Channels (wired for parity with pact-pro-draft; WebSockets deferred) ---
CHANNEL_LAYERS = {
    'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
}

# --- Document storage: reuse the existing Spring uploads folder so the 30
# already-uploaded documents download/preview, and new uploads land beside them. ---
DOCUMENT_UPLOAD_DIR = config(
    'DOCUMENT_UPLOAD_DIR',
    default=str(BASE_DIR.parent / 'Advocate-app-BE-main' / 'uploads'),
)

# --- Court PDF cache: order/judgement PDFs a user has already fetched are saved
# here (content-addressed), so re-opening one serves from disk instead of
# re-scraping the portal. A court order is immutable once issued, so this is safe. ---
COURT_PDF_CACHE_DIR = config(
    'COURT_PDF_CACHE_DIR',
    default=str(BASE_DIR / 'court_pdf_cache'),
)

# --- Email (SMTP) ---
# Every outbound message in the app goes through here: password-reset OTPs,
# hearing and invoice reminders, appeal alerts, and the Communication test send.
#
# NO DEFAULT CREDENTIALS. A real Gmail address and app password used to sit in
# this file as fallback values, which meant a live secret was committed to a
# public repository from the first commit onward. Configure MAIL_USERNAME and
# MAIL_PASSWORD in .env, which is gitignored, and nowhere else.
# Backend is selectable via MAIL_BACKEND. Default is real SMTP; set it to
# 'django.core.mail.backends.console.EmailBackend' for local testing, which
# prints each message to the server console instead of sending it.
EMAIL_BACKEND = config('MAIL_BACKEND', default='django.core.mail.backends.smtp.EmailBackend')
EMAIL_HOST = config('MAIL_HOST', default='smtp.gmail.com')
EMAIL_PORT = config('MAIL_PORT', default=587, cast=int)
EMAIL_USE_TLS = config('MAIL_USE_TLS', default=True, cast=bool)
EMAIL_HOST_USER = config('MAIL_USERNAME', default='')
EMAIL_HOST_PASSWORD = config('MAIL_PASSWORD', default='')
# Blank host user means nothing can send. Fail on that explicitly rather than
# letting every send attempt turn into an SMTP error nobody reads. The console
# backend needs no credentials, so it always counts as configured.
_USING_CONSOLE_MAIL = 'console' in EMAIL_BACKEND or 'filebased' in EMAIL_BACKEND
EMAIL_CONFIGURED = _USING_CONSOLE_MAIL or bool(EMAIL_HOST and EMAIL_HOST_USER and EMAIL_HOST_PASSWORD)
DEFAULT_FROM_EMAIL = (
    config('NOTIFICATION_SENDER_NAME', default='Advocate Case Management System')
    + ' <' + (EMAIL_HOST_USER or 'no-reply@localhost') + '>')
EMAIL_TIMEOUT = config('MAIL_TIMEOUT', default=15, cast=int)

# --- Registration ---
# Public self-signup, off by default.
#
# /api/advocates/signup was AllowAny with no authentication, so anyone on the
# internet could create a working account. It got no roles and so could not read
# cases or clients - but 66 endpoints are gated on "any signed-in advocate", and
# those included the Acts corpus and the court-search proxy, which drives the
# scraper against eCourts under this server's IP.
#
# With a User Management page, roles and shared practices, accounts are created
# by an admin. Self-signup also produced accounts that could log in and see an
# empty application, with nothing to explain why.
#
# Turning this on again needs email verification first, and signup must not
# accept a `role` from the request body.
ALLOW_PUBLIC_SIGNUP = config('ALLOW_PUBLIC_SIGNUP', default=False, cast=bool)

# --- Tests ---
# Most models are unmanaged (they map onto Spring-owned tables), so the default
# runner would build a test database with those tables missing. See the module
# docstring for what that means and what it cannot cover.
TEST_RUNNER = 'core.test_runner.ManagedModelTestRunner'

# --- OTP ---
# The literal that used to be here was committed, and a published salt defeats
# the point of salting: an OTP is six digits, so an unsalted SHA-256 of one is
# reversible from a table of a million entries. Falls back to SECRET_KEY, which
# is already required, already secret, and already per-deployment - so this is
# never accidentally blank.
OTP_SALT = config('OTP_SALT', default='') or SECRET_KEY
OTP_EXPIRY_MINUTES = config('OTP_EXPIRY_MINUTES', default=10, cast=int)
OTP_RATE_LIMIT = config('OTP_RATE_LIMIT', default=5, cast=int)

# --- Misc ---
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
LANGUAGE_CODE = 'en-us'
TIME_ZONE = config('TIME_ZONE', default='Asia/Kolkata')
USE_I18N = True
# The DB columns are `timestamp without time zone` (Spring LocalDateTime). Use naive
# local time so Django doesn't implicitly convert to/from UTC (which broke OTP expiry).
USE_TZ = False
STATIC_URL = '/static/'

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'handlers': {'console': {'class': 'logging.StreamHandler'}},
    'loggers': {
        'accounts': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
    },
}

# Max upload size ~ 25MB per file (matches Spring config)
DATA_UPLOAD_MAX_MEMORY_SIZE = 52428800
FILE_UPLOAD_MAX_MEMORY_SIZE = 26214400
