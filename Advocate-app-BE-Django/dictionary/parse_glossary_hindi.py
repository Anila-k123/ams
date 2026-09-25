"""Extract the **Hindi** equivalents from the Legislative Department Legal Glossary PDF
into `_data/legal_glossary_hindi.json` as `[{"term": ..., "hindi": ...}]`.

parse_glossary.py (the English pass) stops each entry at the first Hindi character.
This pass reads the same entries and keeps the Hindi instead.

The PDF's Hindi font (Mangal) lacks Unicode mappings for some glyphs, and its glyphs
are laid out visually rather than in logical order. A plain text dump comes out
garbled ("अ�भयुक् त" for अभियुक्त). This pass works glyph by glyph, keeping the PDF's
own glyph order within a line, and repairs four things:

  1. Unmapped vowel signs (U+FFFD) are told apart by glyph width relative to the
     font size: about 0.31 is ि (drawn before its consonant), about 0.26 is ी.
  2. ि is moved after the consonant cluster it was drawn in front of.
  3. The reph (र्, a zero-width glyph drawn after its syllable) is moved in front of
     that syllable: "थ र् त" -> "र्थत".
  4. Spurious spaces are dropped: a space glyph overlapped by the next glyph (inside
     a conjunct, "क् त" -> "क्त"), and spaces before a dependent vowel sign.

    python dictionary/parse_glossary_hindi.py --pdf "<path>" --out _data/legal_glossary_hindi.json
    python dictionary/parse_glossary_hindi.py --pdf "<path>" --pages 24-25 --out -   (preview)
"""

import argparse
import json
import re
import sys

import pdfplumber

MID = 297.7                                     # A4 column split, as in parse_glossary.py
HEADER_TOP = 52                                 # drop the page-number header
I_MARK, REPH = '', ''               # placeholders while reordering
CONS = 'क-हक़-य़'             # consonants (incl. nukta forms)
CLUSTER = f'[{CONS}]़?(?:्[{CONS}]़?)*'
MATRAS = 'ा-ौॢॣऀ-ः़'
DEV = re.compile(r'[ऀ-ॿ]')
LATIN = re.compile(r'[A-Za-z]')


# Unmapped (U+FFFD) Mangal glyphs, identified by width / font size. Surveyed across the
# whole PDF (every 6th page), each class checked against words it appears in:
#   0.261  ी        गृह?त -> गृहीत            0.313, 0.646  ि   ?वद्य -> विद्य
#   0.600  क्ष्      सा?य -> साक्ष्य            0.627  त्त     भ?ा -> भत्ता, द?क -> दत्तक
#   0.443  त्त्      ताि?वक -> तात्त्विक        0.417  त्र्     स्वातं?य -> स्वातंत्र्य
#   0.000  े + reph सव?क्षण -> सर्वेक्षण
FFFD_GLYPHS = [
    (0.000, 'े' + REPH),
    (0.261, 'ी'),
    (0.313, I_MARK),
    (0.417, 'त्र्'),
    (0.443, 'त्त्'),
    (0.600, 'क्ष्'),
    (0.627, 'त्त'),
    (0.646, I_MARK),
]


def _glyph_text(c):
    t = c['text']
    if t == '�':
        ratio = c['width'] / c['size'] if c['size'] else 0
        ref, text = min(FFFD_GLYPHS, key=lambda g: abs(g[0] - ratio))
        return text if abs(ref - ratio) <= 0.012 else ''       # unknown glyph: drop it
    if t == 'र्' and c['width'] < 0.05:              # zero-width र्  = reph
        return REPH
    if t == 'ि':           # a mapped ि is also in drawing order (before its consonant)
        return I_MARK
    return t


