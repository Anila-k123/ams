"""Comparison engine: what changed between two versions of a draft.

compare_blocks(before, after, title='') -> Comparison

`before` / `after` are block snapshots (drafting/versions.py::snapshot_blocks). The result
is plain data. Two writers read it, so the screen and the downloads always show the same
changes:
- export/redline.py: Word tracked changes (and, converted, the PDF redline);
- Comparison.as_json(): the on-screen compare view in the editor.

How the two sides are compared:
- Clauses are paired by block id, falling back to the heading when the ids differ
  (a re-draft creates new blocks). Unpaired clauses are wholly inserted or deleted.
- Inside a clause, paragraphs are aligned, then paired paragraphs are compared word
  by word. Only words count: a change of bold or alignment alone is not marked,
  as in legal comparison tools. Tables are compared row by row as text.
"""

import difflib
import html as htmllib
import re
from dataclasses import dataclass, field

from .docx import Para, _text_to_blocks, html_to_blocks

TOKEN_RE = re.compile(r'\s+|\w+|[^\w\s]')
SAME, INS, DEL, CHANGED = 'same', 'ins', 'del', 'changed'


def _norm(text):
    return re.sub(r'\s+', ' ', text or '').strip().lower()


@dataclass
class Seg:
    op: str                 # same / ins / del
    text: str
    fmt: frozenset          # bold / italic / underline / strike


@dataclass
class ParaDiff:
    kind: str               # same; changed (word changes inside); ins / del (whole paragraph)
    style: str
    align: str | None
    segs: list
    change_id: int | None = None   # 1, 2, 3… in document order, for next / previous
    # The paragraphs themselves (docx.Para), for applying review decisions
    # (drafting/review.py): `old` is None for an added paragraph, `new` for a removed one.
    old: object = None
    new: object = None


@dataclass
class ClauseDiff:
    old: dict | None
    new: dict | None
    heading: list = field(default_factory=list)   # [ParaDiff], 0 or 1
    body: list = field(default_factory=list)      # [ParaDiff]

    @property
    def status(self):
        if self.old is None:
            return 'added'
        if self.new is None:
            return 'removed'
        return CHANGED if any(p.kind != SAME for p in self.heading + self.body) else SAME


@dataclass
class Comparison:
    clauses: list
    inserted: int = 0       # words
    deleted: int = 0
    changes: int = 0        # changed paragraphs (what next / previous steps through)

    def as_json(self):
        def para(p):
            return {'kind': p.kind, 'style': p.style, 'align': p.align, 'change_id': p.change_id,
                    'segs': [{'op': s.op, 'text': s.text, 'fmt': sorted(s.fmt)} for s in p.segs]}

        def label(c):
            block = c.new or c.old
            return re.sub(r'\s+', ' ', block.get('heading') or '').strip()

        return {
            'inserted': self.inserted, 'deleted': self.deleted, 'changes': self.changes,
            'clauses': [{
                'block_id': (c.new or c.old)['block_id'], 'status': c.status, 'label': label(c),
                'heading': [para(p) for p in c.heading], 'body': [para(p) for p in c.body],
            } for c in self.clauses],
        }


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

# An editor placeholder field: <span data-placeholder="Label" data-value="…">…</span>.
_PH_RE = re.compile(r'<span\b[^>]*\bdata-placeholder="([^"]*)"[^>]*>.*?</span>', re.S)
_VALUE_RE = re.compile(r'\bdata-value="([^"]*)"')


def _placeholders_as_text(html):
    """Write every placeholder the way a never-edited draft stores it, so that comparing the AI draft
    (plain text with [[Label]]) with an edited one (editor fields) only shows real edits: an empty
    field becomes [[Label]], a filled one its value."""
    def unescape(text):
        # Older saves escaped "&" twice in placeholder names ("&amp;amp;"): undo until stable.
        while True:
            plain = htmllib.unescape(text)
            if plain == text:
                return plain
            text = plain

    def one(m):
        value = _VALUE_RE.search(m.group(0))
        value = unescape(value.group(1)) if value else ''
        label = unescape(m.group(1))
        return htmllib.escape(value if value.strip() else f'[[{label}]]', quote=False)
    return _PH_RE.sub(one, html)


TABLE_ROW = 'Table Row'


def _paras(block):
    """The clause body as a flat list of Para. A table row becomes one Para (cells separated by tabs)
    styled TABLE_ROW, so it compares as one line and htmlwrite can put the table back together."""
    if block is None:
        return []
    body = html_to_blocks(_placeholders_as_text(block['content_html'])) \
        if (block['content_html'] or '').strip() else _text_to_blocks(block['text'])
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
            out.append(Para(style=TABLE_ROW, runs=runs))
    return out


