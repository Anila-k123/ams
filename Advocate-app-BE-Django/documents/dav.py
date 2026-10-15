"""Desktop editing over WebDAV (docs/DESKTOP_EDITING.md): Word / LibreOffice open a PactPro document from
`/dav/<token>/<file name>`, and their own Save writes it back as a new PactPro version.

Desktop programs can't log in to PactPro, so the URL carries a signed, expiring token naming the document,
the user and whether they may edit. A desktop Save (PUT) only overwrites a working copy (DesktopWork): users
save in Word as often as they like without filling the version history. "Save to PactPro" (DesktopWorkView)
turns the working copy into one version through the same path as the PactPro editor:
- a document: a new document version (documents.editor._store);
- a draft: drafting.onlyoffice.store_version (clause markers and fields kept, text copied back).

Office needs WebDAV locks to edit. A lock is held (table desktop_lock) while Word has the file open. Meanwhile the
PactPro editor opens read-only; while the PactPro editor has it open, a desktop LOCK fails (Word opens
read-only).
"""

import datetime
import json
import logging
import mimetypes
import os
import uuid
from email.utils import formatdate
from html import escape

from django.conf import settings
from django.core import signing
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework.response import Response
from rest_framework.views import APIView

log = logging.getLogger(__name__)

_SALT = 'documents.dav'
TOKEN_AGE = 8 * 3600                 # a working day; Office re-reads the URL on each save
LOCK_SECONDS = 30 * 60               # Office refreshes its lock while the file stays open

_OFFICE = {'docx': 'ms-word', 'doc': 'ms-word', 'rtf': 'ms-word', 'odt': 'ms-word', 'txt': 'ms-word',
           'xlsx': 'ms-excel', 'xls': 'ms-excel', 'csv': 'ms-excel', 'ods': 'ms-excel',
           'pptx': 'ms-powerpoint', 'ppt': 'ms-powerpoint', 'odp': 'ms-powerpoint'}


# --- tokens ---------------------------------------------------------------------------------------

def make_token(kind, obj_id, user_id, edit):
    # ':' from the signer is swapped for '~' (Office is fussy about colons in a path segment).
    raw = signing.dumps({'k': kind, 'i': obj_id, 'u': user_id, 'e': bool(edit)}, salt=_SALT, compress=True)
    return raw.replace(':', '~')


def read_token(token):
    try:
        data = signing.loads((token or '').replace('~', ':'), salt=_SALT, max_age=TOKEN_AGE)
    except signing.BadSignature:
        return None
    return data if data.get('k') in ('doc', 'draft') else None


# --- what a token points at -------------------------------------------------------------------------

class _Target:
    """The file behind a token: its bytes, name, whether this user may save, and how a save is stored."""

    def __init__(self, kind, obj_id, user, edit):
        self.kind, self.id, self.user, self.edit = kind, obj_id, user, edit
        if kind == 'doc':
            from core.models import Document
            from core.practice import practice_ids
            from .editor import can_edit
            self.doc = Document.objects.filter(id=obj_id, advocate_id__in=practice_ids(user)).first()
            if self.doc is None:
                raise LookupError
            self.name = self.doc.original_name or f'document-{obj_id}'
            self.edit = edit and can_edit(user, self.doc)
        else:
            from drafting.access import viewable_sessions
            from drafting.onlyoffice import editor_role, ensure_file
            from drafting.export.views import export_filename
            self.session = viewable_sessions(user).filter(id=obj_id).first()
            if self.session is None:
                raise LookupError
            self.draft_file = ensure_file(self.session, user)
            self.name = export_filename(self.session)
            self.edit = edit and editor_role(self.session, user, desktop=False) == 'decide'

    def work(self):
        from .models import DesktopWork
        return DesktopWork.objects.filter(kind=self.kind, obj_id=self.id).first()

    def stored(self):
        """The PactPro version's bytes (not the working copy)."""
        if self.kind == 'doc':
            from .storage import resolve_stored_file
            path = resolve_stored_file(self.doc.file_path, self.doc.stored_name)
            if path is None:
                raise LookupError('the document file is missing')
            with open(path, 'rb') as f:
                return f.read()
        with self.draft_file.file.open('rb') as f:
            return f.read()

    def data(self):
        """What the desktop program sees: its working copy (not yet saved to PactPro), else the current version."""
        work = self.work()
        if work:
            with work.file.open('rb') as f:
                return f.read()
        return self.stored()

    def modified(self):
        work = self.work()
        stamp = work.updated if work else (self.doc.updated_at if self.kind == 'doc' else self.draft_file.updated_at)
        return stamp or datetime.datetime.now()

    def save_work(self, data):
        """A desktop Save: overwrite the working copy."""
        put_work(self.kind, self.id, self.user, self.name, data)

    def drop_work(self):
        drop_work(self.kind, self.id)

    def store(self, data):
        if self.kind == 'doc':
            from .editor import _store
            _store(self.doc, data, self.user.id)
        else:
            from drafting.models import DraftFile
            from drafting.onlyoffice import store_version
            store_version(DraftFile.objects.get(pk=self.draft_file.pk), data, self.user.id)

    def editor_open(self):
        """The PactPro editor has this file open (its own editing session)."""
        if self.kind == 'doc':
            from .models import DocumentEditState
            return DocumentEditState.objects.filter(document_id=self.id, editing=True).exists()
        from drafting.models import DraftFile
        return DraftFile.objects.filter(pk=self.draft_file.pk, editing=True).exists()


