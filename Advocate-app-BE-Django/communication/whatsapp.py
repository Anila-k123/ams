import datetime
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework import status as http

from core.models import NotificationHistory

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
    """POST /api/whatsapp/send-manual — mock WhatsApp send (records history)."""
    def post(self, request):
        d = request.data
        phone = d.get('recipientPhone') or d.get('phone') or d.get('to')
        message = d.get('message') or d.get('body') or ''
        now = datetime.datetime.now()
        h = NotificationHistory.objects.create(
            type=(d.get('type') or 'CUSTOM'), channel='WHATSAPP', status='SENT',
            recipient=phone, recipient_name=d.get('recipientName'), recipient_phone=phone,
            message=message, body=message, event_type='MANUAL',
            triggered_by='MANUAL_SEND', provider_response='MOCK: WhatsApp accepted',
            retry_count=0, sent_at=now, created_at=now,
            advocate_id=request.user.id,
            case_id=d.get('caseId'), client_id=d.get('clientId'))
        return Response({'success': True, 'historyId': h.id,
                         'providerResponse': 'MOCK: WhatsApp accepted (mock provider)'})


class ResendView(APIView):
    """POST /api/whatsapp/resend/{historyId} — mock re-send of a past message."""
    def post(self, request, history_id):
        h = NotificationHistory.objects.filter(id=history_id, advocate_id=request.user.id).first()
        if h is None:
            return Response({'success': False, 'error': 'History item not found'},
                            status=http.HTTP_404_NOT_FOUND)
        now = datetime.datetime.now()
        new = NotificationHistory.objects.create(
            type=h.type, channel=h.channel, status='SENT', recipient=h.recipient,
            recipient_name=h.recipient_name, recipient_email=h.recipient_email,
            recipient_phone=h.recipient_phone, subject=h.subject, message=h.message,
            body=h.body, event_type='RESEND', triggered_by='MANUAL_RESEND',
            provider_response='MOCK: resent', retry_count=(h.retry_count or 0) + 1,
            sent_at=now, created_at=now, advocate_id=request.user.id,
            case_id=h.case_id, client_id=h.client_id)
        return Response({'success': True, 'historyId': new.id})
