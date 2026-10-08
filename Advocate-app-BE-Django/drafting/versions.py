"""Saved versions of a draft (DraftVersion): the fixed "before" a redline compares against."""

from django.db import transaction
from django.db.models import Max

from .models import DraftSession, DraftVersion


def snapshot_blocks(session):
    return [{
        'block_id': b.id, 'position': b.position, 'block_type': b.block_type,
        'heading': b.heading or '', 'text': b.text or '', 'content_html': b.content_html or '',
        'style_json': b.style_json or {},
    } for b in session.blocks.order_by('position')]


class NoVersion(Exception):
    """The draft has no saved version to compare against."""


def pick_pair(session, params):
    """(before, after) for a comparison, from ?from=<version id>&to=<version id>.

    `from` defaults to the last version sent to AMS / for review, else the latest; `to`
    omitted means the current draft (after is then None). A version id of another draft
    is a 404. Shared by the redline download and the on-screen compare view, so both
    pick the same defaults."""
    from django.shortcuts import get_object_or_404

    versions = session.versions.all()

    def pick(name):
        value = str(params.get(name) or '')
        return get_object_or_404(versions, pk=int(value)) if value.isdigit() else None

    before = pick('from') or (versions.filter(kind=DraftVersion.Kind.SENT).order_by('-number').first()
                              or versions.order_by('-number').first())
    if before is None:
        raise NoVersion
    return before, pick('to')


def save_version(session, kind=DraftVersion.Kind.MANUAL, label='', user_id=None):
    """Freeze the draft as it is now. Returns None for an empty draft."""
    blocks = snapshot_blocks(session)
    if not blocks:
        return None
    with transaction.atomic():
        # Lock the session row so two saves at once can't take the same number.
        DraftSession.objects.select_for_update().filter(id=session.id).first()
        last = session.versions.aggregate(n=Max('number'))['n'] or 0
        return DraftVersion.objects.create(
            session=session, number=last + 1, kind=kind, label=label[:255],
            blocks=blocks, created_by_id=user_id)
