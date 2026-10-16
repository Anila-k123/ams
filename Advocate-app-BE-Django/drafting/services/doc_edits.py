"""Lisa's changes to an ONLYOFFICE draft as checked find / replace edits (docs/ONLYOFFICE_PLAN.md,
"Lisa's edits").

The model is shown the Word file as numbered paragraphs and answers with small edits: "in paragraph 29
replace 'MS/2210/2014' with 'MS/2223/2026'". It never writes a clause back, so nothing else in the text can
drift (line breaks, spacing, blanks). Each edit is checked against the file before it is shown: the words
must be in that paragraph, or the edit is dropped. A value that appears in more paragraphs than the model
named is found by searching, so a change reaches every place. When the instruction could mean different
text ("the enrolment number" with two of them in the document), the model asks instead of guessing.
docfile.apply_edits writes the accepted edits as tracked changes.
"""
import logging
import re

from ..providers.llm import get_llm
from .edit import _parse_json_object

logger = logging.getLogger(__name__)

# Paragraph text sent to the model is cut at this length (a find must lie in what was sent).
_PARA_CHARS = 1500
# A searched-for extra place is ticked by default only for values (numbers, ids, dates, emails): the same
# phrase in other paragraphs ("the Client") is offered unticked.
_VALUE = re.compile(r'[\d@/]')

SYSTEM = (
    'You edit a legal document for an Indian advocate. The document is given as numbered paragraphs '
    '([P12] text). You do NOT rewrite text: you answer with precise edits that the system applies as tracked '
    'changes.\n'
    'Reply with ONLY one JSON object, no prose:\n'
    '{"summary": "<one short sentence>", "edits": [{"p": <paragraph number>, "find": "<exact text>", '
    '"replace": "<new text>"}]}\n'
    'or, ONLY when the instruction could mean different text in the document and you cannot tell which:\n'
    '{"question": "<short question>", "options": ["<option 1>", "<option 2>"]}\n'
    'Rules:\n'
    '1. "find" is copied EXACTLY, character for character, from that one paragraph. Keep it short: the '
    'words that change plus a few around them only when needed to make it unambiguous. Never span two '
    'paragraphs.\n'
    '2. "replace" is what "find" becomes. Change nothing else.\n'
    '3. Make the change EVERYWHERE it applies: one edit per paragraph where it occurs (a number, name or '
    'date often appears several times).\n'
    '4. Text like [[Label]] is a blank for the user to fill: never edit it.\n'
    '5. BEFORE editing, find every text in the document that fits what the instruction describes (e.g. every '
    'enrolment number, every date, every amount of that kind). If they are DIFFERENT values (e.g. two '
    'enrolment numbers of two different advocates) and the instruction does not say which one (by the '
    'person, the old value or the place), do NOT pick one: reply with "question", one option per distinct '
    'value, saying whose it is and its current value (e.g. "S. Meenakshi: MS/2210/2014"). Add an option '
    '"All of them" when changing all could make sense. Do not ask when every match has the same value or '
    'the instruction already identifies it.\n'
    '6. If nothing in the document needs to change, reply {"summary": "<why>", "edits": []}.'
)


def _listing_text(paras):
    return '\n'.join(f'[P{p["n"]}] {p["text"][:_PARA_CHARS]}' for p in paras if p['text'].strip())


def _context(text, find, width=50):
    """The words around `find` in its paragraph, for the review card: (before, after)."""
    at = text.find(find)
    if at < 0:
        return '', ''
    pre, post = text[max(0, at - width):at], text[at + len(find):at + len(find) + width]
    return (('…' if at > width else '') + pre.lstrip()), (post.rstrip() + ('…' if at + len(find) + width < len(text) else ''))


def check_edits(raw_edits, paras, headings=None):
    """The model's edits that hold against the file, plus extra places the same value appears. Returns
    (edits, dropped): each edit {id, n, text, find, replace, blockId, heading, before, after, extra,
    checked}; `dropped` counts the model's edits whose words weren't in their paragraph."""
    by_n = {p['n']: p for p in paras}
    headings = headings or {}
    out, seen, dropped = [], set(), 0

    def add(n, find, replace, extra):
        p = by_n[n]
        if (n, find) in seen:
            return
        seen.add((n, find))
        before, after = _context(p['text'], find)
        out.append({'id': len(out), 'n': n, 'text': p['text'], 'find': find, 'replace': replace,
                    'blockId': p['block_id'], 'heading': headings.get(p['block_id'], ''),
                    'before': before, 'after': after, 'extra': extra,
                    'checked': (not extra) or bool(_VALUE.search(find))})

    for e in raw_edits or []:
        if not isinstance(e, dict):
            dropped += 1
            continue
        try:
            n = int(str(e.get('p', '')).lstrip('Pp'))
        except ValueError:
            dropped += 1
            continue
        find, replace = str(e.get('find') or ''), str(e.get('replace') if e.get('replace') is not None else '')
        p = by_n.get(n)
        if p is None or not find or find == replace or '\n' in find or find not in p['text'] \
                or '[[' in find:
            dropped += 1
            continue
        add(n, find, replace, extra=False)
    # The same words elsewhere: a value the model named once is changed everywhere it appears.
    for e in list(out):
        if len(e['find']) < 4:
            continue
        for p in paras:
            if p['n'] != e['n'] and e['find'] in p['text']:
                add(p['n'], e['find'], e['replace'], extra=True)
    out.sort(key=lambda e: (e['n'], e['id']))
    for i, e in enumerate(out):
        e['id'] = i
    return out, dropped


def plan_edits(session, instruction, paras, model=None, headings=None):
    """Ask the model for edits to `paras` (docfile.paragraph_listing). Returns {kind: 'edits', summary,
    edits, dropped} or {kind: 'question', question, options}. Raises on a model failure."""
    from ..tasks import _facts_brief  # lazy: tasks imports services inside functions
    brief = _facts_brief(session.facts)
    user = (f'Case facts (for reference):\n{brief}\n\n' if brief else '') + \
        f'Document:\n{_listing_text(paras)}\n\nInstruction: {instruction}\n\nJSON:'
    raw = get_llm(model or session.llm).complete(system=SYSTEM, user=user, max_tokens=2048)
    data = _parse_json_object(raw)
    if not isinstance(data, dict):
        logger.warning('doc edits: the model gave no JSON (%d chars)', len(raw or ''))
        raise ValueError('no JSON')
    if data.get('question') and not data.get('edits'):
        options = [str(o).strip() for o in (data.get('options') or []) if str(o).strip()][:6]
        return {'kind': 'question', 'question': str(data['question']).strip(), 'options': options}
    edits, dropped = check_edits(data.get('edits'), paras, headings)
    return {'kind': 'edits', 'summary': str(data.get('summary') or '').strip(), 'edits': edits, 'dropped': dropped}