# --- working copies: saves not yet saved to PactPro (any editor) -------------------------------------------

def put_work(kind, obj_id, user, name, data):
    """Overwrite the working copy of this document / draft with `data` (a desktop Save, or the PactPro
    editor's own Save / closing). Nothing becomes a version until "Save to PactPro"."""
    from django.core.files.base import ContentFile
    from .models import DesktopWork
    work = DesktopWork.objects.filter(kind=kind, obj_id=obj_id).first()
    if work is None:
        work = DesktopWork(kind=kind, obj_id=obj_id)
    work.user_id = user.id
    work.by = user.full_name or user.email or ''
    work.name = name
    old = work.file.name if work.file else None
    work.file.save(f'{kind}-{obj_id}-{uuid.uuid4().hex[:8]}{os.path.splitext(name)[1]}', ContentFile(data), save=False)
    work.save()
    if old:
        work.file.storage.delete(old)
    return work


def work_of(kind, obj_id, user_id=None):
    """The working copy (only this user's, when `user_id` is given), or None."""
    from .models import DesktopWork
    qs = DesktopWork.objects.filter(kind=kind, obj_id=obj_id)
    if user_id is not None:
        qs = qs.filter(user_id=user_id)
    return qs.first()


def work_bytes(work):
    with work.file.open('rb') as f:
        return f.read()


def wait_for_work(kind, obj_id, since, wait=15.0):
    """After asking the editor for a working-copy save: wait until it has arrived (newer than `since`)."""
    import time
    start = time.monotonic()
    while time.monotonic() - start < wait:
        work = work_of(kind, obj_id)
        if work is not None and work.updated > since:
            return work
        time.sleep(0.5)
    return work_of(kind, obj_id)


def drop_work(kind, obj_id):
    work = work_of(kind, obj_id)
    if work:
        work.file.delete(save=False)
        work.delete()


def _held(kind, obj_id):
    """The live desktop lock on this file (an expired one is removed), or None."""
    from django.utils import timezone
    from .models import DesktopLock
    lock = DesktopLock.objects.filter(kind=kind, obj_id=obj_id).first()
    if lock and lock.expires <= timezone.now():
        lock.delete()
        return None
    return lock


def _work_by_other(kind, obj_id, user_id):
    from .models import DesktopWork
    return DesktopWork.objects.filter(kind=kind, obj_id=obj_id).exclude(user_id=user_id).exists()


