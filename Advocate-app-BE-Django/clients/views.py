from django.db.models import Q
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import Client
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import ClientSerializer, ClientRequestSerializer

SORT_MAP = {'createdAt': 'created_at', 'name': 'name', 'email': 'email', 'id': 'id'}


def _order(qs, sort_by, sort_dir):
    field = SORT_MAP.get(sort_by, 'created_at')
    if sort_dir == 'asc':
        return qs.order_by(field, 'id')
    return qs.order_by('-' + field, '-id')


class ClientListView(APIView):
    permission_classes = [RequirePermission('CLIENT_VIEW')]

    def get(self, request):
        archived = request.query_params.get('archived', 'false').lower() == 'true'
        keyword = request.query_params.get('keyword')
        sort_by = request.query_params.get('sortBy', 'createdAt')
        sort_dir = request.query_params.get('sortDir', 'desc')
        qs = Client.objects.filter(advocate_id=request.user.id, deleted=archived)
        if keyword:
            qs = qs.filter(Q(name__icontains=keyword) | Q(email__icontains=keyword) |
                           Q(phone__icontains=keyword) | Q(address__icontains=keyword))
        qs = _order(qs, sort_by, sort_dir)
        paginator = SpringStylePagination()
        page = paginator.paginate_queryset(qs, request, self)
        return paginator.get_paginated_response(ClientSerializer(page, many=True).data)


class MyClientsView(APIView):
    permission_classes = [RequirePermission('CLIENT_VIEW')]

    def get(self, request):
        qs = Client.objects.filter(advocate_id=request.user.id, deleted=False).order_by('name')
        return Response(ClientSerializer(qs, many=True).data)


class ArchivedClientsView(APIView):
    permission_classes = [RequirePermission('CLIENT_VIEW')]

    def get(self, request):
        qs = Client.objects.filter(advocate_id=request.user.id, deleted=True).order_by('name')
        return Response(ClientSerializer(qs, many=True).data)


class SearchClientsView(APIView):
    permission_classes = [RequirePermission('CLIENT_VIEW')]

    def get(self, request):
        keyword = request.query_params.get('keyword', '') or ''
        qs = Client.objects.filter(advocate_id=request.user.id, deleted=False)
        if keyword:
            qs = qs.filter(Q(name__icontains=keyword) | Q(email__icontains=keyword) |
                           Q(phone__icontains=keyword) | Q(address__icontains=keyword))
        return Response(ClientSerializer(qs.order_by('name'), many=True).data)


class CreateClientView(APIView):
    permission_classes = [RequirePermission('CLIENT_CREATE')]

    def post(self, request):
        s = ClientRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        client = Client.objects.create(
            name=d['name'], email=d.get('email'), phone=d.get('phone'),
            address=d.get('address'), deleted=False, advocate_id=request.user.id,
        )
        return Response(ClientSerializer(client).data, status=status.HTTP_201_CREATED)


def _owned(request, pk):
    return Client.objects.filter(id=pk, advocate_id=request.user.id).first()


class UpdateClientView(APIView):
    permission_classes = [RequirePermission('CLIENT_EDIT')]

    def put(self, request, pk):
        client = _owned(request, pk)
        if client is None:
            return Response({'error': 'Client not found'}, status=status.HTTP_404_NOT_FOUND)
        s = ClientRequestSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        client.name = d['name']
        client.email = d.get('email')
        client.phone = d.get('phone')
        client.address = d.get('address')
        client.save()
        return Response(ClientSerializer(client).data)


class DeleteClientView(APIView):
    permission_classes = [RequirePermission('CLIENT_DELETE')]

    def delete(self, request, pk):
        client = _owned(request, pk)
        if client is None:
            return Response({'error': 'Client not found'}, status=status.HTTP_404_NOT_FOUND)
        client.deleted = True
        client.save(update_fields=['deleted'])
        return Response('Client archived successfully (soft deleted).')


class RestoreClientView(APIView):
    permission_classes = [RequirePermission('CLIENT_EDIT')]

    def put(self, request, pk):
        client = _owned(request, pk)
        if client is None:
            return Response({'error': 'Client not found'}, status=status.HTTP_404_NOT_FOUND)
        client.deleted = False
        client.save(update_fields=['deleted'])
        return Response('Client restored successfully.')


class ClientDetailView(APIView):
    permission_classes = [RequirePermission('CLIENT_VIEW')]

    def get(self, request, pk):
        client = _owned(request, pk)
        if client is None:
            return Response({'error': 'Client not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response(ClientSerializer(client).data)
