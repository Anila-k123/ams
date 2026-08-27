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

WHATSAPP_VERIFY_TOKEN = config('WHATSAPP_VERIFY_TOKEN', default='AdvocateApp2026SecureToken')

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

# --- Email (SMTP) — used for password-reset OTP. Defaults to the project's Gmail. ---
# If sending fails (e.g. bad creds / no network), the OTP flow still works: the OTP
# is stored and also printed to the server console so dev testing isn't blocked.
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = config('MAIL_HOST', default='smtp.gmail.com')
EMAIL_PORT = config('MAIL_PORT', default=587, cast=int)
EMAIL_USE_TLS = True
EMAIL_HOST_USER = config('MAIL_USERNAME', default='chilladvocate@gmail.com')
EMAIL_HOST_PASSWORD = config('MAIL_PASSWORD', default='npqn ghoj xqmn swgf')
DEFAULT_FROM_EMAIL = config('NOTIFICATION_SENDER_NAME', default='Advocate Case Management System') + ' <' + EMAIL_HOST_USER + '>'
EMAIL_TIMEOUT = 8

# --- OTP ---
OTP_SALT = config('OTP_SALT', default='Adv0c@t3ApP_OtpS#lt!2026')
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
