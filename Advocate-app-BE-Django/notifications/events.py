"""Turn data the app already holds into notifications worth sending.

Note on dates: the project runs USE_TZ = False because the Spring-era columns
are naive local time, so timezone.localdate() raises here - use
timezone.now().date().

Called by the Notifications Center's "check now" button and by the scheduled
run. Everything here only ENQUEUES via notify(); process_notifications sends.

Each producer is deliberately idempotent for the window it runs in: it will
not queue the same reminder twice, because the queue and history rows already
written are checked first. Without that, a scheduler firing every few minutes
would tell an advocate about the same hearing dozens of times - the fastest
way to make someone mute notifications permanently.
"""

from __future__ import annotations

import datetime
import json
import logging

from decouple import config
from django.utils import timezone

from django.db import IntegrityError, transaction

from core.audit import record_system_action
from core.jobs import job_run
from core.tenant import can_receive, firm_active, firm_id_of_advocate
from core.models import (Advocate, Case, CaseEvent, Invoice,
                         NotificationHistory, NotificationQueue)
from workspace.models import CaseTask
from core.practice import case_alert_permission
from notifications import service

log = logging.getLogger(__name__)

# How far ahead to warn about a hearing.
HEARING_LOOKAHEAD_DAYS = 2
# Open tasks are flagged this many days before their deadline, so there's time
# to finish them (TASK_REMINDER_DAYS in .env; default 2).
TASK_REMINDER_DAYS = config('TASK_REMINDER_DAYS', default=2, cast=int)


def _already_notified(advocate_id, event_type, entity_id, since):
    """Has this exact reminder already been raised since `since`?

    Checks the QUEUE, not just notification_history. History only records
    outbound channels (its channel column is CHECK-constrained to
    EMAIL/WHATSAPP/SMS/PUSH), so an in-app-only reminder leaves no history row
    at all - deduping on history alone would re-queue it on every single run
    and bury the advocate in duplicates.

    Payloads are compared in Python rather than by matching JSON text:
    '"entityId": 12' also matches entity 120.
    """
    if NotificationHistory.objects.filter(
            advocate_id=advocate_id, event_type=event_type,
            entity_id=entity_id, sent_at__gte=since).exists():
        return True
    recent = NotificationQueue.objects.filter(
        advocate_id=advocate_id, type=event_type, created_at__gte=since
    ).only('payload_json')
    for row in recent:
        try:
            if json.loads(row.payload_json or '{}').get('entityId') == entity_id:
                return True
        except ValueError:
            continue
    return False


def claim(recipient_id, event_type, entity, entity_id, period, firm_id=None):
    """Reserve one reminder for one person and period. False if it was already
    raised - by this scan, a parallel one, or a retried one (unique index on
    notification_key). `period` is the window the reminder belongs to: the day
    for daily reminders, the ISO week for weekly ones."""
    from notifications.models import NotificationKey
    key = '{}:{}:{}:{}:{}'.format(event_type, entity, entity_id, recipient_id, period)[:200]
    try:
        with transaction.atomic():
            NotificationKey.objects.create(key=key, firm_id=firm_id)
        return True
    except IntegrityError:
        return False


def _deliverable(people, firm_id):
    """Only people who may hear about this firm's work now (core/tenant.can_receive):
    not left, active membership of that active firm."""
    return [p for p in people if can_receive(p.id, firm_id)]


def _channels(advocate):
    """Where this advocate wants to hear about things.

    In-app is always on: it costs nothing and is the record of what was
    raised. Email follows the advocate's own preference flag. WhatsApp is
    deliberately excluded until real Meta credentials exist - queueing for a
    channel that cannot deliver would just manufacture FAILED rows.
    """
    channels = [service.IN_APP]
    if advocate and getattr(advocate, 'email_notifications_enabled', False) and advocate.email:
        channels.append(service.EMAIL)
    return channels


