"""Backfill Parties + Hearings for already-imported cases from their stored court
records (courtsearch.ImportedCaseRecord). Idempotent: skips a case that already
has parties / hearing events, so it is safe to run repeatedly.

    python manage.py backfill_court_data                # all imported cases
    python manage.py backfill_court_data --case-id 24   # one case

Orders are intentionally not backfilled (they have their own read-only tab that
reads the stored record directly).
"""

import datetime
import re

from django.core.management.base import BaseCommand

from core.models import Case, CaseEvent
from workspace.models import CaseParty
from courtsearch.models import ImportedCaseRecord

_MONTHS = {
    'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
    'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12,
    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'jun': 6, 'jul': 7, 'aug': 8,
    'sep': 9, 'sept': 9, 'oct': 10, 'nov': 11, 'dec': 12,
}


def to_date(s):
    """Parse the portal's mixed date formats into a date, or None."""
    if not s:
        return None
    t = str(s).strip()
    m = re.match(r'^(\d{4})-(\d{1,2})-(\d{1,2})', t)
    if m:
        y, mo, d = m.groups()
    else:
        m = re.match(r'^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})', t)          # dd-mm-yyyy
        if m:
            d, mo, y = m.groups()
        else:
            m = re.match(r'(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?\s+(\d{4})', t)  # 12th June 2023
            if not m:
                return None
            d, mon, y = m.groups()
            mo = _MONTHS.get(mon.lower())
            if not mo:
                return None
    try:
        return datetime.date(int(y), int(mo), int(d))
    except (ValueError, TypeError):
        return None


def _first_party(blob):
    return str(blob or '').split(',')[0].strip()


def parties_from(raw, court_id):
    out = []
    if court_id == 'ecourts_dc':
        cases = raw.get('cases') or []
        detail = (cases[0].get('detail') if cases else {}) or {}
        for p in detail.get('petitioners', []):
            out.append({'name': p.get('name', ''), 'role': 'Petitioner', 'counsel': p.get('advocate', ''), 'opp': False})
        for p in detail.get('respondents', []):
            out.append({'name': p.get('name', ''), 'role': 'Respondent', 'counsel': p.get('advocate', ''), 'opp': True})
    else:
        f = raw.get('fields') or {}
        if f.get('Petitioner Details'):
            out.append({'name': _first_party(f['Petitioner Details']), 'role': 'Petitioner', 'counsel': f.get('Petitioner Counsel', ''), 'opp': False})
        if f.get('Respondent Details'):
            out.append({'name': _first_party(f['Respondent Details']), 'role': 'Respondent', 'counsel': f.get('Respondent Counsel', ''), 'opp': True})
    return [p for p in out if (p['name'] or '').strip()]


def hearings_from(raw, court_id):
    out = []
    if court_id == 'ecourts_dc':
        cases = raw.get('cases') or []
        detail = (cases[0].get('detail') if cases else {}) or {}
        for h in detail.get('history', []):
            d = to_date(h.get('hearing_date')) or to_date(h.get('business_date'))
            if d:
                out.append({'title': h.get('purpose') or 'Hearing',
                            'desc': f"Judge: {h.get('judge')}" if h.get('judge') else '', 'date': d})
    else:
        for row in raw.get('hearing_history', []):
            if not isinstance(row, list):
                continue
            d = None
            for c in row:
                d = d or to_date(c)
            if not d:
                continue
            rest = [c for c in row[1:] if c and not to_date(c)]
            out.append({'title': rest[-1] if rest else 'Hearing',
                        'desc': f"Judge: {row[0]}" if row and row[0] else '', 'date': d})
    return out


class Command(BaseCommand):
    help = "Backfill parties + hearings for imported cases from their stored court records."

    def add_arguments(self, parser):
        parser.add_argument('--case-id', type=int, default=None,
                            help='Backfill a single case id (default: all imported cases).')

    def handle(self, *args, **options):
        qs = ImportedCaseRecord.objects.all().order_by('case_id', 'id')
        if options.get('case_id'):
            qs = qs.filter(case_id=options['case_id'])

        for rec in qs:
            if not rec.case_id:
                continue
            case = Case.objects.filter(id=rec.case_id).first()
            if case is None:
                continue
            raw = rec.raw or {}
            added_p = added_h = 0

            if not CaseParty.objects.filter(case_id=rec.case_id).exists():
                for p in parties_from(raw, rec.court_id):
                    CaseParty.objects.create(
                        advocate_id=rec.advocate_id, case_id=rec.case_id,
                        name=p['name'][:255], role=(p['role'] or '')[:32],
                        counsel=(p['counsel'] or '')[:255], is_opponent=p['opp'])
                    added_p += 1

            if not CaseEvent.objects.filter(case_id=rec.case_id, event_type='HEARING').exists():
                for ev in hearings_from(raw, rec.court_id):
                    CaseEvent.objects.create(
                        title=(ev['title'] or 'Hearing')[:255], event_type='HEARING',
                        description=(ev['desc'] or '')[:255], date=ev['date'],
                        notified=False, case=case, advocate_id=rec.advocate_id)
                    added_h += 1

            self.stdout.write(self.style.SUCCESS(
                f"case {rec.case_id} ({rec.court_id}): +{added_p} parties, +{added_h} hearings"))
