from rest_framework.decorators import api_view
from rest_framework.response import Response
from rest_framework import status
from core.models import Notification


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
