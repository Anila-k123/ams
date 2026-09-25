"""Consistency check (Phase 2, Slice 3): a one-click review that flags
contradictions and loose ends across the whole draft.

Ethos — *verified by code, not hallucinated*: everything that code can reliably
detect is done deterministically (no LLM); a single grounded LLM pass handles the
semantic contradictions code can't, and every LLM finding is verified against the
actual clause text (its quotes must really appear in the clauses they cite) before
it is shown — anything unverifiable is dropped.

Public entry point: ``check_consistency(clauses, facts, model)`` where ``clauses``
is a list of ``{block_id, heading, text}`` (the editor's *live* content). Returns a
list of finding dicts:

    {id, category, severity, title, detail, block_ids, quotes:[{block_id, text}], suggestion?}
"""
import logging
import re

from ..providers.llm import get_llm

logger = logging.getLogger(__name__)

# ── shared helpers ─────────────────────────────────────────────────────────────

def _norm(s: str) -> str:
    """Whitespace-collapsed, lower-cased form for substring/identity comparisons."""
    return re.sub(r'\s+', ' ', (s or '')).strip().lower()


def _clause_text(c: dict) -> str:
    """Heading + body — placeholders and cross-refs can live in either."""
    return f"{c.get('heading') or ''}\n{c.get('text') or ''}"


# ── 1. unfilled blanks (deterministic) ──────────────────────────────────────────

_PLACEHOLDER_RE = re.compile(r'\[\[([^\]]+)\]\]')
# Legacy bare blanks (older drafts used underscores / dot leaders).
_BARE_BLANK_RE = re.compile(r'_{3,}|\.{5,}|…{2,}')


def _check_blanks(clauses):
    labels: dict[str, list] = {}      # label -> [block_id, …]
    bare: list = []                   # block_ids with an unlabeled blank
    for c in clauses:
        bid, text = c.get('block_id'), _clause_text(c)
        for m in _PLACEHOLDER_RE.finditer(text):
            labels.setdefault(m.group(1).strip(), []).append(bid)
        if _BARE_BLANK_RE.search(text):
            bare.append(bid)

    findings = []
    for label, bids in labels.items():
        uniq = sorted({b for b in bids if b is not None})
        findings.append({
            'category': 'unfilled_blank', 'severity': 'error',
            'title': f'Unfilled field: {label}',
            'detail': f'The placeholder “{label}” is still empty — provide this value before finalising.',
            'block_ids': uniq,
            'quotes': [{'block_id': uniq[0] if uniq else None, 'text': f'[[{label}]]'}],
            'suggestion': f'Fill in “{label}”.',
        })
    if bare:
        uniq = sorted({b for b in bare if b is not None})
        findings.append({
            'category': 'unfilled_blank', 'severity': 'warning',
            'title': 'Blank spaces left to fill',
            'detail': 'One or more clauses contain blank fill-in spaces (underscores or dots) with no value.',
            'block_ids': uniq, 'quotes': [], 'suggestion': 'Replace the blanks with the intended values.',
        })
    return findings


# ── 2. party-name variants (deterministic — mechanical case/spacing only) ───────

def _party_names(facts: dict):
    """The party names the lawyer entered (one per line; name is before the first comma)."""
    out = []
    for line in (facts.get('parties') or '').split('\n'):
        name = line.split(',')[0].strip()
        if name:
            out.append(name)
    return out


def _check_party_names(clauses, facts):
    """Flag the SAME party rendered with different case / spacing across the draft
    (e.g. "Acme Pvt Ltd" vs "ACME  Pvt Ltd"). Truncations and suffix swaps
    (Pvt Ltd vs Private Limited) are left to the grounded LLM pass — matching them
    deterministically risks false positives that would erode trust."""
    findings = []
    for name in _party_names(facts):
        # Same tokens, flexible whitespace, case-insensitive.
        pattern = re.compile(re.escape(name).replace(r'\ ', r'\s+'), re.I)
        surfaces: dict[str, list] = {}   # collapsed surface form -> [block_id, …]
        for c in clauses:
            for m in pattern.finditer(_clause_text(c)):
                surfaces.setdefault(re.sub(r'\s+', ' ', m.group(0)).strip(), []).append(c.get('block_id'))
        if len(surfaces) > 1:
            forms = list(surfaces)
            bids = sorted({b for ids in surfaces.values() for b in ids if b is not None})
            findings.append({
                'category': 'party_variant', 'severity': 'warning',
                'title': f'Party written inconsistently: {name}',
                'detail': 'The same party appears with different spelling/spacing: '
                          + ', '.join(f'“{f}”' for f in forms) + '. Use one consistent form.',
                'block_ids': bids,
                'quotes': [{'block_id': surfaces[f][0], 'text': f} for f in forms],
                'suggestion': f'Standardise every mention to “{name}”.',
            })
    return findings


# ── 3. dangling cross-references (deterministic) ────────────────────────────────

_REF_RE = re.compile(r'\b(?:clause|section|article)\s+(\d+)', re.I)


