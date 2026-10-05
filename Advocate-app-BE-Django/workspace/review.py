"""Senior review of delegated tasks.

A task assigned by one advocate to another (senior -> junior/intern) is not
finished when the assignee says so: the assignee SUBMITS it (by filing a draft
from InstaDraft, attaching a document, or ticking it done), and the assigner, or
anyone else in the practice holding TASK_ASSIGN, reviews it:

    SUBMITTED --approve--------> APPROVED           (task completed; its documents marked APPROVED)
              --request changes-> CHANGES_REQUESTED  (task stays open; assignee resubmits)

Self-assigned tasks (no separate assigner) never need review and behave as before.
"""

import logging

from django.utils import timezone

from core.models import Advocate, Case, Document

log = logging.getLogger(__name__)

SUBMITTED = 'SUBMITTED'
APPROVED = 'APPROVED'
CHANGES_REQUESTED = 'CHANGES_REQUESTED'


def needs_review(task):
    return bool(task.assigned_by_id and task.assigned_to_id
                and task.assigned_by_id != task.assigned_to_id)


def is_assignee(task, user):
    return (task.assigned_to_id or task.advocate_id) == user.id


def can_review(task, user):
    """The assigner, or another practice member with TASK_ASSIGN; never the assignee.
    (Callers have already scoped the task to the user's practice.)"""
    if not needs_review(task) or is_assignee(task, user):
        return False
    if task.assigned_by_id == user.id:
        return True
    perms = getattr(user, '_advocate_permissions', None)
    if perms is None:
        perms = user.permission_codes()
    return 'TASK_ASSIGN' in perms


def _norm(s):
    return ' '.join((s or '').split())


def compare_drafts(prev, cur):
    """What changed between two draft snapshots ([{heading, text}] each).

    Returns [{heading, kind, before, after}] for changed sections only, in the
    new draft's order (removed sections last), or None when there's nothing to
    compare against (a first submission). Sections are paired by heading
    (case- and space-insensitive), then by position for any left over, so a
    reordered or renamed-by-one-word draft still lines up sensibly.
    """
    if prev is None or cur is None:
        return None
    key = lambda b: _norm(b.get('heading')).lower()
    unmatched_prev = list(range(len(prev)))
    pairs = []
    for i, block in enumerate(cur):
        j = next((j for j in unmatched_prev if key(prev[j]) and key(prev[j]) == key(block)), None)
        pairs.append([i, j])
        if j is not None:
            unmatched_prev.remove(j)
    # Leftovers pair by position: an untitled or re-headed section is still "the same" one.
    for pair in pairs:
        if pair[1] is None and unmatched_prev:
            pair[1] = unmatched_prev.pop(0)

    changes = []
    for i, j in pairs:
        after = cur[i]
        if j is None:
            changes.append({'heading': after.get('heading') or '', 'kind': 'added',
                            'before': '', 'after': after.get('text') or ''})
            continue
        before = prev[j]
        if _norm(before.get('text')) != _norm(after.get('text')) or key(before) != key(after):
            changes.append({'heading': after.get('heading') or before.get('heading') or '',
                            'kind': 'edited', 'before': before.get('text') or '',
                            'after': after.get('text') or ''})
    for j in unmatched_prev:
        changes.append({'heading': prev[j].get('heading') or '', 'kind': 'removed',
                        'before': prev[j].get('text') or '', 'after': ''})
    return changes


def previous_snapshot(task):
    """The draft as last submitted on this task, or None."""
    from .models import TaskSubmission
    return (TaskSubmission.objects.filter(task_id=task.id, draft_snapshot__isnull=False)
            .values_list('draft_snapshot', flat=True).first())


def submit(task, by, note='', hours=None, draft_snapshot=None, changes=None):
    """Mark a delegated task as submitted for review, with the assignee's report.

    No-op for self-assigned tasks, for someone other than the assignee, and for
    approved tasks. Every submission is kept (TaskSubmission), so resubmitting
    after changes were requested adds a round rather than replacing the last.
    A draft submission also stores its snapshot and what changed since the
    previous one (see compare_drafts).
    """
    if not needs_review(task) or not is_assignee(task, by) or task.review_status == APPROVED:
        return False
    from .models import TaskSubmission
    TaskSubmission.objects.create(task_id=task.id, submitted_by_id=by.id,
                                  note=(note or '').strip(), hours=hours,
                                  draft_snapshot=draft_snapshot, changes=changes)
    task.review_status = SUBMITTED
    task.submitted_at = timezone.now()
    task.save(update_fields=['review_status', 'submitted_at'])
    _notify(task.assigned_by_id, task, by, 'TASK_SUBMITTED', 'Submitted for review: {}',
            '{} has submitted this task for your review.')
    return True


def approve(task, by, note=None):
    task.review_status = APPROVED
    task.review_note = note or None
    task.reviewed_by_id, task.reviewed_at = by.id, timezone.now()
    task.completed = True
    task.save(update_fields=['review_status', 'review_note', 'reviewed_by_id', 'reviewed_at', 'completed'])
    from .models import CaseTaskDocument
    doc_ids = CaseTaskDocument.objects.filter(task_id=task.id).values_list('document_id', flat=True)
    Document.objects.filter(id__in=list(doc_ids)).update(status='APPROVED')
    _notify(task.assigned_to_id, task, by, 'TASK_APPROVED', 'Approved: {}', '{} has approved this task.')


def request_changes(task, by, note):
    task.review_status = CHANGES_REQUESTED
    task.review_note = note
    task.reviewed_by_id, task.reviewed_at = by.id, timezone.now()
    task.completed = False
    task.save(update_fields=['review_status', 'review_note', 'reviewed_by_id', 'reviewed_at', 'completed'])
    _notify(task.assigned_to_id, task, by, 'TASK_CHANGES_REQUESTED', 'Changes requested: {}',
            '{} has asked for changes to this task.')


def _notify(recipient_id, task, actor, event_type, subject, lead):
    """In-app (and email, if they opted in) to one advocate. Never raises."""
    if not recipient_id or recipient_id == actor.id:
        return
    try:
        from notifications import service
        recipient = Advocate.objects.filter(id=recipient_id).first()
        if recipient is None:
            return
        case = Case.objects.filter(id=task.case_id).only('case_number').first() if task.case_id else None
        report = ''
        if event_type == 'TASK_SUBMITTED':
            from .models import TaskSubmission
            last = TaskSubmission.objects.filter(task_id=task.id).first()
            if last and last.note:
                report = f'\nReport:\n{last.note}\n'
            if last and last.hours:
                report += f'Hours: {last.hours}\n'
        body = (lead.format(actor.full_name or 'A colleague') + '\n\n'
                f'Task : {task.title}\n'
                f'Case : {case.case_number if case else "not linked"}\n'
                + (f'Note : {task.review_note}\n' if task.review_note and event_type != 'TASK_SUBMITTED' else '')
                + report)
        channels = [service.IN_APP]
        if getattr(recipient, 'email_notifications_enabled', False):
            channels.append(service.EMAIL)
        ids = service.notify(recipient.id, event_type, subject.format(task.title), body,
                             channels=tuple(channels), recipient_name=recipient.full_name,
                             recipient_email=recipient.email, entity='CaseTask', entity_id=task.id,
                             case_id=task.case_id, triggered_by='USER')
        service.send_now(ids)
    except Exception:
        log.exception('%s notify failed for task %s', event_type, task.id)
