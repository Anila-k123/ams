"""Document storage and versioning, shared by the AMS upload views and the
drafting filing (drafting/filing.py) so there is one copy of the file-on-disk logic.
"""

import datetime
import logging
import mimetypes
import os
import re
import uuid

from django.conf import settings
from django.db import transaction

from core.models import Document
from .models import DocumentVersion

log = logging.getLogger(__name__)


# Documents a practice actually keeps. Anything else (web pages, scripts,
# programs: .html, .svg, .js, .py, .exe ...) is refused before it is written,
# for new uploads and new versions alike. A browser can show an uploaded web
# page as a live page, so those are never stored.
ALLOWED_EXTENSIONS = {
    '.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt',          # documents
    '.xls', '.xlsx', '.ods', '.csv',                           # spreadsheets
    '.ppt', '.pptx', '.odp',                                   # presentations
    '.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic',  # scans and photos
    '.eml', '.msg',                                            # emails
    '.zip',                                                    # bundles
}
ALLOWED_LABEL = 'PDF, Word, Excel, PowerPoint, text, images (JPG, PNG, TIFF), emails (EML, MSG) or ZIP'


class UnsupportedFileType(ValueError):
    pass


def max_upload_bytes():
    return int(settings.DOCUMENT_MAX_UPLOAD_MB) * 1024 * 1024


