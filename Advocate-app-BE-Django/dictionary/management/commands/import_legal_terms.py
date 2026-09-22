"""Import legal terms + definitions into the legal_term table.

Schema-tolerant so it works with the various open/public-domain dictionary dumps:
- a JSON **list** of objects: term from term/title/word/name, definition from
  definition/body/def/meaning/text (HTML in the body is stripped to plain text);
- or a JSON **object** mapping term -> definition string.

Idempotent per source: existing rows for the same --source are cleared first.

    manage.py import_legal_terms --file _data/blacks_clean.json --source blacks-1910
    manage.py import_legal_terms --url https://.../bld.json
"""

import html
import json
import re
import urllib.request

from django.core.management.base import BaseCommand

from dictionary.models import LegalTerm

TERM_KEYS = ('term', 'title', 'word', 'name')
DEF_KEYS = ('definition', 'body', 'def', 'meaning', 'text')


def _clean(s):
    """HTML/entities -> readable plain text, joining source line-wraps into
    flowing paragraphs (single newlines are OCR wraps; blank lines are real breaks)."""
    if not s:
        return ''
    s = re.sub(r'<br\s*/?>', '\n', str(s), flags=re.I)
    s = re.sub(r'</p>', '\n\n', s, flags=re.I)
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s)
    s = re.sub(r'\r\n?', '\n', s)
    paras = re.split(r'\n\s*\n', s)                               # blank line = real paragraph
    paras = [re.sub(r'\s*\n\s*', ' ', p).strip() for p in paras]  # join OCR line-wraps
    s = '\n\n'.join(p for p in paras if p)
    return re.sub(r'[ \t]{2,}', ' ', s).strip()


def _pairs(raw):
    """Yield (term, definition_raw) from either supported shape."""
    if isinstance(raw, dict):
        for k, v in raw.items():
            yield str(k), (v if isinstance(v, str) else _clean(json.dumps(v)))
    elif isinstance(raw, list):
        for item in raw:
            if not isinstance(item, dict):
                continue
            term = next((item[k] for k in TERM_KEYS if item.get(k)), None)
            dfn = next((item[k] for k in DEF_KEYS if item.get(k)), None)
            if term and dfn:
                yield str(term), dfn


class Command(BaseCommand):
    help = 'Import legal terms + definitions from a JSON file or URL (schema-tolerant).'

    def add_arguments(self, parser):
        parser.add_argument('--file')
        parser.add_argument('--url')
        parser.add_argument('--source', default='blacks-1910')
        parser.add_argument('--batch', type=int, default=1000)

    def handle(self, *args, **o):
        if o.get('file'):
            with open(o['file'], encoding='utf-8') as f:
                raw = json.load(f)
        elif o.get('url'):
            with urllib.request.urlopen(o['url']) as r:  # noqa: S310 (trusted URL)
                raw = json.loads(r.read().decode('utf-8'))
        else:
            self.stderr.write('Provide --file or --url.')
            return

        source = o['source']
        deleted, _ = LegalTerm.objects.filter(source=source).delete()
        if deleted:
            self.stdout.write(f'Cleared {deleted} existing rows for source={source}.')

        batch, total = [], 0
        for term, dfn in _pairs(raw):
            term = term.strip()
            definition = _clean(dfn)
            if not term or not definition:
                continue
            batch.append(LegalTerm(
                term=term, term_norm=term.lower().strip(), definition=definition,
                letter=term[:1].upper(), source=source))
            if len(batch) >= o['batch']:
                LegalTerm.objects.bulk_create(batch)
                total += len(batch)
                batch = []
        if batch:
            LegalTerm.objects.bulk_create(batch)
            total += len(batch)

        self.stdout.write(self.style.SUCCESS(f'Imported {total} terms (source={source}).'))
