"""The court order sync on its timer (the "PactPro Order Sync" task, tools/install-services.ps1).

Monday to Saturday, a round every 30 minutes from 10:00 to 18:00, plus one at 19:30 for orders the courts
upload after hours (docs/ORDER_SYNC.md); after that evening round, the appeal watch (`scan_appeals --watching`,
docs/APPEALS.md). A round that runs long simply delays the next one; slots missed
meanwhile are not made up one by one. Its own process: a slow court never holds up run_scheduler's
reminders and emails.

    python manage.py run_order_sync              # loop forever
    python manage.py run_order_sync --now        # one round straight away first
"""
import datetime
import logging
import time

from django.core.management.base import BaseCommand

log = logging.getLogger('scheduler')

DAYS = range(0, 6)                                         # Monday .. Saturday
SLOTS = [datetime.time(h, m) for h in range(10, 18) for m in (0, 30)] + [datetime.time(18, 0), datetime.time(19, 30)]


def next_slot(after):
    """The first sync time strictly after `after` (local time)."""
    day = after.date()
    for _ in range(8):
        if day.weekday() in DAYS:
            for t in SLOTS:
                at = datetime.datetime.combine(day, t)
                if at > after:
                    return at
        day += datetime.timedelta(days=1)
    raise RuntimeError('no sync slot in a week')


class Command(BaseCommand):
    help = 'Run the court order sync every 30 minutes in court hours (Mon-Sat 10:00-18:00) and at 19:30.'

    def add_arguments(self, parser):
        parser.add_argument('--now', action='store_true', help='Run one round straight away first.')

    def _round(self):
        from courtsearch.order_sync import sync_cycle
        try:
            counts = sync_cycle()
            self.stdout.write(f'{time.strftime("%Y-%m-%d %H:%M:%S")} order sync: checked {counts["checked"]}, '
                              f'new orders {counts["new_orders"]}, failed {counts["failed"]}')
        except Exception as exc:                           # noqa: BLE001 - the loop must keep going
            log.exception('order sync round failed')
            self.stderr.write(f'{time.strftime("%Y-%m-%d %H:%M:%S")} order sync failed: {type(exc).__name__}')

    def _appeal_watch(self):
        """After the evening round: look in the higher courts for appeals against cases decided for our clients
        (appeals/decisions.py; found ones go to Appeal Alerts with an alert)."""
        from django.core.management import call_command
        try:
            call_command('scan_appeals', watching=True, limit=25, stdout=self.stdout)
        except Exception as exc:                           # noqa: BLE001 - the loop must keep going
            log.exception('appeal watch failed')
            self.stderr.write(f'{time.strftime("%Y-%m-%d %H:%M:%S")} appeal watch failed: {type(exc).__name__}')

    def handle(self, *args, **opts):
        if opts.get('now'):
            self._round()
        while True:
            at = next_slot(datetime.datetime.now())
            self.stdout.write(f'{time.strftime("%Y-%m-%d %H:%M:%S")} next order sync at {at:%a %d %b %H:%M}')
            while datetime.datetime.now() < at:
                time.sleep(min(60, max(1, (at - datetime.datetime.now()).total_seconds())))
            self._round()
            if at.time() == SLOTS[-1]:                     # the 19:30 round: then the appeal watch
                self._appeal_watch()
