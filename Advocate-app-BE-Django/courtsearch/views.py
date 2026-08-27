"""Proxy endpoints for the external Court Case Status scraper.

The browser never talks to the scraper directly (it has no auth/CORS). These
JWT-gated views validate input, cache aggressively, and translate the scraper's
status codes into clean responses for the frontend.
"""

import concurrent.futures
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
from core.practice import practice_ids

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


class CnrSearchView(APIView):
    """POST /api/courtsearch/cnr — unified CNR lookup across District Courts
    and High Courts.

    The two eCourts portals are separate systems with non-overlapping
    databases (verified directly: the District Court portal cleanly returns
    "not found" for a real High Court CNR, and the High Court portal errors on
    a real District Court CNR — neither indexes the other's cases). Rather
    than making the user pick a court first, query both portals concurrently
    and return whichever one actually has the case.

    The Supreme Court is deliberately NOT part of this fan-out: its CNR search
    solves a CAPTCHA and can take far longer than eCourts (~150s vs ~60s), so
    folding it in here would drag every ordinary District/High Court CNR
    lookup's worst case down to SCI's pace. SCI keeps its own dedicated CNR
    search inside the Supreme Court forum instead.

    Body: { cnr }. Returns { courtId: 'ecourts_dc' | 'ecourts_hc', cases: [...] }
    — the same envelope shape either backend already returns, plus the
    discriminator the frontend needs to render/map the result correctly.
    """
    permission_classes = [RequirePermission()]

    def post(self, request):
        cnr = (request.data.get('cnr') or '').strip()
        if not cnr:
            return Response({'error': 'cnr is required.'}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        key = f'courtsearch:cnr:{cnr}'
        data = cache.get(key)
        if data is not None:
            return Response(data)

        def lookup(court_id, fn):
            try:
                return court_id, fn(), None
            except (client.ScraperUnavailable, client.ScraperError) as exc:
                return court_id, None, exc

        # Short-circuit on the first confirmed match via as_completed() instead
        # of waiting on every future in submission order, so a fast hit on one
        # portal isn't held up behind a still-running lookup on the other.
        # shutdown(wait=False) lets a lookup still running when we already have
        # an answer finish in the background rather than blocking the response.
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=2)
        futures = [
            pool.submit(lookup, 'ecourts_dc',
                       lambda: client.post_json('/courts/ecourts_dc/cnr:search', {'cnr': cnr})),
            pool.submit(lookup, 'ecourts_hc', lambda: client.hc_cnr_search(cnr)),
        ]
        results = []
        try:
            for future in concurrent.futures.as_completed(futures):
                court_id, payload, exc = future.result()
                if payload is not None:
                    data = {'courtId': court_id, 'cases': payload.get('cases', [])}
                    cache.set(key, data, SEARCH_CACHE_TTL)
                    return Response(data)
                results.append((court_id, payload, exc))
        finally:
            pool.shutdown(wait=False)

        # Neither portal returned a case (both futures ran to completion above,
        # since neither produced a payload to short-circuit on). Only report
        # "not found" once BOTH sides gave a *confirmed* negative (a clean
        # 404). A portal that merely failed to solve its CAPTCHA in 15 tries
        # (503) or timed out (504) has told us nothing about whether the case
        # exists there - if we let a sibling portal's genuine 404 stand in for
        # that, we'd falsely tell the user "not found" for a case one portal
        # simply couldn't check this time. (Caught exactly this in testing: a
        # real district-court CNR whose DC lookup exhausted its CAPTCHA
        # retries, while HC correctly said 404 - the honest answer is "please
        # retry", not "not found".)
        errors = [exc for _, _, exc in results if exc is not None]
        confirmed_404 = [exc for exc in errors
                        if isinstance(exc, client.ScraperError) and exc.status == 404]
        if len(confirmed_404) == len(errors):
            return Response(
                {'error': 'No matching case found in the District Court or High Court records.'},
                status=status.HTTP_404_NOT_FOUND,
            )

        # At least one side couldn't give a definitive answer - surface that
        # (so the user knows to retry) rather than the other side's 404.
        inconclusive = [exc for exc in errors
                       if not (isinstance(exc, client.ScraperError) and exc.status == 404)]
        if any(isinstance(exc, client.ScraperUnavailable) for exc in inconclusive):
            return _unavailable()
        return _mapped(inconclusive[0])


# --- eCourts District Courts (stateful cascade) --------------------------

ECOURTS_STEPS = {'states', 'districts', 'complexes', 'establishments', 'case-types',
                 'police-stations', 'act-types'}
