"""Trim the audit trail and activity feed to a retention window.

    manage.py prune_audit_log                 # keep 12 months, report only
    manage.py prune_audit_log --apply         # actually delete
    manage.py prune_audit_log --months 24 --apply

Nothing pruned these tables, and every write in the application appends to
them. At a few hundred rows a day that is fine for a year or two and then it is
somebody's Friday afternoon, so the job exists now rather than later.

Two deliberate choices:

  * Dry run by default. This deletes the record of what happened, which is the
    one thing you cannot reconstruct afterwards, so it does not run without
    --apply.

  * A floor on the retention window. Anything under three months is refused:
    an audit trail short enough to lose last quarter's activity is not serving
    the purpose it was built for, and a mistyped --months should not be able to
    empty the table.

Rows are deleted oldest-first in batches so a large first run does not hold one
long transaction over a table the application is still writing to.
"""

from __future__ import annotations

import datetime

from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.utils import timezone

# (table, timestamp column) - both are Spring-owned, hence raw SQL.
TARGETS = [('audit_log', 'created_at'), ('activities', 'timestamp')]

DEFAULT_MONTHS = 12
MIN_MONTHS = 3
BATCH = 5000


class Command(BaseCommand):
    help = 'Delete audit_log and activities rows older than the retention window.'

    def add_arguments(self, parser):
        parser.add_argument('--months', type=int, default=DEFAULT_MONTHS,
                            help='Retention window in months (default {}, minimum {}).'
                                 .format(DEFAULT_MONTHS, MIN_MONTHS))
        parser.add_argument('--apply', action='store_true',
                            help='Actually delete. Without this, only reports.')

    def handle(self, *args, **o):
        months = o['months']
        if months < MIN_MONTHS:
            raise CommandError(
                '--months {} is below the {}-month floor. An audit trail that '
                'short defeats its own purpose; raise MIN_MONTHS in this '
                'command if you genuinely mean it.'.format(months, MIN_MONTHS))

        # 30-day months are close enough for a retention cutoff, and avoid a
        # dateutil dependency for something nobody measures to the day.
        cutoff = timezone.now() - datetime.timedelta(days=months * 30)
        self.stdout.write('Retention: {} months (cutoff {:%Y-%m-%d}){}'.format(
            months, cutoff, '' if o['apply'] else '  [dry run]'))

        total = 0
        for table, col in TARGETS:
            total += self._prune(table, col, cutoff, o['apply'])

        if not o['apply']:
            self.stdout.write(self.style.WARNING(
                '{} row(s) would be deleted. Re-run with --apply.'.format(total)))
        else:
            self.stdout.write(self.style.SUCCESS(
                '{} row(s) deleted.'.format(total)))

    def _prune(self, table, col, cutoff, apply_it):
        with connection.cursor() as cur:
            cur.execute('SELECT count(*), min({0}) FROM {1} WHERE {0} < %s'
                        .format(col, table), [cutoff])
            count, oldest = cur.fetchone()

        self.stdout.write('  {}: {} row(s) older than the window{}'.format(
            table, count,
            ' (oldest {:%Y-%m-%d})'.format(oldest) if oldest else ''))
        if not count or not apply_it:
            return count

        deleted = 0
        while True:
            with connection.cursor() as cur:
                # Batched by primary key so each statement is short-lived; the
                # application keeps writing to these tables while this runs.
                cur.execute(
                    'DELETE FROM {0} WHERE id IN ('
                    '  SELECT id FROM {0} WHERE {1} < %s ORDER BY {1} LIMIT %s'
                    ')'.format(table, col), [cutoff, BATCH])
                n = cur.rowcount
            deleted += n
            if n < BATCH:
                break
        self.stdout.write('    deleted {}'.format(deleted))
        return deleted
