"""Read and write a case's CaseProfile (models.CaseProfile) in the API's
camelCase. Used by case creation (manual entry), the profile endpoint, and
"Link to court record" (which stores the CNR)."""

import datetime

from .models import CaseProfile

# API key -> model field
FIELDS = {
    'matterType': 'matter_type', 'courtName': 'court_name', 'courtHall': 'court_hall',
    'judge': 'judge', 'ourSide': 'our_side', 'filingDate': 'filing_date',
    'caseYear': 'case_year', 'cnr': 'cnr', 'actsSections': 'acts_sections',
}
MATTER_TYPES = {k for k, _ in CaseProfile.MATTER_TYPES}


class ProfileError(ValueError):
    pass


def _clean(key, value):
    if key == 'matterType':
        v = (value or CaseProfile.LITIGATION).strip()
        if v not in MATTER_TYPES:
            raise ProfileError('Matter type must be one of: {}.'.format(', '.join(sorted(MATTER_TYPES))))
        return v
    if key == 'filingDate':
        if not value:
            return None
        try:
            return datetime.date.fromisoformat(str(value)[:10])
        except ValueError:
            raise ProfileError('Filing date must be a date (YYYY-MM-DD).')
    if key == 'caseYear':
        if value in (None, ''):
            return None
        try:
            year = int(value)
        except (TypeError, ValueError):
            raise ProfileError('Case year must be a year, e.g. 2025.')
        if not 1900 <= year <= datetime.date.today().year + 1:
            raise ProfileError('Case year {} is not plausible.'.format(year))
        return year
    if key == 'cnr':
        v = ''.join(str(value or '').split()).upper()
        # 4 letters (state + district + court), then 12 digits: as AddCase checks it.
        if v and not (len(v) == 16 and v[:4].isalpha() and v[4:].isdigit()):
            raise ProfileError('A CNR is 16 characters: 4 letters then 12 digits (e.g. TNCH010015532025).')
        return v
    return str(value or '').strip()


def sent(data):
    """{model field: cleaned value} for the profile keys present in `data`."""
    return {FIELDS[k]: _clean(k, data.get(k)) for k in FIELDS if k in data}


def save(case_id, data):
    """Create or update the profile from the keys present. Returns the profile,
    or None when nothing was sent. Raises ProfileError on a bad value."""
    fields = sent(data)
    if not fields:
        return CaseProfile.objects.filter(case_id=case_id).first()
    profile, _ = CaseProfile.objects.update_or_create(case_id=case_id, defaults=fields)
    return profile


def payload(profile):
    if profile is None:
        return {'matterType': CaseProfile.LITIGATION, 'courtName': '', 'courtHall': '', 'judge': '',
                'ourSide': '', 'filingDate': None, 'caseYear': None, 'cnr': '', 'actsSections': ''}
    out = {api: getattr(profile, field) for api, field in FIELDS.items()}
    out['filingDate'] = profile.filing_date.isoformat() if profile.filing_date else None
    return out


def number_for_unfiled(practice_advocate_ids, matter_type):
    """A case number for a matter that has none yet: PRE/2026/0001 (not filed
    yet) or MAT/2026/0001 (non-litigation), unique within the practice."""
    from core.models import Case
    prefix = 'PRE' if matter_type == CaseProfile.PRE_FILING else 'MAT'
    year = datetime.date.today().year
    stem = '{}/{}/'.format(prefix, year)
    taken = set(Case.objects.filter(advocate_id__in=practice_advocate_ids,
                                    case_number__startswith=stem)
                .values_list('case_number', flat=True))
    n = len(taken) + 1
    while '{}{:04d}'.format(stem, n) in taken:
        n += 1
    return '{}{:04d}'.format(stem, n)
