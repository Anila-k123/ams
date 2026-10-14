"""Time-based one-time passwords (RFC 6238, SHA-1, 6 digits, 30 s) for platform
operator MFA. Standard library only, compatible with Google Authenticator,
Microsoft Authenticator, 1Password etc.

`verify` returns the time step that matched, so the caller can refuse the same
code twice (replay) by remembering the last step used.
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

STEP = 30
DIGITS = 6


def new_secret():
    return base64.b32encode(secrets.token_bytes(20)).decode('ascii').rstrip('=')


def _code(secret, step):
    key = base64.b32decode(secret + '=' * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack('>Q', step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(value % (10 ** DIGITS)).zfill(DIGITS)


def current_step(at=None):
    return int((at if at is not None else time.time()) // STEP)


def code_at(secret, at=None):
    return _code(secret, current_step(at))


def verify(secret, code, at=None, window=1):
    """The matching time step, or None. Accepts one step of clock drift."""
    code = (code or '').strip().replace(' ', '')
    if not secret or len(code) != DIGITS or not code.isdigit():
        return None
    now = current_step(at)
    for step in range(now - window, now + window + 1):
        if hmac.compare_digest(_code(secret, step), code):
            return step
    return None


def provisioning_uri(secret, account, issuer='AMS Platform'):
    return (f'otpauth://totp/{quote(issuer)}:{quote(account)}?secret={secret}'
            f'&issuer={quote(issuer)}&digits={DIGITS}&period={STEP}')
