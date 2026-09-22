"""Extract Indian statutory definitions from the acts corpus into legal_term.

Statutory "Definitions" / "Interpretation" sections read like:
    In this Act, ... (a) "advocate" means an advocate entered in any roll ...;
    (b) "appointed day" means the day on which ...;
We pull each `"<term>" means/includes ...` clause and store it as a legal term
tagged source=india-code, citing the Act + section. De-duped by term (keeping the
fullest definition) so common terms don't repeat across 1,250 acts.

    manage.py import_indiacode_terms
    manage.py import_indiacode_terms --central-only
"""

import html
import re

from django.core.management.base import BaseCommand
from django.db.models import Q

from acts.models import Section
from dictionary.models import LegalTerm

# A defined term in quotes, followed by a definitional connective.
TERM_RE = re.compile(
    r'["““]([^"””\n]{1,80})["””]\s*'
    r'(means and includes|means or includes|shall mean and include|shall mean|'
    r'shall include|means|includes)\b',
    re.I)

# Start of the NEXT lettered/numbered clause that introduces a quoted term,
# e.g. `; (f) "sapinda relationship"` — used to cut a definition cleanly even when
# the next clause's connective isn't one we match.
CLAUSE_BOUNDARY = re.compile(r';?\s*\(\s*[a-z0-9ivx]{1,4}\s*\)\s*["““]', re.I)


def _clean(s):
    if not s:
        return ''
    s = re.sub(r'<br\s*/?>', ' ', str(s), flags=re.I)
    s = re.sub(r'<[^>]+>', ' ', s)
    s = html.unescape(s)
    s = s.replace('�', '')          # drop stray replacement chars from OCR
    s = re.sub(r'\s+', ' ', s)           # statutory text reads as one flow
    return s.strip()


class Command(BaseCommand):
    help = 'Extract statutory term definitions from the acts corpus into legal_term.'

    def add_arguments(self, parser):
        parser.add_argument('--source', default='india-code')
        parser.add_argument('--central-only', action='store_true',
                            help='Only CENTRAL acts (skip state acts).')
        parser.add_argument('--batch', type=int, default=1000)

    def handle(self, *args, **o):
        secs = (Section.objects
                .filter(Q(title__icontains='definition') | Q(title__icontains='interpretation'))
                .select_related('act'))
        if o['central_only']:
            secs = secs.filter(act__source_state_name__iexact='CENTRAL')

        best = {}  # term_norm -> (def_len, term, full_definition)
        scanned = 0
        for sec in secs.iterator():
            scanned += 1
            text = _clean(sec.content)
            if not text:
                continue
            matches = list(TERM_RE.finditer(text))
            for i, m in enumerate(matches):
                term = m.group(1).strip(' .,"“”')
                if not term or len(term) < 2:
                    continue
                end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
                # Cut earlier if the next lettered clause starts before the next
                # matched term (handles clauses whose connective we don't match).
                nb = CLAUSE_BOUNDARY.search(text, m.end(2))
                if nb and nb.start() < end:
                    end = nb.start()
                definition = text[m.start(2):end].strip().rstrip(';, ').strip()
                if len(definition) < 6:
                    continue
                definition = definition[:1200]
                act_title = sec.act.title if sec.act_id and sec.act else ''
                full = definition + (f'\n\n— {act_title}, s. {sec.number}' if act_title else '')
                key = term.lower()
                if key not in best or len(definition) > best[key][0]:
                    best[key] = (len(definition), term, full)

        LegalTerm.objects.filter(source=o['source']).delete()
        batch, total = [], 0
        for key, (_, term, full) in best.items():
            batch.append(LegalTerm(term=term, term_norm=key, definition=full,
                                    letter=term[:1].upper(), source=o['source']))
            if len(batch) >= o['batch']:
                LegalTerm.objects.bulk_create(batch)
                total += len(batch)
                batch = []
        if batch:
            LegalTerm.objects.bulk_create(batch)
            total += len(batch)

        self.stdout.write(self.style.SUCCESS(
            f'Scanned {scanned} definition sections; imported {total} terms (source={o["source"]}).'))
