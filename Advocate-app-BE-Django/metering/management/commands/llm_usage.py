"""Print AI token usage and estimated cost.

    manage.py llm_usage                       # all time, by feature
    manage.py llm_usage --by user --from 2026-10-01 --to 2026-10-31
    manage.py llm_usage --by model

Groups: feature (chat / summary / draft / translation), operation, user, firm, model.
Cost uses LLM_PRICES from .env (per 1M tokens); see metering/report.py.
"""

import datetime

from django.core.management.base import BaseCommand, CommandError

from metering.report import GROUPS, summarize


def _date(value):
    if not value:
        return None
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        raise CommandError('Dates are YYYY-MM-DD, got {!r}'.format(value))


class Command(BaseCommand):
    help = 'AI token usage and estimated cost, grouped by feature, user, firm or model.'

    def add_arguments(self, parser):
        parser.add_argument('--by', default='feature', choices=sorted(GROUPS))
        parser.add_argument('--from', dest='start')
        parser.add_argument('--to', dest='end')

    def handle(self, *args, by, start, end, **opts):
        data = summarize(_date(start), _date(end), by)
        names = {}
        if by in ('user', 'firm'):
            from core.models import Advocate
            ids = [g['key'] for g in data['groups'] if g['key']]
            names = dict(Advocate.objects.filter(id__in=ids).values_list('id', 'full_name'))
        head = '{:<28} {:>7} {:>13} {:>12} {:>9} {:>12}'
        self.stdout.write(head.format(by, 'calls', 'input', 'output', 'estimated',
                                      'cost ' + data['currency']))
        self.stdout.write('-' * 86)
        for g in data['groups']:
            key = names.get(g['key'], g['key']) if by in ('user', 'firm') else g['key']
            self.stdout.write(head.format(
                str(key if key is not None else '(none)')[:28], g['calls'],
                '{:,}'.format(g['input_tokens']), '{:,}'.format(g['output_tokens']),
                g['estimated_calls'], '{:,.4f}'.format(g['cost'])))
        t = data['total']
        self.stdout.write('-' * 86)
        self.stdout.write(head.format('TOTAL', t['calls'], '{:,}'.format(t['input_tokens']),
                                      '{:,}'.format(t['output_tokens']), t['estimated_calls'],
                                      '{:,.4f}'.format(t['cost'])))
        if t['unpriced_tokens']:
            self.stdout.write(self.style.WARNING(
                '{:,} tokens are on models with no price in LLM_PRICES (not in the cost).'.format(
                    t['unpriced_tokens'])))
        if t['characters']:
            self.stdout.write('Translation: {:,} characters (billed per character).'.format(
                t['characters']))
