"""Detect, from a scraped court record, that a case has been decided.

The appeal clock starts on the date the court pronounced judgment, so the
whole feature depends on pulling two things out of a stored
ImportedCaseRecord: "is this disposed?" and "on what date?".

Each portal words it differently, and only the eCourts ones label the date
explicitly - see _sci() for why the Supreme Court needs inference.
"""

from __future__ import annotations

import datetime
import re

# "17th June 2025" / "04th December 2025" - the eCourts portals' own format.
_MONTHS = {m.lower(): i for i, m in enumerate(
    ['January', 'February', 'March', 'April', 'May', 'June', 'July',
     'August', 'September', 'October', 'November', 'December'], start=1)}
_ORDINAL_DATE = re.compile(r'(\d{1,2})\s*(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})')
# "10-04-2026" / "02-05-2025" - the Supreme Court's format.
_DMY = re.compile(r'\b(\d{1,2})-(\d{1,2})-(\d{4})\b')


def parse_court_date(text):
    """Either court date format -> datetime.date, or None."""
    if not text:
        return None
    s = str(text)
    m = _ORDINAL_DATE.search(s)
    if m:
        month = _MONTHS.get(m.group(2).lower())
        if month:
            try:
                return datetime.date(int(m.group(3)), month, int(m.group(1)))
            except ValueError:
                return None
    m = _DMY.search(s)
    if m:
        try:
            return datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    return None


def _ecourts(raw):
    """District and High Court share one shape, and both label the date."""
    cases = raw.get('cases') or []
    if not cases:
        return None
    status = ((cases[0].get('detail') or {}).get('case_status') or {})
    text = str(status.get('Case Status') or '')
    if 'dispos' not in text.lower():
        return None
    return {
        'judgment_date': parse_court_date(status.get('Decision Date')),
        'disposal_nature': (status.get('Nature of Disposal') or '')[:255],
        'source': 'Decision Date',
        'confident': True,
    }


def _sci(raw):
    """The Supreme Court exposes no decision-date field.

    'Status/Stage' says DISPOSED and 'Disp.Type' says how, but the date has to
    be inferred - the most recent dated Judgement/Orders entry if the record
    was captured expanded, else 'Present/Last Listed On' (the hearing it was
    disposed at). Both are inferences, so `confident` is False and the UI must
    ask the advocate to confirm before relying on the deadline.
    """
    fields = raw.get('fields') or {}
    stage = str(fields.get('Status/Stage') or '')
    diary = str(fields.get('Diary Number') or '')
    if 'dispos' not in (stage + ' ' + diary).lower():
        return None

    best, source = None, ''
    for sec in (raw.get('sections') or []):
        if (sec.get('label') or '') != 'Judgement/Orders':
            continue
        for row in (sec.get('rows') or []):
            for cell in (row if isinstance(row, list) else [row]):
                d = parse_court_date(cell)
                if d and (best is None or d > best):
                    best, source = d, 'Judgement/Orders'
    if best is None:
        best = parse_court_date(fields.get('Present/Last Listed On'))
        source = 'Present/Last Listed On'
    return {
        'judgment_date': best,
        'disposal_nature': (fields.get('Disp.Type') or '')[:255],
        'source': source,
        'confident': False,
    }


def detect_disposal(court_id, raw):
    """{judgment_date, disposal_nature, source, confident} or None if pending.

    `confident` False means the date was inferred rather than read from a
    labelled field - never start a limitation countdown from it unattended.
    """
    if not isinstance(raw, dict):
        return None
    if court_id == 'sci':
        return _sci(raw)
    if court_id in ('ecourts_dc', 'ecourts_hc'):
        return _ecourts(raw)
    # madras_hc and any future flat-shaped scraper: try both.
    return _ecourts(raw) or _sci(raw)
