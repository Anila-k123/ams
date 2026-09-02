import re

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import Case
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination

from .models import Act, Section, ActCaseLink
from courtsearch.models import ImportedCaseRecord
from .serializers import (ActListSerializer, ActDetailSerializer, SectionDetailSerializer,
                          _jurisdiction_label)
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
}
ALL_FIELDS = ['title', 'long_title', 'department_name', 'act_number']

# "1979", "1979-1985" or "1979 - 1985". Anything else is not a year query.
_YEAR_RANGE = re.compile(r'^(\d{4})\s*[-–to]+\s*(\d{4})$')
_YEAR = re.compile(r'^\d{4}$')


def _year_filter(qs, keyword):
    """Match act_year as a NUMBER, not as text.

    act_year is an integer column, and the old code ran icontains on it. That
    turned the year chip into a digit-substring search: "201" matched the whole
    of 2010-2019, and "0" matched 454 acts - every year containing a zero. A
    year box should answer "which acts are from this year".

    A range is accepted too, because "everything between 1979 and 1985" is the
    other question people actually ask of a year field.
    """
    m = _YEAR_RANGE.match(keyword)
    if m:
        lo, hi = int(m.group(1)), int(m.group(2))
        if lo > hi:
            lo, hi = hi, lo
        return qs.filter(act_year__gte=lo, act_year__lte=hi)
    if _YEAR.match(keyword):
        return qs.filter(act_year=int(keyword))
    # Not a usable year: return nothing rather than silently falling back to a
    # different search, which would look like the filter had been ignored.
    return qs.none()


def _search(qs, field: str, keyword: str):
    if not keyword:
        return qs
    if field == 'act_year':
        return _year_filter(qs, keyword)
    if field == 'section_title':
        return qs.filter(sections__title__icontains=keyword).distinct()
    if field == 'section_contents':
        return qs.filter(sections__content__icontains=keyword).distinct()
    fields = FIELD_MAP.get(field, ALL_FIELDS)
    q = Q()
    for f in fields:
        q |= Q(**{f + '__icontains': keyword})
    # A four-digit keyword in "All" is almost always a year, and the year lives
    # in its own column rather than in the text fields.
    if field not in FIELD_MAP and _YEAR.match(keyword):
        q |= Q(act_year=int(keyword))
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


def _linked_act_payload(link):
    """One row for the case's "Acts" tab - act display fields come straight
    from the joined Act; ActCaseLink only stores the ids (same reasoning as
    ActCaseLinksView above)."""
    return {
        'id': link.id,
        'actId': link.act_id,
        'actTitle': link.act.title,
        'actNumber': link.act.act_number,
        'actYear': link.act.act_year,
        'jurisdiction': _jurisdiction_label(link.act.source_state_name),
        'linkedAt': link.linked_at,
    }


