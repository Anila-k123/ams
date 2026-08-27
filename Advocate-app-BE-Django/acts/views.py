from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import Case
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination

from .models import Act, Section, ActCaseLink
from .serializers import ActListSerializer, ActDetailSerializer, SectionDetailSerializer
from core.practice import practice_ids

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


class ActCaseLinksView(APIView):
    """GET the "Cases Linked" tab's rows; POST to link one of the advocate's
    own cases to this act (the "Link Cases" button's picker). Case display
    fields come from core.models.Case directly - ActCaseLink only stores the
    id, same reasoning as courtsearch.models.ImportedCaseRecord not taking a
    real FK to it."""
    permission_classes = [RequirePermission()]

    def get(self, request, pk):
        links = ActCaseLink.objects.filter(act_id=pk).order_by('-linked_at')
        cases_by_id = {c.id: c for c in Case.objects.filter(id__in=[l.case_id for l in links])}
        return Response([
            {
                'id': link.id,
                'caseId': link.case_id,
                'caseNumber': cases_by_id[link.case_id].case_number if link.case_id in cases_by_id else None,
                'caseTitle': cases_by_id[link.case_id].case_title if link.case_id in cases_by_id else None,
                'linkedAt': link.linked_at,
            }
            for link in links
        ])

    def post(self, request, pk):
        act = get_object_or_404(Act, pk=pk)
        case_id = request.data.get('caseId')
        if not case_id:
            return Response({'error': 'caseId is required.'}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        # Only the advocate's own cases can be linked - same scoping cases/views.py uses.
        case = Case.objects.filter(id=case_id, advocate_id__in=practice_ids(request.user)).first()
        if not case:
            return Response({'error': 'Case not found.'}, status=status.HTTP_404_NOT_FOUND)
        link, created = ActCaseLink.objects.get_or_create(
            act=act, case_id=case_id, defaults={'advocate_id': request.user.id},
        )
        return Response(
            {'id': link.id, 'caseId': link.case_id, 'caseNumber': case.case_number,
             'caseTitle': case.case_title, 'linkedAt': link.linked_at},
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class ActCaseUnlinkView(APIView):
    permission_classes = [RequirePermission()]

    def delete(self, request, pk, case_id):
        ActCaseLink.objects.filter(act_id=pk, case_id=case_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
