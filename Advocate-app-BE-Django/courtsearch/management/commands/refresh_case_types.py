"""Admin-only refresh of stored court case types.

This is the ONLY way to re-scrape case types — there is no user-facing refresh, so
the government site is never hit on demand by end users. Run manually when a court is
known to have changed its case-type list, e.g.:

    python manage.py refresh_case_types              # refresh every court already stored
    python manage.py refresh_case_types madras_hc    # refresh one court
"""

from django.core.management.base import BaseCommand

from courtsearch import client
from courtsearch.models import CourtCaseTypes


class Command(BaseCommand):
    help = "Re-scrape and store court case types (admin-only; no user-facing refresh)."

    def add_arguments(self, parser):
        parser.add_argument(
            'court_id', nargs='?',
            help='Court to refresh. Omit to refresh every court already stored.',
        )

    def handle(self, *args, **options):
        court_id = options.get('court_id')
        if court_id:
            court_ids = [court_id]
        else:
            court_ids = list(CourtCaseTypes.objects.values_list('court_id', flat=True))
            if not court_ids:
                self.stdout.write('Nothing stored yet — pass a court_id to fetch it for the first time.')
                return

        for cid in court_ids:
            try:
                data = client.get_case_types(cid)
            except Exception as exc:  # noqa: BLE001
                self.stderr.write(self.style.ERROR(f'{cid}: refresh failed ({exc})'))
                continue
            CourtCaseTypes.objects.update_or_create(court_id=cid, defaults={'types': data})
            self.stdout.write(self.style.SUCCESS(f'{cid}: stored {len(data)} case types'))
