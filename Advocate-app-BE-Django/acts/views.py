from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response

from core.permissions import RequirePermission
from core.pagination import SpringStylePagination

from .models import Act, Section
from .serializers import ActListSerializer, ActDetailSerializer, SectionDetailSerializer

# Provakil-style field-scoped search chips. "all" searches every act-level
# text field; the two section-scoped modes join through Section and return
# the distinct parent Acts (not the sections themselves - that's what the
# detail page's Sections tab is for).
FIELD_MAP = {
    'short_title': ['title'],
    'long_title': ['long_title'],
    'department': ['department_name'],
    'act_number': ['act_number'],
    'act_year': ['act_year'],
}
ALL_FIELDS = ['title', 'long_title', 'department_name', 'act_number']


def _search(qs, field: str, keyword: str):
    if not keyword:
        return qs
    if field == 'section_title':
        return qs.filter(sections__title__icontains=keyword).distinct()
    if field == 'section_contents':
        return qs.filter(sections__content__icontains=keyword).distinct()
    fields = FIELD_MAP.get(field, ALL_FIELDS)
    q = Q()
    for f in fields:
        q |= Q(**{f + '__icontains': keyword})
    return qs.filter(q)


class ActListView(APIView):
    """GET /api/acts?q=...&field=all|short_title|long_title|department|
    section_title|section_contents|act_number|act_year&jurisdiction=CENTRAL|Tamil%20Nadu
    """
    permission_classes = [RequirePermission()]

    def get(self, request):
        keyword = request.query_params.get('q', '').strip()
        field = request.query_params.get('field', 'all')
        jurisdiction = request.query_params.get('jurisdiction', '').strip()

        qs = Act.objects.all()
        if jurisdiction:
            qs = qs.filter(source_state_name__iexact=jurisdiction)
        qs = _search(qs, field, keyword)
        qs = qs.order_by('title', 'id')

        paginator = SpringStylePagination()
        page = paginator.paginate_queryset(qs, request, self)
        return paginator.get_paginated_response(ActListSerializer(page, many=True).data)


class ActDetailView(APIView):
    """GET /api/acts/<id> - metadata + chapters + a light sections list."""
    permission_classes = [RequirePermission()]

    def get(self, request, pk):
        act = get_object_or_404(Act, pk=pk)
        return Response(ActDetailSerializer(act).data)


class ActSectionDetailView(APIView):
    """GET /api/acts/<id>/sections/<section_id> - one section's full Contents
    + Footnotes, fetched on demand (matches Provakil: the Sections tab only
    lists titles; opening one section is what loads its body text)."""
    permission_classes = [RequirePermission()]

    def get(self, request, pk, section_id):
        section = get_object_or_404(Section, pk=section_id, act_id=pk)
        return Response(SectionDetailSerializer(section).data)
