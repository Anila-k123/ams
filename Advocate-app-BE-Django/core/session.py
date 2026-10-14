"""Session state: token versions (revocation) and authentication security events.

Revocation model: one version number per identity (accounts.AuthTokenState).
Every token carries the version it was issued under (`tv`); core/auth.py
refuses a token whose version is not current. Bumping it therefore ends EVERY
session of that person (all devices) - logout, password change or reset,
deactivation, account closure, or an administrator's "sign out everywhere".

Membership / firm suspension and role changes need no bump: they are checked
against the database on every request.
"""
from __future__ import annotations

import datetime
import json
import logging

from django.db import DatabaseError

log = logging.getLogger('core.session')

# Reasons recorded with a revocation (never secrets).
LOGOUT, PASSWORD_CHANGE, PASSWORD_RESET, DEACTIVATED, CLOSED, ADMIN_REVOKE, MEMBERSHIP_SUSPENDED, \
    FIRM_SUSPENDED = ('LOGOUT', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'DEACTIVATED', 'CLOSED',
                      'ADMIN_REVOKE', 'MEMBERSHIP_SUSPENDED', 'FIRM_SUSPENDED')


def token_version(advocate_id):
    from accounts.models import AuthTokenState
    try:
        return (AuthTokenState.objects.filter(advocate_id=advocate_id)
                .values_list('token_version', flat=True).first()) or 0
    except DatabaseError:            # migration accounts.0002 not applied yet
        return 0


def revoke_all(advocate_id, reason):
    """End every session of this identity. Returns the new version."""
    from accounts.models import AuthTokenState
    from django.db.models import F
    try:
        state, created = AuthTokenState.objects.get_or_create(advocate_id=advocate_id,
                                                              defaults={'token_version': 1, 'last_reason': reason})
        if not created:
            AuthTokenState.objects.filter(advocate_id=advocate_id).update(
                token_version=F('token_version') + 1, last_reason=reason)
        return token_version(advocate_id)
    except DatabaseError:
        log.error('Token revocation is OFF: table auth_token_state is missing. '
                  'Apply migration accounts.0002.')
        return 0


# ---------------------------------------------------------- security audit ----
def security_event(action, request=None, actor=None, email=None, firm_id=None, success=True,
                   detail=None, title=None):
    """One audit_log row (module AUTH) for a security-relevant event.

    Records who (actor id / the email that was tried), which firm, when, from
    where and what happened. Never passwords, OTPs, tokens, signing keys or
    document contents - callers pass only ids and short facts in `detail`."""
    from core.models import AuditLog
    meta = request.META if request is not None else {}
    try:
        if firm_id is None and actor is not None:
            from django.conf import settings
            if settings.TENANCY_COLUMNS:
                from core import tenant
                firm_id = tenant.firm_id_of_advocate(actor.id)
        row = dict(
            action_type=action, title=(title or action.replace('_', ' ').title())[:255], module='AUTH',
            entity_type='Advocate', entity_id=getattr(actor, 'id', None),
            status='SUCCESS' if success else 'FAILED',
            user_name=(getattr(actor, 'email', None) or (email or ''))[:255] or None,
            ip_address=(meta.get('REMOTE_ADDR') or '')[:255] or None,
            browser=(meta.get('HTTP_USER_AGENT') or '')[:255] or None,
            request_method=getattr(request, 'method', None),
            request_uri=(request.path if request is not None else None),
            metadata=json.dumps(detail or {}, default=str)[:4000],
            created_at=datetime.datetime.now(), advocate_id=getattr(actor, 'id', None))
        if firm_id is not None:
            row['firm_id'] = firm_id
        AuditLog.objects.create(**row)
    except Exception:                                          # noqa: BLE001
        # Auditing must never break sign-in; the failure itself is logged.
        log.exception('security audit write failed for %s', action)


# --------------------------------------------------------- workspace check ----
def validate_workspace(advocate, firm_public_id):
    """The ACTIVE membership of `advocate` in the firm with this public id, or
    raise TenantError. The single check a future workspace-switch endpoint must
    use (launch rule: one active membership, so there is nothing to switch to)."""
    from core import tenant
    from firms.models import FirmMembership
    m = (FirmMembership.objects.select_related('firm')
         .filter(advocate_id=advocate.id, firm__public_id=firm_public_id).first())
    if m is None or m.status != FirmMembership.ACTIVE:
        raise tenant.TenantAccessDenied('You are not an active member of that firm.')
    if not m.firm.is_active:
        raise tenant.TenantAccessDenied('That firm is not active.')
    return m
