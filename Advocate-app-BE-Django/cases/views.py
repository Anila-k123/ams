import datetime
from django.db.models import Q
from django.db import transaction
from django.conf import settings
from django.core.mail import send_mail
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import (Case, Client, Advocate, NotificationHistory,
                         CaseEvent, Invoice, Expense, ClientPayment, Document)
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import CaseSerializer
from core.practice import practice_ids, is_owner, practice_root
from notifications import client_events

SORT_MAP = {'createdAt': 'created_at', 'caseNumber': 'case_number',
            'caseTitle': 'case_title', 'status': 'status', 'id': 'id'}
SEARCH_FIELDS = ['case_number', 'case_title', 'case_type', 'court_level', 'status', 'description']


def _base_qs(request):
    return Case.objects.select_related('client').filter(advocate_id__in=practice_ids(request.user))


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


def _clear_import_children(case_id):
    """Remove the auto-generated (import) children of a case so a re-import starts
    clean: the stored court record, and the parties/hearings we derive from it.
    User-authored content (notes, tags, tasks) is left untouched."""
    from workspace.models import CaseParty
    from core.models import CaseEvent
    from courtsearch.models import ImportedCaseRecord
    CaseParty.objects.filter(case_id=case_id).delete()
    CaseEvent.objects.filter(case_id=case_id).delete()
    ImportedCaseRecord.objects.filter(case_id=case_id).delete()


class CreateCaseView(APIView):
    permission_classes = [RequirePermission('CASE_CREATE')]

    def post(self, request):
        data = request.data
        case_number = data.get('caseNumber')
        if not case_number:
            return Response({'error': 'caseNumber is required'}, status=status.HTTP_400_BAD_REQUEST)
        # Scoped to the practice, not global. cases.case_number used to carry a
        # global UNIQUE, so this lookup could not be scoped and an advocate was
        # refused a case number another practice happened to hold - for a case
        # they could not see. The constraint is now UNIQUE (advocate_id,
        # case_number) (see `manage.py scope_case_numbers`), so two chambers can
        # track the same court case, which is what actually happens when they
        # are on opposite sides of it.
        #
        # The DB constraint is per advocate; this check is per practice, which
        # is stricter on purpose: two members of one chambers both adding the
        # same number would list the case twice in every shared view.
        existing = Case.objects.filter(
            case_number=case_number,
            advocate_id__in=practice_ids(request.user)).first()
        if existing is not None and not existing.deleted:
            return Response({'error': 'Case number already exists'}, status=status.HTTP_409_CONFLICT)
        client_id = _extract_client_id(data)
        client = None
        if client_id is not None:
            client = Client.objects.filter(id=client_id, advocate_id__in=practice_ids(request.user)).first()
        if existing is not None and existing.deleted:
            # Re-adding a case this practice archived: reuse the row rather
            # than inserting a second one, reset it to a fresh active case, and
            # clear the import-generated children so a re-import repopulates
            # cleanly. The lookup above guarantees the row is ours.
            existing.case_title = data.get('caseTitle')
            existing.case_type = data.get('caseType')
            existing.court_level = data.get('courtLevel')
            existing.status = data.get('status')
            existing.amount = data.get('amount')
            existing.description = data.get('description')
            existing.deleted = False
            existing.created_at = datetime.date.today()
            # advocate_id is left as it was: within a practice the row is
            # already reachable, and overwriting it would rewrite who created
            # the case every time it was re-added.
            existing.client = client
            existing.save()
            _clear_import_children(existing.id)
            return Response(CaseSerializer(existing).data, status=status.HTTP_200_OK)
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
        client_events.case_created(request.user, client, case)
        return Response(CaseSerializer(case).data, status=status.HTTP_201_CREATED)


def _owned(request, pk):
    return Case.objects.select_related('client').filter(id=pk, advocate_id__in=practice_ids(request.user)).first()


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
            case.client = Client.objects.filter(id=client_id, advocate_id__in=practice_ids(request.user)).first()
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


