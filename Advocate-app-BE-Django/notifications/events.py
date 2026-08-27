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

from django.utils import timezone

from core.models import (Advocate, Case, CaseEvent, Invoice,
                         NotificationHistory, NotificationQueue)
from workspace.models import CaseTask
from notifications import service

log = logging.getLogger(__name__)

# How far ahead to warn about a hearing.
HEARING_LOOKAHEAD_DAYS = 2


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
        if _already_notified(advocate.id, 'HEARING_REMINDER', ev.id, since):
            continue
        case_no = ev.case.case_number if ev.case_id and ev.case else 'N/A'
        when = 'today' if ev.date == today else ev.date.strftime('%d %b %Y')
        subject = 'Hearing {}: {}'.format(when, case_no)
        body = ('Hearing {}\n\nCase   : {}\nDate   : {}\nTime   : {}\n'
                'Purpose: {}\n').format(
            when, case_no, ev.date, ev.time or 'not stated',
            ev.title or 'Hearing')
        queued += service.notify(
            advocate.id, 'HEARING_REMINDER', subject, body,
            channels=_channels(advocate), case_id=ev.case_id,
            entity='CaseEvent', entity_id=ev.id, triggered_by='SCHEDULED')
    return queued


def overdue_invoices(advocate, today=None):
    """OVERDUE_PAYMENT_REMINDER, once a week per invoice."""
    today = today or timezone.now().date()
    since = timezone.now() - datetime.timedelta(days=7)
    queued = []
    invoices = (Invoice.objects.select_related('client')
                .filter(advocate_id=advocate.id, due_date__lt=today)
                .exclude(status__iexact='PAID'))
    for inv in invoices:
        if _already_notified(advocate.id, 'OVERDUE_PAYMENT_REMINDER', inv.id, since):
            continue
        days = (today - inv.due_date).days
        client = inv.client.name if inv.client_id and inv.client else 'client'
        subject = 'Invoice {} overdue by {} day(s)'.format(
            inv.invoice_number or inv.id, days)
        body = ('Invoice   : {}\nClient    : {}\nAmount    : {}\n'
                'Due date  : {} ({} day(s) overdue)\n').format(
            inv.invoice_number or inv.id, client, inv.amount, inv.due_date, days)
        queued += service.notify(
            advocate.id, 'OVERDUE_PAYMENT_REMINDER', subject, body,
            channels=_channels(advocate), client_id=inv.client_id,
            entity='Invoice', entity_id=inv.id, triggered_by='SCHEDULED')
    return queued


def task_deadlines(advocate, today=None):
    """TASK_DEADLINE_REMINDER for open tasks due today or already past."""
    today = today or timezone.now().date()
    since = timezone.now() - datetime.timedelta(days=1)
    queued = []
    tasks = (CaseTask.objects
             .filter(advocate_id=advocate.id, completed=False,
                     deadline__lte=today)
             .exclude(deadline=None).order_by('deadline'))
    for t in tasks:
        if _already_notified(advocate.id, 'TASK_DEADLINE_REMINDER', t.id, since):
            continue
        overdue = (today - t.deadline).days
        case_no = None
        if t.case_id:
            c = Case.objects.filter(id=t.case_id).only('case_number').first()
            case_no = c.case_number if c else None
        when = 'due today' if overdue == 0 else '{} day(s) overdue'.format(overdue)
        subject = 'Task {}: {}'.format(when, t.title)
        body = ('Task     : {}\nPriority : {}\nDeadline : {} ({})\n'
                'Case     : {}\n').format(
            t.title, t.priority, t.deadline, when, case_no or 'not linked')
        queued += service.notify(
            advocate.id, 'TASK_DEADLINE_REMINDER', subject, body,
            channels=_channels(advocate), case_id=t.case_id,
            entity='CaseTask', entity_id=t.id, triggered_by='SCHEDULED')
    return queued


PRODUCERS = (upcoming_hearings, overdue_invoices, task_deadlines)


def scan_due_notifications(advocate_id=None):
    """Run every producer for one advocate, or for all of them."""
    advocates = (Advocate.objects.filter(id=advocate_id) if advocate_id
                 else Advocate.objects.all())
    queued = []
    for advocate in advocates:
        for producer in PRODUCERS:
            try:
                queued += producer(advocate)
            except Exception:                               # noqa: BLE001
                # One broken producer must not stop the others.
                log.exception('notifications: %s failed for advocate %s',
                              producer.__name__, advocate.id)
    return queued