def check_file_type(f):
    """Raise UnsupportedFileType unless the file's extension is an allowed one
    and it is within DOCUMENT_MAX_UPLOAD_MB. Django's *_MAX_MEMORY_SIZE settings
    only decide when an upload spills to a temp file; they cap nothing."""
    ext = os.path.splitext(getattr(f, 'name', '') or '')[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        what = f'{ext} files' if ext else 'Files without an extension'
        raise UnsupportedFileType(f"{what} can't be uploaded. Use {ALLOWED_LABEL}.")
    size = getattr(f, 'size', None)
    if size is not None and size > max_upload_bytes():
        raise UnsupportedFileType(
            f"This file is {size / 1048576:.1f} MB. Files can be at most "
            f"{settings.DOCUMENT_MAX_UPLOAD_MB} MB.")
    return ext


FILE_UNAVAILABLE = 'This file is not available on this server.'
_STORED_NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$')


def documents_root():
    """The one folder AMS document files may be read from or deleted in."""
    return os.path.realpath(os.path.join(settings.DOCUMENT_UPLOAD_DIR, 'documents'))


def _inside(path, root):
    try:
        return os.path.commonpath([path, root]) == root
    except ValueError:        # different drives on Windows
        return False


def resolve_stored_file(file_path, stored_name=None):
    """The real path of a document file, or None.

    The path stored in the database is NOT trusted: a row restored from a
    backup, or edited by hand, could point anywhere on the server (.env,
    another firm's files). Only files inside documents_root() are returned.

    Rows written on another machine keep that machine's absolute path; their
    file is found by its stored name inside documents_root() once copied there.
    """
    root = documents_root()
    if file_path:
        real = os.path.realpath(file_path)
        if _inside(real, root) and os.path.isfile(real):
            return real
    name = stored_name or (os.path.basename(file_path) if file_path else '')
    if name and _STORED_NAME.match(name):
        candidate = os.path.realpath(os.path.join(root, name))
        if _inside(candidate, root) and os.path.isfile(candidate):
            return candidate
    return None


def remove_stored_file(file_path, stored_name=None):
    """Delete a document file, only ever inside documents_root(). Never raises."""
    path = resolve_stored_file(file_path, stored_name)
    if path is None:
        return False
    try:
        os.remove(path)
        return True
    except OSError:
        log.warning('could not remove document file %s', os.path.basename(path))
        return False


def _safe_ext(name):
    """The extension only, lower-case, letters/digits - never a path piece."""
    ext = os.path.splitext(os.path.basename((name or '').replace('\\', '/')))[1].lower()
    return ext if ext[1:].isalnum() and len(ext) <= 10 else ''


def _write_file(f):
    """Save an uploaded file under DOCUMENT_UPLOAD_DIR/documents with a uuid name.

    Written to a .part file first and renamed when complete, so a failed or
    interrupted upload never leaves a half file under a real name; the .part
    is removed on failure."""
    stored_name = f"{uuid.uuid4()}{_safe_ext(f.name)}"
    docs_dir = os.path.join(settings.DOCUMENT_UPLOAD_DIR, 'documents')
    os.makedirs(docs_dir, exist_ok=True)
    abs_path = os.path.join(docs_dir, stored_name)
    part = abs_path + '.part'
    try:
        with open(part, 'wb') as out:
            for chunk in f.chunks():
                out.write(chunk)
        os.replace(part, abs_path)
    except Exception:
        _discard(part)
        raise
    # The type comes from the (allowed) extension, not from what the browser
    # claims, so a disguised file is never served back as something else.
    file_type = mimetypes.guess_type(f.name)[0] or 'application/octet-stream'
    return stored_name, abs_path, file_type


def _discard(path):
    """Remove a file this request wrote and no longer needs (never a stored one)."""
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except OSError:
        log.warning('could not remove temporary file %s', os.path.basename(path))


def _summarize(doc):
    # Background AI summary. Never let a summary failure break the upload itself.
    # on_commit: the summary thread uses its own connection, so inside a caller's
    # transaction it must wait until the document row is actually committed.
    # (Outside a transaction this runs immediately.)
    def run():
        try:
            from .summarizer import enqueue_and_run
            enqueue_and_run(doc)
        except Exception:
            log.exception('summary enqueue failed for doc %s', doc.id)
    transaction.on_commit(run)


def create_document(user, f, *, document_name=None, category=None, description=None,
                    case=None, client=None, external_ref=None):
    check_file_type(f)
    stored_name, abs_path, file_type = _write_file(f)
    now = datetime.datetime.now()
    try:
        with transaction.atomic():
            doc = _create_row(user, f, stored_name, abs_path, file_type, now, document_name,
                              category, description, case, client, external_ref)
    except Exception:
        # The row was not saved (validation, another firm's case, DB error):
        # the file just written belongs to nothing - remove it.
        _discard(abs_path)
        raise
    _summarize(doc)
    return doc


def _create_row(user, f, stored_name, abs_path, file_type, now, document_name, category,
                description, case, client, external_ref):
    return Document.objects.create(
        document_name=document_name or f.name,
        original_name=f.name,
        stored_name=stored_name,
        file_path=abs_path,
        file_size=f.size,
        file_type=file_type,
        category=category or None,
        description=description or None,
        version=1,
        download_count=0,
        status='ACTIVE',
        upload_date=now,
        updated_at=now,
        advocate_id=user.id,
        case=case,
        client=client,
        external_ref=external_ref,
    )


def add_version(doc, f, user, note=None):
    """Make `f` the current file of `doc`, keeping the previous file as a version."""
    check_file_type(f)
    stored_name, abs_path, file_type = _write_file(f)
    try:
        with transaction.atomic():
            # Lock the document so two uploads at once get versions n+1 and
            # n+2 instead of both claiming n+1.
            locked = Document.objects.select_for_update().get(id=doc.id)
            _version_rows(locked, f, user, note, stored_name, abs_path, file_type)
    except Exception:
        _discard(abs_path)
        raise
    # Callers keep using the object they passed in: bring it up to date.
    for field in Document._meta.concrete_fields:
        setattr(doc, field.attname, getattr(locked, field.attname))
    # 4) The old summary is stale — re-summarize the new file.
    _summarize(doc)
    return doc


def _version_rows(doc, f, user, note, stored_name, abs_path, file_type):
    # 1) Archive the CURRENT file as a past version (keeps its own note, if any).
    DocumentVersion.objects.get_or_create(
        document_id=doc.id, version=doc.version or 1,
        defaults={
            'stored_name': doc.stored_name,
            'file_path': doc.file_path,
            'file_size': doc.file_size,
            'file_type': doc.file_type,
            'original_name': doc.original_name,
            'uploaded_by_id': doc.advocate_id,
        })

    # 2) Point the document at the new file, bumping the version.
    doc.original_name = f.name
    doc.stored_name = stored_name
    doc.file_path = abs_path
    doc.file_size = f.size
    doc.file_type = file_type
    doc.version = (doc.version or 1) + 1
    doc.updated_at = datetime.datetime.now()
    doc.save()

    # 3) Record the NEW version (with the user's note) in the history.
    DocumentVersion.objects.update_or_create(
        document_id=doc.id, version=doc.version,
        defaults={
            'stored_name': doc.stored_name,
            'file_path': doc.file_path,
            'file_size': doc.file_size,
            'file_type': doc.file_type,
            'original_name': doc.original_name,
            'note': note,
            'uploaded_by_id': user.id,
        })
