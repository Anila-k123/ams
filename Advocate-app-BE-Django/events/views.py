import datetime
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import CaseEvent, Case
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import CaseEventSerializer


def _base(request):
    return CaseEvent.objects.select_related('case').filter(advocate_id=request.user.id)


class EventListView(APIView):
    permission_classes = [RequirePermission('EVENT_VIEW')]

    def get(self, request):
        qs = _base(request).order_by('-date', '-id')
        paginator = SpringStylePagination()
        page = paginator.paginate_queryset(qs, request, self)
        return paginator.get_paginated_response(CaseEventSerializer(page, many=True).data)


class MyEventsView(APIView):
    permission_classes = [RequirePermission('EVENT_VIEW')]

    def get(self, request):
        qs = _base(request).order_by('date')
        return Response(CaseEventSerializer(qs, many=True).data)


class TodayEventsView(APIView):
    permission_classes = [RequirePermission('EVENT_VIEW')]

    def get(self, request):
        qs = _base(request).filter(date=datetime.date.today()).order_by('time')
        return Response(CaseEventSerializer(qs, many=True).data)


class UpcomingEventsView(APIView):
    permission_classes = [RequirePermission('EVENT_VIEW')]

    def get(self, request):
        today = datetime.date.today()
        qs = _base(request).filter(date__gte=today).order_by('date')
        return Response(CaseEventSerializer(qs, many=True).data)


class CreateEventView(APIView):
    permission_classes = [RequirePermission('EVENT_CREATE')]

    def post(self, request):
        data = request.data
        case_id = None
        ce = data.get('caseEntity')
        if isinstance(ce, dict):
            case_id = ce.get('id')
        case_id = case_id or data.get('caseId')
        case = Case.objects.filter(id=case_id, advocate_id=request.user.id).first()
        if case is None:
            return Response({'error': 'Case not found'}, status=status.HTTP_400_BAD_REQUEST)
        event = CaseEvent.objects.create(
            title=data.get('title'),
            event_type=data.get('eventType'),
            description=data.get('description'),
            date=data.get('date'),
            time=data.get('time') or None,
            notified=False,
            case=case,
            advocate_id=request.user.id,
        )
        return Response(CaseEventSerializer(event).data, status=status.HTTP_201_CREATED)


class DeleteEventView(APIView):
    permission_classes = [RequirePermission('EVENT_DELETE')]

    def delete(self, request, pk):
        event = CaseEvent.objects.filter(id=pk, advocate_id=request.user.id).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        event.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
