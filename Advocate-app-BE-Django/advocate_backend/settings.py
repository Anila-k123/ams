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
    'dictionary',
    'drafting',
    'clientaccess',
    'lawcodes',
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
        # Reuse a connection across requests instead of opening one per request.
        'CONN_MAX_AGE': config('DB_CONN_MAX_AGE', default=60, cast=int),
        'CONN_HEALTH_CHECKS': True,
    },
    # The drafting app (merged from InstaDraft) keeps its own database for now:
    # InstaDraft's existing one (templates, documents, drafts, in schema "drf",
    # pgvector). DraftingRouter sends only the drafting app here.
    'drafting': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': config('DRAFTING_DB_NAME', default='pactpro'),
        'USER': config('DRAFTING_DB_USER', default=config('DB_USER', default='postgres')),
        'PASSWORD': config('DRAFTING_DB_PASSWORD', default=config('DB_PASSWORD', default='psql_password')),
        'HOST': config('DRAFTING_DB_HOST', default=config('DB_HOST', default='localhost')),
        'PORT': config('DRAFTING_DB_PORT', default=config('DB_PORT', default='5432')),
        'CONN_MAX_AGE': config('DB_CONN_MAX_AGE', default=60, cast=int),
        'CONN_HEALTH_CHECKS': True,
    },
}
DATABASE_ROUTERS = ['drafting.router.DraftingRouter']

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

# --- Client role (clientaccess app): where set-password links point (the AMS frontend) ---
CLIENT_APP_URL = config('CLIENT_APP_URL', default='http://localhost:5173')

# --- CORS: the frontend origin(s). Dev: the Vite server; production: set CORS_ORIGINS ---
CORS_ALLOWED_ORIGINS = config(
    'CORS_ORIGINS',
    default='http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174',
    cast=Csv(),
)
CORS_ALLOW_CREDENTIALS = True

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

# --- Document AI summaries: on upload we extract text (PDF/DOCX/TXT) and ask the
# assistant LLM (LLM_PROVIDER) for a structured legal summary, stored in the
# document_summary table. Turn off with SUMMARY_ENABLED=False. ---
SUMMARY_ENABLED = config('SUMMARY_ENABLED', default=True, cast=bool)
SUMMARY_MAX_CHARS = config('SUMMARY_MAX_CHARS', default=24000, cast=int)

# --- Public base URL: how outside clients (e.g. an email recipient's inbox)
# reach this server for public assets like the firm logo in branded emails.
# In production set this to the real https host; localhost won't load remotely. ---
PUBLIC_BASE_URL = config('PUBLIC_BASE_URL', default='http://localhost:8080')

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
        'drafting': {'handlers': ['console'], 'level': 'INFO', 'propagate': False},
    },
}

# Max upload size ~ 25MB per file (matches Spring config)
DATA_UPLOAD_MAX_MEMORY_SIZE = 52428800
FILE_UPLOAD_MAX_MEMORY_SIZE = 26214400

# =============================================================================
# Drafting (merged from InstaDraft) — consumed ONLY through drafting/providers/.
# Environment variables are prefixed DRAFTING_: the AMS assistant (assistant/llm.py)
# already reads LLM_PROVIDER / LLM_MODEL / GEMINI_* / OPENAI_* with a different
# meaning, so the two must not share names. The Django setting names below are the
# ones InstaDraft's code reads, so that code is unchanged.
# =============================================================================
def _d(name, default='', cast=None):
    return config(f'DRAFTING_{name}', default=default, **({'cast': cast} if cast else {}))


