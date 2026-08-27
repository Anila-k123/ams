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
