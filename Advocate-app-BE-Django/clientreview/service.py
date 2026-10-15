"""Client review rules (docs/CLIENT_REVIEW.md): starting a review, rounds, the thread, notifications, the client's
copy in the editor, reminders. Views (views.py for the firm, client_views.py for the portal) call these."""

import datetime
import logging
import os
import secrets
import time

import jwt
import requests
from django.conf import settings
from django.core import signing
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from .reviewcopy import review_copy
from .models import ClientReview, ClientReviewFile, ClientReviewMessage, ClientReviewRound

log = logging.getLogger(__name__)

# Files a client (or the firm) may attach to the thread: marked-up Word / ODF files, PDFs, photos of notes.
ATTACH_EXTENSIONS = {'.docx', '.doc', '.odt', '.rtf', '.pdf', '.txt', '.jpg', '.jpeg', '.png', '.heic', '.webp',
                     '.xlsx', '.xls'}
ATTACH_MAX_MB = 25
REMIND_EVERY = datetime.timedelta(days=3)


class ReviewError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


# --- who ----------------------------------------------------------------------------------------------------

def client_of(doc):
    """The client a document belongs to: its own client, else its case's."""
    from core.models import Case, Client
    client_id = doc.client_id
    if not client_id and doc.case_id:
        client_id = Case.objects.filter(id=doc.case_id).values_list('client_id', flat=True).first()
    return Client.objects.filter(id=client_id).first() if client_id else None


def client_logins(client_id):
    from clientaccess.models import ClientUser
    return list(ClientUser.objects.filter(client_id=client_id).values_list('advocate_id', flat=True))


def _portal_link(review):
    return f"{settings.CLIENT_APP_URL.rstrip('/')}/client/reviews/{review.id}"


def _doc_name(doc):
    return doc.document_name or doc.original_name or f'Document {doc.id}'


def _stored_bytes(doc):
    from documents.storage import resolve_stored_file
    path = resolve_stored_file(doc.file_path, doc.stored_name)
    if path is None:
        raise ReviewError('The document file is missing.', 404)
    with open(path, 'rb') as f:
        return f.read()


# --- rounds -------------------------------------------------------------------------------------------------

def _new_round(review, doc, user):
    """Send the document's current version as the next round: a fresh review copy the client edits."""
    from documents.editor import force_save
    doc = force_save(doc)                        # what is open in the firm's editor now
    data, editable = review_copy(_stored_bytes(doc), doc.original_name or '')
    number = (review.rounds.order_by('-number').values_list('number', flat=True).first() or 0) + 1
    review.rounds.filter(status__in=(ClientReviewRound.SENT, ClientReviewRound.RETURNED)) \
        .update(status=ClientReviewRound.SUPERSEDED)
    rnd = ClientReviewRound(review=review, number=number, version=doc.version or 1, editable=editable,
                            file_name=doc.original_name or 'document', sent_by_id=user.id,
                            key=f'cr{review.id}r{number}{secrets.token_hex(6)}')
    rnd.file.save(f'review-{review.id}-r{number}{os.path.splitext(rnd.file_name)[1]}', ContentFile(data), save=False)
    rnd.save()
    return rnd


def start_review(doc, user, message='', questions=None, reply_by=None):
    client = client_of(doc)
    if client is None:
        raise ReviewError('Link this document to a client (or a case) first.')
    if not client_logins(client.id):
        raise ReviewError(f'{client.name or "This client"} has no portal login yet: create one on the client\'s page.')
    if ClientReview.objects.filter(document_id=doc.id, status=ClientReview.OPEN).exists():
        raise ReviewError('This document is already out for review with the client.', 409)
    questions = [str(q).strip() for q in (questions or []) if str(q).strip()][:20]
    with transaction.atomic():
        review = ClientReview.objects.create(document_id=doc.id, client_id=client.id, advocate_id=doc.advocate_id,
                                             created_by_id=user.id, message=(message or '').strip(),
                                             questions=questions, reply_by=reply_by)
        rnd = _new_round(review, doc, user)
        add_message(review, 'firm', user.id, user.full_name, (message or '').strip(), kind='sent',
                    round_number=rnd.number)
    _tell_client(review, doc, client, 'CLIENT_REVIEW_REQUEST',
                 f'{_firm_name(doc)} sent you "{_doc_name(doc)}" for review',
                 _request_body(review, doc, client, user, rnd))
    return review


