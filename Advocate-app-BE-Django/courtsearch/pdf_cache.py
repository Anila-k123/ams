"""Tiny on-disk cache for court order/judgement PDFs.

A court order PDF is immutable once issued, so the first time it's fetched we
stream it from the portal, save it under a content-addressed name, and serve
every later request straight from disk — no repeat scraping. The cache key is a
hash of the document's stable identifier (High Court: its URL; District Court:
its token dict)."""

import hashlib
import json
import logging
import os

from django.conf import settings

log = logging.getLogger('courtsearch')


def _dir() -> str:
    d = getattr(settings, 'COURT_PDF_CACHE_DIR', None) or os.path.join(
        str(settings.BASE_DIR), 'court_pdf_cache')
    os.makedirs(d, exist_ok=True)
    return d


def key_for(identifier) -> str:
    """Stable cache key for a document identifier (str URL or token dict)."""
    raw = identifier if isinstance(identifier, str) else json.dumps(identifier, sort_keys=True)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def get(key: str):
    """Return cached PDF bytes, or None if not cached."""
    path = os.path.join(_dir(), key + '.pdf')
    try:
        if os.path.exists(path) and os.path.getsize(path) > 0:
            with open(path, 'rb') as f:
                return f.read()
    except OSError as exc:  # pragma: no cover - disk hiccup shouldn't break a fetch
        log.warning('pdf_cache read failed: %s', exc)
    return None


def put(key: str, data: bytes) -> None:
    """Cache PDF bytes atomically (write to a temp file, then rename)."""
    if not data:
        return
    try:
        path = os.path.join(_dir(), key + '.pdf')
        tmp = path + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(data)
        os.replace(tmp, path)
    except OSError as exc:  # pragma: no cover
        log.warning('pdf_cache write failed: %s', exc)


def delete(key: str) -> None:
    """Drop a cached PDF (used when a case is refreshed, so a re-open re-fetches)."""
    try:
        path = os.path.join(_dir(), key + '.pdf')
        if os.path.exists(path):
            os.remove(path)
    except OSError as exc:  # pragma: no cover
        log.warning('pdf_cache delete failed: %s', exc)
