"""Management command: load BNS/BNSS/BSA section mapping data into LegalCodeMapping.

Usage:
    python manage.py load_legal_codes              # loads from default fixture path
    python manage.py load_legal_codes --clear      # wipes existing rows first
    python manage.py load_legal_codes --path /abs/path/to/fixture.json
"""

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from drafting.models import LegalCodeMapping

_DEFAULT_FIXTURE = (
    Path(__file__).resolve().parent.parent.parent   # drafting/
    / 'fixtures'
    / 'legal_code_mappings.json'
)


class Command(BaseCommand):
    help = 'Load BNS/BNSS/BSA section mappings from JSON fixture into LegalCodeMapping.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--path',
            default=str(_DEFAULT_FIXTURE),
            help='Path to the JSON fixture file (default: drafting/fixtures/legal_code_mappings.json)',
        )
        parser.add_argument(
            '--clear',
            action='store_true',
            default=False,
            help='Delete all existing LegalCodeMapping rows before loading.',
        )

    def handle(self, *args, **options):
        fixture_path = Path(options['path'])
        if not fixture_path.exists():
            raise CommandError(f'Fixture not found: {fixture_path}')

        data = json.loads(fixture_path.read_text(encoding='utf-8'))
        if not isinstance(data, list):
            raise CommandError('Fixture must be a JSON array of mapping objects.')

        if options['clear']:
            deleted, _ = LegalCodeMapping.objects.all().delete()
            self.stdout.write(f'Cleared {deleted} existing row(s).')

        created = updated = skipped = 0
        for row in data:
            try:
                obj, was_created = LegalCodeMapping.objects.update_or_create(
                    old_act=row['old_act'],
                    old_section=row['old_section'],
                    defaults={
                        'description': row.get('description', ''),
                        'new_act': row['new_act'],
                        'new_section': row.get('new_section', ''),
                        'changed': row.get('changed', False),
                    },
                )
                if was_created:
                    created += 1
                else:
                    updated += 1
            except (KeyError, Exception) as exc:
                self.stderr.write(f'Skipped row {row!r}: {exc}')
                skipped += 1

        self.stdout.write(
            self.style.SUCCESS(
                f'Done — {created} created, {updated} updated, {skipped} skipped. '
                f'Total rows: {LegalCodeMapping.objects.count()}'
            )
        )