class HearingAlertView(APIView):
    """POST /api/cases/<pk>/hearing-alert — email the case's client about a
    hearing. Body: { date, purpose, bench, note? }. Sends inline (immediate
    feedback) and records a NotificationHistory row. Email only for now."""
    permission_classes = [RequirePermission()]

    def post(self, request, pk):
        case = _owned(request, pk)
        if case is None:
            return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)
        client = case.client
        if client is None or not (client.email or '').strip():
            return Response({'error': 'No client email on file for this case.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        if not getattr(settings, 'EMAIL_CONFIGURED', False):
            return Response({'error': 'Email is not configured on the server.'},
                            status=status.HTTP_503_SERVICE_UNAVAILABLE)

        d = request.data
        date = (d.get('date') or '').strip()
        purpose = (d.get('purpose') or '').strip()
        bench = (d.get('bench') or '').strip()
        note = (d.get('note') or '').strip()
        case_label = case.case_number or case.case_title or f'Case #{case.id}'
        subject = f'Hearing update — {case_label}'
        lines = [f'Dear {client.name or "Client"},', '',
                 f'This is an update regarding your case {case_label}'
                 + (f' ({case.case_title})' if case.case_title and case.case_title != case_label else '') + '.', '']
        if date:
            lines.append(f'Hearing date : {date}')
        if purpose:
            lines.append(f'Purpose      : {purpose}')
        if bench:
            lines.append(f'Before       : {bench}')
        if note:
            lines += ['', note]
        lines += ['', 'Regards,', request.user.full_name or 'Your Advocate']
        body = '\n'.join(lines)

        ok, err, provider = True, None, None
        try:
            send_mail(subject=subject, message=body,
                      from_email=settings.DEFAULT_FROM_EMAIL,
                      recipient_list=[client.email.strip()], fail_silently=False)
            provider = 'Email sent'
        except Exception as e:  # noqa: BLE001
            ok, err = False, str(e)

        now = datetime.datetime.now()
        NotificationHistory.objects.create(
            type='HEARING_REMINDER', channel='EMAIL',
            status='SENT' if ok else 'FAILED',
            recipient=client.email.strip(), recipient_name=client.name,
            recipient_email=client.email.strip(), subject=subject,
            message=body, body=body, event_type='HEARING_ALERT',
            triggered_by='MANUAL', provider_response=provider,
            error_message=err, failure_reason=err, retry_count=0,
            sent_at=now, failed_at=None if ok else now, created_at=now,
            advocate_id=request.user.id, case_id=case.id, client_id=client.id)
        return Response({'success': ok, 'errorMessage': err,
                         'recipient': client.email.strip()},
                        status=status.HTTP_200_OK if ok else status.HTTP_502_BAD_GATEWAY)


# Child records that make up a "matter": each carries its own advocate_id
# (creator) and is listed by it, so a cross-team move must re-own all of them,
# or the receiving team sees the case shell with none of its hearings, money or
# documents. (advocate_field, has_client) per model, keyed on case_id.
_MATTER_CHILDREN = [
    (CaseEvent, False), (Invoice, True), (Expense, True),
    (ClientPayment, True), (Document, True),
]


def _resolve_target_client(target, src_client):
    """A client in the target senior's practice equivalent to src_client.

    Reuses an existing active match (same dedup rule as client creation) so a
    repeat transfer does not pile up copies; otherwise copies the client into
    the target's practice. Returns the client id, or None when the case had no
    client.
    """
    if src_client is None:
        return None
    # Local import avoids a module-load cycle (clients.views imports core only).
    from clients.views import _find_practice_duplicate, _digits
    name = (src_client.name or '').strip()
    email = (src_client.email or '').strip().lower()
    phone_digits = _digits(src_client.phone)
    if name and (email or phone_digits):
        active, _archived = _find_practice_duplicate(target, name, email, phone_digits)
        if active is not None:
            return active.id
    copy = Client.objects.create(
        name=src_client.name, email=src_client.email, phone=src_client.phone,
        address=src_client.address, deleted=False, advocate_id=target.id)
    return copy.id


def _move_matter(case, target):
    """Move a whole matter to another practice's senior, atomically: the client
    (copied/reused in the target practice) and every child record are re-owned by
    `target`, then the case itself. The sending team no longer reaches it."""
    from workspace.models import (CaseNote, CaseTask, CaseTag, CaseParty,
                                   RelatedCase, CaseTaskDocument)
    from appeals.models import AppealDetection
    from courtsearch.models import ImportedCaseRecord

    with transaction.atomic():
        new_client_id = _resolve_target_client(target, case.client)

        for model, has_client in _MATTER_CHILDREN:
            fields = {'advocate_id': target.id}
            if has_client:
                fields['client_id'] = new_client_id
            model.objects.filter(case_id=case.id).update(**fields)

        task_ids = list(CaseTask.objects.filter(case_id=case.id)
                        .values_list('id', flat=True))
        CaseTaskDocument.objects.filter(task_id__in=task_ids).update(advocate_id=target.id)
        for model in (CaseNote, CaseTask, CaseTag, CaseParty, RelatedCase):
            model.objects.filter(case_id=case.id).update(advocate_id=target.id)
        AppealDetection.objects.filter(source_case_id=case.id).update(advocate_id=target.id)
        ImportedCaseRecord.objects.filter(case_id=case.id).update(advocate_id=target.id)

        case.advocate_id = target.id
        case.client_id = new_client_id
        case.save(update_fields=['advocate_id', 'client_id'])


class TransferCaseView(APIView):
    """Reassign a case to another advocate.

    Within the requester's own practice this is a simple owner change (the whole
    team keeps seeing it). Across teams - a senior handing a matter to ANOTHER
    senior - it is a full move: the case, its children and a copy of the client
    are re-owned by the target, and only a practice owner may do it.
    """
    permission_classes = [RequirePermission('CASE_EDIT')]

    def put(self, request, pk):
        case = _owned(request, pk)
        if case is None:
            return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)
        advocate_id = request.data.get('advocateId') or request.data.get('advocate_id')
        if not advocate_id:
            return Response({'error': 'advocateId is required'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        target = Advocate.objects.filter(id=advocate_id).first()
        if not target:
            return Response({'error': 'Target advocate not found'},
                            status=status.HTTP_404_NOT_FOUND)
        # The target must actually be able to work the case; finance-only staff
        # (accountant/receptionist) have no CASE_VIEW and should not own cases.
        if 'CASE_VIEW' not in target.permission_codes():
            return Response({'error': 'That user cannot hold cases (no case access).'},
                            status=status.HTTP_400_BAD_REQUEST)

        # "Cross-team" is decided by where the CASE lives vs where the target
        # lives - NOT by the requester's scope. A firm-wide Super Admin reaches
        # everyone, but moving a case from one practice to another still has to
        # carry the whole matter, or the receiving team sees an empty shell.
        owner = Advocate.objects.filter(id=case.advocate_id).first()
        case_root = practice_root(owner) if owner else case.advocate_id
        cross_team = practice_root(target) != case_root

        if cross_team:
            # Handing a matter out of the team: only a senior (practice owner)
            # may, and only to another senior, so a junior cannot fling cases
            # across the firm and a case never lands with a team member instead
            # of that team's owner.
            if not is_owner(request.user):
                return Response({'error': 'Only a practice owner can transfer a case to another team.'},
                                status=status.HTTP_403_FORBIDDEN)
            if target.parent_advocate_id is not None:
                return Response({'error': 'A case can only be transferred to another senior (practice owner).'},
                                status=status.HTTP_403_FORBIDDEN)
            # The receiving practice must not already hold this case number
            # (cases are UNIQUE per advocate); refuse rather than crash on save.
            if Case.objects.filter(advocate_id=target.id,
                                   case_number=case.case_number).exists():
                return Response({'error': 'The receiving advocate already has a case with this number.'},
                                status=status.HTTP_409_CONFLICT)
            _move_matter(case, target)
            return Response({'message': 'Case transferred successfully',
                             'advocateId': target.id, 'advocateName': target.full_name,
                             'crossTeam': True})

        # Same practice: everyone shares scope, so a plain owner change is enough.
        case.advocate_id = target.id
        case.save(update_fields=['advocate_id'])
        return Response({'message': 'Case transferred successfully',
                         'advocateId': target.id, 'advocateName': target.full_name,
                         'crossTeam': False})


class TransferTargetsView(APIView):
    """Advocates the requester may transfer a case to.

    Always their own team's case-holders (and, for a firm-wide Super Admin, the
    whole firm - practice_ids() returns everyone for them). In addition, a
    practice OWNER is offered the firm's other seniors, so a senior can hand a
    matter to another team. "Case-holder" means the advocate has CASE_VIEW, so
    finance staff aren't offered. Each target is tagged crossTeam so the UI can
    group them and warn before moving a matter out of the team.
    """
    permission_classes = [RequirePermission('CASE_EDIT')]

    def get(self, request):
        my_root = practice_root(request.user)
        seen = {request.user.id}
        out = []

        def add(a):
            if a.id in seen or 'CASE_VIEW' not in a.permission_codes():
                return
            seen.add(a.id)
            out.append({'id': a.id, 'fullName': a.full_name, 'email': a.email,
                        'roles': a.role_names(),
                        'crossTeam': practice_root(a) != my_root})

        for a in (Advocate.objects
                  .filter(id__in=practice_ids(request.user), left_on__isnull=True)
                  .exclude(id=request.user.id).order_by('full_name')):
            add(a)

        # A senior may also transfer to another team's senior.
        if is_owner(request.user):
            for a in (Advocate.objects
                      .filter(parent_advocate_id__isnull=True, left_on__isnull=True)
                      .exclude(id=request.user.id).order_by('full_name')):
                add(a)

        out.sort(key=lambda t: (t['crossTeam'], t['fullName']))
        return Response(out)
