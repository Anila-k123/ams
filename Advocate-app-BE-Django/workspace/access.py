"""Which tasks a user may see.

A task belongs to the practice, but not everyone in it should see every task.
Whoever can hand out work (TASK_ASSIGN: seniors, the firm admin) sees the whole
team's tasks, as before. Everyone else - juniors, interns, the
accountant - sees only the tasks assigned to them or created by them.

Every task query that reaches a user goes through visible_tasks(), lists and
single-task lookups alike, so a hidden task cannot be opened or changed by id.
"""

from __future__ import annotations

from django.db.models import Q

from core.practice import practice_ids

from .models import CaseTask

SEES_ALL_TASKS = 'TASK_ASSIGN'


def sees_all_tasks(user):
    try:
        return SEES_ALL_TASKS in user.permission_codes()
    except Exception:                                        # noqa: BLE001
        return False


def visible_tasks(user, qs=None):
    """The practice's tasks this user may see, as a queryset."""
    qs = CaseTask.objects.all() if qs is None else qs
    qs = qs.filter(advocate_id__in=practice_ids(user))
    if sees_all_tasks(user):
        return qs
    return qs.filter(Q(assigned_to_id=user.id) | Q(advocate_id=user.id))