ECOURTS_PARAMS = ('state_code', 'dist_code', 'court_complex', 'est_code', 'search')
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
            if data:  # don't cache an empty list — lets a transient miss self-heal
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


class EcourtsListSearchView(APIView):
    """POST /api/courtsearch/ecourts/list-search — a list-returning search
    (party/filing/advocate/fir/act/case_type). Returns {rows:[...]} (no detail)."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        d = request.data
        missing = [k for k in ('state_code', 'dist_code', 'court_complex', 'mode')
                   if d.get(k) in (None, '')]
        if missing:
            return Response({'error': f'Missing required fields: {", ".join(missing)}'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        try:
            body = {
                'state_code': int(d.get('state_code')),
                'dist_code': int(d.get('dist_code')),
                'court_complex': str(d.get('court_complex')),
                'est_code': str(d.get('est_code')) if d.get('est_code') not in (None, '') else None,
                'mode': str(d.get('mode')),
                'params': d.get('params') or {},
            }
        except (TypeError, ValueError):
            return Response({'error': 'state_code and dist_code must be numbers.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        try:
            data = client.post_json('/courts/ecourts_dc/list:search', body)
        except client.ScraperUnavailable:
            return _unavailable()
        except client.ScraperError as exc:
            return _mapped(exc)
        return Response(data)


class EcourtsCaseDetailView(APIView):
    """POST /api/courtsearch/ecourts/case-detail — full detail (+ documents) for a
    result row's view_token, chosen from a list search."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        view_token = request.data.get('view_token')
        if not view_token:
            return Response({'error': 'view_token is required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        body = {'court_complex': str(request.data.get('court_complex') or ''), 'view_token': view_token}
        key = 'courtsearch:ecourts:detail:' + str(view_token)[:300]
        data = cache.get(key)
        if data is None:
            try:
                data = client.post_json('/courts/ecourts_dc/case:detail', body)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set(key, data, SEARCH_CACHE_TTL)
        return Response(data)


class EcourtsCnrView(APIView):
    """POST /api/courtsearch/ecourts/cnr — fetch an eCourts case by 16-char CNR.
    No cascade selection needed; returns the same {cases:[...]} shape as search."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        cnr = (request.data.get('cnr') or '').strip()
        if not cnr:
            return Response({'error': 'cnr is required.'}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        key = f'courtsearch:ecourts:cnr:{cnr}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.post_json('/courts/ecourts_dc/cnr:search', {'cnr': cnr})
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


class SciCaseTypesView(APIView):
    """GET /api/courtsearch/sci/case-types — cached SCI case-type dropdown."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        data = cache.get('courtsearch:sci:case-types')
        if data is None:
            try:
                data = client.sci_case_types()
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set('courtsearch:sci:case-types', data, COURTS_CACHE_TTL)
        return Response(data)


class SciCaseNoSearchView(APIView):
    """POST /api/courtsearch/sci/case-no — Supreme Court case status by Case Number.
    Body: { case_type, case_no, case_year }. Returns { cases:[...] }."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        case_type = (str(request.data.get('case_type') or '')).strip()
        case_no = (str(request.data.get('case_no') or '')).strip()
        year_raw = request.data.get('case_year')
        if not case_type or not case_no:
            return Response({'error': 'case_type and case_no are required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        try:
            case_year = int(year_raw)
        except (TypeError, ValueError):
            return Response({'error': 'case_year must be a valid year.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        key = f'courtsearch:sci:caseno:{case_type}:{case_no}:{case_year}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.sci_search_case_no(case_type, case_no, case_year)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set(key, data, SEARCH_CACHE_TTL)
        return Response(data)


class SciCaseDetailView(APIView):
    """POST /api/courtsearch/sci/case-detail — full SCI case-details record.
    Body: { diary_no, diary_year, expand? }. No CAPTCHA needed.

    expand=true also pulls every dropdown section's content (Listing Dates,
    Judgement/Orders, ...) rather than just naming them — far slower (~20s+,
    one upstream request per section), so it's used when importing a case,
    where the whole record must be captured for storage in one go.
    """
    permission_classes = [RequirePermission()]

    def post(self, request):
        diary_no = (str(request.data.get('diary_no') or '')).strip()
        diary_year = (str(request.data.get('diary_year') or '')).strip()
        expand = str(request.data.get('expand') or '').lower() in ('true', '1', 'yes')
        if not diary_no or not diary_year:
            return Response({'error': 'diary_no and diary_year are required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        # Keyed on expand too: the expanded record is a superset, so the two
        # must never serve each other from cache.
        key = f'courtsearch:sci:detail:{diary_no}:{diary_year}:{int(expand)}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.sci_case_detail(diary_no, diary_year, expand=expand)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set(key, data, SEARCH_CACHE_TTL)
        return Response(data)


class SciCaseSectionView(APIView):
    """POST /api/courtsearch/sci/case-section — one lazy-loaded dropdown
    section (Listing Dates, Judgement/Orders, Notices, ...) of an SCI case
    record. Body: { diary_no, diary_year, tab_name, label? }. No CAPTCHA
    needed. Fetched on demand instead of via case-detail's expand=True so a
    case review doesn't pay for every section up front."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        diary_no = (str(request.data.get('diary_no') or '')).strip()
        diary_year = (str(request.data.get('diary_year') or '')).strip()
        tab_name = (str(request.data.get('tab_name') or '')).strip()
        label = (str(request.data.get('label') or '')).strip()
        if not diary_no or not diary_year or not tab_name:
            return Response({'error': 'diary_no, diary_year and tab_name are required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        key = f'courtsearch:sci:section:{diary_no}:{diary_year}:{tab_name}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.sci_case_section(diary_no, diary_year, tab_name, label)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set(key, data, SEARCH_CACHE_TTL)
        return Response(data)


class SciDiaryNoSearchView(APIView):
    """POST /api/courtsearch/sci/diary-no — search by Diary Number.
    Body: { diary_no, year }. Returns { cases:[...] }."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        diary_no = (str(request.data.get('diary_no') or '')).strip()
        year_raw = request.data.get('year')
        if not diary_no:
            return Response({'error': 'diary_no is required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        try:
            year = int(year_raw)
        except (TypeError, ValueError):
            return Response({'error': 'year must be a valid year.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        key = f'courtsearch:sci:diaryno:{diary_no}:{year}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.sci_search_diary_no(diary_no, year)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set(key, data, SEARCH_CACHE_TTL)
        return Response(data)


class SciCnrSearchView(APIView):
    """POST /api/courtsearch/sci/cnr — search by 16-char CNR.
    Body: { cnr_no }. Returns { cases:[...] }."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        cnr_no = (request.data.get('cnr_no') or '').strip()
        if not cnr_no:
            return Response({'error': 'cnr_no is required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        key = f'courtsearch:sci:cnr:{cnr_no}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.sci_search_cnr(cnr_no)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set(key, data, SEARCH_CACHE_TTL)
        return Response(data)


class SciAorCodeSearchView(APIView):
    """POST /api/courtsearch/sci/aor-code — search by Advocate-on-Record code.
    Body: { aor_code, year, party_type?, status? }. Returns { cases:[...] }."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        aor_code = (str(request.data.get('aor_code') or '')).strip()
        year_raw = request.data.get('year')
        if not aor_code:
            return Response({'error': 'aor_code is required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        try:
            year = int(year_raw)
        except (TypeError, ValueError):
            return Response({'error': 'year must be a valid year.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        party_type = request.data.get('party_type') or 'any'
        case_status = request.data.get('status') or 'P'
        key = f'courtsearch:sci:aor:{aor_code}:{year}:{party_type}:{case_status}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.sci_search_aor_code(aor_code, year, party_type, case_status)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set(key, data, SEARCH_CACHE_TTL)
        return Response(data)


class SciPartyNameSearchView(APIView):
    """POST /api/courtsearch/sci/party-name — search by party name.
    Body: { party_name, year?, party_type?, status? }. Returns { cases:[...] }."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        party_name = (request.data.get('party_name') or '').strip()
        if not party_name:
            return Response({'error': 'party_name is required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        year_raw = request.data.get('year')
        year = None
        if year_raw not in (None, ''):
            try:
                year = int(year_raw)
            except (TypeError, ValueError):
                return Response({'error': 'year must be a valid year.'},
                                status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        party_type = request.data.get('party_type') or 'any'
        party_status = request.data.get('status') or None
        key = f'courtsearch:sci:party:{party_name}:{year}:{party_type}:{party_status}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.sci_search_party_name(party_name, year, party_type, party_status)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set(key, data, SEARCH_CACHE_TTL)
        return Response(data)


SCI_COURT_CASCADE_TTL = 60 * 60 * 24   # 24h — court/state/bench lists rarely change


class SciCourtTypesView(APIView):
    """GET /api/courtsearch/sci/court-types — cached { label: code } for the
    top-level Court selector (Supreme/High/District Court, State Agency)."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        data = cache.get('courtsearch:sci:court-types')
        if data is None:
            try:
                data = client.sci_court_types()
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set('courtsearch:sci:court-types', data, SCI_COURT_CASCADE_TTL)
        return Response(data)


class SciCourtStatesView(APIView):
    """GET /api/courtsearch/sci/court-states?court_type= — cached { state: code }."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        court_type = (request.query_params.get('court_type') or '').strip()
        if not court_type:
            return Response({'error': 'court_type is required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        key = f'courtsearch:sci:court-states:{court_type}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.sci_court_states(court_type)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            if data:
                cache.set(key, data, SCI_COURT_CASCADE_TTL)
        return Response(data)


class SciCourtBenchesView(APIView):
    """GET /api/courtsearch/sci/court-benches?court_type=&state= — cached { bench: code }."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        court_type = (request.query_params.get('court_type') or '').strip()
        state = (request.query_params.get('state') or '').strip()
        if not court_type or not state:
            return Response({'error': 'court_type and state are required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        key = f'courtsearch:sci:court-benches:{court_type}:{state}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.sci_court_benches(court_type, state)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            if data:
                cache.set(key, data, SCI_COURT_CASCADE_TTL)
        return Response(data)


class SciCourtCaseTypesView(APIView):
    """GET /api/courtsearch/sci/court-case-types?court_type=&state=&bench= —
    cached { case-type: code }."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        court_type = (request.query_params.get('court_type') or '').strip()
        state = (request.query_params.get('state') or '').strip()
        bench = (request.query_params.get('bench') or '').strip()
        if not court_type or not state or not bench:
            return Response({'error': 'court_type, state and bench are required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        key = f'courtsearch:sci:court-case-types:{court_type}:{state}:{bench}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.sci_court_case_types(court_type, state, bench)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            if data:
                cache.set(key, data, SCI_COURT_CASCADE_TTL)
        return Response(data)


class SciCourtSearchView(APIView):
    """POST /api/courtsearch/sci/court-search — SCI's court-wise cascade search.
    Body: { court_type, state, bench, case_type?, case_no?, year?, listing_date? }."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        d = request.data
        missing = [k for k in ('court_type', 'state', 'bench') if not str(d.get(k) or '').strip()]
        if missing:
            return Response({'error': f'Missing required fields: {", ".join(missing)}'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        year_raw = d.get('year')
        year = None
        if year_raw not in (None, ''):
            try:
                year = int(year_raw)
            except (TypeError, ValueError):
                return Response({'error': 'year must be a valid year.'},
                                status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        try:
            data = client.sci_search_court(
                str(d.get('court_type')), str(d.get('state')), str(d.get('bench')),
                d.get('case_type') or None, d.get('case_no') or None,
                year, d.get('listing_date') or None,
            )
        except client.ScraperUnavailable:
            return _unavailable()
        except client.ScraperError as exc:
            return _mapped(exc)
        return Response(data)


# --- eCourts High Court Services (stateful cascade) ----------------------

HC_CASCADE_TTL = 60 * 60 * 24   # 24h — High Courts/benches/case-types rarely change


class HcHighCourtsView(APIView):
    """GET /api/courtsearch/hc/high-courts — cached { name: state_code } map."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        data = cache.get('courtsearch:hc:high-courts')
        if data is None:
            try:
                data = client.hc_high_courts()
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set('courtsearch:hc:high-courts', data, HC_CASCADE_TTL)
        return Response(data)


class HcBenchesView(APIView):
    """GET /api/courtsearch/hc/benches?state_code= — cached { bench: court_code }."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        state_code = (request.query_params.get('state_code') or '').strip()
        if not state_code:
            return Response({'error': 'state_code is required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        key = f'courtsearch:hc:benches:{state_code}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.hc_benches(state_code)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            if data:
                cache.set(key, data, HC_CASCADE_TTL)
        return Response(data)


class HcCaseTypesView(APIView):
    """GET /api/courtsearch/hc/case-types?state_code=&court_complex= — cached map."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        state_code = (request.query_params.get('state_code') or '').strip()
        court_complex = (request.query_params.get('court_complex') or '').strip()
        if not state_code or not court_complex:
            return Response({'error': 'state_code and court_complex are required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        key = f'courtsearch:hc:case-types:{state_code}:{court_complex}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.hc_case_types(state_code, court_complex)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            if data:
                cache.set(key, data, HC_CASCADE_TTL)
        return Response(data)


class HcSearchView(APIView):
    """POST /api/courtsearch/hc/search — High Court case-number lookup.
    Body: { state_code, court_complex, case_type, case_number, case_year }."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        d = request.data
        required = ['state_code', 'court_complex', 'case_type', 'case_number', 'case_year']
        missing = [k for k in required if d.get(k) in (None, '')]
        if missing:
            return Response({'error': f'Missing required fields: {", ".join(missing)}'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        try:
            case_year = int(d.get('case_year'))
        except (TypeError, ValueError):
            return Response({'error': 'case_year must be a valid year.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        this_year = datetime.date.today().year
        if case_year < 1900 or case_year > this_year:
            return Response({'error': f'case_year must be between 1900 and {this_year}.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        state_code = str(d.get('state_code'))
        court_complex = str(d.get('court_complex'))
        case_type = str(d.get('case_type'))
        case_number = str(d.get('case_number'))
        key = (f'courtsearch:hc:search:{state_code}:{court_complex}:'
               f'{case_type}:{case_number}:{case_year}')
        data = cache.get(key)
        if data is None:
            try:
                data = client.hc_search(state_code, court_complex, case_type,
                                        case_number, case_year)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set(key, data, SEARCH_CACHE_TTL)
        return Response(data)


class HcPoliceStationsView(APIView):
    """GET /api/courtsearch/hc/police-stations?state_code=&court_complex= —
    cached { police-station label: code } for the FIR-number search."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        state_code = (request.query_params.get('state_code') or '').strip()
        court_complex = (request.query_params.get('court_complex') or '').strip()
        if not state_code or not court_complex:
            return Response({'error': 'state_code and court_complex are required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        key = f'courtsearch:hc:police-stations:{state_code}:{court_complex}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.hc_police_stations(state_code, court_complex)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            if data:
                cache.set(key, data, HC_CASCADE_TTL)
        return Response(data)


class HcActTypesView(APIView):
    """GET /api/courtsearch/hc/act-types?state_code=&court_complex=&search= —
    cached { act label: code } for the Act search."""
    permission_classes = [RequirePermission()]

    def get(self, request):
        state_code = (request.query_params.get('state_code') or '').strip()
        court_complex = (request.query_params.get('court_complex') or '').strip()
        search = (request.query_params.get('search') or '').strip()
        if not state_code or not court_complex:
            return Response({'error': 'state_code and court_complex are required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        key = f'courtsearch:hc:act-types:{state_code}:{court_complex}:{search}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.hc_act_types(state_code, court_complex, search)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            if data:
                cache.set(key, data, HC_CASCADE_TTL)
        return Response(data)


class HcListSearchView(APIView):
    """POST /api/courtsearch/hc/list-search — a list-returning HC search
    (party/filing/advocate/fir/act/case_type). Returns {rows:[...]} (no detail)."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        d = request.data
        missing = [k for k in ('state_code', 'court_complex', 'mode') if d.get(k) in (None, '')]
        if missing:
            return Response({'error': f'Missing required fields: {", ".join(missing)}'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        try:
            data = client.hc_list_search(
                str(d.get('state_code')), str(d.get('court_complex')),
                str(d.get('mode')), d.get('params') or {},
            )
        except client.ScraperUnavailable:
            return _unavailable()
        except client.ScraperError as exc:
            return _mapped(exc)
        return Response(data)


class HcCaseDetailView(APIView):
    """POST /api/courtsearch/hc/case-detail — full detail (+ documents) for one
    HC result row's view_token, chosen from a list search."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        view_token = request.data.get('view_token')
        if not view_token:
            return Response({'error': 'view_token is required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        key = 'courtsearch:hc:detail:' + str(view_token)[:300]
        data = cache.get(key)
        if data is None:
            try:
                data = client.hc_case_detail(view_token)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set(key, data, SEARCH_CACHE_TTL)
        return Response(data)


class HcCnrView(APIView):
    """POST /api/courtsearch/hc/cnr — fetch a High Court case by 16-char CNR.
    No bench/case-type selection needed; returns the same {cases:[...]} shape
    as search."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        cnr = (request.data.get('cnr') or '').strip()
        if not cnr:
            return Response({'error': 'cnr is required.'}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        key = f'courtsearch:hc:cnr:{cnr}'
        data = cache.get(key)
        if data is None:
            try:
                data = client.hc_cnr_search(cnr)
            except client.ScraperUnavailable:
                return _unavailable()
            except client.ScraperError as exc:
                return _mapped(exc)
            cache.set(key, data, SEARCH_CACHE_TTL)
        return Response(data)


class HcOrderPdfView(APIView):
    """POST /api/courtsearch/hc/order-pdf — stream an order/judgement PDF.
    Body: { url } taken from a search result's cases[].documents[].url."""
    permission_classes = [RequirePermission()]

    def post(self, request):
        url = (request.data.get('url') or '').strip()
        if not url:
            return Response({'error': 'url is required.'},
                            status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        try:
            upstream = client.hc_open_order_pdf(url)
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
        qs = ImportedCaseRecord.objects.filter(advocate_id__in=practice_ids(request.user))
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
