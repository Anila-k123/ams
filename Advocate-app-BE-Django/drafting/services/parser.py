import logging
import re
from pathlib import Path

from django.conf import settings

logger = logging.getLogger(__name__)


def extract_clauses(file_path: str) -> list[dict]:
    """Extract a document into a list of clause dicts, dispatching on file type.

    Each clause dict has keys `clause_type`, `position`, and `text`. Raises
    ValueError for unsupported extensions.

    PDFs go through Docling's layout-aware parser (much better structure on messy
    PDFs); it falls back to the text-regex splitter if Docling fails or is
    disabled (settings.USE_DOCLING). DOCX keeps the python-docx parser, which is
    accurate and also captures formatting for style preservation.
    """
    suffix = Path(file_path).suffix.lower()
    if suffix == '.pdf':
        if getattr(settings, 'USE_DOCLING', True):
            try:
                from .docling_parser import docling_clauses
                clauses = docling_clauses(file_path)
                if clauses:
                    return clauses
                logger.warning('docling returned no clauses for %s; using regex splitter', file_path)
            except Exception:
                logger.exception('docling parse failed for %s; falling back to regex splitter', file_path)
        return _parse_pdf(file_path)
    if suffix in ('.docx', '.doc'):
        return _parse_docx(file_path)
    raise ValueError(f'Unsupported file type: {suffix}')


def extract_template_slots(file_path: str) -> list[dict]:
    """Parse an uploaded template document into clause-skeleton slots (body_json).

    Each slot drives one generated block: `label` names it, `description` is the
    text used to retrieve the matching sample clause, `type` is the clause kind.
    For DOCX templates each slot also carries a `style` (captured formatting —
    heading + dominant body paragraph) so the generated draft can reproduce the
    template's look (alignment, font, size, colour, emphasis).
    """
    clauses = extract_clauses(file_path)
    slots = []
    for c in clauses:
        # A signature/execution block has no section title — keep its label empty (never
        # derive one from "IN WITNESS WHEREOF…") so the draft shows no spurious heading.
        sig = is_signature_block(c['text'])
        slot = {
            'id': f'clause_{c["position"]}',
            'type': 'signature' if sig else c['clause_type'],
            'label': '' if sig else (clause_label(c['text']) or _derive_heading(c['text'])),
            'description': c['text'],
        }
        if c.get('style'):
            slot['style'] = c['style']
        slots.append(slot)
    return slots


def _para_style(para) -> dict:
    """Capture a paragraph's formatting for style preservation: alignment plus the
    dominant (first visible) run's font/size/colour/emphasis. Only non-default
    values are recorded; an empty dict means "inherit the editor default"."""
    try:
        from docx.enum.text import WD_ALIGN_PARAGRAPH
    except Exception:
        return {}
    align_map = {
        WD_ALIGN_PARAGRAPH.CENTER: 'center', WD_ALIGN_PARAGRAPH.RIGHT: 'right',
        WD_ALIGN_PARAGRAPH.JUSTIFY: 'justify', WD_ALIGN_PARAGRAPH.LEFT: 'left',
    }
    style: dict = {}
    align = align_map.get(para.alignment)
    if align and align != 'left':
        style['align'] = align
    runs = [r for r in para.runs if (r.text or '').strip()]
    if not runs:
        return style

    # Font / size / colour: take the first visible run (these are uniform within a
    # clause paragraph in practice).
    font = runs[0].font
    if font.name:
        style['font'] = font.name
    try:
        if font.size is not None:
            style['size'] = round(font.size.pt)
    except Exception:
        pass
    try:
        if font.color is not None and font.color.type is not None and font.color.rgb:
            style['color'] = f'#{font.color.rgb}'
    except Exception:
        pass

    # Emphasis (bold/italic/underline/caps): only when EVERY run agrees, so a
    # paragraph with a single bold lead-in word (e.g. "WHEREAS …") is NOT marked
    # wholly bold. Per-run emphasis can't survive the rewrite anyway.
    if runs and all(r.bold for r in runs):
        style['bold'] = True
    if runs and all(r.italic for r in runs):
        style['italic'] = True
    if runs and all(r.underline for r in runs):
        style['underline'] = True
    if runs and all(getattr(r.font, 'all_caps', None) for r in runs):
        style['caps'] = True
    return style


