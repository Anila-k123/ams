import datetime
import csv
from django.conf import settings as dj_settings
from django.core.mail import send_mail
from django.http import HttpResponse
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http

from core.models import (CommunicationSettings,
                         NotificationHistory, NotificationLog, NotificationQueue)
from core.pagination import SpringStylePagination
from core.practice import practice_ids


def _now():
    return datetime.datetime.now()


def _iso(v):
    return v.isoformat() if isinstance(v, (datetime.date, datetime.datetime)) else None


# ==================== SETTINGS ====================

def _settings_map(s):
    return {
        'id': s.id, 'emailEnabled': s.email_enabled, 'whatsappEnabled': s.whatsapp_enabled,
        'smtpHost': s.smtp_host, 'smtpPort': s.smtp_port, 'senderEmail': s.sender_email,
        'senderName': s.sender_name, 'replyToEmail': s.reply_to_email,
        'emailSignature': s.email_signature, 'maxRetryCount': s.max_retry_count,
        'retryDelayMinutes': s.retry_delay_minutes, 'queueEnabled': s.queue_enabled,
        'website': s.website, 'officeAddress': s.office_address,
        'encryptedPassword': '',
        'whatsappPhoneNumberId': s.whatsapp_phone_number_id,
        'whatsappBusinessAccountId': s.whatsapp_business_account_id,
        # Never send the token itself. The SMTP password was already blanked;
        # this one was going to the browser in plaintext on every settings
        # load. The client only needs to know whether one is stored.
        'whatsappAccessToken': '',
        'whatsappTokenSet': bool(s.whatsapp_access_token),
        'smtpPasswordSet': bool(s.encrypted_password),
        'createdAt': _iso(s.created_at), 'updatedAt': _iso(s.updated_at),
    }


def _get_or_create_settings(advocate_id):
    s = CommunicationSettings.objects.filter(advocate_id=advocate_id).first()
    if s is None:
        now = _now()
        s = CommunicationSettings.objects.create(
            email_enabled=True, whatsapp_enabled=False, queue_enabled=True,
            max_retry_count=3, retry_delay_minutes=5, created_at=now, updated_at=now,
            advocate_id=advocate_id)
    return s


class SettingsView(APIView):
    def get(self, request):
        return Response(_settings_map(_get_or_create_settings(request.user.id)))

    def put(self, request):
        s = _get_or_create_settings(request.user.id)
        d = request.data
        field_map = {
            'emailEnabled': 'email_enabled', 'whatsappEnabled': 'whatsapp_enabled',
            'smtpHost': 'smtp_host', 'smtpPort': 'smtp_port', 'senderEmail': 'sender_email',
            'senderName': 'sender_name', 'replyToEmail': 'reply_to_email',
            'emailSignature': 'email_signature', 'maxRetryCount': 'max_retry_count',
            'retryDelayMinutes': 'retry_delay_minutes', 'queueEnabled': 'queue_enabled',
            'website': 'website', 'officeAddress': 'office_address',
            'whatsappPhoneNumberId': 'whatsapp_phone_number_id',
            'whatsappBusinessAccountId': 'whatsapp_business_account_id',
            'whatsappAccessToken': 'whatsapp_access_token',
        }
        for k, field in field_map.items():
            if k in d:
                setattr(s, field, d[k])
        raw_pw = d.get('encryptedPassword')
        if raw_pw and raw_pw not in ('encrypted', ''):
            s.encrypted_password = raw_pw  # stored as-is (dev); Spring encrypts
        s.updated_at = _now()
        s.save()
        out = _settings_map(s)
        out['encryptedPassword'] = 'encrypted' if raw_pw else ''
        return Response(out)


# ==================== TEMPLATES ====================

