"""A decided case and what it means for an appeal (docs/APPEALS.md).

When the order sync (or a Refresh) sees a case disposed, record_decision() reads the court's own wording of
the outcome ("Contested--DISMISSED", "ALLOWED", "Decreed with cost", "WITHDRAWN"), works out which side our
client is on (the case profile, else the client's name among the parties), and files the case on the Appeal
Alerts page:

- we lost (or partly)           -> "You can appeal"            (APPEAL_POSSIBLE to the advocate and team)
- we won (or partly)            -> "The other side may appeal" (APPEAL_WATCH; the evening appeal check watches)
- unclear wording / side unknown -> "Needs a look"              (APPEAL_POSSIBLE: check whether to appeal)
- withdrawn / settled / satisfied -> no appeal alert

The client is never told: what to say about an appeal is the advocate's call. No limitation date is computed
here (periods differ by subject, forum and who appeals; see appeal_scan.py's note) - that is a separate,
reviewed piece of work.
"""
import datetime
import logging
import re

from django.utils import timezone

from .models import CaseDecision

log = logging.getLogger(__name__)

# Order matters: "WITHDRAWN DISMISSED" is a withdrawal, "PARTLY ALLOWED" is partly.
_NO_CONTEST = ('WITHDRAWN', 'WITHDRAWAL', 'SETTLED', 'COMPROMISE', 'SATISFACTION', 'LOK ADALAT', 'ABATED',
               'NOT PRESSED', 'INFRUCTUOUS', 'CLOSED', 'TRANSFERRED')
_PARTLY = ('PARTLY', 'PARTIALLY', 'IN PART')
_FOR_PETITIONER = ('ALLOWED', 'DECREED', 'GRANTED', 'FINAL DECREE', 'CONVICTED', 'DECREE PASSED')
_FOR_RESPONDENT = ('DISMISSED', 'REJECTED', 'ACQUITTED', 'DISCHARGED')

# A decision older than this is past any appeal and isn't listed; one between FRESH and this, seen for the
# first time (a case imported or linked after its judgment), is listed without an alert.
BACKFILL_DAYS = 365
FRESH = datetime.timedelta(days=45)

PETITIONER_WORDS = ('petitioner', 'plaintiff', 'appellant', 'applicant', 'complainant', 'claimant', 'decree holder')
RESPONDENT_WORDS = ('respondent', 'defendant', 'accused', 'opposite', 'judgment debtor')


def outcome_of(nature):
    """Who won, by the court's words: petitioner (the side that came to court) / respondent / partly /
    no_contest (withdrawn, settled...) / unclear ("Disposed of", "Leave granted & disposed off")."""
    t = re.sub(r'\s+', ' ', str(nature or '')).upper()
    if any(w in t for w in _NO_CONTEST):
        return CaseDecision.NO_CONTEST
    if 'LEAVE GRANTED' in t:                               # SLP admitted, then disposed: the result isn't said
        return CaseDecision.UNCLEAR
    if any(w in t for w in _PARTLY):
        return CaseDecision.PARTLY
    for_pet, for_res = any(w in t for w in _FOR_PETITIONER), any(w in t for w in _FOR_RESPONDENT)
    if for_pet and not for_res:
        return CaseDecision.PETITIONER
    if for_res and not for_pet:
        return CaseDecision.RESPONDENT
    return CaseDecision.UNCLEAR


def side_word(text):
    """'petitioner' / 'respondent' for a role word ("Plaintiff", "Accused", "Respondent No. 2"), else ''."""
    t = str(text or '').lower()
    if any(w in t for w in RESPONDENT_WORDS):
        return CaseDecision.RESPONDENT
    if any(w in t for w in PETITIONER_WORDS):
        return CaseDecision.PETITIONER
    return ''


def _tokens(name):
    from .appeal_scan import name_tokens
    return set(name_tokens(name))


