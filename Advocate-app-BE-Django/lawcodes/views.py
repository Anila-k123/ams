import re

from django.db.models import Q
from rest_framework.views import APIView
from rest_framework.response import Response

from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .models import LegalCodeMapping

# Frontend act-pair tab -> (old_act, new_act)
PAIRS = {
    'IPC-BNS': ('IPC', 'BNS'),
    'CrPC-BNSS': ('CrPC', 'BNSS'),
    'IEA-BSA': ('IEA', 'BSA'),
}


def _row(m):
    return {
        'id': m.id,
        'oldAct': m.old_act, 'oldSection': m.old_section,
        'newAct': m.new_act, 'newSection': m.new_section,
        'description': m.description,
        'changed': m.changed,
        'repealed': not bool(m.new_section),
    }


def _pair_filter(qs, pair):
    if pair in PAIRS:
        old_act, new_act = PAIRS[pair]
        qs = qs.filter(old_act=old_act, new_act=new_act)
    return qs


class LawCodeSearchView(APIView):
    """GET /api/lawcodes/search?q=&pair=&direction=&limit=
    Search by section number (old or new) or description keyword."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        q = (request.query_params.get('q') or '').strip()
        pair = request.query_params.get('pair') or ''
        direction = request.query_params.get('direction') or 'old-new'
        try:
            limit = min(int(request.query_params.get('limit', 40)), 100)
        except (TypeError, ValueError):
            limit = 40

        qs = _pair_filter(LegalCodeMapping.objects.all(), pair)
        if q:
            qn = re.sub(r'\s+', '', q).lower()
            if direction == 'new-old':
                qs = qs.filter(Q(new_section_norm__startswith=qn) |
                               Q(description__icontains=q))
            else:
                qs = qs.filter(Q(old_section_norm__startswith=qn) |
                               Q(description__icontains=q))
        return Response([_row(m) for m in qs[:limit]])


class LawCodeListView(APIView):
    """GET /api/lawcodes?pair=IPC-BNS&page=&size= — paginated browse of a pair."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        qs = _pair_filter(LegalCodeMapping.objects.all(), request.query_params.get('pair') or '')
        paginator = SpringStylePagination()
        page = paginator.paginate_queryset(qs, request, self)
        return paginator.get_paginated_response([_row(m) for m in page])


class LawCodeConvertView(APIView):
    """GET /api/lawcodes/convert?act=IPC&section=302 — single lookup for the in-summary
    popover. Returns the mapping for an old (or new) act+section."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        act = (request.query_params.get('act') or '').strip()
        section = (request.query_params.get('section') or '').strip()
        if not act or not section:
            return Response({'error': 'act and section are required'}, status=400)
        sn = re.sub(r'\s+', '', section).lower()
        act_u = act.upper()
        # Match on the old side first (the common case), then the new side.
        m = (LegalCodeMapping.objects.filter(old_act__iexact=act, old_section_norm=sn).first()
             or LegalCodeMapping.objects.filter(new_act__iexact=act_u, new_section_norm=sn).first())
        if m is None:
            return Response({'found': False})
        return Response({'found': True, **_row(m)})
