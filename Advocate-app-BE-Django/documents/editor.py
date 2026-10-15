"""Any AMS document in the ONLYOFFICE editor (docs/ONLYOFFICE_PLAN.md, "General document editor").

The same document server and signing as the draft editor (drafting/onlyoffice.py), for documents that
have nothing to do with drafting: open a case / firm document (Word, Excel, PowerPoint; PDF to read)
and edit it, or start a new blank one. Every save in the editor becomes a new document version
(documents.storage.add_version), so the document's history, downloads, client sharing and summary keep
working as for an uploaded version.

Access is the documents' own: the advocate's practice (core.practice.practice_ids), DOCUMENT_VIEW to
open, DOCUMENT_EDIT to change. The document server has no AMS login: the file / callback / version
links carry a signed, expiring token instead (like the draft editor's).
"""

import datetime
import logging
import os
import secrets

import jwt
import requests
from django.conf import settings
from django.core import signing
from django.core.files.base import ContentFile
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Document
from core.permissions import RequirePermission
from core.practice import practice_ids

from .models import DocumentEditState, DocumentVersion, DocumentVersionChanges

log = logging.getLogger(__name__)

_SALT = 'documents.editor'
LINK_AGE = 24 * 3600

# What the editor opens, by extension: its document type, and whether it can be edited and saved back
# in the same format (older binary formats and PDFs open to read).
_TYPES = {
    'docx': ('word', True), 'odt': ('word', True), 'rtf': ('word', True), 'txt': ('word', True),
    'doc': ('word', False),
    'xlsx': ('cell', True), 'ods': ('cell', True), 'csv': ('cell', True), 'xls': ('cell', False),
    'pptx': ('slide', True), 'odp': ('slide', True), 'ppt': ('slide', False),
    'pdf': ('pdf', False),
}
_NEW = {'word': 'docx', 'cell': 'xlsx', 'slide': 'pptx'}


def configured():
    """The document server is set up (independent of DRAFT_EDITOR, which only switches the draft page)."""
    return bool(settings.ONLYOFFICE_URL and settings.ONLYOFFICE_JWT_SECRET and settings.AMS_INTERNAL_URL)


def _sign(payload):
    return jwt.encode(payload, settings.ONLYOFFICE_JWT_SECRET, algorithm='HS256')


def _ext(doc):
    return os.path.splitext(doc.original_name or doc.stored_name or '')[1].lower().lstrip('.')


def kind_of(doc):
    """(documentType, editable) for the editor, or (None, False) when it can't open this file."""
    return _TYPES.get(_ext(doc), (None, False))


def _link_token(doc_id):
    return signing.dumps({'d': doc_id}, salt=_SALT, compress=True)


def _link_ok(token, doc_id):
    try:
        return signing.loads(token or '', salt=_SALT, max_age=LINK_AGE).get('d') == doc_id
    except signing.BadSignature:
        return False


def _link(path, doc_id):
    return f'{settings.AMS_INTERNAL_URL}/api/editor/{path}?t={_link_token(doc_id)}'


def _new_key(doc):
    # Random part: the test and dev instances share one document server and their ids overlap.
    return f'doc{doc.id}v{doc.version or 1}{secrets.token_hex(6)}'


def _state(doc):
    state, _ = DocumentEditState.objects.get_or_create(document_id=doc.id, defaults={'key': _new_key(doc)})
    return state


def _document(user, pk):
    """The document if it is in the user's practice and they may view documents (else 404 / 403)."""
    doc = get_object_or_404(Document, id=pk, advocate_id__in=practice_ids(user))
    codes = user.permission_codes()
    if doc.advocate_id != user.id and 'DOCUMENT_VIEW' not in codes:
        raise PermissionDenied('You may not open this document.')
    return doc


def can_edit(user, doc):
    return kind_of(doc)[1] and ('DOCUMENT_EDIT' in user.permission_codes() or doc.advocate_id == user.id
                                or _task_worker(user, doc))


