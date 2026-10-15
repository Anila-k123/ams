"""ONLYOFFICE Docs as the draft editor (docs/ONLYOFFICE_PLAN.md, phase 1).

The draft is a Word file (DraftFile). The browser opens it in ONLYOFFICE with an editor config this
backend signs; the document server downloads the file from `file_url` and, when the document is
saved, posts to `callback_url` with a link to the new file. Both links carry a signed, expiring token
(the document server has no AMS login), and the callback is also signed by the server (JWT).

Phase 2: the file carries a content control per clause (drafting/docfile.py); every save copies the
clauses' text back into the draft's blocks (Lisa, search, compare read them), and the Placeholders
panel fills [[Label]] blanks in the file itself.

Phase 3: review in the editor. Who decides edits and accepts / rejects tracked changes; a reviewer
who may only suggest works in review-only mode (every edit tracked); open tracked changes and comment
threads in the file block Approve (and tracked changes block Submit) like the old review rounds did.
"""

import logging
import secrets
import time

import jwt
import requests
from django.conf import settings
from django.core import signing
from django.core.files.base import ContentFile
from django.db import transaction
from django.http import HttpResponse, JsonResponse
from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import DraftFile, DraftFileVersion, DraftSession

log = logging.getLogger(__name__)

DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
_SALT = 'drafting.onlyoffice'
LINK_AGE = 24 * 3600                                      # file / callback links stay valid this long


def enabled():
    return (settings.DRAFT_EDITOR == 'onlyoffice' and bool(settings.ONLYOFFICE_URL)
            and bool(settings.ONLYOFFICE_JWT_SECRET) and bool(settings.AMS_INTERNAL_URL))


def _new_key(session_id, version):
    # Random part: the test and dev instances share one document server and their ids overlap.
    return f'pp{session_id}v{version}{secrets.token_hex(6)}'


def _sign(payload):
    return jwt.encode(payload, settings.ONLYOFFICE_JWT_SECRET, algorithm='HS256')


def _link_token(session_id):
    return signing.dumps({'s': session_id}, salt=_SALT, compress=True)


def _link_session(token, session_id):
    """True when `token` is a valid, unexpired link token for this draft."""
    try:
        data = signing.loads(token or '', salt=_SALT, max_age=LINK_AGE)
    except signing.BadSignature:
        return False
    return data.get('s') == session_id


# --- the file ---------------------------------------------------------------------------------

def _has_markers(df):
    """The file has clause markers (files made in phase 1 have none)."""
    from .docfile import clause_texts
    try:
        with df.file.open('rb') as f:
            return bool(clause_texts(f.read()))
    except Exception:                                      # noqa: BLE001 - unreadable: treat as unmarked
        return False


def _hide_markers_in(df, user_id=None):
    """Older files (and ones saved back with a frame) show the clause markers: hide them, as a new
    version (new key, so the editor loads the clean file). Only while nobody has it open."""
    from .docfile import hide_markers, style_fields
    try:
        with df.file.open('rb') as f:
            data = f.read()
        clean = style_fields(hide_markers(data))
    except Exception:                                      # noqa: BLE001 - leave an unreadable file as it is
        log.exception('Could not check the clause markers of draft %s', df.session_id)
        return df
    return store_version(df, clean, user_id) if clean != data else df


def ensure_file(session, user=None):
    """The draft's Word file, made from the draft (Download's output) the first time."""
    existing = DraftFile.objects.filter(session=session).first()
    if existing:
        if existing.version == 1 and not existing.editing and not _has_markers(existing):
            # Made before clause markers existed (phase 1) and never edited: make it again with them.
            existing.delete()
        elif not existing.editing:
            return _hide_markers_in(existing, getattr(user, 'id', None))
        else:
            return existing
    from .docfile import building
    from .export.views import branding_for
    from .wordform import render_draft_docx
    # Clause markers and [[Label]] placeholders go into the file only while it is made here.
    token = building.set({})
    try:
        data = render_draft_docx(session, branding_for(user) if user else None)
    finally:
        building.reset(token)
    # New drafts: the blanks become Word form fields (fill in the document or the panel, change later).
    from .docfile import tokens_to_fields
    try:
        data = tokens_to_fields(data)
    except Exception:                                      # noqa: BLE001 - [[Label]] text still works
        log.exception('Could not turn the blanks of draft %s into form fields', session.id)
    with transaction.atomic():
        DraftSession.objects.select_for_update().filter(id=session.id).first()
        existing = DraftFile.objects.filter(session=session).first()
        if existing:                                       # made by a parallel request meanwhile
            return existing
        df = DraftFile(session=session, version=1, key=_new_key(session.id, 1),
                       updated_by_id=getattr(user, 'id', None))
        df.file.save(f'draft-{session.id}.docx', ContentFile(data), save=False)
        df.save()
        DraftFileVersion.objects.create(draft_file=df, version=1, created_by_id=df.updated_by_id, key=df.key,
                                        file=ContentFile(data, name=f'draft-{session.id}-v1.docx'))
        return df


def store_version(df, data, user_id=None, changes=None, history=None):
    """A saved file from the document server becomes the current file and a new version. `changes` (the
    callback's changes zip) and `history` let the editor's version history highlight what changed."""
    from .docfile import hide_markers, style_fields
    try:
        data = hide_markers(data)                          # the editor may write the marker frame back
        data = style_fields(data)                          # blanks grey, typed values in their own look
    except Exception:                                      # noqa: BLE001 - keep the file as saved
        log.exception('Could not tidy the markers / fields of draft %s', df.session_id)
    with transaction.atomic():
        df = DraftFile.objects.select_for_update().get(pk=df.pk)
        df.version += 1
        df.key = _new_key(df.session_id, df.version)
        df.updated_by_id = user_id
        df.file.save(f'draft-{df.session_id}.docx', ContentFile(data), save=False)
        df.save()
        row = DraftFileVersion(draft_file=df, version=df.version, created_by_id=user_id, key=df.key,
                               history=history or {},
                               file=ContentFile(data, name=f'draft-{df.session_id}-v{df.version}.docx'))
        if changes:
            row.changes.save(f'changes-{df.session_id}-v{df.version}.zip', ContentFile(changes), save=False)
        row.save()
    # The clauses' text as typed in the editor, for everything that reads the blocks.
    from .docfile import sync_blocks
    try:
        sync_blocks(df.session, data)
    except Exception:                                      # noqa: BLE001 - a save must never be lost over this
        log.exception('Could not copy the text of draft %s back into its clauses', df.session_id)
    return df


