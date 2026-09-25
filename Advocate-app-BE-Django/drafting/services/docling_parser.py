"""Layout-aware clause extraction for PDFs via Docling.

Docling runs an ML layout model that recovers a document's real structure —
reading order, section headers, lists, tables — far better than the text-regex
splitter for messy PDFs. We use it for PDF samples; DOCX keeps the python-docx
parser (which is both accurate and captures formatting for style preservation).

`docling_clauses(path)` returns the same shape as parser.extract_clauses:
``[{clause_type, position, text}]``. The heavy DocumentConverter (loads models
on first use) is built once per process and cached.
"""
import logging
import re

logger = logging.getLogger(__name__)

_converter = None

# Short connector / recital lines Docling mis-tags as section headers. They must NOT
# start a new clause — they belong to the preamble (mirrors parser._HEADING_STOPWORDS).
_CONNECTOR_HEADINGS = {
    'and', 'or', 'between', 'by and between', 'whereas', 'now therefore',
    'now, therefore', 'witnesseth', 'recitals', 'in witness whereof',
}


def _is_connector(text: str) -> bool:
    """A standalone connector/recital word that isn't a real clause heading."""
    return re.sub(r'[\s:.\-]+$', '', (text or '').strip().lower()) in _CONNECTOR_HEADINGS


def _is_numbered_clause_heading(line: str) -> bool:
    """True if a line looks like a top-level numbered clause title (1 …, 2. …,
    ARTICLE/SECTION/CLAUSE N) — the boundary where the real body begins."""
    return bool(re.match(r'^\s*(?:\d+[.\s)]|ARTICLE\s|SECTION\s|CLAUSE\s)', (line or '').strip(), re.I))


# RUN-IN headings: a clause title inline at the start of a paragraph, followed by a
# period and its body — Docling tags these as ordinary text (no visual separation), so
# without this the whole document collapses into one clause. Three styles are covered:
#   numbered     "4. Compelled Disclosure. In the event…"
#   ALL-CAPS     "SERVICES. Saile agrees…"
#   Title-Case   "No Obligation of Confidentiality. The obligation…"
_RUNIN_STOP = {'and', 'or', 'whereas', 'now therefore', 'now, therefore',
               'in witness whereof', 'by and between', 'provided', 'between'}
_TOK = r"[A-Z][A-Za-z0-9'&\-]*"                                  # a Capitalised/UPPER token
_CONN = r"(?:of|and|or|the|to|for|a|an|in|on|by|with|&|" + _TOK + r")"
_PHRASE = _TOK + r"(?:[ \-]" + _CONN + r"){0,6}"                 # heading phrase (caps + connectors)
_NUM_RUNIN = re.compile(r"^\s*(\d+(?:\.\d+)*)[.)]\s+(" + _PHRASE + r")\s?\.\s+(?=\S)")
_CAPS_RUNIN = re.compile(r"^\s*([A-Z][A-Z0-9][A-Z0-9 ,&/'\-]{1,58}?)\s?\.\s+(?=\S)")
_TITLE_RUNIN = re.compile(r"^\s*(" + _PHRASE + r")\s?\.\s+(?=\S)")


# Start of the execution / signature block — from here to the end of the document is
# ONE clause (signatures, party lines, Name/Title/Date), never split into fragments.
_SIG_START = re.compile(
    r'^\s*(?:IN WITNESS WHEREOF|ACCEPTED AND AGREED|SIGNED\s+(?:by|for)\b|EXECUTED\s+(?:by|as)\b|DULY EXECUTED)',
    re.I)

# An EXHIBIT / SCHEDULE / ANNEXURE heading is a real section that can follow the main
# signature block — so it BREAKS signature bundling: without this, a document whose
# signatures precede its exhibits would swallow every exhibit into the signature clause.
_ANNEX_START = re.compile(
    r'^\s*(?:EXHIBIT|SCHEDULE|ANNEXURE|ANNEX|APPENDIX|ADDENDUM)\b', re.I)


def _runin_heading(text: str):
    """If `text` starts with a run-in clause heading, return (heading, body); else None."""
    t = (text or '').strip()
    m = _NUM_RUNIN.match(t)
    if m and m.group(2).strip().lower() not in _RUNIN_STOP:
        return f"{m.group(1)}. {m.group(2).strip()}", t[m.end():].strip()
    m = _CAPS_RUNIN.match(t)
    if m and m.group(1).strip().lower() not in _RUNIN_STOP:
        return m.group(1).strip(), t[m.end():].strip()
    m = _TITLE_RUNIN.match(t)
    if m:
        head = m.group(1).strip()
        if head.lower() not in _RUNIN_STOP and len(head.split()) >= 2:  # ≥2 words → real title, not a stray sentence
            return head, t[m.end():].strip()
    return None


