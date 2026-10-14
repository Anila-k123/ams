"""JWT issue/decode. HS256, signed with settings.JWT_SIGNING_KEY (its own setting;
SECRET_KEY only as a fallback).

Claims: sub (email - the frontend reads it), advocateId, email, fid (the firm's
public uuid), mid (the membership id), tv (token version, core/session.py),
aud ('ams'), iat, exp. Lifetime: JWT_EXPIRATION, capped at
ACCESS_TOKEN_MAX_HOURS (8 h).

The firm claims are a consistency check, never a source of authority:
core/auth.py re-reads the membership and firm from the database on every
request and refuses a token whose claims disagree.

Legacy tokens (no aud / firm claims, issued before Phase 4) are refused, unless
JWT_ACCEPT_LEGACY_UNTIL (ISO datetime) is set and not yet passed - and even
then they go through every membership, firm and version check.
"""

from datetime import datetime, timedelta, timezone

import jwt
from django.conf import settings

AUDIENCE = 'ams'


def _lifetime():
    cap = timedelta(hours=settings.ACCESS_TOKEN_MAX_HOURS)
    return min(settings.JWT_EXPIRATION, cap)


def generate_token(advocate) -> str:
    """A token for `advocate`, bound to their current active membership."""
    from core.session import token_version
    now = datetime.now(tz=timezone.utc)
    payload = {
        'sub': advocate.email,          # frontend reads this (dashboard cache key)
        'advocateId': advocate.id,
        'email': advocate.email,
        'tv': token_version(advocate.id),
        'aud': AUDIENCE,
        'iat': now,
        'exp': now + _lifetime(),
    }
    if settings.TENANCY_COLUMNS:
        from core import tenant
        m = tenant.active_membership(advocate.id)
        if m is not None:
            payload['fid'] = str(m.firm.public_id)
            payload['mid'] = m.id
    return jwt.encode(payload, settings.JWT_SIGNING_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Verify signature, algorithm, expiry and audience. Raises jwt.PyJWTError
    (incl. ExpiredSignatureError) on anything invalid."""
    try:
        return jwt.decode(token, settings.JWT_SIGNING_KEY, algorithms=[settings.JWT_ALGORITHM],
                          audience=AUDIENCE, options={'require': ['exp', 'iat', 'aud']})
    except jwt.MissingRequiredClaimError:
        until = settings.JWT_ACCEPT_LEGACY_UNTIL
        if until and datetime.now() < until:
            payload = jwt.decode(token, settings.JWT_SIGNING_KEY, algorithms=[settings.JWT_ALGORITHM],
                                 options={'require': ['exp'], 'verify_aud': False})
            if 'aud' not in payload:
                payload['_legacy'] = True
                return payload
        raise
