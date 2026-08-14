import datetime
from django.db.models import Q
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import Case, Client
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import CaseSerializer

SORT_MAP = {'createdAt': 'created_at', 'caseNumber': 'case_number',
            'caseTitle': 'case_title', 'status': 'status', 'id': 'id'}
SEARCH_FIELDS = ['case_number', 'case_title', 'case_type', 'court_level', 'status', 'description']


def _base_qs(request):
    return Case.objects.select_related('client').filter(advocate_id=request.user.id)


def _search(qs, keyword):
    if not keyword:
        return qs
    q = Q()
    for f in SEARCH_FIELDS:
        q |= Q(**{f + '__icontains': keyword})
    q |= Q(client__name__icontains=keyword)
    return qs.filter(q)


def _extract_client_id(data):
    if data.get('clientId') is not None:
        return data.get('clientId')
    client = data.get('client')
    if isinstance(client, dict):
        return client.get('id')
    return None


class CaseListView(APIView):
    permission_classes = [RequirePermission('CASE_VIEW')]

    def get(self, request):
        archived = request.query_params.get('archived', 'false').lower() == 'true'
        keyword = request.query_params.get('keyword')
        sort_by = SORT_MAP.get(request.query_params.get('sortBy', 'createdAt'), 'created_at')
        sort_dir = request.query_params.get('sortDir', 'desc')
        qs = _search(_base_qs(request).filter(deleted=archived), keyword)
        # Optional exact-ish filters (used by the Workspace list filter bar).
        for param, field in [('status', 'status'), ('caseType', 'case_type'),
                             ('courtLevel', 'court_level')]:
            val = request.query_params.get(param)
            if val:
                qs = qs.filter(**{field + '__iexact': val})
        qs = qs.order_by(sort_by if sort_dir == 'asc' else '-' + sort_by, 'id')
        paginator = SpringStylePagination()
        page = paginator.paginate_queryset(qs, request, self)
        return paginator.get_paginated_response(CaseSerializer(page, many=True).data)


class MyCasesView(APIView):
    permission_classes = [RequirePermission('CASE_VIEW')]

    def get(self, request):
        qs = _base_qs(request).filter(deleted=False).order_by('-created_at', '-id')
        return Response(CaseSerializer(qs, many=True).data)


class SearchCasesView(APIView):
    permission_classes = [RequirePermission('CASE_VIEW')]

    def get(self, request):
        keyword = request.query_params.get('keyword', '')
        qs = _search(_base_qs(request).filter(deleted=False), keyword).order_by('-created_at', '-id')
        return Response(CaseSerializer(qs, many=True).data)


class CreateCaseView(APIView):
    permission_classes = [RequirePermission('CASE_CREATE')]

    def post(self, request):
        data = request.data
        case_number = data.get('caseNumber')
        if not case_number:
            return Response({'error': 'caseNumber is required'}, status=status.HTTP_400_BAD_REQUEST)
        if Case.objects.filter(case_number=case_number).exists():
            return Response({'error': 'Case number already exists'}, status=status.HTTP_409_CONFLICT)
        client_id = _extract_client_id(data)
        client = None
        if client_id is not None:
            client = Client.objects.filter(id=client_id, advocate_id=request.user.id).first()
        case = Case.objects.create(
            case_number=case_number,
            case_title=data.get('caseTitle'),
            case_type=data.get('caseType'),
            court_level=data.get('courtLevel'),
            status=data.get('status'),
            amount=data.get('amount'),
            description=data.get('description'),
            deleted=False,
            created_at=datetime.date.today(),
            advocate_id=request.user.id,
            client=client,
        )
        return Response(CaseSerializer(case).data, status=status.HTTP_201_CREATED)


def _owned(request, pk):
    return Case.objects.select_related('client').filter(id=pk, advocate_id=request.user.id).first()


class UpdateCaseView(APIView):
    permission_classes = [RequirePermission('CASE_EDIT')]

    def put(self, request, pk):
        case = _owned(request, pk)
        if case is None:
            return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)
        data = request.data
        for attr, key in [('case_title', 'caseTitle'), ('case_type', 'caseType'),
                          ('court_level', 'courtLevel'), ('status', 'status'),
                          ('amount', 'amount'), ('description', 'description')]:
            if key in data:
                setattr(case, attr, data[key])
        if 'caseNumber' in data and data['caseNumber']:
            case.case_number = data['caseNumber']
        client_id = _extract_client_id(data)
        if client_id is not None:
            case.client = Client.objects.filter(id=client_id, advocate_id=request.user.id).first()
        case.save()
        return Response(CaseSerializer(case).data)


class DeleteCaseView(APIView):
    permission_classes = [RequirePermission('CASE_DELETE')]

    def delete(self, request, pk):
        case = _owned(request, pk)
        if case is None:
            return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)
        case.deleted = True
        case.save(update_fields=['deleted'])
        return Response('Case archived successfully')


class RestoreCaseView(APIView):
    permission_classes = [RequirePermission('CASE_EDIT')]

    def put(self, request, pk):
        case = _owned(request, pk)
        if case is None:
            return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)
        case.deleted = False
        case.save(update_fields=['deleted'])
        return Response('Case restored successfully')
