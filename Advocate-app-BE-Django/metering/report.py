"""Usage totals by feature / user / firm / model, with an estimated cost.

Shared by `manage.py llm_usage` and GET /api/usage/summary so both always
agree. Cost uses settings.LLM_PRICES (per 1M tokens, [input, output]) at
report time; a model without a price shows tokens but no cost.
"""

import datetime

from django.conf import settings
from django.db.models import Count, Q, Sum

from .models import LLMUsage

GROUPS = {'feature': 'feature', 'operation': 'operation', 'user': 'advocate_id',
          'firm': 'practice_id', 'model': 'model'}


def _price(model):
    p = (getattr(settings, 'LLM_PRICES', {}) or {}).get(model)
    if isinstance(p, (list, tuple)) and len(p) == 2:
        return float(p[0]), float(p[1])
    return None


def summarize(start=None, end=None, by='feature', practice_id=None):
    """{groups: [{key, calls, input_tokens, output_tokens, total_tokens,
    estimated_calls, characters, cost, unpriced_tokens}], total, ...},
    groups sorted by total tokens."""
    field = GROUPS.get(by, 'feature')
    qs = LLMUsage.objects.all()
    if start:
        qs = qs.filter(created_at__date__gte=start)
    if end:
        qs = qs.filter(created_at__date__lte=end)
    if practice_id:
        qs = qs.filter(practice_id=practice_id)
    # Per (group, model) first, because the price depends on the model.
    rows = (qs.values(field, 'model')
            .annotate(calls=Count('id'), input_tokens=Sum('input_tokens'),
                      output_tokens=Sum('output_tokens'), characters=Sum('characters'),
                      estimated_calls=Count('id', filter=Q(estimated=True))))
    out = {}
    for r in rows:
        key = r[field]
        g = out.setdefault(key, {'key': key, 'calls': 0, 'input_tokens': 0, 'output_tokens': 0,
                                 'total_tokens': 0, 'estimated_calls': 0, 'characters': 0,
                                 'cost': 0.0, 'unpriced_tokens': 0})
        i, o = r['input_tokens'] or 0, r['output_tokens'] or 0
        g['calls'] += r['calls']
        g['input_tokens'] += i
        g['output_tokens'] += o
        g['total_tokens'] += i + o
        g['estimated_calls'] += r['estimated_calls']
        g['characters'] += r['characters'] or 0
        price = _price(r['model'])
        if price:
            g['cost'] += i / 1e6 * price[0] + o / 1e6 * price[1]
        else:
            g['unpriced_tokens'] += i + o
    groups = sorted(out.values(), key=lambda g: g['total_tokens'], reverse=True)
    for g in groups:
        g['cost'] = round(g['cost'], 4)
    total = {k: sum(g[k] for g in groups) for k in
             ('calls', 'input_tokens', 'output_tokens', 'total_tokens', 'estimated_calls',
              'characters', 'unpriced_tokens')}
    total['cost'] = round(sum(g['cost'] for g in groups), 4)
    return {'by': by, 'currency': getattr(settings, 'LLM_PRICE_CURRENCY', 'USD'),
            'from': start.isoformat() if isinstance(start, datetime.date) else start,
            'to': end.isoformat() if isinstance(end, datetime.date) else end,
            'groups': groups, 'total': total}
