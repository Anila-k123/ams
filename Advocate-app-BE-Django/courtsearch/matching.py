"""Deciding whether a case in this practice is the case a court has listed.

Scraping lives in the scraper service; this is the other half - business logic
about *our* cases - so it lives here.

The problem: the same matter is written three different ways by three different
sources.

    a cause list      "SLP(C) No. 014217 / 2025"
    a display board   "SLP(C) No. 23953/2026"
    our own record    "SLP(C) /14217/2025"   (eCourts registration format)

Reducing all of them to (TYPE, number, year) is what makes a comparison possible
at all. `normalise_case` below MUST agree with `normalise_case` in the scraper's
causelist.py - the scraper normalises on ingest and stores the parts in
causelist_item, and this side normalises our cases to look them up. The two are
in separate services, so they cannot share code; test_matching.py pins the shared
examples so they cannot drift apart silently.

A Supreme Court matter also has a DIARY number, which is how a fresh case is
listed before registration (39% of the Supreme Court's list on the day this was
written). It is written "14704/2025" in our records but "Diary No. 14704-2025"
in the cause list, so it is normalised to ('DIARY', '14704', '2025') on both
sides.
"""

from __future__ import annotations

import json
import logging
import re

from courtsearch.models import ImportedCaseRecord

log = logging.getLogger(__name__)

# CNR prefix -> the cause-list / display-board provider the case belongs to.
# A CNR is stable and court-assigned, so it identifies the bench without asking
# the user to pick one.
CNR_COURT = {
    'SCIN01': 'sci',
    'HCMA01': 'chennai',
    'HCMD01': 'madurai',
    'KLHC01': 'kochi',
}


def normalise_case(text):
    """'SLP(C) No. 014217 / 2025' -> ('SLP(C)', '14217', '2025').

    Leading zeros are stripped and a hyphenated range keeps only its first
    number, because that is how the same case appears elsewhere. Returns None
    when the text carries no case number at all.
    """
    if not text:
        return None
    s = re.sub(r'\s+', ' ', str(text)).strip()
    s = re.sub(r'\bNo\.?\b', '', s, flags=re.I)
    s = re.sub(r'Registered on.*$', '', s, flags=re.I)
    m = re.search(r'^(.*?)[\s./]*([0-9]+)\s*(?:-\s*[0-9]+)?\s*/\s*([0-9]{4})', s)
    if not m:
        return None
    typ = re.sub(r'[^A-Z()]', '', m.group(1).upper())
    return (typ, str(int(m.group(2))), m.group(3))


# Every "<TYPE> No. <number> / <year>" in a free-text field. The Supreme Court
# packs a matter's whole history into one string - "C.A. No. 005640 / 2026
# Registered on 23-04-2026 SLP(C) No. 014217 - / 2025 ..." - and a case can be
# listed under any of them, so all are collected, not just the first.
_EMBEDDED = re.compile(
    r'([A-Z][A-Za-z.()]*(?:\([A-Za-z.]+\))?)\s*No\.?\s*([0-9]+)\s*(?:-\s*[0-9]*)?\s*/\s*([0-9]{4})')


def _embedded_keys(text):
    out = set()
    for m in _EMBEDDED.finditer(text or ''):
        typ = re.sub(r'[^A-Z()]', '', m.group(1).upper())
        if typ:
            out.add((typ, str(int(m.group(2))), m.group(3)))
    return out


def _raw_of(record):
    raw = record.raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except ValueError:
            return {}
    return raw or {}


def identities_for(cases):
    """{case.id -> identity} for many cases, in two queries instead of N.

    case_identity() reads one ImportedCaseRecord per call, which is fine for a
    single case and an N+1 for a whole practice - and both the "my forums" list
    and the "listed today" banner run over every active case.
    """
    cases = list(cases)
    if not cases:
        return {}
    latest = {}
    for record in (ImportedCaseRecord.objects
                   .filter(case_id__in=[c.id for c in cases])
                   .order_by('id')):
        latest[record.case_id] = record          # ordered ascending -> last wins
    return {c.id: _identity_from(c, latest.get(c.id)) for c in cases}


def case_identity(case):
    """Everything needed to look a case up in a cause list.

    Returns {'court': provider key or None, 'cnr': str, 'keys': {(type, no, year)}}.

    Identifiers come from the court record captured at import, not from
    cases.case_number - that column holds whatever the user typed, and for
    imported cases it is usually the CNR, which no cause list ever prints.
    """
    record = (ImportedCaseRecord.objects
              .filter(case_id=case.id).order_by('-id').first())
    return _identity_from(case, record)


