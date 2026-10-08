"""The case file beside a draft (docs/DRAFT_REVIEW.md, "Case file"): the linked case's summary and
its documents, so whoever drafts or reviews can check the draft against the source.

GET draft-sessions/<id>/case-file/

The draft's case is its project's case, else its task's case. Nothing here gives more than the
Cases and Documents pages would: the case must be in the viewer's practice scope, the summary
needs CASE_VIEW and the documents DOCUMENT_VIEW. A draft without a case answers {case: null}.
"""

from datetime import date

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Case, CaseEvent, Document
from core.permissions import RequirePermission
from core.practice import practice_ids
from workspace.models import CaseParty, CaseProfile, CaseTask

from .access import viewable_sessions


def draft_case_id(session):
    if session.project_id and session.project.case_id:
        return session.project.case_id
    if session.ams_task_id:
        return CaseTask.objects.filter(id=session.ams_task_id).values_list('case_id', flat=True).first()
    return None


def _summary(case):
    client = case.client
    profile = CaseProfile.objects.filter(case_id=case.id).first()
    hearing = (CaseEvent.objects.filter(case_id=case.id, date__gte=date.today())
               .order_by('date', 'time').first())
    return {
        'id': case.id, 'caseNumber': case.case_number, 'caseTitle': case.case_title,
        'caseType': case.case_type, 'status': case.status, 'description': case.description,
        'court': (profile.court_name if profile else '') or case.court_level or '',
        'cnr': profile.cnr if profile else '', 'judge': profile.judge if profile else '',
        'ourSide': profile.our_side if profile else '',
        'client': {'id': client.id, 'name': client.name, 'phone': client.phone, 'email': client.email,
                   'address': client.address} if client and not client.deleted else None,
        'parties': [{'name': p.name, 'role': p.role, 'counsel': p.counsel, 'opponent': p.is_opponent}
                    for p in CaseParty.objects.filter(case_id=case.id)],
        'nextHearing': {'date': hearing.date, 'title': hearing.title} if hearing else None,
    }


def _documents(case):
    q = Q(case_id=case.id)
    if case.client_id:
        q |= Q(client_id=case.client_id, case__isnull=True)     # the client's own papers, not on a case
    docs = Document.objects.filter(q).order_by('-upload_date')
    return [{'id': d.id, 'name': d.document_name or d.original_name, 'fileName': d.original_name,
             'fileType': d.file_type, 'category': d.category, 'uploadedAt': d.upload_date,
             'onCase': d.case_id == case.id} for d in docs]


class CaseFileView(APIView):
    permission_classes = [RequirePermission('DRAFT_VIEW')]

    def get(self, request, pk):
        session = get_object_or_404(viewable_sessions(request.user).select_related('project'), pk=pk)
        case_id = draft_case_id(session)
        case = Case.objects.select_related('client').filter(
            id=case_id, advocate_id__in=practice_ids(request.user), deleted=False).first() if case_id else None
        if case is None:
            return Response({'case': None, 'documents': [], 'canSeeCase': False, 'canSeeDocuments': False})
        perms = request.user.permission_codes()
        see_case, see_docs = 'CASE_VIEW' in perms, 'DOCUMENT_VIEW' in perms
        return Response({
            'case': _summary(case) if see_case else {'id': case.id, 'caseNumber': case.case_number},
            'documents': _documents(case) if see_docs else [],
            'canSeeCase': see_case, 'canSeeDocuments': see_docs,
        })
