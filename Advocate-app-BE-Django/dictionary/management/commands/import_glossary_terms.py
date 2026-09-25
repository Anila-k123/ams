"""Import the Legislative Department Legal Glossary (parsed by parse_glossary.py) into
legal_term. English definitions are run through refine.py (strips inline statutory
pin-cites); the official Hindi equivalent is stored in the `hindi` field. De-duped by
term keeping the fullest English definition.

    manage.py import_glossary_terms --file _data/legal_glossary.json
"""

import json

from django.core.management.base import BaseCommand

from dictionary.models import LegalTerm
from dictionary.refine import refine_definition

SOURCE = 'legal-glossary-in'


class Command(BaseCommand):
    help = 'Import the official Legislative Dept Legal Glossary into legal_term.'

    def add_arguments(self, parser):
        parser.add_argument('--file', default='_data/legal_glossary.json')
        parser.add_argument('--batch', type=int, default=1000)

    def handle(self, *args, **o):
        with open(o['file'], encoding='utf-8') as f:
            rows = json.load(f)

        # Keep the fullest English definition per term (case-insensitive).
        best = {}
        for r in rows:
            term = (r.get('term') or '').strip()
            if not term:
                continue
            definition = refine_definition((r.get('english') or '').strip())
            if not definition:
                continue
            key = term.lower()
            prev = best.get(key)
            if prev is None or len(definition) > prev[0]:
                best[key] = (len(definition), term, definition)

        LegalTerm.objects.filter(source=SOURCE).delete()
        batch, total = [], 0
        for key, (_, term, definition) in best.items():
            batch.append(LegalTerm(
                term=term, term_norm=key, definition=definition, definition_raw=definition,
                letter=term[:1].upper(), source=SOURCE))
            if len(batch) >= o['batch']:
                LegalTerm.objects.bulk_create(batch)
                total += len(batch)
                batch = []
        if batch:
            LegalTerm.objects.bulk_create(batch)
            total += len(batch)

        self.stdout.write(self.style.SUCCESS(
            f'Imported {total} glossary terms (source={SOURCE}).'))