def send_revised(review, doc, user, message=''):
    if review.status != ClientReview.OPEN:
        raise ReviewError('This review is closed.')
    with transaction.atomic():
        rnd = _new_round(review, doc, user)
        add_message(review, 'firm', user.id, user.full_name, (message or '').strip(), kind='sent',
                    round_number=rnd.number)
        ClientReview.objects.filter(id=review.id).update(last_reminded_at=None)
    client = client_of(doc)
    _tell_client(review, doc, client, 'CLIENT_REVIEW_REQUEST',
                 f'Revised: "{_doc_name(doc)}" (version {rnd.number}) for your review',
                 _request_body(review, doc, client, user, rnd, revised=True))
    return rnd


def cancel(review, user):
    if review.status != ClientReview.OPEN:
        raise ReviewError('This review is closed.')
    review.status = ClientReview.CANCELLED
    review.save(update_fields=['status', 'updated_at'])
    add_message(review, 'firm', user.id, user.full_name, '', kind='cancelled')


# --- the thread ---------------------------------------------------------------------------------------------

def add_message(review, author_kind, author_id, author_name, text, kind='message', round_number=None, files=()):
    for f in files:
        ext = os.path.splitext(f.name)[1].lower()
        if ext not in ATTACH_EXTENSIONS:
            raise ReviewError(f'{f.name}: this kind of file can\'t be attached.')
        if f.size > ATTACH_MAX_MB * 1024 * 1024:
            raise ReviewError(f'{f.name} is larger than {ATTACH_MAX_MB} MB.')
    msg = ClientReviewMessage.objects.create(review=review, author_kind=author_kind, author_id=author_id,
                                             author_name=author_name or '', kind=kind, text=text or '',
                                             round_number=round_number)
    for f in files:
        row = ClientReviewFile(message=msg, name=os.path.basename(f.name)[:255], size=f.size)
        row.file.save(f'r{review.id}-{secrets.token_hex(6)}{os.path.splitext(f.name)[1].lower()}', f, save=False)
        row.save()
    return msg


def firm_message(review, doc, user, text, files=()):
    if review.status == ClientReview.CANCELLED:
        raise ReviewError('This review was cancelled.')
    if not (text or '').strip() and not files:
        raise ReviewError('Write a message or attach a file.')
    msg = add_message(review, 'firm', user.id, user.full_name, text.strip(), files=files)
    _tell_client(review, doc, client_of(doc), 'CLIENT_REVIEW_MESSAGE',
                 f'New message about "{_doc_name(doc)}"',
                 f'{_greet(client_of(doc))}\n\n{user.full_name} wrote about "{_doc_name(doc)}":\n\n{text.strip()}\n\n'
                 f'Open it in your portal: {_portal_link(review)}\n\n{_sign_off(user)}')
    return msg


