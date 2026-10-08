"""Saved versions of a draft (DraftVersion): the fixed "before" a redline compares against."""

from django.db import transaction
from django.db.models import Max

from .models import DraftSession, DraftVersion


def block_rev(heading, content_html):
    """A clause's revision: changes whenever its heading or text does. A save names the revision
    it started from, so it never overwrites a clause someone else changed in between."""
    import hashlib
    return hashlib.sha1(f'{heading or ""}\x00{content_html or ""}'.encode('utf-8')).hexdigest()[:16]


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


class RestoreError(Exception):
    pass


def restore_version(session, version, user_id):
    """Put the draft back to a saved version. The draft as it was is saved first, so restoring
    can itself be undone. Clauses keep their ids where they still exist (comments and review
    rounds stay anchored); clauses added since are removed, removed ones come back."""
    from .models import DraftBlock
    if not version.blocks:
        raise RestoreError('That version is empty.')
    with transaction.atomic():
        DraftSession.objects.select_for_update().filter(id=session.id).first()
        save_version(session, DraftVersion.Kind.MANUAL, f'Before restoring v{version.number}', user_id)
        current = {b.id: b for b in session.blocks.all()}
        keep = set()
        for snap in version.blocks:
            fields = {'position': snap['position'], 'block_type': snap.get('block_type') or 'clause',
                      'heading': snap.get('heading') or '', 'text': snap.get('text') or '',
                      'content_html': snap.get('content_html') or '', 'style_json': snap.get('style_json') or {}}
            row = current.get(snap.get('block_id'))
            if row is None:
                row = DraftBlock.objects.create(session=session, source=DraftBlock.Source.GENERATED,
                                                is_edited=True, **fields)
            else:
                for k, v in fields.items():
                    setattr(row, k, v)
                row.is_edited = True
                row.save(update_fields=[*fields, 'is_edited'])
            keep.add(row.id)
        session.blocks.exclude(id__in=keep).delete()
        return save_version(session, DraftVersion.Kind.MANUAL, f'Restored v{version.number}', user_id)


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