def clause_title(text: str) -> str:
    """The clause's OWN heading if it has a clear one, else '' (so the LLM names it).

    For a structured document the section heading ("DEFINITIONS", "SAAS SERVICES",
    "TERM AND TERMINATION") is the best clause name. Returns '' when the first line
    is body text (a long sentence), e.g. numbered clauses with no title.
    """
    lines = text.strip().splitlines()
    if not lines:
        return ''
    first = lines[0].strip()
    # Strip a leading marker: "1. DEFINITIONS" -> "DEFINITIONS", "ARTICLE II Term" -> "Term".
    # The alternation matches a number (1, 1.2), an uppercase Roman numeral, or an
    # ARTICLE/SECTION/CLAUSE keyword + number; group 1 captures everything after it.
    m = re.match(r'^\s*(?:\d+[\d.]*|[IVXLC]+|(?i:ARTICLE|SECTION|CLAUSE)\s+[IVXLC\d]+)[.):\s]+(.+)', first)
    candidate = (m.group(1) if m else first).strip().rstrip(':').strip()
    words = candidate.split()
    # A heading is short, title-shaped, and not a full sentence.
    if 1 <= len(words) <= 8 and len(candidate) <= 60 and not candidate.endswith('.'):
        return candidate
    return ''


_SIGNATURE_RE = re.compile(
    r'^\s*(?:IN WITNESS WHEREOF|IN WITNESS THEREOF|ACCEPTED AND AGREED|SIGNED,?\s+(?:BY|SEALED))',
    re.IGNORECASE,
)


def is_signature_block(text: str) -> bool:
    """A signature/execution block (no heading) — 'IN WITNESS WHEREOF…' or signature fields."""
    if _SIGNATURE_RE.match(text.strip()):
        return True
    # No opening phrase: fall back to spotting signature-form fields. Two or more
    # such labels in a short block is a strong signal it's an execution block.
    low = text.lower()
    fields = sum(kw in low for kw in ('signature', 'print name', 'designation', 'date (mm'))
    return fields >= 2 and len(text) < 700


def _is_signature_heading(line: str) -> bool:
    """True if a single line opens a signature block (e.g. 'IN WITNESS WHEREOF…')."""
    return bool(_SIGNATURE_RE.match(line.strip()))


def annexure_prefix(text: str) -> str:
    """'Exhibit A' / 'Schedule 1' / '' — the exhibit identifier from the first line."""
    first = text.strip().splitlines()[0].strip() if text.strip() else ''
    # Group 1 = the keyword ("Exhibit"), group 2 = the optional identifier ("A", "1");
    # the [\s\-–—:.]* between them eats any separator (space, dash, colon, period).
    m = re.match(r'^\s*(exhibit|schedule|annexure|annex|appendix)\b[\s\-–—:.]*([A-Za-z0-9]+)?', first, re.IGNORECASE)
    if m:
        # Normalise to "Exhibit A": keyword title-cased, identifier upper-cased.
        return f'{m.group(1).capitalize()} {(m.group(2) or "").upper()}'.strip()
    return ''


def _annexure_doc_title(text: str) -> str:
    """Fallback descriptor for an annexure (used when no LLM name is available)."""
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    # Look at the two lines after the "Exhibit A" line for a descriptive sub-title:
    # an "order form" mention or a short ALL-CAPS title.
    for ln in lines[1:3]:
        if re.search(r'order\s+form', ln, re.IGNORECASE) or (ln.isupper() and len(ln.split()) <= 8):
            return ln.title() if ln.isupper() else ln
    # Last resort: detect an order form anywhere in the opening text.
    return 'Order Form' if re.search(r'order\s+form', text[:300], re.IGNORECASE) else ''