# Colon-terminated clause headings. On dense form-book scans Docling tags these
# inconsistently (some as section_header, some as list_item) and even MERGES several
# clauses into one text block. We detect a heading at the START or EMBEDDED mid-text:
#   numbered  "6. TERM :", "17. ASSIGNMENT:", "18. DISPUTE RESOLUTION:"  (top-level only)
#   ALL-CAPS  "NON SOLICITATION:", "SERVICE OBLIGATIONS :"
# Sub-numbers ("16.2", "5.1") are excluded (no space after the first dot), so numbered
# lists inside a clause aren't shredded.
_EMBED_HEADING = re.compile(
    r'(?:^|(?<=[.\s)]))'
    r'('
    r'\d{1,2}\.\s+[A-Z][A-Za-z0-9][A-Za-z0-9 &/\'\-]{1,45}?\s*:'
    r'|[A-Z][A-Z][A-Z0-9 &/\'\-]{2,45}?\s*:'
    r')(?=\s|$)')


# Function words that never START a real clause heading — used to reject an ALL-CAPS
# sentence fragment that merely happens to end in a colon (e.g. "…TO ABIDE BY THE
# FOLLOWING OBLIGATIONS & STIPULATIONS:").
_STOP_LEAD = {'by', 'to', 'of', 'the', 'a', 'an', 'and', 'or', 'in', 'on', 'for', 'with',
              'as', 'at', 'but', 'if', 'that', 'which', 'this', 'these', 'such', 'shall',
              'any', 'each', 'all', 'are', 'is', 'was', 'will', 'may', 'from', 'into'}


def _valid_heading(h: str) -> bool:
    """A candidate colon/numbered heading is real only if it's short and doesn't open
    with a function word (which would mark it as a mid-sentence fragment)."""
    core = re.sub(r'^\d+\.\s*', '', h).strip()      # drop any leading clause number
    words = core.split()
    return bool(words) and words[0].lower() not in _STOP_LEAD and len(words) <= 6


def _split_on_headings(text: str):
    """Split one text block into ``[(heading|None, body)]`` at colon/numbered clause
    headings appearing at the start OR embedded mid-block. The first segment's heading is
    None when the block opens with body continuation (belongs to the current clause)."""
    matches = [m for m in _EMBED_HEADING.finditer(text)
               if _valid_heading(m.group(1).rstrip(':').strip())]
    if not matches:
        return [(None, text.strip())]
    out = []
    pre = text[:matches[0].start()].strip()
    if pre:
        out.append((None, pre))
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        head = m.group(1).strip().rstrip(':').strip()
        out.append((head, text[m.end():end].strip()))
    return out


def _boilerplate_lines(texts: list[str]) -> set[str]:
    """Repeating page furniture to strip before splitting — running headers/footers and
    watermark URLs (e.g. 'www.advocateshah.com') that Docling interleaves with real text
    and which break heading/signature detection. A short line seen 3+ times is furniture."""
    from collections import Counter
    counts: Counter = Counter()
    for t in texts:
        for ln in t.splitlines():
            s = ln.strip()
            if s and len(s) <= 60:
                counts[s] += 1
    noise = {s for s, n in counts.items() if n >= 3}
    # A short ALL-CAPS line that recurs even TWICE is a running header/footer (e.g. the
    # document title repeated atop each page: "MASTER SERVICES AGREEMENT"). Left in place it
    # wedges between clauses and makes the model drop the sub-clause after it (e.g. 18.3).
    noise |= {s for s, n in counts.items()
              if n >= 2 and len(s) <= 45 and s.isupper() and re.search(r'[A-Z]', s)
              and not _is_connector(s)}
    # Watermark URLs are often PREPENDED to real lines (so they aren't standalone) — catch
    # any bare-domain / URL token that recurs 3+ times as a substring across the document.
    urls = Counter(re.findall(r'(?:https?://|www\.)[A-Za-z0-9./_+\-]+', ' '.join(texts)))
    noise |= {u for u, n in urls.items() if n >= 3}
    return noise


