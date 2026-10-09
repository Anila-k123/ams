"""Paragraphs (docx.Para) back to editor HTML: the reverse of docx.html_to_blocks.

Used when a review round's decisions leave a clause with some changes accepted and some
not (drafting/review.py), so the clause is rebuilt paragraph by paragraph. Writes what
the TipTap editor reads: <p> (with text-align), <h1>-<h3>, nested <ul>/<ol> with <li><p>,
<strong>/<em>/<u>/<s>, <br>, and tables: consecutive 'Table Row' paragraphs (a row flattened for
comparison, cells separated by tabs) become a <table> again. Clauses where every change got
the same decision keep their original HTML untouched.
"""

import html
import re

_FMT_TAGS = (('bold', 'strong'), ('italic', 'em'), ('underline', 'u'), ('strike', 's'))
_LIST_RE = re.compile(r'^List (Bullet|Number)(?: (\d))?$')


def _runs_html(runs):
    out = []
    for text, fmt in runs:
        if text == '\n':
            out.append('<br>')
            continue
        piece = html.escape(text, quote=False)
        for name, tag in _FMT_TAGS:
            if fmt and name in fmt:
                piece = f'<{tag}>{piece}</{tag}>'
        out.append(piece)
    return ''.join(out)


def _align(para):
    return f' style="text-align: {para.align}"' if para.align else ''


def paras_to_html(paras):
    out = []
    stack = []   # open list tags, one per nesting level; each level's last <li> is still open

    def close_to(depth):
        while len(stack) > depth:
            out.append(f'</li></{stack.pop()}>')

    rows = []    # pending table rows: [[cell runs, ...], ...]

    def flush_table():
        if not rows:
            return
        cols = max(len(r) for r in rows)
        out.append('<table><tbody>')
        for r in rows:
            cells = r + [[]] * (cols - len(r))
            out.append('<tr>' + ''.join(f'<td><p>{_runs_html(c)}</p></td>' for c in cells) + '</tr>')
        out.append('</tbody></table>')
        rows.clear()

    for para in paras:
        if para.style == 'Table Row':
            close_to(0)
            rows.append(_cells(para.runs))
            continue
        flush_table()
        m = _LIST_RE.match(para.style or '')
        if not m:
            close_to(0)
            heading = re.match(r'^Heading (\d)$', para.style or '')
            tag = f'h{min(int(heading.group(1)), 3)}' if heading else 'p'
            out.append(f'<{tag}{_align(para)}>{_runs_html(para.runs)}</{tag}>')
            continue
        kind = 'ul' if m.group(1) == 'Bullet' else 'ol'
        depth = int(m.group(2) or 1)
        close_to(depth)
        if len(stack) == depth and stack[-1] != kind:   # same level, other list type
            close_to(depth - 1)
        if len(stack) == depth:
            out.append('</li>')                         # next item at this level
        while len(stack) < depth:
            out.append(f'<{kind}>')
            stack.append(kind)
        out.append(f'<li><p{_align(para)}>{_runs_html(para.runs)}</p>')
    flush_table()
    close_to(0)
    return ''.join(out)


def _cells(runs):
    """A flattened table row's runs split back into cells at the tab separators."""
    cells, cur = [], []
    for text, fmt in runs:
        if text == '\n':
            continue
        parts = text.split('\t')
        for i, part in enumerate(parts):
            if i:
                cells.append(cur)
                cur = []
            if part:
                cur.append((part, fmt))
    cells.append(cur)
    return cells


def paras_to_text(paras):
    """The plain-text projection kept in DraftBlock.text."""
    return '\n'.join(''.join(t for t, _ in p.runs) for p in paras)