def page_lines(page):
    """[(is_bold_start, text)] for the page: left column then right, top to bottom.
    Within a line the PDF's glyph order is kept (it is logical, unlike x order)."""
    chars = [c for c in page.chars if c['top'] > HEADER_TOP]
    out = []
    for lo, hi in ((0, MID), (MID, 10000)):
        col = [c for c in chars if lo <= c['x0'] < hi]
        lines = []                                             # [top, [chars]]
        for c in col:                                          # stream order
            for ln in lines:
                if abs(c['top'] - ln[0]) <= 4:
                    ln[1].append(c)
                    break
            else:
                lines.append([c['top'], [c]])
        for _, lc in sorted(lines, key=lambda l: l[0]):
            text, prev = [], None
            for i, c in enumerate(lc):
                if c['text'] == ' ':
                    nxt = lc[i + 1] if i + 1 < len(lc) else None
                    if nxt is not None and nxt['x0'] <= c['x0'] + 0.6:   # overlapped: not a real gap
                        continue
                g = _glyph_text(c)
                # A mapped ि drawn in front of an unmapped half-form ("ताि?वक" = तात्त्विक)
                # is also pre-base: reorder it like the unmapped one.
                if text and text[-1] == 'ि' and g.endswith('्') and c['text'] == '�':
                    text[-1] = I_MARK
                text.append(g)
                prev = c
            first = next((c for c in lc if c['text'].strip()), None)
            bold = bool(first and 'Bold' in (first.get('fontname') or '') and LATIN.match(first['text']))
            out.append((bold, ''.join(text)))
    return out


def fix_hindi(s):
    s = re.sub(f' +(?=[{MATRAS}])', '', s)                     # space before a vowel sign
    s = re.sub('् +(?=[' + CONS + '])', '्', s)     # space inside a conjunct
    s = re.sub(I_MARK + f'({CLUSTER})', lambda m: m.group(1) + 'ि', s)   # ि after its cluster
    s = s.replace(I_MARK, 'ि')
    s = re.sub(f'({CLUSTER}[{MATRAS}]*){REPH}', lambda m: 'र्' + m.group(1), s)  # reph first
    s = s.replace(REPH, 'र्')
    return re.sub(r'\s+', ' ', s).strip()


def hindi_runs(body):
    """The Hindi parts of an entry body (text after 'term :'), in order."""
    runs, cur = [], []
    for tok in re.split(r'(\s+)', body):
        if not tok.strip():
            cur.append(tok)
            continue
        if DEV.search(tok) or tok in (I_MARK, REPH) or (cur and not LATIN.search(tok) and tok not in ('[', ']')
                                                        and not tok.startswith('[')):
            if DEV.search(tok) or I_MARK in tok or REPH in tok or cur:
                cur.append(tok)
                continue
        if cur and ''.join(cur).strip():
            runs.append(''.join(cur))
        cur = []
    if cur and ''.join(cur).strip():
        runs.append(''.join(cur))
    out = []
    for r in runs:
        r = fix_hindi(r).strip(' ;,.')
        if DEV.search(r):
            out.append(r)
    return out


def entries(pdf, first, last):
    cur = None
    for i in range(first, last):
        for bold, text in page_lines(pdf.pages[i]):
            if bold:
                if cur:
                    yield cur
                cur = text
            elif cur is not None:
                cur += ' ' + text
    if cur:
        yield cur


def parse(pdf_path, pages=None):
    pdf = pdfplumber.open(pdf_path)
    first, last = (0, len(pdf.pages)) if pages is None else pages
    rows = []
    for e in entries(pdf, first, last):
        term, sep, body = e.partition(' :')
        term = term.strip()
        if not sep or not term or not LATIN.match(term):
            continue
        hindi = hindi_runs(body)
        if hindi:
            rows.append({'term': term, 'hindi': ' ; '.join(dict.fromkeys(hindi))})
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf', required=True)
    ap.add_argument('--out', default='_data/legal_glossary_hindi.json')
    ap.add_argument('--pages', help='e.g. 24-25 (0-based, inclusive) for a preview')
    a = ap.parse_args()
    pages = None
    if a.pages:
        lo, hi = a.pages.split('-')
        pages = (int(lo), int(hi) + 1)
    rows = parse(a.pdf, pages)
    data = json.dumps(rows, ensure_ascii=False, indent=1)
    if a.out == '-':
        sys.stdout.buffer.write(data.encode('utf-8'))
    else:
        open(a.out, 'w', encoding='utf-8').write(data)
        print(f'{len(rows)} entries with Hindi -> {a.out}')


if __name__ == '__main__':
    main()
