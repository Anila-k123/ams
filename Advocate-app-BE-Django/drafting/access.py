"""Who may see which drafting records, in AMS terms.

request.user is the AMS Advocate (core.auth.AdvocateJWTAuthentication). Drafting
rows point at advocates by plain id (uploaded_by_id / created_by_id), the AMS
convention for tables that reference the Spring-owned schema.

Merge phase 2: reference documents are shared across the advocate's practice (the
same rule AMS uses for its own documents). Draft sessions stay private to their
creator for now. Merge phase 3 revisits both together with the drafting RBAC codes.
"""

from core.practice import practice_ids

from .models import DraftSession, Sample


def visible_samples(user):
    return Sample.objects.filter(uploaded_by_id__in=practice_ids(user))


def own_sessions(user):
    return DraftSession.objects.filter(created_by_id=user.id)


# Senior review of delegated drafts. A junior's draft filed on a task
# (session.ams_task_id) can be opened by whoever may review that task
# (workspace/review.py::can_review): the assigner, or a practice member with
# TASK_ASSIGN, never the assignee. Only once it has been submitted: before that it
# is still the junior's working draft.
REVIEW_STATES = ('SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED')


def reviewable_task_ids(user):
    from workspace import review
    from workspace.models import CaseTask
    tasks = CaseTask.objects.filter(advocate_id__in=practice_ids(user), review_status__in=REVIEW_STATES)
    return [t.id for t in tasks if review.can_review(t, user)]


def reviewable_sessions(user):
    return DraftSession.objects.filter(ams_task_id__in=reviewable_task_ids(user)).exclude(created_by_id=user.id)


def viewable_sessions(user):
    """The advocate's own drafts, plus drafts submitted to them for review."""
    return own_sessions(user) | reviewable_sessions(user)


def review_task(session, user):
    """(task, can_review) for this session's task, or (None, False)."""
    if not session.ams_task_id:
        return None, False
    from workspace import review
    from workspace.models import CaseTask
    task = CaseTask.objects.filter(id=session.ams_task_id, advocate_id__in=practice_ids(user)).first()
    return task, bool(task and review.can_review(task, user))


def can_write(session, user):
    """Owner always; a reviewer only while the task awaits their review."""
    if session.created_by_id == user.id:
        return True
    task, reviewer = review_task(session, user)
    return reviewer and task.review_status == 'SUBMITTED'
