"""Make the Acts search fast enough to keep using as more states are imported.

    manage.py index_acts_search            # report what is missing
    manage.py index_acts_search --apply    # create the indexes

The Acts search runs `icontains`, which becomes `ILIKE '%keyword%'`. A leading
wildcard cannot use an ordinary B-tree index, so every search read all 28,451
section bodies: the Section Contents chip took over two seconds with only two
of ~30 jurisdictions imported.

pg_trgm fixes exactly this. A GIN trigram index accelerates ILIKE with leading
wildcards, and - unlike full-text search - it does not change what matches.
That matters here: tsvector stems and tokenises words, so a partial word like
"vice-chan" would stop matching, and section numbers and citation fragments
would tokenise oddly. Trigrams keep plain substring behaviour and just make it
quick, so no query in acts/views.py has to change.

These tables belong to the acts-importer (managed = False), which is why this
is a command and not a migration. Adding an index does not alter the shape of
a table, so the importer is unaffected - but note a GIN index does slow bulk
inserts, so build these after a large import rather than before.

CONCURRENTLY is used so an import running against the same database is not
blocked while the index builds.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.db import connection

# (index name, table, indexed expression).
#
# The expression is UPPER(col), NOT the bare column, and that detail is the
# whole point. Django's __icontains does not emit ILIKE - it emits
#
#     UPPER("acts_section"."content"::text) LIKE UPPER('%keyword%')
#
# so an index on `content` is never used and the search still scans the table.
# Indexing UPPER(col) matches the query the ORM actually sends. (Measured: with
# the bare-column index the section search still took 1.4s; with this one it is
# a few tens of milliseconds.)
#
# Ordered cheapest first so a partial failure still leaves the small indexes in
# place.
INDEXES = [
    ('acts_act_title_trgm', 'acts_act', 'UPPER(title)'),
    ('acts_act_long_title_trgm', 'acts_act', 'UPPER(long_title)'),
    ('acts_act_department_trgm', 'acts_act', 'UPPER(department_name)'),
    ('acts_act_number_trgm', 'acts_act', 'UPPER(act_number)'),
    ('acts_section_title_trgm', 'acts_section', 'UPPER(title)'),
    # The big one: this is the index the Section Contents chip needs.
    ('acts_section_content_trgm', 'acts_section', 'UPPER(content)'),
]


class Command(BaseCommand):
    help = 'Create pg_trgm GIN indexes so the Acts search stops scanning.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true',
                            help='Create the indexes (default: report only).')

    def handle(self, *args, **o):
        existing = self._existing()
        missing = [i for i in INDEXES if i[0] not in existing]

        self.stdout.write('pg_trgm extension: {}'.format(
            'installed' if self._extension() else 'NOT installed'))
        for name, table, col in INDEXES:
            self.stdout.write('  {:<28} {}'.format(
                name, 'present' if name in existing else 'missing'))

        if not o['apply']:
            self.stdout.write(self.style.WARNING(
                '\n{} index(es) missing. Re-run with --apply.'.format(len(missing))))
            return
        if not missing and self._extension():
            self.stdout.write(self.style.SUCCESS('\nNothing to do.'))
            return

        # Autocommit: CREATE INDEX CONCURRENTLY cannot run inside a transaction.
        old = connection.get_autocommit()
        connection.set_autocommit(True)
        try:
            if not self._extension():
                with connection.cursor() as cur:
                    cur.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')
                self.stdout.write(self.style.SUCCESS('Created extension pg_trgm.'))

            for name, table, col in missing:
                sql = ('CREATE INDEX CONCURRENTLY IF NOT EXISTS {} ON {} '
                       'USING gin (({}) gin_trgm_ops)'.format(name, table, col))
                try:
                    with connection.cursor() as cur:
                        cur.execute(sql)
                    self.stdout.write(self.style.SUCCESS(
                        '  built {}'.format(name)))
                except Exception as exc:                     # noqa: BLE001
                    # A failed CONCURRENTLY build leaves an INVALID index behind;
                    # say so rather than reporting success.
                    self.stderr.write(self.style.ERROR(
                        '  FAILED {}: {}'.format(name, exc)))
                    self.stderr.write(
                        '    drop it before retrying: DROP INDEX IF EXISTS {};'
                        .format(name))
        finally:
            connection.set_autocommit(old)

        self.stdout.write(self.style.SUCCESS('\nDone.'))

    # -- helpers -----------------------------------------------------------

    @staticmethod
    def _extension():
        with connection.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")
            return cur.fetchone() is not None

    @staticmethod
    def _existing():
        with connection.cursor() as cur:
            cur.execute("SELECT indexname FROM pg_indexes "
                        "WHERE tablename IN ('acts_act', 'acts_section')")
            return {r[0] for r in cur.fetchall()}