def _strip_noise(text: str, noise: set[str]) -> str:
    """Remove boilerplate phrases and a leading page-number prefix from an item's text."""
    for phrase in noise:
        text = text.replace(phrase, ' ')
    text = re.sub(r'^\s*\d{2,4}\s+(?=[A-Za-z])', '', text)  # leading page number ("2207 lected by…")
    return re.sub(r'[ \t]{2,}', ' ', text).strip()


def _split_on_runin_headings(text: str) -> list[str]:
    """Split body text at run-in clause headings (N. Title. Body) only.

    Skips bare numbered sub-items that start directly with body text
    (e.g. "1. The Company shall…") — those have no period-terminated title phrase
    and _runin_heading returns None for them. Only splits when _runin_heading
    positively identifies a real titled clause boundary, making this safe for any
    document layout: numbered sub-items in MSAs stay together; titled clauses in
    NDAs/service agreements are separated.
    """
    lines = text.split('\n')
    chunks: list[str] = []
    current: list[str] = []
    for line in lines:
        if _runin_heading(line.strip()) is not None and current:
            chunks.append('\n'.join(current))
            current = [line]
        else:
            current.append(line)
    if current:
        chunks.append('\n'.join(current))
    return [c.strip() for c in chunks if c.strip()]


def _get_converter():
    """Process-wide DocumentConverter (models load once, on first conversion)."""
    global _converter
    if _converter is None:
        from docling.document_converter import DocumentConverter
        _converter = DocumentConverter()
    return _converter


def _table_text(item, doc) -> str:
    """Best-effort plain text for a table item (Markdown), or '' if unavailable."""
    try:
        return (item.export_to_markdown(doc=doc) or '').strip()
    except Exception:
        try:
            return (item.export_to_markdown() or '').strip()
        except Exception:
            return ''


def _reading_order(doc):
    """Yield the document's items in true top-to-bottom reading order (per page),
    using each item's bounding box. Docling's default iteration sometimes CLUSTERS
    list items together and defers a text/table block that visually sits between
    them (e.g. a NOTICE clause's address block landing after 8.3.1/8.3.2). Re-sorting
    by page + vertical position restores the on-page order. (Assumes single-column
    layout, which legal agreements are.)"""
    rows, last = [], (0, 0.0)
    for idx, (item, _lvl) in enumerate(doc.iterate_items()):
        prov = getattr(item, 'prov', None)
        if prov:
            p = prov[0]
            bbox = p.bbox
            # Normalise to a top-down key (smaller = higher on the page).
            ykey = -bbox.t if 'BOTTOM' in str(getattr(bbox, 'coord_origin', '')).upper() else bbox.t
            last = (p.page_no, ykey)
        page, ykey = last  # items without geometry inherit their neighbour's position
        rows.append((page, ykey, idx, item))
    rows.sort(key=lambda r: (r[0], r[1], r[2]))
    return [r[3] for r in rows]


