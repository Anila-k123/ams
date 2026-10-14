"""Platform operator tokens and request authentication.

Audience 'ams-platform' - firm tokens (aud 'ams') are refused here, and
platform tokens are refused by the firm API (core/jwt.py requires aud 'ams').
Lifetime PLATFORM_TOKEN_MINUTES (60). Every request re-checks the operator is
active and the token version is current (logout, password change, disabling).
"""
from datetime import datetime, timedelta, timezone

import jwt
from django.conf import settings
from rest_framework import authentication, exceptions, permissions

from .models import PlatformOperator

AUDIENCE = 'ams-platform'


def issue_token(operator):
    now = datetime.now(tz=timezone.utc)
    payload = {'sub': operator.email, 'opid': operator.id, 'tv': operator.token_version,
               'role': operator.role, 'aud': AUDIENCE, 'iat': now,
               'exp': now + timedelta(minutes=settings.PLATFORM_TOKEN_MINUTES)}
    return jwt.encode(payload, settings.JWT_SIGNING_KEY, algorithm=settings.JWT_ALGORITHM)


class PlatformJWTAuthentication(authentication.BaseAuthentication):
    keyword = 'Bearer'

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).decode('utf-8')
        if not header.startswith(self.keyword + ' '):
            return None
        token = header[len(self.keyword) + 1:].strip()
        try:
            payload = jwt.decode(token, settings.JWT_SIGNING_KEY, algorithms=[settings.JWT_ALGORITHM],
                                 audience=AUDIENCE, options={'require': ['exp', 'iat', 'aud', 'opid']})
        except jwt.ExpiredSignatureError:
            raise exceptions.AuthenticationFailed('Token expired')
        except jwt.PyJWTError:
            raise exceptions.AuthenticationFailed('Invalid token')
        op = PlatformOperator.objects.filter(id=payload['opid']).first()
        if op is None or not op.is_active or payload.get('sub') != op.email:
            raise exceptions.AuthenticationFailed('Invalid token')
        if int(payload.get('tv', -1)) != op.token_version:
            raise exceptions.AuthenticationFailed('Your session has ended. Please sign in again.')
        return (op, token)

    def authenticate_header(self, request):
        return self.keyword


def RequireOperator(action):
    """DRF permission: an authenticated platform operator whose role allows `action`."""
    class _Perm(permissions.BasePermission):
        message = 'Your platform role does not allow this.'

        def has_permission(self, request, view):
            op = request.user
            return isinstance(op, PlatformOperator) and op.can(action)
    _Perm.__name__ = f'RequireOperator_{action}'
    return _Perm


def audit(request, action, firm_id=None, success=True, detail=None, operator=None, email=''):
    from .models import PlatformAudit
    op = operator if operator is not None else getattr(request, 'user', None)
    if not isinstance(op, PlatformOperator):
        op = None
    PlatformAudit.objects.create(
        operator_id=getattr(op, 'id', None), operator_email=(getattr(op, 'email', '') or email)[:254],
        action=action, firm_id=firm_id, success=success, detail=detail or {},
        ip=((request.META.get('REMOTE_ADDR') if request is not None else '') or '')[:45])
