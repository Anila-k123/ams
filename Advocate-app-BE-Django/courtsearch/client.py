"""HTTP client for the external Court Case Status scraper microservice.

The scraper is a standalone FastAPI service (see scrap_court/INTEGRATION.md). This
module is the ONLY place that talks to it, wrapping the two integration rules that
matter: a long timeout for searches, and automatic retry of transient 502/503s.
"""

from __future__ import annotations

import logging
import time

import requests
from decouple import config

log = logging.getLogger(__name__)

# Base URL of the scraper service. Override per environment.
COURT_API_BASE = config('COURT_API_BASE', default='http://localhost:8000')

# A search does live scraping + throttling + OCR retries and can take ~5-30s.
SEARCH_TIMEOUT = config('COURT_API_SEARCH_TIMEOUT', default=60, cast=int)
LIST_TIMEOUT = config('COURT_API_LIST_TIMEOUT', default=30, cast=int)

# Transient upstream failures that MUST be retried: 502 (portal/parse error),
# 503 (CAPTCHA not solved this attempt), 504 (portal timeout). 400/404/422 are
# terminal and must NOT be retried.
RETRYABLE_STATUS = {502, 503, 504}
RETRY_BACKOFFS = [1, 2]  # seconds to wait before the 2nd and 3rd attempts


class ScraperError(Exception):
    """The scraper returned an HTTP error we should surface to the caller."""

    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail
        super().__init__(f'{status}: {detail}')


class ScraperUnavailable(Exception):
    """Could not reach the scraper at all (connection refused / timeout)."""


def _url(path: str) -> str:
    return f'{COURT_API_BASE.rstrip("/")}{path}'


def _detail(resp: requests.Response) -> str:
    try:
        return resp.json().get('detail') or resp.text
    except ValueError:
        return resp.text


def _handle(resp: requests.Response):
    if resp.status_code == 200:
        return resp.json()
    raise ScraperError(resp.status_code, _detail(resp))


def get_courts():
    """List supported courts. Drives the UI — never hard-code court ids."""
    try:
        resp = requests.get(_url('/courts'), timeout=LIST_TIMEOUT)
    except requests.RequestException as exc:
        raise ScraperUnavailable(str(exc))
    return _handle(resp)


def get_case_types(court_id: str):
    """Return the { LABEL: numeric_id } case-type map for a court (live; cache upstream)."""
    try:
        resp = requests.get(_url(f'/courts/{court_id}/case-types'), timeout=LIST_TIMEOUT)
    except requests.RequestException as exc:
        raise ScraperUnavailable(str(exc))
    return _handle(resp)


def search(court_id: str, case_type: str, case_number: str, case_year: int):
    """Madras HC flat lookup."""
    body = {'case_type': case_type, 'case_number': case_number, 'case_year': case_year}
    return post_json(f'/courts/{court_id}/cases:search', body)


def get_json(path: str, params: dict | None = None, timeout: int = LIST_TIMEOUT):
    """Generic cached-friendly GET to the scraper, retrying transient failures."""
    attempts = len(RETRY_BACKOFFS) + 1
    for i in range(attempts):
        try:
            resp = requests.get(_url(path), params=params or {}, timeout=timeout)
        except requests.RequestException as exc:
            raise ScraperUnavailable(str(exc))
        if resp.status_code in RETRYABLE_STATUS and i < attempts - 1:
            log.info('GET %s got %s, retry %d/%d', path, resp.status_code, i + 1, attempts - 1)
            time.sleep(RETRY_BACKOFFS[i])
            continue
        return _handle(resp)


def post_json(path: str, body: dict, timeout: int = SEARCH_TIMEOUT):
    """Generic POST search to the scraper, retrying transient 502/503/504."""
    attempts = len(RETRY_BACKOFFS) + 1
    for i in range(attempts):
        try:
            resp = requests.post(_url(path), json=body, timeout=timeout)
        except requests.RequestException as exc:
            raise ScraperUnavailable(str(exc))
        if resp.status_code in RETRYABLE_STATUS and i < attempts - 1:
            log.info('POST %s got %s, retry %d/%d', path, resp.status_code, i + 1, attempts - 1)
            time.sleep(RETRY_BACKOFFS[i])
            continue
        return _handle(resp)


# A Supreme Court search solves an arithmetic CAPTCHA by OCR + retries, each
# retry being a fresh page load, so it can take noticeably longer than eCourts.
SCI_TIMEOUT = config('COURT_API_SCI_TIMEOUT', default=150, cast=int)


