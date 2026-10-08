"""Review rounds: suggestions and changes waiting for decisions (docs/DRAFT_REVIEW.md).

A round freezes two snapshots of the draft (base -> target). The comparison engine
(export/compare.py) numbers each changed paragraph 1..n; a decision is recorded per
number. Finishing a round applies the decisions to the draft:

- `suggestions` (not yet in the draft): accepted -> the new text goes in; declined -> kept as is.
- `changes` (already in the draft): accepted -> kept; rejected -> the old text is put back.
- `binding` changes (a senior's corrections): only acknowledged or queried, never undone.

Decisions are applied onto the draft as it is NOW, paragraph by paragraph (review_apply.py): a
change is "outdated" only when the paragraph it touches changed since, never applied blindly.
"""

from django.db import transaction
from django.utils import timezone

from .export.compare import compare_blocks
from .export.htmlwrite import paras_to_html, paras_to_text
from .models import DraftChangeDecision, DraftReviewRound, DraftVersion
from .review_apply import apply_clause, plan_clause
from .versions import save_version, snapshot_blocks

D = DraftChangeDecision.Decision


class ReviewError(Exception):
    """A request the round can't take (shown to the user as a 400)."""


# --- which decisions a round allows -------------------------------------------

def allowed_decisions(rnd):
    if rnd.binding:
        return {D.ACKNOWLEDGED, D.QUERIED}
    if rnd.kind == DraftReviewRound.Kind.SUGGESTIONS:
        return {D.ACCEPTED, D.DECLINED}
    return {D.ACCEPTED, D.REJECTED}


NEEDS_REASON = {D.DECLINED, D.QUERIED}


def _keeps_new(rnd, decision):
    """Does this decision leave the change's new text in the draft?"""
    if rnd.kind == DraftReviewRound.Kind.SUGGESTIONS:
        return decision == D.ACCEPTED
    return decision != D.REJECTED   # changes: everything but a rejection keeps them


# --- making rounds ----------------------------------------------------------------

def _block_state(b):
    return (b.get('heading') or '', b.get('content_html') or '', b.get('text') or '')


def create_suggestions(session, author, edited_blocks, note='', review_request=None):
    """A reviewer's edits, as suggestions for the owner. `edited_blocks` = [{id, heading,
    content_html, text}] from the editor; the draft itself is not changed."""
    base = snapshot_blocks(session)
    by_id = {e.get('id'): e for e in edited_blocks}
    target = []
    for b in base:
        e = by_id.get(b['block_id'])
        t = dict(b)
        if e:
            t.update(heading=e.get('heading', b['heading']) or '',
                     content_html=e.get('content_html', b['content_html']) or '',
                     text=e.get('text', b['text']) or '')
        target.append(t)
    if all(_block_state(a) == _block_state(b) for a, b in zip(base, target)):
        raise ReviewError('Nothing to suggest: no changes from the current draft.')
    rnd = DraftReviewRound.objects.create(
        session=session, kind=DraftReviewRound.Kind.SUGGESTIONS, author_id=author.id,
        decider_id=session.created_by_id, review_request=review_request, note=note,
        base_blocks=base, target_blocks=target)
    if not comparison(rnd).changes:
        rnd.delete()
        raise ReviewError('Nothing to suggest: only formatting changed.')
    return rnd


def create_changes_round(session, base_blocks, author_id, decider_id, binding=False, note='', review_request=None):
    """Changes already in the draft (base_blocks -> the draft now), for decider_id to keep
    or reject (or, when binding, acknowledge / query). None when nothing changed."""
    rnd = DraftReviewRound(session=session, kind=DraftReviewRound.Kind.CHANGES, binding=binding,
                           author_id=author_id, decider_id=decider_id, review_request=review_request,
                           note=note, base_blocks=base_blocks, target_blocks=snapshot_blocks(session))
    if not comparison(rnd).changes:
        return None
    rnd.save()
    return rnd


# --- reading rounds ---------------------------------------------------------------

def comparison(rnd):
    # No document title here: a round shows (and may change) every heading, the title's too.
    return compare_blocks(rnd.base_blocks, rnd.target_blocks)


def _current_blocks(session):
    return {b['block_id']: b for b in snapshot_blocks(session)}


def _clause_block_id(clause):
    return (clause.new or clause.old)['block_id']


