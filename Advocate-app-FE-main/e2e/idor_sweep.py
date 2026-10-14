"""Cross-firm IDOR sweep against the running E2E backend (:8090, pactpro_e2e).

Run by e2e/03-isolation.spec.ts through `manage.py shell`. Input (env
E2E_SWEEP_IN, a JSON file): firm B's record ids and its secret marker, and the
bearer tokens of the callers (firm A admin, firm A junior, a platform operator,
firm A's client). For every API route, every numeric / uuid slot is filled with
each of B's ids that can fit it, and the route is called with every method.
Output (E2E_SWEEP_OUT): every response whose body contains B's marker (a leak),
every 2xx answer to a mutating method (to review), and per-caller counts.
Refuses any database other than pactpro_e2e. Never touches another host.
"""
import itertools
import json
import os
import re
import urllib.error
import urllib.request

from django.db import connection
from django.urls import get_resolver
from django.urls.resolvers import RoutePattern, URLResolver

assert connection.settings_dict['NAME'] == 'pactpro_e2e'
BASE = 'http://127.0.0.1:8090/'
cfg = json.load(open(os.environ['E2E_SWEEP_IN'], encoding='utf-8'))
ids, marker = cfg['ids'], cfg['marker']

# Never call these: they would end the caller's own session mid-sweep or reach outside.
SKIP = re.compile(r'(logout|revoke-sessions|backup/restore|courtsearch|court|causelist|display-board|scraper|'
                  r'whatsapp|webhook|assistant/chat|assistant/stream|drafting/.*/(generate|regenerate|translate|refine|'
                  r'reprocess|consistency-check|analyse-risks)|appeals/scan)', re.I)


def routes():
    out = []

    def walk(ps, prefix=''):
        for p in ps:
            if isinstance(p, URLResolver):
                walk(p.url_patterns, prefix + _txt(p.pattern))
            else:
                out.append(prefix + _txt(p.pattern))
    walk(get_resolver().url_patterns)
    return sorted({r for r in out if r.lstrip('^').startswith('api/')})


def _txt(p):
    s = str(p)
    return s if isinstance(p, RoutePattern) else s.lstrip('^').rstrip('$').replace('\\Z', '')


SLOT = re.compile(r'<(?:(\w+):)?(\w+)>|\(\?P<(\w+)>[^)]*\)')


def fill(route):
    slots = SLOT.findall(route)
    if any((conv or '') in ('drf_format_suffix',) or name == 'format' or rx == 'format'
           for conv, name, rx in slots):
        return []
    choices = []
    for conv, name, rx in slots:
        key = name or rx
        if conv == 'uuid' or key == 'public_id':
            choices.append([ids['firmUuid']])
        elif key in ('action', 'step', 'type', 'sub_dir', 'court_id', 'filename'):
            choices.append([{'action': 'suspend', 'step': '1', 'type': 'case', 'sub_dir': 'branding',
                             'court_id': '1', 'filename': ids.get('storedName', 'x.pdf')}[key]])
        else:
            choices.append(sorted(set(ids['numeric'])))
    urls = []
    for combo in itertools.product(*choices):
        it = iter(combo)
        urls.append(SLOT.sub(lambda m: str(next(it)), route).replace('^', ''))
    return urls[:40]


def call(method, url, token):
    req = urllib.request.Request(BASE + url, method=method, headers={'Authorization': f'Bearer {token}',
                                                                      'Content-Type': 'application/json'},
                                 data=b'{}' if method != 'GET' else None)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read()[:200000].decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:20000].decode('utf-8', 'replace')
    except Exception as e:                                       # noqa: BLE001
        return 0, type(e).__name__


result = {'leaks': [], 'mutations2xx': [], 'calls': 0, 'byCaller': {}}
targets = [(r, u) for r in routes() if not SKIP.search(r) for u in (fill(r) if '<' in r or '(?P' in r else [r.replace('^', '')])]
methods = cfg.get('methods', ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
for who, token in cfg['tokens'].items():
    counts = {}
    # Every caller reads everything; the mutating sweep runs as the most
    # privileged firm user (firm A's administrator) - a junior can do less.
    allowed = methods if who in cfg.get('mutators', []) else ['GET']
    for route, url in targets:
        for method in allowed:
            if method != 'GET' and '<' not in route and '(?P' not in route:
                continue                       # mutations only where an id of firm B is in the URL
            status, body = call(method, url, token)
            result['calls'] += 1
            counts[status] = counts.get(status, 0) + 1
            if marker in body:
                result['leaks'].append({'who': who, 'method': method, 'url': url, 'status': status,
                                        'excerpt': body[max(0, body.find(marker) - 80): body.find(marker) + 80]})
            elif method != 'GET' and 200 <= status < 300:
                result['mutations2xx'].append({'who': who, 'method': method, 'url': url, 'status': status,
                                               'body': body[:160]})
    result['byCaller'][who] = counts
json.dump(result, open(os.environ['E2E_SWEEP_OUT'], 'w', encoding='utf-8'), indent=1)
print('SWEEP_DONE', result['calls'], len(result['leaks']), len(result['mutations2xx']))