# Notification templates were removed. The page let you author a subject and
# body per event type, and nothing that SENDS a message ever read one - every
# notification is built from a hardcoded string in notifications/events.py and
# appeals/scan_appeals.py. So an advocate could write a template, mark it
# active, and every reminder still went out in the built-in wording.
#
# The `notification_templates` table is left in place (Spring-owned, 0 rows).
# To bring this back, the missing half is a render(event_type, channel, context)
# used by the producers, with a placeholder convention and a fallback to the
# current text - see git history for the CRUD that existed here.

# ==================== HISTORY ====================

def _history_map(h):
    return {
        'id': h.id, 'type': h.type, 'channel': h.channel, 'status': h.status,
        'recipient': h.recipient, 'recipientName': h.recipient_name,
        'recipientEmail': h.recipient_email, 'recipientPhone': h.recipient_phone,
        'subject': h.subject, 'message': h.message, 'body': h.body,
        'eventType': h.event_type, 'templateUsed': h.template_used,
        'triggeredBy': h.triggered_by, 'errorMessage': h.error_message,
        'failureReason': h.failure_reason, 'retryCount': h.retry_count,
        'sentAt': _iso(h.sent_at), 'failedAt': _iso(h.failed_at), 'createdAt': _iso(h.created_at),
        'caseId': h.case_id, 'clientId': h.client_id,
    }


class HistoryView(APIView):
    def get(self, request):
        p = request.query_params
        qs = NotificationHistory.objects.filter(advocate_id__in=practice_ids(request.user))
        if p.get('channel'):
            qs = qs.filter(channel=p['channel'])
        if p.get('status'):
            qs = qs.filter(status=p['status'])
        if p.get('eventType'):
            qs = qs.filter(event_type=p['eventType'])
        if p.get('search'):
            from django.db.models import Q
            s = p['search']
            qs = qs.filter(Q(recipient__icontains=s) | Q(subject__icontains=s) |
                           Q(message__icontains=s) | Q(recipient_name__icontains=s))
        qs = qs.order_by('-sent_at', '-id')
        if p.get('page') is not None and p.get('size') is not None:
            paginator = SpringStylePagination()
            page = paginator.paginate_queryset(qs, request, self)
            return paginator.get_paginated_response([_history_map(h) for h in page])
        return Response([_history_map(h) for h in qs])


# ==================== STATISTICS ====================

class StatisticsView(APIView):
    def get(self, request):
        # Practice-wide, matching LogsView and the history endpoints. This used
        # a local `aid = request.user.id`, so the sweep that widened everything
        # else missed it - leaving this page counting only your own messages
        # while the History page beside it counted the whole practice's. Two
        # screens in one section disagreeing about the same number.
        aid = practice_ids(request.user)
        today = datetime.datetime.combine(datetime.date.today(), datetime.time.min)
        H = NotificationHistory.objects.filter(advocate_id__in=aid)
        Q = NotificationQueue.objects.filter(advocate_id__in=aid)
        return Response({
            'totalSent': H.filter(status='SENT').count(),
            'failedTotal': H.filter(status='FAILED').count(),
            'pendingTotal': H.filter(status='PENDING').count(),
            'emailsToday': H.filter(channel='EMAIL', sent_at__gte=today).count(),
            'whatsappToday': H.filter(channel='WHATSAPP', sent_at__gte=today).count(),
            'failedToday': H.filter(status='FAILED', sent_at__gte=today).count(),
            'sentToday': H.filter(status='SENT', sent_at__gte=today).count(),
            'queuePending': Q.filter(status='PENDING').count(),
            'queueProcessing': Q.filter(status='PROCESSING').count(),
            'queueFailed': Q.filter(status='FAILED').count(),
            # What the status cards should actually be driven by. The page was
            # showing "Connected" purely from the emailEnabled / whatsappEnabled
            # preference toggles, so email read Connected while its own subtitle
            # said "No email configured" and every send failed 535.
            'emailConfigured': _email_configured(request.user.id),
            'whatsappConfigured': False,
            'whatsappSupported': False,
            'recentEmailFailures': H.filter(
                channel='EMAIL', status='FAILED', sent_at__gte=today).count(),
        })