def outdated_changes(rnd, comp=None, session=None):
    """Change ids that no longer apply: the paragraph they touch has changed in the draft since
    the round was made (review_apply.plan_clause). Edits elsewhere, even in the same clause, don't count."""
    if rnd.status != DraftReviewRound.Status.OPEN:
        return set()
    comp = comp or comparison(rnd)
    current = _current_blocks(session or rnd.session)
    out = set()
    for clause in comp.clauses:
        anchors, _ = plan_clause(rnd.kind, clause, current.get(_clause_block_id(clause)))
        out |= {cid for cid, anchor in anchors.items() if anchor is None}
    return out


def advocate_names(ids):
    from core.models import Advocate
    return dict(Advocate.objects.filter(id__in=[i for i in ids if i]).values_list('id', 'full_name'))


def round_json(rnd, user):
    comp = comparison(rnd)
    data = comp.as_json()
    decisions = {d.change_id: d for d in rnd.decisions.all()}
    outdated = outdated_changes(rnd, comp)
    for clause in data['clauses']:
        for p in clause['heading'] + clause['body']:
            if p['change_id']:
                d = decisions.get(p['change_id'])
                p['decision'] = {'decision': d.decision, 'reason': d.reason, 'by': d.decided_by_id,
                                 'at': d.decided_at} if d else None
                p['outdated'] = p['change_id'] in outdated
    open_ = rnd.status == DraftReviewRound.Status.OPEN
    names = advocate_names({rnd.author_id, rnd.decider_id})
    data.update({
        'id': rnd.id, 'kind': rnd.kind, 'binding': rnd.binding, 'status': rnd.status, 'note': rnd.note,
        'author_id': rnd.author_id, 'decider_id': rnd.decider_id,
        'author_name': names.get(rnd.author_id), 'decider_name': names.get(rnd.decider_id),
        'created_at': rnd.created_at, 'finished_at': rnd.finished_at,
        'allowed': sorted(allowed_decisions(rnd)), 'needs_reason': sorted(NEEDS_REASON),
        'decided': len(decisions), 'pending': max(comp.changes - len(decisions), 0),
        'can_decide': open_ and user.id == rnd.decider_id,
        'can_cancel': open_ and user.id == rnd.author_id and rnd.kind == DraftReviewRound.Kind.SUGGESTIONS,
    })
    return data


# --- deciding ---------------------------------------------------------------------

def decide(rnd, user, change, decision, reason=''):
    """Record a decision on one change (change = its number) or on every change ('all')."""
    if rnd.status != DraftReviewRound.Status.OPEN:
        raise ReviewError('This review round is closed.')
    if user.id != rnd.decider_id:
        raise ReviewError('Only the person this round is waiting for can decide on it.')
    if decision not in allowed_decisions(rnd):
        raise ReviewError(f'"{decision}" is not a choice for this round.')
    reason = (reason or '').strip()
    if decision in NEEDS_REASON and not reason:
        raise ReviewError('Please give a reason.' if decision == D.DECLINED else 'Please write your query.')
    total = comparison(rnd).changes
    if change == 'all':
        # "All" fills in the changes not decided yet; it never overwrites a decision already made
        # (e.g. one query, then "OK all" for the rest).
        decided = set(rnd.decisions.values_list('change_id', flat=True))
        ids = [i for i in range(1, total + 1) if i not in decided]
    else:
        ids = [int(change)]
    if any(i < 1 or i > total for i in ids):
        raise ReviewError('No such change in this round.')
    for i in ids:
        DraftChangeDecision.objects.update_or_create(
            round=rnd, change_id=i,
            defaults={'decision': decision, 'reason': reason, 'decided_by_id': user.id})
    if decision == D.QUERIED:
        _query_as_comments(rnd, user, set(ids), reason)


def _query_as_comments(rnd, user, ids, reason):
    """A query on a binding correction is a question to the senior: it opens a comment thread on the
    corrected words (drafting/comments.py), which the senior must resolve before approving."""
    from .comments import _notify
    from .models import DraftComment
    for clause in comparison(rnd).clauses:
        for p in clause.heading + clause.body:
            if p.change_id not in ids:
                continue
            quote = ''.join(s.text for s in p.segs if s.op != 'del').strip() \
                or ''.join(s.text for s in p.segs).strip()
            block_id = (clause.new or clause.old)['block_id']
            if not rnd.session.blocks.filter(id=block_id).exists():
                block_id = None
            comment, created = DraftComment.objects.get_or_create(
                session=rnd.session, parent=None, author_id=user.id, block_id=block_id,
                quote=quote[:2000], body=reason)
            if created:
                _notify(comment, user, 'queried a correction')


# --- finishing --------------------------------------------------------------------