def client_reply(review, doc, client_user, action, note='', files=()):
    """The client: 'changes' (send back with changes), 'approve' (this version), or 'message'."""
    if review.status != ClientReview.OPEN:
        raise ReviewError('This review is closed.')
    rnd = review.current_round()
    name = _client_user_name(client_user)
    note = (note or '').strip()
    if action == 'message':
        if not note and not files:
            raise ReviewError('Write a message or attach a file.')
        add_message(review, 'client', client_user.id, name, note, files=files)
        _tell_firm(review, doc, rnd, 'CLIENT_REVIEW_REPLIED', f'{name} wrote about "{_doc_name(doc)}"', note)
        return
    if rnd is None or rnd.status != ClientReviewRound.SENT:
        raise ReviewError('There is no version waiting for your review.')
    if action == 'changes':
        save_copy_now(rnd)                       # what is open in the editor
        with transaction.atomic():
            rnd.status, rnd.returned_at = ClientReviewRound.RETURNED, timezone.now()
            rnd.save(update_fields=['status', 'returned_at'])
            add_message(review, 'client', client_user.id, name, note, kind='changes', round_number=rnd.number,
                        files=files)
        _tell_firm(review, doc, rnd, 'CLIENT_REVIEW_REPLIED', f'{name} sent changes to "{_doc_name(doc)}"',
                   note or 'They sent their changes back.')
        return
    if action == 'approve':
        with transaction.atomic():
            rnd.status, rnd.approved_at = ClientReviewRound.APPROVED, timezone.now()
            rnd.save(update_fields=['status', 'approved_at'])
            review.status, review.approved_version = ClientReview.APPROVED, rnd.version
            review.approved_at, review.approved_by_name = rnd.approved_at, name
            review.save(update_fields=['status', 'approved_version', 'approved_at', 'approved_by_name', 'updated_at'])
            add_message(review, 'client', client_user.id, name, note, kind='approved', round_number=rnd.number,
                        files=files)
        _tell_firm(review, doc, rnd, 'CLIENT_REVIEW_APPROVED',
                   f'{name} approved "{_doc_name(doc)}" (version {rnd.version})', note or 'Approved.')
        return
    raise ReviewError('Say send changes, approve or message.')


# --- notifications ------------------------------------------------------------------------------------------

def _firm_name(doc):
    from core.models import Advocate
    owner = Advocate.objects.filter(id=doc.advocate_id).first()
    return getattr(owner, 'firm_name', None) or getattr(owner, 'full_name', None) or 'Your advocate'


def _greet(client):
    return f'Dear {getattr(client, "name", None) or "Sir / Madam"},'


def _sign_off(user):
    return f'Regards,\n{getattr(user, "full_name", "") or "Your advocate"}'


def _client_user_name(client_user):
    return getattr(client_user, 'full_name', None) or getattr(client_user, 'email', None) or 'The client'


def _request_body(review, doc, client, user, rnd, revised=False):
    lines = [_greet(client), '']
    lines.append(f'{"A revised version of" if revised else "Please review"} "{_doc_name(doc)}"'
                 f'{" is ready for your review" if revised else ""}.')
    msg = ClientReviewMessage.objects.filter(review=review, kind='sent', round_number=rnd.number) \
        .values_list('text', flat=True).first()
    if msg:
        lines += ['', msg]
    if review.questions and not revised:
        lines += ['', 'Please also answer:'] + [f'  {n}. {q}' for n, q in enumerate(review.questions, 1)]
    if review.reply_by:
        lines += ['', f'Please reply by {review.reply_by:%d %b %Y}.']
    lines += ['', f'Open it in your portal: {_portal_link(review)}',
              'You can mark your changes in the document there, or download it, edit it and upload it back.',
              '', _sign_off(user)]
    return '\n'.join(lines)


def _tell_client(review, doc, client, event_type, subject, body):
    from notifications.service import notify_client
    notify_client(doc.advocate_id, client, event_type, subject, body, case_id=doc.case_id,
                  entity='Document', entity_id=doc.id, triggered_by='USER')


def _tell_firm(review, doc, rnd, event_type, subject, text):
    """The advocate who sent the round and the one who started the review: bell + email."""
    from core.models import Advocate
    from notifications.service import EMAIL, IN_APP, notify
    ids = {review.created_by_id, rnd.sent_by_id if rnd else None} - {None}
    for a in Advocate.objects.filter(id__in=ids):
        notify(a.id, event_type, subject, f'{subject}.\n\n{text}\n\nOpen the document in PactPro to see it.',
               channels=(IN_APP, EMAIL), case_id=doc.case_id, client_id=review.client_id,
               recipient_name=a.full_name, recipient_email=a.email, entity='Document', entity_id=doc.id,
               triggered_by='USER')


