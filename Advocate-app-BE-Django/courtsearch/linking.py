"""Linking a case entered by hand (offline) to its court record, so it is monitored like an imported one
(docs/ORDER_SYNC.md, "Offline cases").

find_by_cnr() / find_by_diary() look the case up in the courts; link_case() stores the record on the case and
adds what an import would have added: the parties not already on the case and the upcoming hearings, and
remembers the orders already there (no alerts for them). From then on the order sync keeps it up to date.
Used by the case page's "Link to court record" (views.LinkCourtRecordView) and by the sync's daily attempt
for offline cases with a CNR (order_sync.link_pending).
"""
import concurrent.futures
import datetime
import logging
import re

from django.db import transaction

from . import client

log = logging.getLogger(__name__)

CNR_RE = re.compile(r'^[A-Z]{4}\d{12}$')


class NotFound(Exception):
    """The courts answered: there is no such case."""


class AlreadyLinked(Exception):
    """The case has a court record already, or another case of the practice holds this one."""


def clean_cnr(value):
    cnr = re.sub(r'\s+', '', str(value or '')).upper()
    return cnr if CNR_RE.match(cnr) else ''


def find_by_cnr(cnr, timeout=None):
    """(court_id, raw, query) for a District / High Court CNR; both portals are asked at once. Raises
    NotFound when both say no, client.ScraperUnavailable / ScraperError when one couldn't answer."""
    def ask(court_id):
        try:
            if court_id == 'ecourts_dc':
                return court_id, client.post_json('/courts/ecourts_dc/cnr:search', {'cnr': cnr}), None
            return court_id, client.hc_cnr_search(cnr), None
        except (client.ScraperUnavailable, client.ScraperError) as exc:
            return court_id, None, exc
    errors = []
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)
    try:
        for fut in concurrent.futures.as_completed([pool.submit(ask, 'ecourts_dc'), pool.submit(ask, 'ecourts_hc')]):
            court_id, payload, exc = fut.result()
            cases = (payload or {}).get('cases') if isinstance(payload, dict) else None
            if cases:
                return court_id, {'cases': cases}, {'cnr': cnr}
            if exc is not None:
                errors.append(exc)
    finally:
        pool.shutdown(wait=False)
    inconclusive = [e for e in errors if not (isinstance(e, client.ScraperError) and e.status == 404)]
    if inconclusive:
        raise inconclusive[0]
    raise NotFound(cnr)


def find_by_diary(diary_no, diary_year, timeout=None):
    """('sci', raw, query) for a Supreme Court diary number."""
    try:
        raw = client.sci_case_detail(str(diary_no), str(diary_year), expand=True, timeout=timeout)
    except client.ScraperError as exc:
        if exc.status == 404:
            raise NotFound(f'{diary_no}/{diary_year}') from exc
        raise
    if not isinstance(raw, dict) or not (raw.get('fields') or raw.get('diaryNo')):
        raise NotFound(f'{diary_no}/{diary_year}')
    return 'sci', raw, {'diary_no': str(diary_no), 'diary_year': str(diary_year)}


# --- what an import adds to the case (pages/AddCase.tsx buildParties / buildEvents) ------------------------

def _split_sci_parties(blob):
    s = str(blob or '').strip()
    names = [m.strip() for m in re.findall(r'(?:^|\s)\d+\s+(.*?)(?=\s\d+\s|$)', s) if m.strip()]
    return names or ([s] if s else [])


