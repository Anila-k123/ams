"""Give in-app notifications something to link to.

    manage.py add_notification_links                      # report
    manage.py add_notification_links --apply              # add the columns
    manage.py add_notification_links --apply --backfill   # and link old rows

The `notifications` table held only id, created_at, message, read_status and
advocate_id. So a notification could say "Invoice INV-DEMO-1-1000 overdue by 58
day(s)" while recording nothing about which invoice that was - clicking one
could only mark it read, because there was no destination to go to.

The information was never missing, only discarded: notify() already carries
entity / entityId / caseId in the queue payload, and process_notifications threw
all of it away when writing the in-app row.

Three nullable columns, added the same way as advocate.parent_advocate_id -
this table is Spring-owned (managed = False) so there is no migration for it.
Nullable and additive, so existing rows and any remaining Spring code are
unaffected.
"""

from __future__ import annotations

import json

from django.core.management.base import BaseCommand
from django.db import connection

COLUMNS = [
    ('entity_type', 'VARCHAR(50)'),
    ('entity_id', 'BIGINT'),
    ('case_id', 'BIGINT'),
]


def existing_columns():
    with connection.cursor() as cur:
        cur.execute("""SELECT column_name FROM information_schema.columns
                       WHERE table_name = 'notifications'""")
        return {r[0] for r in cur.fetchall()}


class Command(BaseCommand):
    help = 'Add entity_type / entity_id / case_id to notifications.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true',
                            help='Add the columns (default: report only).')
        parser.add_argument('--backfill', action='store_true',
                            help='Also link existing notifications from the queue.')

    def handle(self, *args, **o):
        have = existing_columns()
        missing = [(n, t) for n, t in COLUMNS if n not in have]

        for name, _ddl in COLUMNS:
            self.stdout.write('  notifications.{:<12} {}'.format(
                name, 'present' if name in have else 'missing'))

        if missing and not o['apply']:
            self.stdout.write(self.style.WARNING(
                '{} column(s) missing. Re-run with --apply.'.format(len(missing))))
            return

        if missing:
            with connection.cursor() as cur:
                for name, ddl in missing:
                    cur.execute('ALTER TABLE notifications ADD COLUMN {} {} NULL'
                                .format(name, ddl))
                    self.stdout.write(self.style.SUCCESS('  added {}'.format(name)))

        if o['backfill']:
            self._backfill()
        elif not missing:
            self.stdout.write(self.style.SUCCESS('Nothing to do.'))

    def _backfill(self):
        """Link existing notifications using the queue rows that produced them.

        notification_queue keeps payload_json after sending, and the payload's
        `subject` is exactly what was written into notifications.message. So the
        target is recovered from real data rather than by parsing the message
        text - "Invoice INV-DEMO-1-1000 overdue" would be readable enough, but a
        backfill built on string scraping is the kind of thing that silently
        links the wrong record and nobody notices for months.

        Only rows with a matching queue payload are touched; anything older than
        the queue stays unlinked, which is the honest outcome.
        """
        from core.models import Notification, NotificationQueue

        targets = {}
        for q in NotificationQueue.objects.all().iterator():
            try:
                p = json.loads(q.payload_json or '{}')
            except ValueError:
                continue
            if p.get('channel') != 'IN_APP':
                continue
            subject = (p.get('subject') or '')[:255]
            if not subject or not (p.get('entity') or p.get('caseId')):
                continue
            # Same advocate and same text means the same target, so a repeated
            # message is not ambiguous - it is one reminder raised twice.
            targets[(q.advocate_id, subject)] = (
                (p.get('entity') or '')[:50] or None,
                p.get('entityId'), p.get('caseId'))

        linked = 0
        rows = Notification.objects.filter(entity_type__isnull=True,
                                           case_id__isnull=True)
        for n in list(rows):
            hit = targets.get((n.advocate_id, n.message))
            if not hit:
                continue
            n.entity_type, n.entity_id, n.case_id = hit
            n.save(update_fields=['entity_type', 'entity_id', 'case_id'])
            linked += 1

        remaining = Notification.objects.filter(
            entity_type__isnull=True, case_id__isnull=True).count()
        self.stdout.write(self.style.SUCCESS(
            'Backfill: linked {} notification(s) from queue payloads; '
            '{} still unlinked (no surviving queue row).'.format(linked, remaining)))
