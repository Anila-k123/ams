"""Brute-force protection for login and password-reset codes.

Login: after LOGIN_MAX_FAILURES wrong passwords for one email (or
LOGIN_MAX_FAILURES_PER_IP from one address) within LOGIN_LOCKOUT_MINUTES, further
attempts are refused with 429 until the window passes - even with the right
password, so guessing gains nothing.

Reset codes: after OTP_MAX_FAILURES wrong codes for one email, every live code
for that email is burned; a new one must be requested (itself rate-limited).
"""
import datetime
import functools
import logging
import math

from django.conf import settings
from django.db import DatabaseError

from .models import AuthAttempt

log = logging.getLogger(__name__)


def _table_missing_safe(default):
    """Until migration accounts.0001 is applied to a database, its auth_attempt
    table is absent. Sign-in must keep working there, so the counters are
    skipped (loudly) instead of turning every login into a 500."""
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            try:
                return fn(*args, **kwargs)
            except DatabaseError:
                log.error('Login/OTP attempt counting is OFF: table auth_attempt is missing. '
                          'Apply migration accounts.0001_initial.')
                return default
        return wrapper
    return deco


def _now():
    return datetime.datetime.now()


def client_ip(request):
    return (request.META.get('REMOTE_ADDR') or '')[:45]


def _window_start(minutes):
    return _now() - datetime.timedelta(minutes=minutes)


@_table_missing_safe(0)
def login_retry_after(email, ip, kind=AuthAttempt.LOGIN):
    """Seconds until this email/address may try again, or 0 if not locked."""
    if not settings.LOGIN_LOCKOUT_ENABLED:
        return 0
    minutes = settings.LOGIN_LOCKOUT_MINUTES
    start = _window_start(minutes)
    failures = AuthAttempt.objects.filter(kind=kind, success=False, at__gte=start)
    by_email = failures.filter(key=email.lower())
    by_ip = failures.filter(ip=ip) if ip else failures.none()
    locked = None
    if by_email.count() >= settings.LOGIN_MAX_FAILURES:
        locked = by_email
    elif by_ip.count() >= settings.LOGIN_MAX_FAILURES_PER_IP:
        locked = by_ip
    if locked is None:
        return 0
    oldest = locked.order_by('at').values_list('at', flat=True).first()
    remaining = (oldest + datetime.timedelta(minutes=minutes) - _now()).total_seconds()
    return max(1, math.ceil(remaining))


@_table_missing_safe(None)
def record_login(email, ip, success, kind=AuthAttempt.LOGIN):
    AuthAttempt.objects.create(kind=kind, key=email.lower(), ip=ip,
                               success=success, at=_now())
    if success:
        # A correct password clears this email's failure count.
        AuthAttempt.objects.filter(kind=kind, key=email.lower(), success=False).delete()
    _prune()


@_table_missing_safe(0)
def otp_failures(email):
    return AuthAttempt.objects.filter(kind=AuthAttempt.OTP, key=email.lower(), success=False,
                                      at__gte=_window_start(settings.OTP_EXPIRY_MINUTES)).count()


@_table_missing_safe(None)
def record_otp_failure(email, ip):
    AuthAttempt.objects.create(kind=AuthAttempt.OTP, key=email.lower(), ip=ip, success=False, at=_now())


@_table_missing_safe(None)
def clear_otp_failures(email):
    AuthAttempt.objects.filter(kind=AuthAttempt.OTP, key=email.lower()).delete()


def _prune():
    """Keep the table small: nothing older than a day matters."""
    AuthAttempt.objects.filter(at__lt=_now() - datetime.timedelta(days=1)).delete()
