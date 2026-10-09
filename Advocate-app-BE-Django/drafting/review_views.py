"""Review rounds API: suggestions and accept / reject (docs/DRAFT_REVIEW.md).

POST draft-sessions/<id>/suggest/        a reviewer's edits, saved as suggestions for the owner
GET  draft-sessions/<id>/rounds/         the draft's rounds, newest first
GET  rounds/<id>/                        one round: its comparison, with each change's decision
POST rounds/<id>/decide/ {change, decision, reason}   change = a number or "all"
POST rounds/<id>/finish/                 apply the decisions, save a version, close
POST rounds/<id>/cancel/                 the author withdraws open suggestions

Who may see a round = who may see the draft (drafting/access.py). Who may decide = the round's
decider only; who may suggest = an open reviewer (access.can_suggest).
"""

from django.shortcuts import get_object_or_404
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import RequirePermission

from . import review
from .access import can_suggest, open_request, viewable_sessions
from .models import DraftReviewRound


def _session(request, pk):
    return get_object_or_404(viewable_sessions(request.user), pk=pk)


def _round(request, pk):
    return get_object_or_404(DraftReviewRound.objects.filter(session__in=viewable_sessions(request.user)), pk=pk)


def _error(exc):
    return Response({'error': str(exc)}, status=400)


class SuggestView(APIView):
    permission_classes = [RequirePermission('DRAFT_CREATE')]

    def post(self, request, pk):
        session = _session(request, pk)
        if not can_suggest(session, request.user):
            return Response({'error': 'You can suggest changes only while this draft is open for your review.'},
                            status=403)
        blocks = request.data.get('blocks') if isinstance(request.data, dict) else request.data
        try:
            rnd = review.create_suggestions(session, request.user, blocks or [],
                                            note=(request.data.get('note') or '').strip()
                                            if isinstance(request.data, dict) else '',
                                            review_request=open_request(session, request.user))
        except review.ReviewError as exc:
            return _error(exc)
        return Response(review.round_json(rnd, request.user), status=201)


class RoundListView(APIView):
    permission_classes = [RequirePermission('DRAFT_VIEW')]

    def get(self, request, pk):
        session = _session(request, pk)
        rounds = list(session.review_rounds.prefetch_related('decisions'))
        names = review.advocate_names({r.author_id for r in rounds} | {r.decider_id for r in rounds})
        rows = []
        for rnd in rounds:
            total = review.comparison(rnd).changes
            decided = len(rnd.decisions.all())
            # Queries on a senior's corrections, so the senior sees them when the junior resubmits.
            queries = [d.reason for d in rnd.decisions.all() if d.decision == 'queried']
            # Decision counts, so the author of a finished round sees what became of it.
            counts = {}
            for d in rnd.decisions.all():
                counts[d.decision] = counts.get(d.decision, 0) + 1
            rows.append({'id': rnd.id, 'kind': rnd.kind, 'binding': rnd.binding, 'status': rnd.status,
                         'author_id': rnd.author_id, 'decider_id': rnd.decider_id, 'note': rnd.note,
                         'author_name': names.get(rnd.author_id), 'decider_name': names.get(rnd.decider_id),
                         'can_decide': rnd.status == 'open' and rnd.decider_id == request.user.id,
                         'mine': rnd.author_id == request.user.id, 'queries': queries, 'counts': counts,
                         'external_from': rnd.external_from,
                         'changes': total, 'pending': max(total - decided, 0),
                         'created_at': rnd.created_at, 'finished_at': rnd.finished_at})
        return Response(rows)


class RoundView(APIView):
    permission_classes = [RequirePermission('DRAFT_VIEW')]

    def get(self, request, pk):
        return Response(review.round_json(_round(request, pk), request.user))


class RoundDecideView(APIView):
    permission_classes = [RequirePermission('DRAFT_CREATE')]

    def post(self, request, pk):
        rnd = _round(request, pk)
        try:
            review.decide(rnd, request.user, request.data.get('change'), request.data.get('decision'),
                          request.data.get('reason', ''))
        except (review.ReviewError, TypeError, ValueError) as exc:
            return _error(exc if isinstance(exc, review.ReviewError) else 'Give a change number or "all".')
        return Response(review.round_json(rnd, request.user))


class RoundFinishView(APIView):
    permission_classes = [RequirePermission('DRAFT_CREATE')]

    def post(self, request, pk):
        rnd = _round(request, pk)
        try:
            result = review.finish(rnd, request.user)
        except review.ReviewError as exc:
            return _error(exc)
        rnd.refresh_from_db()
        return Response({**review.round_json(rnd, request.user), 'result': result})


class RoundCancelView(APIView):
    permission_classes = [RequirePermission('DRAFT_CREATE')]

    def post(self, request, pk):
        rnd = _round(request, pk)
        try:
            review.cancel(rnd, request.user)
        except review.ReviewError as exc:
            return _error(exc)
        return Response(review.round_json(rnd, request.user))
