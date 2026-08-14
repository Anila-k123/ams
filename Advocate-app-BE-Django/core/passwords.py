"""BCrypt password helpers. The existing advocate passwords are Spring BCrypt
hashes ($2a$...). We verify/create with the bcrypt library directly (not Django's
PBKDF2), so existing accounts keep working and new signups stay Spring-compatible.
"""

import bcrypt


def verify_password(raw: str, hashed: str) -> bool:
    if not raw or not hashed:
        return False
    try:
        return bcrypt.checkpw(raw.encode('utf-8'), hashed.encode('utf-8'))
    except (ValueError, TypeError):
        return False


def hash_password(raw: str) -> str:
    # rounds=10 matches Spring's default BCryptPasswordEncoder strength.
    return bcrypt.hashpw(raw.encode('utf-8'), bcrypt.gensalt(rounds=10)).decode('utf-8')
