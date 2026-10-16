"""Where a legal service is supplied, as GST state codes (core/validators.py
GST_STATE_CODES, the first two digits of a GSTIN), and whether the supply is
intra- or inter-state.

Place of supply for services between parties in India (IGST Act s.12(2)):
  - recipient registered (has a GSTIN): the recipient's location, i.e. their
    GSTIN's state;
  - otherwise: the recipient's address on record (their state).
The supplier's location is the firm's registration (GSTIN state), else its state.

States are compared only as 2-digit codes, never as free text, so "TN",
"Tamilnadu" and "Tamil Nadu" are the same place. Nothing here guesses: an
unknown or missing state is reported, and the caller decides (a forward-charge
invoice is refused rather than taxed on an assumption).
"""
from __future__ import annotations

import re

from core.validators import GST_STATE_CODES, clean_gstin


class PlaceOfSupplyError(ValueError):
    def __init__(self, message, code, field=None):
        super().__init__(message)
        self.code, self.field = code, field


def _key(name):
    return re.sub(r'[^a-z]', '', (name or '').lower().replace('&', 'and'))


# State / UT name -> current code. Where a state has two codes (25/26, 28/37)
# the current one wins; the older code still resolves to the same state below.
NAME_TO_CODE = {}
for _code, _name in sorted(GST_STATE_CODES.items()):
    NAME_TO_CODE[_key(_name)] = _code
NAME_TO_CODE[_key('Andhra Pradesh')] = '37'
NAME_TO_CODE[_key('Dadra and Nagar Haveli and Daman and Diu')] = '26'
# Spellings and short forms people actually type.
ALIASES = {
    'tn': '33', 'tamilnadu': '33', 'ka': '29', 'kl': '32', 'mh': '27', 'dl': '07', 'newdelhi': '07',
    'nctofdelhi': '07', 'delhincr': '07', 'gj': '24', 'rj': '08', 'up': '09', 'mp': '23', 'wb': '19',
    'hp': '02', 'jk': '01', 'jandk': '01', 'hr': '06', 'pb': '03', 'br': '10', 'od': '21', 'or': '21',
    'orissa': '21', 'cg': '22', 'ct': '22', 'chattisgarh': '22', 'jh': '20', 'as': '18', 'ap': '37',
    'ts': '36', 'tg': '36', 'uk': '05', 'uttaranchal': '05', 'ga': '30', 'py': '34', 'pondicherry': '34',
    'ch': '04', 'sk': '11', 'ml': '17', 'mn': '14', 'mz': '15', 'nl': '13', 'tr': '16', 'ar': '12',
    'la': '38', 'ld': '31', 'an': '35', 'andamanandnicobar': '35', 'dnhdd': '26', 'damananddiu': '26',
    'dadraandnagarhaveli': '26',
}
NAME_TO_CODE.update(ALIASES)
# Codes that name the same state (an old registration still carries the old one).
SAME_STATE = {'25': '26', '28': '37'}


def canonical(code):
    return SAME_STATE.get(code, code)


def state_code(value):
    """2-digit GST state code for a state name, short form or code ('33',
    '33 - Tamil Nadu', 'Tamil Nadu (33)'), or None if it isn't recognised."""
    text = (value or '').strip()
    if not text:
        return None
    digits = re.search(r'\b(\d{1,2})\b', text)
    if digits:
        code = digits.group(1).zfill(2)
        if code in GST_STATE_CODES:
            return code
    return NAME_TO_CODE.get(_key(re.sub(r'\d', '', text)))


def state_name(code):
    return GST_STATE_CODES.get(code, '')


def gstin_code(gstin):
    """State code of a valid GSTIN; PlaceOfSupplyError for a malformed one."""
    if not (gstin or '').strip():
        return None
    try:
        return clean_gstin(gstin)[:2]
    except ValueError as exc:
        raise PlaceOfSupplyError(str(exc), 'BAD_GSTIN', 'recipientGstin')


def recipient_code(gstin, state, code):
    """Place of supply for the recipient: GSTIN state if registered, else the
    state entered (as a name or a code). Contradictions are refused. None when
    nothing usable is given."""
    from_gstin = gstin_code(gstin)
    entered = state_code(code) or state_code(state)
    if (state or '').strip() and not state_code(state) and not state_code(code):
        raise PlaceOfSupplyError(f'"{state.strip()}" is not an Indian state or union territory. '
                                 'Choose it from the list.', 'UNKNOWN_STATE', 'recipientState')
    if from_gstin and entered and canonical(from_gstin) != canonical(entered):
        raise PlaceOfSupplyError(f'The client\'s GSTIN is registered in {state_name(from_gstin)} but the state given '
                                 f'is {state_name(entered)}. Correct one of them.', 'STATE_GSTIN_MISMATCH',
                                 'recipientState')
    return from_gstin or entered


def supplier_code(gstins, states):
    """The firm's location: its GSTIN's state, else the first recognised state.
    None when neither is set.

    `gstins` is [(where it is set, value)], most specific first. A stored GSTIN
    that is set but invalid is a configuration error (FIRM_GSTIN_INVALID, naming
    where to fix it): the firm's location is never taken from its state instead,
    since the registration is what the law goes by."""
    for where, g in gstins:
        if not (g or '').strip():
            continue
        try:
            return clean_gstin(g)[:2]
        except ValueError as exc:
            raise PlaceOfSupplyError(f'The firm\'s GSTIN in {where} is not valid ({exc}) Correct it there before '
                                     'raising a forward-charge invoice.', 'FIRM_GSTIN_INVALID', 'firmGstin')
    for s in states:
        c = state_code(s)
        if c:
            return c
    return None


def is_interstate(supplier, recipient):
    """True / False when both locations are known; None when either isn't."""
    if not supplier or not recipient:
        return None
    return canonical(supplier) != canonical(recipient)
