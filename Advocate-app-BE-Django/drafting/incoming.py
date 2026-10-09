"""Changes from outside (docs/DRAFT_REVIEW.md, "Changes from outside"): the client or the other side
sends back a Word file, by email or otherwise, and the advocate uploads it to the draft.

POST draft-sessions/<id>/import-changes/   multipart: file (.docx), from_name, note

The file is usually our own export (Download / redline) with their tracked changes, comments, or
plain edits. It is read as *their version* (insertions kept, deletions dropped), lined up against
the draft paragraph by paragraph, and becomes a suggestions round for the owner to accept or
decline like any colleague's. Their Word comments become comment threads on the matching clause.
The draft itself does not change until the owner finishes the round.
"""

import difflib
import io
import re
import zipfile

from django.db import transaction
from django.shortcuts import get_object_or_404
from lxml import etree
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from core.permissions import RequirePermission

from .access import own_sessions
from .export.compare import TABLE_ROW, _para_text, _paras
from .export.docx import Para, session_title
from .export.htmlwrite import paras_to_html
from .models import DraftComment, DraftReviewRound
from .versions import snapshot_blocks

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
_w = lambda tag: f'{{{W}}}{tag}'   # noqa: E731
MAX_BYTES = 15 * 1024 * 1024
# Word paragraph alignment -> the editor's text-align ('left' / 'start' = the default).
_JC = {'center': 'center', 'right': 'right', 'end': 'right', 'both': 'justify', 'distribute': 'justify'}


class ImportError_(Exception):
    pass


# --- reading the Word file --------------------------------------------------------

def _run_fmt(r):
    rpr = r.find(_w('rPr'))
    fmt = set()
    if rpr is not None:
        for tag, name in (('b', 'bold'), ('i', 'italic'), ('u', 'underline'), ('strike', 'strike')):
            el = rpr.find(_w(tag))
            if el is not None and el.get(_w('val')) not in ('0', 'false', 'none'):
                fmt.add(name)
    return frozenset(fmt)