def fanout(owner, event_type, subject, body, since, *, entity, entity_id,
           require_permission=None, include_firm_wide=False, period=None, firm_id=None, **kw):
    """Queue one reminder to everyone it's relevant to, deduped per recipient.

    Puts a senior and their team in the same loop: a case belongs to the whole
    team, so an alert reaches every team member - each on their own channels,
    once each. `require_permission` keeps only members whose role grants it, so
    each role gets only what concerns it (a hearing alert -> CASE_ALERTS holders,
    not the accountant). `include_firm_wide` also reaches the common staff
    (e.g. accountants) across every team, for firm-wide matters like invoices.
    A solo advocate resolves to just themselves, so nothing changes for them.
    """
    from core.practice import alert_members, firm_wide_members, practice_root

    cache = {}
    recipients = alert_members(owner, permission=require_permission, perm_cache=cache)
    if include_firm_wide:
        seen = {m.id for m in recipients}
        for member in firm_wide_members(practice_root(owner),
                                        permission=require_permission,
                                        perm_cache=cache):
            if member.id not in seen:
                seen.add(member.id)
                recipients.append(member)

    queued = []
    for member in _deliverable(recipients, firm_id):
        if _already_notified(member.id, event_type, entity_id, since):
            continue
        if period and not claim(member.id, event_type, entity, entity_id, period, firm_id):
            continue
        queued += service.notify(
            member.id, event_type, subject, body,
            channels=_channels(member), entity=entity, entity_id=entity_id, **kw)
    return queued


def _task_people(task):
    """The assignee plus the assigner/creator, active and distinct."""
    ids = [task.assigned_to_id, task.assigned_by_id or task.advocate_id]
    ids = list(dict.fromkeys(i for i in ids if i))
    return list(Advocate.objects.filter(id__in=ids, left_on__isnull=True))


def _notify_people(people, event_type, subject, body, since, *, entity,
                   entity_id, period=None, firm_id=None, **kw):
    """Queue one reminder to each of `people`, deduped per recipient."""
    queued = []
    for member in _deliverable(people, firm_id):
        if _already_notified(member.id, event_type, entity_id, since):
            continue
        if period and not claim(member.id, event_type, entity, entity_id, period, firm_id):
            continue
        queued += service.notify(
            member.id, event_type, subject, body,
            channels=_channels(member), entity=entity, entity_id=entity_id, **kw)
    return queued


def upcoming_hearings(advocate, today=None):
    """HEARING_REMINDER for hearings in the next couple of days."""
    today = today or timezone.now().date()
    end = today + datetime.timedelta(days=HEARING_LOOKAHEAD_DAYS)
    # Re-raise at most once a day per hearing.
    since = timezone.now() - datetime.timedelta(hours=20)
    queued = []
    events = (CaseEvent.objects
              .select_related('case')
              .filter(advocate_id=advocate.id, date__gte=today, date__lte=end,
                      event_type__iexact='HEARING')
              .order_by('date'))
    for ev in events:
        case_no = ev.case.case_number if ev.case_id and ev.case else 'N/A'
        when = 'today' if ev.date == today else ev.date.strftime('%d %b %Y')
        subject = 'Hearing {}: {}'.format(when, case_no)
        body = ('Hearing {}\n\nCase   : {}\nDate   : {}\nTime   : {}\n'
                'Purpose: {}\n').format(
            when, case_no, ev.date, ev.time or 'not stated',
            ev.title or 'Hearing')
        queued += fanout(
            advocate, 'HEARING_REMINDER', subject, body, since,
            entity='CaseEvent', entity_id=ev.id, case_id=ev.case_id,
            require_permission=case_alert_permission(), triggered_by='SCHEDULED',
            period=today.isoformat(), firm_id=getattr(ev, 'firm_id', None))
    return queued


def overdue_invoices(advocate, today=None):
    """OVERDUE_PAYMENT_REMINDER, once a week per invoice."""
    today = today or timezone.now().date()
    since = timezone.now() - datetime.timedelta(days=7)
    queued = []
    invoices = (Invoice.objects.open().select_related('client')
                .filter(advocate_id=advocate.id, due_date__lt=today))
    for inv in invoices:
        days = (today - inv.due_date).days
        client = inv.client.name if inv.client_id and inv.client else 'client'
        subject = 'Invoice {} overdue by {} day(s)'.format(
            inv.invoice_number or inv.id, days)
        body = ('Invoice   : {}\nClient    : {}\nAmount    : {}\n'
                'Due date  : {} ({} day(s) overdue)\n').format(
            inv.invoice_number or inv.id, client, inv.amount, inv.due_date, days)
        queued += fanout(
            advocate, 'OVERDUE_PAYMENT_REMINDER', subject, body, since,
            entity='Invoice', entity_id=inv.id, client_id=inv.client_id,
            require_permission='INVOICE_VIEW', include_firm_wide=True,
            triggered_by='SCHEDULED', period='W{}-{:02d}'.format(*today.isocalendar()[:2]),
            firm_id=getattr(inv, 'firm_id', None))
    return queued