def _email_configured(advocate_id):
    """True only when there is enough to actually send: a host and a sender.

    A toggle being on is an intention, not a capability.
    """
    s = CommunicationSettings.objects.filter(advocate_id=advocate_id).first()
    if s is None or not s.email_enabled:
        return False
    return bool((s.smtp_host or '').strip() and (s.sender_email or '').strip())


# ==================== LOGS ====================

class LogsView(APIView):
    def get(self, request):
        qs = NotificationLog.objects.filter(advocate_id__in=practice_ids(request.user)).order_by('-created_at', '-id')
        return Response([{
            'id': l.id, 'logLevel': l.log_level, 'message': l.message, 'channel': l.channel,
            'eventType': l.event_type, 'recipient': l.recipient, 'details': l.details,
            'createdAt': _iso(l.created_at),
        } for l in qs])


# ==================== QUEUE STATUS ====================

class QueueStatusView(APIView):
    def get(self, request):
        Q = NotificationQueue.objects.filter(advocate_id__in=practice_ids(request.user))
        return Response({
            'pending': Q.filter(status='PENDING').count(),
            'processing': Q.filter(status='PROCESSING').count(),
            'failed': Q.filter(status='FAILED').count(),
            'failedPermanent': Q.filter(status='FAILED_PERMANENTLY').count(),
        })


# ==================== TEST NOTIFICATION ====================

class TestView(APIView):
    def post(self, request):
        d = request.data
        channel = (d.get('channel') or 'EMAIL').upper()
        advocate = request.user
        success, provider_resp, err = True, None, None
        if channel == 'WHATSAPP':
            provider_resp = 'MOCK: WhatsApp message accepted (mock provider)'
        else:
            to = d.get('recipientEmail')
            if not to:
                success, err = False, 'recipientEmail is required for email'
            else:
                try:
                    send_mail(
                        subject=d.get('subject') or 'Test Notification',
                        message=d.get('message') or 'This is a test message.',
                        from_email=dj_settings.DEFAULT_FROM_EMAIL,
                        recipient_list=[to], fail_silently=False)
                    provider_resp = 'Email sent via SMTP'
                except Exception as e:
                    success, err = False, str(e)
        # Record in history
        now = _now()
        NotificationHistory.objects.create(
            type=(d.get('type') or 'CUSTOM'), channel=channel,
            status='SENT' if success else 'FAILED',
            recipient=d.get('recipientEmail') or d.get('recipientPhone'),
            recipient_name=d.get('recipientName'), recipient_email=d.get('recipientEmail'),
            recipient_phone=d.get('recipientPhone'), subject=d.get('subject'),
            message=d.get('message'), body=d.get('message'), event_type='TEST',
            triggered_by='MANUAL_TEST', provider_response=provider_resp,
            error_message=err, failure_reason=err, retry_count=0,
            sent_at=now, failed_at=None if success else now, created_at=now,
            advocate_id=advocate.id)
        return Response({'success': success, 'providerResponse': provider_resp, 'errorMessage': err})


# ==================== EXPORT CSV ====================

class ExportCsvView(APIView):
    def get(self, request):
        qs = NotificationHistory.objects.filter(advocate_id__in=practice_ids(request.user)).order_by('-sent_at')[:10000]
        resp = HttpResponse(content_type='text/csv; charset=UTF-8')
        resp['Content-Disposition'] = 'attachment; filename=notification_history.csv'
        w = csv.writer(resp)
        w.writerow(['Sent At', 'Type', 'Channel', 'Status', 'Recipient', 'Subject', 'Error'])
        for h in qs:
            w.writerow([_iso(h.sent_at), h.type, h.channel, h.status,
                        h.recipient or '', h.subject or '', h.error_message or ''])
        return resp
