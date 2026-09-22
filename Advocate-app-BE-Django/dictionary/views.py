from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.permissions import RequirePermission
from .models import LegalTerm


def _snippet(text, n=200):
    text = text or ''
    return (text[:n].rstrip() + '…') if len(text) > n else text


class LegalTermSearchView(APIView):
    """GET /api/dictionary/search?q=&limit= -> matching terms (prefix first)."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        q = (request.query_params.get('q') or '').strip().lower()
        if len(q) < 2:
            return Response([])
        try:
            limit = min(int(request.query_params.get('limit', 20)), 50)
        except (TypeError, ValueError):
            limit = 20

        # Hide entries whose definition refined to empty (whole body was references).
        base = LegalTerm.objects.exclude(definition='').exclude(definition__isnull=True)
        results = list(base.filter(term_norm__startswith=q)[:limit])
        if len(results) < limit:
            seen = {t.id for t in results}
            extra = base.filter(term_norm__contains=q).exclude(id__in=seen)[:limit - len(results)]
            results.extend(extra)
        return Response([
            {'id': t.id, 'term': t.term, 'snippet': _snippet(t.definition), 'source': t.source}
            for t in results
        ])


class LegalTermView(APIView):
    """GET /api/dictionary/term/<id> -> full definition."""
    permission_classes = [RequirePermission()]

    def get(self, request, pk):
        t = LegalTerm.objects.filter(id=pk).first()
        if t is None:
            return Response({'error': 'Term not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response({'id': t.id, 'term': t.term, 'definition': t.definition,
                         'letter': t.letter, 'source': t.source})
