"""Import P. Ramanatha Aiyar's *Law Lexicon* (1997) into the legal_term table.

The source is the hOCR full-text dump (``fts.txt``) of the scanned book — a linear
stream of OCR'd lines with no structural markup. This command reconstructs entries
heuristically:

* boilerplate lines (digitizer credits, running heads, bare page numbers) are dropped;
* an entry begins on a line shaped like ``Headword. <definition start>`` — the headword
  is 1-7 words, starts with a capital, and is immediately followed by ``. `` and a
  capital/number/quote/paren (the definition). Everything up to the next such line is
  the entry body (wrapped lines are re-joined);
* cross-reference / continuation openers (``See``, ``Also``, ``The`` …) are treated as
  body, not new headwords, to avoid false splits;
* entries with the same headword (e.g. a Title-Case and an ALL-CAPS variant) are merged,
  keeping the fuller text.

Because this is OCR, extraction is best-effort, not perfect — but far cleaner and more
India-specific than the 1910 Black's it replaces.

    manage.py import_lawlexicon_terms --file "/path/to/fts.txt"
    manage.py import_lawlexicon_terms --file fts.txt --source aiyar-1997 --dry-run
"""

import re

from django.core.management.base import BaseCommand

from dictionary.models import LegalTerm
from dictionary.refine import refine_definition

# --- lines that are never dictionary content -------------------------------
NOISE_SUBSTR = (
    'CC-0. Bhagavad',
    'Funding: Tattva',
    'THE LAW LEXICON',
    'Digitization: eGangotri',
    'Melukote Collection',
)
BARE_PAGENUM = re.compile(r'^\s*\d{1,4}\s*$')
# Page-header lines: a short term-ish phrase with a bare 2-4 digit page number stuck
# on one end, e.g. "Floating charge or security 735" or "136 Floating debt".
PAGE_HEADER = re.compile(r'^(?:\d{1,4}\s+\S.{0,55}|\S.{0,55}?\s+\d{2,4})\s*$')

# --- an entry start: "Headword. definition..." -----------------------------
# Headword: initial capital, 1-7 tokens, letters/&/()/-/'/space/comma only (no digits),
# max ~46 chars, then a period + space + a definition opener.
ENTRY_RE = re.compile(
    r"^(?P<head>[A-Z][A-Za-z][A-Za-z'’&().,\-/ ]{0,44}?)\.\s+(?P<rest>[A-Z0-9(\"“'’].*)$"
)
# Leading words that signal this line continues the previous entry rather than
# starting a new headword (cross-references, sentence connectors).
CONT_OPENERS = {
    'see', 'also', 'but', 'and', 'the', 'a', 'an', 'it', 'its', 'this', 'these',
    'those', 'such', 'he', 'she', 'they', 'there', 'when', 'where', 'thus', 'hence',
    'held', 'per', 'in', 'on', 'of', 'as', 'if', 'so', 'then', 'that', 'their', 'his',
    'her', 'no', 'not', 'one', 'ones',
}


def _is_noise(line):
    if any(s in line for s in NOISE_SUBSTR):
        return True
    if BARE_PAGENUM.match(line):
        return True
    if PAGE_HEADER.match(line) and not line.strip().endswith(('.', ';', ':', ',')):
        return True
    return False


def _norm_ws(s):
    return re.sub(r'[ \t]{2,}', ' ', s).strip()


def _clean_ocr(s):
    """Tidy common OCR artifacts: `�` stood in for curly apostrophes/quotes."""
    s = re.sub(r'(?<=\w)�(?=\w)', "'", s)   # Kingston�s -> Kingston's
    s = s.replace('�', '')                  # drop any remaining stray marks
    s = re.sub(r'[‘’]', "'", s)
    s = re.sub(r'[“”]', '"', s)
    return _norm_ws(s)


class Command(BaseCommand):
    help = "Import Aiyar's Law Lexicon (1997) hOCR full-text into legal_term."

    def add_arguments(self, parser):
        parser.add_argument('--file', required=True)
        parser.add_argument('--source', default='aiyar-1997')
        parser.add_argument('--batch', type=int, default=1000)
        parser.add_argument('--min-def', type=int, default=12,
                            help='Drop entries whose definition is shorter than this.')
        parser.add_argument('--dry-run', action='store_true',
                            help='Parse and report counts + samples; write nothing.')

    def handle(self, *args, **o):
        with open(o['file'], encoding='utf-8', errors='replace') as f:
            raw_lines = f.read().split('\n')

        entries = {}          # term_norm -> [term, definition]
        order = []            # preserve first-seen order
        cur_head = None
        cur_body = []
        dropped_noise = 0
        joined = 0

        def flush():
            if not cur_head:
                return
            body = _norm_ws(' '.join(cur_body))
            body = re.sub(r'-\s+(?=[a-z])', '', body)   # de-hyphenate line-break splits
            body = _clean_ocr(body)
            head = _clean_ocr(cur_head)
            key = head.lower().strip(" .'’\"")
            if not key:
                return
            if key in entries:
                if len(body) > len(entries[key][1]):
                    entries[key][1] = body
            else:
                entries[key] = [head, body]
                order.append(key)

        for line in raw_lines:
            line = line.rstrip()
            if not line.strip():
                continue
            if _is_noise(line):
                dropped_noise += 1
                continue
            m = ENTRY_RE.match(line)
            if m and m.group('head').split()[0].lower().strip(".,'’") not in CONT_OPENERS \
                    and len(m.group('head').split()) <= 7:
                flush()
                cur_head = _norm_ws(m.group('head'))
                cur_body = [m.group('rest')]
            elif cur_head:
                cur_body.append(line)
                joined += 1
        flush()

        # Build rows, dropping too-short definitions.
        rows = []
        for key in order:
            term, definition = entries[key]
            if len(definition) < o['min_def']:
                continue
            rows.append((term, key, definition[:6000]))

        self.stdout.write(
            f'Read {len(raw_lines)} lines · dropped {dropped_noise} noise · '
            f'joined {joined} continuation lines · parsed {len(rows)} unique terms.')

        if o['dry_run']:
            self.stdout.write(self.style.WARNING('DRY RUN — nothing written. Samples:'))
            wanted = ('mens rea', 'res judicata', 'estoppel', 'habeas corpus',
                      'benami', 'locus standi', 'vakalat', 'obiter dictum')
            bykey = {t[1]: t for t in rows}
            for w in wanted:
                hit = bykey.get(w) or next((t for t in rows if t[1].startswith(w)), None)
                if hit:
                    self.stdout.write(self.style.SUCCESS(f'\n[{hit[0]}]'))
                    self.stdout.write(hit[2][:400] + ('…' if len(hit[2]) > 400 else ''))
                else:
                    self.stdout.write(self.style.NOTICE(f'\n[{w}] — not found'))
            return

        source = o['source']
        deleted, _ = LegalTerm.objects.filter(source=source).delete()
        if deleted:
            self.stdout.write(f'Cleared {deleted} existing rows for source={source}.')

        batch, total = [], 0
        for term, key, definition in rows:
            batch.append(LegalTerm(
                term=term, term_norm=key,
                definition=refine_definition(definition),   # reference-free, shown to users
                definition_raw=definition,                  # original, for re-refining
                letter=term[:1].upper(), source=source))
            if len(batch) >= o['batch']:
                LegalTerm.objects.bulk_create(batch)
                total += len(batch)
                batch = []
        if batch:
            LegalTerm.objects.bulk_create(batch)
            total += len(batch)

        self.stdout.write(self.style.SUCCESS(f'Imported {total} terms (source={source}).'))