def parties_from(court_id, raw):
    out = []
    if court_id in ('ecourts_dc', 'ecourts_hc'):
        d = ((raw.get('cases') or [{}])[0] or {}).get('detail') or {}
        out += [{'name': p.get('name'), 'role': 'Petitioner', 'counsel': p.get('advocate') or '', 'opponent': False}
                for p in d.get('petitioners') or [] if isinstance(p, dict)]
        out += [{'name': p.get('name'), 'role': 'Respondent', 'counsel': p.get('advocate') or '', 'opponent': True}
                for p in d.get('respondents') or [] if isinstance(p, dict)]
    elif court_id == 'sci':
        f = raw.get('fields') or {}
        for i, name in enumerate(_split_sci_parties(f.get('Petitioner(s)'))):
            out.append({'name': name, 'role': 'Petitioner', 'counsel': f.get('Petitioner Advocate(s)', '') if i == 0 else '', 'opponent': False})
        for i, name in enumerate(_split_sci_parties(f.get('Respondent(s)'))):
            out.append({'name': name, 'role': 'Respondent', 'counsel': f.get('Respondent Advocate(s)', '') if i == 0 else '', 'opponent': True})
    return [{**p, 'name': str(p['name']).strip()[:255], 'counsel': str(p['counsel'] or '')[:255]}
            for p in out if p.get('name') and str(p['name']).strip()]


