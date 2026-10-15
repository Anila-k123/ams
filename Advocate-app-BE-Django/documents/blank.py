"""New documents nobody wrote in: removed instead of left behind (docs/DESKTOP_EDITING.md).

New Word / Excel / PowerPoint and a task's Write in editor create the document at once (the editor needs a
file to open), marked blank (DocumentEditState.blank). It stops being blank with its first saved version or
working copy. Closed while still blank (the PactPro editor closed unchanged, or the desktop program closed
without saving) it is removed, with its task link, so Documents and the task don't collect empty files; the
scheduler's daily sweep catches any left over (a crashed desktop program).
"""

import datetime
import logging

from django.utils import timezone

log = logging.getLogger(__name__)

SWEEP_AGE = datetime.timedelta(hours=24)


def mark_blank(doc):
    from .editor import _state
    state = _state(doc)
    state.blank = True
    state.save(update_fields=['blank'])


def is_abandoned(doc):
    """Still blank: never saved (version 1), no working copy, not open in an editor (PactPro or desktop),
    and not handed in on a task."""
    from workspace.models import TaskSubmission

    from .dav import _held, work_of
    from .models import DocumentEditState
    state = DocumentEditState.objects.filter(document_id=doc.id).first()
    if state is None or not state.blank or state.editing or (doc.version or 1) > 1:
        return False
    if work_of('doc', doc.id) is not None or _held('doc', doc.id) is not None:
        return False
    return not any(d.get('id') == doc.id
                   for docs in TaskSubmission.objects.exclude(documents=None).values_list('documents', flat=True)
                   for d in docs)


def remove_if_abandoned(doc_id):
    """Remove the document if it is still blank. Returns True when removed."""
    from core.models import Document

    from .views import remove_document
    doc = Document.objects.filter(id=doc_id).first()
    if doc is None or not is_abandoned(doc):
        return False
    log.info('Removing blank document %s (%s): closed without anything saved', doc.id, doc.original_name)
    remove_document(doc)
    return True


def sweep(older_than=SWEEP_AGE):
    """Remove blank documents left over (created more than `older_than` ago). Returns how many."""
    from .models import DocumentEditState
    cutoff = timezone.now() - older_than
    ids = DocumentEditState.objects.filter(blank=True, editing=False, updated_at__lt=cutoff) \
        .values_list('document_id', flat=True)
    return sum(remove_if_abandoned(doc_id) for doc_id in list(ids))
