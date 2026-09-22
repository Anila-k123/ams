"""Load the IPC->BNS / CrPC->BNSS / IEA->BSA section mappings into the DB from the
pipe-delimited source tables in lawcodes/data/ (sourced from vakilpedia.com's
section-mapping lists). Idempotent per (old_act, old_section).

Grouped old sections are expanded so each is individually searchable, e.g.
"230 to 232, 246 to 249, 255, 489A" -> one row each -> BNS 178. A blank / "NA" new
section is stored as repealed.

    manage.py load_section_mappings            # clears + reloads all three
    manage.py load_section_mappings --keep     # upsert without clearing
"""

import os
import re

from django.conf import settings
from django.core.management.base import BaseCommand

from lawcodes.models import LegalCodeMapping

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'data')
FILES = [
    ('ipc_bns.txt', 'IPC', 'BNS'),
    ('crpc_bnss.txt', 'CrPC', 'BNSS'),
    ('iea_bsa.txt', 'IEA', 'BSA'),
]
_ACT_PREFIX = re.compile(r'^(IPC|CrPC|Cr\.?P\.?C\.?|IEA|BNSS|BNS|BSA)\s+', re.I)
_RANGE = re.compile(r'^(\d+)\s+to\s+(\d+)$', re.I)
_EMPTY_NEW = {'', 'NA', 'OMITTED', 'REPEALED', '-'}


def _norm(s):
    return re.sub(r'\s+', '', (s or '')).lower()


def _expand_old(raw):
    """Expand a grouped old-section cell into individual sections. Only split on
    comma/&/and when every part is a section token (starts with a digit) — so
    "3, para 1" stays whole but "230 to 232, 255, 489A" splits and ranges expand."""
    s = re.sub(r'\s*&\s*', ',', raw)
    s = re.sub(r'\s+and\s+', ',', s, flags=re.I)
    parts = [p.strip() for p in s.split(',') if p.strip()]
    if not (len(parts) > 1 and all(re.match(r'^\d', p) for p in parts)):
        parts = [raw.strip()]
    out = []
    for p in parts:
        m = _RANGE.match(p)
        if m:
            out.extend(str(n) for n in range(int(m.group(1)), int(m.group(2)) + 1))
        else:
            out.append(p)
    return out


class Command(BaseCommand):
    help = 'Load IPC/CrPC/IEA -> BNS/BNSS/BSA section mappings from lawcodes/data/*.txt.'

    def add_arguments(self, parser):
        parser.add_argument('--keep', action='store_true', help='Upsert without clearing.')

    def handle(self, *args, **o):
        if not o['keep']:
            deleted, _ = LegalCodeMapping.objects.all().delete()
            self.stdout.write('Cleared {} existing rows.'.format(deleted))

        grand = 0
        for fname, old_act, new_act in FILES:
            path = os.path.join(DATA_DIR, fname)
            count = 0
            with open(path, encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#') or '|' not in line:
                        continue
                    cells = [c.strip() for c in line.split('|')]
                    if len(cells) < 2 or set(cells[0]) <= set('-'):
                        continue
                    old_raw = _ACT_PREFIX.sub('', cells[0]).strip()
                    new_raw = _ACT_PREFIX.sub('', cells[1]).strip()
                    subject = cells[2] if len(cells) > 2 else ''
                    if old_raw.upper() in {'', 'NA', 'NEW'} or old_raw.lower().endswith('_section'):
                        continue
                    new_section = '' if new_raw.upper() in _EMPTY_NEW else new_raw
                    for old_section in _expand_old(old_raw):
                        LegalCodeMapping.objects.update_or_create(
                            old_act=old_act, old_section=old_section,
                            defaults={
                                'old_section_norm': _norm(old_section),
                                'description': subject[:500],
                                'new_act': new_act,
                                'new_section': new_section,
                                'new_section_norm': _norm(new_section),
                                'changed': False,
                                'source': 'vakilpedia',
                            })
                        count += 1
            self.stdout.write('  {}: {} rows'.format(fname, count))
            grand += count

        self.stdout.write(self.style.SUCCESS(
            'Loaded {} mappings. Total in DB: {}.'.format(grand, LegalCodeMapping.objects.count())))
