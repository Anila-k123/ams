# Most account data lives in core.models (shared, managed=False).
from django.db import models


class AuthAttempt(models.Model):
    """One login or password-reset-code attempt, kept to stop guessing.

    Stored in the database rather than the cache: the cache is per process
    (LocMem), so with several server threads/processes a cache counter could be
    sidestepped. accounts/throttle.py reads and prunes these rows.
    """
    LOGIN = 'LOGIN'
    OTP = 'OTP'
    PLATFORM = 'PLATFORM'
    KINDS = [(LOGIN, 'Login'), (OTP, 'Password-reset code'), (PLATFORM, 'Platform operator login')]

    kind = models.CharField(max_length=8, choices=KINDS)
    key = models.CharField(max_length=254)          # lower-cased email
    ip = models.CharField(max_length=45, blank=True, default='')
    success = models.BooleanField(default=False)
    at = models.DateTimeField()

    class Meta:
        db_table = 'auth_attempt'
        indexes = [models.Index(fields=['kind', 'key', 'at'], name='auth_attempt_key_at'),
                   models.Index(fields=['kind', 'ip', 'at'], name='auth_attempt_ip_at')]


class AuthTokenState(models.Model):
    """Per-identity token version (core/session.py). Every login token carries
    the version it was issued under (`tv`); bumping the version revokes every
    token issued before - logout, password change/reset, deactivation, account
    closure, an admin's "sign out everywhere". Account-wide on purpose: logging
    out on one device signs that person out on all devices."""
    advocate_id = models.BigIntegerField(primary_key=True)
    token_version = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)
    last_reason = models.CharField(max_length=40, blank=True, default='')

    class Meta:
        db_table = 'auth_token_state'