class CaseActLinksView(APIView):
    """The reverse of ActCaseLinksView: the "Acts" tab on a case. GET the acts
    linked to one of the advocate's own cases; POST to link an act to it. Only
    the advocate's own cases are addressable, matching the act-side scoping."""
    permission_classes = [RequirePermission()]

    def _owned_case(self, request, case_id):
        return Case.objects.filter(id=case_id, advocate_id__in=practice_ids(request.user)).first()

    def get(self, request, case_id):
        if not self._owned_case(request, case_id):
            return Response({'error': 'Case not found.'}, status=status.HTTP_404_NOT_FOUND)
        links = ActCaseLink.objects.filter(case_id=case_id).select_related('act').order_by('-linked_at')
        return Response([_linked_act_payload(link) for link in links])

    def post(self, request, case_id):
        if not self._owned_case(request, case_id):
            return Response({'error': 'Case not found.'}, status=status.HTTP_404_NOT_FOUND)
        act_id = request.data.get('actId')
        if not act_id:
            return Response({'error': 'actId is required.'}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        act = Act.objects.filter(id=act_id).first()
        if not act:
            return Response({'error': 'Act not found.'}, status=status.HTTP_404_NOT_FOUND)
        link, created = ActCaseLink.objects.get_or_create(
            act=act, case_id=case_id, defaults={'advocate_id': request.user.id},
        )
        return Response(
            _linked_act_payload(link),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class CaseActUnlinkView(APIView):
    permission_classes = [RequirePermission()]

    def delete(self, request, case_id, act_id):
        if not Case.objects.filter(id=case_id, advocate_id__in=practice_ids(request.user)).exists():
            return Response({'error': 'Case not found.'}, status=status.HTTP_404_NOT_FOUND)
        ActCaseLink.objects.filter(act_id=act_id, case_id=case_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --- Acts cited by the court (from the imported record) --------------------

# Stopwords + year are dropped so matching ignores word order and connective
# words: "Civil Procedure Code" ↔ "The Code of Civil Procedure, 1908".
_ACT_STOPWORDS = {'the', 'of', 'and', 'for', 'a', 'an', 'to', 'in', 'on'}


def _act_tokens(s):
    """Significant-word set of an act title: lowercased, punctuation-split,
    stopwords and 4-digit years removed. Order-independent by design."""
    words = re.sub(r'[^a-z0-9]+', ' ', (s or '').lower()).split()
    return {
        w for w in words
        if w not in _ACT_STOPWORDS and not re.fullmatch(r'(?:19|20)\d{2}', w)
    }


def _cited_acts_from_raw(raw):
    """The acts a court cited, across record shapes. Only the eCourts shapes
    (raw.cases[].detail.acts) carry a structured acts list; DC uses `section`,
    HC uses `sections`."""
    out = []
    if isinstance(raw, dict) and raw.get('cases') is not None:
        for c in raw.get('cases') or []:
            for a in ((c.get('detail') or {}).get('acts') or []):
                name = (a.get('act') or '').strip()
                section = (a.get('section') or a.get('sections') or '').strip()
                if name:
                    out.append({'name': name, 'section': section})
    return out


class CaseCitedActsView(APIView):
    """GET the acts the court cited on this case's imported record, each matched
    to our Acts library where the title lines up (so the UI can link straight to
    the act). Read-only: it does not create ActCaseLink rows."""
    permission_classes = [RequirePermission()]

    def get(self, request, case_id):
        if not Case.objects.filter(id=case_id, advocate_id__in=practice_ids(request.user)).exists():
            return Response({'error': 'Case not found.'}, status=status.HTTP_404_NOT_FOUND)
        rec = ImportedCaseRecord.objects.filter(case_id=case_id).order_by('-fetched_at').first()
        cited = _cited_acts_from_raw(rec.raw) if rec else []
        if not cited:
            return Response([])
        # Index the library once by token set: exact set match, plus a subset
        # candidate list for the fallback pass.
        exact, indexed = {}, []
        for act in Act.objects.all().only('id', 'title'):
            toks = _act_tokens(act.title)
            if not toks:
                continue
            exact.setdefault(frozenset(toks), act)
            indexed.append((toks, act))

        def _match(name):
            ct = _act_tokens(name)
            if not ct:
                return None
            hit = exact.get(frozenset(ct))
            if hit:
                return hit
            # Fallback: every cited token appears in the act (cited ⊆ act). Needs
            # ≥2 tokens to avoid one common word matching everything; pick the
            # most specific (smallest) matching title.
            if len(ct) < 2:
                return None
            best = None
            for toks, act in indexed:
                if ct <= toks and (best is None or len(toks) < len(best[0])
                                   or (len(toks) == len(best[0]) and act.id < best[1].id)):
                    best = (toks, act)
            return best[1] if best else None

        out, seen = [], set()
        for c in cited:
            key = (c['name'].lower(), c['section'].lower())
            if key in seen:
                continue
            seen.add(key)
            act = _match(c['name'])
            out.append({
                'name': c['name'],
                'section': c['section'],
                'actId': act.id if act else None,
                'actTitle': act.title if act else None,
            })
        return Response(out)