def _task_worker(user, doc):
    """The person a delegated task is assigned to may edit that open task's attached documents (Write in
    editor / Continue document, then Submit to task), even without DOCUMENT_EDIT."""
    from workspace.models import CaseTask, CaseTaskDocument
    task_ids = list(CaseTaskDocument.objects.filter(document_id=doc.id).values_list('task_id', flat=True))
    return bool(task_ids) and CaseTask.objects.filter(
        id__in=task_ids, assigned_to_id=user.id, cancelled=False, completed=False,
        advocate_id__in=practice_ids(user)).exclude(review_status='APPROVED').exists()


def _version_key(doc_id, version):
    row = DocumentVersionChanges.objects.filter(document_id=doc_id, version=version).first()
    if row:
        return row.key
    return f'doch{doc_id}v{version}{settings.ONLYOFFICE_JWT_SECRET[:4].encode().hex()}'


# --- the editor config -----------------------------------------------------------------------------

def editor_config(doc, user):
    doc_type, editable = kind_of(doc)
    from .dav import desktop_lock
    edit = can_edit(user, doc) and not desktop_lock('doc', doc.id, user.id)   # open in Word: read-only here
    state = _state(doc)
    from .dav import work_of
    # This user's own unsaved-to-PactPro edits (an earlier session closed without Save): they go on with them.
    own_work = edit and work_of('doc', doc.id, user.id) is not None
    from drafting.onlyoffice import _branding
    config = {
        'document': {
            'fileType': _ext(doc), 'key': state.key, 'title': doc.document_name or doc.original_name,
            'url': _link(f'file/{doc.id}', doc.id) + ('&work=1' if own_work else ''),
            'permissions': {'edit': bool(edit), 'review': bool(edit), 'comment': bool(edit), 'download': False,
                            'print': False, 'chat': False, 'protect': False, 'copy': True},
        },
        'documentType': doc_type,
        'editorConfig': {
            'mode': 'edit' if edit else 'view',
            'callbackUrl': _link(f'callback/{doc.id}', doc.id),
            'user': {'id': str(user.id), 'name': (user.full_name or user.email or f'User {user.id}')},
            'lang': 'en',
            'coEditing': {'mode': 'fast', 'change': False},
            'plugins': {'autostart': [], 'pluginsData': []},
            'customization': {
                # The editor's Save does PactPro's save (force save -> a new document version).
                'forcesave': True, 'autosave': True,
                'compactHeader': True, 'toolbarHideFileName': True, 'uiTheme': 'theme-classic-light',
                'plugins': False, 'macros': False, 'macrosMode': 'disable', 'chat': False,
                'comments': bool(edit), 'help': False, 'feedback': False, 'goback': False, 'mentionShare': False,
                **_branding(),
            },
        },
    }
    config['token'] = _sign(config)
    return config


def _info(doc):
    return {'id': doc.id, 'name': doc.document_name or doc.original_name, 'version': doc.version or 1,
            'case': {'id': doc.case_id, 'title': getattr(doc.case, 'case_title', '') or ''} if doc.case_id else None}


def _tasks_of(doc, user):
    """The open tasks this document is attached to, and what this user does there from the editor page:
    hand it in (the assignee of a delegated task: "Submit to task") or decide on it (the reviewer: Approve /
    Request changes while it is submitted)."""
    from core.models import Advocate
    from workspace.models import CaseTask, CaseTaskDocument
    from workspace.review import can_review, is_assignee, needs_review
    ids = CaseTaskDocument.objects.filter(document_id=doc.id).values_list('task_id', flat=True)
    out = []
    for t in CaseTask.objects.filter(id__in=list(ids), advocate_id__in=practice_ids(user)):
        if getattr(t, 'cancelled', False) or t.review_status == 'APPROVED':
            continue
        assignee = Advocate.objects.filter(id=t.assigned_to_id).values_list('full_name', flat=True).first()
        out.append({'id': t.id, 'title': t.title, 'reviewStatus': t.review_status,
                    'assignedToId': t.assigned_to_id, 'assignedById': t.assigned_by_id, 'assignedToName': assignee,
                    'canSubmit': needs_review(t) and is_assignee(t, user),
                    'canReview': t.review_status == 'SUBMITTED' and can_review(t, user)})
    return out