def _check_cross_refs(clauses):
    """Flag references to a Clause/Section number that the document doesn't have.
    Only runs when the draft has a recognisable numbering scheme (≥2 numbered
    headings) — otherwise we can't verify, and stay silent rather than false-positive."""
    numbered = set()
    for c in clauses:
        m = re.match(r'\s*(\d+)[.\s)]', c.get('heading') or '')
        if m:
            numbered.add(int(m.group(1)))
    if len(numbered) < 2:
        return []

    hits: dict[int, list] = {}   # missing target number -> [block_id, …]
    for c in clauses:
        for m in _REF_RE.finditer(c.get('text') or ''):
            n = int(m.group(1))
            if n not in numbered:
                hits.setdefault(n, []).append(c.get('block_id'))

    findings = []
    for n, bids in sorted(hits.items()):
        uniq = sorted({b for b in bids if b is not None})
        findings.append({
            'category': 'cross_reference', 'severity': 'error',
            'title': f'Reference to a missing Clause {n}',
            'detail': f'The draft refers to Clause {n}, but there is no such clause '
                      f'(clauses go up to {max(numbered)}). Fix the reference or add the clause.',
            'block_ids': uniq,
            'quotes': [{'block_id': uniq[0] if uniq else None, 'text': f'Clause {n}'}],
        })
    return findings


# ── 4. semantic contradictions (grounded LLM, verified against the text) ────────

_LLM_SYSTEM = (
    'You review a single legal contract for INTERNAL CONTRADICTIONS — places where '
    'two or more parts of the SAME document disagree on a fact. Look specifically for '
    'conflicts in: durations/terms, dates, monetary amounts, numbers/quantities, '
    'governing law or jurisdiction, party names/roles, and directly opposing obligations.\n'
    'Rules:\n'
    '1. Report ONLY genuine factual conflicts between two or more locations. Do NOT report '
    'style, grammar, missing clauses, or anything that is merely unusual.\n'
    '2. For every finding, quote the EXACT conflicting text from each location VERBATIM '
    '(copy it character-for-character) and give the clause id it came from.\n'
    '3. A contradiction needs at least two quotes from different locations.\n'
    '4. If there are no contradictions, return an empty list.\n'
    'Return ONLY JSON, no markdown: {"findings": [{"title": "<short>", '
    '"detail": "<one or two sentences>", "severity": "error"|"warning", '
    '"quotes": [{"block_id": <id>, "text": "<verbatim quote>"}], '
    '"suggestion": "<how to resolve>"}]}'
)


def _check_contradictions_llm(clauses, facts, model):
    from .edit import _parse_json_object  # tolerant JSON extraction
    listing = '\n\n'.join(
        f"[clause {c.get('block_id')}] {c.get('heading') or ''}\n{c.get('text') or ''}".strip()
        for c in clauses if (c.get('text') or '').strip()
    )
    if not listing.strip():
        return []

    try:
        raw = get_llm(model).complete(system=_LLM_SYSTEM, user=f'CONTRACT CLAUSES:\n{listing}\n\nContradictions as JSON:', max_tokens=1500)
    except Exception:
        logger.exception('consistency: LLM contradiction pass failed; returning deterministic findings only')
        return []

    data = _parse_json_object(raw) or {}
    raw_findings = data.get('findings') if isinstance(data, dict) else None
    if not isinstance(raw_findings, list):
        return []

    # Verify each quote actually appears in the clause it claims to come from; keep
    # only findings that still have ≥2 verified quotes from ≥2 distinct clauses.
    by_id = {c.get('block_id'): _norm(_clause_text(c)) for c in clauses}
    findings = []
    for f in raw_findings:
        if not isinstance(f, dict):
            continue
        verified = []
        for q in (f.get('quotes') or []):
            if not isinstance(q, dict):
                continue
            bid, text = q.get('block_id'), (q.get('text') or '').strip()
            # The LLM may return the id as a string ("7") — normalise to match by_id.
            body = by_id.get(bid)
            if body is None and str(bid).lstrip('-').isdigit():
                bid = int(bid)
                body = by_id.get(bid)
            if text and body and _norm(text) in body:
                verified.append({'block_id': bid, 'text': text})
        if len({q['block_id'] for q in verified}) < 2:
            continue  # unverifiable or single-location → drop (no hallucinated findings)
        findings.append({
            'category': 'contradiction',
            'severity': 'error' if str(f.get('severity')).lower() == 'error' else 'warning',
            'title': (f.get('title') or 'Possible contradiction').strip(),
            'detail': (f.get('detail') or '').strip(),
            'block_ids': sorted({q['block_id'] for q in verified if q['block_id'] is not None}),
            'quotes': verified,
            'suggestion': (f.get('suggestion') or '').strip(),
        })
    return findings


# ── entry point ─────────────────────────────────────────────────────────────────

_SEVERITY_ORDER = {'error': 0, 'warning': 1, 'info': 2}


def check_consistency(clauses, facts=None, model='gemini'):
    """Run every check over the draft and return findings sorted by severity.
    ``clauses`` = [{block_id, heading, text}]; ``facts`` = the session's facts."""
    clauses = [c for c in (clauses or []) if isinstance(c, dict)]
    facts = facts or {}
    findings = []
    findings += _check_blanks(clauses)
    findings += _check_party_names(clauses, facts)
    findings += _check_cross_refs(clauses)
    findings += _check_contradictions_llm(clauses, facts, model)

    findings.sort(key=lambda f: _SEVERITY_ORDER.get(f['severity'], 3))
    for i, f in enumerate(findings, 1):
        f['id'] = i
    return findings
