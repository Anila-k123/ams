"""Private branding images: an advocate's signature and office seal.

Logos and profile photos are public (emails and the client portal show them).
A signature or seal is a signing instrument, so it is served only through a
short-lived signed link handed out by the profile serializer. An <img> tag
cannot send the Bearer token, hence a signed URL rather than a header.
"""
import os

from django.core import signing
from django.db.models import Q

from core.models import Advocate

_SALT = 'ams.branding.private'
LINK_SECONDS = 3600


def signed_query(filename):
    return 'sig=' + signing.TimestampSigner(salt=_SALT).sign(filename).split(':', 1)[1]


def valid_signature(filename, sig):
    if not sig:
        return False
    try:
        signing.TimestampSigner(salt=_SALT).unsign(f'{filename}:{sig}', max_age=LINK_SECONDS)
        return True
    except signing.BadSignature:
        return False


def is_private(filename):
    """True when the file is someone's signature or seal."""
    name = os.path.basename(filename)
    return Advocate.objects.filter(
        Q(signature_path__endswith=name) | Q(office_seal_path__endswith=name)).exists()
