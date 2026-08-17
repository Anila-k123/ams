"""Proxy endpoints for the external Court Case Status scraper.

The browser never talks to the scraper directly (it has no auth/CORS). These
JWT-gated views validate input, cache aggressively, and translate the scraper's
status codes into clean responses for the frontend.
"""

import datetime
import logging

from django.core.cache import cache
from django.http import StreamingHttpResponse

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.permissions import RequirePermission
from . import client
from .models import CourtCaseTypes, ImportedCaseRecord

log = logging.getLogger(__name__)

COURTS_CACHE_TTL = 60 * 60 * 24        # 24h — the court list changes rarely
SEARCH_CACHE_TTL = 60 * 60             # 1h — balances freshness for active cases vs. load


def _unavailable():
    return Response(
        {'error': 'The court lookup service is currently unavailable. Please try again shortly.'},
        status=status.HTTP_503_SERVICE_UNAVAILABLE,
    )


def _mapped(exc: client.ScraperError):
    """Translate the scraper's error into a user-facing response."""
    if exc.status == 404:
        return Response({'error': exc.detail or 'No matching case found.'},
                        status=status.HTTP_404_NOT_FOUND)
    if exc.status == 400:
        return Response({'error': exc.detail or 'Invalid case type.'},
                        status=status.HTTP_400_BAD_REQUEST)
    if exc.status in (502, 503, 504):
        return Response({'error': 'The court website is busy. Please try again.'},
                        status=status.HTTP_503_SERVICE_UNAVAILABLE)
    # 422 or anything unexpected — surface the detail without leaking internals.
    code = exc.status if 400 <= exc.status < 600 else status.HTTP_502_BAD_GATEWAY
    return Response({'error': exc.detail or 'Court lookup failed.'}, status=code)


