"""Which court would an appeal against this case appear in?

Verified against the two eCourts registries: every High Court's `state_code`
is the SAME number as the district-court `state_code` of its principal state
(Bombay HC = 1 = Maharashtra, Madras = 10 = Tamil Nadu, Calcutta = 16 = West
Bengal, Allahabad = 13 = Uttar Pradesh, Patna = 8 = Bihar, Gauhati = 6 =
Assam, and so on for all 25). So the district code carries straight over and
no lookup table is needed for the principal states.

Only the states/UTs that have no High Court of their own need an override -
they fall under a neighbouring court.
"""

from __future__ import annotations

# District state_code -> the High Court state_code that hears its appeals,
# for the states/UTs without their own High Court.
NO_OWN_HIGH_COURT = {
    14: 22,   # Haryana              -> Punjab and Haryana
    27: 22,   # Chandigarh           -> Punjab and Haryana
    30: 1,    # Goa                  -> Bombay
    38: 1,    # Dadra & Nagar Haveli and Daman & Diu -> Bombay
    36: 6,    # Arunachal Pradesh    -> Gauhati
    34: 6,    # Nagaland             -> Gauhati
    19: 6,    # Mizoram              -> Gauhati
    28: 16,   # Andaman and Nicobar  -> Calcutta
    33: 12,   # Ladakh               -> Jammu and Kashmir and Ladakh
    35: 10,   # Puducherry           -> Madras
    37: 4,    # Lakshadweep          -> Kerala
}

# The 25 High Court state_codes, so we can tell a real HC from a district code
# that merely happens to be numerically valid.
HIGH_COURT_CODES = {
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 20, 21, 22,
    23, 24, 25, 26, 29,
}

# CNR prefixes are state letters (KLML17... = Kerala), which is the most
# reliable signal when a stored record has no explicit state_code.
CNR_STATE_LETTERS = {
    'AN': 28, 'AP': 2, 'AR': 36, 'AS': 6, 'BR': 8, 'CG': 18, 'CH': 27,
    'DD': 38, 'DL': 26, 'DN': 38, 'GA': 30, 'GJ': 17, 'HP': 5, 'HR': 14,
    'JH': 7, 'JK': 12, 'KA': 3, 'KL': 4, 'LA': 33, 'LD': 37, 'MH': 1,
    'ML': 21, 'MN': 25, 'MP': 23, 'MZ': 19, 'NL': 34, 'OR': 11, 'PB': 22,
    'PY': 35, 'RJ': 9, 'SK': 24, 'TN': 10, 'TR': 20, 'TS': 29, 'UK': 15,
    'UP': 13, 'WB': 16,
}


def state_from_cnr(cnr):
    """District state_code from a CNR's leading state letters, or None."""
    s = (cnr or '').strip().upper()
    return CNR_STATE_LETTERS.get(s[:2]) if len(s) >= 2 else None


def high_court_for_state(state_code):
    """The High Court state_code that hears appeals from this district state."""
    if state_code is None:
        return None
    code = int(state_code)
    code = NO_OWN_HIGH_COURT.get(code, code)
    return code if code in HIGH_COURT_CODES else None


def next_forum(court_id, state_code=None, cnr=None):
    """Where an appeal against a case in `court_id` would be filed.

    Returns {'court_id': ..., 'state_code': ...} or None when there is no
    higher forum we can search (the Supreme Court is final).
    """
    if court_id == 'sci':
        return None                      # nothing above it
    if court_id in ('ecourts_hc', 'madras_hc'):
        # An appeal from a High Court goes to the Supreme Court, which is
        # searched by party name without a state code.
        return {'court_id': 'sci', 'state_code': None}
    if court_id == 'ecourts_dc':
        st = state_code if state_code is not None else state_from_cnr(cnr)
        hc = high_court_for_state(st)
        return {'court_id': 'ecourts_hc', 'state_code': hc} if hc else None
    return None
