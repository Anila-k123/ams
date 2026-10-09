"""Format checks for the structured values forms collect (GSTIN, PAN, PIN
code, phone, email), shared by every serializer and view that takes them.

The frontend has the same rules in src/utils/validators.ts, so a form says
what's wrong before submitting; the server checks again, because the form is
not the only way in. Each `clean_*` returns the normalised value (uppercase,
spaces removed) or raises ValueError with a message fit to show a user. An
empty value is always allowed: whether a field is required is the caller's
decision, not the format's.
"""

import re

# GST state codes (first two digits of a GSTIN) -> state / UT, spelled as in
# the frontend's INDIAN_STATES list so the form can select the state from it.
GST_STATE_CODES = {
    '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
    '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
    '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh',
    '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
    '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha',
    '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
    # 25 (Daman and Diu) merged into 26 in 2020; older GSTINs still carry it.
    '25': 'Dadra and Nagar Haveli and Daman and Diu',
    '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra',
    # 28 was undivided Andhra Pradesh; still valid on older registrations.
    '28': 'Andhra Pradesh', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep',
    '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
    '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh',
    '38': 'Ladakh', '97': 'Other Territory', '99': 'Centre Jurisdiction',
}

_GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
# 2-digit state code, 10-char PAN, entity number (1-9 or A-Z), 'Z', check char.
_GSTIN_RE = re.compile(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
_PAN_RE = re.compile(r'^[A-Z]{5}[0-9]{4}[A-Z]$')
_PIN_RE = re.compile(r'^[1-9][0-9]{5}$')
_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
# Bank code (4 letters), a zero, then the 6-character branch code.
_IFSC_RE = re.compile(r'^[A-Z]{4}0[A-Z0-9]{6}$')


def _squash(value):
    return re.sub(r'[\s-]+', '', str(value or '')).upper()


def gstin_check_char(first14):
    """The GSTIN check character for its first 14 characters (GSTN's mod-36 scheme)."""
    total = 0
    for i, ch in enumerate(first14):
        v = _GSTIN_CHARS.index(ch) * (2 if i % 2 else 1)
        total += v // 36 + v % 36
    return _GSTIN_CHARS[(36 - total % 36) % 36]


def clean_gstin(value):
    g = _squash(value)
    if not g:
        return ''
    if len(g) != 15:
        raise ValueError('A GSTIN has 15 characters (you entered {}).'.format(len(g)))
    if not _GSTIN_RE.match(g):
        raise ValueError('That is not a GSTIN. The format is 2 digits (state code), '
                         'the 10-character PAN, one character, Z, and a check character, '
                         'e.g. 33ABCDE1234F1Z7.')
    if g[:2] not in GST_STATE_CODES:
        raise ValueError('{} is not a GST state code.'.format(g[:2]))
    if gstin_check_char(g[:14]) != g[14]:
        raise ValueError('This GSTIN fails its check digit; one of the characters is mistyped.')
    return g


def gstin_state(value):
    """The state a (valid) GSTIN belongs to, or None."""
    g = _squash(value)
    return GST_STATE_CODES.get(g[:2]) if len(g) >= 2 else None


def clean_pan(value):
    p = _squash(value)
    if not p:
        return ''
    if not _PAN_RE.match(p):
        raise ValueError('A PAN is 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).')
    return p


def clean_pincode(value):
    p = re.sub(r'\s+', '', str(value or ''))
    if not p:
        return ''
    if not _PIN_RE.match(p):
        raise ValueError('A PIN code is 6 digits and does not start with 0.')
    return p


_MOBILE_RE = re.compile(r'^[6-9]\d{9}$')


def clean_phone(value):
    """An Indian mobile number: exactly 10 digits starting with 6, 7, 8 or 9.
    AMS is used in India only, so no country code is kept: "+91 98765 43210",
    "098765 43210" and "98765-43210" are all saved as "9876543210" (older
    records in those formats still save, tidied)."""
    raw = str(value or '').strip()
    if not raw:
        return ''
    if re.search(r'[^0-9+\s()-]', raw):
        raise ValueError('A mobile number can only contain digits.')
    digits = re.sub(r'\D', '', raw)
    if len(digits) == 12 and digits.startswith('91'):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith('0'):
        digits = digits[1:]
    if len(digits) != 10:
        raise ValueError('A mobile number has 10 digits.')
    if not _MOBILE_RE.match(digits):
        raise ValueError('A mobile number starts with 6, 7, 8 or 9.')
    return digits


def clean_landline(value):
    """An office phone: an Indian mobile or landline (STD code allowed), or an
    international number with a country code. Kept as typed, only checked."""
    raw = str(value or '').strip()
    if not raw:
        return ''
    if re.search(r'[^0-9+\s()-]', raw):
        raise ValueError('A phone number can only contain digits, spaces, +, - and brackets.')
    digits = re.sub(r'\D', '', raw)
    if raw.startswith('+') and not raw.startswith('+91'):
        if not 8 <= len(digits) <= 15:
            raise ValueError('An international number has 8 to 15 digits including the country code.')
        return raw
    national = digits[2:] if digits.startswith('91') and len(digits) == 12 else digits.lstrip('0')
    if len(national) != 10:
        raise ValueError('An Indian phone number has 10 digits (with +91 or a leading 0 optional).')
    return raw


def clean_email(value):
    e = str(value or '').strip()
    if not e:
        return ''
    if not _EMAIL_RE.match(e) or len(e) > 254:
        raise ValueError('That is not a valid email address.')
    return e.lower()


def clean_ifsc(value):
    i = _squash(value)
    if not i:
        return ''
    if not _IFSC_RE.match(i):
        raise ValueError('An IFSC is 11 characters: 4 letters, 0, then 6 letters or digits (e.g. SBIN0001234).')
    return i


# A person's or organisation's name (Client Name): letters in any script,
# digits, spaces and the punctuation real legal names use - initials "K. M.",
# "M/s.", "& Ors.", "D'Souza", "Pillai-Nair", "(in liquidation)", "Ward 15(1)".
# No symbols such as @ # $ % < > or emoji. 2-150 characters, at least one letter.
# Spaces are tidied; capitals are kept as typed. (src/utils/validators.ts nameError)
_NAME_PUNCT = set(" .,&/-'()")


def clean_name(value):
    import unicodedata
    name = ' '.join(str(value or '').split())
    if not name:
        return ''
    for ch in name:
        # Letters and digits in any script, plus the vowel signs / marks that
        # Indian scripts (Tamil, Hindi ...) attach to letters.
        if ch.isalpha() or ch.isdigit() or ch in _NAME_PUNCT or unicodedata.category(ch) in ('Mn', 'Mc'):
            continue
        raise ValueError("Names can use letters, numbers, spaces and . , & / - ' ( ) only.")
    if not any(ch.isalpha() for ch in name):
        raise ValueError('A name must contain at least one letter.')
    if len(name) < 2:
        raise ValueError('A name must be at least 2 characters.')
    if len(name) > 150:
        raise ValueError('A name can be at most 150 characters.')
    return name


def due_date_error(value, label='Due date', not_before=None, not_before_label=None):
    """Message when a due date / deadline being set is in the past (or before
    `not_before`, e.g. the invoice date), else None. Empty is allowed; today is
    allowed. Only for dates being set now: existing overdue records are left alone.
    Mirrors dueDateError() in src/utils/validators.ts."""
    import datetime
    if not value:
        return None
    try:
        day = value if isinstance(value, datetime.date) else datetime.date.fromisoformat(str(value)[:10])
    except ValueError:
        return f'{label} is not a valid date.'
    if day < datetime.date.today():
        return f"{label} can't be in the past."
    if not_before:
        try:
            floor = not_before if isinstance(not_before, datetime.date) else datetime.date.fromisoformat(str(not_before)[:10])
        except ValueError:
            floor = None
        if floor and day < floor:
            return f"{label} can't be before the {not_before_label or 'start date'}."
    return None


def amount_error(value, label='Amount'):
    """Message unless `value` is a money amount above zero (an expense or a payment
    is never negative or nil). Mirrors amountError() in src/utils/validators.ts."""
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return f'Enter the {label.lower()}.'
    if amount != amount or amount in (float('inf'), float('-inf')):
        return f'Enter the {label.lower()}.'
    if amount <= 0:
        return f'{label} must be more than zero.'
    return None


# name -> cleaner, for checking a payload's fields in one call.
CLEANERS = {'gstin': clean_gstin, 'pan': clean_pan, 'pincode': clean_pincode,
            'phone': clean_phone, 'landline': clean_landline, 'name': clean_name, 'email': clean_email, 'ifsc': clean_ifsc}


def error_response(errors):
    """The 400 body for format errors: `error` (the first message, which the
    existing forms already show) plus `errors` keyed by field."""
    from rest_framework import status
    from rest_framework.response import Response
    first = next(iter(errors.values()))
    return Response({'error': first, 'errors': errors}, status=status.HTTP_400_BAD_REQUEST)


def clean_fields(data, spec):
    """Check several fields of a request payload.

    `spec` maps payload key -> kind ('gstin', 'pan', 'pincode', 'phone' (mobile), 'landline',
    'email'). Returns (cleaned, errors): cleaned values for the keys present,
    and {key: message} for the ones that failed. Keys not in `data` are skipped.
    """
    cleaned, errors = {}, {}
    for key, kind in spec.items():
        if key not in data:
            continue
        try:
            cleaned[key] = CLEANERS[kind](data.get(key))
        except ValueError as exc:
            errors[key] = str(exc)
    return cleaned, errors


def check_payload(data, spec):
    """For a view: validate `spec`'s fields in request data before using it.

    Returns (data, None) with the checked fields replaced by their cleaned
    form (GSTIN / PAN / IFSC uppercased, email lowercased), or (None, a 400
    Response) when any field is malformed. Fields not sent are left alone.
    """
    cleaned, errors = clean_fields(data, spec)
    if errors:
        return None, error_response(errors)
    merged = {k: data.get(k) for k in data.keys()} if hasattr(data, 'keys') else dict(data)
    merged.update(cleaned)
    return merged, None
