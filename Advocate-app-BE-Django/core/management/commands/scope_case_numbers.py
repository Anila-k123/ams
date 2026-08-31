"""Make cases.case_number unique PER ADVOCATE instead of globally.

    manage.py scope_case_numbers            # report
    manage.py scope_case_numbers --apply    # swap the constraint

The Spring schema put a global UNIQUE on cases.case_number. That is defensible
for one advocate per database and wrong the moment there are several: only one
advocate in the whole system can track any given case number. Add
CRL.A/1234/2026 when opposing counsel already has it and you get "Case number
already exists" for a case you cannot see and have no connection to - which
also quietly tells you somebody else in the system holds it.

Court numbering makes this worse, not better. A district case number like
123/2024 exists in hundreds of district courts; it is unique within a court, not
nationally. The nationally unique identifier is the CNR, and `cases` has no CNR
column - case_number holds whichever the advocate happened to type.

So: UNIQUE (advocate_id, case_number). One advocate cannot hold the same number
twice; different advocates are independent. Court-qualified uniqueness
(court + type + number + year) is the better long-term shape and belongs with
adding a real CNR field - this does not block that.

The table is Spring-owned (managed = False), hence a command rather than a
migration. If any Spring service still runs against this database with
Hibernate schema validation enabled, it may object to the constraint name
changing; nothing about the data changes.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

OLD_CONSTRAINT = 'ukd2x5t06l1d3krie16abr38r0y'   # Hibernate-generated name
NEW_CONSTRAINT = 'cases_advocate_case_number_key'


def _constraints():
    with connection.cursor() as cur:
        cur.execute("""SELECT con.conname, pg_get_constraintdef(con.oid)
                       FROM pg_constraint con
                       JOIN pg_class rel ON rel.oid = con.conrelid
                       WHERE rel.relname = 'cases' AND con.contype = 'u'""")
        return dict(cur.fetchall())


def _duplicates():
    """Rows that would violate the new constraint."""
    with connection.cursor() as cur:
        cur.execute("""SELECT advocate_id, case_number, count(*)
                       FROM cases GROUP BY advocate_id, case_number
                       HAVING count(*) > 1 ORDER BY count(*) DESC""")
        return cur.fetchall()


class Command(BaseCommand):
    help = 'Scope cases.case_number uniqueness to the advocate.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true',
                            help='Swap the constraint (default: report only).')
        parser.add_argument('--revert', action='store_true',
                            help='Put the global constraint back.')

    def handle(self, *args, **o):
        existing = _constraints()
        self.stdout.write('Unique constraints on `cases`:')
        for name, definition in existing.items():
            self.stdout.write('  {:<34} {}'.format(name, definition))
        if not existing:
            self.stdout.write('  (none)')

        if o['revert']:
            return self._revert(existing)

        if NEW_CONSTRAINT in existing:
            self.stdout.write(self.style.SUCCESS(
                '\nAlready scoped per advocate. Nothing to do.'))
            return

        dups = _duplicates()
        if dups:
            self.stderr.write(self.style.ERROR(
                '\nCannot apply: {} (advocate, case_number) pair(s) already '
                'appear more than once. Resolve these first:'.format(len(dups))))
            for advocate_id, number, n in dups[:10]:
                self.stderr.write('   advocate {} has {!r} {} times'
                                  .format(advocate_id, number, n))
            raise CommandError('duplicates present')

        self.stdout.write('\nNo duplicate (advocate_id, case_number) pairs - safe.')
        if not o['apply']:
            self.stdout.write(self.style.WARNING(
                'Dry run. Re-run with --apply to swap the constraint.'))
            return

        with connection.cursor() as cur:
            # Add the new one BEFORE dropping the old, so there is no window
            # where duplicate numbers could be inserted.
            cur.execute('ALTER TABLE cases ADD CONSTRAINT {} '
                        'UNIQUE (advocate_id, case_number)'.format(NEW_CONSTRAINT))
            self.stdout.write(self.style.SUCCESS(
                'Added {} UNIQUE (advocate_id, case_number).'.format(NEW_CONSTRAINT)))
            if OLD_CONSTRAINT in existing:
                cur.execute('ALTER TABLE cases DROP CONSTRAINT {}'.format(OLD_CONSTRAINT))
                self.stdout.write(self.style.SUCCESS(
                    'Dropped the global constraint {}.'.format(OLD_CONSTRAINT)))
            else:
                self.stdout.write(self.style.WARNING(
                    'Global constraint {} not found - nothing dropped.'
                    .format(OLD_CONSTRAINT)))

        self.stdout.write(self.style.SUCCESS(
            '\nDone. Two advocates can now track the same court case.'))

    def _revert(self, existing):
        dups = None
        with connection.cursor() as cur:
            cur.execute("""SELECT case_number, count(*) FROM cases
                           GROUP BY case_number HAVING count(*) > 1""")
            dups = cur.fetchall()
        if dups:
            raise CommandError(
                'Cannot revert: {} case number(s) are now held by more than one '
                'advocate, which the global constraint forbids. The first is '
                '{!r}.'.format(len(dups), dups[0][0]))
        with connection.cursor() as cur:
            cur.execute('ALTER TABLE cases ADD CONSTRAINT {} UNIQUE (case_number)'
                        .format(OLD_CONSTRAINT))
            if NEW_CONSTRAINT in existing:
                cur.execute('ALTER TABLE cases DROP CONSTRAINT {}'.format(NEW_CONSTRAINT))
        self.stdout.write(self.style.SUCCESS('Reverted to the global constraint.'))
