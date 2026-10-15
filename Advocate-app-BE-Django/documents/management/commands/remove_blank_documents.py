"""Remove new documents left blank (created by New document / Write in editor, never saved, not open).

    python manage.py remove_blank_documents              # older than 24 hours (the scheduler runs this)
    python manage.py remove_blank_documents --hours 0    # all of them, now

Normally a blank document is removed as soon as it is closed unchanged (documents/blank.py); this catches the
ones whose editor never reported closing (a desktop program that crashed, a dropped connection).
"""

import datetime

from django.core.management.base import BaseCommand

from documents.blank import sweep


class Command(BaseCommand):
    help = 'Remove new documents nobody wrote in (never saved, not open), older than --hours.'

    def add_arguments(self, parser):
        parser.add_argument('--hours', type=float, default=24, help='Only blank documents older than this (default 24).')

    def handle(self, *args, **o):
        removed = sweep(datetime.timedelta(hours=max(0, o['hours'])))
        self.stdout.write(f'Removed {removed} blank document(s).')