class _Reader:
    """Their version of the document: paragraphs (tables flattened one row per line, the way the
    comparison engine sees them), tracked-change authors, and comments with the words they mark."""

    def __init__(self, data):
        try:
            zf = zipfile.ZipFile(io.BytesIO(data))
            self.root = etree.fromstring(zf.read('word/document.xml'))
        except (zipfile.BadZipFile, KeyError, etree.XMLSyntaxError):
            raise ImportError_('That is not a Word (.docx) file.')
        self.styles, self.numbering = self._read_styles(zf), self._read_numbering(zf)
        self.comment_text = {}
        if 'word/comments.xml' in zf.namelist():
            for c in etree.fromstring(zf.read('word/comments.xml')).iter(_w('comment')):
                text = '\n'.join(''.join(t.text or '' for t in p.iter(_w('t'))) for p in c.iter(_w('p'))).strip()
                self.comment_text[c.get(_w('id'))] = (c.get(_w('author')) or '', text)
        self.paras, self.authors, self.tracked = [], set(), False
        self._pending = []          # comments started, waiting for a paragraph with text
        self.comments = []          # {id, para (index into self.paras), quote}
        self._open = {}             # comment id -> its entry while its range is open
        body = self.root.find(_w('body'))
        for el in body:
            if el.tag == _w('p'):
                self._add(self._para(el))
            elif el.tag == _w('tbl'):
                for tr in el.iter(_w('tr')):
                    runs = []
                    for i, tc in enumerate(tr.findall(_w('tc'))):
                        if i:
                            runs.append(('\t', frozenset()))
                        for j, p in enumerate(tc.iter(_w('p'))):
                            if j:
                                runs.append((' ', frozenset()))
                            runs += [r for r in self._para(p).runs if r[0] != '\n']
                    self._add(Para(style=TABLE_ROW, runs=runs))

    def _add(self, para):
        if ''.join(t for t, _ in para.runs).strip():
            self.paras.append(para)
            # A comment marks the paragraph it starts in (or the next one with text).
            for entry in self._pending:
                entry['para'] = len(self.paras) - 1
            self._pending = []

    @staticmethod
    def _read_styles(zf):
        """styleId -> {name, jc, based, num}: what a paragraph style says about alignment / lists."""
        out = {}
        if 'word/styles.xml' not in zf.namelist():
            return out
        for st in etree.fromstring(zf.read('word/styles.xml')).iter(_w('style')):
            ppr = st.find(_w('pPr'))
            name, based = st.find(_w('name')), st.find(_w('basedOn'))
            jc = ppr.find(_w('jc')) if ppr is not None else None
            num = ppr.find(_w('numPr')) if ppr is not None else None
            out[st.get(_w('styleId'))] = {
                'name': (name.get(_w('val')) if name is not None else '') or '',
                'jc': jc.get(_w('val')) if jc is not None else None,
                'based': based.get(_w('val')) if based is not None else None,
                'num': num}
        return out

    @staticmethod
    def _read_numbering(zf):
        """numId -> {level: 'bullet' | 'number'}."""
        if 'word/numbering.xml' not in zf.namelist():
            return {}
        root = etree.fromstring(zf.read('word/numbering.xml'))
        abstract = {}
        for an in root.iter(_w('abstractNum')):
            levels = {}
            for lvl in an.iter(_w('lvl')):
                fmt = lvl.find(_w('numFmt'))
                levels[int(lvl.get(_w('ilvl')) or 0)] = \
                    'bullet' if fmt is not None and fmt.get(_w('val')) == 'bullet' else 'number'
            abstract[an.get(_w('abstractNumId'))] = levels
        out = {}
        for num in root.iter(_w('num')):
            ref = num.find(_w('abstractNumId'))
            if ref is not None:
                out[num.get(_w('numId'))] = abstract.get(ref.get(_w('val')), {})
        return out

    def _style_chain(self, style_id):
        seen = set()
        while style_id and style_id not in seen and style_id in self.styles:
            seen.add(style_id)
            yield self.styles[style_id]
            style_id = self.styles[style_id]['based']

    def _para(self, p):
        """One paragraph of their version, with what the editor can show of its formatting:
        alignment, heading level, bullet / numbered list and its level."""
        runs = []
        ppr = p.find(_w('pPr'))
        sid = ppr.find(_w('pStyle')).get(_w('val')) if ppr is not None and ppr.find(_w('pStyle')) is not None else None
        chain = list(self._style_chain(sid))
        jc = ppr.find(_w('jc')) if ppr is not None else None
        jc = jc.get(_w('val')) if jc is not None else next((s['jc'] for s in chain if s['jc']), None)
        style = 'Normal'
        heading = next((re.match(r'heading\s*(\d)', s['name'], re.I) for s in chain
                        if re.match(r'heading\s*\d', s['name'], re.I)), None)
        num = ppr.find(_w('numPr')) if ppr is not None else None
        if num is None:
            num = next((s['num'] for s in chain if s['num'] is not None), None)
        if heading:
            style = f'Heading {min(int(heading.group(1)), 3)}'
        elif num is not None:
            nid, ilvl = num.find(_w('numId')), num.find(_w('ilvl'))
            nid = nid.get(_w('val')) if nid is not None else None
            level = int(ilvl.get(_w('val'))) if ilvl is not None else 0
            if nid and nid != '0':
                kind = self.numbering.get(nid, {}).get(level, 'number')
                style = ('List Bullet' if kind == 'bullet' else 'List Number') + (f' {level + 1}' if level else '')
        para = Para(style=style, align=_JC.get(jc))
        self._walk(p, runs, deleted=False)
        para.runs = runs
        return para

    def _walk(self, node, runs, deleted):
        for el in node:
            tag = el.tag
            if tag in (_w('del'), _w('moveFrom')):
                self.tracked = True
                if el.get(_w('author')):
                    self.authors.add(el.get(_w('author')))
                continue                                # their deletions are not in their version
            if tag in (_w('ins'), _w('moveTo')):
                self.tracked = True
                if el.get(_w('author')):
                    self.authors.add(el.get(_w('author')))
                self._walk(el, runs, deleted)
            elif tag == _w('commentRangeStart'):
                cid = el.get(_w('id'))
                entry = {'id': cid, 'para': None, 'quote': ''}
                self.comments.append(entry)
                self._open[cid] = entry
                self._pending.append(entry)
            elif tag == _w('commentRangeEnd'):
                self._open.pop(el.get(_w('id')), None)
            elif tag == _w('r'):
                fmt = _run_fmt(el)
                for part in el:
                    if part.tag == _w('t'):
                        text = part.text or ''
                    elif part.tag == _w('tab'):
                        text = '\t'
                    elif part.tag in (_w('br'), _w('cr')):
                        runs.append(('\n', None))
                        continue
                    else:
                        continue
                    runs.append((text, fmt))
                    for entry in self._open.values():
                        entry['quote'] += text
            elif tag in (_w('hyperlink'), _w('smartTag'), _w('sdt'), _w('sdtContent'), _w('fldSimple')):
                self._walk(el, runs, deleted)


