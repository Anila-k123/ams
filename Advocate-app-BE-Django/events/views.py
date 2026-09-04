import datetime
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import CaseEvent, Case
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import CaseEventSerializer
from core.practice import practice_ids
from notifications import client_events
from workspace.models import HearingDetail


def _upsert_hearing_detail(event_id, advocate_id, d):
    """Create/update the advocate's extra hearing detail from request data.
    Only writes when at least one detail field was provided, so non-hearing
    events (meetings/reminders) never get an empty row."""
    keys = {'purpose': 'purpose', 'court': 'court', 'bench_hall': 'benchHall',
            'judge': 'judge', 'outcome': 'outcome'}
    vals = {col: (d.get(api) or '') for col, api in keys.items()}
    next_date = d.get('nextDate') or None
    if not any(vals.values()) and not next_date:
        # Nothing supplied — on update, clear any prior detail; on create, skip.
        HearingDetail.objects.filter(event_id=event_id).delete()
        return
    HearingDetail.objects.update_or_create(
        event_id=event_id,
        defaults={**vals, 'next_date': next_date, 'advocate_id': advocate_id})


def _base(request):
    return CaseEvent.objects.select_related('case').filter(advocate_id__in=practice_ids(request.user))


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
        case = Case.objects.filter(id=case_id, advocate_id__in=practice_ids(request.user)).first()
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
        _upsert_hearing_detail(event.id, request.user.id, data)
        client_events.hearing_scheduled(request.user, case.client, event, case)
        return Response(CaseEventSerializer(event).data, status=status.HTTP_201_CREATED)


class UpdateEventView(APIView):
    permission_classes = [RequirePermission('EVENT_CREATE')]

    def put(self, request, pk):
        event = CaseEvent.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        d = request.data
        for attr, key in [('title', 'title'), ('event_type', 'eventType'),
                          ('description', 'description'), ('date', 'date')]:
            if key in d:
                setattr(event, attr, d[key])
        if 'time' in d:
            event.time = d.get('time') or None
        event.save()
        _upsert_hearing_detail(event.id, request.user.id, d)
        return Response(CaseEventSerializer(event).data)


class DeleteEventView(APIView):
    permission_classes = [RequirePermission('EVENT_DELETE')]

    def delete(self, request, pk):
        event = CaseEvent.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        HearingDetail.objects.filter(event_id=event.id).delete()
        event.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