def task_deadlines(advocate, today=None):
    """TASK_DEADLINE_REMINDER for open tasks: once when the deadline is
    TASK_REMINDER_DAYS away or nearer ("due in 2 days"), then on the due date,
    then daily while overdue."""
    today = today or timezone.now().date()
    now = timezone.now()
    queued = []
    tasks = (CaseTask.objects
             .filter(advocate_id=advocate.id, completed=False, cancelled=False,
                     deadline__lte=today + datetime.timedelta(days=TASK_REMINDER_DAYS))
             .exclude(deadline=None).order_by('deadline'))
    for t in tasks:
        overdue = (today - t.deadline).days
        if overdue < 0:
            # Advance warning: one per task across the whole window (dedup
            # since the window opened), so it isn't repeated the next day.
            since = now - datetime.timedelta(days=TASK_REMINDER_DAYS + 1)
            when = 'due in {} day(s)'.format(-overdue) if overdue < -1 else 'due tomorrow'
            period = 'advance:{}'.format(t.deadline)
        else:
            # Due date and overdue: daily. 20h, so the advance warning sent
            # days earlier never suppresses the due-date one.
            since = now - datetime.timedelta(hours=20)
            when = 'due today' if overdue == 0 else '{} day(s) overdue'.format(overdue)
            period = today.isoformat()
        case_no = None
        if t.case_id:
            c = Case.objects.filter(id=t.case_id).only('case_number').first()
            case_no = c.case_number if c else None
        subject = 'Task {}: {}'.format(when, t.title)
        body = ('Task     : {}\nPriority : {}\nDeadline : {} ({})\n'
                'Case     : {}\n').format(
            t.title, t.priority, t.deadline, when, case_no or 'not linked')
        # A task reminder is for the people on the task - whoever it is
        # assigned to, and whoever handed it out - not the whole team.
        queued += _notify_people(
            _task_people(t), 'TASK_DEADLINE_REMINDER', subject, body, since,
            entity='CaseTask', entity_id=t.id, case_id=t.case_id,
            triggered_by='SCHEDULED', period=period, firm_id=getattr(t, 'firm_id', None))
    return queued


PRODUCERS = (upcoming_hearings, overdue_invoices, task_deadlines)


def scan_due_notifications(advocate_id=None):
    """Run every producer for one advocate, or for all of them.

    Each owner's reminders run in the context of the firm their work belongs
    to (resolved here, explicitly - there is no request). Work of a suspended
    or closed firm raises nothing. An owner who has LEFT is still scanned: the
    cases stay with the firm and their team must still hear about hearings;
    who is told is decided per recipient (_deliverable), never by the owner.
    """
    from clientaccess.gate import client_advocate_ids
    advocates = (Advocate.objects.filter(id=advocate_id) if advocate_id
                 else Advocate.objects.all()).exclude(id__in=client_advocate_ids())
    queued = []
    with job_run('scan_notifications') as run:
        skipped = failures = 0
        for advocate in advocates:
            firm_id = firm_id_of_advocate(advocate.id)
            if not firm_active(firm_id):
                skipped += 1
                continue
            before = len(queued)
            for producer in PRODUCERS:
                try:
                    queued += producer(advocate)
                except Exception as exc:                        # noqa: BLE001
                    failures += 1
                    # One broken producer must not stop the others.
                    log.exception('notifications: %s failed for advocate %s (firm %s)',
                                  producer.__name__, advocate.id, firm_id)
                    # A producer that silently stops working is how reminders go
                    # missing without anyone noticing, so put it on the record.
                    record_system_action(
                        advocate.id, 'NOTIFICATIONS', 'SCAN',
                        'Reminder check failed ({})'.format(producer.__name__),
                        description=type(exc).__name__, ok=False, in_feed=False)
            raised = len(queued) - before
            if raised:
                record_system_action(
                    advocate.id, 'NOTIFICATIONS', 'SCAN',
                    'Queued {} reminder(s)'.format(raised),
                    description='scheduled reminder check',
                    entity_type='NOTIFICATION_QUEUE', in_feed=False)
        run.counts.update({'queued': len(queued), 'suspendedFirmOwnersSkipped': skipped,
                           'producerFailures': failures})
        if failures:
            run.counts['_status'] = 'FAILED'
            run.counts['_error'] = '{} producer run(s) failed; see the log'.format(failures)
    return queued