def clause_label(text: str) -> str:
    """Doc-derived label (no LLM): signature / annexure / section heading — or '' (LLM names it)."""
    if is_signature_block(text):
        return ''   # a signature/execution block has no section title — show no heading
    prefix = annexure_prefix(text)
    if prefix:
        desc = _annexure_doc_title(text)
        return f'{prefix} — {desc}' if desc else prefix
    return clause_title(text)


def _derive_heading(text: str) -> str:
    """Best-effort clause heading: a leading numbered/titled phrase, else first words."""
    first_line = text.strip().splitlines()[0].strip()
    # "3. Definition of Confidential Information. ..." -> "Definition of Confidential Information"
    m = re.match(r'^\s*(?:\d+[\d.]*|(?:ARTICLE|SECTION|CLAUSE)\s+[IVXivx\d]+)[.:)\s]+(.+)', first_line)
    candidate = m.group(1) if m else first_line
    # Cut at the first sentence break and cap length
    candidate = re.split(r'(?<=[a-z])\.\s', candidate)[0]
    words = candidate.split()
    heading = ' '.join(words[:8]).rstrip('.,;:')
    return heading or 'Clause'


def _parse_pdf(file_path: str) -> list[dict]:
    """Extract a PDF page-by-page (stripping watermarks), then split the joined
    text into clauses with the plain-text heading splitter."""
    import pdfplumber
    from statistics import mode

    pages = []
    with pdfplumber.open(file_path) as pdf:
        for page in pdf.pages:
            pages.append(_page_text_without_watermark(page, mode))
    text = '\n'.join(pages)
    # Insert newlines before top-level numbered clauses pdfplumber merged onto one line
    text = re.sub(r'(?<!\n)([ \t]+)(\d{1,2}[.)](?!\d)[ \t]+[A-Z])', r'\n\2', text)
    return _split_into_clauses(text)


def _page_text_without_watermark(page, mode) -> str:
    """Extract page text, dropping oversized characters.

    Watermarks/overlays are typically set in a much larger font than body text
    and get interleaved into the real text by the extractor (stray single
    characters and letters injected mid-word). Body text dominates the page, so
    its size is the modal char size; we drop characters far larger than that.
    """
    # x_tolerance=2 (vs default 3) recovers spaces lost in tightly-kerned ALL-CAPS
    # text ("BYWHATFIX(EXPRESSORIMPLIED)" -> "BY WHATFIX (EXPRESS OR IMPLIED)")
    # without over-splitting normal body text.
    sizes = [round(c['size']) for c in page.chars if c.get('size')]
    if not sizes:
        return page.extract_text(x_tolerance=2) or ''
    try:
        body = mode(sizes)
    except Exception:
        body = min(sizes)
    limit = max(24.0, body * 2.2)  # keep body + headings, drop large watermark glyphs
    kept = page.filter(lambda o: o.get('object_type') != 'char' or o.get('size', 0) <= limit)
    return kept.extract_text(x_tolerance=2) or ''


def _parse_docx(file_path: str) -> list[dict]:
    """Split a DOCX by document structure.

    Word templates usually auto-number their clause headings (the "1." "2." are
    list formatting, not literal text), so a regex on numbers finds nothing.
    Instead we detect headings from paragraph style + list numbering + shape,
    group the body under each heading, and fall back to the text-regex splitter
    only if no headings are found (e.g. a doc with literally-typed numbers).
    """
    from collections import Counter
    from docx import Document
    from docx.text.paragraph import Paragraph
    from docx.table import Table

    doc = Document(file_path)

    # Pass 1: collect block elements (paragraphs + table rows) in document order.
    blocks: list[tuple[str, str, object]] = []  # (kind, text, para|None)
    for child in doc.element.body.iterchildren():
        tag = child.tag
        if tag.endswith('}p'):
            para = Paragraph(child, doc)
            text = para.text.strip()
            if text:
                blocks.append(('p', text, para))
        elif tag.endswith('}tbl'):
            table = Table(child, doc)
            for row in table.rows:
                cells = [c.text.strip() for c in row.cells if c.text.strip()]
                if cells:
                    blocks.append(('tbl', ' — '.join(cells), None))

    # The clause-level list = the numbering id with the most top-level (ilvl 0)
    # items. Splitting on it handles clauses that have no title (the number sits
    # in front of a long paragraph), which the short-title heuristic misses.
    counts: Counter = Counter()
    for kind, _text, para in blocks:
        if kind == 'p':
            ni = _docx_numinfo(para)
            if ni and ni[1] == 0 and ni[0] is not None:
                counts[ni[0]] += 1
    primary_numid = counts.most_common(1)[0][0] if counts else None

    items = [
        (text,
         False if kind == 'tbl' else _docx_is_heading(text, para, primary_numid),
         para if kind == 'p' else None)
        for kind, text, para in blocks
    ]

    clauses = _group_docx_items(items)
    if len(clauses) > 1:
        return clauses
    # Fallback for docs without heading structure (literal numbering / plain paragraphs)
    return _split_into_clauses('\n'.join(text for _, text, _ in blocks))