class EditorView(APIView):
    """GET documents/<id>/editor: {enabled, url, editable, document, config} for the editor page."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request, pk):
        if not configured():
            return Response({'enabled': False, 'reason': 'The document editor is not set up on this server.'})
        doc = _document(request.user, pk)
        doc_type, _ = kind_of(doc)
        if doc_type is None:
            return Response({'enabled': False, 'reason': f'.{_ext(doc)} files can\'t be opened in the editor.'})
        from .dav import desktop_lock
        lock = desktop_lock('doc', doc.id, request.user.id)
        from .dav import work_of
        return Response({'enabled': True, 'url': settings.ONLYOFFICE_URL,
                         'editable': bool(can_edit(request.user, doc)) and not lock, 'desktopLock': lock,
                         'pendingWork': work_of('doc', doc.id, request.user.id) is not None,
                         'tasks': _tasks_of(doc, request.user),
                         'document': _info(doc), 'config': editor_config(doc, request.user)})


# --- new documents -------------------------------------------------------------------------------

def _blank(kind):
    """A blank file of `kind` (word / cell / slide) as bytes."""
    import io
    out = io.BytesIO()
    if kind == 'word':
        from docx import Document as Docx
        Docx().save(out)
    elif kind == 'cell':
        from openpyxl import Workbook
        Workbook().save(out)
    else:
        from pptx import Presentation
        Presentation().save(out)
    return out.getvalue()


class NewDocumentView(APIView):
    """POST documents/new {kind: word|cell|slide, name, case_id?, client_id?, template_id?}: a new blank
    document (or a copy of a firm drafting template's Word file), filed like an upload, ready to edit."""
    permission_classes = [RequirePermission('DOCUMENT_UPLOAD')]

    def post(self, request):
        if not configured():
            return Response({'error': 'The document editor is not set up on this server.'}, status=400)
        from core.models import Case, Client
        from .storage import create_document
        kind = str(request.data.get('kind') or 'word')
        if kind not in _NEW:
            return Response({'error': 'Choose Word, Excel or PowerPoint.'}, status=400)
        name = (str(request.data.get('name') or '').strip() or 'Untitled')[:200]
        data = None
        template_id = request.data.get('template_id')
        if template_id and kind == 'word':
            from drafting.access import firm_setup
            from drafting.models import Template
            from drafting.wordform import _word_path
            tpl = firm_setup(Template.objects.all(), request.user).filter(id=template_id).first()
            path = _word_path(tpl) if tpl else None
            if not path:
                return Response({'error': 'That template has no Word file to start from.'}, status=400)
            with open(path, 'rb') as f:
                data = f.read()
        ids = practice_ids(request.user)
        case = Case.objects.filter(id=request.data.get('case_id'), advocate_id__in=ids).first() \
            if request.data.get('case_id') else None
        client = Client.objects.filter(id=request.data.get('client_id'), advocate_id__in=ids).first() \
            if request.data.get('client_id') else None
        ext = _NEW[kind]
        filename = name if name.lower().endswith('.' + ext) else f'{name}.{ext}'
        doc = create_document(request.user, ContentFile(data or _blank(kind), name=filename),
                              document_name=name, case=case, client=client or (case.client if case else None),
                              description='Created in the editor')
        from .blank import mark_blank
        mark_blank(doc)                                    # removed if closed without anything saved
        return Response({'id': doc.id}, status=201)


# --- save / history / restore / compare (the editor's own screens) --------------------------------

def _store(doc, data, user_id, changes=None, history=None):
    """A file the editor saved becomes the document's new version (add_version), with a new key."""
    from core.models import Advocate
    from .storage import add_version
    user = Advocate.objects.filter(id=user_id).first() or Advocate.objects.filter(id=doc.advocate_id).first()
    f = ContentFile(data, name=doc.original_name or f'document.{_ext(doc)}')
    with transaction.atomic():
        add_version(doc, f, user, note='Edited in the editor')
        doc.refresh_from_db()
        key = _new_key(doc)
        DocumentEditState.objects.update_or_create(document_id=doc.id, defaults={'key': key})
        row = DocumentVersionChanges(document_id=doc.id, version=doc.version, key=key, history=history or {})
        if changes:
            row.changes.save(f'changes-{doc.id}-v{doc.version}.zip', ContentFile(changes), save=False)
        row.save()
    return doc


def _command(body):
    res = requests.post(f'{settings.ONLYOFFICE_INTERNAL_URL}/command', json={**body, 'token': _sign(body)}, timeout=15)
    return res.json()


def force_save(doc, wait=15.0, userdata='pactpro'):
    """Ask the open editor to save now. userdata 'pactpro' (PactPro's Save) makes a version; 'work' only
    updates the working copy (a copy for this computer without a version)."""
    import time
    state = _state(doc)
    if not state.editing:
        return doc
    if userdata == 'work':
        from django.utils import timezone
        from .dav import wait_for_work
        since = timezone.now()
        try:
            out = _command({'c': 'forcesave', 'key': state.key, 'userdata': 'work'})
        except (requests.RequestException, ValueError) as exc:
            log.warning('Editor force save failed for document %s: %s', doc.id, exc)
            return doc
        if out.get('error') == 0:
            wait_for_work('doc', doc.id, since, wait)
        return doc
    try:
        out = _command({'c': 'forcesave', 'key': state.key, 'userdata': 'pactpro'})
    except (requests.RequestException, ValueError) as exc:
        log.warning('Editor force save failed for document %s: %s', doc.id, exc)
        return doc
    if out.get('error') != 0:
        return doc
    start, version = time.monotonic(), doc.version
    while time.monotonic() - start < wait:
        time.sleep(0.5)
        fresh = Document.objects.get(id=doc.id)
        if fresh.version != version:
            return fresh
    return Document.objects.get(id=doc.id)


class SaveView(APIView):
    """POST documents/<id>/editor/save: the page's Save, the only way the editor makes a version: what is
    open now (force save), else this user's working copy (the editor's own saves / closing put it there)."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def post(self, request, pk):
        from .dav import drop_work, work_bytes, work_of
        doc = _document(request.user, pk)
        if not can_edit(request.user, doc):
            raise PermissionDenied('You can view this document but not change it.')
        if request.data.get('to') == 'work':
            # A copy for this computer only: what is open goes to the working copy, no version.
            force_save(doc, userdata='work')
            return Response({'work': work_of('doc', doc.id, request.user.id) is not None})
        before = doc.version
        doc = force_save(doc)
        work = work_of('doc', doc.id, request.user.id)
        if work is not None:
            if doc.version == before:                      # nothing newer in the editor: the working copy
                doc = _store(doc, work_bytes(work), request.user.id)
            drop_work('doc', doc.id)
        return Response({'version': doc.version, 'saved': doc.version != before})


class HistoryView(APIView):
    """GET documents/<id>/editor/history[/<version>]: the editor's Version History (refreshHistory /
    setHistoryData), from the document's versions."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request, pk, version=None):
        doc = _document(request.user, pk)
        rows = {v.version: v for v in DocumentVersion.objects.filter(document_id=doc.id)}
        if (doc.version or 1) not in rows:                  # never re-versioned: the current file is v1
            rows[doc.version or 1] = None
        changes = {c.version: c for c in DocumentVersionChanges.objects.filter(document_id=doc.id)}
        if version is None:
            from core.models import Advocate
            ids = {r.uploaded_by_id for r in rows.values() if r and r.uploaded_by_id} | {doc.advocate_id}
            names = dict(Advocate.objects.filter(id__in=ids).values_list('id', 'full_name'))
            history = []
            for v in sorted(rows):
                r, c = rows[v], changes.get(v)
                who = (r.uploaded_by_id if r else None) or doc.advocate_id
                item = {'version': v, 'key': _state(doc).key if v == (doc.version or 1) else _version_key(doc.id, v),
                        'created': (r.created_at if r else doc.updated_at or doc.upload_date).strftime('%Y-%m-%d %H:%M'),
                        'user': {'id': str(who or ''), 'name': names.get(who, '')}}
                if c and c.history.get('changes'):
                    item['changes'] = c.history['changes']
                if c and c.history.get('serverVersion'):
                    item['serverVersion'] = c.history['serverVersion']
                history.append(item)
            return Response({'currentVersion': doc.version or 1, 'history': history})
        if version not in rows:
            return Response({'error': 'No such version.'}, status=404)

        def key_of(v):
            return _state(doc).key if v == (doc.version or 1) else _version_key(doc.id, v)

        data = {'version': version, 'key': key_of(version), 'fileType': _ext(doc),
                'url': _link(f'version/{doc.id}/{version}', doc.id)}
        earlier = [v for v in rows if v < version]
        if earlier:
            prev = max(earlier)
            data['previous'] = {'key': key_of(prev), 'fileType': _ext(doc), 'url': _link(f'version/{doc.id}/{prev}', doc.id)}
            if changes.get(version) and changes[version].changes:
                data['changesUrl'] = _link(f'changes/{doc.id}/{version}', doc.id)
        data['token'] = _sign(data)
        return Response(data)


