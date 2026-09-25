"""Firm letterhead for exported drafts, read straight from AMS (no API call now that
drafting runs inside AMS). Uses the practice OWNER's branding, like the AMS invoice
and report PDFs (reports/views.py::_branding). Returns the dict render_session_docx
expects: profile fields plus image bytes under 'logo' / 'signature' / 'seal'.
Missing images are simply left out."""

import os

from django.conf import settings

from core.models import Advocate
from core.practice import practice_root

_IMAGES = {'logo': 'office_logo_path', 'signature': 'signature_path', 'seal': 'office_seal_path'}


def _read(rel):
    if not rel:
        return None
    try:
        with open(os.path.join(settings.DOCUMENT_UPLOAD_DIR, rel), 'rb') as fh:
            return fh.read()
    except OSError:
        return None


def firm_branding(user):
    owner = Advocate.objects.filter(id=practice_root(user)).first() or user
    out = {'fullName': user.full_name, 'barCouncilId': user.bar_council_id,
           'officeName': owner.office_name, 'officeAddress': owner.office_address,
           'address': owner.address, 'city': owner.city, 'state': owner.state, 'pinCode': owner.pin_code,
           'gstNumber': owner.gst_number, 'panNumber': owner.pan_number}
    for key, field in _IMAGES.items():
        data = _read(getattr(owner, field, None))
        if data:
            out[key] = data
    return out
