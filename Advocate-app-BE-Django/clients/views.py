import re

from django.db.models import Q
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import Client
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import ClientSerializer, ClientRequestSerializer
from core.practice import has_firm_wide_scope, practice_ids
from notifications import client_events
from . import handlers, profile
from core.validators import check_payload

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
        qs = Client.objects.filter(advocate_id__in=practice_ids(request.user), deleted=archived)
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
        qs = Client.objects.filter(advocate_id__in=practice_ids(request.user), deleted=False).order_by('name')
        return Response(ClientSerializer(qs, many=True).data)


class ArchivedClientsView(APIView):
    permission_classes = [RequirePermission('CLIENT_VIEW')]

    def get(self, request):
        qs = Client.objects.filter(advocate_id__in=practice_ids(request.user), deleted=True).order_by('name')
        return Response(ClientSerializer(qs, many=True).data)


class SearchClientsView(APIView):
    permission_classes = [RequirePermission('CLIENT_VIEW')]

    def get(self, request):
        keyword = request.query_params.get('keyword', '') or ''
        qs = Client.objects.filter(advocate_id__in=practice_ids(request.user), deleted=False)
        if keyword:
            qs = qs.filter(Q(name__icontains=keyword) | Q(email__icontains=keyword) |
                           Q(phone__icontains=keyword) | Q(address__icontains=keyword))
        return Response(ClientSerializer(qs.order_by('name'), many=True).data)


def _digits(value):
    return re.sub(r'\D', '', value or '')


def _find_practice_duplicate(user, name, email, phone_digits):
    """The existing client in this user's practice that matches on name AND a
    contact point, split into (active, archived).

    Mirrors the case rule: dedup is per PRACTICE, not per advocate, so two
    members of one chambers cannot each add the same client and list it twice in
    every shared view. A different practice adding the same person is untouched
    (their query is scoped to their own advocate ids). Name alone is too weak -
    two different people share a name - so a match also needs a phone or email
    hit; the caller only runs this when at least one contact was given.
    """
    candidates = Client.objects.filter(
        advocate_id__in=practice_ids(user), name__iexact=name)
    active = archived = None
    for c in candidates:
        same_email = bool(email) and (c.email or '').strip().lower() == email
        same_phone = bool(phone_digits) and _digits(c.phone) == phone_digits
        if not (same_email or same_phone):
            continue
        if c.deleted:
            archived = archived or c
        else:
            active = active or c
    return active, archived


# Format-checked before anything is saved (core/validators.py).
CLIENT_FORMATS = {'name': 'name', 'email': 'email', 'phone': 'phone', 'gstin': 'gstin', 'pincode': 'pincode'}


def _save_profile(data, client):
    """Store the form's extra fields and rebuild clients.address from its parts."""
    line = profile.save(client, profile.sent_fields(data))
    if line is not None and line != client.address:
        client.address = line
        client.save(update_fields=['address'])


def _handler_or_error(request, d):
    """(advocate, None) for a valid handlingAdvocateId, (None, None) when none
    was given, or (None, error Response) for someone who can't take a case."""
    aid = d.get('handlingAdvocateId')
    if aid is None:
        return None, None
    advocate = handlers.resolve(request.user, aid)
    if advocate is None:
        return None, Response(
            {'error': 'Choose an advocate from your practice who can take the case.'},
            status=status.HTTP_400_BAD_REQUEST)
    return advocate, None


class ClientHandlersView(APIView):
    """Who can be named as a client's handling advocate (for the client form)."""
    permission_classes = [RequirePermission('CLIENT_CREATE', 'CLIENT_EDIT')]

    def get(self, request):
        return Response([{'id': p.id, 'name': p.full_name or p.email}
                         for p in handlers.candidates(request.user)])


class CreateClientView(APIView):
    permission_classes = [RequirePermission('CLIENT_CREATE')]

    def post(self, request):
        data, bad = check_payload(request.data, CLIENT_FORMATS)
        if bad is not None:
            return bad
        s = ClientRequestSerializer(data=data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        # Checked before anything is saved, so a bad pick doesn't leave a
        # client behind without a handler.
        handler, error = _handler_or_error(request, d)
        if error is not None:
            return error
        name = (d['name'] or '').strip()
        email = (d.get('email') or '').strip().lower()
        phone_digits = _digits(d.get('phone'))

        # Only look for a duplicate when there is a contact point to match on;
        # a bare name is too weak to safely block a genuinely different person.
        if email or phone_digits:
            active, archived = _find_practice_duplicate(
                request.user, name, email, phone_digits)
            if active is not None:
                return Response({
                    'error': 'A client named "{}" with this contact already '
                             'exists in your practice.'.format(active.name),
                    'existingClientId': active.id,
                    'existingClientName': active.name,
                }, status=status.HTTP_409_CONFLICT)
            if archived is not None:
                # Re-adding a client this practice archived: restore the row
                # rather than inserting a second one (mirrors the case path).
                archived.name = d['name']
                archived.email = d.get('email')
                archived.phone = d.get('phone')
                archived.address = d.get('address')
                archived.deleted = False
                archived.save()
                _save_profile(data, archived)
                if handler is not None:
                    handlers.assign(request.user, archived, handler)
                return Response(ClientSerializer(archived).data,
                                status=status.HTTP_200_OK)

        # Firm-wide staff (the Super Admin) register clients for any team: the
        # client then belongs to the handler's team, so that team (and not the
        # other seniors' teams) sees it. Everyone else adds to their own team.
        owner_id = request.user.id
        if handler is not None and has_firm_wide_scope(request.user):
            owner_id = handler.id
        client = Client.objects.create(
            name=d['name'], email=d.get('email'), phone=d.get('phone'),
            address=d.get('address'), deleted=False, advocate_id=owner_id,
        )
        _save_profile(data, client)
        client_events.client_registered(request.user, client)
        if handler is not None:
            handlers.assign(request.user, client, handler)
        return Response(ClientSerializer(client).data, status=status.HTTP_201_CREATED)


def _owned(request, pk):
    return Client.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()


class UpdateClientView(APIView):
    permission_classes = [RequirePermission('CLIENT_EDIT')]

    def put(self, request, pk):
        client = _owned(request, pk)
        if client is None:
            return Response({'error': 'Client not found'}, status=status.HTTP_404_NOT_FOUND)
        data, bad = check_payload(request.data, CLIENT_FORMATS)
        if bad is not None:
            return bad
        s = ClientRequestSerializer(data=data)
        s.is_valid(raise_exception=True)
        d = s.validated_data
        handler, error = _handler_or_error(request, d)
        if error is not None:
            return error
        client.name = d['name']
        client.email = d.get('email')
        client.phone = d.get('phone')
        # The form sends address parts, not `address`; only a caller that
        # sends `address` itself replaces it (it used to be nulled on every edit).
        if 'address' in data:
            client.address = d.get('address')
        client.save()
        _save_profile(data, client)
        # Only touch the handler when the form sent the field: older callers
        # that don't know about it must not wipe an existing assignment.
        if 'handlingAdvocateId' in data:
            if handler is not None:
                handlers.assign(request.user, client, handler)
            else:
                handlers.clear(client)
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