class RestoreView(APIView):
    """POST documents/<id>/editor/restore {version}: that version's file becomes a new current version."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def post(self, request, pk):
        doc = _document(request.user, pk)
        if not can_edit(request.user, doc):
            raise PermissionDenied('You can view this document but not change it.')
        row = get_object_or_404(DocumentVersion, document_id=doc.id, version=request.data.get('version'))
        from .storage import resolve_stored_file
        path = resolve_stored_file(row.file_path, row.stored_name)
        if path is None:
            return Response({'error': 'That version\'s file is missing.'}, status=404)
        doc = force_save(doc)
        with open(path, 'rb') as f:
            doc = _store(doc, f.read(), request.user.id)
        return Response({'config': editor_config(doc, request.user), 'document': _info(doc)})


def _client_review_file(doc, data):
    """Compare with a client's review copy ({reviewRound: id}) or a file they sent back ({reviewFile: id}),
    as an uploaded file (docs/CLIENT_REVIEW.md). None when neither is asked for."""
    from django.core.files.uploadedfile import SimpleUploadedFile
    from clientreview.models import ClientReviewFile, ClientReviewRound
    if data.get('reviewRound'):
        row = get_object_or_404(ClientReviewRound, id=data['reviewRound'], review__document_id=doc.id)
        name, field = row.file_name, row.file
    elif data.get('reviewFile'):
        row = get_object_or_404(ClientReviewFile, id=data['reviewFile'], message__review__document_id=doc.id)
        name, field = row.name, row.file
    else:
        return None
    with field.open('rb') as f:
        return SimpleUploadedFile(name, f.read())


class CompareView(APIView):
    """POST documents/<id>/editor/compare: {version} or an uploaded `file` of the same type -> the signed
    document for the editor's Compare (setRequestedDocument); differences show as tracked changes."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def post(self, request, pk):
        import uuid

        from django.core.files.storage import default_storage
        doc = _document(request.user, pk)
        if not can_edit(request.user, doc):
            raise PermissionDenied('You can view this document but not change it.')
        upload = request.FILES.get('file') or _client_review_file(doc, request.data)
        if upload is not None:
            if os.path.splitext(upload.name)[1].lower().lstrip('.') != _ext(doc):
                return Response({'error': f'Choose a .{_ext(doc)} file.'}, status=400)
            name = default_storage.save(f'documents/editor/compare/{doc.id}/{uuid.uuid4().hex}.{_ext(doc)}', upload)
            url = _link(f'compare/{doc.id}/{name.rsplit("/", 1)[-1]}', doc.id)
        else:
            row = get_object_or_404(DocumentVersion, document_id=doc.id, version=request.data.get('version'))
            url = _link(f'version/{doc.id}/{row.version}', doc.id)
        data = {'c': 'compare', 'fileType': _ext(doc), 'url': url}
        data['token'] = _sign(data)
        return Response(data)