def send_reminders(now=None):
    """Remind clients whose round is waiting past the reply-by date (then every few days). Returns how many."""
    from core.models import Advocate, Document
    now = now or timezone.now()
    sent = 0
    for review in ClientReview.objects.filter(status=ClientReview.OPEN, reply_by__lte=now.date()):
        rnd = review.current_round()
        if rnd is None or rnd.status != ClientReviewRound.SENT:
            continue
        if review.last_reminded_at and now - review.last_reminded_at < REMIND_EVERY:
            continue
        doc = Document.objects.filter(id=review.document_id).first()
        if doc is None:
            continue
        client, user = client_of(doc), Advocate.objects.filter(id=rnd.sent_by_id).first()
        _tell_client(review, doc, client, 'CLIENT_REVIEW_REMINDER', f'Reminder: "{_doc_name(doc)}" is waiting for your review',
                     f'{_greet(client)}\n\nA gentle reminder: "{_doc_name(doc)}" is waiting for your review'
                     f'{f" (reply by {review.reply_by:%d %b %Y})" if review.reply_by else ""}.\n\n'
                     f'Open it in your portal: {_portal_link(review)}\n\n{_sign_off(user)}')
        ClientReview.objects.filter(id=review.id).update(last_reminded_at=now)
        sent += 1
    return sent


# --- the client's copy in the editor ------------------------------------------------------------------------

_SALT = 'clientreview.copy'
LINK_AGE = 24 * 3600


def _link(path, round_id):
    token = signing.dumps({'r': round_id}, salt=_SALT, compress=True)
    return f'{settings.AMS_INTERNAL_URL}/api/editor/clientcopy/{path}/{round_id}?t={token}'


def link_ok(token, round_id):
    try:
        return signing.loads(token or '', salt=_SALT, max_age=LINK_AGE).get('r') == round_id
    except signing.BadSignature:
        return False


def editor_config(rnd, client_user, client_name):
    """The ONLYOFFICE config for the client's copy: review mode (every edit a tracked change), comments on.
    Only while the round waits on the client; otherwise read-only."""
    from documents.editor import _sign
    from drafting.onlyoffice import _branding
    can_edit = rnd.status == ClientReviewRound.SENT and rnd.editable
    ext = os.path.splitext(rnd.file_name)[1].lower().lstrip('.') or 'docx'
    config = {
        'document': {
            'fileType': ext, 'key': rnd.key, 'title': rnd.file_name, 'url': _link('file', rnd.id),
            'permissions': {'edit': False, 'review': can_edit, 'comment': can_edit, 'download': True,
                            'print': True, 'chat': False, 'protect': False, 'copy': True},
        },
        'documentType': 'word' if ext in ('docx', 'doc', 'odt', 'rtf', 'txt') else
                        'cell' if ext in ('xlsx', 'xls', 'ods', 'csv') else
                        'slide' if ext in ('pptx', 'ppt', 'odp') else 'pdf',
        'editorConfig': {
            'mode': 'edit' if can_edit else 'view',
            'callbackUrl': _link('callback', rnd.id),
            'user': {'id': f'client-{client_user.id}', 'name': client_name},
            'lang': 'en',
            'coEditing': {'mode': 'fast', 'change': False},
            'plugins': {'autostart': [], 'pluginsData': []},
            'customization': {
                'forcesave': True, 'autosave': True, 'compactHeader': True, 'toolbarHideFileName': True,
                'uiTheme': 'theme-classic-light', 'plugins': False, 'macros': False, 'macrosMode': 'disable',
                'chat': False, 'comments': can_edit, 'help': False, 'feedback': False, 'goback': False,
                'mentionShare': False, 'review': {'trackChanges': True, 'hideReviewDisplay': False},
                **_branding(),
            },
        },
    }
    config['token'] = _sign(config)
    return config