# Connector/recital lines that look like ALL-CAPS headings but are not clause titles.
_HEADING_STOPWORDS = {
    'AND', 'OR', 'BETWEEN', 'BY AND BETWEEN', 'WHEREAS', 'NOW THEREFORE',
    'NOW, THEREFORE', 'WITNESSETH', 'IN WITNESS WHEREOF', 'RECITALS',
}

# A mid-sentence cross-reference, e.g. "Section 7.2 of this Agreement", "Article 5
# hereof" — a keyword + number followed by a lowercase connector word. These are
# NOT clause headings (a real heading is followed by a title or a period).
_CROSS_REF_RE = re.compile(
    r'^\s*(?i:ARTICLE|SECTION|CLAUSE|PARA(?:GRAPH)?)\s+\d+(?:\.\d+)*\s+'
    r'(?:of|hereof|hereto|herein|thereof|above|below|and|or|to|in|shall|as)\b'
)

# Exhibit / Schedule / Annexure / Order-Form boundary. Everything from here on is a
# fill-in annexure, not prose clauses — it is bundled into a single block.
_ANNEXURE_RE = re.compile(r'^\s*(?:EXHIBIT|SCHEDULE|ANNEXURE|ANNEX|APPENDIX)\b', re.IGNORECASE)


def _is_annexure_heading(line: str) -> bool:
    s = line.strip()
    if not s or len(s) > 80 or '__' in s:
        return False
    if _ANNEXURE_RE.match(s):
        return True
    # A standalone ALL-CAPS "... ORDER FORM" title (e.g. "WHATFIX SUBSCRIPTION ORDER FORM").
    if s == s.upper() and re.search(r'\bORDER\s+FORM\b', s) and len(s.split()) <= 8:
        return True
    return False


# TOP-LEVEL heading markers only — so sub-items stay inside their parent clause.
# Excludes decimal sub-sections (1.1 — the (?!\d) lookahead), lowercase Roman
# (i), ii)) and lettered points (a), (b)). The space after the marker is OPTIONAL
# because some PDFs drop it ("3.PROFESSIONAL SERVICES").
_NUM_HEADING_RE = re.compile(
    r'^\s*(?:'
    r'\d+[.)](?!\d)\s*'                                 # 1.  2)  10.PROFESSIONAL  (NOT 1.1)
    r'|[IVXLC]+[.)]\s*'                                 # IV.  VII)  (UPPERCASE Roman only)
    r'|(?i:ARTICLE|SECTION|CLAUSE|SCHEDULE|ANNEXURE|PART)\s+[IVXLC\d]+\s*'  # ARTICLE II
    r')\S'
)


def _has_numbering(para) -> bool:
    """True if a DOCX paragraph carries Word list-numbering (auto-numbered clause)."""
    pPr = para._p.pPr
    return pPr is not None and pPr.numPr is not None