# --- lining it up with the draft -----------------------------------------------------

_PH = re.compile(r'\[\[([^\[\]]+)\]\]')


def _norm(text):
    """For matching only: placeholders as the export prints them ([Label]), spacing and quotes evened out."""
    text = _PH.sub(r'[\1]', text or '')
    text = text.replace('’', "'").replace('‘', "'").replace('“', '"').replace('”', '"')
    return re.sub(r'\s+', ' ', text).strip().lower()


def _ours(session, blocks):
    """The draft's paragraphs in export order: [(block index or None for the title, kind, Para)]."""
    title = session_title(session)
    tnorm = re.sub(r'\s+', ' ', title or '').strip().rstrip('.,;:').lower()
    out = [(None, 'title', Para(runs=[(title, frozenset())]))] if title else []
    for i, b in enumerate(blocks):
        heading = re.sub(r'\s+', ' ', b['heading'] or '').strip()
        if heading and heading.rstrip('.,;:').lower() != tnorm:
            out.append((i, 'heading', Para(runs=[(heading, frozenset())])))
        for p in _paras(b):
            if _para_text(p).strip():
                out.append((i, 'body', p))
    return out


def _with_placeholders(para, labels):
    """Their text prints an empty placeholder as [Label]; give it back the draft's [[Label]] form so
    a blank they left alone doesn't read as a change."""
    def fix(text):
        return re.sub(r'\[([^\[\]]+)\]', lambda m: f'[[{m.group(1)}]]' if m.group(1) in labels else m.group(0), text)
    return Para(style=para.style, align=para.align,
                runs=[(fix(t) if t != '\n' else t, f) for t, f in para.runs])


