"""Request review, for drafts not started from a task (docs/DRAFT_REVIEW.md, situations 2-4).

GET  draft-sessions/<id>/reviewers/          colleagues who could review it, with what they could do
GET  draft-sessions/<id>/review-requests/    the draft's requests
POST draft-sessions/<id>/review-requests/    {reviewer, note}: the owner asks a colleague
POST review-requests/<id>/done/              the reviewer hands it back
POST review-requests/<id>/cancel/            the owner withdraws it
GET  drafts/for-review/                      drafts waiting for my review, with how far each has got
GET  drafts/review-status/                   my own drafts' review state, for the Drafts list

The reviewer's power is fixed when asked (authority.is_senior_over): their senior may correct the draft
directly and suggest (`binding`); anyone else only suggests. When a binding reviewer is done, their
direct corrections come back to the owner as a binding round (OK / Query), as in a task.
"""

from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Advocate
from core.permissions import RequirePermission
from core.practice import practice_ids

from .access import own_sessions
from .authority import is_senior_over
from .export.docx import session_title
from .models import DraftChangeDecision, DraftReviewRequest, DraftReviewRound, DraftVersion
from .versions import save_version

R = DraftReviewRequest


def _team(user):
    """Colleagues in the user's team (never another team or firm), not the user."""
    return Advocate.objects.filter(id__in=practice_ids(user)).exclude(id=user.id).order_by('full_name')


def _request_json(req, names):
    return {'id': req.id, 'session': req.session_id, 'reviewer_id': req.reviewer_id,
            'reviewer_name': names.get(req.reviewer_id), 'requested_by_id': req.requested_by_id,
            'requested_by_name': names.get(req.requested_by_id), 'note': req.note,
            'authority': req.authority, 'status': req.status,
            'created_at': req.created_at, 'closed_at': req.closed_at}


def _progress(req):
    """How far one request has got: suggestion rounds sent, still waiting for the owner, and the
    owner's decisions on the finished ones."""
    from collections import Counter
    rounds = req.rounds.exclude(status=DraftReviewRound.Status.CANCELLED)
    waiting = sum(1 for r in rounds if r.status == DraftReviewRound.Status.OPEN)
    counts = Counter(DraftChangeDecision.objects.filter(
        round__in=[r for r in rounds if r.status == DraftReviewRound.Status.FINISHED]).values_list('decision', flat=True))
    D = DraftChangeDecision.Decision
    return {'sent': len(rounds), 'waiting': waiting,
            'accepted': counts[D.ACCEPTED] + counts[D.ACKNOWLEDGED],
            'declined': counts[D.DECLINED] + counts[D.REJECTED], 'queried': counts[D.QUERIED],
            'decided_at': max((r.finished_at for r in rounds if r.finished_at), default=None)}


def _names(ids):
    return dict(Advocate.objects.filter(id__in=[i for i in ids if i]).values_list('id', 'full_name'))


def _notify(recipient_id, actor, session, event_type, subject, body):
    """In-app (and email when they opted in) to one colleague. Never raises."""
    try:
        from notifications import service
        recipient = Advocate.objects.filter(id=recipient_id).first()
        if recipient is None or recipient.id == actor.id:
            return
        channels = [service.IN_APP]
        if getattr(recipient, 'email_notifications_enabled', False):
            channels.append(service.EMAIL)
        service.notify(recipient.id, event_type, subject, body, channels=tuple(channels),
                       recipient_name=recipient.full_name, recipient_email=recipient.email,
                       entity='DraftSession', entity_id=session.id, triggered_by='USER')
    except Exception:   # noqa: BLE001 - a notification must never break the action
        pass


class ReviewersView(APIView):
    permission_classes = [RequirePermission('DRAFT_VIEW')]

    def get(self, request, pk):
        session = get_object_or_404(own_sessions(request.user), pk=pk)
        owner = request.user
        return Response([{'id': a.id, 'name': a.full_name or a.email,
                          'authority': R.Authority.BINDING if is_senior_over(a, owner) else R.Authority.SUGGEST}
                         for a in _team(owner) if a.id != session.created_by_id])


class ReviewRequestsView(APIView):
    def get_permissions(self):
        return [RequirePermission('DRAFT_VIEW' if self.request.method == 'GET' else 'DRAFT_CREATE')()]

    def get(self, request, pk):
        from .access import viewable_sessions
        session = get_object_or_404(viewable_sessions(request.user), pk=pk)
        reqs = list(session.review_requests.all())
        names = _names({r.reviewer_id for r in reqs} | {r.requested_by_id for r in reqs})
        return Response([_request_json(r, names) for r in reqs])

    def post(self, request, pk):
        session = get_object_or_404(own_sessions(request.user), pk=pk)
        if session.ams_task_id:
            return Response({'error': 'This draft belongs to a task: use Submit to task for its review.'}, status=400)
        try:
            reviewer_id = int(request.data.get('reviewer'))
        except (TypeError, ValueError):
            return Response({'error': 'Pick a colleague to review the draft.'}, status=400)
        reviewer = _team(request.user).filter(id=reviewer_id).first()
        if reviewer is None:
            return Response({'error': 'You can only ask a colleague in your team.'}, status=400)
        if session.review_requests.filter(reviewer_id=reviewer.id, status=R.Status.OPEN).exists():
            return Response({'error': f'{reviewer.full_name} is already reviewing this draft.'}, status=400)
        if not session.blocks.exists():
            return Response({'error': 'The draft is empty.'}, status=400)
        authority = R.Authority.BINDING if is_senior_over(reviewer, request.user) else R.Authority.SUGGEST
        note = (request.data.get('note') or '').strip()
        with transaction.atomic():
            req = R.objects.create(session=session, requested_by_id=request.user.id, reviewer_id=reviewer.id,
                                   note=note, authority=authority)
            # The fixed point a binding reviewer's direct corrections are compared against when done.
            save_version(session, DraftVersion.Kind.SENT, f'Sent for review to {reviewer.full_name}', request.user.id)
        title = session_title(session) or f'Draft {session.id}'
        power = 'You can correct it directly and suggest changes.\n' if authority == R.Authority.BINDING else ''
        _notify(reviewer.id, request.user, session, 'DRAFT_REVIEW_REQUESTED', f'Please review: {title}',
                f'{request.user.full_name} asked you to review the draft "{title}".\n{power}'
                + (f'\nNote: {note}\n' if note else ''))
        return Response(_request_json(req, _names({req.reviewer_id, req.requested_by_id})), status=201)


