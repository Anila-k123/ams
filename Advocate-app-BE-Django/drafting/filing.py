"""Filing a finished draft into AMS, in-process (merge phase 07).

Replaces two HTTP round trips: InstaDraft's /api/drafts/<id>/send-to-ams/, which
POSTed to AMS's integrations/instadraft/documents endpoint using a service token,
and /api/drafts/<id>/ams-task/, which read the task back. The same rules now run
as plain Python:

  POST /api/drafting/drafts/<id>/send-to-ams/  {caseId?}
    Renders the SAVED draft as .docx on the firm's letterhead and files it as an
    AMS Document on the linked case (category "Draft").
    - Re-sending the same draft adds a new version of that document, matched on
      external_ref = the session id.
    - A draft started from a delegated task is linked to the task
      (CaseTaskDocument) and submitted for the senior's review (workspace/review.py).
    - Needs DOCUMENT_UPLOAD, except that the task's own assignee may always file on
      their task, e.g. an intern drafting what the senior assigned.
    - `caseId` links a not-yet-linked draft first.

  GET /api/drafting/drafts/<id>/ams-task/  -> {task: {...review state} | null}

The AMS document, the task link and the session's "filed" marker are written in one
transaction: AMS and drafting share one database (schema public / drf).
"""

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Advocate, Case, Document
from core.permissions import RequirePermission
from core.practice import practice_ids
from documents.storage import add_version, create_document
from workspace import review
from workspace.models import CaseTask, CaseTaskDocument

from .access import own_sessions, viewable_sessions
from .ams_cases import link_case

DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'


def _case_for(session, user):
    case_id = session.project.case_id if session.project_id else None
    if not case_id:
        return None
    return (Case.objects.select_related('client')
            .filter(id=case_id, advocate_id__in=practice_ids(user), deleted=False).first())


def _task_for(session, case, user):
    if not (case and session.ams_task_id):
        return None
    return CaseTask.objects.filter(id=session.ams_task_id, case_id=case.id,
                                   advocate_id__in=practice_ids(user)).first()


def task_payload(task):
    reviewer = (Advocate.objects.filter(id=task.reviewed_by_id).only('full_name').first()
                if task.reviewed_by_id else None)
    return {'id': task.id, 'title': task.title, 'priority': task.priority,
            'deadline': task.deadline, 'assignedById': task.assigned_by_id,
            'assignedToId': task.assigned_to_id, 'completed': task.completed,
            'needsReview': review.needs_review(task), 'reviewStatus': task.review_status,
            'reviewNote': task.review_note, 'reviewedByName': reviewer.full_name if reviewer else None,
            'reviewedAt': task.reviewed_at}


class SendToAmsView(APIView):
    permission_classes = [RequirePermission('DRAFT_VIEW')]

    def post(self, request, pk):
        from .export.docx import render_session_docx, session_title
        from .export.views import branding_for, export_filename

        session = get_object_or_404(own_sessions(request.user).select_related('template', 'project'), pk=pk)
        user = request.user

        # Link a case first, if asked and not linked yet.
        raw_case = request.data.get('caseId')
        if raw_case not in (None, '') and not (session.project_id and session.project.case_id):
            try:
                case_id = int(raw_case)
            except (TypeError, ValueError):
                return Response({'error': 'caseId must be an integer.'}, status=400)
            case = (Case.objects.select_related('client')
                    .filter(id=case_id, advocate_id__in=practice_ids(user), deleted=False).first())
            if case is None:
                return Response({'error': 'Case not found.'}, status=404)
            session.client, session.project = link_case(case)
            session.save(update_fields=['client', 'project'])

        case = _case_for(session, user)
        if case is None:
            return Response({'error': 'Link an AMS case first.'}, status=400)
        if not session.blocks.exists():
            return Response({'error': 'The draft is empty.'}, status=400)
        task = _task_for(session, case, user)
        if session.ams_task_id and task is None:
            return Response({'error': 'Task not found on this case.'}, status=404)
        own_task = task is not None and review.is_assignee(task, user)
        if 'DOCUMENT_UPLOAD' not in request._advocate_permissions and not own_task:
            return Response({'error': 'You do not have permission to upload documents.'}, status=403)

        data = render_session_docx(session, branding_for(user))
        upload = SimpleUploadedFile(export_filename(session), data, content_type=DOCX_TYPE)
        name = session_title(session) or f'Draft {session.id}'
        ref = str(session.id)
        with transaction.atomic():
            # Locked so two quick re-sends can't both create "version 1".
            doc = (Document.objects.select_for_update()
                   .filter(external_ref=ref, case_id=case.id, advocate_id__in=practice_ids(user))
                   .order_by('id').first())
            if doc is None:
                doc = create_document(user, upload, document_name=name, category='Draft',
                                      description='Drafted in AMS Drafting', case=case,
                                      client=case.client, external_ref=ref)
            else:
                add_version(doc, upload, user, note='Updated from Drafting')
                if name != doc.document_name:        # the draft may have been renamed
                    doc.document_name = name
                    doc.save(update_fields=['document_name'])
            if task is not None:
                CaseTaskDocument.objects.get_or_create(
                    task_id=task.id, document_id=doc.id, defaults={'advocate_id': user.id})
                review.submit(task, user)
            session.ams_document_id = doc.id
            session.ams_document_version = doc.version
            session.ams_synced_at = timezone.now()
            session.save(update_fields=['ams_document_id', 'ams_document_version', 'ams_synced_at'])
        if task is not None:
            task.refresh_from_db()
        return Response({'documentId': doc.id, 'version': doc.version, 'taskLinked': task is not None,
                         'syncedAt': session.ams_synced_at, 'amsCaseId': case.id,
                         'reviewStatus': task.review_status if task is not None else None})


class DraftAmsTaskView(APIView):
    permission_classes = [RequirePermission('DRAFT_VIEW')]

    def get(self, request, pk):
        session = get_object_or_404(viewable_sessions(request.user).select_related('project'), pk=pk)
        task = _task_for(session, _case_for(session, request.user), request.user)
        return Response({'task': task_payload(task) if task else None})
