"""Check that tenancy data is consistent. Read-only.

    manage.py verify_tenancy [--strict]

Fails (exit 1) on:
- an identity with more than one ACTIVE membership;
- a row whose firm_id differs from its creator's firm;
- parent/child rows in different firms (a case and its client, a document
  and its case, ...);
- an UNEXPECTED PRIVILEGE EXPANSION in the shadow comparison (someone would
  see more under firm scoping than legacy scoping, outside the expected
  firm-wide case) - this blocks rollout.
Reports (and with --strict fails on): rows still without a firm, unexpected
access loss, and ownership anomalies.
Ids and counts only.
"""
from collections import Counter

from django.apps import apps
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connection
from django.db.models import Count

from firms.tenancy import CONSISTENCY, DERIVED, OWNED


class Command(BaseCommand):
    help = 'Read-only consistency check of firms, memberships and firm ownership.'

    def add_arguments(self, parser):
        parser.add_argument('--strict', action='store_true')

    def handle(self, *args, **opts):
        if not settings.TENANCY_COLUMNS:
            raise CommandError('TENANCY_COLUMNS is off: nothing to verify on this database yet.')
        with connection.cursor() as cur:
            cur.execute('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
        from core import tenant
        from core.practice import _legacy_practice_ids
        FirmMembership = apps.get_model('firms', 'FirmMembership')
        Advocate = apps.get_model('core', 'Advocate')
        errors, warnings = [], []

        multi = (FirmMembership.objects.filter(status=FirmMembership.ACTIVE).values('advocate_id')
                 .annotate(n=Count('id')).filter(n__gt=1))
        for row in multi:
            errors.append(f'identity {row["advocate_id"]} has {row["n"]} active memberships')

        member_firm = {}
        for adv, fid in FirmMembership.objects.order_by('id').values_list('advocate_id', 'firm_id'):
            member_firm.setdefault(adv, fid)

        for label, column in OWNED:
            model = apps.get_model(label)
            unowned = model.objects.filter(firm_id__isnull=True).count()
            if unowned:
                warnings.append(f'{label}: {unowned} row(s) without a firm')
            bad = 0
            for owner, fid in model.objects.exclude(firm_id__isnull=True).values_list(column, 'firm_id'):
                if owner in member_firm and member_firm[owner] != fid:
                    bad += 1
            if bad:
                errors.append(f'{label}: {bad} row(s) whose firm differs from their creator\'s firm')
        for label, _column, _parent in DERIVED:
            unowned = apps.get_model(label).objects.filter(firm_id__isnull=True).count()
            if unowned:
                warnings.append(f'{label}: {unowned} row(s) without a firm')

        for child_label, column, parent_label in CONSISTENCY:
            child, parent = apps.get_model(child_label), apps.get_model(parent_label)
            parent_firm = dict(parent.objects.exclude(firm_id__isnull=True).values_list('id', 'firm_id'))
            bad = sum(1 for ref, fid in child.objects.exclude(firm_id__isnull=True).values_list(column, 'firm_id')
                      if ref in parent_firm and parent_firm[ref] != fid)
            if bad:
                errors.append(f'{child_label}.{column}: {bad} row(s) in a different firm from their {parent_label}')

        # Shadow comparison for every staff identity: legacy scope vs firm scope.
        tally = Counter()
        for adv in Advocate.objects.filter(id__in=FirmMembership.objects.filter(
                kind=FirmMembership.STAFF).values('advocate_id')):
            for kind, count in tenant.classify(adv, _legacy_practice_ids(adv), tenant.firm_scope_ids(adv)):
                tally[kind] += 1
                if kind == tenant.EXPANSION:
                    errors.append(f'identity {adv.id}: unexpected privilege expansion ({count} extra ids)')
        for kind in (tenant.LOSS, tenant.ANOMALY):
            if tally[kind]:
                warnings.append(f'shadow: {tally[kind]} identity(ies) with {kind}')
        if tally[tenant.EXPECTED]:
            self.stdout.write(f'shadow: {tally[tenant.EXPECTED]} identity(ies) gain access as expected '
                              '(firm-wide roles now see their whole firm)')

        for w in warnings:
            self.stdout.write(self.style.WARNING('WARNING: ' + w))
        for e in errors:
            self.stdout.write(self.style.ERROR('ERROR: ' + e))
        if errors or (opts['strict'] and warnings):
            raise SystemExit(1)
        self.stdout.write(self.style.SUCCESS('Tenancy data is consistent.'))
