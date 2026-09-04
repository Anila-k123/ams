"""Long-running scheduler for the background jobs — so nothing is triggered by hand.

Runs two idempotent jobs on a timer, in one process:

    process_notifications   drains the queue: delivers in-app bells + emails, and
                            retries anything an immediate send_now() couldn't push
                            (e.g. SMTP was briefly down).  Default: every 60s.
    scan_notifications      raises the reminders that are due (hearings in the next
                            two days, overdue invoices, overdue tasks).  Default:
                            every 15 min.  Deduped, so a frequent run is safe.

Client-facing emails (hearing scheduled, invoice raised, payment) are already sent
immediately at the moment of the action via send_now(); this scheduler is what makes
the *look-ahead reminders* and the *retry* automatic, with no manual step.

Run it as its own process, alongside the web server:

    python manage.py run_scheduler                 # loop forever (use run-scheduler.bat)
    python manage.py run_scheduler --once          # one cycle then exit (for cron / Task Scheduler)
    python manage.py run_scheduler --drain-interval 30 --scan-interval 600

In production keep it alive with a supervisor (NSSM as a Windows service, or
systemd on Linux) so it restarts on reboot/crash. A crash in one job never stops
the loop - each cycle is guarded.
"""

from __future__ import annotations

import logging
import time

from django.core.management import call_command
from django.core.management.base import BaseCommand

log = logging.getLogger('scheduler')


class Command(BaseCommand):
    help = 'Run the notification jobs on a timer (drain + due-reminder scan).'

    def add_arguments(self, parser):
        parser.add_argument('--drain-interval', type=int, default=60,
                            help='Seconds between process_notifications runs (min 15, default 60).')
        parser.add_argument('--scan-interval', type=int, default=900,
                            help='Seconds between scan_notifications runs (min 60, default 900).')
        parser.add_argument('--once', action='store_true',
                            help='Run one scan + drain and exit (for OS cron / Task Scheduler).')

    def _run(self, name):
        """Run one job; never let a failure stop the scheduler."""
        try:
            call_command(name, verbosity=0)
        except Exception as exc:                                # noqa: BLE001
            self.stderr.write(self.style.ERROR(
                '{}: {} — {}'.format(self._stamp(), name, exc)))
            log.exception('scheduler job %s failed', name)

    @staticmethod
    def _stamp():
        return time.strftime('%Y-%m-%d %H:%M:%S')

    def handle(self, *args, **o):
        if o['once']:
            self.stdout.write('{}: one-shot scan + drain'.format(self._stamp()))
            self._run('scan_notifications')
            self._run('process_notifications')
            return

        drain_every = max(15, o['drain_interval'])
        scan_every = max(60, o['scan_interval'])
        self.stdout.write(self.style.SUCCESS(
            '{}: scheduler up — drain every {}s, reminder scan every {}s. Ctrl+C to stop.'
            .format(self._stamp(), drain_every, scan_every)))

        # Do a full cycle at startup so a fresh start delivers anything waiting.
        self._run('scan_notifications')
        self._run('process_notifications')
        last_scan = last_drain = time.monotonic()

        try:
            while True:
                time.sleep(5)                       # coarse tick; intervals checked below
                now = time.monotonic()
                if now - last_scan >= scan_every:
                    self._run('scan_notifications')
                    last_scan = now
                if now - last_drain >= drain_every:
                    self._run('process_notifications')
                    last_drain = now
        except KeyboardInterrupt:
            self.stdout.write('\n{}: scheduler stopped.'.format(self._stamp()))
