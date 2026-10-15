"""PDF template / sample -> a Word file, in the background at upload (docs/DRAFT_EXPORT.md,
"PDF templates and samples").

A PDF stores positioned text, not paragraphs or styles, so this rebuilds a .docx from what the page
shows: lines are joined into paragraphs, each paragraph gets the alignment, indent, font, size and
weight its lines have on the page; short bold / larger lines become headings (in the document's own
font, so clauses split the same way as a Word upload); tables become Word tables; a logo or
letterhead text repeated at the top / bottom of the pages becomes the header / footer. The Word file
then drives everything a Word upload does (drafting/wordform.py). A scanned PDF (no text) gives None.
"""

import io
import logging
import re
from collections import Counter

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor

log = logging.getLogger(__name__)

ALIGN = {'left': WD_ALIGN_PARAGRAPH.LEFT, 'center': WD_ALIGN_PARAGRAPH.CENTER,
         'right': WD_ALIGN_PARAGRAPH.RIGHT, 'justify': WD_ALIGN_PARAGRAPH.JUSTIFY}
# A numbered / bulleted item: "1.", "1.1", "(a)", "iv)", a bullet. Not a bare number ("2015 registered…").
_LIST_START = re.compile(r'^\s*(?:\(?\d{1,3}(?:\.\d{1,3})*[.)]|\d{1,3}(?:\.\d{1,3})+|\(?[a-z]\)|\(?[ivxlc]+\)|[•\-–·▪])\s+',
                         re.I)
_SUBSET = re.compile(r'^[A-Z]{6}\+')
# Signature-block labels: never clause headings.
_SIGNATURE_LINE = re.compile(r'^\s*(?:sd/-|for\b|signed\b|signature\b|witness|lessor|lessee|landlord|tenant|'
                             r'licensor|licensee|employer|employee|party|authori[sz]ed signatory|name\s*:|date\s*:|place\s*:)',
                             re.I)


def _family(fontname):
    """'ABCDEF+TimesNewRomanPS-BoldMT' -> 'Times New Roman'."""
    name = _SUBSET.sub('', fontname or '')
    name = re.split(r'[-,]', name)[0]
    name = re.sub(r'(PS)?MT$|PS$', '', name)
    known = {'timesnewroman': 'Times New Roman', 'arial': 'Arial', 'calibri': 'Calibri', 'cambria': 'Cambria',
             'georgia': 'Georgia', 'garamond': 'Garamond', 'bookantiqua': 'Book Antiqua', 'verdana': 'Verdana',
             'helvetica': 'Arial', 'tahoma': 'Tahoma', 'centurygothic': 'Century Gothic'}
    key = re.sub(r'[^a-z]', '', name.lower())
    for k, v in known.items():
        if key.startswith(k):
            return v
    return re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', name) or None


def _hex(color):
    """A pdfplumber fill colour (grey / RGB / CMYK, 0-1) as 'RRGGBB', or None for black-ish / unknown."""
    try:
        vals = [float(v) for v in (color if isinstance(color, (list, tuple)) else [color])]
    except (TypeError, ValueError):
        return None
    if len(vals) == 1:
        rgb = [vals[0]] * 3
    elif len(vals) == 3:
        rgb = vals
    elif len(vals) == 4:                                          # CMYK
        c, m, y, k = vals
        rgb = [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)]
    else:
        return None
    rgb = [max(0, min(255, round(v * 255))) for v in rgb]
    if max(rgb) < 60:                                             # black / near-black: the default
        return None
    return '%02X%02X%02X' % tuple(rgb)


