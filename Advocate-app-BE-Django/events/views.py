import datetime
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import CaseEvent, Case
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import CaseEventSerializer
from core.practice import practice_ids
from notifications import client_events, internal_events
from workspace.models import HearingDetail

# The event kinds the form offers; anything else is rejected so a bad payload
# can't create an unlabelled event.
EVENT_TYPES = {'HEARING', 'MEETING', 'PAYMENT_DUE', 'DOCUMENT'}


def _same_title(a, b):
    return ' '.join(str(a or '').lower().split()) == ' '.join(str(b or '').lower().split())


def _find_duplicate(case, data):
    """An event already on this case that the new one would repeat: same date,
    same type and the same title (case and spacing ignored). When both carry a
    time, the times must match too. Returns the existing event, or None."""
    time = data.get('time') or None
    for ev in CaseEvent.objects.filter(case=case, date=data.get('date'), event_type=data.get('eventType')):
        if not _same_title(ev.title, data.get('title')):
            continue
        if time and ev.time and str(ev.time)[:5] != str(time)[:5]:
            continue
        return ev
    return None


def _validate_event(data):
    """Return an error string for a bad create/update payload, or None."""
    if not (data.get('title') or '').strip():
        return 'Title is required.'
    if not data.get('date'):
        return 'Date is required.'
    et = data.get('eventType')
    if et is not None and et not in EVENT_TYPES:
        return 'Invalid event type.'
    return None


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
        err = _validate_event(data)
        if err:
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)
        case_id = None
        ce = data.get('caseEntity')
        if isinstance(ce, dict):
            case_id = ce.get('id')
        case_id = case_id or data.get('caseId')
        case = Case.objects.filter(id=case_id, advocate_id__in=practice_ids(request.user)).first()
        if case is None:
            return Response({'error': 'Case not found'}, status=status.HTTP_400_BAD_REQUEST)
        # The same event twice would also notify the client and the team twice.
        # A repeat is refused with the existing event (409), unless the user chose
        # "Add anyway" (allowDuplicate). Callers that create events in bulk (a court
        # record import) treat the 409 as "already there" and move on.
        if not data.get('allowDuplicate'):
            existing = _find_duplicate(case, data)
            if existing is not None:
                return Response({'error': 'This event already exists.', 'duplicate': CaseEventSerializer(existing).data},
                                status=status.HTTP_409_CONFLICT)
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
        # Immediate: the client (existing) and now the case's team, so everyone
        # knows a date is set the moment it's added - not only near the date.
        client_events.hearing_scheduled(request.user, case.client, event, case)
        internal_events.hearing_added_team(request.user, event, case)
        return Response(CaseEventSerializer(event).data, status=status.HTTP_201_CREATED)


class UpdateEventView(APIView):
    permission_classes = [RequirePermission('EVENT_CREATE')]

    def put(self, request, pk):
        event = CaseEvent.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        d = request.data
        err = _validate_event(d)
        if err:
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)
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
