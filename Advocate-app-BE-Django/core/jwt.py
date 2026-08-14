"""JWT issue/decode. Tokens carry `sub` (email) and `exp` because the React
frontend runs jwtDecode() and reads both. HS256, signed with Django SECRET_KEY.
"""

from datetime import datetime, timezone
import jwt
from django.conf import settings


def generate_token(advocate) -> str:
    now = datetime.now(tz=timezone.utc)
    payload = {
        'sub': advocate.email,          # frontend reads this (dashboard cache key)
        'advocateId': advocate.id,
        'email': advocate.email,
        'iat': now,
        'exp': now + settings.JWT_EXPIRATION,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    """Raises jwt.PyJWTError (incl. ExpiredSignatureError) on invalid/expired tokens."""
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
