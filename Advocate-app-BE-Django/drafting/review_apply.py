"""Apply review decisions onto the draft AS IT IS NOW, paragraph by paragraph (drafting/review.py).

A round compares two frozen snapshots (base -> target). By the time someone decides, the draft
may have moved on: often in the same clause, because a whole deed can sit in one clause. So each
change is matched to the current text by its own paragraph, not by its clause:

- suggestions (not in the draft yet): the change is anchored on its paragraph in BASE. It still
  applies if that paragraph is unchanged in the current draft; accepting writes the change there.
- changes (already in the draft): anchored on the paragraph in TARGET. Rejecting puts the old
  paragraph back if the current one is still the target's.

A change whose anchor can't be found in the current text is *outdated*: never applied blindly.
Adding a paragraph is anchored on the paragraph before it (or the start of the clause).
"""

import difflib
import re

from .export.compare import CHANGED, DEL, INS, SAME, _paras

SUGGESTIONS = 'suggestions'


def _norm(para):
    return re.sub(r'\s+', ' ', ''.join(t for t, _ in para.runs)).strip()


def _ref(pd, kind):
    """The paragraph a change is anchored on: in base for suggestions, in target for changes."""
    return pd.old if kind == SUGGESTIONS else pd.new


def _map(ref_paras, cur_paras):
    """ref index -> current index, for paragraphs whose text is unchanged."""
    m = {}
    matcher = difflib.SequenceMatcher(None, [_norm(p) for p in ref_paras], [_norm(p) for p in cur_paras],
                                      autojunk=False)
    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == 'equal':
            for k in range(i2 - i1):
                m[i1 + k] = j1 + k
    return m


def plan_clause(kind, clause, current_block):
    """For one clause of a round: ({change_id: anchor or None}, current paragraphs).

    anchor = ('at', j): the change sits on current paragraph j; ('after', j): it adds a paragraph
    after current paragraph j (-1 = the start). None = outdated."""
    body = [pd for pd in clause.body]
    ref_paras = [_ref(pd, kind) for pd in body if _ref(pd, kind) is not None]
    cur_paras = _paras(current_block) if current_block is not None else []
    m = _map(ref_paras, cur_paras) if current_block is not None else {}
    anchors = {}
    r = 0                          # index of the next ref paragraph
    for pd in body:
        ref = _ref(pd, kind)
        if pd.change_id:
            if current_block is None:
                anchors[pd.change_id] = None
            elif ref is not None:
                j = m.get(r)
                anchors[pd.change_id] = ('at', j) if j is not None else None
            else:
                prev = m.get(r - 1) if r > 0 else -1
                anchors[pd.change_id] = ('after', prev) if prev is not None else None
        if ref is not None:
            r += 1
    for pd in clause.heading:      # a heading change applies while the heading is the reference one
        if pd.change_id:
            want = clause.old if kind == SUGGESTIONS else clause.new
            ok = current_block is not None and want is not None and \
                (current_block['heading'] or '').strip() == (want['heading'] or '').strip()
            anchors[pd.change_id] = ('heading', 0) if ok else None
    return anchors, cur_paras


def apply_clause(kind, clause, current_block, acts):
    """The clause's new {heading, paragraphs} after acting on the changes in `acts` (change ids to
    act on: accepted suggestions / rejected changes). None when nothing changes."""
    anchors, cur = plan_clause(kind, clause, current_block)
    replace, delete, inserts = {}, set(), {}
    heading = None
    for pd in clause.heading:
        if pd.change_id in acts and anchors.get(pd.change_id):
            src = pd.new if kind == SUGGESTIONS else pd.old
            heading = ''.join(t for t, _ in src.runs) if src is not None else ''
    for pd in clause.body:
        cid = pd.change_id
        if not cid or cid not in acts or not anchors.get(cid):
            continue
        where, j = anchors[cid]
        if kind == SUGGESTIONS:        # write the suggested text in
            if pd.kind == CHANGED:
                replace[j] = pd.new
            elif pd.kind == DEL:
                delete.add(j)
            elif pd.kind == INS:
                inserts.setdefault(j, []).append(pd.new)
        else:                          # rejected change: put the old text back
            if pd.kind == CHANGED:
                replace[j] = pd.old
            elif pd.kind == INS:
                delete.add(j)
            elif pd.kind == DEL:
                inserts.setdefault(j, []).append(pd.old)
    if not (replace or delete or inserts) and heading is None:
        return None
    out = list(inserts.get(-1, []))
    for j, para in enumerate(cur):
        if j not in delete:
            out.append(replace.get(j, para))
        out += inserts.get(j, [])
    return {'heading': heading, 'paras': out}


__all__ = ['plan_clause', 'apply_clause', 'SAME', 'INS', 'DEL', 'CHANGED']
