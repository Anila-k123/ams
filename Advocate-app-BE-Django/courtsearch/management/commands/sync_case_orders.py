"""One round of the court order sync (courtsearch/order_sync.py, docs/ORDER_SYNC.md).

    python manage.py sync_case_orders                 # due cases, until the time budget runs out
    python manage.py sync_case_orders --budget 300    # stop starting new cases after 5 minutes
    python manage.py sync_case_orders --case 116      # just this case (testing)

`run_order_sync` (the PactPro Order Sync task) runs a round every 30 minutes in court hours.
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Re-read imported cases from the courts; save and announce new orders.'

    def add_arguments(self, parser):
        parser.add_argument('--budget', type=int, default=25 * 60, help='Seconds to keep starting cases (25 min).')
        parser.add_argument('--case', type=int, help='Only this case id.')

    def handle(self, *args, **opts):
        from courtsearch import order_sync
        if opts.get('case'):
            from courtsearch.models import ImportedCaseRecord
            from courtsearch.refresh import fetch_fresh, store_fresh
            rec = ImportedCaseRecord.objects.filter(case_id=opts['case']).order_by('-id').first()
            if rec is None:
                self.stderr.write('No imported court record for that case.')
                return
            old = rec.raw or {}
            store_fresh(rec, old, fetch_fresh(rec, timeout=240))
            known = order_sync.CaseOrderSync.objects.filter(case_id=rec.case_id).exists()
            found = order_sync.take_new_orders(rec, old if known else None)
            self.stdout.write(f'case {rec.case_id}: {len(found)} new order(s)'
                              + ('' if known else ' (first look: existing orders recorded, no alerts)'))
            return
        counts = order_sync.sync_cycle(budget_seconds=opts['budget'])
        self.stdout.write(f"checked {counts['checked']}, new orders {counts['new_orders']}, failed {counts['failed']}")
