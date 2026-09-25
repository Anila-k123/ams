"""Parse the Government of India, Legislative Department **Legal Glossary** PDF into
`_data/legal_glossary.json` (English only).

Two-column, alphabetical glossary. Each entry:
    English term : English definition/gloss [statutory citation] ; <Hindi equivalent>
Headwords are printed in a **Bold** font. We rebuild reading order line-by-line
(cluster words into lines, left column fully before right), start a new entry at every
line whose first word is Bold (the headword), and keep only the English text up to the
first Devanagari (Hindi) character. Government work -> commercially safe.

    python dictionary/parse_glossary.py --pdf "<path>" --out _data/legal_glossary.json
"""

import argparse
import json
import re

import pdfplumber

MID = 297.7                                   # A4 (595pt) column split
DEV = re.compile(r'[ऀ-ॿ]')          # Devanagari (Hindi) — English ends at the first of these
TERM_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ,.'()\-/&]*$")


def _bold(w):
    return 'Bold' in (w.get('fontname') or '')


def page_lines(page):
    """Ordered lines for a page: left column (top->bottom) then right column.
    Each line is the list of its words sorted left->right."""
    words = [w for w in page.extract_words(extra_attrs=['fontname'],
                                           use_text_flow=False, keep_blank_chars=False)
             if w['top'] > 52]                 # drop the page-number header
    out = []
    for lo, hi in ((0, MID), (MID, 10000)):
        col = sorted((w for w in words if lo <= w['x0'] < hi), key=lambda w: (w['top'], w['x0']))
        lines = []
        for w in col:
            if lines and abs(w['top'] - lines[-1][0]) <= 4:
                lines[-1][1].append(w)
            else:
                lines.append([w['top'], [w]])
        for _, lws in lines:
            lws.sort(key=lambda w: w['x0'])
            out.append(lws)
    return out


def segment(all_lines):
    """Group lines into entries — a new entry starts at each line whose first word is Bold."""
    entries, cur = [], None
    for lws in all_lines:
        if _bold(lws[0]):
            if cur:
                entries.append(cur)
            cur = list(lws)
        elif cur is not None:
            cur.extend(lws)
    if cur:
        entries.append(cur)
    return entries


def parse_entry(words):
    s = re.sub(r'\s+', ' ', ' '.join(w['text'] for w in words)).strip()
    if ':' not in s:
        return None
    term, body = s.split(':', 1)
    term = term.strip(" .,;")
    if not term or len(term) > 90 or not TERM_OK.match(term):
        return None
    m = DEV.search(body)                       # English is everything before the first Hindi char
    english = (body[:m.start()] if m else body)
    english = re.sub(r'\s+', ' ', english).strip(' ;,.')
    if len(english) < 4:
        return None
    return {'term': term, 'english': english[:2000]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--out', default='_data/legal_glossary.json')
    ap.add_argument('--start-page', type=int, default=15,
                    help='Skip front matter (glossary body begins at PDF page 15).')
    o = ap.parse_args()

    all_lines = []
    with pdfplumber.open(o.pdf) as pdf:
        for page in pdf.pages:
            if page.page_number >= o.start_page:
                all_lines.extend(page_lines(page))

    entries = [e for e in (parse_entry(w) for w in segment(all_lines)) if e]
    with open(o.out, 'w', encoding='utf-8') as f:
        json.dump(entries, f, ensure_ascii=False)
    print(f'Parsed {len(entries)} English glossary entries -> {o.out}.')


if __name__ == '__main__':
    main()
