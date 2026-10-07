"""Redline: two versions of a draft as one .docx with real Word tracked changes.

render_redline_docx(before, after, title, author, branding=None) -> (bytes, stats)

`before` / `after` are block snapshots (drafting/versions.py::snapshot_blocks). Word
shows the result in Review mode, so opposite counsel or the client can Accept or
Reject each change, the same as a file marked up in Word itself.

How the two sides are compared:
- Clauses are paired by block id, falling back to the heading when the ids differ
  (a re-draft creates new blocks). Unpaired clauses are wholly inserted or deleted.
- Inside a clause, paragraphs are aligned, then paired paragraphs are compared word
  by word. Only words count: a change of bold or alignment alone is not marked,
  as in legal comparison tools. Tables are compared row by row as text.
"""

import datetime
import difflib
import io
import re

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from .docx import ALIGN, Para, Table, _branding, _setup, _style_or_normal, _text_to_blocks, html_to_blocks

TOKEN_RE = re.compile(r'\s+|\w+|[^\w\s]')


def _norm(text):
    return re.sub(r'\s+', ' ', text or '').strip().lower()


# --- pairing clauses ---------------------------------------------------------

def _pair_blocks(before, after):
    """[(old_block | None, new_block | None)] in document order."""
    old_ids = {b['block_id'] for b in before}
    old_by_heading = {}
    for b in before:
        if _norm(b['heading']):
            old_by_heading.setdefault(_norm(b['heading']), []).append(b['block_id'])
    claimed = {b['block_id'] for b in after if b['block_id'] in old_ids}

    def key(block):
        if block['block_id'] in old_ids:
            return block['block_id']
        # A new block with the same heading as an unclaimed old one is that clause, redrafted.
        for old_id in old_by_heading.get(_norm(block['heading']), []):
            if old_id not in claimed:
                claimed.add(old_id)
                return old_id
        return ('new', block['block_id'])

    old_keys = [b['block_id'] for b in before]
    new_keys = [key(b) for b in after]
    pairs = []
    matcher = difflib.SequenceMatcher(None, old_keys, new_keys, autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == 'equal':
            pairs += list(zip(before[i1:i2], after[j1:j2]))
        else:
            pairs += [(b, None) for b in before[i1:i2]] + [(None, b) for b in after[j1:j2]]
    return pairs


# --- clause -> paragraphs ----------------------------------------------------

def _paras(block):
    """The clause body as a flat list of Para (table rows become tab-separated lines)."""
    if block is None:
        return []
    body = html_to_blocks(block['content_html']) if (block['content_html'] or '').strip() \
        else _text_to_blocks(block['text'])
    out = []
    for item in body:
        if isinstance(item, Para):
            out.append(item)
            continue
        for row in item.rows:   # Table
            runs = []
            for i, cell in enumerate(row):
                if i:
                    runs.append(('\t', frozenset()))
                for j, p in enumerate(x for x in cell if isinstance(x, Para)):
                    if j:
                        runs.append((' ', frozenset()))
                    runs += [r for r in p.runs if r[0] != '\n']
            out.append(Para(runs=runs))
    return out


def _para_text(para):
    return ''.join(t for t, _ in para.runs)


def _tokens(para):
    """[(token, formats)]; a line break is its own '\n' token."""
    out = []
    for text, fmt in para.runs:
        if text == '\n':
            out.append(('\n', frozenset()))
        else:
            out += [(t, fmt) for t in TOKEN_RE.findall(text)]
    return out


# --- Word XML ----------------------------------------------------------------

class _Writer:
    def __init__(self, doc, author):
        self.doc = doc
        self.author = author
        self.date = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        self.next_id = 1
        self.inserted = self.deleted = 0   # words

    def _mark(self, tag):
        el = OxmlElement(tag)
        el.set(qn('w:id'), str(self.next_id))
        el.set(qn('w:author'), self.author)
        el.set(qn('w:date'), self.date)
        self.next_id += 1
        return el

    def _run(self, text, fmt, deleted=False):
        r = OxmlElement('w:r')
        rpr = OxmlElement('w:rPr')
        for name, tag in (('bold', 'w:b'), ('italic', 'w:i'), ('strike', 'w:strike')):
            if name in fmt:
                rpr.append(OxmlElement(tag))
        if 'underline' in fmt:
            u = OxmlElement('w:u')
            u.set(qn('w:val'), 'single')
            rpr.append(u)
        if len(rpr):
            r.append(rpr)
        for i, part in enumerate(text.split('\n')):
            if i:
                r.append(OxmlElement('w:br'))
            if part:
                t = OxmlElement('w:delText' if deleted else 'w:t')
                t.text = part
                t.set(qn('xml:space'), 'preserve')
                r.append(t)
        return r

    def _emit(self, p, kind, tokens):
        """Append tokens to paragraph p, merged into runs of equal formatting."""
        if not tokens:
            return
        words = sum(1 for t, _ in tokens if t.strip())
        if kind == 'ins':
            self.inserted += words
        elif kind == 'del':
            self.deleted += words
        holder = p._p
        if kind != 'same':   # changed runs sit inside a <w:ins> / <w:del> wrapper
            holder = self._mark('w:ins' if kind == 'ins' else 'w:del')
            p._p.append(holder)
        text, fmt = '', None
        for tok, f in tokens + [(None, None)]:
            if tok is not None and (fmt is None or f == fmt):
                text, fmt = text + tok, f
                continue
            if text:
                holder.append(self._run(text, fmt or frozenset(), deleted=kind == 'del'))
            text, fmt = (tok or ''), f

    def _paragraph(self, para, whole=None):
        """A new paragraph with para's style. whole='ins'/'del' marks the paragraph mark too,
        so accepting a deleted paragraph removes it entirely."""
        p = self.doc.add_paragraph(style=_style_or_normal(self.doc, para.style))
        if para.align:
            p.alignment = ALIGN[para.align]
        if whole:
            ppr = p._p.get_or_add_pPr()
            rpr = OxmlElement('w:rPr')
            rpr.append(self._mark('w:ins' if whole == 'ins' else 'w:del'))
            ppr.append(rpr)
        return p

    def whole(self, para, kind):
        self._emit(self._paragraph(para, kind), kind, _tokens(para))

    def compare(self, old, new):
        """One paragraph, old -> new, marked word by word."""
        p = self._paragraph(new)
        a, b = _tokens(old), _tokens(new)
        matcher = difflib.SequenceMatcher(None, [t for t, _ in a], [t for t, _ in b], autojunk=False)
        for op, i1, i2, j1, j2 in matcher.get_opcodes():
            if op == 'equal':
                self._emit(p, 'same', b[j1:j2])
            else:
                self._emit(p, 'del', a[i1:i2])
                self._emit(p, 'ins', b[j1:j2])

    def paragraphs(self, old, new):
        """Align two paragraph lists, then compare paired paragraphs."""
        matcher = difflib.SequenceMatcher(None, [_norm(_para_text(p)) for p in old],
                                          [_norm(_para_text(p)) for p in new], autojunk=False)
        for op, i1, i2, j1, j2 in matcher.get_opcodes():
            if op == 'equal':
                for p in new[j1:j2]:
                    self._emit(self._paragraph(p), 'same', _tokens(p))
                continue
            olds, news = old[i1:i2], new[j1:j2]
            for o, n in zip(olds, news):     # a rewritten paragraph: show the word changes
                self.compare(o, n)
            for o in olds[len(news):]:
                self.whole(o, 'del')
            for n in news[len(olds):]:
                self.whole(n, 'ins')


def _heading_para(block):
    heading = re.sub(r'\s+', ' ', (block or {}).get('heading') or '').strip()
    return Para(style='Heading 2', runs=[(heading, frozenset())]) if heading else None


def render_redline_docx(before, after, title='', author='PactPro', branding=None):
    doc = Document()
    _setup(doc)
    if branding:
        _branding(doc, branding)
    if title:
        doc.add_paragraph(title, style='Title').alignment = WD_ALIGN_PARAGRAPH.CENTER

    w = _Writer(doc, author)
    for old, new in _pair_blocks(before, after):
        old_h, new_h = _heading_para(old), _heading_para(new)
        if title and new_h and _norm(_para_text(new_h)).rstrip('.,;:') == _norm(title).rstrip('.,;:'):
            new_h = old_h = None   # the heading only repeats the title (same rule as the plain export)
        w.paragraphs([old_h] if old_h else [], [new_h] if new_h else [])
        w.paragraphs(_paras(old), _paras(new))

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue(), {'inserted': w.inserted, 'deleted': w.deleted}