def finish(rnd, user):
    """Apply the decisions to the draft as it is now, save a version and close the round.
    Returns {'applied': n, 'outdated': [change ids left alone]}."""
    if rnd.status != DraftReviewRound.Status.OPEN:
        raise ReviewError('This review round is closed.')
    if user.id != rnd.decider_id:
        raise ReviewError('Only the person this round is waiting for can finish it.')
    comp = comparison(rnd)
    decisions = {d.change_id: d.decision for d in rnd.decisions.all()}
    outdated = outdated_changes(rnd, comp)
    missing = [cid for cid in range(1, comp.changes + 1) if cid not in decisions and cid not in outdated]
    if missing and not rnd.binding:
        raise ReviewError(f'{len(missing)} change(s) still need a decision.')

    # The changes to act on: accepted suggestions go in; rejected changes come out.
    acts = set() if rnd.binding else {cid for cid, d in decisions.items()
                                      if cid not in outdated and _keeps_new(rnd, d) == (rnd.kind == DraftReviewRound.Kind.SUGGESTIONS)}
    session = rnd.session
    applied = 0
    with transaction.atomic():
        current_rows = {b.id: b for b in session.blocks.select_for_update()}
        current = _current_blocks(session)
        for clause in comp.clauses:
            ids = {p.change_id for p in clause.heading + clause.body if p.change_id}
            if not ids & acts:
                continue
            block_id = _clause_block_id(clause)
            row = current_rows.get(block_id)
            if row is None:
                continue
            # Every change acted on and the clause untouched since the round: take the other side's
            # HTML exactly (keeps tables and formatting) instead of rebuilding it from paragraphs.
            ref, other = (clause.old, clause.new) if rnd.kind == DraftReviewRound.Kind.SUGGESTIONS \
                else (clause.new, clause.old)
            if ids <= acts and ref is not None and other is not None \
                    and _block_state(current.get(block_id) or {}) == _block_state(ref):
                row.heading, row.content_html, row.text = other['heading'], other['content_html'], other['text']
                row.is_edited = True
                row.save(update_fields=['heading', 'content_html', 'text', 'is_edited'])
                applied += len(ids)
                continue
            result = apply_clause(rnd.kind, clause, current.get(block_id), acts)
            if result is None:
                continue
            if result['heading'] is not None:
                row.heading = result['heading']
            row.content_html = paras_to_html(result['paras'])
            row.text = paras_to_text(result['paras'])
            row.is_edited = True
            row.save(update_fields=['heading', 'content_html', 'text', 'is_edited'])
            applied += len(ids & acts)

        rnd.status = DraftReviewRound.Status.FINISHED
        rnd.finished_at = timezone.now()
        rnd.save(update_fields=['status', 'finished_at'])
        counts = {}
        for d in decisions.values():
            counts[d] = counts.get(d, 0) + 1
        label = 'Review: ' + ', '.join(f'{n} {D(k).label.split(" ")[0].lower()}' for k, n in sorted(counts.items()))
        if counts:
            save_version(session, DraftVersion.Kind.REVIEW, label, user.id)
    _tell_author(rnd, user, counts)
    return {'applied': applied, 'outdated': sorted(outdated)}


def _tell_author(rnd, user, counts):
    """The person who made the suggestions / corrections hears what was decided."""
    if rnd.author_id == user.id or not counts:
        return
    from .export.docx import session_title
    from .review_requests import _notify
    title = session_title(rnd.session) or f'Draft {rnd.session_id}'
    what = 'suggestions' if rnd.kind == DraftReviewRound.Kind.SUGGESTIONS else 'corrections'
    summary = ', '.join(f'{n} {D(k).label.split(" ")[0].lower()}' for k, n in sorted(counts.items()))
    _notify(rnd.author_id, user, rnd.session, 'DRAFT_REVIEW_DONE', f'Your {what} were decided: {title}',
            f'{user.full_name} went through your {what} on "{title}": {summary}.')


def cancel(rnd, user):
    """The author withdraws their own open suggestions."""
    if rnd.status != DraftReviewRound.Status.OPEN or rnd.kind != DraftReviewRound.Kind.SUGGESTIONS:
        raise ReviewError('Only open suggestions can be withdrawn.')
    if user.id != rnd.author_id:
        raise ReviewError('Only the person who made the suggestions can withdraw them.')
    rnd.status = DraftReviewRound.Status.CANCELLED
    rnd.finished_at = timezone.now()
    rnd.save(update_fields=['status', 'finished_at'])
