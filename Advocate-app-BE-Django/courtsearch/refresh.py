"""Re-reading a case's court record from the scraper: shared by the case page's Refresh
(views.RefreshCourtRecordView) and the background order sync (order_sync.py)."""
import datetime

from . import client


class NotRefreshable(Exception):
    """This court's records can't be refreshed (only eCourts HC / DC and the Supreme Court can)."""


def fetch_fresh(rec, timeout=None):
    """The record's current court data (same shape as rec.raw). Raises client.ScraperUnavailable /
    ScraperError when the scraper or the court fails, NotRefreshable for other courts."""
    court_id = rec.court_id
    old_raw = rec.raw or {}
    query = rec.query or {}
    if court_id == 'sci':
        return client.sci_case_detail(query.get('diary_no'), query.get('diary_year'), expand=True, timeout=timeout)
    if court_id in ('ecourts_hc', 'ecourts_dc'):
        fresh_cases = []
        for c in old_raw.get('cases', []) or []:
            vt = c.get('view_token')
            if not vt:
                fresh_cases.append(c)
                continue
            if court_id == 'ecourts_hc':
                resp = client.hc_case_detail(vt, timeout=timeout)
            else:
                resp = client.post_json('/courts/ecourts_dc/case:detail',
                                        {'court_complex': query.get('court_complex', ''), 'view_token': vt},
                                        timeout=timeout)
            got = (resp.get('cases') if isinstance(resp, dict) else None) or []
            fresh_cases.extend(got if got else [c])
        return {'cases': fresh_cases}
    raise NotRefreshable(court_id)


def store_fresh(rec, old_raw, new_raw):
    """Keep the fresh data; drop cached order PDFs whose identifiers may have changed."""
    from .views import _bust_order_cache
    _bust_order_cache(old_raw)
    _bust_order_cache(new_raw)
    rec.raw = new_raw
    rec.fetched_at = datetime.datetime.now()
    rec.save(update_fields=['raw', 'fetched_at'])