def _docx_numinfo(para):
    """Return (numId, ilvl) for a list paragraph, or None if it isn't numbered."""
    pPr = para._p.pPr
    if pPr is None or pPr.numPr is None:
        return None
    numPr = pPr.numPr
    num_id = numPr.numId.val if numPr.numId is not None else None
    ilvl = numPr.ilvl.val if numPr.ilvl is not None else 0
    return (num_id, ilvl)


def _is_allcaps_heading(t: str) -> bool:
    """An ALL-CAPS short line that reads like a real section title.

    Kept deliberately strict: genuine titles ("DEFINITIONS", "GOVERNING LAW AND
    JURISDICTION") are short and have no sentence punctuation. ALL-CAPS *body*
    text — common in legal disclaimers, and worsened when a PDF drops the spaces
    ("BYWHATFIX(EXPRESSORIMPLIED)WITH") — must NOT be treated as a heading.
    """
    if not any(c.isalpha() for c in t) or t != t.upper():
        return False
    if t.rstrip('.').strip().upper() in _HEADING_STOPWORDS:
        return False
    if '.' in t or len(t) > 45:  # mid-text period or long line => body, not a title
        return False
    return 1 <= len(t.split()) <= 8 and t[-1] not in '.,;:'


def _is_heading_line(line: str) -> bool:
    """Heading detection for plain text (PDF / DOCX fallback).

    A numbered / Roman / ARTICLE-style marker at the START of a line begins a
    clause regardless of the line's length — many agreements put the clause
    number and its entire (long) text on a single line, with no title. The
    length cap applies only to ALL-CAPS heading detection.
    """
    s = line.strip()
    if not s or '__' in s:
        return False
    if _CROSS_REF_RE.match(s):  # "Section 7.2 of this Agreement" — a reference, not a heading
        return False
    if _NUM_HEADING_RE.match(s):
        return True
    return len(s) <= 120 and _is_allcaps_heading(s)


def _docx_is_heading(text: str, para, primary_numid=None) -> bool:
    """A clause heading: a Heading/Title style, a top-level item of the primary
    clause list, a short numbered title, or an ALL-CAPS title."""
    style = (para.style.name or '').lower() if para.style else ''
    if style.startswith('heading') or style == 'title':
        return True
    t = text.strip()
    if not t or not any(c.isalpha() for c in t):
        return False
    if '__' in t:  # fill-in line (e.g. "To the Employee: ____"), not a heading
        return False
    ni = _docx_numinfo(para)
    # Top-level item of the main clause list — a clause start even if it's long
    # (numbered clauses with no title).
    if primary_numid is not None and ni is not None and ni[1] == 0 and ni[0] == primary_numid:
        return True
    # Short, title-shaped numbered item.
    if ni is not None and len(t) <= 90 and len(t.split()) <= 12 and t[-1] not in '.,;:':
        return True
    # ALL-CAPS heading line without list numbering (common in older templates).
    if _is_allcaps_heading(t):
        return True
    return False


def _group_docx_items(items: list[tuple]) -> list[dict]:
    """Group (text, is_heading, para|None) items into clauses: each heading + its
    following body. Captures per-clause `style` (heading + dominant body paragraph)
    from the python-docx Paragraph objects, for DOCX style preservation."""
    clauses: list[dict] = []
    heading: str | None = None
    heading_para = None
    body: list[str] = []
    body_paras: list = []
    started = False

    def flush():
        """Emit the pending heading + accumulated body as one clause (if non-empty)."""
        parts = ([heading] if heading else []) + body
        combined = '\n'.join(parts).strip()
        if not combined:
            return
        clause = {
            'clause_type': _classify_clause(combined),
            'position': len(clauses),
            'text': combined,
        }
        style: dict = {}
        if heading_para is not None:
            hs = _para_style(heading_para)
            if hs:
                style['heading'] = hs
        first_body = next((p for p in body_paras if p is not None), None)
        if first_body is not None:
            bs = _para_style(first_body)
            if bs:
                style['body'] = bs
        if style:
            clause['style'] = style
        clauses.append(clause)

    in_annexure = False
    for text, is_heading, para in items:
        if in_annexure:
            body.append(text)  # bundle the entire remainder into the annexure clause
            body_paras.append(para)
            continue
        if _is_annexure_heading(text):
            flush()
            heading, heading_para, body, body_paras, started, in_annexure = text, para, [], [], True, True
            continue
        if _is_signature_heading(text):  # signature/execution block — its own clause
            flush()
            heading, heading_para, body, body_paras, started = text, para, [], [], True
            continue
        if is_heading:
            if started or body:
                flush()
            heading, heading_para, body, body_paras, started = text, para, [], [], True
        else:
            body.append(text)
            body_paras.append(para)
    flush()
    return clauses


