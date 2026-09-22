"""Process document summaries.

Default run (scheduled every few minutes, like process_notifications): pick up
rows left PENDING, plus PROCESSING rows older than --stuck-minutes (a thread that
died before finishing), and (re)run them synchronously.

`--all`: backfill — create PENDING rows for existing documents that have a
summarizable file type and no summary row yet, then process everything pending.

Register a Task Scheduler entry pointing at scripts/summarize_documents.bat.
"""

import datetime

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import Document
from documents.models import DocumentSummary
from documents.summarizer import summarize, _is_supported


class Command(BaseCommand):
    help = 'Generate/refresh AI summaries for documents (catch-up + backfill).'

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=25,
                            help='Max rows to process this run.')
        parser.add_argument('--stuck-minutes', type=int, default=15,
                            help='Reclaim PROCESSING rows older than this.')
        parser.add_argument('--all', action='store_true',
                            help='Backfill: create rows for documents missing one.')

    def handle(self, *args, **o):
        if o['all']:
            created = self._backfill()
            self.stdout.write(f'Backfill: created {created} pending summary row(s).')

        cutoff = timezone.now() - datetime.timedelta(minutes=o['stuck_minutes'])
        rows = list(
            DocumentSummary.objects.filter(status=DocumentSummary.PENDING)
            .union(
                DocumentSummary.objects.filter(
                    status=DocumentSummary.PROCESSING, updated_at__lt=cutoff),
            )
            .order_by('id')[:o['limit']]
        )
        if not rows:
            self.stdout.write('Nothing to process.')
            return

        ok = failed = 0
        for row in rows:
            try:
                summarize(row)
                ok += 1
            except Exception as exc:  # keep going on a bad document
                failed += 1
                self.stderr.write(f'  doc {row.document_id}: {exc}')
        self.stdout.write(f'Processed {len(rows)} row(s): {ok} ok, {failed} failed.')

    def _backfill(self):
        existing = set(DocumentSummary.objects.values_list('document_id', flat=True))
        created = 0
        for doc in Document.objects.all().iterator():
            if doc.id in existing:
                continue
            if _is_supported(doc.file_type, doc.file_path) is None:
                continue
            DocumentSummary.objects.create(
                document_id=doc.id, status=DocumentSummary.PENDING)
            created += 1
        return created