def sci_case_types(timeout: int = LIST_TIMEOUT):
    """SCI case-type id->label map (for the Case Number dropdown)."""
    return get_json('/courts/sci/case-types', timeout=timeout)


def sci_search_case_no(case_type: str, case_no: str, case_year, timeout: int = SCI_TIMEOUT):
    """Search Supreme Court case status by Case Number."""
    return post_json('/courts/sci/case-no:search',
                     {'case_type': case_type, 'case_no': case_no, 'case_year': case_year},
                     timeout=timeout)


def sci_case_detail(diary_no, diary_year, timeout: int = SEARCH_TIMEOUT):
    """Full Supreme Court case-details record for a diary no/year (no CAPTCHA)."""
    return post_json('/courts/sci/case-detail',
                     {'diary_no': str(diary_no), 'diary_year': str(diary_year)},
                     timeout=timeout)


def sci_case_section(diary_no, diary_year, tab_name, label='', timeout: int = SEARCH_TIMEOUT):
    """One lazy-loaded dropdown section (Listing Dates, Orders, ...) of a
    Supreme Court case-details record. No CAPTCHA needed."""
    return post_json('/courts/sci/case-section', {
        'diary_no': str(diary_no), 'diary_year': str(diary_year),
        'tab_name': str(tab_name), 'label': str(label),
    }, timeout=timeout)


def sci_search_diary_no(diary_no, year, timeout: int = SCI_TIMEOUT):
    """Search Supreme Court case status by Diary Number."""
    return post_json('/courts/sci/diary-no:search',
                     {'diary_no': str(diary_no), 'year': int(year)}, timeout=timeout)


def sci_search_cnr(cnr_no, timeout: int = SCI_TIMEOUT):
    """Search Supreme Court case status by 16-char CNR."""
    return post_json('/courts/sci/cnr:search', {'cnr_no': cnr_no}, timeout=timeout)


def sci_search_aor_code(aor_code, year, party_type='any', status='P',
                        timeout: int = SCI_TIMEOUT):
    """Search Supreme Court case status by Advocate-on-Record code."""
    return post_json('/courts/sci/aor-code:search', {
        'aor_code': str(aor_code), 'year': int(year),
        'party_type': party_type, 'status': status,
    }, timeout=timeout)


def sci_search_party_name(party_name, year=None, party_type='any', status=None,
                          timeout: int = SCI_TIMEOUT):
    """Search Supreme Court case status by party name."""
    return post_json('/courts/sci/party-name:search', {
        'party_name': party_name,
        'year': int(year) if year not in (None, '') else None,
        'party_type': party_type, 'status': status,
    }, timeout=timeout)


def sci_court_types(timeout: int = LIST_TIMEOUT):
    """{ label -> code } for the top-level Court selector (Supreme/High/District/State Agency)."""
    return get_json('/courts/sci/court-types', timeout=timeout)


def sci_court_states(court_type, timeout: int = LIST_TIMEOUT):
    """{ state label -> code } for one court type."""
    return get_json('/courts/sci/court-states', {'court_type': court_type}, timeout=timeout)


def sci_court_benches(court_type, state, timeout: int = LIST_TIMEOUT):
    """{ bench label -> code } for one court type + state."""
    return get_json('/courts/sci/court-benches',
                    {'court_type': court_type, 'state': state}, timeout=timeout)


def sci_court_case_types(court_type, state, bench, timeout: int = LIST_TIMEOUT):
    """{ case-type label -> code } for one court type + state + bench."""
    return get_json('/courts/sci/court-case-types',
                    {'court_type': court_type, 'state': state, 'bench': bench}, timeout=timeout)


def sci_search_court(court_type, state, bench, case_type=None, case_no=None,
                     year=None, listing_date=None, timeout: int = SCI_TIMEOUT):
    """Search Supreme Court's court-wise cascade (court type -> state -> bench)."""
    return post_json('/courts/sci/court:search', {
        'court_type': court_type, 'state': state, 'bench': bench,
        'case_type': case_type, 'case_no': case_no,
        'year': int(year) if year not in (None, '') else None,
        'listing_date': listing_date,
    }, timeout=timeout)


def get_display_courts(timeout: int = LIST_TIMEOUT):
    """The list of courts whose display boards the scraper can serve, for the
    accordion. Cheap — no scraping — returns [{value, label}, ...]."""
    return get_json('/display-board/courts', timeout=timeout)


