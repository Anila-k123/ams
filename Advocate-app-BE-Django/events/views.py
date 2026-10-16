import datetime
from django.db import transaction
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import CaseEvent, Case
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import CaseEventSerializer
from core.practice import practice_ids
from core.tenant import owned
from notifications import client_events, internal_events
from workspace.models import HearingDetail
from . import scheduling

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


def _saved(event, request, created_status=status.HTTP_200_OK, next_event=None, scheduled=False):
    """The event, plus the next hearing its next date scheduled (or moved)."""
    body = CaseEventSerializer(event).data
    if next_event is not None:
        body['nextHearing'] = {**CaseEventSerializer(next_event).data, 'created': scheduled}
    return Response(body, status=created_status)


def _refused(exc):
    return Response({'error': str(exc), 'code': exc.code}, status=exc.status)


def _base(request):
    return owned(CaseEvent.objects.select_related('case').filter(advocate_id__in=practice_ids(request.user)), request.user)


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
        case = owned(Case.objects.filter(id=case_id, advocate_id__in=practice_ids(request.user)), request.user).first()
        if case is None:
            return Response({'error': 'Case not found'}, status=status.HTTP_400_BAD_REQUEST)
        try:   # next date / result checked before anything is saved
            scheduling.check(data.get('eventType'), data.get('date'), case, data)
        except scheduling.SchedulingError as exc:
            return _refused(exc)
        # The same event twice would also notify the client and the team twice.
        # A repeat is refused with the existing event (409), unless the user chose
        # "Add anyway" (allowDuplicate). Callers that create events in bulk (a court
        # record import) treat the 409 as "already there" and move on.
        if not data.get('allowDuplicate'):
            existing = _find_duplicate(case, data)
            if existing is not None:
                return Response({'error': 'This event already exists.', 'duplicate': CaseEventSerializer(existing).data},
                                status=status.HTTP_409_CONFLICT)
        with transaction.atomic():
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
            event.refresh_from_db()          # date as a date, for the next-date rules
            nxt, scheduled = scheduling.save_detail(event, request.user, data)
        # Immediate: the client (existing) and now the case's team, so everyone
        # knows a date is set the moment it's added - not only near the date.
        client_events.hearing_scheduled(request.user, case.client, event, case)
        internal_events.hearing_added_team(request.user, event, case)
        return _saved(event, request, status.HTTP_201_CREATED, nxt, scheduled)


class UpdateEventView(APIView):
    permission_classes = [RequirePermission('EVENT_CREATE')]

    def put(self, request, pk):
        event = owned(CaseEvent.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)), request.user).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        d = request.data
        err = _validate_event(d)
        if err:
            return Response({'error': err}, status=status.HTTP_400_BAD_REQUEST)
        try:   # with the event's new type and date, before anything is saved
            scheduling.check(d.get('eventType', event.event_type), d.get('date', event.date), event.case, d)
        except scheduling.SchedulingError as exc:
            return _refused(exc)
        with transaction.atomic():
            # Locked, so the date compared below is the one this save replaces:
            # a retried or parallel save of the same date is no change.
            event = CaseEvent.objects.select_for_update().get(id=event.id)
            was_hearing, old_date = event.event_type == 'HEARING', event.date
            for attr, key in [('title', 'title'), ('event_type', 'eventType'),
                              ('description', 'description'), ('date', 'date')]:
                if key in d:
                    setattr(event, attr, d[key])
            if 'time' in d:
                event.time = d.get('time') or None
            event.save()
            event.refresh_from_db()
            if was_hearing and event.date != old_date:
                scheduling.announce_moved(request.user, event, old_date)
            nxt, scheduled = scheduling.save_detail(event, request.user, d)
        return _saved(event, request, next_event=nxt, scheduled=scheduled)


class DeleteEventView(APIView):
    permission_classes = [RequirePermission('EVENT_DELETE')]

    def delete(self, request, pk):
        event = owned(CaseEvent.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)), request.user).first()
        if event is None:
            return Response({'error': 'Event not found'}, status=status.HTTP_404_NOT_FOUND)
        HearingDetail.objects.filter(event_id=event.id).delete()
        # The hearing before it no longer leads anywhere (it keeps its next date
        # text); a later save of that hearing can schedule again.
        HearingDetail.objects.filter(next_event_id=event.id).update(next_event_id=None)
        event.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
