"""Closing and reopening a case, and what a closed case still gets (docs/CASE_CLOSURE.md).

"Closed" means two different things: the court decided the matter, or we no longer act for the client (they
changed advocate, the vakalat was withdrawn, the matter was settled). The reason is kept on the case profile
(workspace.CaseProfile.closed_reason) and every background feature asks mode() what it may still do:

    'open'     the case is ours and live: everything runs
    'decided'  closed, decided by the court (or closed before reasons were asked): the court record is still
               checked weekly for final orders, and Appeal Alerts still apply; no hearing / cause-list reminders
    'stopped'  closed because we no longer act, it was settled / withdrawn, or another reason: nothing that
               reaches the court or the client (no order sync, no client emails, no appeal alerts or watch,
               no reminders). History stays; fees still due stay collectable.

Anyone in the team allowed to edit the case can close (with a reason) and reopen it.
"""
import datetime

CLOSED = ('closed', 'disposed', 'decided')
DECIDED, STOPPED, OPEN = 'decided', 'stopped', 'open'


def is_closed(status):
    return (status or '').strip().lower() in CLOSED


def _reasons(case_ids):
    from workspace.models import CaseProfile
    return dict(CaseProfile.objects.filter(case_id__in=list(case_ids)).values_list('case_id', 'closed_reason'))


def mode_of(status, reason):
    if not is_closed(status):
        return OPEN
    from workspace.models import CaseProfile
    return DECIDED if reason in ('', CaseProfile.COURT_DECIDED) else STOPPED


def mode(case):
    """'open' / 'decided' / 'stopped' for one case (see the module note)."""
    if not is_closed(case.status):
        return OPEN
    return mode_of(case.status, _reasons([case.id]).get(case.id, ''))


def stopped_case_ids(case_ids=None):
    """Of `case_ids` (all cases when None), the ones closed for a reason that stops all monitoring."""
    from core.models import Case
    qs = Case.objects.filter(deleted=False)
    if case_ids is not None:
        qs = qs.filter(id__in=list(case_ids))
    closed = {cid: st for cid, st in qs.values_list('id', 'status') if is_closed(st)}
    reasons = _reasons(closed)
    return {cid for cid, st in closed.items() if mode_of(st, reasons.get(cid, '')) == STOPPED}


def apply_status(case, new_status, reason='', note='', user=None):
    """Record a status change made by hand: closing keeps the reason, reopening clears it. Called by the case
    update API after it saves the status. Returns the profile (or None when nothing about closing changed)."""
    from workspace.models import CaseProfile
    valid = {r for r, _ in CaseProfile.CLOSED_REASONS}
    if is_closed(new_status):
        reason = reason if reason in valid else ''
        profile, _ = CaseProfile.objects.update_or_create(case_id=case.id, defaults={
            'closed_reason': reason, 'closed_note': (note or '')[:500], 'closed_on': datetime.date.today(),
            'closed_by_id': getattr(user, 'id', None)})
        if mode_of(new_status, reason) == STOPPED:
            _stop_watching(case.id)
        return profile
    profile = CaseProfile.objects.filter(case_id=case.id).first()
    if profile and (profile.closed_reason or profile.closed_on):
        profile.closed_reason, profile.closed_note, profile.closed_on, profile.closed_by_id = '', '', None, None
        profile.save(update_fields=['closed_reason', 'closed_note', 'closed_on', 'closed_by_id', 'updated_at'])
    return profile


def _stop_watching(case_id):
    """No longer ours: the evening appeal watch stops looking for this case."""
    from appeals.models import CaseDecision
    CaseDecision.objects.filter(case_id=case_id, status=CaseDecision.WATCHING).update(status=CaseDecision.WATCH_STOPPED)
