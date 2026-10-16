"""The orders / judgments in a stored court record, one list for every court (docs/ORDER_SYNC.md).

Each court keeps them differently in ImportedCaseRecord.raw:
- eCourts High Court:     cases[].detail.orders[] with a `pdf_url` on hcservices.ecourts.gov.in;
- eCourts District Court: cases[].detail.orders[] with a `pdf` token, opened with the case's view_token;
- Supreme Court:          links to api.sci.gov.in/...pdf inside the "Judgment/Orders" section's HTML.

order_entries() turns any of them into [{key, number, date, details, ...}], `key` being stable for one order
across refreshes (the court's file name / link, else number + date), so a new order is one whose key wasn't
there before. fetch_pdf() gets an order's PDF through the scraper (or the court's public link for the
Supreme Court), using the same cache as opening it on the page.
"""
import hashlib
import html as _html
import logging
import re
from urllib.parse import parse_qs, urlparse

log = logging.getLogger(__name__)

_SCI_LINK = re.compile(r'<a[^>]+href="(https?://[^"]+\.pdf)"[^>]*>\s*([^<]*?)\s*</a>\s*(?:&nbsp;?)*\s*(?:\[([^\]]*)\])?',
                       re.IGNORECASE)


def _digest(*parts):
    return hashlib.sha1('|'.join(str(p or '') for p in parts).encode('utf-8')).hexdigest()[:20]


def order_entries(court_id, raw):
    """The record's orders, oldest first as the court lists them. Each: {key, number, date, details, court_id,
    plus what fetch_pdf needs (pdf_url / pdf + view_token / url)}."""
    raw = raw if isinstance(raw, dict) else {}
    out = []
    if court_id in ('ecourts_hc', 'ecourts_dc'):
        for c in raw.get('cases') or []:
            detail = (c or {}).get('detail') or {}
            for o in detail.get('orders') or []:
                if not isinstance(o, dict):
                    continue
                number, date = o.get('order_number'), o.get('order_date')
                details = o.get('order_details') or ''        # HC's order_on is the case number
                entry = {'court_id': court_id, 'number': number, 'date': date, 'details': details}
                if o.get('pdf_url'):                       # High Court: the file name is the order's id
                    q = parse_qs(urlparse(o['pdf_url']).query)
                    entry['key'] = 'hc:' + _digest((q.get('filename') or [o['pdf_url']])[0])
                    entry['pdf_url'] = o['pdf_url']
                elif isinstance(o.get('pdf'), dict) and o['pdf'].get('filename'):
                    entry['key'] = 'dc:' + _digest(o['pdf']['filename'])
                    entry['pdf'] = o['pdf']
                    entry['view_token'] = c.get('view_token')
                else:
                    entry['key'] = f'{court_id}:' + _digest(number, date, details)
                out.append(entry)
    elif court_id == 'sci':
        seen = set()
        for s in raw.get('sections') or []:
            text = s.get('html') if isinstance(s, dict) else None
            if not text or 'Judgment/Order' not in text:
                continue
            for url, label, kind in _SCI_LINK.findall(text):
                if url in seen:
                    continue
                seen.add(url)
                out.append({'court_id': court_id, 'key': 'sci:' + _digest(url), 'number': None,
                            'date': _html.unescape(label).strip(), 'details': (kind or 'Order').strip(), 'url': url})
    return out


def label(entry):
    """How an order is named in alerts and as a document: "Order 3 dated 21-01-2025 (Judgment)"."""
    parts = ['Order']
    if entry.get('number'):
        parts.append(str(entry['number']))
    if entry.get('date'):
        parts.append(f'dated {entry["date"]}')
    text = ' '.join(parts)
    details = (entry.get('details') or '').strip()
    return f'{text} ({details})' if details and details.lower() != 'order' else text


def fetch_pdf(rec, entry, timeout=120):
    """The order's PDF bytes, or None when the court has none for it or it can't be fetched now."""
    from . import client, pdf_cache
    try:
        if entry.get('pdf_url'):
            cache_key = pdf_cache.key_for(entry['pdf_url'])
            data = pdf_cache.get(cache_key)
            if data is None:
                resp = client.hc_open_order_pdf(entry['pdf_url'])
                data = resp.content if resp.status_code == 200 else None
        elif entry.get('pdf'):
            cache_key = pdf_cache.key_for(entry['pdf'])
            data = pdf_cache.get(cache_key)
            if data is None:
                resp = client.open_document_stream({
                    'court_complex': str((rec.query or {}).get('court_complex') or ''),
                    'view_token': entry.get('view_token'), 'kind': 'order_pdf', 'token': entry['pdf']})
                data = resp.content if resp.status_code == 200 else None
        elif entry.get('url'):
            import requests
            cache_key = pdf_cache.key_for(entry['url'])
            data = pdf_cache.get(cache_key)
            if data is None:
                resp = requests.get(entry['url'], timeout=timeout)
                data = resp.content if resp.status_code == 200 else None
        else:
            return None
    except Exception as exc:                               # noqa: BLE001 - try again next round
        log.warning('order PDF for case %s not fetched: %s', rec.case_id, type(exc).__name__)
        return None
    if not data or data[:4] != b'%PDF':
        return None
    pdf_cache.put(cache_key, data)
    return data
