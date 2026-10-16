"""Make Appeal Alerts' decisions for cases decided before the feature existed, quietly (no alerts).
Deploy step, safe to run again (appeals/decisions.py, docs/APPEALS.md).

    python manage.py backfill_decisions
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Record decisions for already-decided cases (no alerts).'

    def handle(self, *args, **opts):
        from appeals.decisions import backfill
        self.stdout.write(f'{backfill()} decision(s) recorded.')
