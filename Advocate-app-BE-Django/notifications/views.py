from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status

from core.models import Case, Client, Notification, NotificationHistory


def _serialize(n):
    return {
        'id': n.id,
        'message': n.message,
        'read': n.read_status,
        'timestamp': n.created_at.isoformat() if n.created_at else None,
        'createdAt': n.created_at.isoformat() if n.created_at else None,
    }


@api_view(['GET'])
def unread(request):
    qs = Notification.objects.filter(
        advocate_id=request.user.id, read_status=False).order_by('-created_at')
    return Response([_serialize(n) for n in qs])


@api_view(['GET'])
def all_notifications(request):
    qs = Notification.objects.filter(advocate_id=request.user.id).order_by('-created_at')
    return Response([_serialize(n) for n in qs])


@api_view(['PUT', 'POST'])
def mark_read(request, pk):
    n = Notification.objects.filter(id=pk, advocate_id=request.user.id).first()
    if n is None:
        return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
    n.read_status = True
    n.save(update_fields=['read_status'])
    return Response({'message': 'marked read'})


# ---- Delivery history: the Notifications Center's contract -----------------
# These four endpoints already had callers in the frontend but no
# implementation, so the page showed permanent zeros and an empty table. Field
# names and vocabularies below are dictated by what it already renders:
# channels EMAIL/WHATSAPP/IN_APP, statuses SENT/FAILED/PENDING.

def _history_row(h):
    case_number = None
    if h.case_id:
        c = Case.objects.filter(id=h.case_id).only('case_number').first()
        case_number = c.case_number if c else None
    client_name = h.recipient_name or None
    if not client_name and h.client_id:
        cl = Client.objects.filter(id=h.client_id).only('name').first()
        client_name = cl.name if cl else None
    return {
        'id': h.id,
        'eventType': h.event_type or h.type,
        'channel': h.channel,
        'status': h.status,
        'recipientName': h.recipient_name,
        'recipientEmail': h.recipient_email,
        'recipientPhone': h.recipient_phone,
        'subject': h.subject,
        'body': h.body or h.message,
        'errorMessage': h.error_message or h.failure_reason,
        'caseNumber': case_number,
        'clientName': client_name,
        'sentAt': h.sent_at.isoformat() if h.sent_at else None,
    }


def _history_qs(request):
    return NotificationHistory.objects.filter(
        advocate_id=request.user.id).order_by('-sent_at', '-id')


def _paged(request, qs):
    """Spring-style {content, totalPages, totalElements} - the shape the page
    already destructures."""
    try:
        page = max(int(request.query_params.get('page') or 0), 0)
        size = min(max(int(request.query_params.get('size') or 15), 1), 100)
    except (TypeError, ValueError):
        page, size = 0, 15
    total = qs.count()
    rows = qs[page * size:(page + 1) * size]
    return Response({
        'content': [_history_row(h) for h in rows],
        'totalElements': total,
        'totalPages': (total + size - 1) // size,
        'number': page,
        'size': size,
    })


@api_view(['GET'])
def history(request):
    return _paged(request, _history_qs(request))


@api_view(['GET'])
def history_filter(request):
    qs = _history_qs(request)
    p = request.query_params
    if p.get('channel'):
        qs = qs.filter(channel__iexact=p['channel'])
    if p.get('status'):
        qs = qs.filter(status__iexact=p['status'])
    if p.get('eventType'):
        qs = qs.filter(event_type__iexact=p['eventType'])
    # The page sends full ISO timestamps ("2026-08-01T00:00:00").
    if p.get('from'):
        parsed = parse_datetime(p['from'])
        if parsed:
            qs = qs.filter(sent_at__gte=parsed)
    if p.get('to'):
        parsed = parse_datetime(p['to'])
        if parsed:
            qs = qs.filter(sent_at__lte=parsed)
    return _paged(request, qs)


@api_view(['GET'])
def history_stats(request):
    qs = NotificationHistory.objects.filter(advocate_id=request.user.id)
    midnight = timezone.now().replace(hour=0, minute=0, second=0, microsecond=0)
    today = qs.filter(sent_at__gte=midnight)
    return Response({
        'totalSent': qs.filter(status__iexact='SENT').count(),
        'totalFailed': qs.filter(status__iexact='FAILED').count(),
        'emailsSentToday': today.filter(status__iexact='SENT',
                                        channel__iexact='EMAIL').count(),
        'whatsappSentToday': today.filter(status__iexact='SENT',
                                          channel__iexact='WHATSAPP').count(),
        'failedToday': today.filter(status__iexact='FAILED').count(),
    })


@api_view(['POST'])
def trigger_check(request):
    """Run the due-notification scan now, instead of waiting for the schedule.

    Only ENQUEUES; process_notifications does the sending, so this returns
    immediately rather than holding the request open on SMTP.
    """
    from notifications.events import scan_due_notifications
    queued = scan_due_notifications(request.user.id)
    return Response({
        'message': 'Checked. {} notification(s) queued.'.format(len(queued)),
        'queued': len(queued),
    })
