import datetime
from django.db.models import Q
from rest_framework.views import APIView
from rest_framework.response import Response

from core.models import AuditLog, Activity
from core.pagination import SpringStylePagination
from core.permissions import RequirePermission


def _parse_dt(v):
    if not v:
        return None
    try:
        return datetime.datetime.fromisoformat(v.replace('Z', '+00:00'))
    except ValueError:
        try:
            return datetime.datetime.strptime(v[:10], '%Y-%m-%d')
        except ValueError:
            return None


def _audit_map(a):
    return {
        'id': a.id, 'advocateId': a.advocate_id, 'userName': a.user_name,
        'actionType': a.action_type, 'module': a.module, 'title': a.title,
        'description': a.description, 'entityType': a.entity_type, 'entityId': a.entity_id,
        'ipAddress': a.ip_address, 'device': a.device, 'browser': a.browser,
        'operatingSystem': a.operating_system, 'requestMethod': a.request_method,
        'requestUri': a.request_uri, 'status': a.status, 'metadata': a.metadata,
        'createdAt': a.created_at.isoformat() if a.created_at else None,
    }


class AuditView(APIView):
    permission_classes = [RequirePermission('AUDIT_VIEW')]

    def get(self, request):
        p = request.query_params
        qs = AuditLog.objects.filter(advocate_id=request.user.id)
        if p.get('actionType'):
            qs = qs.filter(action_type=p['actionType'])
        if p.get('module'):
            qs = qs.filter(module=p['module'])
        if p.get('status'):
            qs = qs.filter(status=p['status'])
        if p.get('search'):
            qs = qs.filter(Q(title__icontains=p['search']) | Q(description__icontains=p['search']))
        df = _parse_dt(p.get('dateFrom'))
        dt = _parse_dt(p.get('dateTo'))
        if df:
            qs = qs.filter(created_at__gte=df)
        if dt:
            qs = qs.filter(created_at__lte=dt)
        qs = qs.order_by('-created_at', '-id')
        paginator = SpringStylePagination()
        page = paginator.paginate_queryset(qs, request, self)
        return paginator.get_paginated_response([_audit_map(a) for a in page])


def _activity_map(a):
    return {
        'id': a.id, 'description': a.description, 'actionType': a.action_type,
        'timestamp': a.timestamp.isoformat() if a.timestamp else None,
    }


class ActivityListView(APIView):
    permission_classes = [RequirePermission('AUDIT_VIEW')]

    def get(self, request):
        qs = Activity.objects.filter(advocate_id=request.user.id).order_by('-timestamp', '-id')
        paginator = SpringStylePagination()
        page = paginator.paginate_queryset(qs, request, self)
        return paginator.get_paginated_response([_activity_map(a) for a in page])


class MyActivitiesView(APIView):
    def get(self, request):
        qs = Activity.objects.filter(advocate_id=request.user.id).order_by('-timestamp', '-id')[:20]
        return Response([_activity_map(a) for a in qs])