def desktop_lock(kind, obj_id, user_id=None):
    """{'by', 'since', 'pending'} while a desktop program has the file locked or someone's saves aren't saved
    to PactPro yet (either way the PactPro editor is read-only, so nothing gets overwritten), else None.
    With `user_id`, that user's own working copy doesn't count (they go on editing it)."""
    from .models import DesktopWork
    lock = _held(kind, obj_id)
    work = DesktopWork.objects.filter(kind=kind, obj_id=obj_id).first()
    if work and user_id is not None and work.user_id == user_id:
        work = None
    if not lock and not work:
        return None
    since = lock.since if lock else work.updated
    return {'by': lock.by if lock else work.by, 'since': since.isoformat(timespec='minutes'), 'pending': bool(work)}


# --- WebDAV ---------------------------------------------------------------------------------------

def _xml(body, status=207, **headers):
    resp = HttpResponse(f'<?xml version="1.0" encoding="utf-8"?>\n{body}', status=status,
                        content_type='application/xml; charset="utf-8"')
    for k, v in headers.items():
        resp[k.replace('_', '-')] = v
    return resp


def _lockdiscovery(lock):
    return (f'<D:lockdiscovery><D:activelock><D:locktype><D:write/></D:locktype><D:lockscope><D:exclusive/>'
            f'</D:lockscope><D:depth>0</D:depth><D:owner>{escape(lock.by)}</D:owner>'
            f'<D:timeout>Second-{LOCK_SECONDS}</D:timeout><D:locktoken><D:href>{lock.token}</D:href>'
            f'</D:locktoken></D:activelock></D:lockdiscovery>')


def _propfind(request, target, name):
    href = escape(request.path)
    if name is None:                                       # the "folder" above the file
        return _xml('<D:multistatus xmlns:D="DAV:"><D:response>'
                    f'<D:href>{href}</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype>'
                    '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>')
    data = target.data()
    lock = _held(target.kind, target.id)
    ctype = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
    modified = formatdate(target.modified().timestamp(), usegmt=True)
    return _xml('<D:multistatus xmlns:D="DAV:"><D:response>'
                f'<D:href>{href}</D:href><D:propstat><D:prop>'
                f'<D:displayname>{escape(target.name)}</D:displayname><D:resourcetype/>'
                f'<D:getcontentlength>{len(data)}</D:getcontentlength><D:getcontenttype>{ctype}</D:getcontenttype>'
                f'<D:getlastmodified>{modified}</D:getlastmodified>'
                '<D:supportedlock><D:lockentry><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/>'
                '</D:locktype></D:lockentry></D:supportedlock>'
                f'{_lockdiscovery(lock) if lock else ""}'
                '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>')


