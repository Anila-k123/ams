"""Comments on a draft's passages: questions and answers instead of optional suggestions
(docs/DRAFT_REVIEW.md, comments).

GET    draft-sessions/<id>/comments/   threads, oldest first, with a summary
POST   draft-sessions/<id>/comments/   {block_id, quote, body}: start a thread
POST   comments/<id>/reply/            {body}
POST   comments/<id>/resolve/ · reopen/
DELETE comments/<id>/                  the author removes their own comment while nobody has replied

Anyone who may see the draft may comment and reply (drafting/access.py). Resolving follows authority
(drafting/authority.py): the person who asked, or someone senior over the draft's author, or the author
when the question came from a peer or a junior. In a task, Approve waits until every thread is resolved
(task_review.approve_blockers).
"""

from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Advocate
from core.permissions import RequirePermission

from .access import viewable_sessions
from .authority import is_senior_over
from .models import DraftComment


def can_resolve(comment, user):
    owner = comment.session.created_by_id
    if user.id == comment.author_id or is_senior_over(user, owner):
        return True
    # The author settles questions from people without authority over them (peers, juniors).
    return user.id == owner and not is_senior_over(Advocate.objects.get(id=comment.author_id), owner)


def _names(ids):
    return dict(Advocate.objects.filter(id__in=[i for i in ids if i]).values_list('id', 'full_name'))


def _json(c, user, names):
    replies = list(c.replies.all())
    return {
        'id': c.id, 'block_id': c.block_id, 'quote': c.quote, 'body': c.body,
        'author_id': c.author_id, 'author_name': names.get(c.author_id), 'created_at': c.created_at,
        'resolved': c.resolved_at is not None, 'resolved_by_name': names.get(c.resolved_by_id),
        'resolved_at': c.resolved_at,
        'can_resolve': can_resolve(c, user), 'can_delete': c.author_id == user.id and not replies,
        'replies': [{'id': r.id, 'body': r.body, 'author_id': r.author_id, 'author_name': names.get(r.author_id),
                     'created_at': r.created_at, 'can_delete': r.author_id == user.id} for r in replies],
    }


def threads_json(session, user):
    threads = list(session.comments.filter(parent__isnull=True).prefetch_related('replies'))
    ids = {t.author_id for t in threads} | {t.resolved_by_id for t in threads}
    ids |= {r.author_id for t in threads for r in t.replies.all()}
    names = _names(ids)
    out = [_json(t, user, names) for t in threads]
    open_ = [t for t in out if not t['resolved']]
    return {'threads': out, 'open': len(open_),
            # "Answered" = someone other than the asker has replied.
            'answered': sum(1 for t in open_ if any(r['author_id'] != t['author_id'] for r in t['replies']))}


def unresolved(session):
    return session.comments.filter(parent__isnull=True, resolved_at__isnull=True)


def _notify(comment, actor, text):
    """Tell the people in the conversation (and the draft's author / the task's reviewer). Never raises."""
    try:
        from notifications import service
        from .export.docx import session_title
        session = comment.session
        thread = comment.parent or comment
        people = {session.created_by_id, thread.author_id} | set(thread.replies.values_list('author_id', flat=True))
        if session.ams_task_id:
            from workspace.models import CaseTask
            people.add(CaseTask.objects.filter(id=session.ams_task_id).values_list('assigned_by_id', flat=True).first())
        people.discard(actor.id)
        people.discard(None)
        title = session_title(session) or f'Draft {session.id}'
        for rec in Advocate.objects.filter(id__in=people):
            service.notify(rec.id, 'DRAFT_COMMENT', f'Comment on {title}',
                           f'{actor.full_name} {text} on "{title}":\n\n{comment.body}\n'
                           + (f'\nOn: "{thread.quote[:200]}"\n' if thread.quote else ''),
                           channels=(service.IN_APP,), recipient_name=rec.full_name, recipient_email=rec.email,
                           entity='DraftSession', entity_id=session.id, triggered_by='USER')
    except Exception:   # noqa: BLE001 - a notification must never break the action
        pass


def _comment(request, pk):
    return get_object_or_404(DraftComment.objects.filter(session__in=viewable_sessions(request.user))
                             .select_related('session'), pk=pk)


class CommentsView(APIView):
    def get_permissions(self):
        return [RequirePermission('DRAFT_VIEW')()]

    def get(self, request, pk):
        session = get_object_or_404(viewable_sessions(request.user), pk=pk)
        return Response(threads_json(session, request.user))

    def post(self, request, pk):
        session = get_object_or_404(viewable_sessions(request.user), pk=pk)
        body = (request.data.get('body') or '').strip()
        if not body:
            return Response({'error': 'Write the comment first.'}, status=400)
        block_id = request.data.get('block_id')
        if block_id is not None and not session.blocks.filter(id=block_id).exists():
            return Response({'error': 'That passage is not in this draft.'}, status=400)
        c = DraftComment.objects.create(session=session, block_id=block_id, body=body, author_id=request.user.id,
                                        quote=(request.data.get('quote') or '').strip()[:2000])
        _notify(c, request.user, 'commented')
        return Response(threads_json(session, request.user), status=201)


class CommentReplyView(APIView):
    permission_classes = [RequirePermission('DRAFT_VIEW')]

    def post(self, request, pk):
        thread = _comment(request, pk)
        if thread.parent_id:
            thread = thread.parent
        body = (request.data.get('body') or '').strip()
        if not body:
            return Response({'error': 'Write the reply first.'}, status=400)
        reply = DraftComment.objects.create(session=thread.session, parent=thread, body=body,
                                            author_id=request.user.id, block_id=thread.block_id)
        _notify(reply, request.user, 'replied')
        return Response(threads_json(thread.session, request.user), status=201)


class CommentResolveView(APIView):
    permission_classes = [RequirePermission('DRAFT_VIEW')]
    reopen = False

    def post(self, request, pk):
        c = _comment(request, pk)
        if c.parent_id:
            return Response({'error': 'Resolve the conversation, not a reply.'}, status=400)
        if not can_resolve(c, request.user):
            return Response({'error': 'Only the person who asked, or someone with authority over this draft, '
                                      'can resolve it.'}, status=403)
        c.resolved_at, c.resolved_by_id = (None, None) if self.reopen else (timezone.now(), request.user.id)
        c.save(update_fields=['resolved_at', 'resolved_by_id'])
        return Response(threads_json(c.session, request.user))


class CommentDeleteView(APIView):
    permission_classes = [RequirePermission('DRAFT_VIEW')]

    def delete(self, request, pk):
        c = _comment(request, pk)
        if c.author_id != request.user.id:
            return Response({'error': 'You can only remove your own comment.'}, status=403)
        if c.parent_id is None and c.replies.exists():
            return Response({'error': 'Someone has replied; resolve it instead.'}, status=400)
        session = c.session
        c.delete()
        return Response(threads_json(session, request.user))
