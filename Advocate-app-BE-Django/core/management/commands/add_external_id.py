"""Add the cross-app identity column to the advocate table.

    manage.py add_external_id        # add the column + unique index, then report

`advocate` is a Spring-owned table with managed = False, so there is no Django
migration for it - the same reason enable_shared_practice / seed_admin_permissions
exist. The DDL here is idempotent and additive: one NULLABLE uuid column with no
default, plus a UNIQUE index that only applies to non-NULL values.

external_id is the permanent identity minted by ABS (the identity provider). AMS
never generates its own - the column starts empty and is filled later by the
backfill (matching advocates to ABS users by email) or on first login with an
ABS-issued token. A partial unique index (WHERE external_id IS NOT NULL) lets the
16 existing advocates coexist as NULL now while still guaranteeing uniqueness once
values land.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import connection

from core.models import Advocate

COLUMN = 'external_id'
INDEX = 'advocate_external_id_uniq'


def column_exists(name=COLUMN):
    with connection.cursor() as cur:
        cur.execute("""SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'advocate' AND column_name = %s""",
                    [name])
        return cur.fetchone() is not None


class Command(BaseCommand):
    help = 'Add advocate.external_id (nullable uuid) and its partial unique index.'

    def handle(self, *args, **o):
        self._ensure_column()
        self._report()

    # -- schema ------------------------------------------------------------

    def _ensure_column(self):
        with connection.cursor() as cur:
            if column_exists():
                self.stdout.write('Column advocate.{} already present.'.format(COLUMN))
            else:
                # Nullable, no default: older code and any remaining Spring
                # entities simply never mention it.
                cur.execute('ALTER TABLE advocate ADD COLUMN {} uuid NULL'.format(COLUMN))
                self.stdout.write(self.style.SUCCESS(
                    'Added advocate.{} (nullable uuid).'.format(COLUMN)))
            # Partial unique index: enforces uniqueness among filled values while
            # allowing many NULLs during the pre-backfill window.
            cur.execute(
                'CREATE UNIQUE INDEX IF NOT EXISTS {} ON advocate ({}) '
                'WHERE {} IS NOT NULL'.format(INDEX, COLUMN, COLUMN))
        self.stdout.write(self.style.SUCCESS(
            'Unique index {} ensured.'.format(INDEX)))

    # -- reporting ---------------------------------------------------------

    def _report(self):
        total = Advocate.objects.count()
        linked = Advocate.objects.filter(external_id__isnull=False).count()
        self.stdout.write('')
        self.stdout.write('Advocates: {} total, {} linked to an ABS identity, '
                          '{} still empty.'.format(total, linked, total - linked))
