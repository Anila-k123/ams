"""Pull a court's published cause list for a day and store it.

    manage.py sync_causelist                     # sci, today
    manage.py sync_causelist --court sci --date 2026-09-02
    manage.py sync_causelist --days 2            # today and tomorrow

Run once in the early morning, after the court has published. Everything
user-facing reads the stored rows, never the scraper: fetching means several
multi-megabyte PDFs parsed upstream (~47s for the Supreme Court), which must not
sit inside a page load.

A day's rows are REPLACED, not merged. Courts revise lists during the day, and a
stale row surviving a re-fetch would put a client at the wrong position in the
queue - worse than having no cause list at all. Replacing also makes re-running
safe at any time.
"""

from __future__ import annotations

import datetime

from django.core.management.base import BaseCommand
from django.db import transaction

from courtsearch import client as court_client
from courtsearch import matching
from courtsearch.models import CauseListItem


class Command(BaseCommand):
    help = "Fetch and store a court's daily cause list."

    def add_arguments(self, parser):
        parser.add_argument('--court', default='sci',
                            help='Provider key (default: sci).')
        parser.add_argument('--date', default=None,
                            help='yyyy-mm-dd; defaults to today.')
        parser.add_argument('--days', type=int, default=1,
                            help='Number of consecutive days from --date '
                                 '(default 1). Courts publish a day or two '
                                 'ahead, so 2 keeps tomorrow ready.')

    def handle(self, *args, **o):
        court = o['court']
        try:
            start = (datetime.datetime.strptime(o['date'], '%Y-%m-%d').date()
                     if o['date'] else datetime.date.today())
        except ValueError:
            self.stderr.write('--date must be yyyy-mm-dd')
            return

        # District courts are CAPTCHA-gated, so they are fetched a different way:
        # scoped to only the courtrooms where a case actually sits (derived from
        # the practice's own imported cases), via a POST that carries the scope.
        district = court in matching.DISTRICT_COURTS
        targets = matching.district_scope(court) if district else None
        if district and not targets:
            self.stdout.write(
                'No imported cases resolve to {} (need the cascade context that '
                'a case-number/party import stores), so there is nothing to '
                'fetch. Import a {} case first.'.format(court, court))
            return

        total = 0
        for offset in range(max(1, o['days'])):
            on = start + datetime.timedelta(days=offset)
            try:
                data = (court_client.get_district_causelist(court, on, targets)
                        if district else court_client.get_causelist(court, on))
            except court_client.ScraperUnavailable:
                self.stderr.write(self.style.ERROR(
                    'Scraper service unreachable - is it running on port 8000?'))
                return
            except court_client.ScraperError as exc:
                self.stderr.write(self.style.ERROR(
                    '{}: upstream error {}'.format(on, exc)))
                continue

            rows = data.get('rows') or []
            # Only confirmed listings drive "your item"; the Supreme Court's
            # ADVANCE list is explicitly tentative.
            rows = [r for r in rows if (r.get('listType') or 'DAILY') == 'DAILY']

            with transaction.atomic():
                deleted, _ = (CauseListItem.objects
                              .filter(court=court, list_date=on).delete())
                CauseListItem.objects.bulk_create([
                    CauseListItem(
                        court=court,
                        list_date=on,
                        court_number=r.get('courtNumber') or '',
                        item_number=r.get('itemNumber') or '',
                        case_string=(r.get('caseString') or '')[:255],
                        case_type=r.get('caseType') or '',
                        case_no=r.get('caseNo') or '',
                        case_year=r.get('caseYear') or '',
                        diary_number=r.get('diaryNumber') or '',
                        list_type=r.get('listType') or 'DAILY',
                        source=(r.get('source') or '')[:128],
                    ) for r in rows
                ], batch_size=500)

            rooms = len({r.get('courtNumber') for r in rows if r.get('courtNumber')})
            total += len(rows)
            self.stdout.write(self.style.SUCCESS(
                '{} {}: stored {} items across {} courtrooms '
                '(replaced {}).'.format(court, on, len(rows), rooms, deleted)))

            # Tell each practice about its own matters in this list - in-app for
            # everyone, email for those who opted in. Best-effort: a failure here
            # must not undo a stored cause list.
            try:
                from notifications.causelist_alerts import causelist_alerts
                labels = {c.get('value'): c.get('label')
                          for c in (data.get('courts') or []) if c.get('value')}
                n = len(causelist_alerts(on, court=court, labels=labels))
                if n:
                    self.stdout.write(
                        '  alerted: queued {} listing notification(s).'.format(n))
            except Exception as exc:                            # noqa: BLE001
                self.stderr.write(
                    self.style.WARNING('  alert step failed: {}'.format(exc)))

        if total == 0:
            self.stdout.write(
                'Nothing stored - the court may not have published yet, '
                'or the day is a holiday.')