def their_blocks(session, reader):
    """The draft's blocks as they would read with the uploaded file's wording, plus, for each of
    their paragraphs, which block it landed in (for comments)."""
    base = snapshot_blocks(session)
    ours = _ours(session, base)
    theirs = reader.paras
    labels = {m for b in base for m in _PH.findall(' '.join(_para_text(p) for p in _paras(b)))}
    matcher = difflib.SequenceMatcher(None, [_norm(_para_text(p)) for _, _, p in ours],
                                      [_norm(_para_text(p)) for p in theirs], autojunk=False)
    heads = {i: None for i in range(len(base))}       # block -> new heading (None = unchanged)
    bodies = {i: [] for i in range(len(base))}        # block -> [Para]
    changed = set()
    landed = [0] * len(theirs)                        # their paragraph -> block index

    def block_at(k):
        """The block our paragraph k belongs to (the title counts as the first block)."""
        while k >= 0 and ours[k][0] is None:
            k -= 1
        return ours[k][0] if k >= 0 else 0

    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == 'equal':
            for k, j in zip(range(i1, i2), range(j1, j2)):
                blk, kind, para = ours[k]
                if kind == 'body':
                    bodies[blk].append(para)
                landed[j] = block_at(k)
            continue
        if op == 'delete':
            changed |= {block_at(k) for k in range(i1, i2)}
            continue
        for j in range(j1, j2):
            if op == 'insert':
                k = i1 - 1
                blk = block_at(k) if k >= 0 else 0
                if k >= 0 and ours[k][1] == 'title' and base:
                    blk = 0
            else:   # replace: pair their paragraphs with ours in order; extras go with the last one
                k = i1 + min(j - j1, i2 - i1 - 1)
                blk = block_at(k)
                if ours[k][1] == 'title':
                    landed[j] = blk
                    continue                            # the title isn't part of any clause
                if ours[k][1] == 'heading' and heads[blk] is None and j - j1 == k - i1:
                    heads[blk] = _para_text(theirs[j]).strip()
                    changed.add(blk)
                    landed[j] = blk
                    continue
            bodies[blk].append(_with_placeholders(theirs[j], labels))
            changed.add(blk)
            landed[j] = blk
        if op == 'replace':
            changed |= {block_at(k) for k in range(i1, i2) if ours[k][1] != 'title'}

    target = []
    for i, b in enumerate(base):
        t = dict(b)
        if i in changed:
            t['heading'] = heads[i] if heads[i] is not None else b['heading']
            t['content_html'] = paras_to_html(bodies[i])
            t['text'] = '\n'.join(_para_text(p) for p in bodies[i])
        target.append(t)
    return base, target, landed


# --- the endpoint -----------------------------------------------------------------

def import_changes(session, user, data, from_name, note='', filename=''):
    from .review import comparison
    reader = _Reader(data)
    if not session.blocks.exists():
        raise ImportError_('The draft is empty.')
    base, target, landed = their_blocks(session, reader)
    from_name = (from_name or ', '.join(sorted(reader.authors)) or 'the other side').strip()[:120]
    with transaction.atomic():
        rnd = DraftReviewRound.objects.create(
            session=session, kind=DraftReviewRound.Kind.SUGGESTIONS, author_id=user.id,
            decider_id=session.created_by_id, note=note, external_from=from_name,
            base_blocks=base, target_blocks=target)
        changes = comparison(rnd).changes
        if not changes:
            rnd.delete()
            rnd = None
        threads = 0
        for c in reader.comments:
            author, text = reader.comment_text.get(c['id'], ('', ''))
            if not text:
                continue
            blk = base[landed[c['para']]] if c['para'] is not None and base else None
            DraftComment.objects.create(
                session=session, block_id=blk['block_id'] if blk else None, quote=c['quote'].strip()[:500],
                body=f'{author or from_name} (in {filename or "the uploaded file"}): {text}', author_id=user.id)
            threads += 1
        if rnd is None and not threads:
            raise ImportError_('No changes or comments found: the file reads the same as the draft.')
    return {'round': rnd.id if rnd else None, 'changes': changes, 'comments': threads,
            'tracked': reader.tracked, 'authors': sorted(reader.authors), 'from_name': from_name}


class ImportChangesView(APIView):
    permission_classes = [RequirePermission('DRAFT_CREATE')]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request, pk):
        session = get_object_or_404(own_sessions(request.user), pk=pk)
        f = request.FILES.get('file')
        if f is None:
            return Response({'error': 'Choose the Word file you received.'}, status=400)
        if not f.name.lower().endswith('.docx'):
            return Response({'error': 'Only Word .docx files can be read. Ask for a .docx, or save the file as .docx.'},
                            status=400)
        if f.size > MAX_BYTES:
            return Response({'error': 'The file is too large (15 MB at most).'}, status=400)
        try:
            result = import_changes(session, request.user, f.read(), request.data.get('from_name'),
                                    (request.data.get('note') or '').strip(), f.name)
        except ImportError_ as e:
            return Response({'error': str(e)}, status=400)
        return Response(result, status=201)