def _heading_para(block):
    heading = re.sub(r'\s+', ' ', (block or {}).get('heading') or '').strip()
    return Para(style='Heading 2', runs=[(heading, frozenset())]) if heading else None


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


# --- diffing -----------------------------------------------------------------

class _Differ:
    def __init__(self):
        self.inserted = self.deleted = 0

    def _segs(self, op, tokens):
        """Tokens -> segments, merged while the formatting stays the same; counts words."""
        words = sum(1 for t, _ in tokens if t.strip())
        if op == INS:
            self.inserted += words
        elif op == DEL:
            self.deleted += words
        segs = []
        for tok, fmt in tokens:
            if segs and segs[-1].fmt == fmt:
                segs[-1].text += tok
            else:
                segs.append(Seg(op, tok, fmt))
        return segs

    def whole(self, para, kind):
        return ParaDiff(kind, para.style, para.align, self._segs(kind, _tokens(para)),
                        old=None if kind == INS else para, new=None if kind == DEL else para)

    def compare(self, old, new):
        """One paragraph, old -> new, word by word."""
        a, b = _tokens(old), _tokens(new)
        segs = []
        matcher = difflib.SequenceMatcher(None, [t for t, _ in a], [t for t, _ in b], autojunk=False)
        for op, i1, i2, j1, j2 in matcher.get_opcodes():
            if op == 'equal':
                segs += self._segs(SAME, b[j1:j2])
            else:
                segs += self._segs(DEL, a[i1:i2]) + self._segs(INS, b[j1:j2])
        kind = SAME if all(s.op == SAME for s in segs) else CHANGED
        return ParaDiff(kind, new.style, new.align, segs, old=old, new=new)

    def paragraphs(self, old, new):
        """Align two paragraph lists, then compare paired paragraphs."""
        out = []
        matcher = difflib.SequenceMatcher(None, [_norm(_para_text(p)) for p in old],
                                          [_norm(_para_text(p)) for p in new], autojunk=False)
        for op, i1, i2, j1, j2 in matcher.get_opcodes():
            if op == 'equal':
                for o, n in zip(old[i1:i2], new[j1:j2]):
                    pd = self.whole(n, SAME)
                    pd.old = o   # unchanged text, but keep the old paragraph (its formatting) too
                    out.append(pd)
                continue
            olds, news = old[i1:i2], new[j1:j2]
            out += [self.compare(o, n) for o, n in zip(olds, news)]   # rewritten: word changes
            out += [self.whole(o, DEL) for o in olds[len(news):]]
            out += [self.whole(n, INS) for n in news[len(olds):]]
        return out


def _drop_title(paras, title_norm):
    """A clause's first line that only repeats the document title: the editor shows the title above
    the document and keeps it out of the text, while the AI draft has it as its first line."""
    if title_norm and paras and _norm(_para_text(paras[0])).rstrip('.,;:') == title_norm:
        return paras[1:]
    return paras


def _head_norm(text):
    """A heading for matching: numbering ("8.", "ARTICLE II") and punctuation dropped."""
    text = re.sub(r'^\s*(?:(?:article|section|clause)\s+)?(?:\d+[.\d]*|[ivxlc]+)?[.)]?\s*', '', text or '', flags=re.I)
    return re.sub(r'[^a-z0-9]+', ' ', text.lower()).strip()


def _body(block, title_norm):
    """The clause's paragraphs as the editor shows them: without a first line that only repeats the
    document title or the clause's own heading. The AI draft keeps those lines in its text; the editor
    shows them above the text and drops them on save, so comparing would report them as removed."""
    paras = _drop_title(_paras(block), title_norm)
    heading = _head_norm((block or {}).get('heading'))
    if heading and paras and _head_norm(_para_text(paras[0])) == heading:
        paras = paras[1:]
    return paras


def compare_blocks(before, after, title=''):
    d = _Differ()
    clauses = []
    title_norm = _norm(title).rstrip('.,;:')
    for old, new in _pair_blocks(before, after):
        old_h, new_h = _heading_para(old), _heading_para(new)
        if title and new_h and _norm(_para_text(new_h)).rstrip('.,;:') == title_norm:
            new_h = old_h = None   # the heading only repeats the title (same rule as the plain export)
        clauses.append(ClauseDiff(old, new,
                                  d.paragraphs([old_h] if old_h else [], [new_h] if new_h else []),
                                  d.paragraphs(_body(old, title_norm), _body(new, title_norm))))
    n = 0
    for c in clauses:
        for p in c.heading + c.body:
            if p.kind != SAME:
                n += 1
                p.change_id = n
    return Comparison(clauses, d.inserted, d.deleted, n)
