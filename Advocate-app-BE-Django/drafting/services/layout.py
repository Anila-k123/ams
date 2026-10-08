"""Paragraph alignment of a Word template or sample, so a generated draft lays out like it.

A generated clause is new text, so its lines can't simply inherit the source's paragraphs one to
one. What carries over: the clause's usual (dominant) body alignment, plus the alignment of lines
that stand out and come back recognisably in the draft: a centred title, a right-aligned date or
signature, a left-aligned address block inside justified text. `layout_for(text)` gives a clause
that much, as {'align': dominant, 'lines': [[prefix, align], ...]}; `align_line` applies it.

Alignment is read the way Word resolves it: the paragraph's own setting, else its style's, else
the style it is based on. A PDF stores no alignment, so it is inferred from where each line sits
between the page's text margins (pdf_paragraphs). docs/DRAFT_EXPORT.md, "Layout from the template".
"""

import re
from collections import Counter

_ALIGN = {0: 'left', 1: 'center', 2: 'right', 3: 'justify'}
PREFIX = 32


def _norm(text):
    return re.sub(r'[^a-z0-9]+', ' ', (text or '').lower()).strip()


def _resolved_align(para):
    """The paragraph's alignment, falling back through its style chain (Normal = Justified etc.)."""
    if para.alignment is not None:
        return _ALIGN.get(int(para.alignment), 'left')
    style = para.style
    while style is not None:
        fmt = getattr(style, 'paragraph_format', None)
        if fmt is not None and fmt.alignment is not None:
            return _ALIGN.get(int(fmt.alignment), 'left')
        style = getattr(style, 'base_style', None)
    return 'left'


def docx_paragraphs(file_path):
    """[(text, align)] for every non-empty paragraph of a .docx, in order (tables skipped: their
    cells keep the editor default). [] for anything that isn't a readable .docx."""
    if not str(file_path).lower().endswith('.docx'):
        return []
    try:
        from docx import Document
        doc = Document(file_path)
    except Exception:
        return []
    out = []
    for para in doc.paragraphs:
        for line in (para.text or '').split('\n'):
            if line.strip():
                out.append((line.strip(), _resolved_align(para)))
    return out


def pdf_paragraphs(file_path, tol=6.0):
    """[(line text, align)] for every text line of a PDF, inferred from position: the text block's
    left / right edges are the page's widest lines; a line with equal room on both sides is centred,
    one that ends at the right edge but starts well in is right-aligned, one that runs edge to edge
    is justified, anything else is left. [] when the PDF can't be read (e.g. a scan)."""
    try:
        import pdfplumber
    except ImportError:
        return []
    out = []
    try:
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                lines = [ln for ln in page.extract_text_lines() if (ln.get('text') or '').strip()]
                if not lines:
                    continue
                xs0 = sorted(ln['x0'] for ln in lines)
                xs1 = sorted(ln['x1'] for ln in lines)
                left = xs0[len(xs0) // 10]                 # 10th percentile: ignore stray marks
                right = xs1[-(len(xs1) // 10) - 1]
                width = max(right - left, 1)
                for ln in lines:
                    gap_l, gap_r = ln['x0'] - left, right - ln['x1']
                    if gap_l > tol * 3 and abs(gap_l - gap_r) <= tol * 2:
                        align = 'center'
                    elif gap_l > width * 0.25 and gap_r <= tol:
                        align = 'right'
                    elif gap_l <= tol and gap_r <= tol:
                        align = 'justify'
                    else:
                        align = 'left'
                    out.append((ln['text'].strip(), align))
    except Exception:
        return []
    return out


def source_paragraphs(file_path):
    """The (text, align) lines of a template or sample file, Word or PDF."""
    path = str(file_path or '').lower()
    if path.endswith('.docx'):
        return docx_paragraphs(file_path)
    if path.endswith('.pdf'):
        return pdf_paragraphs(file_path)
    return []


def layout_for(text, paragraphs):
    """The layout of one clause, whose source text is `text`, from the document's paragraphs:
    the clause's lines are found in order, their dominant alignment taken, and the lines that
    differ from it kept by their first words. None when the clause isn't found."""
    lines = [_norm(x) for x in (text or '').split('\n') if x.strip()]
    if not lines or not paragraphs:
        return None
    normed = [(_norm(t), a) for t, a in paragraphs]
    # Where the clause starts: the first paragraph matching its first line.
    start = next((i for i, (t, _) in enumerate(normed) if t and t[:PREFIX] == lines[0][:PREFIX]), None)
    if start is None:
        return None
    found, i = [], start
    for line in lines:
        while i < len(normed) and normed[i][0][:PREFIX] != line[:PREFIX]:
            i += 1
            if i - start > len(lines) * 3 + 60:  # wandered off (PDFs add wrapped lines): stop looking
                break
        if i < len(normed) and normed[i][0][:PREFIX] == line[:PREFIX]:
            found.append(normed[i])
            i += 1
    if not found:
        return None
    body = found[1:] if len(found) > 1 else found        # the first line is usually the heading
    dominant = Counter(a for _, a in body).most_common(1)[0][0]
    distinct = [[t[:PREFIX], a] for t, a in found if a != dominant and len(t) >= 3]
    return {'align': dominant, 'lines': distinct, 'first': found[0][1]}


def document_layout(paragraphs):
    """A whole document's layout (for samples, where clauses aren't tracked): dominant alignment
    of its paragraphs plus every line that differs."""
    if not paragraphs:
        return None
    dominant = Counter(a for _, a in paragraphs).most_common(1)[0][0]
    distinct = [[_norm(t)[:PREFIX], a] for t, a in paragraphs if a != dominant and len(_norm(t)) >= 3]
    return {'align': dominant, 'lines': distinct}


def align_line(line, layout):
    """The alignment for one generated line: a stand-out line of the source it matches by its first
    words, else the clause's dominant alignment ('' = editor default)."""
    if not layout:
        return ''
    key = _norm(line)[:PREFIX]
    if key:
        for prefix, align in layout.get('lines') or []:
            # The whole short line ("from", "to") or the first words of a longer one.
            n = min(len(prefix), len(key), 20)
            if prefix == key or (n >= 8 and prefix[:n] == key[:n]):
                return '' if align == 'left' else align
    align = layout.get('align') or 'left'
    return '' if align == 'left' else align
