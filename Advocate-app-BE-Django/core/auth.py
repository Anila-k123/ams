"""Custom DRF authentication: decode the Bearer JWT, then re-validate everything
it claims against the database (core/jwt.py, core/session.py, core/tenant.py),
and attach trusted context to the request:

    request.user          the Advocate
    request.firm          the Firm it acts for (firm mode; else its firm if any)
    request.membership    the FirmMembership
    request._advocate_permissions   effective permissions (firm-owned roles)

A token is refused when: its signature / algorithm / expiry / audience is
wrong; the user is gone or deactivated; its token version is not current
(logout, password change, revocation); its firm or membership claims don't
match the user's current ACTIVE membership; or (firm mode) that membership or
its firm is not ACTIVE. The claims never grant anything on their own.
"""

import jwt
from django.conf import settings
from rest_framework import authentication, exceptions

from .jwt import decode_token
from .models import Advocate


def resolve_token(token):
    """(advocate, membership, firm) for a valid token, or raise
    AuthenticationFailed. Shared by the DRF class and signed document links."""
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise exceptions.AuthenticationFailed('Token expired')
    except jwt.PyJWTError:
        raise exceptions.AuthenticationFailed('Invalid token')
    return validate_claims(payload)


def validate_claims(payload):
    advocate_id = payload.get('advocateId')
    advocate = Advocate.objects.filter(id=advocate_id).first() if advocate_id is not None else None
    if advocate is None or (payload.get('sub') and payload.get('sub') != advocate.email):
        raise exceptions.AuthenticationFailed('Invalid token')
    # An advocate who has left keeps their row (their work stays with the
    # practice) but loses access: every token issued before stops at once.
    if getattr(advocate, 'left_on', None) is not None:
        raise exceptions.AuthenticationFailed('This account is no longer active.')
    from .session import token_version
    if int(payload.get('tv', 0) or 0) != token_version(advocate.id):
        raise exceptions.AuthenticationFailed('Your session has ended. Please sign in again.')

    membership = firm = None
    if settings.TENANCY_COLUMNS:
        from . import tenant
        membership = tenant.active_membership(advocate.id)
        firm = membership.firm if membership else None
        claimed_mid, claimed_fid = payload.get('mid'), payload.get('fid')
        if claimed_mid is not None or claimed_fid is not None:
            # Claims must describe the CURRENT membership exactly.
            if (membership is None or claimed_mid != membership.id
                    or claimed_fid != str(firm.public_id)):
                raise exceptions.AuthenticationFailed('Your session is no longer valid. Please sign in again.')
        if settings.TENANCY_MODE == 'firm':
            try:
                tenant.resolve_firm(advocate)
            except tenant.TenantError as exc:
                raise exceptions.AuthenticationFailed(str(exc))
            if claimed_mid is None and not payload.get('_legacy'):
                raise exceptions.AuthenticationFailed('Your session is no longer valid. Please sign in again.')
    return advocate, membership, firm


class AdvocateJWTAuthentication(authentication.BaseAuthentication):
    keyword = 'Bearer'

    def authenticate(self, request):
        header = authentication.get_authorization_header(request).decode('utf-8')
        if not header or not header.startswith(self.keyword + ' '):
            return None  # no credentials -> DRF treats as unauthenticated

        token = header[len(self.keyword) + 1:].strip()
        advocate, membership, firm = resolve_token(token)

        # Client users (the Client role) may only reach the allowlisted client API;
        # everything else is refused here, for every endpoint at once.
        from clientaccess.gate import enforce
        enforce(request, advocate)

        # Trusted context, from the database - never from the token or request.
        request.firm = firm
        request.membership = membership
        request._advocate_permissions = advocate.permission_codes()
        return (advocate, token)

    def authenticate_header(self, request):
        return self.keyword