def current_docx(session):
    """The draft's Word file as bytes when ONLYOFFICE owns it, else None (the caller renders it).
    Asks the document server to save open edits first, so a download has everything typed."""
    if not enabled():
        return None
    df = DraftFile.objects.filter(session=session).first()
    if df is None:
        return None
    # A download / Save to case isn't a save: what is on screen goes to the working copy, not a version.
    from documents.dav import work_bytes, work_of
    if df.editing:
        force_save(df, userdata='work')
    work = work_of('draft', session.id)
    if work is not None:
        return work_bytes(work)
    with df.file.open('rb') as f:
        return f.read()


def save_to_pactpro(session, user):
    """PactPro's Save: what is open in the editor now (force save, a version), else this user's working copy
    (the editor's own saves / closing, or Word, put it there). Returns the DraftFile."""
    from documents.dav import drop_work, work_bytes, work_of
    df = DraftFile.objects.filter(session=session).first()
    if df is None:
        return None
    before = df.version
    df = force_save(df) if df.editing else df
    work = work_of('draft', session.id, user.id)
    if work is not None:
        if df.version == before:
            df = store_version(df, work_bytes(work), user.id)
        drop_work('draft', session.id)
    return df


def file_review_blockers(session):
    """Why the draft's Word file isn't ready for approval / submission: tracked changes nobody has
    accepted or rejected, comment threads not resolved. [] when there's no file or nothing open."""
    if not enabled():
        return []
    df = DraftFile.objects.filter(session=session).first()
    if df is None:
        return []
    if df.editing:
        df = force_save(df)                                # judge what is on screen, not the last save
    from .docfile import review_state
    try:
        with df.file.open('rb') as f:
            state = review_state(f.read())
    except Exception:                                      # noqa: BLE001 - an unreadable file blocks nothing new
        log.exception('Could not read the review state of draft %s', session.id)
        return []
    out = []
    if state['changes']:
        out.append(f'Accept or reject the {state["changes"]} tracked change(s) in the document first '
                   '(Review tab in the editor).')
    if state['comments']:
        out.append(f'Resolve the {state["comments"]} open comment(s) in the document first.')
    return out


def _command(body):
    url = f'{settings.ONLYOFFICE_INTERNAL_URL}/command'
    res = requests.post(url, json={**body, 'token': _sign(body)}, timeout=15)
    return res.json()


def force_save(df, wait=15.0, userdata='pactpro'):
    """Ask the document server to save the open document now (callback status 6) and wait a little
    for the new version. Returns the (possibly updated) DraftFile. userdata 'work': only the working copy
    (a copy for this computer without a version)."""
    if userdata == 'work':
        from django.utils import timezone
        from documents.dav import wait_for_work
        since = timezone.now()
        try:
            out = _command({'c': 'forcesave', 'key': df.key, 'userdata': 'work'})
        except (requests.RequestException, ValueError) as exc:
            log.warning('ONLYOFFICE force save failed for draft %s: %s', df.session_id, exc)
            return df
        if out.get('error') == 0:
            wait_for_work('draft', df.session_id, since, wait)
        return df
    try:
        # userdata 'pactpro': asked for by PactPro (Save, Download, Apply...), so it becomes a version.
        out = _command({'c': 'forcesave', 'key': df.key, 'userdata': 'pactpro'})
    except (requests.RequestException, ValueError) as exc:
        log.warning('ONLYOFFICE force save failed for draft %s: %s', df.session_id, exc)
        return df
    if out.get('error') != 0:                              # 4: nothing changed since the last save
        return df
    start, version = time.monotonic(), df.version
    while time.monotonic() - start < wait:
        time.sleep(0.5)
        fresh = DraftFile.objects.get(pk=df.pk)
        if fresh.version != version:
            return fresh
    log.warning('ONLYOFFICE force save of draft %s did not arrive within %.0f s', df.session_id, wait)
    return DraftFile.objects.get(pk=df.pk)


# --- editor config (browser) ------------------------------------------------------------------

def _logo_url(dark=False):
    """PactPro's mark for the editor, served by this backend (the browser loads it)."""
    base = settings.AMS_PUBLIC_URL or settings.AMS_INTERNAL_URL
    return f'{base}/api/drafting/onlyoffice/logo.svg' + ('?dark=1' if dark else '')


# The sidebar's seal + wordmark (layout/Sidebar.tsx), sized for the editor header (about 172 x 40).
_LOGO = '''<svg xmlns="http://www.w3.org/2000/svg" width="172" height="40" viewBox="0 0 172 40">
<rect x="4" y="6" width="28" height="28" rx="5" fill="#A3232B"/>
<text x="18" y="27" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="19"
 font-weight="700" fill="#FFFFFF">P</text>
<text x="40" y="27" font-family="Georgia, 'Times New Roman', serif" font-size="20" font-weight="700"
 fill="{ink}">PactPro</text>
</svg>'''


