from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.permissions import RequirePermission
from .models import AppealDetection
from .serializers import AppealDetectionSerializer
from core.practice import practice_ids


# ---- Detected (candidate) appeals, produced by the scan_appeals sweep -------

class AppealDetectionListView(APIView):
    """GET /api/appeal-detections[?status=NEW] — candidate appeals found in a
    higher court against this advocate's decided cases."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        qs = AppealDetection.objects.filter(advocate_id__in=practice_ids(request.user))
        wanted = (request.query_params.get('status') or '').upper()
        if wanted:
            qs = qs.filter(status=wanted)
        return Response(AppealDetectionSerializer(qs, many=True).data)


class AppealDetectionStatusView(APIView):
    """PUT /api/appeal-detections/<pk> — confirm or dismiss a candidate.

    A detection is only ever a candidate: the advocate decides whether the
    higher-court case really is an appeal against theirs. Dismissing keeps the
    row (rather than deleting it) so the nightly sweep cannot resurface the
    same case as new.
    """
    permission_classes = [RequirePermission()]

    ALLOWED = {AppealDetection.STATUS_NEW,
               AppealDetection.STATUS_CONFIRMED,
               AppealDetection.STATUS_DISMISSED}

    def put(self, request, pk):
        det = AppealDetection.objects.filter(
            id=pk, advocate_id__in=practice_ids(request.user)).first()
        if det is None:
            return Response({'error': 'Detection not found'},
                            status=status.HTTP_404_NOT_FOUND)
        new_status = (request.data.get('status') or '').upper()
        if new_status not in self.ALLOWED:
            return Response(
                {'error': 'status must be one of {}'.format(sorted(self.ALLOWED))},
                status=status.HTTP_400_BAD_REQUEST)
        det.status = new_status
        det.save(update_fields=['status'])
        return Response(AppealDetectionSerializer(det).data)


# ---- Decided cases: can we appeal / may the other side (appeals/decisions.py) ----

def _decision_json(d, cases):
    from .decisions import position
    c = cases.get(d.case_id)
    return {
        'id': d.id, 'caseId': d.case_id, 'caseNumber': getattr(c, 'case_number', '') or '',
        'caseTitle': getattr(c, 'case_title', '') or '', 'clientName': getattr(getattr(c, 'client', None), 'name', '') or '',
        'courtId': d.court_id, 'decidedOn': d.decided_on, 'nature': d.nature, 'outcome': d.outcome,
        'ourSide': d.our_side, 'sideSource': d.side_source, 'position': position(d), 'nextForum': d.next_forum,
        'status': d.status, 'watchedAt': d.watched_at, 'createdAt': d.created_at,
    }


class CaseDecisionListView(APIView):
    """GET /api/appeal-decisions — this practice's decided cases with what they mean for an appeal
    (position: lost / won / partly / look / none), for the Appeal Alerts page."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        from core.models import Case
        from .models import CaseDecision
        from cases.closure import stopped_case_ids
        rows = list(CaseDecision.objects.filter(advocate_id__in=practice_ids(request.user)).order_by('-decided_on', '-id'))
        stopped = stopped_case_ids(d.case_id for d in rows)   # closed for us: no longer an appeal question
        rows = [d for d in rows if d.case_id not in stopped]
        cases = {c.id: c for c in Case.objects.select_related('client')
                 .filter(id__in=[d.case_id for d in rows], deleted=False)}
        return Response([_decision_json(d, cases) for d in rows if d.case_id in cases])


class CaseDecisionView(APIView):
    """PATCH /api/appeal-decisions/<pk> {status} — We will appeal (appealing) / No appeal (no_appeal) /
    Stop watching (watch_stopped) / back to open or watching; or {ourSide: petitioner|respondent} when PactPro
    couldn't tell which side our client is on (saved on the case profile too)."""
    permission_classes = [RequirePermission('CASE_EDIT')]

    STATUSES = {'open', 'appealing', 'no_appeal', 'watching', 'watch_stopped'}

    def patch(self, request, pk):
        from core.models import Case
        from .decisions import set_our_side
        from .models import CaseDecision
        d = CaseDecision.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if d is None:
            return Response({'error': 'Not found'}, status=status.HTTP_404_NOT_FOUND)
        side = (request.data.get('ourSide') or '').lower()
        if side:
            if side not in (CaseDecision.PETITIONER, CaseDecision.RESPONDENT):
                return Response({'error': 'ourSide must be petitioner or respondent'}, status=status.HTTP_400_BAD_REQUEST)
            set_our_side(d, side, request.user)
        new_status = (request.data.get('status') or '').lower()
        if new_status:
            if new_status not in self.STATUSES:
                return Response({'error': f'status must be one of {sorted(self.STATUSES)}'},
                                status=status.HTTP_400_BAD_REQUEST)
            d.status, d.decided_by_id = new_status, request.user.id
            d.save(update_fields=['status', 'decided_by_id', 'updated_at'])
        cases = {c.id: c for c in Case.objects.select_related('client').filter(id=d.case_id)}
        return Response(_decision_json(d, cases))
