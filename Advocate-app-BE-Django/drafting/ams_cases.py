"""Link a draft to an AMS case, in-process (merge phase 04).

Replaces InstaDraft's /api/ams/cases/ and /api/ams/link-case/, which reached AMS over
HTTP. The new-draft dialog lists the practice's cases. Picking one gets (or creates)
the drafting Client and Project for that case (Project.case_id, Client.ams_client_id)
and returns fact values the form can prefill.
"""

from django.db import transaction
from django.db.models import Q
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Case
from core.pagination import SpringStylePagination
from core.permissions import RequirePermission
from core.practice import practice_ids
from workspace.models import CaseParty, CaseTask

from .models import Client, Project


def _cases(user):
    return (Case.objects.select_related('client')
            .filter(advocate_id__in=practice_ids(user), deleted=False))


def _case_row(c):
    return {'id': c.id, 'caseNumber': c.case_number, 'caseTitle': c.case_title,
            'caseType': c.case_type, 'status': c.status,
            'clientId': c.client_id, 'clientName': c.client.name if c.client else None}


class AmsCasesView(APIView):
    """GET /api/drafting/ams-cases/?search=&page=  (Spring-style page, 0-based)."""
    permission_classes = [RequirePermission('CASE_VIEW')]

    def get(self, request):
        qs = _cases(request.user)
        search = (request.query_params.get('search') or '').strip()
        if search:
            qs = qs.filter(Q(case_number__icontains=search) | Q(case_title__icontains=search)
                           | Q(client__name__icontains=search))
        paginator = SpringStylePagination()
        page = paginator.paginate_queryset(qs.order_by('-created_at', '-id'), request, view=self)
        return paginator.get_paginated_response([_case_row(c) for c in page])


def link_case(case):
    """The drafting Client + Project for this AMS case (names re-synced each time)."""
    name = ' — '.join(x for x in (case.case_number, case.case_title) if x) or f'Case {case.id}'
    with transaction.atomic(using='drafting'):
        if case.client_id:
            client, _ = Client.objects.update_or_create(
                ams_client_id=case.client_id, defaults={'name': case.client.name or f'Client {case.client_id}'})
        else:
            existing = Project.objects.filter(case_id=case.id).select_related('client').first()
            client = existing.client if existing else Client.objects.create(name=name)
        project, _ = Project.objects.update_or_create(case_id=case.id, defaults={'name': name, 'client': client})
    return client, project


def build_prefill(case, me):
    """Candidate fact values, keyed by slot key; the form keeps only slots the template has."""
    opponent = CaseParty.objects.filter(case_id=case.id, is_opponent=True).order_by('id').first()
    candidates = {
        'party_a_name': case.client.name if case.client_id else None,   # our side
        'party_b_name': opponent.name if opponent else None,            # first opposing party
        'purpose': case.description,
        'governing_state': me.state,                                    # kept only if a listed state
    }
    return {k: v.strip() for k, v in candidates.items() if isinstance(v, str) and v.strip()}


class AmsLinkCaseView(APIView):
    """POST /api/drafting/link-case/ {caseId, taskId?} -> {projectId, clientId, case, prefill, task}."""
    permission_classes = [RequirePermission('DRAFT_CREATE')]

    def post(self, request):
        try:
            case_id = int(request.data.get('caseId'))
            raw_task = request.data.get('taskId')
            task_id = int(raw_task) if raw_task not in (None, '') else None
        except (TypeError, ValueError):
            return Response({'error': 'caseId (and taskId) must be integers.'}, status=400)
        case = _cases(request.user).filter(id=case_id).first()
        if case is None:
            return Response({'error': 'Case not found.'}, status=404)
        task = None
        if task_id is not None:
            task = CaseTask.objects.filter(id=task_id, case_id=case.id,
                                           advocate_id__in=practice_ids(request.user)).first()
            if task is None:
                return Response({'error': 'Task not found on this case.'}, status=404)
        client, project = link_case(case)
        return Response({
            'projectId': project.id,
            'clientId': client.id,
            'case': {'id': case.id, 'caseNumber': case.case_number, 'caseTitle': case.case_title,
                     'caseType': case.case_type, 'status': case.status},
            'prefill': build_prefill(case, request.user),
            'task': ({'id': task.id, 'title': task.title, 'priority': task.priority,
                      'deadline': task.deadline} if task else None),
        })