def _line_info(ln):
    chars = [c for c in ln.get('chars', []) if (c.get('text') or '').strip()]
    sizes = [round(c.get('size', 0), 1) for c in chars]
    fonts = [c.get('fontname', '') for c in chars]
    bold = sum(1 for f in fonts if re.search(r'bold|black|heavy|semibold', f, re.I))
    italic = sum(1 for f in fonts if re.search(r'italic|oblique', f, re.I))
    n = max(len(chars), 1)
    return {
        'text': (ln.get('text') or '').strip(), 'x0': ln['x0'], 'x1': ln['x1'], 'top': ln['top'],
        'bottom': ln['bottom'], 'size': Counter(sizes).most_common(1)[0][0] if sizes else 0,
        'bold': bold / n > 0.6, 'italic': italic / n > 0.6,
        'font': _family(Counter(fonts).most_common(1)[0][0]) if fonts else None,
        'color': Counter(_hex(c.get('non_stroking_color')) for c in chars).most_common(1)[0][0] if chars else None,
        'segs': _segments(chars),
    }


def _segments(chars):
    """The line's word groups split at wide gaps: side-by-side columns ("Sd/- Vikram Anand" ... "Sd/-
    Rajesh Kumar") that the PDF reader reads as one line. [{text, x0, x1}]; one group for normal text."""
    cs = sorted(chars, key=lambda c: c['x0'])
    if not cs:
        return []
    widths = sorted(c['x1'] - c['x0'] for c in cs)
    w = widths[len(widths) // 2] or 5
    segs, cur = [], [cs[0]]
    for c in cs[1:]:
        if c['x0'] - cur[-1]['x1'] > max(w * 3.5, 18):          # a column gap, not a word space
            segs.append(cur)
            cur = [c]
        else:
            cur.append(c)
    segs.append(cur)
    out = []
    for g in segs:
        text = g[0]['text']
        for a, b in zip(g, g[1:]):
            text += (' ' if b['x0'] - a['x1'] > w * 0.25 else '') + b['text']
        out.append({'text': text.strip(), 'x0': g[0]['x0'], 'x1': g[-1]['x1']})
    return out


def _column_groups(lines, pitch):
    """Runs of 2+ consecutive lines split into the same columns (word groups starting at the same x):
    a signature row, a two-column date / place line. Returned as lists of lines."""
    groups, cur, cols = [], [], []

    def aligned(ln):
        return all(any(abs(sg['x0'] - c) <= 15 for c in cols) for sg in ln['segs'])

    for ln in lines:
        multi = len(ln.get('segs') or []) >= 2
        close = cur and ln['top'] - cur[-1]['bottom'] <= pitch * 2.2
        if multi and cur and close and aligned(ln):
            cur.append(ln)
            cols = sorted(set(cols) | {sg['x0'] for sg in ln['segs']})
        elif multi and cur and close and len(cur) >= 1 and all(
                any(abs(sg['x0'] - c['x0']) <= 15 for c in ln['segs']) for sg in cur[-1]['segs']):
            cur.append(ln)
            cols = sorted(set(cols) | {sg['x0'] for sg in ln['segs']})
        else:
            if len(cur) >= 2:
                groups.append(cur)
            cur, cols = ([ln], [sg['x0'] for sg in ln['segs']]) if multi else ([], [])
    if len(cur) >= 2:
        groups.append(cur)
    return groups


def _inside(ln, bbox):
    x0, top, x1, bottom = bbox
    return ln['top'] >= top - 1 and ln['bottom'] <= bottom + 1 and ln['x0'] >= x0 - 1 and ln['x1'] <= x1 + 1


def text_edges(lines, page_width):
    """The text block's left and right edges. Left: where most lines start. Right: where the
    full-width lines end; a page with none (a short notice) is taken to have equal margins, so a
    centred title is not mistaken for a right-aligned one."""
    xs0 = sorted(ln['x0'] for ln in lines)
    left = xs0[len(xs0) // 10]
    long_ends = sorted(ln['x1'] for ln in lines if ln['x1'] - ln['x0'] >= (page_width - 2 * left) * 0.88)
    right = long_ends[len(long_ends) // 2] if long_ends else page_width - left
    return left, max(right, left + 1)


def _line_align(ln, left, right, tol=6.0):
    """A line's alignment from where it sits between the text edges: centred (its middle near the
    block's middle, allowing for how PDF writers round), right (ends at the right edge, starts well
    in), justified (edge to edge), else left."""
    width = max(right - left, 1)
    gap_l, gap_r = ln['x0'] - left, right - ln['x1']
    middle_off = abs((ln['x0'] + ln['x1']) / 2 - (left + right) / 2)
    if gap_l > tol * 3 and gap_r > tol and middle_off <= max(12, width * 0.04):
        return 'center'
    if gap_l > width * 0.25 and gap_r <= tol:
        return 'right'
    if gap_l <= tol and gap_r <= tol:
        return 'justify'
    return 'left'


def _key(text):
    return re.sub(r'\d+', '#', re.sub(r'\s+', ' ', text.lower())).strip()


def pdf_to_docx(pdf_path):
    """The PDF as .docx bytes, or None when it has no text layer (a scan) or can't be read."""
    try:
        import pdfplumber
    except ImportError:
        return None
    try:
        with pdfplumber.open(pdf_path) as pdf:
            pages = []
            for page in pdf.pages:
                lines = [_line_info(ln) for ln in page.extract_text_lines(return_chars=True)
                         if (ln.get('text') or '').strip()]
                tables = []
                for t in page.find_tables():
                    rows = t.extract()
                    if rows and len(rows) >= 2 and max(len(r) for r in rows) >= 2:
                        tables.append({'bbox': t.bbox, 'rows': [[(c or '').strip() for c in r] for r in rows]})
                images = []
                for im in page.images:
                    w, h = im['x1'] - im['x0'], im['bottom'] - im['top']
                    if w > 20 and h > 10:
                        try:
                            crop = page.crop((max(im['x0'], 0), max(im['top'], 0), min(im['x1'], page.width),
                                              min(im['bottom'], page.height)))
                            buf = io.BytesIO()
                            crop.to_image(resolution=200).original.save(buf, format='PNG')
                            images.append({'top': im['top'], 'bottom': im['bottom'], 'x0': im['x0'], 'x1': im['x1'],
                                           'w': w, 'png': buf.getvalue()})
                        except Exception:                         # noqa: BLE001
                            pass
                pages.append({'w': page.width, 'h': page.height, 'lines': lines, 'tables': tables, 'images': images})
    except Exception:                                             # noqa: BLE001
        log.exception('pdf_to_docx: could not read %s', pdf_path)
        return None
    if not any(p['lines'] for p in pages):
        return None                                               # a scan: no text layer
    return _build(pages)


def _build(pages):
    all_lines = [ln for p in pages for ln in p['lines']]
    body_size = Counter(round(ln['size']) for ln in all_lines if ln['size']).most_common(1)[0][0] or 11
    body_font = Counter(ln['font'] for ln in all_lines if ln['font']).most_common(1)
    body_font = body_font[0][0] if body_font else None
    W, H = pages[0]['w'], pages[0]['h']
    left, right = text_edges(all_lines, W)
    width = max(right - left, 1)
    # The normal gap between two lines of one paragraph (most gaps are that): a clearly bigger gap
    # is a paragraph break, even where the document leaves only a little space between paragraphs.
    gaps = sorted(b['top'] - a['bottom'] for pg in pages for a, b in zip(pg['lines'], pg['lines'][1:])
                  if 0 <= b['top'] - a['bottom'] < 30)
    leading = gaps[len(gaps) // 2] if gaps else 2.0

    # Header / footer: text in the top quarter / bottom 15% of the page that comes back at the same
    # place on most pages (a letterhead can be tall: logo, firm name, address lines).
    band_top, band_bottom = H * 0.25, H * 0.85
    repeat = Counter()
    for p in pages:
        seen = {(_key(ln['text']), round(ln['top'] / 3)) for ln in p['lines']
                if ln['bottom'] <= band_top or ln['top'] >= band_bottom}
        repeat.update(seen)
    need = max(2, (len(pages) + 1) // 2) if len(pages) > 1 else 99
    repeated = {k for k, n in repeat.items() if n >= need}
    # A logo: an image in the top 20% of the first page.
    logos = [im for im in pages[0]['images'] if im['bottom'] <= H * 0.2]
    if len(pages) > 1:
        header_lines = [ln for ln in pages[0]['lines']
                        if ln['bottom'] <= band_top and (_key(ln['text']), round(ln['top'] / 3)) in repeated]
        footer_lines = [ln for ln in pages[0]['lines']
                        if ln['top'] >= band_bottom and (_key(ln['text']), round(ln['top'] / 3)) in repeated]
    else:
        # One page: nothing repeats, so go by position: text beside / just under a logo at the top is
        # the letterhead, text in the bottom band is the footer.
        logo_bottom = max((im['bottom'] for im in logos), default=0)
        header_lines = [ln for ln in pages[0]['lines'] if logos and ln['top'] <= logo_bottom + 24]
        footer_lines = [ln for ln in pages[0]['lines'] if ln['top'] >= band_bottom]

    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Pt(W), Pt(H)
    sec.left_margin, sec.right_margin = Pt(max(left, 18)), Pt(max(W - right, 18))
    # The top margin: where the first line that isn't header text starts (a title near the top of
    # the page counts; only real header / footer lines are left out).
    header_ids = {id(ln) for ln in header_lines + footer_lines}
    body_tops = [ln['top'] for p in pages for ln in p['lines']
                 if id(ln) not in header_ids and ln['top'] < band_bottom
                 and not (len(pages) > 1 and (_key(ln['text']), round(ln['top'] / 3)) in repeated)]
    logo_bottom = max((im['bottom'] for im in logos), default=0)
    first_body = min(body_tops) if body_tops else 72
    sec.top_margin = Pt(max(first_body, logo_bottom + 6 if logos else 0, 36))
    sec.bottom_margin = Pt(54)
    normal = doc.styles['Normal']
    normal.font.size = Pt(body_size)
    if body_font:
        normal.font.name = body_font
    normal.paragraph_format.space_after = Pt(4)
    for name in ('Heading 1', 'Heading 2'):                       # headings in the document's own look
        st = doc.styles[name]
        st.font.color.rgb = RGBColor(0, 0, 0)
        st.font.name = body_font or st.font.name
        st.font.size = Pt(body_size + (2 if name == 'Heading 1' else 0))
        st.paragraph_format.space_before, st.paragraph_format.space_after = Pt(8), Pt(4)

    def line_align(ln):                                           # this page's text edges
        return _line_align(ln, left, right)

    def styled(par, ln, text=None):
        """A run with the line's own look (bold, italic, size, font, colour)."""
        run = par.add_run(ln['text'] if text is None else text)
        run.bold = ln['bold'] or None
        run.italic = ln['italic'] or None
        if ln['size']:
            run.font.size = Pt(ln['size'])
        if ln['font']:
            run.font.name = ln['font']
        if ln.get('color'):
            run.font.color.rgb = RGBColor.from_string(ln['color'])
        return run

    # Header / footer.
    beside = [ln for ln in header_lines if logos and (ln['x0'] >= max(im['x1'] for im in logos) - 2
                                                         or ln['x1'] <= min(im['x0'] for im in logos) + 2)]
    if logos and beside:
        # A logo with the firm's details beside it: one row, logo cell + text cell (logo on its side).
        logo_left = min(im['x0'] for im in logos) < min(ln['x0'] for ln in beside)
        logo_w = max(im['x1'] for im in logos) - min(im['x0'] for im in logos)
        tbl = sec.header.add_table(rows=1, cols=2, width=Pt(right - left))
        img_cell, txt_cell = (tbl.rows[0].cells if logo_left else tbl.rows[0].cells[::-1])
        img_cell.width, txt_cell.width = Pt(logo_w + 12), Pt(max(right - left - logo_w - 12, 72))
        for n, im in enumerate(logos):
            ip = img_cell.paragraphs[0] if n == 0 else img_cell.add_paragraph()
            ip.add_run().add_picture(io.BytesIO(im['png']), width=Pt(min(im['w'], W * 0.5)))
        # Lines the PDF wrapped (same size / weight / colour, close together) are one line of the
        # letterhead again: "KUMAR &" + "ASSOCIATES" -> "KUMAR & ASSOCIATES".
        groups = []
        for ln in sorted(beside, key=lambda x: x['top']):
            last = groups[-1][-1] if groups else None
            if last and abs(ln['size'] - last['size']) < 0.6 and ln['bold'] == last['bold']                     and ln.get('color') == last.get('color') and ln['top'] - last['bottom'] <= leading + 2.5:
                groups[-1].append(ln)
            else:
                groups.append([ln])
        for n, group in enumerate(groups):
            tp = txt_cell.paragraphs[0] if n == 0 else txt_cell.add_paragraph()
            edge = right - max(x['x1'] for x in group) <= 6
            tp.alignment = ALIGN['right' if edge else 'left' if logo_left else 'right']
            tp.paragraph_format.space_after = Pt(0)
            styled(tp, group[0], ' '.join(x['text'] for x in group))
        sec.header.paragraphs[0]._element.getparent().remove(sec.header.paragraphs[0]._element)
        for ln in header_lines:
            if ln not in beside:
                p = sec.header.add_paragraph()
                p.alignment = ALIGN[line_align(ln)]
                styled(p, ln)
    elif logos or header_lines:
        hp = sec.header.paragraphs[0]
        for im in logos:
            hp.add_run().add_picture(io.BytesIO(im['png']), width=Pt(min(im['w'], W * 0.5)))
            hp.alignment = ALIGN[line_align({'x0': im['x0'], 'x1': im['x1']})]
        for ln in header_lines:
            p = sec.header.add_paragraph()
            p.alignment = ALIGN[line_align(ln)]
            styled(p, ln)
    for n, ln in enumerate(footer_lines):
        p = sec.footer.paragraphs[0] if n == 0 else sec.footer.add_paragraph()
        styled(p, ln)
        p.alignment = ALIGN[line_align(ln)]

    # Header / footer lines leave the body on every page, not just the first.
    skip = {id(ln) for ln in header_lines + footer_lines}
    if len(pages) > 1:
        for p in pages:
            for ln in p['lines']:
                if (ln['bottom'] <= band_top or ln['top'] >= band_bottom) and \
                        (_key(ln['text']), round(ln['top'] / 3)) in repeated:
                    skip.add(id(ln))
    open_para = None                                              # paragraph lines waiting to be written

    def flush():
        nonlocal open_para
        if not open_para:
            return
        lines = open_para
        open_para = None
        text = ' '.join(ln['text'] for ln in lines)
        stacked = len(lines) > 1 and all(line_align(ln) == 'right' for ln in lines)   # name over role
        aligns = [line_align(ln) for ln in lines]
        if all(a == 'center' for a in aligns):
            align = 'center'
        elif all(a == 'right' for a in aligns):
            align = 'right'
        elif any(right - ln['x1'] <= 6 for ln in lines[:-1]):
            # Lines run to the right edge (from the paragraph's own indent): justified.
            align = 'justify'
        else:
            align = aligns[0] if aligns[0] != 'justify' else 'left'
        first = lines[0]
        # A heading: one short bold / larger line. Not a right-aligned line, a line with a blank to
        # fill, or a signature label: those are a signature block, never a clause of their own.
        heading = (len(lines) == 1 and len(text) <= 100 and (first['bold'] or first['size'] >= body_size + 1.5)
                   and any(c.isalpha() for c in text) and align != 'right' and '[[' not in text
                   and not _SIGNATURE_LINE.match(text) and not text[:1].islower())   # "of No. 12 …" continues
        style = ('Heading 1' if first['size'] >= body_size + 3 else 'Heading 2') if heading else None
        p = doc.add_paragraph(style=style) if style else doc.add_paragraph()
        parts = [ln['text'] for ln in lines] if stacked else [text]
        for k, part in enumerate(parts):
            run = p.add_run(part)
            if k < len(parts) - 1:
                run.add_break()                                   # stacked lines keep their line breaks
            run.bold = first['bold'] or None
            run.italic = first['italic'] or None
            if first['size'] and abs(first['size'] - body_size) >= 0.5:
                run.font.size = Pt(first['size'])
            if first['font'] and first['font'] != body_font:
                run.font.name = first['font']
            if first.get('color'):
                run.font.color.rgb = RGBColor.from_string(first['color'])
        p.alignment = ALIGN[align]
        indent = min(ln['x0'] for ln in lines) - left
        if indent > 6 and align in ('left', 'justify'):
            p.paragraph_format.left_indent = Pt(round(indent))
        if len(lines) > 1 and lines[0]['x0'] - lines[1]['x0'] > 6:
            p.paragraph_format.first_line_indent = Pt(round(lines[0]['x0'] - lines[1]['x0']))

    prev = None
    for p in pages:
        flow = [ln for ln in p['lines'] if id(ln) not in skip and not any(_inside(ln, t['bbox']) for t in p['tables'])]
        # Side-by-side columns (signatures: name over role, one per column) become a borderless table.
        col_groups = _column_groups(flow, max(leading, 2) + body_size)
        in_cols = {id(ln) for g in col_groups for ln in g}
        items = [('line', ln['top'], ln) for ln in flow if id(ln) not in in_cols]
        items += [('cols', g[0]['top'], g) for g in col_groups]
        items += [('table', t['bbox'][1], t) for t in p['tables']]
        items += [('image', im['top'], im) for im in p['images'] if not (p is pages[0] and im in logos)]
        items.sort(key=lambda x: x[1])
        for kind, _, it in items:
            if kind != 'line':
                flush()
                prev = None
                if kind == 'cols':
                    starts = []
                    for x in sorted(sg['x0'] for ln in it for sg in ln['segs']):
                        if not starts or x - starts[-1] > 15:
                            starts.append(x)
                    tbl = doc.add_table(rows=len(it), cols=len(starts))   # no style: borderless
                    for i, ln in enumerate(it):
                        for sg in ln['segs']:
                            j = min(range(len(starts)), key=lambda k: abs(starts[k] - sg['x0']))
                            cell = tbl.cell(i, j)
                            styled(cell.paragraphs[0], ln, (' ' if cell.text else '') + sg['text'])
                    continue
                if kind == 'table':
                    rows = it['rows']
                    cols = max(len(r) for r in rows)
                    tbl = doc.add_table(rows=len(rows), cols=cols)
                    tbl.style = 'Table Grid'
                    for i, r in enumerate(rows):
                        for j in range(cols):
                            tbl.cell(i, j).text = r[j] if j < len(r) else ''
                else:
                    doc.add_paragraph().add_run().add_picture(io.BytesIO(it['png']), width=Pt(min(it['w'], W * 0.6)))
                continue
            ln = it
            pitch = (ln['bottom'] - ln['top']) or ln['size'] or body_size
            same_page = prev is not None and ln['top'] >= prev['top']
            new_para = (
                prev is None or open_para is None
                or (same_page and ln['top'] - prev['bottom'] > min(pitch * 0.8, leading + 2.5))  # paragraph gap
                # A change of size / weight starts a paragraph, unless the line carries on the sentence
                # (starts in lower case: the wrapped, bold rest of "… aged 45 years of No. 12 …").
                or ((abs(ln['size'] - prev['size']) >= 0.6 or ln['bold'] != prev['bold'])
                    and not ln['text'][:1].islower())
                or _LIST_START.match(ln['text']) is not None                     # a numbered / bulleted item
                or prev['x1'] < right - width * 0.15 and line_align(prev) != 'center'  # previous line ended short
                # Right-aligned lines stack into one block (a signature: name over role); they part
                # from what isn't right-aligned.
                or (line_align(prev) == 'right') != (line_align(ln) == 'right')
                or (line_align(ln) == 'center') != (line_align(prev) == 'center')
            )
            if new_para:
                flush()
                open_para = [ln]
            else:
                open_para.append(ln)
            prev = ln
        # A paragraph running on to the next page carries on (no full stop / colon at the page end).
        if open_para and re.search(r'[.:;]\s*$', open_para[-1]['text']):
            flush()
    flush()
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()