def our_side(case, rec=None):
    """(side, source): from the case profile ("Our client is the ..."), else the client's name among the
    parties (the case's parties, then the court record's), else ('', '')."""
    from workspace.models import CaseParty, CaseProfile
    profile = CaseProfile.objects.filter(case_id=case.id).first()
    side = side_word(profile.our_side) if profile else ''
    if side:
        return side, 'profile'
    client = getattr(case, 'client', None)
    mine = _tokens(getattr(client, 'name', '') or '')
    if not mine:
        return '', ''

    def match(names_by_side):
        hits = {s for s, names in names_by_side.items() for n in names
                if (lambda t: t and len(mine & t) >= max(1, min(len(mine), len(t)) * 0.6))(_tokens(n))}
        return hits.pop() if len(hits) == 1 else ''     # both sides matched: can't tell

    parties = {CaseDecision.PETITIONER: [], CaseDecision.RESPONDENT: []}
    for p in CaseParty.objects.filter(case_id=case.id):
        s = side_word(p.role)
        if s:
            parties[s].append(p.name)
    side = match(parties)
    if not side and rec is not None:
        from courtsearch.linking import parties_from
        recorded = {CaseDecision.PETITIONER: [], CaseDecision.RESPONDENT: []}
        for p in parties_from(rec.court_id, rec.raw or {}):
            recorded[side_word(p['role'])].append(p['name'])
        side = match(recorded)
    return (side, 'parties') if side else ('', '')


def position(d):
    """Where the case stands for us: lost / won / partly / none (no appeal) / look (unclear or side unknown)."""
    if d.outcome == CaseDecision.NO_CONTEST:
        return 'none'
    if d.outcome == CaseDecision.UNCLEAR or not d.our_side:
        return 'look'
    if d.outcome == CaseDecision.PARTLY:
        return 'partly'
    return 'won' if d.outcome == d.our_side else 'lost'


def forum_label(court_id):
    """Where an appeal usually goes from this court (no period: that is separate work)."""
    return {
        'ecourts_dc': 'High Court (or the District Court, for smaller suits and criminal appeals)',
        'ecourts_hc': 'Division Bench of the High Court (writ / Letters Patent appeal), or the Supreme Court (SLP)',
        'sci': 'Review petition before the Supreme Court',
    }.get(court_id, '')


def _initial_status(d):
    return CaseDecision.WATCHING if position(d) == 'won' else CaseDecision.OPEN


def record_decision(rec, alert=True):
    """The case's decision from its court record, made once when the court first shows it disposed (and
    announced when `alert`). Returns the CaseDecision, or None while the case is pending."""
    from core.models import Case
    from .detection import detect_disposal
    if not rec.case_id:
        return None
    disposal = detect_disposal(rec.court_id, rec.raw or {})
    if not disposal:
        return None
    existing = CaseDecision.objects.filter(case_id=rec.case_id).first()
    if existing is not None:
        return existing
    decided = disposal.get('judgment_date')
    today = datetime.date.today()
    if decided and decided < today - datetime.timedelta(days=BACKFILL_DAYS):
        return None                                        # long decided: past any appeal, nothing to show
    if decided and decided < today - FRESH:
        alert = False                                      # an older decision seen for the first time: listed, not announced
    case = Case.objects.select_related('client', 'advocate').filter(id=rec.case_id, deleted=False).first()
    if case is None:
        return None
    from cases.closure import STOPPED, mode
    if mode(case) == STOPPED:
        return None                                        # closed for us (no longer acting / settled)
    side, source = our_side(case, rec)
    d = CaseDecision(case_id=case.id, advocate_id=case.advocate_id, court_id=rec.court_id,
                     decided_on=disposal.get('judgment_date'), nature=(disposal.get('disposal_nature') or '')[:255],
                     outcome=outcome_of(disposal.get('disposal_nature')), our_side=side, side_source=source,
                     next_forum=forum_label(rec.court_id))
    d.status = _initial_status(d)
    d.save()
    if alert:
        _announce(d, case)
    return d


