"""A hearing's result and its next date (the case diary).

Saving a hearing with a next date schedules the next hearing as a real event,
so it reaches the calendar, reminders, the case timeline and the daily board
(they all read case_events). The hearing keeps its own record: result, order
text, next date, and a link to the hearing it led to.

Rules:
  - Only hearings have a next date, and it must fall after the hearing itself.
  - DISPOSED never schedules one; nor does a case marked closed / disposed /
    decided (reopen the case first). Nothing is scheduled silently.
  - One next hearing per hearing (hearing_detail.next_event_id is unique): a
    retried or repeated save moves that hearing instead of adding another. If
    the case already has a hearing on that date, it is linked, not duplicated.
  - Earlier hearings and their records are never deleted or rewritten here;
    clearing a next date leaves the scheduled hearing alone.
"""
from __future__ import annotations

import datetime

from django.db import IntegrityError, transaction
from django.utils.dateparse import parse_date

from core.models import CaseEvent
from workspace.models import HearingDetail

CLOSED_CASE = ('closed', 'disposed', 'decided')
MAX_AHEAD_DAYS = 5 * 366
DETAIL_KEYS = {'purpose': 'purpose', 'court': 'court', 'bench_hall': 'benchHall', 'judge': 'judge',
               'outcome': 'outcome'}
RESULT_CODES = {code for code, _ in HearingDetail.RESULTS}