class LogoView(APIView):
    """GET onlyoffice/logo.svg[?dark=1]: PactPro's mark for the editor header and loading screen."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        ink = '#E8EAEE' if request.query_params.get('dark') else '#1A1D24'
        resp = HttpResponse(_LOGO.replace('{ink}', ink), content_type='image/svg+xml')
        resp['Cache-Control'] = 'public, max-age=86400'
        return resp


def _branding():
    """PactPro's mark and name in the editor (header logo, About, loading screen). White label is a paid
    edition feature: the Community edition (what PactPro runs, docs/ONLYOFFICE_PLAN.md) must keep
    ONLYOFFICE's attribution under its AGPL terms and refuses it with a "Paid feature" warning, so it is
    sent only with ONLYOFFICE_WHITE_LABEL=True (a licensed Developer / Enterprise edition)."""
    if not settings.ONLYOFFICE_WHITE_LABEL:
        return {}
    return {
        'logo': {'image': _logo_url(), 'imageDark': _logo_url(dark=True), 'url': '', 'visible': True},
        'customer': {'name': 'PactPro', 'info': 'PactPro document editor', 'logo': _logo_url(),
                     'logoDark': _logo_url(dark=True), 'www': '', 'mail': '', 'address': ''},
        'loaderLogo': _logo_url(), 'loaderName': 'PactPro',
    }


def editor_role(session, user, desktop=True):
    """How this user works on the draft in the editor (docs/DRAFT_REVIEW.md, who decides):
    'decide'  edits directly and accepts / rejects tracked changes (drafting/access.can_write);
    'suggest' review-only: every edit is a tracked change for the author to decide (can_suggest);
    'view'    reads, nothing else.
    desktop=False: ignore a desktop lock (the desktop program's own save checks it itself)."""
    from .access import can_suggest, can_write
    if DraftFile.objects.filter(session=session, final_at__isnull=False).exists():
        return 'view'                                      # finalised: locked until reopened
    from documents.dav import desktop_lock
    if desktop and desktop_lock('draft', session.id, user.id):
        return 'view'                                      # open in Word / LibreOffice: read-only here
    if can_write(session, user):
        return 'decide'
    if can_suggest(session, user):
        return 'suggest'
    return 'view'


# Document permissions per role. Files leave only through AMS's own Download / Save to case
# (audited, on the case), never the editor's menu; no chat, no protection, no changing the clause markers.
_PERMISSIONS = {
    'decide': {'edit': True, 'review': True, 'comment': True, 'fillForms': True},
    'suggest': {'edit': False, 'review': True, 'comment': True, 'fillForms': False},
    'view': {'edit': False, 'review': False, 'comment': False, 'fillForms': False},
}


def editor_config(session, user, role=None):
    role = role or editor_role(session, user)
    df = ensure_file(session, user)
    from .export.views import export_filename
    base = settings.AMS_INTERNAL_URL
    token = _link_token(session.id)
    from documents.dav import work_of
    # This user's own unsaved-to-PactPro edits (an earlier session closed without Save): they go on with them.
    own_work = role != 'view' and work_of('draft', session.id, user.id) is not None
    name = (getattr(user, 'full_name', '') or '').strip()
    config = {
        'document': {
            'fileType': 'docx',
            'key': df.key,
            'title': export_filename(session),
            'url': f'{base}/api/drafting/onlyoffice/file/{session.id}/?t={token}' + ('&work=1' if own_work else ''),
            'permissions': {**_PERMISSIONS[role], 'download': False, 'print': False, 'chat': False,
                            'protect': False, 'copy': True, 'modifyContentControl': False},
        },
        'documentType': 'word',
        'editorConfig': {
            # Review-only ('suggest') is edit mode with edit: false + review: true.
            'mode': 'view' if role == 'view' else 'edit',
            'callbackUrl': f'{base}/api/drafting/onlyoffice/callback/{session.id}/?t={token}',
            'user': {'id': str(user.id), 'name': name or getattr(user, 'email', '') or f'User {user.id}'},
            'lang': 'en',
            # Fast: every change is kept as it is typed, so there is no Save button to press. (Strict mode
            # only keeps changes when the user presses Save; PactPro saves for them.)
            'coEditing': {'mode': 'fast', 'change': False},
            'plugins': {'autostart': [], 'pluginsData': []},
            'customization': {
                # The editor's own Save (toolbar, File > Save, Ctrl+S) can't be hidden on the Community edition
                # (customization.layout is a paid feature), so it does PactPro's save: force save, which the
                # callback stores as a new version (status 6), the same as the page's Save button (SaveView).
                'forcesave': True, 'autosave': True,
                'compactHeader': True, 'toolbarHideFileName': True, 'compactToolbar': False,
                'uiTheme': 'theme-classic-light',
                'plugins': False, 'macros': False, 'macrosMode': 'disable',
                # Comments for everyone who may change the draft (decide / suggest), as permissions.comment.
                'chat': False, 'comments': role != 'view', 'help': False, 'feedback': False,
                'goback': False, 'mentionShare': False, 'hideRightMenu': False,
                'features': {'spellcheck': {'mode': True, 'change': True}},
                **_branding(),
                # Only the tabs a lawyer drafting needs: Home, Insert, Layout, View (navigation).
                'layout': {
                    'toolbar': {
                        'file': {'close': False, 'info': False, 'save': False, 'settings': True},
                        # The Review tab (track changes, comments) for everyone who may change the draft.
                        'collaboration': role != 'view', 'plugins': False, 'protect': False, 'draw': False,
                        'references': False, 'view': {'navigation': True},
                    },
                    'header': {'users': False, 'editMode': False, 'save': False, 'user': False},
                    'leftMenu': {'navigation': True, 'spellcheck': True, 'mode': True},
                    'statusBar': {'actionStatus': True, 'docLang': False, 'textLang': False},
                },
            },
        },
    }
    config['token'] = _sign(config)
    return config


class EditorConfigView(APIView):
    """GET draft-sessions/<id>/onlyoffice/: {enabled, url, role, config} for the draft page. Same access
    as opening the draft; the role (editor_role) sets what the editor lets this user do."""

    def get(self, request, pk):
        if not enabled():
            return Response({'enabled': False})
        from .access import viewable_sessions
        session = get_object_or_404(viewable_sessions(request.user), pk=pk)
        if session.status != DraftSession.Status.READY:
            return Response({'enabled': False, 'reason': 'The draft is not ready yet.'})
        role = editor_role(session, request.user)
        config = editor_config(session, request.user, role)
        from documents.dav import desktop_lock, work_of
        return Response({'enabled': True, 'url': settings.ONLYOFFICE_URL, 'role': role, 'config': config,
                         'desktopLock': desktop_lock('draft', session.id, request.user.id),
                         'pendingWork': work_of('draft', session.id, request.user.id) is not None,
                         **final_state(session, request.user)})


class SaveView(APIView):
    """POST draft-sessions/<id>/onlyoffice/save/: the draft page's Save button. Asks the editor to save
    what is open now (force save) and returns the stored version. The editor itself has no Save
    button: PactPro's is the one save."""

    def post(self, request, pk):
        if not enabled():
            return Response({'error': 'The document editor is not switched on.'}, status=400)
        from .access import viewable_sessions
        session = get_object_or_404(viewable_sessions(request.user), pk=pk)
        if editor_role(session, request.user) == 'view':
            return Response({'error': 'You can view this draft but not change it.'}, status=403)
        if request.data.get('to') == 'work':
            # A copy for this computer only: what is open goes to the working copy, no version.
            from documents.dav import work_of
            df = DraftFile.objects.filter(session=session).first()
            if df is not None and df.editing:
                force_save(df, userdata='work')
            return Response({'work': work_of('draft', session.id, request.user.id) is not None})
        before = DraftFile.objects.filter(session=session).values_list('version', flat=True).first()
        df = save_to_pactpro(session, request.user)
        if df is None:
            return Response({'error': 'The draft has not been opened in the editor yet.'}, status=404)
        return Response({'version': df.version, 'saved': df.version != before})


class ApplyView(APIView):
    """POST draft-sessions/<id>/onlyoffice/apply/ {before, after} or {changes: [{before, after}, ...]}: Lisa's
    accepted changes, written into the Word file on the server as tracked changes by "PactPro AI" (the
    Community edition has no connector to do it in the open editor). Several changes (Lisa's "Apply all" on a
    whole-document refine) go in one pass: one version, one editor reload, no requests racing each other.
    Open edits are saved first; the response has the new editor config and how many were placed / skipped
    (a clause changed since Lisa read it), so the page reloads the editor with the redline."""

    def post(self, request, pk):
        if not enabled():
            return Response({'error': 'The document editor is not switched on.'}, status=400)
        from .access import viewable_sessions
        session = get_object_or_404(viewable_sessions(request.user), pk=pk)
        if editor_role(session, request.user) == 'view':
            return Response({'error': 'You can view this draft but not change it.'}, status=403)
        raw = request.data.get('changes')
        if not isinstance(raw, list):
            raw = [{'before': request.data.get('before'), 'after': request.data.get('after')}]
        changes = [(str(c.get('before') or ''), str(c.get('after') or '')) for c in raw if isinstance(c, dict)]
        changes = [(b, a) for b, a in changes if b.strip() and b != a]
        if not changes:
            return Response({'error': 'Nothing to change.'}, status=400)
        from .docfile import apply_tracked
        df = ensure_file(session, request.user)
        if df.editing:
            df = force_save(df)                            # keep what was typed before we change the file
        data, applied = _file_bytes(df), 0
        for before, after in changes:                      # one after another on the same file
            data, ok = apply_tracked(data, before, after)
            applied += ok
        if not applied:
            return Response({'error': "The clause has changed since Lisa read it, so the change can't be "
                                      'placed automatically. Copy the new text into the clause.'}, status=409)
        store_version(df, data, request.user.id)
        return Response({'config': editor_config(session, request.user), 'applied': applied,
                         'skipped': len(changes) - applied})


# --- version history and compare (the editor's own screens, docs/ONLYOFFICE_PLAN.md) ------------

def _version_key(row):
    """The document key a stored version opens with (rows from before keys were kept get a stable one)."""
    return row.key or f'pph{row.draft_file_id}v{row.version}{settings.ONLYOFFICE_JWT_SECRET[:4].encode().hex()}'


def _link(path, session_id):
    return f'{settings.AMS_INTERNAL_URL}/api/drafting/onlyoffice/{path}?t={_link_token(session_id)}'


def _history_session(request, pk):
    from .access import viewable_sessions
    session = get_object_or_404(viewable_sessions(request.user), pk=pk)
    df = get_object_or_404(DraftFile, session=session)
    return session, df


class HistoryView(APIView):
    """GET draft-sessions/<id>/onlyoffice/history/: the version list for the editor's History panel
    (refreshHistory). Everyone who may open the draft may look; only who decides may restore."""

    def get(self, request, pk):
        if not enabled():
            return Response({'error': 'The document editor is not switched on.'}, status=400)
        session, df = _history_session(request, pk)
        from core.models import Advocate
        rows = list(df.versions.order_by('version'))
        names = dict(Advocate.objects.filter(id__in={r.created_by_id for r in rows if r.created_by_id})
                     .values_list('id', 'full_name'))
        history = []
        for r in rows:
            item = {'version': r.version, 'key': _version_key(r),
                    'created': r.created_at.strftime('%Y-%m-%d %H:%M'),
                    'user': {'id': str(r.created_by_id or ''), 'name': names.get(r.created_by_id) or 'PactPro'}}
            if r.history.get('changes'):
                item['changes'] = r.history['changes']
            if r.history.get('serverVersion'):
                item['serverVersion'] = r.history['serverVersion']
            history.append(item)
        return Response({'currentVersion': df.version, 'history': history})


class HistoryDataView(APIView):
    """GET draft-sessions/<id>/onlyoffice/history/<version>/: one version for the History panel
    (setHistoryData), with the previous version and the changes zip when known, signed."""

    def get(self, request, pk, version):
        if not enabled():
            return Response({'error': 'The document editor is not switched on.'}, status=400)
        session, df = _history_session(request, pk)
        row = get_object_or_404(df.versions, version=version)
        data = {'version': row.version, 'key': _version_key(row), 'fileType': 'docx',
                'url': _link(f'version/{session.id}/{row.version}/', session.id)}
        prev = df.versions.filter(version__lt=row.version).order_by('-version').first()
        if prev is not None:
            data['previous'] = {'key': _version_key(prev), 'fileType': 'docx',
                                'url': _link(f'version/{session.id}/{prev.version}/', session.id)}
            if row.changes:
                data['changesUrl'] = _link(f'changes/{session.id}/{row.version}/', session.id)
        data['token'] = _sign(data)
        return Response(data)


class RestoreView(APIView):
    """POST draft-sessions/<id>/onlyoffice/restore/ {version}: that version becomes the current file, as a
    new version (nothing is lost; the one before stays in the history). Only who decides."""

    def post(self, request, pk):
        if not enabled():
            return Response({'error': 'The document editor is not switched on.'}, status=400)
        session, df = _history_session(request, pk)
        if editor_role(session, request.user) != 'decide':
            return Response({'error': 'Only the person who decides on this draft can restore a version.'},
                            status=403)
        row = get_object_or_404(df.versions, version=request.data.get('version'))
        if df.editing:
            df = force_save(df)                            # the version on screen is kept in the history
        with row.file.open('rb') as f:
            store_version(df, f.read(), request.user.id)
        return Response({'config': editor_config(session, request.user)})


class CompareSourceView(APIView):
    """POST draft-sessions/<id>/onlyoffice/compare/: the document the editor's Compare shows against the
    draft (setRequestedDocument), as tracked changes to accept or reject: either {version} (an earlier
    version of this draft) or an uploaded Word file `file` (a copy returned by the client or the other
    side; replaces the old Import changes)."""

    def post(self, request, pk):
        if not enabled():
            return Response({'error': 'The document editor is not switched on.'}, status=400)
        session, df = _history_session(request, pk)
        if editor_role(session, request.user) == 'view':
            return Response({'error': 'You can view this draft but not change it.'}, status=403)
        upload = request.FILES.get('file')
        if upload is not None:
            if not upload.name.lower().endswith('.docx'):
                return Response({'error': 'Choose a Word (.docx) file.'}, status=400)
            import uuid
            from django.core.files.storage import default_storage
            name = default_storage.save(f'drafts/word/compare/{session.id}/{uuid.uuid4().hex}.docx', upload)
            url = _link(f'compare/{session.id}/{name.rsplit("/", 1)[-1]}', session.id)
        else:
            row = get_object_or_404(df.versions, version=request.data.get('version'))
            url = _link(f'version/{session.id}/{row.version}/', session.id)
        data = {'c': 'compare', 'fileType': 'docx', 'url': url}
        data['token'] = _sign(data)
        return Response(data)


class _SignedFile(APIView):
    """Files the document server fetches for history / compare: no AMS login, the signed link instead."""
    authentication_classes = []
    permission_classes = [AllowAny]

    @staticmethod
    def _send(field_file, content_type, filename):
        with field_file.open('rb') as f:
            resp = HttpResponse(f.read(), content_type=content_type)
        resp['Content-Disposition'] = f'attachment; filename="{filename}"'
        return resp


class VersionFileView(_SignedFile):
    def get(self, request, pk, version):
        if not _link_session(request.query_params.get('t'), pk):
            return HttpResponse(status=404)
        row = DraftFileVersion.objects.filter(draft_file__session_id=pk, version=version).first()
        return self._send(row.file, DOCX_TYPE, f'draft-{pk}-v{version}.docx') if row else HttpResponse(status=404)


class ChangesFileView(_SignedFile):
    def get(self, request, pk, version):
        if not _link_session(request.query_params.get('t'), pk):
            return HttpResponse(status=404)
        row = DraftFileVersion.objects.filter(draft_file__session_id=pk, version=version).first()
        if not row or not row.changes:
            return HttpResponse(status=404)
        return self._send(row.changes, 'application/zip', f'changes-{pk}-v{version}.zip')


class CompareFileView(_SignedFile):
    def get(self, request, pk, name):
        import re as _re
        from django.core.files.storage import default_storage
        if not _link_session(request.query_params.get('t'), pk) or not _re.fullmatch(r'[0-9a-f]{32}\.docx', name):
            return HttpResponse(status=404)
        path = f'drafts/word/compare/{pk}/{name}'
        if not default_storage.exists(path):
            return HttpResponse(status=404)
        return self._send(default_storage.open(path), DOCX_TYPE, 'compare.docx')


# --- finalise / lock, PDF/A -------------------------------------------------------------------

def final_state(session, user):
    """{'final': {at, by} or None, 'canFinalise': bool} for the draft page."""
    from .access import can_write
    df = DraftFile.objects.filter(session=session).first()
    final = None
    if df is not None and df.final_at:
        from core.models import Advocate
        by = Advocate.objects.filter(id=df.final_by_id).values_list('full_name', flat=True).first()
        final = {'at': df.final_at.isoformat(), 'by': by or '', 'sha256': df.final_sha256}
    return {'final': final, 'canFinalise': can_write(session, user)}


class FinaliseView(APIView):
    """POST draft-sessions/<id>/onlyoffice/finalise/: lock the approved text. Only who decides; refused
    while tracked changes or comment threads are open in the document. Everyone then gets a read-only
    editor. DELETE: reopen it for editing (who decides)."""

    def _session(self, request, pk):
        from rest_framework.exceptions import PermissionDenied
        from .access import can_write, viewable_sessions
        session = get_object_or_404(viewable_sessions(request.user), pk=pk)
        if not can_write(session, request.user):
            raise PermissionDenied('Only the person who decides on this draft can finalise or reopen it.')
        return session, get_object_or_404(DraftFile, session=session)

    def post(self, request, pk):
        import hashlib

        from django.utils import timezone
        if not enabled():
            return Response({'error': 'The document editor is not switched on.'}, status=400)
        session, df = self._session(request, pk)
        if df.final_at:
            return Response({'error': 'This draft is already final.'}, status=409)
        blockers = file_review_blockers(session)           # saves what is open first
        if blockers:
            return Response({'error': ' '.join(blockers), 'blockers': blockers}, status=409)
        df.refresh_from_db()
        with df.file.open('rb') as f:
            digest = hashlib.sha256(f.read()).hexdigest()
        DraftFile.objects.filter(pk=df.pk).update(final_at=timezone.now(), final_by_id=request.user.id,
                                                  final_sha256=digest)
        from core.audit import record_system_action
        record_system_action(session.created_by_id, 'DRAFTING', 'UPDATE',
                             f'Draft {session.id} finalised (version {df.version}, sha256 {digest[:12]}…)',
                             entity_type='DRAFT', entity_id=session.id)
        return Response({'config': editor_config(session, request.user), **final_state(session, request.user)})

    def delete(self, request, pk):
        if not enabled():
            return Response({'error': 'The document editor is not switched on.'}, status=400)
        session, df = self._session(request, pk)
        DraftFile.objects.filter(pk=df.pk).update(final_at=None, final_by_id=None, final_sha256='')
        # A new key: editors open the document editable again, not the cached read-only one.
        DraftFile.objects.filter(pk=df.pk).update(key=_new_key(session.id, df.version))
        from core.audit import record_system_action
        record_system_action(session.created_by_id, 'DRAFTING', 'UPDATE', f'Draft {session.id} reopened for editing',
                             entity_type='DRAFT', entity_id=session.id)
        return Response({'config': editor_config(session, request.user), **final_state(session, request.user)})


def convert(df, outputtype):
    """The draft's current file converted by the document server ('pdf', 'pdfa'), as bytes."""
    import uuid
    url = f'{settings.AMS_INTERNAL_URL}/api/drafting/onlyoffice/file/{df.session_id}/?t={_link_token(df.session_id)}'
    payload = {'async': False, 'filetype': 'docx', 'outputtype': outputtype, 'key': uuid.uuid4().hex,
               'title': f'draft-{df.session_id}.docx', 'url': url}
    res = requests.post(f'{settings.ONLYOFFICE_INTERNAL_URL}/converter', json={**payload, 'token': _sign(payload)},
                        headers={'Accept': 'application/json'}, timeout=180).json()
    if res.get('error') or not res.get('fileUrl'):
        raise RuntimeError(f'conversion failed: {res}')
    return requests.get(res['fileUrl'], timeout=120).content


class PdfaView(APIView):
    """GET draft-sessions/<id>/onlyoffice/pdfa/: the draft as PDF/A (archival, for filing in court),
    converted by the document server. For a finalised draft it is exactly the locked file."""

    def get(self, request, pk):
        if not enabled():
            return Response({'error': 'The document editor is not switched on.'}, status=400)
        from .access import viewable_sessions
        session = get_object_or_404(viewable_sessions(request.user), pk=pk)
        df = get_object_or_404(DraftFile, session=session)
        if df.editing and not df.final_at:
            df = force_save(df)
        try:
            data = convert(df, 'pdfa')
        except (requests.RequestException, ValueError, RuntimeError) as exc:
            log.warning('PDF/A of draft %s failed: %s', pk, exc)
            return Response({'error': 'The PDF/A file could not be made. Try again in a moment.'}, status=503)
        from .export.views import export_filename
        resp = HttpResponse(data, content_type='application/pdf')
        resp['Content-Disposition'] = f'attachment; filename="{export_filename(session)[:-5]}_PDF-A.pdf"'
        return resp


# --- @mentions in comments ---------------------------------------------------------------------

def _people_on(session):
    """Who works on this draft (may open it): the author, the task's assigner, the requested reviewers."""
    from core.models import Advocate
    ids = {session.created_by_id}
    if session.ams_task_id:
        from workspace.models import CaseTask
        ids.add(CaseTask.objects.filter(id=session.ams_task_id).values_list('assigned_by_id', flat=True).first())
    ids |= set(session.review_requests.values_list('reviewer_id', flat=True))
    ids.discard(None)
    return Advocate.objects.filter(id__in=ids)


class MentionUsersView(APIView):
    """GET draft-sessions/<id>/onlyoffice/users/: the people the editor offers after "@" in a comment
    (setUsers): only those who can open this draft."""

    def get(self, request, pk):
        from .access import viewable_sessions
        session = get_object_or_404(viewable_sessions(request.user), pk=pk)
        return Response({'users': [{'id': str(a.id), 'name': a.full_name, 'email': a.email}
                                   for a in _people_on(session) if a.id != request.user.id]})


class MentionNotifyView(APIView):
    """POST draft-sessions/<id>/onlyoffice/notify/ {emails, message}: someone was @mentioned in a comment
    (onRequestSendNotify). Each mentioned person who can open the draft gets a PactPro notification."""

    def post(self, request, pk):
        from .access import viewable_sessions
        session = get_object_or_404(viewable_sessions(request.user), pk=pk)
        emails = {str(e).strip().lower() for e in (request.data.get('emails') or []) if e}
        message = str(request.data.get('message') or '').strip()[:1000]
        from notifications import service
        from .export.docx import session_title
        title = session_title(session) or f'Draft {session.id}'
        sent = 0
        for a in _people_on(session):
            if (a.email or '').lower() in emails and a.id != request.user.id:
                service.notify(a.id, 'DRAFT_COMMENT', f'{request.user.full_name} mentioned you on {title}',
                               f'{request.user.full_name} mentioned you in a comment on "{title}":\n\n{message}\n',
                               channels=(service.IN_APP,), recipient_name=a.full_name, recipient_email=a.email,
                               entity='DraftSession', entity_id=session.id, triggered_by='USER')
                sent += 1
        return Response({'notified': sent})


# --- placeholders (phase 2) -------------------------------------------------------------------

def _file_bytes(df):
    with df.file.open('rb') as f:
        return f.read()


class PlaceholdersView(APIView):
    """GET draft-sessions/<id>/onlyoffice/placeholders/: [{label, count}] still blank in the file.
    POST {label, value}: fill every [[label]] in the file (open edits are saved first), store it as a
    new version; the response has the new editor config, so the page reloads the editor."""

    def _session(self, request, pk, write=False):
        from rest_framework.exceptions import PermissionDenied
        from .access import can_write, viewable_sessions
        session = get_object_or_404(viewable_sessions(request.user), pk=pk)
        if write and not can_write(session, request.user):
            raise PermissionDenied('You can view this draft but not change it.')
        return session

    def get(self, request, pk):
        if not enabled():
            return Response({'placeholders': []})
        from .docfile import fields, placeholders
        df = DraftFile.objects.filter(session=self._session(request, pk)).first()
        if df is None:
            return Response({'placeholders': []})
        data = _file_bytes(df)
        # Form fields (new drafts: current value, changeable) first, then [[Label]] text blanks (older drafts).
        out = [{'label': k, 'count': v['count'], 'value': v['value'], 'kind': 'field'} for k, v in fields(data).items()]
        known = {x['label'] for x in out}
        out += [{**x, 'value': '', 'kind': 'text'} for x in placeholders(data) if x['label'] not in known]
        return Response({'placeholders': out})

    def post(self, request, pk):
        """{values: {label: value, ...}} (the panel's "Apply to document": every value typed so far, in one
        version and one editor reload), or a single {label, value}. Empty values are left blank."""
        if not enabled():
            return Response({'error': 'The document editor is not switched on.'}, status=400)
        session = self._session(request, pk, write=True)
        if editor_role(session, request.user) != 'decide':
            return Response({'error': 'This draft is final or read-only; reopen it to fill placeholders.'}, status=403)
        raw = request.data.get('values')
        if not isinstance(raw, dict):
            raw = {request.data.get('label'): request.data.get('value')}
        # A form field may be emptied again ('' shows its hint); a [[Label]] text blank needs a value.
        values = {str(k).strip(): str(v if v is not None else '').strip() for k, v in raw.items() if k}
        if not values:
            return Response({'error': 'Type at least one value first.'}, status=400)
        from .docfile import fill_fields, fill_placeholder
        df = ensure_file(session, request.user)
        if df.editing:
            df = force_save(df)                            # keep what was typed before we change the file
        from .docfile import fields as read_fields
        data = _file_bytes(df)
        current = read_fields(data)
        # A field already holding that value (an empty one left empty) is not a change.
        unchanged = {k for k, v in values.items() if k in current and current[k]['value'] == v}
        data, filled = fill_fields(data, {k: v for k, v in values.items() if k in current and k not in unchanged})
        missing = []
        for label, value in values.items():
            if label in filled or label in unchanged:
                continue
            n = 0
            if value:
                data, n = fill_placeholder(data, label, value)
            if n:
                filled[label] = n
            else:
                missing.append(label)
        if not filled and not missing:
            return Response({'error': 'Nothing changed: type a new value first.'}, status=400)
        if not filled:
            return Response({'error': 'Those blanks are no longer in the draft.', 'missing': missing}, status=404)
        store_version(df, data, request.user.id)
        return Response({'filled': sum(filled.values()), 'labels': filled, 'missing': missing,
                         'config': editor_config(session, request.user)})


# --- document server -> AMS -------------------------------------------------------------------
# No AMS login here (the document server has none): authentication_classes = [] makes them public API
# views, and each checks the signed link token for its draft; the callback also checks the server's JWT.

class FileView(APIView):
    """GET onlyoffice/file/<id>/?t=: the current file, for the document server."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request, pk):
        if not _link_session(request.query_params.get('t'), pk):
            return HttpResponse(status=404)
        df = DraftFile.objects.filter(session_id=pk).first()
        if df is None:
            return HttpResponse(status=404)
        from documents.dav import work_bytes, work_of
        work = work_of('draft', pk) if request.query_params.get('work') else None
        if work is not None:                               # reopening one's own unsaved-to-PactPro edits
            resp = HttpResponse(work_bytes(work), content_type=DOCX_TYPE)
            resp['Content-Disposition'] = f'attachment; filename="draft-{pk}.docx"'
            return resp
        with df.file.open('rb') as f:
            resp = HttpResponse(f.read(), content_type=DOCX_TYPE)
        resp['Content-Disposition'] = f'attachment; filename="draft-{pk}.docx"'
        return resp


def _callback_payload(request):
    """The callback body, checked against the server's JWT (Authorization header or body token)."""
    body = request.data if isinstance(request.data, dict) else {}
    auth = request.headers.get('Authorization', '')
    token = body.get('token') or (auth[7:] if auth.startswith('Bearer ') else '')
    if not token:
        return None
    try:
        data = jwt.decode(token, settings.ONLYOFFICE_JWT_SECRET, algorithms=['HS256'])
    except jwt.InvalidTokenError:
        return None
    return data.get('payload', data)                      # header tokens wrap the body in "payload"


class CallbackView(APIView):
    """POST onlyoffice/callback/<id>/?t=: the document server reports the document's state.
    1 editing, 2 ready to save (all editors closed), 3 save error, 4 closed without changes,
    6 force save, 7 force save error. Must answer {"error": 0} once handled."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request, pk):
        if not _link_session(request.query_params.get('t'), pk):
            return HttpResponse(status=404)
        data = _callback_payload(request)
        if data is None:
            return JsonResponse({'error': 1, 'message': 'invalid token'}, status=403)
        df = DraftFile.objects.filter(session_id=pk).first()
        if df is None:
            return JsonResponse({'error': 1, 'message': 'no such document'}, status=404)
        status = data.get('status')
        if data.get('key') and data['key'] != df.key:
            # A callback for an older version (the key changed since): nothing to do.
            return JsonResponse({'error': 0})
        users = data.get('users') or []
        user_id = int(users[0]) if users and str(users[0]).isdigit() else None
        if status in (2, 6) and df.final_at:
            # Finalised while an editor was still open: the locked text stays as approved.
            log.warning('ONLYOFFICE save of finalised draft %s ignored', pk)
            DraftFile.objects.filter(pk=df.pk).update(editing=False)
            return JsonResponse({'error': 0})
        if status == 1:
            DraftFile.objects.filter(pk=df.pk).update(editing=True)
        elif status in (2, 6):
            try:
                res = requests.get(data['url'], timeout=60)
                res.raise_for_status()
            except (requests.RequestException, KeyError) as exc:
                log.error('ONLYOFFICE save of draft %s: could not download the file: %s', pk, exc)
                return JsonResponse({'error': 1})
            changes = None
            if data.get('changesurl'):
                try:
                    got = requests.get(data['changesurl'], timeout=60)
                    changes = got.content if got.ok else None
                except requests.RequestException:
                    changes = None                         # history still works, without highlighting
            if not (status == 6 and data.get('userdata') == 'pactpro'):
                # Closing the editor, or its own Save / Ctrl+S: a working copy, not a version, until the user
                # saves to PactPro (docs/DESKTOP_EDITING.md).
                from core.models import Advocate
                from documents.dav import put_work
                from .export.views import export_filename
                user = Advocate.objects.filter(id=user_id).first() or \
                    Advocate.objects.filter(id=df.session.created_by_id).first()
                put_work('draft', df.session_id, user, export_filename(df.session), res.content)
                if status == 2:                            # the next open loads the working copy fresh
                    DraftFile.objects.filter(pk=df.pk).update(editing=False, key=_new_key(df.session_id, df.version))
                return JsonResponse({'error': 0})
            df = store_version(df, res.content, user_id, changes=changes, history=data.get('history'))
            from documents.dav import drop_work
            drop_work('draft', df.session_id)              # what was on screen includes the working copy
            if status == 2:
                DraftFile.objects.filter(pk=df.pk).update(editing=False)
            # The save comes from the document server, not a user request: the audit middleware
            # doesn't see it.
            from core.audit import record_system_action
            record_system_action(df.session.created_by_id, 'DRAFTING', 'UPDATE',
                                 f'Draft {pk} saved in the editor (Word file version {df.version})',
                                 entity_type='DRAFT', entity_id=pk, in_feed=False)
        elif status == 4:
            DraftFile.objects.filter(pk=df.pk).update(editing=False)
        elif status in (3, 7):
            log.error('ONLYOFFICE could not save draft %s (status %s)', pk, status)
        return JsonResponse({'error': 0})


class StateView(APIView):
    """GET draft-sessions/<id>/onlyoffice/state/: {version} of the stored Word file. The page polls it while
    there are unsaved edits, so its Save button turns to "Saved" when a save from the editor itself
    (its Save / Ctrl+S, or closing) has been stored."""

    def get(self, request, pk):
        from .access import viewable_sessions
        session = get_object_or_404(viewable_sessions(request.user), pk=pk)
        df = DraftFile.objects.filter(session=session).only('version', 'editing').first()
        # editing: the PactPro editor session is still open (a desktop editor waits for it to close).
        return Response({'version': df.version if df else 0, 'editing': bool(df and df.editing)})


# --- redline download (docs/ONLYOFFICE_PLAN.md) ------------------------------------------------------------

class RedlineView(APIView):
    """GET draft-sessions/<id>/onlyoffice/redline/?from=<version>[&to=<version>][&branding=1][&output=pdf]:
    what changed between two versions of the draft's Word file (or a version and the draft as it is on
    screen now, the default), as a Word file of tracked changes the other side can accept or reject, or a
    PDF. `from` defaults to the version before the latest.
    In the draft's own look: LibreOffice's Compare Document on the two Word files (export/libre_redline.py).
    If LibreOffice can't, the old editor's standard-layout redline (export/redline.py) fed with each version's
    clause text (docfile.file_blocks). The X-Redline-Layout header says which ('template' / 'standard')."""

    def get(self, request, pk):
        import datetime

        from core.models import Advocate

        from .access import viewable_sessions
        from .docfile import file_blocks
        from .export.redline import render_redline_docx
        from .export.views import branding_for, export_filename, file_response
        from .export.docx import session_title
        if 'DRAFT_EXPORT' not in request.user.permission_codes():
            return Response({'error': 'You may not download drafts.'}, status=403)
        session = get_object_or_404(viewable_sessions(request.user), pk=pk)
        df = DraftFile.objects.filter(session=session).first()
        if df is None:
            return Response({'error': 'This draft has no Word file yet.'}, status=404)
        versions = {v.version: v for v in df.versions.all()}

        def version_param(name):
            raw = request.query_params.get(name)
            if raw in (None, '', 'current'):
                return None
            try:
                return versions[int(raw)]
            except (ValueError, KeyError):
                raise LookupError(name)

        try:
            before = version_param('from') or versions.get(max(versions) - 1 if len(versions) > 1 else 0)
            after = version_param('to')
        except LookupError:
            return Response({'error': 'No such version of this draft.'}, status=404)
        if before is None:
            return Response({'error': 'Save the draft to PactPro at least twice to compare versions.'}, status=400)
        with before.file.open('rb') as f:
            before_data = f.read()
        if after is None:
            after_data, after_name = current_docx(session), 'current'   # what is on screen, no version made
        else:
            with after.file.open('rb') as f:
                after_data = f.read()
            after_name = f'v{after.version}'
        from .export.libre_redline import RedlineUnavailable, compare_docx
        try:
            data, stats = compare_docx(before_data, after_data, request.user.full_name or 'PactPro')
            layout = 'template'                            # the file's own look; its letterhead is already in it
        except RedlineUnavailable as exc:
            log.warning('Redline of draft %s in its own look failed, using the standard layout: %s', pk, exc)
            branding = branding_for(request.user) if request.query_params.get('branding') == '1' else None
            data, stats = render_redline_docx(file_blocks(session, before_data), file_blocks(session, after_data),
                                              title=session_title(session),
                                              author=request.user.full_name or 'PactPro', branding=branding)
            layout = 'standard'
        stem = export_filename(session).rsplit('_', 1)[0]
        resp = file_response(request, data, f'{stem}_redline_v{before.version}-{after_name}_'
                                            f'{datetime.date.today():%Y-%m-%d}.docx')
        if resp.status_code != 200:
            return resp
        resp['X-Redline-Inserted'], resp['X-Redline-Deleted'] = stats['inserted'], stats['deleted']
        resp['X-Redline-Layout'] = layout
        return resp
