"""Write down subscriptions whose trial ended (they are already treated as
expired when checked), and release metered requests left RESERVED by a
process that died mid-way (> 2 hours). Data is never touched. Run by run_scheduler.

    manage.py subscription_sweep
"""
from django.core.management.base import BaseCommand

from core.jobs import job_run
from subscriptions.service import expire_due_trials, release_stale


class Command(BaseCommand):
    help = 'Mark trials that have ended as EXPIRED (read-only; no data is changed).'

    def handle(self, *args, **opts):
        with job_run('subscription_sweep') as run:
            run.counts['expired'] = expire_due_trials()
            run.counts['released'] = release_stale()
        self.stdout.write(f"{run.counts['expired']} trial(s) expired, "
                          f"{run.counts['released']} stale request(s) released.")
