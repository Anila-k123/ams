import datetime

from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import RequirePermission

from .report import GROUPS, summarize


def _date(value):
    try:
        return datetime.date.fromisoformat(value) if value else None
    except ValueError:
        return None


class UsageSummaryView(APIView):
    """AI token usage and estimated cost (metering/report.py). Super Admin only:
    it spans the whole firm and is the basis for future pricing."""
    permission_classes = [RequirePermission('USER_MANAGE')]

    def get(self, request):
        by = request.query_params.get('by', 'feature')
        if by not in GROUPS:
            by = 'feature'
        return Response(summarize(_date(request.query_params.get('from')),
                                  _date(request.query_params.get('to')), by))