# --- document server -> AMS (signed links, no login) ---------------------------------------------

class _Public(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @staticmethod
    def _bytes(path, content_type, filename):
        with open(path, 'rb') as f:
            resp = HttpResponse(f.read(), content_type=content_type)
        resp['Content-Disposition'] = f'attachment; filename="{filename}"'
        return resp


class FileView(_Public):
    def get(self, request, pk):
        if not _link_ok(request.query_params.get('t'), pk):
            return HttpResponse(status=404)
        from .storage import resolve_stored_file
        doc = Document.objects.filter(id=pk).first()
        path = resolve_stored_file(doc.file_path, doc.stored_name) if doc else None
        if path is None:
            return HttpResponse(status=404)
        if request.query_params.get('work'):              # reopening one's own unsaved-to-PactPro edits
            from .dav import work_bytes, work_of
            work = work_of('doc', doc.id)
            if work is not None:
                resp = HttpResponse(work_bytes(work), content_type=doc.file_type or 'application/octet-stream')
                resp['Content-Disposition'] = 'attachment; filename="file"'
                return resp
        return self._bytes(path, doc.file_type or 'application/octet-stream', doc.original_name or 'file')


class VersionFileView(_Public):
    def get(self, request, pk, version):
        if not _link_ok(request.query_params.get('t'), pk):
            return HttpResponse(status=404)
        doc = Document.objects.filter(id=pk).first()
        row = DocumentVersion.objects.filter(document_id=pk, version=version).first()
        from .storage import resolve_stored_file
        if row is not None:
            path = resolve_stored_file(row.file_path, row.stored_name)
        elif doc is not None and (doc.version or 1) == version:
            path = resolve_stored_file(doc.file_path, doc.stored_name)
        else:
            path = None
        if path is None:
            return HttpResponse(status=404)
        return self._bytes(path, 'application/octet-stream', f'v{version}')


class ChangesFileView(_Public):
    def get(self, request, pk, version):
        if not _link_ok(request.query_params.get('t'), pk):
            return HttpResponse(status=404)
        row = DocumentVersionChanges.objects.filter(document_id=pk, version=version).first()
        if not row or not row.changes:
            return HttpResponse(status=404)
        return self._bytes(row.changes.path, 'application/zip', f'changes-v{version}.zip')


class CompareFileView(_Public):
    def get(self, request, pk, name):
        import re

        from django.core.files.storage import default_storage
        if not _link_ok(request.query_params.get('t'), pk) or not re.fullmatch(r'[0-9a-f]{32}\.[a-z]{3,4}', name):
            return HttpResponse(status=404)
        path = f'documents/editor/compare/{pk}/{name}'
        if not default_storage.exists(path):
            return HttpResponse(status=404)
        return self._bytes(default_storage.path(path), 'application/octet-stream', name)


def _callback_payload(request):
    body = request.data if isinstance(request.data, dict) else {}
    auth = request.headers.get('Authorization', '')
    token = body.get('token') or (auth[7:] if auth.startswith('Bearer ') else '')
    if not token:
        return None
    try:
        data = jwt.decode(token, settings.ONLYOFFICE_JWT_SECRET, algorithms=['HS256'])
    except jwt.InvalidTokenError:
        return None
    return data.get('payload', data)


class CallbackView(_Public):
    """POST editor/callback/<id>: the document server's save callback (same statuses as the draft
    editor: 1 editing, 2 / 6 save, 4 closed unchanged, 3 / 7 errors)."""

    def post(self, request, pk):
        if not _link_ok(request.query_params.get('t'), pk):
            return HttpResponse(status=404)
        data = _callback_payload(request)
        if data is None:
            return JsonResponse({'error': 1, 'message': 'invalid token'}, status=403)
        doc = Document.objects.filter(id=pk).first()
        if doc is None:
            return JsonResponse({'error': 1}, status=404)
        state = _state(doc)
        if data.get('key') and data['key'] != state.key:
            return JsonResponse({'error': 0})               # an older version's callback
        status = data.get('status')
        users = data.get('users') or []
        user_id = int(users[0]) if users and str(users[0]).isdigit() else None
        if status == 1:
            DocumentEditState.objects.filter(pk=state.pk).update(editing=True)
        elif status in (2, 6):
            try:
                res = requests.get(data['url'], timeout=60)
                res.raise_for_status()
            except (requests.RequestException, KeyError) as exc:
                log.error('Editor save of document %s: could not download the file: %s', pk, exc)
                return JsonResponse({'error': 1})
            changes = None
            if data.get('changesurl'):
                try:
                    got = requests.get(data['changesurl'], timeout=60)
                    changes = got.content if got.ok else None
                except requests.RequestException:
                    changes = None
            if status == 6 and data.get('userdata') == 'pactpro':
                # PactPro's Save: the one way the editor makes a version.
                from .dav import drop_work
                _store(doc, res.content, user_id, changes=changes, history=data.get('history'))
                drop_work('doc', doc.id)                   # what was on screen includes the working copy
            else:
                # Closing the editor, or its own Save / Ctrl+S: a working copy, not a version, until the
                # user saves to PactPro (docs/DESKTOP_EDITING.md).
                from core.models import Advocate
                from .dav import put_work
                user = Advocate.objects.filter(id=user_id).first() or Advocate.objects.filter(id=doc.advocate_id).first()
                put_work('doc', doc.id, user, doc.original_name or f'document.{_ext(doc)}', res.content)
                if status == 2:                            # the next open loads the working copy fresh
                    DocumentEditState.objects.filter(document_id=doc.id).update(key=_new_key(doc))
            if status == 2:
                DocumentEditState.objects.filter(document_id=doc.id).update(editing=False)
        elif status == 4:
            DocumentEditState.objects.filter(pk=state.pk).update(editing=False)
            from .blank import remove_if_abandoned
            remove_if_abandoned(doc.id)                    # a new document closed with nothing written
        elif status in (3, 7):
            log.error('The editor could not save document %s (status %s)', pk, status)
        return JsonResponse({'error': 0})


# --- @mentions in comments ---------------------------------------------------------------------

def _colleagues(user, doc):
    """Who can open this document: the practice's members with DOCUMENT_VIEW (and its uploader)."""
    from core.models import Advocate
    out = []
    for a in Advocate.objects.filter(id__in=practice_ids(user)).exclude(id=user.id):
        if a.id == doc.advocate_id or 'DOCUMENT_VIEW' in a.permission_codes():
            out.append(a)
    return out


class MentionUsersView(APIView):
    """GET documents/<id>/editor/users: the people "@" offers in a comment (setUsers)."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request, pk):
        doc = _document(request.user, pk)
        return Response({'users': [{'id': str(a.id), 'name': a.full_name, 'email': a.email}
                                   for a in _colleagues(request.user, doc)]})


class MentionNotifyView(APIView):
    """POST documents/<id>/editor/notify {emails, message}: notify each mentioned colleague who can open it."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def post(self, request, pk):
        from notifications import service
        doc = _document(request.user, pk)
        emails = {str(e).strip().lower() for e in (request.data.get('emails') or []) if e}
        message = str(request.data.get('message') or '').strip()[:1000]
        name = doc.document_name or doc.original_name
        sent = 0
        for a in _colleagues(request.user, doc):
            if (a.email or '').lower() in emails:
                service.notify(a.id, 'DOCUMENT_COMMENT', f'{request.user.full_name} mentioned you on {name}',
                               f'{request.user.full_name} mentioned you in a comment on "{name}":\n\n{message}\n',
                               channels=(service.IN_APP,), case_id=doc.case_id, recipient_name=a.full_name,
                               recipient_email=a.email, entity='Document', entity_id=doc.id, triggered_by='USER')
                sent += 1
        return Response({'notified': sent})


class StateView(APIView):
    """GET documents/<id>/editor/state: {version} of the document, polled by the page while there are
    unsaved edits (see drafting.onlyoffice.StateView)."""
    permission_classes = [RequirePermission('DOCUMENT_VIEW')]

    def get(self, request, pk):
        doc = _document(request.user, pk)
        editing = DocumentEditState.objects.filter(document_id=doc.id, editing=True).exists()
        return Response({'version': doc.version or 1, 'editing': editing})