class CourtsView(APIView):
    """GET /api/courtsearch/courts — cached passthrough to feed the court dropdown."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        data = cache.get('courtsearch:courts')
        if data is None:
            try:
                data = client.get_courts()
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set('courtsearch:courts', data, COURTS_CACHE_TTL)
        return Response(data)


class CaseTypesView(APIView):
    """GET /api/courtsearch/courts/<court_id>/case-types.

    Served from the DB (CourtCaseTypes). The first time a court is requested we scrape
    the court site once and persist the map; every request after that is a DB read, so
    the court site is never hit again unless an admin runs `refresh_case_types`.
    """
    permission_classes = [RequirePermission()]

    def get(self, request, court_id):
        row = CourtCaseTypes.objects.filter(court_id=court_id).first()
        if row is not None:
            return Response(row.types)
        # First request for this court — fetch once and persist.
        try:
            data = client.get_case_types(court_id)
        except client.ScraperUnavailable:
            return _unavailable()
        except client.ScraperError as exc:
            return _mapped(exc)
        CourtCaseTypes.objects.update_or_create(court_id=court_id, defaults={'types': data})
        return Response(data)


class SearchView(APIView):
    """POST /api/courtsearch/search — validate, retry-wrapped lookup, cache success."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        court_id = (request.data.get('court_id') or '').strip()
        case_type = (request.data.get('case_type') or '').strip()
        case_number = (request.data.get('case_number') or '').strip()
        year_raw = request.data.get('case_year')

        if not court_id or not case_type or not case_number:
            return Response(
                {'error': 'court_id, case_type and case_number are required.'},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        try:
            case_year = int(year_raw)
        except (TypeError, ValueError):
            return Response({'error': 'case_year must be a valid year.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        this_year = datetime.date.today().year
        if case_year < 1900 or case_year > this_year:
            return Response({'error': f'case_year must be between 1900 and {this_year}.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        cache_key = f'courtsearch:search:{court_id}:{case_type}:{case_number}:{case_year}'
        data = cache.get(cache_key)
        if data is None:
            try:
                data = client.search(court_id, case_type, case_number, case_year)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set(cache_key, data, SEARCH_CACHE_TTL)
        return Response(data)


# --- eCourts District Courts (stateful cascade) --------------------------

ECOURTS_STEPS = {'states', 'districts', 'complexes', 'establishments', 'case-types'}
ECOURTS_PARAMS = ('state_code', 'dist_code', 'court_complex', 'est_code')
ECOURTS_CASCADE_TTL = 60 * 60 * 24   # 24h — states/districts/complexes rarely change


class EcourtsCascadeView(APIView):
    """Generic cached pass-through for a cascade step: forwards the relevant query
    params to the scraper's /courts/ecourts_dc/<step> and caches the list."""
    permission_classes = [RequirePermission()]

    def get(self, request, step):
        if step not in ECOURTS_STEPS:
            return Response({'error': f'Unknown step {step!r}'}, status=status.HTTP_404_NOT_FOUND)
        params = {}
        for k in ECOURTS_PARAMS:
            v = request.query_params.get(k)
            if v not in (None, ''):
                params[k] = v
        key = 'courtsearch:ecourts:%s:%s' % (
            step, '&'.join(f'{k}={params[k]}' for k in sorted(params)))
        data = cache.get(key)
        if data is None:
            try:
                data = client.get_json(f'/courts/ecourts_dc/{step}', params=params)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set(key, data, ECOURTS_CASCADE_TTL)
        return Response(data)


class EcourtsSearchView(APIView):
    """POST the full eCourts cascade selection + case coordinates; forward to the
    scraper's cases:search with retry, cache the successful result."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        d = request.data
        required = ['state_code', 'dist_code', 'court_complex', 'case_type', 'case_number', 'case_year']
        missing = [k for k in required if d.get(k) in (None, '')]
        if missing:
            return Response({'error': f'Missing required fields: {", ".join(missing)}'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        try:
            state_code = int(d.get('state_code'))
            dist_code = int(d.get('dist_code'))
            case_year = int(d.get('case_year'))
        except (TypeError, ValueError):
            return Response({'error': 'state_code, dist_code and case_year must be numbers.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        this_year = datetime.date.today().year
        if case_year < 1900 or case_year > this_year:
            return Response({'error': f'case_year must be between 1900 and {this_year}.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        est_code = d.get('est_code')
        body = {
            'state_code': state_code,
            'dist_code': dist_code,
            'court_complex': str(d.get('court_complex')),
            'est_code': str(est_code) if est_code not in (None, '') else None,
            'case_type': str(d.get('case_type')),
            'case_number': str(d.get('case_number')),
            'case_year': case_year,
        }
        key = 'courtsearch:ecourts:search:' + ':'.join(
            str(body[k]) for k in ('state_code', 'dist_code', 'court_complex', 'est_code',
                                    'case_type', 'case_number', 'case_year'))
        data = cache.get(key)
        if data is None:
            try:
                data = client.post_json('/courts/ecourts_dc/cases:search', body)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set(key, data, SEARCH_CACHE_TTL)
        return Response(data)


class EcourtsDocumentView(APIView):
    """Stream ONE court document on demand, straight from the scraper to the client.

    Body: { court_complex, view_token, kind, token } — all taken verbatim from the
    search response's documents[] entry. Nothing is stored: the scraper streams the
    PDF (order_pdf) or JSON (hearing_business) and we pipe it through, preserving the
    status, Content-Type and Content-Disposition so the browser saves/handles it."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        d = request.data
        kind = (d.get('kind') or '').strip()
        if not kind or d.get('token') in (None, '') or d.get('view_token') in (None, ''):
            return Response({'error': 'kind, token and view_token are required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        body = {
            'court_complex': str(d.get('court_complex') or ''),
            'view_token': d.get('view_token'),
            'kind': kind,
            'token': d.get('token'),
        }
        try:
            upstream = client.open_document_stream(body)
        except client.ScraperUnavailable:
            return _unavailable()

        resp = StreamingHttpResponse(
            upstream.iter_content(chunk_size=8192),
            status=upstream.status_code,
            content_type=upstream.headers.get('Content-Type', 'application/octet-stream'),
        )
        disposition = upstream.headers.get('Content-Disposition')
        if disposition:
            resp['Content-Disposition'] = disposition
        return resp


class ImportedRecordView(APIView):
    """Persist / retrieve the full court-API response for an imported case.

    Called right after a case is created from an import, so the complete scraped
    record (fields, tables, orders, hearing history, etc.) is kept for later use.
    """
    permission_classes = [RequirePermission()]

    def post(self, request):
        raw = request.data.get('raw')
        if raw is None:
            return Response({'error': 'raw is required'}, status=status.HTTP_400_BAD_REQUEST)
        rec = ImportedCaseRecord.objects.create(
            advocate_id=request.user.id,
            case_id=request.data.get('caseId') or None,
            court_id=(request.data.get('courtId') or '').strip(),
            query=request.data.get('query') or {},
            raw=raw,
        )
        return Response({'id': rec.id}, status=status.HTTP_201_CREATED)

    def get(self, request):
        """Latest stored record for a case (?caseId=) — powers later display."""
        qs = ImportedCaseRecord.objects.filter(advocate_id=request.user.id)
        case_id = request.query_params.get('caseId')
        if case_id:
            qs = qs.filter(case_id=case_id)
        rec = qs.order_by('-id').first()
        if rec is None:
            return Response({'error': 'No imported record found'}, status=status.HTTP_404_NOT_FOUND)
        return Response({
            'id': rec.id, 'caseId': rec.case_id, 'courtId': rec.court_id,
            'query': rec.query, 'raw': rec.raw,
            'fetchedAt': rec.fetched_at.isoformat() if rec.fetched_at else None,
        })