# LLM_PROVIDER: 'anthropic' | 'openai' (OpenAI-compatible /v1) | 'ollama' (native)
LLM_PROVIDER = _d('LLM_PROVIDER', 'anthropic')
LLM_MODEL = _d('LLM_MODEL', 'claude-sonnet-4-6')
LLM_BASE_URL = _d('LLM_BASE_URL', '')
LLM_OPENAI_PATH = _d('LLM_OPENAI_PATH', '/v1/chat/completions')
LLM_API_KEY = _d('LLM_API_KEY', '')
LLM_TEMPERATURE = _d('LLM_TEMPERATURE', 0.2, float)
LLM_SEED = _d('LLM_SEED', '')
ANTHROPIC_API_KEY = _d('ANTHROPIC_API_KEY', '')
ANTHROPIC_MODEL = _d('ANTHROPIC_MODEL', 'claude-sonnet-4-6')
GEMINI_API_KEY = _d('GEMINI_API_KEY', '')
GEMINI_MODEL = _d('GEMINI_MODEL', 'gemini-2.0-flash')
GEMINI_BASE_URL = _d('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta/openai')
OPENAI_API_KEY = _d('OPENAI_API_KEY', '')
OPENAI_MODEL = _d('OPENAI_MODEL', 'gpt-4o')
OPENAI_BASE_URL = _d('OPENAI_BASE_URL', 'https://api.openai.com')
# Active LLM for drafting + playbooks ('openai' | 'gemini' | 'local').
LLM_ACTIVE = _d('LLM_ACTIVE', 'openai')
LLM_PLAYBOOK = LLM_ACTIVE
# EMBED_DIM MUST equal SampleClause.embedding's VectorField dimension (768).
EMBED_MODEL = _d('EMBED_MODEL', 'nomic-ai/nomic-embed-text-v1')
EMBED_DIM = _d('EMBED_DIM', 768, int)
USE_DOCLING = _d('USE_DOCLING', True, bool)
OLLAMA_BASE_URL = _d('OLLAMA_BASE_URL', 'http://ollama-server:11434')
SARVAM_API_KEY = _d('SARVAM_API_KEY', '')
SARVAM_MODEL = _d('SARVAM_MODEL', 'sarvam-translate:v1')
SARVAM_MODE = _d('SARVAM_MODE', 'formal')
GOOGLE_TRANSLATE_API_KEY = _d('GOOGLE_TRANSLATE_API_KEY', '')
HF_TOKEN = _d('HF_TOKEN', '')
if HF_TOKEN:
    import os as _os
    _os.environ.setdefault('HF_TOKEN', HF_TOKEN)
    _os.environ.setdefault('HUGGING_FACE_HUB_TOKEN', HF_TOKEN)

# Uploaded drafting files (templates, reference documents). Defaults to InstaDraft's
# media folder, where the existing files in the drafting database live.
MEDIA_URL = '/media/'
MEDIA_ROOT = _d('MEDIA_ROOT', str(BASE_DIR.parent.parent / 'Desktop' / 'pact-pro-draft' / 'backend' / 'media'))

# Drafting background jobs (drafting/jobs.py, docs/OPERATIONS.md).
# PERMANENT SOLUTION: Redis + a Celery worker, with CELERY_TASK_ALWAYS_EAGER=False.
# STOPGAP until then (True): jobs run in a separate worker process on this machine
# (DRAFTING_JOB_RUNNER=process), not in the web server, so pages stay responsive.
CELERY_TASK_ALWAYS_EAGER = config('CELERY_TASK_ALWAYS_EAGER', default=True, cast=bool)
DRAFTING_JOB_RUNNER = config('DRAFTING_JOB_RUNNER', default='process')   # 'process' | 'thread'
DRAFTING_JOB_WORKERS = config('DRAFTING_JOB_WORKERS', default=1, cast=int)
CELERY_TASK_EAGER_PROPAGATES = False
CELERY_BROKER_URL = config('REDIS_URL', default='redis://localhost:6379/0')
CELERY_RESULT_BACKEND = config('REDIS_URL', default='redis://localhost:6379/0')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = 'Asia/Kolkata'

# Let the frontend read download filenames (DOCX export).
CORS_EXPOSE_HEADERS = ['Content-Disposition']