def docling_clauses(file_path: str) -> list[dict]:
    """Convert a document with Docling and group it into clauses: each section
    header (or title) starts a clause; the text/list/table items that follow form
    its body. Raises on conversion failure so the caller can fall back."""
    from .parser import _classify_clause  # lazy import — avoids a circular import

    doc = _get_converter().convert(file_path).document
    clauses: list[dict] = []
    heading: str | None = None
    body: list[str] = []
    real = False           # did the current clause start at a real heading? (a clause boundary)
    in_signature = False   # once true, everything left is bundled into one Signature Block

    def flush():
        parts = ([heading] if heading else []) + body
        combined = '\n'.join(p for p in parts if p).strip()
        if combined:
            clauses.append({
                'clause_type': _classify_clause(combined),
                'position': len(clauses),
                'text': combined,
                '_real': real,    # transient: a heading-started clause is a real boundary
            })

    # First pass: collect item texts (whitespace-normalised) so we can learn the page
    # furniture (running headers/watermarks) that repeats across the document.
    items: list[tuple[str, str]] = []
    for item in _reading_order(doc):
        label = str(getattr(item, 'label', '')).lower()
        text = (getattr(item, 'text', '') or '').strip()
        if not text and 'table' in label:
            text = _table_text(item, doc)
        if not text:
            continue
        # Numbered/bulleted list items: Docling stores the marker ("1.", "a.", "•") in
        # item.marker separately from item.text. Prepend it so the number isn't lost when
        # the clause is stored in the DB and passed to the LLM.
        if 'list_item' in label:
            marker = (getattr(item, 'marker', '') or '').strip()
            if marker and not text.startswith(marker):
                text = marker + ' ' + text
        # Collapse runs of spaces and rejoin a space-split hyphen ("Non -circumvention").
        text = re.sub(r'[ \t]{2,}', ' ', text)
        text = re.sub(r'(?<=[A-Za-z])\s+-\s*(?=[A-Za-z])', '-', text)
        items.append((label, text))
    noise = _boilerplate_lines([t for _, t in items])

    def start_clause(head, first_body):
        nonlocal heading, body, real
        flush()
        heading, body, real = head, ([first_body] if first_body else []), True

    for label, text in items:
        text = _strip_noise(text, noise)
        if not text or not re.search(r'[A-Za-z]', text):   # empty / page number / rule line
            continue
        # Once the execution/signature block starts, bundle EVERYTHING remaining into it —
        # never split the signatures into fragments — UNLESS an Exhibit/Schedule/Annexure
        # heading appears: that's a real section that follows the signatures.
        if in_signature:
            if _ANNEX_START.match(text):
                start_clause(text, None)
                in_signature = False
                continue
            body.append(text)
            continue
        if _SIG_START.match(text):
            # No synthetic label — the block's own lead-in is its first line.
            flush()
            heading, body, real, in_signature = None, [text], False, True
            continue
        # A section header / title begins a new clause — UNLESS it's a connector word
        # ("AND", "WHEREAS", …), which Docling mis-tags as a header; those stay in the
        # current clause's body so the preamble isn't shredded into pieces.
        if (label.endswith('section_header') or label.endswith('title')) and not _is_connector(text):
            start_clause(text, None)
            continue
        # Not a Docling header: the block may hold one or more colon/numbered headings, at
        # the start or merged mid-text (dense scans). Split it and emit a clause per heading.
        for seg_head, seg_body in _split_on_headings(text):
            if seg_head is None:
                rh = _runin_heading(seg_body)      # a period run-in heading at the start?
                if rh:
                    start_clause(rh[0], rh[1])
                elif seg_body:
                    body.append(seg_body)
            elif _is_connector(seg_head):
                body.append(seg_head + ((': ' + seg_body) if seg_body else ':'))
            else:
                start_clause(seg_head, seg_body)
    flush()

    # Re-split any clause that contains multiple embedded numbered clauses — happens when
    # Docling delivers the whole document body as one text block (e.g. a simple one-page
    # NDA where clauses 1–9 are one paragraph run). Insert newlines before "N. Cap…"
    # patterns that appear mid-line, then run the plain-text splitter on the result.
    from .parser import _classify_clause as _cls
    expanded: list[dict] = []
    for clause in clauses:
        text = clause['text']
        # Normalise: insert newlines before "N. Cap…" patterns merged mid-line.
        normalised = re.sub(
            r'(?<!\n)([ \t]+)(\d{1,2}[.)](?!\d)[ \t]+[A-Z])',
            r'\n\2', text,
        )
        # Re-split only at true run-in clause headings (N. Title. Body), not at bare
        # sub-items (N. The Consultant shall…). _runin_heading is the discriminator:
        # it requires a title phrase terminated by a period before the body text.
        sub_texts = _split_on_runin_headings(normalised)
        if len(sub_texts) <= 1:
            expanded.append(clause)
        else:
            is_real = clause.get('_real', False)
            for st in sub_texts:
                expanded.append({
                    'clause_type': _cls(st),
                    'position': 0,   # renumbered in the final loop below
                    'text': st,
                    '_real': is_real,
                })
    clauses = expanded

    # Merge everything before the first REAL clause into one Preamble — a numbered clause
    # ("1 DEFINITIONS") or a run-in clause. This absorbs the title + parties + recitals
    # (and any party-name lines Docling mis-tags as headers) without swallowing real
    # clauses, so Mode 2 rewrites the preamble once instead of as N fragments.
    first_real = next(
        (i for i, c in enumerate(clauses)
         if c.get('_real') or _is_numbered_clause_heading(c['text'].splitlines()[0] if c['text'] else '')),
        None,
    )
    if first_real and first_real > 1:
        merged_text = '\n'.join(c['text'] for c in clauses[:first_real]).strip()
        clauses = [{'clause_type': _classify_clause(merged_text), 'position': 0, 'text': merged_text}] + clauses[first_real:]

    for i, c in enumerate(clauses):
        c['position'] = i
        c.pop('_real', None)
    return clauses