def _identity_from(case, record):
    """The identity work itself, given an already-loaded court record (or None)."""
    identity = {'court': None, 'cnr': '', 'keys': set()}

    if record is not None:
        raw = _raw_of(record)
        if record.court_id == 'sci':
            fields = raw.get('fields') or {}
            identity['cnr'] = (fields.get('CNR Number') or '').split(' ')[0]
            # A diary number is written "14704/2025" here and
            # "Diary No. 14704-2025" in the list; both mean the same matter.
            diary = (raw.get('diaryNo') or fields.get('Diary Number') or '')
            d = re.match(r'^\s*(\d+)\s*[/-]\s*(\d{4})', str(diary))
            if d:
                identity['keys'].add(('DIARY', str(int(d.group(1))), d.group(2)))
            identity['keys'] |= _embedded_keys(fields.get('Case Number'))
        else:
            case_block = (raw.get('cases') or [{}])[0]
            details = ((case_block.get('detail') or {}).get('case_details') or {})
            identity['cnr'] = (details.get('CNR Number') or '').split(' ')[0]
            for label in ('Registration Number', 'Case Number', 'Filing Number'):
                key = normalise_case(details.get(label))
                if key:
                    identity['keys'].add(key)

    # Fall back to the typed case number - right for a manually entered case,
    # and harmlessly None when it holds a CNR.
    typed = normalise_case(case.case_number)
    if typed:
        identity['keys'].add(typed)

    cnr = (identity['cnr'] or case.case_number or '').replace('-', '')
    identity['court'] = CNR_COURT.get(cnr[:6].upper())
    return identity


def find_listings(case, on, court=None):
    """The cause-list rows this case is listed under on `on`. Possibly several
    (connected matters share a case number across items)."""
    from courtsearch.models import CauseListItem     # local: avoids a cycle

    identity = case_identity(case)
    court = court or identity['court']
    if not court or not identity['keys']:
        return []

    rows = list(CauseListItem.objects.filter(court=court, list_date=on))
    wanted = identity['keys']
    return [r for r in rows
            if (r.case_type, r.case_no, r.case_year) in wanted]


def your_items_by_courtroom(advocate, court, on):
    """{courtroom -> "40" (or "12, 40")} for this advocate's cases on `on`.

    One query for the day's list and one for the practice's cases, rather than a
    lookup per case: a Supreme Court list is ~1000 rows and a practice can hold
    hundreds of cases.

    The result is per-ADVOCATE and must never be cached with the board itself -
    the board is shared by every user, so a cached overlay would show one
    practice another practice's listings.
    """
    from core.models import Case                      # local: avoids a cycle
    from core.practice import practice_ids
    from courtsearch.models import CauseListItem

    rows = list(CauseListItem.objects.filter(court=court, list_date=on))
    if not rows:
        return {}

    by_key = {}
    for r in rows:
        by_key.setdefault((r.case_type, r.case_no, r.case_year), []).append(r)

    out = {}
    cases = Case.objects.filter(advocate_id__in=practice_ids(advocate),
                                deleted=False)
    for case in cases:
        identity = case_identity(case)
        if identity['court'] != court:
            continue
        for key in identity['keys']:
            for hit in by_key.get(key, ()):
                items = out.setdefault(hit.court_number, [])
                if hit.item_number not in items:
                    items.append(hit.item_number)

    def _num(value):
        try:
            return tuple(int(p) for p in str(value).split('.'))
        except ValueError:
            return (10 ** 9,)

    return {room: ', '.join(sorted(items, key=_num))
            for room, items in out.items()}


def my_forums(advocate):
    """The courts this practice actually has cases in, for the "My Forums" tab.

    Derived, not configured: a case's CNR already says which bench it belongs
    to, so there is nothing for the user to set up or keep in step. Courts with
    no cause-list provider still appear - the practice has matters there, and
    the display board works regardless.
    """
    from core.models import Case
    from core.practice import practice_ids

    cases = Case.objects.filter(advocate_id__in=practice_ids(advocate),
                                deleted=False).only('id', 'case_number')
    counts = {}
    for identity in identities_for(cases).values():
        if identity['court']:
            counts[identity['court']] = counts.get(identity['court'], 0) + 1
    return counts


def my_listings(advocate, on):
    """Every matter of this practice listed on `on`, across all courts.

    Reads only the stored cause list - no scraping - so it is fast enough to sit
    at the top of a page. That is the whole point: the display board is the slow
    part (a live scrape per court), and an advocate arriving on a hearing morning
    should not have to guess which of twenty-six courts to open.
    """
    from core.models import Case
    from core.practice import practice_ids
    from courtsearch.models import CauseListItem

    rows = list(CauseListItem.objects.filter(list_date=on))
    if not rows:
        return []

    by_court_key = {}
    for r in rows:
        by_court_key.setdefault(
            (r.court, r.case_type, r.case_no, r.case_year), []).append(r)

    cases = list(Case.objects.filter(advocate_id__in=practice_ids(advocate),
                                     deleted=False))
    identities = identities_for(cases)

    out = []
    for case in cases:
        identity = identities[case.id]
        court = identity['court']
        if not court:
            continue
        seen = set()
        for key in identity['keys']:
            for hit in by_court_key.get((court,) + key, ()):
                if hit.id in seen:
                    continue
                seen.add(hit.id)
                out.append({
                    'caseId': case.id,
                    'caseNumber': case.case_number,
                    'caseTitle': case.case_title,
                    'court': court,
                    'courtNumber': hit.court_number,
                    'itemNumber': hit.item_number,
                    'caseString': hit.case_string,
                    'listDate': hit.list_date.isoformat(),
                })

    def _order(entry):
        room, item = entry['courtNumber'], entry['itemNumber']
        room_key = (1, room) if room.startswith('R') else (0, int(room)) if room.isdigit() else (2, room)
        try:
            item_key = tuple(int(p) for p in str(item).split('.'))
        except ValueError:
            item_key = (10 ** 9,)
        return (entry['court'], room_key, item_key)

    return sorted(out, key=_order)
