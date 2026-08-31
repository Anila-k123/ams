import datetime
from django.conf import settings
from django.core.mail import send_mail
from rest_framework.views import APIView
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status as http

from core.models import NotificationHistory
from core.practice import practice_ids

VERIFY_TOKEN = getattr(settings, 'WHATSAPP_VERIFY_TOKEN', 'AdvocateApp2026SecureToken')


@api_view(['GET', 'POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def webhook(request):
    if request.method == 'GET':
        mode = request.query_params.get('hub.mode')
        token = request.query_params.get('hub.verify_token')
        challenge = request.query_params.get('hub.challenge')
        if mode == 'subscribe' and token == VERIFY_TOKEN:
            return Response(int(challenge) if (challenge or '').isdigit() else challenge)
        return Response(status=http.HTTP_403_FORBIDDEN)
    # POST: Meta delivery/status callbacks — acknowledge.
    return Response('EVENT_RECEIVED')


class SendManualView(APIView):
    """POST /api/whatsapp/send-manual - refused; there is no WhatsApp sender.

    This used to write a NotificationHistory row with status SENT and
    provider_response 'MOCK: WhatsApp accepted'. Nothing was ever sent. An
    advocate reading that history had no way to know the client was never told,
    which is exactly the question delivery history exists to answer.
    """

    def post(self, request):
        if not getattr(settings, 'WHATSAPP_ENABLED', False):
            return Response(
                {'success': False,
                 'error': 'WhatsApp is not connected. There is no Business API '
                          'account behind this yet, so nothing can be sent. '
                          'Use email instead.'},
                status=http.HTTP_501_NOT_IMPLEMENTED)
        # Reached only once WHATSAPP_ENABLED is turned on, which should not
        # happen before a real Graph API sender exists here.
        return Response(
            {'success': False,
             'error': 'WhatsApp is enabled in settings but no sender is '
                      'implemented. Implement the Graph API call before '
                      'enabling it.'},
            status=http.HTTP_501_NOT_IMPLEMENTED)


class ResendView(APIView):
    """POST /api/whatsapp/resend/{historyId} - re-send a past message.

    Also used to record SENT unconditionally, for any channel. So resending a
    failed EMAIL wrote a success row without touching SMTP - the one action a
    user takes precisely because delivery failed.
    """

    def post(self, request, history_id):
        h = NotificationHistory.objects.filter(
            id=history_id, advocate_id__in=practice_ids(request.user)).first()
        if h is None:
            return Response({'success': False, 'error': 'History item not found'},
                            status=http.HTTP_404_NOT_FOUND)

        if (h.channel or '').upper() != 'EMAIL':
            return Response(
                {'success': False,
                 'error': '{} messages cannot be re-sent: there is no sender '
                          'for that channel.'.format(h.channel or 'These')},
                status=http.HTTP_501_NOT_IMPLEMENTED)

        to = h.recipient_email or h.recipient
        if not to:
            return Response({'success': False, 'error': 'No recipient address on record.'},
                            status=http.HTTP_400_BAD_REQUEST)
        if not getattr(settings, 'EMAIL_CONFIGURED', False):
            return Response(
                {'success': False,
                 'error': 'Email is not configured. Set MAIL_USERNAME and '
                          'MAIL_PASSWORD in the backend .env.'},
                status=http.HTTP_503_SERVICE_UNAVAILABLE)

        now = datetime.datetime.now()
        try:
            send_mail(subject=h.subject or '(no subject)',
                      message=h.body or h.message or '',
                      from_email=getattr(settings, 'DEFAULT_FROM_EMAIL', None),
                      recipient_list=[to], fail_silently=False)
            status_value, error, detail = 'SENT', '', 'resent via smtp to {}'.format(to)
        except Exception as exc:                             # noqa: BLE001
            # Record the failure rather than swallowing it: a resend that did
            # not work must not look like one that did.
            status_value, error = 'FAILED', '{}: {}'.format(type(exc).__name__, exc)
            detail = error

        new = NotificationHistory.objects.create(
            type=h.type, channel='EMAIL', status=status_value, recipient=h.recipient,
            recipient_name=h.recipient_name, recipient_email=h.recipient_email,
            recipient_phone=h.recipient_phone, subject=h.subject, message=h.message,
            body=h.body, event_type='RESEND', triggered_by='MANUAL_RESEND',
            provider_response=detail[:2000], error_message=error[:2000],
            failure_reason=error[:2000],
            status_code=200 if status_value == 'SENT' else 500,
            retry_count=(h.retry_count or 0) + 1,
            sent_at=now, failed_at=None if status_value == 'SENT' else now,
            created_at=now, advocate_id=request.user.id,
            case_id=h.case_id, client_id=h.client_id)

        if status_value == 'SENT':
            return Response({'success': True, 'historyId': new.id})
        return Response({'success': False, 'historyId': new.id, 'error': error},
                        status=http.HTTP_502_BAD_GATEWAY)
