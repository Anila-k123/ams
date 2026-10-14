"""Encryption at rest for small secrets (platform operator TOTP seeds).

Fernet (AES-128-CBC + HMAC-SHA256) with its OWN key, settings.PLATFORM_MFA_KEY -
not SECRET_KEY or the JWT key, so a leak of one doesn't expose the other, and
the key can be kept outside the database backups. Generate one with:

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Without a key, nothing can be encrypted or decrypted: operator creation and
platform login fail closed (they never fall back to plaintext).
"""
from django.conf import settings

PREFIX = 'f1:'


class CryptoUnavailable(RuntimeError):
    pass


def _fernet():
    key = getattr(settings, 'PLATFORM_MFA_KEY', '') or ''
    if not key:
        raise CryptoUnavailable('PLATFORM_MFA_KEY is not set.')
    from cryptography.fernet import Fernet
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except (ValueError, TypeError) as exc:
        raise CryptoUnavailable('PLATFORM_MFA_KEY is not a valid Fernet key.') from exc


def encrypt(plaintext):
    if not plaintext:
        return ''
    return PREFIX + _fernet().encrypt(plaintext.encode()).decode()


def decrypt(stored):
    """The plaintext, or '' when nothing is stored. Raises CryptoUnavailable
    without a key and on a value that wasn't encrypted with it."""
    if not stored:
        return ''
    if not stored.startswith(PREFIX):
        raise CryptoUnavailable('Stored secret is not encrypted (re-enrol MFA).')
    from cryptography.fernet import InvalidToken
    try:
        return _fernet().decrypt(stored[len(PREFIX):].encode()).decode()
    except InvalidToken as exc:
        raise CryptoUnavailable('Stored secret cannot be decrypted with PLATFORM_MFA_KEY.') from exc
