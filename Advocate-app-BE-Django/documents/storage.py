"""Document storage and versioning, shared by the AMS upload views and the
drafting filing (drafting/filing.py) so there is one copy of the file-on-disk logic.
"""

import datetime
import logging
import mimetypes
import os
import uuid

from django.conf import settings
from django.db import transaction

from core.models import Document
from .models import DocumentVersion

log = logging.getLogger(__name__)


def _write_file(f):
    """Save an uploaded file under DOCUMENT_UPLOAD_DIR/documents with a uuid name."""
    ext = os.path.splitext(f.name)[1]
    stored_name = f"{uuid.uuid4()}{ext}"
    docs_dir = os.path.join(settings.DOCUMENT_UPLOAD_DIR, 'documents')
    os.makedirs(docs_dir, exist_ok=True)
    abs_path = os.path.join(docs_dir, stored_name)
    with open(abs_path, 'wb') as out:
        for chunk in f.chunks():
            out.write(chunk)
    file_type = f.content_type or mimetypes.guess_type(f.name)[0] or 'application/octet-stream'
    return stored_name, abs_path, file_type


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
    stored_name, abs_path, file_type = _write_file(f)
    now = datetime.datetime.now()
    doc = Document.objects.create(
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
    _summarize(doc)
    return doc


def add_version(doc, f, user, note=None):
    """Make `f` the current file of `doc`, keeping the previous file as a version."""
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

    # 2) Write the new file and point the document at it, bumping the version.
    stored_name, abs_path, file_type = _write_file(f)
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

    # 4) The old summary is stale — re-summarize the new file.
    _summarize(doc)
    return doc