def store_copy(rnd, data, rotate_key=False):
    """A save from the editor (the client's own, or closing): overwrite the copy. Ignored once sent back."""
    rnd = ClientReviewRound.objects.get(pk=rnd.pk)
    if rnd.status != ClientReviewRound.SENT:
        log.warning('Save of client review round %s ignored: it is %s', rnd.id, rnd.status)
        return rnd
    old = rnd.file.name
    rnd.file.save(f'review-{rnd.review_id}-r{rnd.number}-{secrets.token_hex(4)}{os.path.splitext(rnd.file_name)[1]}',
                  ContentFile(data), save=False)
    rnd.client_saved_at = timezone.now()
    fields = ['file', 'client_saved_at']
    if rotate_key:
        rnd.key = f'cr{rnd.review_id}r{rnd.number}{secrets.token_hex(6)}'
        rnd.editing = False
        fields += ['key', 'editing']
    rnd.save(update_fields=fields)
    if old and old != rnd.file.name:
        rnd.file.storage.delete(old)
    return rnd


def save_copy_now(rnd, wait=15.0):
    """Before the copy is sent back: ask the editor to save what is open (if it is open) and wait for it."""
    if not rnd.editing:
        return rnd
    body = {'c': 'forcesave', 'key': rnd.key}
    try:
        res = requests.post(f'{settings.ONLYOFFICE_INTERNAL_URL}/command',
                            json={**body, 'token': jwt.encode(body, settings.ONLYOFFICE_JWT_SECRET, algorithm='HS256')},
                            timeout=15).json()
    except (requests.RequestException, ValueError) as exc:
        log.warning('Force save of client review round %s failed: %s', rnd.id, exc)
        return rnd
    if res.get('error') != 0:                   # 4: nothing changed since the last save
        return rnd
    before, start = rnd.client_saved_at, time.monotonic()
    while time.monotonic() - start < wait:
        time.sleep(0.5)
        fresh = ClientReviewRound.objects.get(pk=rnd.pk)
        if fresh.client_saved_at != before:
            return fresh
    return ClientReviewRound.objects.get(pk=rnd.pk)


# --- what the pages show ------------------------------------------------------------------------------------

def review_json(review, for_client=False):
    rounds = list(review.rounds.all())
    current = rounds[-1] if rounds else None
    data = {
        'id': review.id, 'documentId': review.document_id, 'status': review.status, 'message': review.message,
        'questions': review.questions, 'replyBy': review.reply_by.isoformat() if review.reply_by else None,
        'createdAt': review.created_at.isoformat(),
        'approved': ({'version': review.approved_version, 'at': review.approved_at.isoformat(),
                      'by': review.approved_by_name} if review.approved_at else None),
        'rounds': [{'id': r.id, 'number': r.number, 'version': r.version, 'status': r.status, 'fileName': r.file_name,
                    'editable': r.editable, 'sentAt': r.sent_at.isoformat(),
                    'clientSavedAt': r.client_saved_at.isoformat() if r.client_saved_at else None,
                    'returnedAt': r.returned_at.isoformat() if r.returned_at else None,
                    'approvedAt': r.approved_at.isoformat() if r.approved_at else None} for r in rounds],
        'current': current.number if current else None,
        'waitingOn': ('client' if current and current.status == ClientReviewRound.SENT and review.status == ClientReview.OPEN
                      else 'firm' if review.status == ClientReview.OPEN else None),
        'messages': [{'id': m.id, 'author': m.author_kind, 'name': m.author_name, 'kind': m.kind, 'text': m.text,
                      'round': m.round_number, 'at': m.created_at.isoformat(),
                      'files': [{'id': f.id, 'name': f.name, 'size': f.size} for f in m.files.all()]}
                     for m in review.messages.prefetch_related('files')],
    }
    return data