_MONTHS = {m: i for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'], 1)}


def to_date(value):
    """The portals' dates (2024-06-12, 12-06-2024, 12/06/2024, 12th June 2024) as a date; None if unreadable."""
    t = str(value or '').strip()
    try:
        m = re.match(r'^(\d{4})-(\d{1,2})-(\d{1,2})', t)
        if m:
            return datetime.date(int(m[1]), int(m[2]), int(m[3]))
        m = re.match(r'^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})', t)
        if m:
            return datetime.date(int(m[3]), int(m[2]), int(m[1]))
        m = re.search(r'(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?\s+(\d{4})', t)
        if m and m[2][:3].lower() in _MONTHS:
            return datetime.date(int(m[3]), _MONTHS[m[2][:3].lower()], int(m[1]))
    except ValueError:
        return None
    return None


def hearings_from(court_id, raw):
    """[{date, title, description}] of the record's hearings (all dates; the caller keeps the upcoming)."""
    cap = lambda v: str(v or '')[:255]
    out = []
    if court_id in ('ecourts_dc', 'ecourts_hc'):
        d = ((raw.get('cases') or [{}])[0] or {}).get('detail') or {}
        rows = d.get('history') if court_id == 'ecourts_dc' else d.get('hearings')
        for h in rows or []:
            if not isinstance(h, dict):
                continue
            date = to_date(h.get('hearing_date')) or to_date(h.get('business_date') or h.get('business_on_date'))
            if date:
                out.append({'date': date, 'title': cap(h.get('purpose') or 'Hearing'),
                            'description': cap(f"Judge: {h['judge']}" if h.get('judge') else '')})
    elif court_id == 'sci':
        listing = next((s for s in raw.get('sections') or [] if isinstance(s, dict) and s.get('label') == 'Listing Dates'), None)
        cols = (listing or {}).get('columns') or []
        at = lambda row, name: str(row[cols.index(name)] or '').strip() if name in cols and cols.index(name) < len(row) else ''
        for row in (listing or {}).get('rows') or []:
            if isinstance(row, list) and to_date(at(row, 'CL Date')):
                out.append({'date': to_date(at(row, 'CL Date')), 'title': cap(at(row, 'Purpose') or 'Hearing'),
                            'description': cap(' - '.join(x for x in (at(row, 'Judges'), at(row, 'Remarks')) if x))})
        if not out:
            listed = str((raw.get('fields') or {}).get('Present/Last Listed On') or '')
            if to_date(listed):
                coram = (re.search(r'\[(.+)\]', listed) or [None, ''])[1]
                out.append({'date': to_date(listed), 'title': 'Hearing', 'description': cap(coram.strip())})
    return out


def _short(text, limit=90):
    """A party / number as a line in the dialog: the court's extras ("Advocate- ...", "Registered on ...") cut."""
    t = re.split(r'\s+(?:Advocate\s*-|Registered on)', str(text or ''), maxsplit=1)[0]
    t = re.sub(r'^\d+\s+', '', re.sub(r'\s+', ' ', t).strip())
    return t if len(t) <= limit else t[:limit - 1].rstrip() + '...'


def summary(court_id, raw):
    """What the Link dialog shows before linking: {court, caseNumber, title, status, nextHearing}."""
    if court_id == 'sci':
        f = raw.get('fields') or {}
        pet, res = _split_sci_parties(f.get('Petitioner(s)')), _split_sci_parties(f.get('Respondent(s)'))
        title = ' vs '.join(_short(x[0], 60) for x in (pet, res) if x)
        return {'court': 'Supreme Court of India', 'caseNumber': _short(f.get('Case Number') or f.get('Diary Number')),
                'title': title, 'status': _short(f.get('Status/Stage'), 60), 'nextHearing': None}
    d = ((raw.get('cases') or [{}])[0] or {}).get('detail') or {}
    pet = _short(((d.get('petitioners') or [{}])[0] or {}).get('name'), 60)
    res = _short(((d.get('respondents') or [{}])[0] or {}).get('name'), 60)
    status = d.get('case_status')
    if isinstance(status, dict):
        status = status.get('Case Status') or status.get('Stage of Case') or ''
    upcoming = sorted(h['date'] for h in hearings_from(court_id, raw) if h['date'] >= datetime.date.today())
    return {'court': 'High Court' if court_id == 'ecourts_hc' else 'District Court',
            'caseNumber': ((raw.get('cases') or [{}])[0] or {}).get('case_number') or d.get('registration_number') or '',
            'title': ' vs '.join(x for x in (pet, res) if x), 'status': str(status or ''),
            'nextHearing': upcoming[0].isoformat() if upcoming else None}


def link_case(case, court_id, query, raw, actor=None):
    """Store the court record on `case` and add the parties not already on it and the upcoming hearings
    (the client and the team are told of each hearing, as on an import). Returns the ImportedCaseRecord.
    Raises AlreadyLinked when the case has a record already."""
    from core.models import CaseEvent
    from workspace.models import CaseParty, CaseProfile
    from .models import CaseOrderSync, ImportedCaseRecord
    actor = actor or case.advocate
    with transaction.atomic():
        if ImportedCaseRecord.objects.select_for_update().filter(case_id=case.id).exists():
            raise AlreadyLinked(case.id)
        rec = ImportedCaseRecord.objects.create(advocate_id=case.advocate_id, case_id=case.id,
                                                court_id=court_id, query=query, raw=raw)
        known = {p.lower() for p in CaseParty.objects.filter(case_id=case.id).values_list('name', flat=True)}
        for p in parties_from(court_id, raw):
            if p['name'].lower() not in known:
                known.add(p['name'].lower())
                CaseParty.objects.create(advocate_id=case.advocate_id, case_id=case.id, name=p['name'],
                                         role=p['role'], counsel=p['counsel'], is_opponent=p['opponent'])
        cnr = (query or {}).get('cnr')
        if cnr:
            CaseProfile.objects.update_or_create(case_id=case.id, defaults={'cnr': cnr})
        # Remember the orders already on the record, so linking never alerts about old ones.
        from .orders import order_entries
        CaseOrderSync.objects.update_or_create(case_id=case.id, defaults={
            'known_keys': [e['key'] for e in order_entries(court_id, raw)],
            'checked_at': datetime.datetime.now(), 'last_error': ''})
    today = datetime.date.today()
    from notifications import client_events, internal_events
    for h in hearings_from(court_id, raw):
        if h['date'] < today or CaseEvent.objects.filter(case_id=case.id, date=h['date'], event_type='HEARING').exists():
            continue
        event = CaseEvent.objects.create(title=h['title'], event_type='HEARING', description=h['description'],
                                         date=h['date'], notified=False, case=case, advocate_id=actor.id)
        client_events.hearing_scheduled(actor, case.client, event, case)
        internal_events.hearing_added_team(actor, event, case)
    log.info('linked case %s to its %s record', case.id, court_id)
    return rec
