"""Re-compute `definition = refine_definition(definition_raw)` for stored terms.

Lets us tune `dictionary/refine.py` and re-apply the reference-stripping in seconds
without re-parsing the source book. Only touches rows that have `definition_raw`
(so India Code, which is already clean and has no raw, is left alone).

    manage.py refine_definitions                       # apply to aiyar-1997
    manage.py refine_definitions --source aiyar-1997 --dry-run
"""

from django.core.management.base import BaseCommand

from dictionary.models import LegalTerm
from dictionary.refine import refine_definition

SAMPLES = ('estoppel', 'res judicata', 'locus standi', 'benami', 'habeas corpus')


class Command(BaseCommand):
    help = 'Re-apply reference-stripping to stored definitions (from definition_raw).'

    def add_arguments(self, parser):
        parser.add_argument('--source', default='aiyar-1997')
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **o):
        qs = LegalTerm.objects.filter(source=o['source']).exclude(definition_raw__isnull=True)

        if o['dry_run']:
            self.stdout.write(self.style.WARNING('DRY RUN — nothing written. Samples:'))
            for key in SAMPLES:
                t = qs.filter(term_norm=key).first()
                if not t:
                    continue
                self.stdout.write(self.style.SUCCESS(f'\n[{t.term}]'))
                self.stdout.write('--- BEFORE ---\n' + (t.definition_raw or '')[:500])
                self.stdout.write('--- AFTER ----\n' + refine_definition(t.definition_raw or '')[:500])
            self.stdout.write(f'\nWould refine {qs.count()} rows (source={o["source"]}).')
            return

        updated = []
        for t in qs.iterator():
            refined = refine_definition(t.definition_raw or '')
            if refined and refined != t.definition:
                t.definition = refined
                updated.append(t)
            if len(updated) >= 1000:
                LegalTerm.objects.bulk_update(updated, ['definition'])
                updated = []
        if updated:
            LegalTerm.objects.bulk_update(updated, ['definition'])

        self.stdout.write(self.style.SUCCESS(
            f'Refined definitions for source={o["source"]} ({qs.count()} rows).'))
