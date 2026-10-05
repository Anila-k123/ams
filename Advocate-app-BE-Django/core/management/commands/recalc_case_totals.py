"""Recompute every case's money totals from its payments, expenses and invoices.

The totals on `cases` were never updated by the Django backend (see
core/finance.py), so every existing case shows Rs. 0. Run this once after
deploying the fix, and again any time the totals are in doubt: it only reads
the real rows and rewrites the four derived columns, so re-running is safe.

    manage.py recalc_case_totals
"""

from django.core.management.base import BaseCommand

from core.finance import recalc_case_totals
from core.models import Case


class Command(BaseCommand):
    help = "Recompute every case's paid / expenses / balance / pending totals."

    def handle(self, *args, **opts):
        changed = 0
        ids = list(Case.objects.values_list('id', flat=True))
        for cid in ids:
            before = Case.objects.filter(id=cid).values_list(
                'total_paid_by_client', 'total_expenses_so_far',
                'balance_in_account', 'pending_from_client').first()
            case = recalc_case_totals(cid)
            after = (case.total_paid_by_client, case.total_expenses_so_far,
                     case.balance_in_account, case.pending_from_client)
            if tuple(float(v or 0) for v in before) != tuple(float(v or 0) for v in after):
                changed += 1
                self.stdout.write('  {:<34} paid {:>10,.2f}  expenses {:>10,.2f}  pending {:>10,.2f}'.format(
                    (case.case_number or str(cid))[:34], after[0], after[1], after[3]))
        self.stdout.write(self.style.SUCCESS('{} case(s) checked, {} updated.'.format(len(ids), changed)))
