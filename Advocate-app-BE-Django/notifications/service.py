"""The one way to raise a notification.

Everything that wants to tell an advocate something calls notify(). It only
ENQUEUES - it never sends inline, because sending is slow (SMTP, and later the
WhatsApp Graph API) and a web request must not wait on it, nor fail because a
provider is down. `process_notifications` drains the queue.

The tables this uses were all already in the schema, left behind by the Spring
backend: notification_queue (with retry_count / max_retries / next_retry_at),
notification_history (the delivery audit) and notification_templates. Nothing
here is a new design - it wires up what was already modelled but never used.

Channel and status vocabularies are fixed by what the Notifications Center
already renders: EMAIL / WHATSAPP / IN_APP, and SENT / FAILED / PENDING.
"""

from __future__ import annotations

import io
import json
import logging

from django.utils import timezone

from core.models import CommunicationSettings, NotificationQueue

log = logging.getLogger(__name__)

# --- channels -------------------------------------------------------------
EMAIL = 'EMAIL'
WHATSAPP = 'WHATSAPP'
IN_APP = 'IN_APP'
ALL_CHANNELS = (IN_APP, EMAIL, WHATSAPP)

# --- queue row status -----------------------------------------------------
# These four are what the notification_queue / notification_history CHECK
# constraints permit (along with PROCESSING, which we do not need).
QUEUED = 'PENDING'
SENT = 'SENT'
FAILED = 'FAILED'
FAILED_PERMANENTLY = 'FAILED_PERMANENTLY'

# --- event types ----------------------------------------------------------
# These are the values the Notifications Center already knows how to label, so
# emitting anything else would show up as a raw string in the UI.
EVENT_TYPES = {
    'CLIENT_REGISTERED', 'CASE_CREATED', 'CASE_STATUS_UPDATED', 'CASE_CLOSED',
    'HEARING_SCHEDULED', 'HEARING_REMINDER', 'HEARING_RESCHEDULED',
    'INVOICE_GENERATED', 'PAYMENT_RECEIVED', 'EXPENSE_UPDATED',
    'OVERDUE_PAYMENT_REMINDER', 'TASK_DEADLINE_REMINDER', 'PASSWORD_RESET',
}


def notify(advocate_id, event_type, subject, body, channels=(IN_APP,),
           case_id=None, client_id=None, recipient_name=None,
           recipient_email=None, recipient_phone=None, entity=None,
           entity_id=None, triggered_by='SYSTEM'):
    """Queue one notification per channel. Returns the queued row ids.

    Raising a notification must never break the thing that raised it, so any
    failure here is logged and swallowed - a missing reminder is a far smaller
    problem than a failed case save.
    """
    if event_type not in EVENT_TYPES:
        # Not fatal: the UI falls back to showing the raw string. Worth a log
        # so a typo does not quietly produce an unlabelled row forever.
        log.warning('notify: unknown event_type %r', event_type)

    queued = []
    for channel in channels:
        if channel not in ALL_CHANNELS:
            log.warning('notify: unknown channel %r, skipped', channel)
            continue
        payload = {
            'eventType': event_type,
            'channel': channel,
            'subject': subject,
            'body': body,
            'caseId': case_id,
            'clientId': client_id,
            'recipientName': recipient_name,
            'recipientEmail': recipient_email,
            'recipientPhone': recipient_phone,
            'entity': entity,
            'entityId': entity_id,
            'triggeredBy': triggered_by,
        }
        try:
            row = NotificationQueue.objects.create(
                type=event_type,
                status=QUEUED,
                payload_json=json.dumps(payload, default=str),
                retry_count=0,
                max_retries=3,
                created_at=timezone.now(),
                advocate_id=advocate_id,
            )
            queued.append(row.id)
        except Exception:                                   # noqa: BLE001
            log.exception('notify: could not queue %s/%s', event_type, channel)
    return queued


# --- notifying the CLIENT -------------------------------------------------
# Everything above addresses the ADVOCATE. notify_client() is the one way to
# write to a client, and it exists separately for one reason: if
# recipient_email is left empty, process_notifications falls back to the
# advocate's own inbox. A client notification that quietly goes to the advocate
# instead is worse than none, so the address is resolved here and the call is
# abandoned when there isn't one.

def client_email_enabled(advocate_id):
    """Per-advocate kill switch, from communication_settings.email_enabled.

    Absent settings means "not configured yet", which we treat as enabled so
    the feature works out of the box; an explicit False turns it off.
    """
    row = (CommunicationSettings.objects
           .filter(advocate_id=advocate_id)
           .only('email_enabled').first())
    return True if row is None else bool(row.email_enabled)


def send_now(queued_ids):
    """Deliver these queue rows immediately instead of waiting for the drain.

    Reuses `process_notifications` rather than reimplementing delivery, so
    retry/backoff, notification_history and the audit trail stay in exactly one
    place. Anything that fails here is left PENDING, so the scheduled run picks
    it up and retries with backoff - immediate delivery is an optimisation, not
    a replacement for the queue.

    Never raises: the request that triggered the notification must not fail
    because SMTP was slow or down.
    """
    if not queued_ids:
        return
    try:
        from django.core.management import call_command
        buf = io.StringIO()          # keep command output out of the server log
        call_command('process_notifications', ids=list(queued_ids),
                     limit=len(queued_ids), stdout=buf, stderr=buf)
    except Exception:                                       # noqa: BLE001
        log.exception('send_now: inline delivery failed for %s; '
                      'leaving it queued for the scheduled drain', queued_ids)


def notify_client(advocate_id, client, event_type, subject, body,
                  case_id=None, entity=None, entity_id=None,
                  triggered_by='SYSTEM'):
    """Queue one EMAIL addressed to `client`. Returns queued row ids.

    Never raises: telling a client about an invoice must not be able to fail
    the request that created the invoice.
    """
    try:
        if client is None:
            return []
        email = (getattr(client, 'email', '') or '').strip()
        if not email:
            log.info('notify_client: client %s has no email on file, skipped',
                     getattr(client, 'id', None))
            return []
        if not client_email_enabled(advocate_id):
            log.info('notify_client: email disabled for advocate %s, skipped',
                     advocate_id)
            return []
        queued = notify(advocate_id, event_type, subject, body,
                        channels=(EMAIL,), case_id=case_id, client_id=client.id,
                        recipient_name=getattr(client, 'name', None),
                        recipient_email=email, entity=entity,
                        entity_id=entity_id, triggered_by=triggered_by)
        # Clients are told straight away - an invoice or a hearing date is not
        # something to sit in a queue for five minutes. It is still queued
        # first, so a failure here is retried rather than lost.
        send_now(queued)
        return queued
    except Exception:                                       # noqa: BLE001
        log.exception('notify_client: could not queue %s', event_type)
        return []