class SchedulingError(ValueError):
    def __init__(self, message, code, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def _date(value, field):
    if value in (None, ''):
        return None
    if isinstance(value, datetime.date):
        return value
    d = parse_date(str(value))
    if d is None:
        raise SchedulingError(f'{field} is not a valid date.', 'BAD_DATE')
    return d


def check(event_type, event_date, case, data):
    """Validate the hearing-detail part of a payload before anything is saved.
    Returns (next_date, result)."""
    next_date = _date(data.get('nextDate'), 'Next hearing date')
    result = (data.get('result') or '').strip().upper()
    if result and result not in RESULT_CODES:
        raise SchedulingError('Choose a valid hearing result.', 'BAD_RESULT')
    if next_date is None:
        return None, result
    if event_type != 'HEARING':
        raise SchedulingError('Only a hearing can have a next hearing date.', 'NEXT_DATE_NOT_HEARING')
    if result == HearingDetail.DISPOSED:
        raise SchedulingError('A disposed matter has no next hearing. Clear the next date or change the result.',
                              'DISPOSED_WITH_NEXT_DATE')
    hearing_day = _date(event_date, 'Date')
    if hearing_day and next_date <= hearing_day:
        raise SchedulingError('The next hearing date must be after this hearing.', 'NEXT_DATE_NOT_AFTER')
    if hearing_day and (next_date - hearing_day).days > MAX_AHEAD_DAYS:
        raise SchedulingError('The next hearing date is more than five years away. Check the date.', 'NEXT_DATE_TOO_FAR')
    if (case.status or '').strip().lower() in CLOSED_CASE:
        raise SchedulingError(f'This case is marked {case.status.lower()}. Reopen the case before scheduling '
                              'its next hearing.', 'CASE_CLOSED', 409)
    return next_date, result


def _detail_row(event_id, advocate_id):
    """The hearing's detail row, locked (created if missing; a parallel create wins)."""
    try:
        with transaction.atomic():
            HearingDetail.objects.get_or_create(event_id=event_id, defaults={'advocate_id': advocate_id})
    except IntegrityError:
        pass
    return HearingDetail.objects.select_for_update().get(event_id=event_id)


def save_detail(event, user, data):
    """Store the hearing's detail and schedule (or move) its next hearing.
    Call after check(). Returns (next_event or None, created: bool). Runs in one
    transaction with the detail row locked, so a double submit can't add two."""
    next_date, result = check(event.event_type, event.date, event.case, data)
    vals = {col: (data.get(api) or '') for col, api in DETAIL_KEYS.items()}
    with transaction.atomic():
        existing = HearingDetail.objects.select_for_update().filter(event_id=event.id).first()
        if not any(vals.values()) and not next_date and not result:
            # Nothing recorded: as before, drop an empty detail row - unless it
            # carries the hearing chain, which is history and stays.
            if existing and not existing.next_event_id and not existing.previous_event_id:
                existing.delete()
            elif existing:
                for col in vals:
                    setattr(existing, col, '')
                existing.next_date, existing.result = None, ''
                existing.save()
            return None, False
        detail = existing or _detail_row(event.id, user.id)
        for col, value in vals.items():
            setattr(detail, col, value)
        detail.next_date, detail.result = next_date, result
        detail.advocate_id = detail.advocate_id or user.id
        nxt, created = (None, False)
        if next_date:
            nxt, created = _schedule(event, detail, next_date, user)
            detail.next_event_id = nxt.id
        detail.save()
    if created:
        _announce(user, nxt)
    return nxt, created


def _schedule(event, detail, next_date, user):
    """The next hearing for this one: the linked one (moved if the date changed),
    else a hearing already on the case that day (linked), else a new one."""
    nxt = None
    if detail.next_event_id:
        nxt = CaseEvent.objects.select_for_update().filter(id=detail.next_event_id, case_id=event.case_id).first()
    if nxt is not None:
        if nxt.date != next_date:
            old = nxt.date
            nxt.date = next_date
            nxt.notified = False            # the reminder is due again for the new date
            nxt.save(update_fields=['date', 'notified'])
            announce_moved(user, nxt, old)
        return nxt, False
    taken = set(HearingDetail.objects.exclude(event_id=event.id).exclude(next_event_id=None)
                .values_list('next_event_id', flat=True))
    same_day = (CaseEvent.objects.filter(case_id=event.case_id, event_type='HEARING', date=next_date)
                .exclude(id=event.id).exclude(id__in=taken).order_by('id').first())
    if same_day is not None:
        _link_previous(same_day, event, detail, user)
        return same_day, False
    nxt = CaseEvent.objects.create(
        title=event.title, event_type='HEARING', date=next_date, time=None, notified=False,
        description=f'Next hearing, from the hearing on {event.date:%d %b %Y}'
        if isinstance(event.date, datetime.date) else 'Next hearing',
        case_id=event.case_id, advocate_id=user.id)
    HearingDetail.objects.create(event_id=nxt.id, advocate_id=user.id, court=detail.court,
                                 bench_hall=detail.bench_hall, judge=detail.judge, previous_event_id=event.id)
    return nxt, True


def _link_previous(nxt, event, detail, user):
    row = HearingDetail.objects.filter(event_id=nxt.id).first()
    if row is None:
        HearingDetail.objects.create(event_id=nxt.id, advocate_id=user.id, court=detail.court,
                                     bench_hall=detail.bench_hall, judge=detail.judge, previous_event_id=event.id)
    elif not row.previous_event_id:
        row.previous_event_id = event.id
        row.save(update_fields=['previous_event_id', 'updated_at'])


def announce_moved(user, event, old_date):
    """A hearing really moved to another date: tell the case's team and the
    client (HEARING_RESCHEDULED), after commit. Callers read old_date with the
    event row locked, so a retried or parallel save that finds the date already
    changed is no change and announces nothing. Reminders queued for the old
    date are dropped at send time (process_notifications)."""
    if event.event_type != 'HEARING' or old_date is None or str(old_date) == str(event.date):
        return
    from notifications import client_events, internal_events

    def send():
        fresh = CaseEvent.objects.select_related('case').filter(id=event.id).first()
        if fresh is None or str(fresh.date) == str(old_date):
            return                              # removed, or moved back before commit
        case = fresh.case
        client_events.hearing_rescheduled(user, case.client, fresh, case, old_date)
        internal_events.hearing_rescheduled_team(user, fresh, case, old_date)
    transaction.on_commit(send)


def _announce(user, nxt):
    """Same notices as a hearing added by hand (client + case team), after commit."""
    from notifications import client_events, internal_events

    def send():
        case = nxt.case
        client_events.hearing_scheduled(user, case.client, nxt, case)
        internal_events.hearing_added_team(user, nxt, case)
    transaction.on_commit(send)