def _chunks_to_clauses(chunks: list[str], min_len: int = 40) -> list[dict]:
    """Turn raw text chunks into clause dicts, dropping chunks shorter than
    `min_len` (noise such as page numbers or stray fragments)."""
    clauses = []
    for chunk in chunks:
        chunk = chunk.strip()
        # Skip too-short chunks (headers/footers/blank fragments).
        if len(chunk) < min_len:
            continue
        clauses.append({
            'clause_type': _classify_clause(chunk),
            'position': len(clauses),
            'text': chunk,
        })
    return clauses


def _split_into_clauses(text: str) -> list[dict]:
    """Split plain text into clauses by scanning for heading lines.

    Handles numbered (1., 1.1, 2), (3)), Roman (IV.), ARTICLE/SECTION/CLAUSE/
    SCHEDULE/PART, and ALL-CAPS headings. Guarantees a usable list: if no headings
    are found it splits on blank lines, and never returns a single mega-clause for
    a long document.
    """
    lines = text.split('\n')
    chunks: list[str] = []
    current: list[str] = []
    in_annexure = False
    for line in lines:
        if in_annexure:
            current.append(line)  # bundle the entire remainder into one block
            continue
        if _is_annexure_heading(line):
            if current:
                chunks.append('\n'.join(current))
            current = [line]
            in_annexure = True
            continue
        if _is_signature_heading(line) and current:  # signature block — its own clause
            chunks.append('\n'.join(current))
            current = [line]
            continue
        if _is_heading_line(line) and current:
            chunks.append('\n'.join(current))
            current = [line]
        else:
            current.append(line)
    if current:
        chunks.append('\n'.join(current))

    clauses = _chunks_to_clauses(chunks)
    if len(clauses) > 1:
        return clauses

    # Fallback 1: blank-line paragraphs
    clauses = _chunks_to_clauses(re.split(r'\n{2,}', text))
    if len(clauses) > 1:
        return clauses

    # Fallback 2: never collapse a long document to nothing — return it whole.
    whole = text.strip()
    return [{'clause_type': _classify_clause(whole), 'position': 0, 'text': whole}] if whole else []


_KEYWORDS: dict[str, list[str]] = {
    'parties':      ['between', 'hereinafter referred to', 'party a', 'party b', 'disclosing party', 'receiving party'],
    'recitals':     ['whereas', 'now therefore', 'in consideration', 'background'],
    'definition':   ['confidential information means', 'defined as', '"confidential information"', "'confidential information'"],
    'obligations':  ['shall not disclose', 'keep confidential', 'protect', 'maintain secrecy', 'shall not use'],
    'exclusions':   ['shall not apply', 'does not include', 'excluded from', 'public domain', 'independently developed'],
    'term':         ['term of', 'period of', 'years from', 'months from', 'terminate', 'expiry'],
    'governing_law':['governed by', 'jurisdiction', 'courts of', 'laws of india', 'applicable law'],
    'general':      [],
}


def _classify_clause(text: str) -> str:
    """Best-effort clause type from keyword hits in `_KEYWORDS`.

    Scores each type by how many of its keywords appear in the (lower-cased) text
    and returns the highest scorer, defaulting to 'general' when nothing matches.
    """
    lower = text.lower()
    # Count keyword hits per clause type.
    scores = {t: sum(1 for kw in kws if kw in lower) for t, kws in _KEYWORDS.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else 'general'
