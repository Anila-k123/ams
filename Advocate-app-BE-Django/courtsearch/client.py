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