def get_display_board(court: str, timeout: int = SEARCH_TIMEOUT):
    """Live daily display board (cause list) for a court, from the scraper's
    /display-board endpoint. A live scrape (with a homepage warm-up) can take a
    while, so use the longer search timeout. Returns the scraper's envelope:
    {court, boardDate, fetchedAt, count, rows[], courts[]}."""
    return get_json('/display-board', {'court': court}, timeout=timeout)


# --- eCourts High Court Services (stateful cascade + OCR-CAPTCHA search) ------

def hc_high_courts(timeout: int = LIST_TIMEOUT):
    """{ High Court name -> state_code } for the first dropdown."""
    return get_json('/courts/ecourts_hc/high-courts', timeout=timeout)


def hc_benches(state_code, timeout: int = LIST_TIMEOUT):
    """{ bench name -> court_code } for one High Court."""
    return get_json('/courts/ecourts_hc/benches', {'state_code': state_code}, timeout=timeout)


def hc_case_types(state_code, court_complex, timeout: int = LIST_TIMEOUT):
    """{ case-type label -> code } for one bench."""
    return get_json('/courts/ecourts_hc/case-types',
                    {'state_code': state_code, 'court_complex': court_complex}, timeout=timeout)


def hc_search(state_code, court_complex, case_type, case_number, case_year,
              timeout: int = SEARCH_TIMEOUT):
    """Search a High Court by case number; returns {cases:[...]} with full detail."""
    return post_json('/courts/ecourts_hc/cases:search', {
        'state_code': str(state_code),
        'court_complex': str(court_complex),
        'case_type': str(case_type),
        'case_number': str(case_number),
        'case_year': case_year,
    }, timeout=timeout)


def hc_police_stations(state_code, court_complex, timeout: int = LIST_TIMEOUT):
    """{ police-station label -> code } for the FIR-number search, one bench."""
    return get_json('/courts/ecourts_hc/police-stations',
                    {'state_code': state_code, 'court_complex': court_complex}, timeout=timeout)


def hc_act_types(state_code, court_complex, search='', timeout: int = LIST_TIMEOUT):
    """{ act label -> code } for the Act search, one bench."""
    return get_json('/courts/ecourts_hc/act-types', {
        'state_code': state_code, 'court_complex': court_complex, 'search': search,
    }, timeout=timeout)


def hc_list_search(state_code, court_complex, mode, params, timeout: int = SEARCH_TIMEOUT):
    """List-returning HC search (party/filing/advocate/fir/act/case_type).
    Returns {"rows": [{sr_no, case_number, parties, view_token}]}."""
    return post_json('/courts/ecourts_hc/list:search', {
        'state_code': str(state_code), 'court_complex': str(court_complex),
        'mode': str(mode), 'params': params or {},
    }, timeout=timeout)


def hc_case_detail(view_token, timeout: int = SEARCH_TIMEOUT):
    """Full detail (+ documents) for one HC result row's view_token."""
    return post_json('/courts/ecourts_hc/case:detail', {'view_token': view_token}, timeout=timeout)


def hc_cnr_search(cnr, timeout: int = SEARCH_TIMEOUT):
    """Fetch a High Court case directly by its 16-char CNR."""
    return post_json('/courts/ecourts_hc/cnr:search', {'cnr': cnr}, timeout=timeout)


def hc_open_order_pdf(url: str, timeout: int = SEARCH_TIMEOUT):
    """Open a streaming POST for a HC order/judgement PDF (by its documents[].url).
    Returns the raw requests.Response (stream=True) for the view to pipe through."""
    try:
        return requests.post(
            _url('/courts/ecourts_hc/orders:pdf'),
            json={'url': url}, stream=True, timeout=timeout,
        )
    except requests.RequestException as exc:
        raise ScraperUnavailable(str(exc))


def open_document_stream(body: dict, timeout: int = SEARCH_TIMEOUT):
    """Open a streaming POST to documents:fetch and return the raw requests.Response
    (stream=True) so the view can pipe bytes straight to the client — nothing is
    buffered to disk or DB. Caller is responsible for consuming/closing it."""
    try:
        return requests.post(
            _url('/courts/ecourts_dc/documents:fetch'),
            json=body, stream=True, timeout=timeout,
        )
    except requests.RequestException as exc:
        raise ScraperUnavailable(str(exc))
