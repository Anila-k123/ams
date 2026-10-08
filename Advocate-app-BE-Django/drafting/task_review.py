"""Review rounds inside a task's review loop (docs/DRAFT_REVIEW.md, situation 1: Option B).

The task's own states stay as they are (workspace/review.py: SUBMITTED -> APPROVED or
CHANGES_REQUESTED). This module adds the drafting side at three moments:

- **Request changes** (senior): the draft is frozen as a "Sent back for changes" version, and the
  senior's corrections since the junior's submission become a *binding* round for the junior
  (OK / Query only: corrections are never undone).
- **Submit to task** (junior): refused while the senior's *suggestions* still wait for the junior;
  the junior's open binding round is closed (queries stay recorded for the senior); after filing,
  everything the junior changed since "Sent back" becomes a Keep / Reject round for the senior.
- **Approve** (senior): refused while a round still waits for the senior's decisions, or while the
  senior's own suggestions are still undecided.

Drafts are linked to a task by DraftSession.ams_task_id.
"""

from .models import DraftReviewRound, DraftSession, DraftVersion
from .versions import save_version


def task_sessions(task):
    return DraftSession.objects.filter(ams_task_id=task.id)


def _open(session):
    return session.review_rounds.filter(status=DraftReviewRound.Status.OPEN)


def approve_blockers(task):
    """Why the task can't be approved yet ([] = it can)."""
    from .comments import unresolved
    out = []
    for session in task_sessions(task):
        n = unresolved(session).count()
        if n:
            out.append(f'Resolve the {n} open comment(s) on the draft first (Comments panel).')
        for rnd in _open(session).filter(binding=False):
            if rnd.decider_id == session.created_by_id:
                out.append('Your suggestions on the draft are still waiting for the author\'s decision.')
            else:
                out.append('Decide on every change in the draft\'s review before approving (Review on the draft).')
    return sorted(set(out))


def on_changes_requested(task, by, note=''):
    """Freeze the draft as sent back, and give the junior a binding round of the senior's corrections."""
    from .review import create_changes_round
    for session in task_sessions(task):
        submitted = (session.versions.filter(kind=DraftVersion.Kind.SENT).order_by('-number').first())
        returned = save_version(session, DraftVersion.Kind.RETURNED, 'Sent back for changes', by.id)
        if submitted is None or returned is None:
            continue
        create_changes_round(session, submitted.blocks, author_id=by.id, decider_id=session.created_by_id,
                             binding=True, note=note)


def submit_blocker(session):
    """Why the author can't (re)submit yet, or None."""
    waiting = _open(session).filter(kind=DraftReviewRound.Kind.SUGGESTIONS, binding=False,
                                    decider_id=session.created_by_id)
    if waiting.exists():
        return 'Accept or decline the suggestions on this draft first (Review on the draft), then submit.'
    return None


def before_submit(session, user):
    """Close the author's open binding rounds: their acknowledgements and queries are kept, and
    the corrections stay in the draft whether or not each one was acknowledged."""
    from .review import finish
    for rnd in _open(session).filter(binding=True, decider_id=user.id):
        finish(rnd, user)


def after_submit(session, task, user):
    """The junior's changes since the draft was sent back, for the task's reviewer to keep or reject."""
    from .review import create_changes_round
    returned = session.versions.filter(kind=DraftVersion.Kind.RETURNED).order_by('-number').first()
    reviewer_id = task.assigned_by_id
    if returned is None or not reviewer_id:
        return None
    # Only one changes round per resubmission: an older open one is replaced.
    _open(session).filter(kind=DraftReviewRound.Kind.CHANGES, binding=False, decider_id=reviewer_id) \
        .update(status=DraftReviewRound.Status.CANCELLED)
    return create_changes_round(session, returned.blocks, author_id=user.id, decider_id=reviewer_id)