def set_our_side(d, side, user):
    """The advocate said which side our client is on: saved on the decision and the case profile, so it is
    never asked again; a won case starts being watched."""
    from workspace.models import CaseProfile
    d.our_side, d.side_source = side, 'asked'
    if d.status in (CaseDecision.OPEN, CaseDecision.WATCHING):
        d.status = _initial_status(d)
    d.save(update_fields=['our_side', 'side_source', 'status', 'updated_at'])
    CaseProfile.objects.update_or_create(case_id=d.case_id, defaults={'our_side': side.title()})
    return d


def _announce(d, case):
    """APPEAL_POSSIBLE / APPEAL_WATCH to the case's advocate and team (case-alert holders). Never the client."""
    from core.practice import case_alert_permission
    from core.tenant import firm_id_of_advocate
    from notifications import events
    where = position(d)
    if where == 'none':
        return
    label = case.case_number or case.case_title or f'Case #{case.id}'
    on = f' on {d.decided_on:%d %b %Y}' if d.decided_on else ''
    words = d.nature or 'decided'
    if where in ('lost', 'partly'):
        event = 'APPEAL_POSSIBLE'
        subject = f'Appeal possible - {label}'
        body = (f'{label} was decided{on}: {words}.\n\n'
                + ('Your client lost' if where == 'lost' else 'It went partly against your client')
                + f', so an appeal can be filed. Usual next forum: {d.next_forum or "the next court up"}.\n\n'
                  'Decide on Appeal Alerts (We will appeal / No appeal). Check the limitation period before filing.')
    elif where == 'won':
        event = 'APPEAL_WATCH'
        subject = f'The other side may appeal - {label}'
        body = (f'{label} was decided for your client{on}: {words}.\n\n'
                'The other side can appeal. PactPro checks the higher court every evening and will alert you if an '
                'appeal appears (Appeal Alerts).')
    else:
        event = 'APPEAL_POSSIBLE'
        subject = f'Case decided - {label}'
        body = (f'{label} was decided{on}: {words}.\n\n'
                + ("PactPro can't tell from the court's wording who won." if d.outcome == CaseDecision.UNCLEAR
                   else "PactPro doesn't know which side your client is on.")
                + ' Check whether an appeal is needed on Appeal Alerts.')
    events.fanout(case.advocate, event, subject, body, timezone.now(), entity='CaseDecision', entity_id=d.id,
                  require_permission=case_alert_permission(), period='decided',
                  firm_id=firm_id_of_advocate(case.advocate_id), case_id=case.id)
    CaseDecision.objects.filter(id=d.id).update(alerted_at=timezone.now())


def backfill(limit=None, days=BACKFILL_DAYS):
    """Decisions for cases already decided before this existed: made quietly (no alerts), so the Appeal Alerts
    page isn't empty on day one. Only decisions of the last `days` (older ones are past any appeal).
    Returns how many were made."""
    from courtsearch.models import ImportedCaseRecord
    from .detection import detect_disposal
    since = datetime.date.today() - datetime.timedelta(days=days)
    latest = {}
    for rec in ImportedCaseRecord.objects.exclude(case_id=None).order_by('id'):
        latest[rec.case_id] = rec
    made = 0
    for rec in latest.values():
        if CaseDecision.objects.filter(case_id=rec.case_id).exists():
            continue
        decided = (detect_disposal(rec.court_id, rec.raw or {}) or {}).get('judgment_date')
        if not decided or decided < since:
            continue
        if record_decision(rec, alert=False):
            made += 1
            if limit and made >= limit:
                break
    return made


def watching_case_ids(now=None):
    """Cases the evening appeal check should look at: decided for our client, still watched, within the
    year an appeal could still be filed in."""
    from cases.closure import stopped_case_ids
    since = (now or datetime.date.today()) - datetime.timedelta(days=400)
    ids = list(CaseDecision.objects.filter(status=CaseDecision.WATCHING)
               .exclude(decided_on__lt=since).values_list('case_id', flat=True))
    stopped = stopped_case_ids(ids)
    return [i for i in ids if i not in stopped]