class ReviewRequestDoneView(APIView):
    permission_classes = [RequirePermission('DRAFT_VIEW')]

    def post(self, request, pk):
        from .review import create_changes_round
        req = get_object_or_404(R.objects.select_related('session'), pk=pk, reviewer_id=request.user.id)
        if req.status != R.Status.OPEN:
            return Response({'error': 'This review is already closed.'}, status=400)
        session = req.session
        with transaction.atomic():
            req.status, req.closed_at = R.Status.DONE, timezone.now()
            req.save(update_fields=['status', 'closed_at'])
            if req.authority == R.Authority.BINDING:
                # The version saved when the review was requested (just after the request row).
                sent = session.versions.filter(kind=DraftVersion.Kind.SENT,
                                               created_at__gte=req.created_at).order_by('number').first()
                if sent is not None:
                    create_changes_round(session, sent.blocks, author_id=request.user.id,
                                         decider_id=session.created_by_id, binding=True,
                                         note=(request.data.get('note') or '').strip(), review_request=req)
        title = session_title(session) or f'Draft {session.id}'
        _notify(session.created_by_id, request.user, session, 'DRAFT_REVIEW_DONE', f'Review done: {title}',
                f'{request.user.full_name} has finished reviewing "{title}". Open the draft to see the changes.')
        names = _names({req.reviewer_id, req.requested_by_id})
        return Response(_request_json(req, names))


class ReviewRequestCancelView(APIView):
    permission_classes = [RequirePermission('DRAFT_CREATE')]

    def post(self, request, pk):
        req = get_object_or_404(R.objects.select_related('session'), pk=pk, requested_by_id=request.user.id)
        if req.status != R.Status.OPEN:
            return Response({'error': 'This review is already closed.'}, status=400)
        with transaction.atomic():
            req.status, req.closed_at = R.Status.CANCELLED, timezone.now()
            req.save(update_fields=['status', 'closed_at'])
            # The reviewer loses access, so their pending suggestions go too.
            req.rounds.filter(status=DraftReviewRound.Status.OPEN).update(
                status=DraftReviewRound.Status.CANCELLED, finished_at=timezone.now())
        return Response(_request_json(req, _names({req.reviewer_id, req.requested_by_id})))


class ForMyReviewView(APIView):
    permission_classes = [RequirePermission('DRAFT_VIEW')]

    def get(self, request):
        reqs = list(R.objects.filter(reviewer_id=request.user.id, status=R.Status.OPEN).select_related('session'))
        names = _names({r.requested_by_id for r in reqs})
        out = []
        for r in reqs:
            item = _request_json(r, names)
            item['title'] = session_title(r.session) or f'Draft {r.session_id}'
            item['progress'] = _progress(r)
            out.append(item)
        return Response(out)


class MyReviewStatusView(APIView):
    """One line per own draft that is in or has been through a review, for the Drafts list:
    `to_decide` (suggestions or corrections waiting for me), `with_reviewer` (a request is open),
    or `reviewed` (the last request is done). Drafts never reviewed are left out."""
    permission_classes = [RequirePermission('DRAFT_VIEW')]

    def get(self, request):
        sessions = own_sessions(request.user).values_list('id', flat=True)
        to_decide = {}
        for rnd in DraftReviewRound.objects.filter(session_id__in=sessions, decider_id=request.user.id,
                                                   status=DraftReviewRound.Status.OPEN):
            # Changes from outside are named after who sent the file, not who uploaded it.
            to_decide.setdefault(rnd.session_id, set()).add(rnd.external_from or rnd.author_id)
        latest = {}
        for req in R.objects.filter(session_id__in=sessions).exclude(status=R.Status.CANCELLED).order_by('created_at'):
            if latest.get(req.session_id) is None or latest[req.session_id].status != R.Status.OPEN                     or req.status == R.Status.OPEN:
                latest[req.session_id] = req
        names = _names({r.reviewer_id for r in latest.values()}
                       | {a for s in to_decide.values() for a in s if isinstance(a, int)})
        out = {}
        for sid in set(latest) | set(to_decide):
            req = latest.get(sid)
            if sid in to_decide:
                who = (a if isinstance(a, str) else names.get(a) for a in to_decide[sid])
                out[sid] = {'state': 'to_decide', 'who': ', '.join(sorted(filter(None, who)))}
            elif req.status == R.Status.OPEN:
                out[sid] = {'state': 'with_reviewer', 'who': names.get(req.reviewer_id), 'at': req.created_at}
            else:
                out[sid] = {'state': 'reviewed', 'who': names.get(req.reviewer_id), 'at': req.closed_at}
        return Response(out)


__all__ = ['ReviewersView', 'ReviewRequestsView', 'ReviewRequestDoneView', 'ReviewRequestCancelView',
           'ForMyReviewView', 'MyReviewStatusView']
