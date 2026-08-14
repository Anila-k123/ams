from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.permissions import RequirePermission
from .models import AppealAlert
from .serializers import AppealAlertSerializer


def _base(request):
    return AppealAlert.objects.filter(advocate_id=request.user.id)


class AppealAlertListView(APIView):
    # No permission code required beyond being authenticated.
    permission_classes = [RequirePermission()]

    def get(self, request):
        qs = _base(request).order_by('-created_at', '-id')
        return Response(AppealAlertSerializer(qs, many=True).data)


class CreateAppealAlertView(APIView):
    permission_classes = [RequirePermission()]

    def post(self, request):
        data = request.data
        alert = AppealAlert(advocate_id=request.user.id)
        alert.forum = data.get('forum') or 'Supreme Court'
        alert.court = data.get('court') or None
        alert.state = data.get('state') or None
        alert.case_number = data.get('caseNumber') or None
        alert.case_year = data.get('caseYear') or None
        alert.judgement_date = data.get('dateOfJudgement') or None
        alert.save()
        return Response(AppealAlertSerializer(alert).data, status=status.HTTP_201_CREATED)


class DeleteAppealAlertView(APIView):
    permission_classes = [RequirePermission()]

    def delete(self, request, pk):
        alert = _base(request).filter(id=pk).first()
        if alert is None:
            return Response({'error': 'Appeal alert not found'}, status=status.HTTP_404_NOT_FOUND)
        alert.delete()
        return Response('Appeal alert deleted successfully')