@csrf_exempt
def dav_view(request, token, name=None):
    """One document over WebDAV. The token decides what it is and what this user may do."""
    claims = read_token(token)
    if claims is None:
        return HttpResponse(status=404)
    from core.models import Advocate
    user = Advocate.objects.filter(id=claims['u']).first()
    if user is None:
        return HttpResponse(status=404)
    try:
        target = _Target(claims['k'], claims['i'], user, claims['e'])
    except (LookupError, Exception) as exc:                # noqa: BLE001 - never leak why
        if not isinstance(exc, LookupError):
            log.exception('WebDAV: could not open %s %s', claims['k'], claims['i'])
        return HttpResponse(status=404)
    method = request.method.upper()
    if name and name.startswith(ADDIN_PREFIX):
        return _addin(request, target, user, name[len(ADDIN_PREFIX):])
    allow = 'OPTIONS, GET, HEAD, PROPFIND, LOCK, UNLOCK' + (', PUT' if target.edit else '')

    if method == 'OPTIONS':
        resp = HttpResponse(status=200)
        resp['DAV'] = '1, 2'
        resp['MS-Author-Via'] = 'DAV'
        resp['Allow'] = allow
        return resp
    if method == 'PROPFIND':
        return _propfind(request, target, name)
    if method in ('GET', 'HEAD'):
        resp = HttpResponse(b'' if method == 'HEAD' else target.data(),
                            content_type=mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
        resp['Last-Modified'] = formatdate(target.modified().timestamp(), usegmt=True)
        return resp
    if method == 'LOCK':
        if not target.edit:
            return HttpResponse(status=403)                # Office then opens read-only
        from django.utils import timezone
        from .models import DesktopLock
        held = _held(target.kind, target.id)
        if held and held.user_id != user.id:
            return HttpResponse(status=423)
        if held is None and target.editor_open():
            return HttpResponse(status=423)                # open in the PactPro editor right now
        if _work_by_other(target.kind, target.id, user.id):
            return HttpResponse(status=423)                # someone else's desktop edits await Save to PactPro
        until = timezone.now() + datetime.timedelta(seconds=LOCK_SECONDS)
        if held:                                           # Office refreshing its own lock
            held.expires = until
            held.save(update_fields=['expires'])
            lock = held
        else:
            lock = DesktopLock.objects.create(kind=target.kind, obj_id=target.id, user_id=user.id, expires=until,
                                              token=f'opaquelocktoken:{uuid.uuid4()}', by=user.full_name or user.email)
        return _xml(f'<D:prop xmlns:D="DAV:">{_lockdiscovery(lock)}</D:prop>', status=200,
                    Lock_Token=f'<{lock.token}>')
    if method == 'UNLOCK':
        held = _held(target.kind, target.id)
        if held and (held.user_id == user.id or held.token in request.headers.get('Lock-Token', '')):
            held.delete()
            if target.kind == 'doc':                       # a new document closed on the desktop unsaved
                from .blank import remove_if_abandoned
                remove_if_abandoned(target.id)
        return HttpResponse(status=204)
    if method == 'PUT':
        if not target.edit:
            return HttpResponse(status=403)
        held = _held(target.kind, target.id)
        if (held and held.user_id != user.id) or _work_by_other(target.kind, target.id, user.id):
            return HttpResponse(status=423)
        data = request.body
        if not data:
            return HttpResponse(status=204)                # Office's empty "touch" before the real write
        target.save_work(data)                             # not a version until "Save to PactPro"
        return HttpResponse(status=204)
    return HttpResponse(status=405, headers={'Allow': allow})


# --- the "Save to PactPro" button inside Word / LibreOffice -------------------------------------------------
# The add-ons (desktop-addins/: LibreOffice extension, Word add-in) know only the file's WebDAV address, so
# they call <that folder>/.pactpro/status | save | discard with the same signed token: no AMS login.

ADDIN_PREFIX = '.pactpro/'


def _addin(request, target, user, action):
    from django.http import JsonResponse
    if request.method.upper() == 'OPTIONS':
        return HttpResponse(status=204)
    work = work_of(target.kind, target.id, user.id)
    if action == 'status' and request.method.upper() == 'GET':
        version = target.doc.version if target.kind == 'doc' else target.draft_file.version
        return JsonResponse({'name': target.name, 'editable': target.edit, 'pending': work is not None,
                             'version': version or 1, 'tasks': _addin_tasks(target, user)})
    if request.method.upper() != 'POST':
        return JsonResponse({'error': 'Unknown request.'}, status=404)
    if action in ('save', 'discard'):
        status, body = finish_work(target, work, action)
        return JsonResponse(body, status=status)
    if action in ('submit', 'review'):
        try:
            data = json.loads(request.body or b'{}')
        except ValueError:
            data = {}
        status, body = _addin_task_action(target, user, work, action, data)
        return JsonResponse(body, status=status)
    return JsonResponse({'error': 'Unknown request.'}, status=404)


def _addin_tasks(target, user):
    """The open tasks this document / draft belongs to, with what this user may do there (submit / review)."""
    if target.kind == 'doc':
        from .editor import _tasks_of
        return _tasks_of(target.doc, user)
    return _draft_tasks(target.session, user)


def _draft_tasks(session, user):
    """A draft's task (drafted for it): the draft's author hands it in like the page's Submit to task (the
    draft is filed on the case, then submitted); the task's reviewer approves / requests changes."""
    from core.models import Advocate
    from drafting.access import own_sessions
    from workspace.access import visible_tasks
    from workspace.review import can_review, is_assignee, needs_review
    task = visible_tasks(user).filter(id=session.ams_task_id).first() if session.ams_task_id else None
    if task is None or getattr(task, 'cancelled', False) or task.review_status == 'APPROVED':
        return []
    assignee = Advocate.objects.filter(id=task.assigned_to_id).values_list('full_name', flat=True).first()
    return [{'id': task.id, 'title': task.title, 'reviewStatus': task.review_status,
             'assignedToId': task.assigned_to_id, 'assignedById': task.assigned_by_id, 'assignedToName': assignee,
             'canSubmit': (needs_review(task) and is_assignee(task, user)
                           and own_sessions(user).filter(id=session.id).exists()),
             'canReview': task.review_status == 'SUBMITTED' and can_review(task, user)}]


def _addin_task_action(target, user, work, action, data):
    """Submit (the assignee: saves edits to PactPro first, hands in this document) or review (the reviewer:
    approve / request changes). Same rules as the PactPro pages (workspace.views.submit_task / review_task)."""
    from workspace.access import visible_tasks
    from workspace.views import review_task, submit_task
    try:
        task_id = int(data.get('taskId'))
    except (TypeError, ValueError):
        return 400, {'error': 'Say which task.'}
    if not any(t['id'] == task_id for t in _addin_tasks(target, user)):
        return 404, {'error': 'This file is not on that task.'}
    task = visible_tasks(user).filter(id=task_id).first()
    if task is None:
        return 404, {'error': 'Task not found.'}
    if action == 'submit':
        if work is not None:                               # hand in what is on screen: save it first
            status, body = finish_work(target, work, 'save')
            if status != 200:
                return status, body
        if target.kind == 'draft':
            # The page's Submit to task: the draft filed on its case as a document, then handed in.
            if not (data.get('note') or '').strip():
                return 400, {'error': 'Say what was done.'}
            from drafting.filing import file_draft
            from drafting.models import DraftSession
            session = DraftSession.objects.get(pk=target.id)
            status, body = file_draft(session, user, note=data.get('note'), hours=_hours(data.get('hours')))
            return (status, body) if status != 200 else (200, {'submitted': True})
        status, err = submit_task(task, user, data.get('note'), data.get('hours'), [target.id])
        return (status, {'error': err}) if err else (200, {'submitted': True})
    if work is not None and data.get('action') == 'approve' and not data.get('unsaved_ok'):
        # The reviewer edited here: approve what is on screen (save first) or say so.
        return 409, {'error': 'You have edits not saved to PactPro.', 'code': 'unsaved'}
    status, err = review_task(task, user, data.get('action'), data.get('note'))
    return (status, {'error': err}) if err else (200, {'reviewed': data.get('action')})


def _hours(raw):
    try:
        hours = round(float(raw), 2) if raw not in (None, '') else None
    except (TypeError, ValueError):
        return None
    return hours if hours is None or 0 < hours <= 999 else None


def finish_work(target, work, action):
    """Save to PactPro (one version) or discard this user's working copy: (http status, body)."""
    if work is None:
        return 404, {'error': 'Nothing new to save: save the file first.', 'code': 'nothing'}
    if action == 'discard':
        target.drop_work()
        return 200, {'discarded': True}
    if not target.edit:
        return 403, {'error': 'You may not change this document.'}
    if _in_pactpro_editor(target.kind, target.id):
        # The open editor may hold newer edits than the working copy: save from there.
        return 409, {'error': 'It is open in the PactPro editor: use Save there.'}
    target.store(work_bytes(work))
    target.drop_work()
    version = target.doc.version if target.kind == 'doc' else None
    if target.kind == 'draft':
        from drafting.models import DraftFile
        version = DraftFile.objects.filter(session_id=target.id).values_list('version', flat=True).first()
    return 200, {'saved': True, 'version': version}


# --- links for the page ------------------------------------------------------------------------------

def dav_base(request):
    """PactPro as the user's computer reaches it (the desktop program fetches from here)."""
    base = getattr(settings, 'AMS_PUBLIC_URL', '') or ''
    return base.rstrip('/') or request.build_absolute_uri('/').rstrip('/')


class DesktopLinksView(APIView):
    """GET /api/desktop-links?kind=doc|draft&id=: the links that open this file in a desktop editor:
    {url, editable, ext, word | excel | powerpoint (Office), libreoffice}. Edit links when the user may change
    it, view links otherwise. Access is checked here, as for opening it in PactPro."""

    def get(self, request):
        kind = request.query_params.get('kind')
        try:
            obj_id = int(request.query_params.get('id') or 0)
        except ValueError:
            obj_id = 0
        if kind not in ('doc', 'draft') or not obj_id:
            return Response({'error': 'Say which document.'}, status=400)
        if kind == 'doc' and 'DOCUMENT_VIEW' not in request.user.permission_codes():
            return Response({'error': 'Not allowed.'}, status=403)
        try:
            target = _Target(kind, obj_id, request.user, True)
        except LookupError:
            return Response({'error': 'Not found.'}, status=404)
        from urllib.parse import quote
        token = make_token(kind, obj_id, request.user.id, target.edit)
        url = f'{dav_base(request)}/dav/{token}/{quote(target.name)}'
        ext = os.path.splitext(target.name)[1].lower().lstrip('.')
        mode = 'ofe' if target.edit else 'ofv'
        links = {'url': url, 'editable': target.edit, 'ext': ext, 'name': target.name,
                 'libreoffice': f'vnd.libreoffice.command:{mode}|u|{url}'}
        scheme = _OFFICE.get(ext)
        if scheme:
            links['office'] = f'{scheme}:{mode}|u|{url}'
            links['officeApp'] = {'ms-word': 'Microsoft Word', 'ms-excel': 'Microsoft Excel',
                                  'ms-powerpoint': 'Microsoft PowerPoint'}[scheme]
        return Response(links)


# --- desktop edits waiting for "Save to PactPro" ----------------------------------------------------------

def _in_pactpro_editor(kind, obj_id):
    if kind == 'doc':
        from .models import DocumentEditState
        return DocumentEditState.objects.filter(document_id=obj_id, editing=True).exists()
    from drafting.models import DraftFile
    return DraftFile.objects.filter(session_id=obj_id, editing=True).exists()


def _work_json(work):
    return {'kind': work.kind, 'id': work.obj_id, 'name': work.name, 'updated': work.updated.isoformat(),
            'open': _held(work.kind, work.obj_id) is not None,
            'inEditor': _in_pactpro_editor(work.kind, work.obj_id)}


class DesktopWorkListView(APIView):
    """GET /api/desktop-work: this user's desktop edits not saved to PactPro yet (the page's bar lists them)."""

    def get(self, request):
        from .models import DesktopWork
        rows = DesktopWork.objects.filter(user_id=request.user.id).order_by('-updated')
        return Response({'items': [_work_json(w) for w in rows]})


class DesktopWorkView(APIView):
    """/api/desktop-work/<kind>/<id>: GET the working copy (a copy for this computer); POST {action: save}
    makes it one PactPro version, {action: discard} drops it. Only for the user who made it."""

    def _target(self, request, kind, pk):
        from .models import DesktopWork
        if kind not in ('doc', 'draft'):
            return None, None
        work = DesktopWork.objects.filter(kind=kind, obj_id=pk, user_id=request.user.id).first()
        if work is None:
            return None, None
        try:
            return _Target(kind, pk, request.user, True), work
        except LookupError:
            return None, None

    def get(self, request, kind, pk):
        from urllib.parse import quote
        _, work = self._target(request, kind, pk)
        if work is None:
            return Response({'error': 'No desktop edits to save.'}, status=404)
        with work.file.open('rb') as f:
            resp = HttpResponse(f.read(), content_type=mimetypes.guess_type(work.name)[0] or 'application/octet-stream')
        resp['Content-Disposition'] = f'attachment; filename="{work.name}"; filename*=UTF-8\'\'{quote(work.name)}'
        return resp

    def post(self, request, kind, pk):
        target, work = self._target(request, kind, pk)
        if work is None:
            return Response({'error': 'No desktop edits to save.'}, status=404)
        action = request.data.get('action')
        if action not in ('save', 'discard'):
            return Response({'error': 'Say save or discard.'}, status=400)
        status, body = finish_work(target, work, action)
        return Response(body, status=status)
