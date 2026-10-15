"""Create any missing plan / entitlement row (never changes existing ones).

    manage.py seed_plans
"""
from django.core.management.base import BaseCommand

from subscriptions.catalogue import ensure_plans


class Command(BaseCommand):
    help = 'Create missing AMS plans and their entitlements (existing rows are left as they are).'

    def handle(self, *args, **opts):
        self.stdout.write(f'{ensure_plans()} row(s) created.')
