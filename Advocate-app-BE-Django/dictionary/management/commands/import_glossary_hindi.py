"""Fill LegalTerm.hindi from the Legal Glossary's Hindi equivalents
(_data/legal_glossary_hindi.json, made by dictionary/parse_glossary_hindi.py).

Rows are matched on the English term (case and whitespace ignored) and updated in
place, so term ids, which the document-summary pop-ups link to, stay the same. The
Hindi is the official equivalent of the *term*, so every source's entry for that term
(Legal Glossary, Black's, India Code) gets it. Re-runnable.

    manage.py import_glossary_hindi [--file _data/legal_glossary_hindi.json] [--dry-run]
"""

import json
import re

from django.core.management.base import BaseCommand

from dictionary.models import LegalTerm


def norm(term):
    """Match key: lower-case, and ignore spacing and punctuation (the PDF sometimes
    drops the space in a headword, e.g. "imprestaccount") and British/American
    spellings the glossary and the other dictionaries differ on."""
    key = re.sub(r'[^a-z0-9]', '', (term or '').lower())
    return key.replace('judgement', 'judgment')


class Command(BaseCommand):
    help = "Store the Legal Glossary's Hindi equivalents on dictionary terms."

    def add_arguments(self, parser):
        parser.add_argument('--file', default='_data/legal_glossary_hindi.json')
        parser.add_argument('--dry-run', action='store_true')

    def handle(self, *args, **o):
        rows = json.load(open(o['file'], encoding='utf-8'))
        hindi = {}
        for r in rows:
            key, text = norm(r.get('term')), (r.get('hindi') or '').strip()
            if key and text:
                parts = hindi.setdefault(key, [])
                for p in text.split(' ; '):
                    if p and p not in parts:
                        parts.append(p)

        updated, matched = [], set()
        for t in LegalTerm.objects.all().only('id', 'term', 'term_norm', 'hindi'):
            key = norm(t.term)
            if key in hindi:
                matched.add(key)
                value = ' ; '.join(hindi[key])
                if t.hindi != value:
                    t.hindi = value
                    updated.append(t)
        if not o['dry_run']:
            LegalTerm.objects.bulk_update(updated, ['hindi'], batch_size=1000)
        self.stdout.write(self.style.SUCCESS(
            f"{len(hindi)} glossary terms with Hindi; {len(matched)} matched dictionary terms; "
            f"{len(updated)} row(s) {'would be ' if o['dry_run'] else ''}updated."))
