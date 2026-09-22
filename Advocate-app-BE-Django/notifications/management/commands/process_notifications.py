"""Drain the notification queue: send, then record what happened.

    manage.py process_notifications --limit 100

Run every few minutes from the scheduler. This is the only thing that sends,
so notify() stays fast and no web request ever waits on SMTP.

Every attempt writes a notification_history row - SENT or FAILED, with the
provider's own error text - because "was the client actually told about the
hearing?" is a question an advocate will eventually need answered precisely.

Retries use the queue's own retry_count / max_retries / next_retry_at columns
with backoff, so a provider outage delays delivery instead of losing it. A row
that exhausts its retries stays FAILED and visible rather than being deleted.
"""

from __future__ import annotations

import datetime
import json
import logging
import os

from django.conf import settings
from django.core.mail import send_mail, EmailMultiAlternatives
from django.core.management.base import BaseCommand
from django.utils import timezone
from django.utils.html import escape

from core.audit import record_system_action
from core.models import (Advocate, Case, Client, Notification,
                         NotificationHistory, NotificationQueue)
from core.practice import practice_root
from notifications import service

log = logging.getLogger(__name__)

# Minutes to wait before retry n. Beyond this the row is left FAILED.
BACKOFF_MINUTES = [5, 30, 120]


class Command(BaseCommand):
    help = 'Send queued notifications and record delivery history.'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100,
                            help='Max queued rows to process (default 100).')
        parser.add_argument('--dry-run', action='store_true',
                            help='Show what would be sent; send nothing.')
        parser.add_argument('--ids', nargs='+', type=int, default=None,
                            help='Only these queue row ids. Used by '
                                 'service.send_now() to deliver a just-queued '
                                 'notification inline instead of waiting for '
                                 'the next scheduled run.')

    def handle(self, *args, **o):
        now = timezone.now()
        qs = NotificationQueue.objects.filter(status=service.QUEUED)
        if o.get('ids'):
            qs = qs.filter(id__in=o['ids'])
        rows = list(qs.order_by('id')[:o['limit']])

        sent = failed = waiting = 0
        for row in rows:
            # Respect the backoff window set by a previous failure.
            if row.next_retry_at and row.next_retry_at > now:
                waiting += 1
                continue
            try:
                payload = json.loads(row.payload_json or '{}')
            except ValueError:
                self._fail(row, 'payload_json is not valid JSON', now)
                failed += 1
                continue

            channel = payload.get('channel') or service.IN_APP
            if o['dry_run']:
                self.stdout.write('  would send {} via {} to advocate {}'.format(
                    payload.get('eventType'), channel, row.advocate_id))
                continue

            try:
                detail = self._deliver(row, payload, channel)
            except Exception as exc:                        # noqa: BLE001
                self._fail(row, '{}: {}'.format(type(exc).__name__, exc), now)
                self._history(row, payload, channel, 'FAILED',
                              error=str(exc)[:2000], now=now)
                self._audit(row, payload, channel, ok=False, error=str(exc))
                failed += 1
                continue

            row.status = service.SENT
            row.last_error = None
            row.save(update_fields=['status', 'last_error'])
            self._history(row, payload, channel, 'SENT', detail=detail, now=now)
            self._audit(row, payload, channel, ok=True)
            sent += 1


        self.stdout.write(self.style.SUCCESS(
            'Queue: {} sent, {} failed, {} waiting on backoff.{}'.format(
                sent, failed, waiting, ' [dry run]' if o['dry_run'] else '')))

    # -- delivery ----------------------------------------------------------

    def _deliver(self, row, payload, channel):
        """Send on one channel. Raises on failure; returns a provider note."""
        if channel == service.IN_APP:
            # Carry the target through. notify() already knows what the
            # notification is about; dropping it here was why clicking one in
            # the bell could only mark it read - there was nowhere to go.
            Notification.objects.create(
                created_at=timezone.now(),
                message=(payload.get('subject') or payload.get('body') or '')[:255],
                read_status=False,
                advocate_id=row.advocate_id,
                entity_type=(payload.get('entity') or '')[:50] or None,
                entity_id=payload.get('entityId'),
                case_id=payload.get('caseId'),
            )
            return 'in-app notification created'

        if channel == service.EMAIL:
            to = payload.get('recipientEmail') or self._advocate_email(row.advocate_id)
            if not to:
                raise ValueError(
                    'no recipient email for advocate {}'.format(row.advocate_id))
            subject = payload.get('subject') or '(no subject)'
            body = payload.get('body') or ''
            sender = getattr(settings, 'DEFAULT_FROM_EMAIL', None)
            brand = self._email_branding(row.advocate_id)
            if brand:
                msg = EmailMultiAlternatives(subject=subject, body=body,
                                             from_email=sender, to=[to])
                msg.attach_alternative(self._html_email(body, brand), 'text/html')
                msg.send(fail_silently=False)
            else:
                send_mail(subject=subject, message=body, from_email=sender,
                          recipient_list=[to], fail_silently=False)
            return 'smtp accepted for {}'.format(to)

        if channel == service.WHATSAPP:
            # communication/whatsapp.py is still a mock - it records
            # 'MOCK: WhatsApp accepted' without calling Meta's Graph API.
            # Rather than write a SENT history row for a message nobody
            # received, fail loudly until real credentials are wired in.
            raise NotImplementedError(
                'WhatsApp delivery is not implemented (no Meta credentials); '
                'enable it in communication_settings once verified')

        raise ValueError('unknown channel {!r}'.format(channel))

    # -- bookkeeping -------------------------------------------------------

    def _audit(self, row, payload, channel, ok, error=None):
        """One System Activity line per outbound attempt.

        In-app notifications are skipped: they are already visible to the
        advocate as the notification itself, and at a few hundred a week they
        would drown out everything else in the feed. Email and WhatsApp are the
        ones where "did it actually go out?" is a real question, so those are
        recorded whether they succeed or fail.
        """
        if channel == service.IN_APP:
            return
        event = payload.get('eventType') or 'notification'
        target = payload.get('recipientEmail') or payload.get('recipientPhone') or 'advocate'
        if ok:
            title = 'Sent {} by {}'.format(event.replace('_', ' ').lower(), channel.lower())
            desc = 'to {}'.format(target)
        else:
            title = 'Failed to send {} by {}'.format(
                event.replace('_', ' ').lower(), channel.lower())
            desc = '{}: {}'.format(target, (error or '')[:180])
        record_system_action(
            row.advocate_id, 'NOTIFICATIONS', 'SEND', title,
            description=desc, entity_type='NOTIFICATION_QUEUE',
            entity_id=row.id, ok=ok,
            # Successful sends stay out of the human-readable feed; a failure
            # is something the advocate should see there.
            in_feed=not ok)

    @staticmethod
    def _advocate_email(advocate_id):
        adv = Advocate.objects.filter(id=advocate_id).only('email').first()
        return adv.email if adv else None

    @staticmethod
    def _email_branding(advocate_id):
        """The firm's (practice owner's) branding for a branded HTML email."""
        adv = Advocate.objects.filter(id=advocate_id).first()
        if adv is None:
            return None
        owner = Advocate.objects.filter(id=practice_root(adv)).first() or adv
        logo_url = None
        if owner.office_logo_path:
            base = getattr(settings, 'PUBLIC_BASE_URL', '').rstrip('/')
            logo_url = base + '/api/profile/files/branding/' + os.path.basename(
                owner.office_logo_path.replace('\\', '/'))
        contact = ' · '.join([x for x in [owner.office_phone, owner.office_email,
                                          getattr(owner, 'website', None)] if x])
        return {
            'office_name': owner.office_name or owner.full_name or 'Advocate',
            'primary': owner.primary_brand_color or '#1f3a8a',
            'logo_url': logo_url,
            'contact': contact,
        }

    @staticmethod
    def _html_email(body, brand):
        """Wrap the plain body in a branded HTML shell (firm header + footer)."""
        primary = escape(brand['primary'])
        office = escape(brand['office_name'])
        logo = (f'<img src="{escape(brand["logo_url"])}" alt="{office}" '
                f'style="max-height:46px;margin-bottom:6px;">') if brand['logo_url'] else ''
        contact = ('<div style="color:#64748b;font-size:12px;margin-top:4px;">'
                   + escape(brand['contact']) + '</div>') if brand['contact'] else ''
        body_html = escape(body).replace('\n', '<br>')
        return f"""\
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;
     border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
  <div style="background:{primary};color:#ffffff;padding:18px 22px;">
    {logo}
    <div style="font-size:18px;font-weight:700;">{office}</div>
  </div>
  <div style="padding:22px;color:#1e293b;font-size:14px;line-height:1.6;">
    {body_html}
  </div>
  <div style="border-top:3px solid {primary};padding:16px 22px;background:#f8fafc;">
    <div style="font-weight:600;color:#334155;">{office}</div>
    {contact}
    <div style="color:#94a3b8;font-size:11px;margin-top:8px;">
      Sent via the Advocate Management System.
    </div>
  </div>
</div>"""

    def _fail(self, row, message, now):
        """Mark a queue row failed, scheduling a retry if any remain."""
        row.retry_count = (row.retry_count or 0) + 1
        row.last_error = message[:2000]
        max_retries = row.max_retries or 3
        if row.retry_count < max_retries and row.retry_count <= len(BACKOFF_MINUTES):
            row.status = service.QUEUED          # try again after backoff
            row.next_retry_at = now + datetime.timedelta(
                minutes=BACKOFF_MINUTES[row.retry_count - 1])
        else:
            # The schema distinguishes these, and so should we: FAILED is one
            # bad attempt, FAILED_PERMANENTLY is out of retries.
            row.status = service.FAILED_PERMANENTLY
        row.save(update_fields=['retry_count', 'last_error', 'status',
                                'next_retry_at'])
        self.stderr.write(self.style.WARNING(
            '  queue {} -> {} ({})'.format(row.id, row.status, message[:120])))

    # notification_history.channel is CHECK-constrained to the outbound
    # channels. That is the schema saying history is a DELIVERY audit: an
    # in-app notification is already its own record in `notifications`, so
    # writing a history row for it is both rejected and redundant.
    OUTBOUND_CHANNELS = {service.EMAIL, service.WHATSAPP, 'SMS', 'PUSH'}

    def _history(self, row, payload, channel, status, detail=None, error=None,
                 now=None):
        """One delivery-audit row per outbound attempt."""
        if channel not in self.OUTBOUND_CHANNELS:
            return
        now = now or timezone.now()
        case_number = client_name = None
        if payload.get('caseId'):
            c = Case.objects.filter(id=payload['caseId']).only('case_number').first()
            case_number = c.case_number if c else None
        if payload.get('clientId'):
            cl = Client.objects.filter(id=payload['clientId']).only('name').first()
            client_name = cl.name if cl else None
        try:
            NotificationHistory.objects.create(
                type=payload.get('eventType') or 'UNKNOWN',
                channel=channel,
                status=status,
                recipient=(payload.get('recipientEmail')
                           or payload.get('recipientPhone') or ''),
                recipient_name=payload.get('recipientName') or client_name or '',
                recipient_email=payload.get('recipientEmail') or '',
                recipient_phone=payload.get('recipientPhone') or '',
                subject=(payload.get('subject') or '')[:255],
                message=(payload.get('body') or '')[:2000],
                body=payload.get('body') or '',
                event_type=payload.get('eventType') or '',
                template_used=payload.get('templateUsed') or '',
                triggered_by=payload.get('triggeredBy') or 'SYSTEM',
                error_message=error or '',
                failure_reason=error or '',
                provider_response=detail or error or '',
                response_body='',
                status_code=200 if status == 'SENT' else 500,
                retry_count=row.retry_count or 0,
                entity=payload.get('entity') or (case_number or ''),
                entity_id=payload.get('entityId'),
                sent_at=now,
                failed_at=None if status == 'SENT' else now,
                created_at=now,
                advocate_id=row.advocate_id,
                case_id=payload.get('caseId'),
                client_id=payload.get('clientId'),
            )
        except Exception:                                   # noqa: BLE001
            # History is an audit trail, not the delivery itself - never let a
            # bookkeeping failure look like a send failure.
            log.exception('process_notifications: history write failed')
