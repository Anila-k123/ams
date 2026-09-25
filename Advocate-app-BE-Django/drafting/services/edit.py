"""Chat-edit loop (Phase 2, Slice 1): locate the clause an instruction refers to,
then rewrite it. Both steps go through the session's chosen LLM (get_llm)."""
import json
import logging
import re

from ..providers.llm import get_llm

logger = logging.getLogger(__name__)


def _esc(s: str) -> str:
    return (s or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def text_to_html(text: str) -> str:
    """Wrap plain-text lines as <p> for the editor / stored content_html."""
    parts = [f'<p>{_esc(line)}</p>' for line in (text or '').split('\n') if line.strip()]
    return ''.join(parts) or '<p></p>'


def _parse_json_object(raw: str):
    """Best-effort extraction of a JSON object from an LLM response — tolerates
    ```json fences and surrounding prose (first '{' … last '}')."""
    if not raw:
        return None
    s = re.sub(r'```(?:json)?', '', raw).strip()
    start, end = s.find('{'), s.rfind('}')
    if start == -1 or end <= start:
        return None
    try:
        return json.loads(s[start:end + 1])
    except Exception:
        return None


def locate_clause(session, instruction: str, focused_block_id=None, model=None):
    """Pick the clause an instruction refers to. Asks the LLM to choose from the
    clause headings; falls back to the focused clause. Returns a DraftBlock or None."""
    blocks = list(session.blocks.all().order_by('position'))
    if not blocks:
        return None
    by_id = {b.id: b for b in blocks}

    listing = '\n'.join(f'{b.id}: {b.heading or b.block_type}' for b in blocks)
    llm = get_llm(model or session.llm)
    system = ('You match a drafting instruction to the single most relevant clause of a '
              'contract. Reply with ONLY the numeric id of that clause from the list, or NONE.')
    user = f'Clauses (id: heading):\n{listing}\n\nInstruction: {instruction}\n\nClause id:'
    try:
        raw = llm.complete(system=system, user=user, max_tokens=256)
        # Pick the first number in the reply that is a real clause id (avoids
        # grabbing a stray number like "4.1" from the model's phrasing).
        for n in re.findall(r'\d+', raw or ''):
            if int(n) in by_id:
                return by_id[int(n)]
    except Exception:
        logger.exception('locate_clause: LLM location failed; falling back to focus')

    if focused_block_id and int(focused_block_id) in by_id:
        return by_id[int(focused_block_id)]
    return None


# Whole-document refine actions (Phase 2, Slice 4). Each maps to a focused task
# the model applies to a clause while returning the COMPLETE clause verbatim
# except for the intended improvement.
REFINE_DIRECTIVES = {
    'formal': 'Rewrite the clause in a more formal, precise legal register. Preserve the '
              'exact legal meaning, every defined term, party name and number, and the structure.',
    'concise': 'Make the clause more concise — remove redundancy, wordiness and repetition '
               'WITHOUT dropping any legal obligation, right, condition, number or defined term.',
    'grammar': 'Correct ONLY grammar, spelling, punctuation and obvious typos. Do not change '
               'wording, meaning, structure, numbers or defined terms beyond what grammar requires.',
}


def refine_clause(session, block, action: str, base_text: str | None = None, model=None) -> str:
    """Apply a whole-document refine action ('formal'|'concise'|'grammar') to one
    clause and return the improved COMPLETE clause text (or the original on failure)."""
    directive = REFINE_DIRECTIVES.get(action)
    current = (base_text if base_text is not None else block.text) or ''
    if not directive or not current.strip():
        return current

    llm = get_llm(model or session.llm)
    system = (
        'You are a legal drafting assistant specialising in Indian transactional law. '
        'You improve ONE clause of an agreement and return the COMPLETE clause.\n'
        f'1. TASK: {directive}\n'
        '2. "new_text" MUST reproduce the ENTIRE clause — every numbered sub-clause, paragraph '
        'and sentence — applying only the task. Never drop, summarise, renumber or return a fragment.\n'
        '3. PLACEHOLDER PRESERVATION (STRICT):'
        '- Every placeholder enclosed in [[...]] is immutable.'
        '- Copy every placeholder EXACTLY as it appears.'
        '- Never replace a placeholder with an actual value.'
        '- Never rename a placeholder.'
        '- Never delete a placeholder.'
        '- Never add new placeholders unless the users instruction explicitly requires introducing a new missing value.\n'
        '4. LEGAL TERMS OF ART & CITATIONS (IMMUTABLE): reproduce every Latin or other foreign '
        'legal phrase or maxim (e.g. inter alia, prima facie, mutatis mutandis, suo motu, ex parte, '
        'bona fide, res judicata, ipso facto, ultra vires, vide, qua) and every statutory citation '
        '(Act name + section number, e.g. "Section 103 BNS") EXACTLY as written. Never translate, '
        'paraphrase, expand, spell-"correct", anglicise, or drop them.\n'
        '5. Return ONLY a JSON object, no markdown: {"new_text": "<the FULL clause body>"}.'
    )
    user = f'CLAUSE HEADING: {block.heading}\nCURRENT CLAUSE TEXT:\n{current}\n\nRevised clause as JSON:'
    try:
        raw = llm.complete(system=system, user=user, max_tokens=2048)
    except Exception:
        logger.exception('refine_clause: LLM call failed; leaving the clause unchanged')
        return current
    data = _parse_json_object(raw) or {}
    return (data.get('new_text') or '').strip() or current


def refine_clauses_batch(session, items, action: str, model=None) -> dict:
    """Refine MANY clauses in ONE LLM call (used for cloud models, where a call per
    clause wastes tokens on the repeated system prompt). `items` = [{block_id,
    heading, text}]. Returns {block_id(int): new_text} for the clauses the model
    returned — any missing id is simply absent, so the caller falls back to a
    per-clause call for it (which also covers a dropped/truncated clause)."""
    directive = REFINE_DIRECTIVES.get(action)
    if not directive:
        return {}
    listing = '\n\n'.join(
        f'[clause {it.get("block_id")}] {it.get("heading") or ""}\n{it.get("text") or ""}'.strip()
        for it in items if (it.get('text') or '').strip()
    )
    if not listing.strip():
        return {}

    system = (
        'You are a legal drafting assistant specialising in Indian transactional law. '
        'You improve EVERY clause of an agreement and return each one COMPLETE.\n'
        f'1. TASK (apply to every clause): {directive}\n'
        '2. For each clause, reproduce the ENTIRE clause applying only the task — never drop, '
        'summarise, renumber or merge clauses.\n'
        '3. PLACEHOLDER PRESERVATION (STRICT):'
        '- Every placeholder enclosed in [[...]] is immutable.'
        '- Copy every placeholder EXACTLY as it appears.'
        '- Never replace a placeholder with an actual value.'
        '- Never rename a placeholder.'
        '- Never delete a placeholder.'
        '- Never add new placeholders unless the users instruction explicitly requires introducing a new missing value.\n'
        '4. LEGAL TERMS OF ART & CITATIONS (IMMUTABLE): reproduce every Latin or other foreign '
        'legal phrase or maxim (e.g. inter alia, prima facie, mutatis mutandis, suo motu, ex parte, '
        'bona fide, res judicata, ipso facto, ultra vires, vide, qua) and every statutory citation '
        '(Act name + section number, e.g. "Section 103 BNS") EXACTLY as written. Never translate, '
        'paraphrase, expand, spell-"correct", anglicise, or drop them.\n'
        '5. Return ONLY a JSON object mapping each clause id (as a string key) to its full revised '
        'text, no markdown: {"7": {"new_text": "<full clause>"}, "8": {"new_text": "<full clause>"}}. '
        'Include EVERY clause id you were given.'
    )
    user = f'CLAUSES:\n{listing}\n\nRevised clauses as JSON:'
    try:
        raw = get_llm(model or session.llm).complete(system=system, user=user, max_tokens=8192)
    except Exception:
        # The CALL failed (e.g. rate-limited after retries). Return None so the caller
        # does NOT fan out one request per clause into the same limit (a 429 storm).
        logger.exception('refine_clauses_batch: batch call failed; skipping per-clause fallback')
        return None

    data = _parse_json_object(raw) or {}
    out = {}
    for key, val in data.items():
        if not str(key).lstrip('-').isdigit():
            continue
        text = (val.get('new_text') if isinstance(val, dict) else val if isinstance(val, str) else '') or ''
        text = text.strip()
        if text:
            out[int(key)] = text
    return out


def rewrite_clause(session, block, instruction: str, base_text: str | None = None, model=None) -> dict:
    """Revise one clause per the instruction. `base_text` (the editor's live text)
    overrides the stored text when provided. Returns {new_heading, new_text, rationale}."""
    from ..tasks import _facts_brief  # lazy import — tasks imports services only inside functions
    brief = _facts_brief(session.facts)
    current = (base_text if base_text is not None else block.text) or ''

    llm = get_llm(model or session.llm)
    system = (
        'You are a legal drafting assistant specialising in Indian transactional law. '
        'You revise ONE clause of an agreement according to the user\'s instruction.\n'
        'Rules:\n'
        '1. "new_text" MUST be the COMPLETE clause: reproduce the ENTIRE current clause '
        'text — every numbered sub-clause (e.g. 7.1, 7.2, 7.3 …), paragraph and sentence — '
        'verbatim, changing ONLY the specific part the instruction requires. Do NOT drop, '
        'summarise, shorten, renumber, or return only the changed portion. If the '
        'instruction touches one sub-clause, keep every other sub-clause exactly as-is.\n'
        '2. Apply the instruction; otherwise preserve the clause\'s legal structure and effect.\n'
        '2a. DEFINED TERMS — Keep every defined term EXACTLY as written and NEVER expand it into its '
        'literal value: party labels ("Disclosing Party", "Receiving Party", "Party", "Parties", '
        '"Company") AND defined concepts ("Effective Date", "Term", "Confidential Information", and '
        'any capitalised defined term). Write "the Receiving Party" (not a name/address), "the '
        'Effective Date" (not the literal date), "the term of this Agreement" (not the number of '
        'years). A value belongs only where it is first defined; elsewhere reference the term.\n'
        '3. Party-specific values come from the case facts. Where a needed value is not provided. '
        '4. PLACEHOLDER PRESERVATION (STRICT):'
        '- Every placeholder enclosed in [[...]] is immutable.'
        '- Copy every placeholder EXACTLY as it appears.'
        '- Never replace a placeholder with an actual value.'
        '- Never rename a placeholder.'
        '- Never delete a placeholder.'
        '- Never add new placeholders unless the users instruction explicitly requires introducing a new missing value. \n'
        '4a. LEGAL TERMS OF ART & CITATIONS (IMMUTABLE): reproduce every Latin or other foreign '
        'legal phrase or maxim (e.g. inter alia, prima facie, mutatis mutandis, suo motu, ex parte, '
        'bona fide, res judicata, ipso facto, ultra vires, vide, qua) and every statutory citation '
        '(Act name + section number, e.g. "Section 103 BNS") EXACTLY as written UNLESS the '
        'instruction explicitly changes them. Never translate, paraphrase, expand, spell-"correct", '
        'anglicise, or drop them on your own.\n'
        '5. Return ONLY a JSON object, no markdown: '
        '{"new_heading": "<heading or empty>", "new_text": "<the FULL clause body>", '
        '"rationale": "<one short sentence on what changed>"}.'
    )
    user = (f'CLAUSE HEADING: {block.heading}\nCURRENT CLAUSE TEXT:\n{current}\n\n'
            f'CASE FACTS:\n{brief}\n\nINSTRUCTION: {instruction}\n\nRevised clause as JSON:')
    raw = llm.complete(system=system, user=user, max_tokens=2048)
    data = _parse_json_object(raw) or {}
    new_text = (data.get('new_text') or '').strip() or current
    return {
        'new_heading': (data.get('new_heading') or '').strip() or (block.heading or ''),
        'new_text': new_text,
        'rationale': (data.get('rationale') or '').strip() or 'Revised per your instruction.',
    }
