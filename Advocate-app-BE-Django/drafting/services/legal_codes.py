"""Legal code replacement engine.

Scans clause text for references to the three old Indian criminal codes and
substitutes the equivalent sections from the new codes effective 1 July 2024:

    IPC  (Indian Penal Code, 1860)         → BNS  (Bharatiya Nyaya Sanhita)
    CrPC (Code of Criminal Procedure, 1973) → BNSS (Bharatiya Nagarik Suraksha Sanhita)
    IEA  (Indian Evidence Act, 1872)        → BSA  (Bharatiya Sakshya Adhiniyam)

Public API
----------
apply_legal_replacements(text)  → (updated_text, [Replacement, ...])
patch_draft_block(block)        → list[Replacement]   (saves the block)
patch_draft_session(session_id) → dict summary
invalidate_cache()              → clears the in-memory mapping cache

The cache is warm for the lifetime of the process (one DB query per worker start).
Call invalidate_cache() after running `load_legal_codes` if the worker is long-lived.
"""

import logging
import re
from dataclasses import asdict, dataclass
from functools import lru_cache

logger = logging.getLogger(__name__)

# ── Section number pattern ────────────────────────────────────────────────────
# Matches "302", "498A", "376AB", "376DA" — digits + any trailing capital letters.
_SEC_NUM = r'\d+[A-Z]*'

# ── Act-name aliases (regex fragments, non-capturing) ─────────────────────────
_ACT_ALIAS: dict[str, str] = {
    'IPC': (
        r'(?:IPC|I\.P\.C\.?'
        r'|Indian\s+Penal\s+Code(?:,?\s*1860)?)'
    ),
    'CrPC': (
        r'(?:CrPC|Cr\.P\.C\.?|Cr\.PC'
        r'|Code\s+of\s+Criminal\s+Procedure(?:,?\s*1973)?)'
    ),
    'IEA': (
        r'(?:IEA|I\.E\.A\.?'
        r'|(?:Indian\s+)?Evidence\s+Act(?:,?\s*1872)?)'
    ),
}

# After the act name, lawyers often append a parenthetical abbreviation such as
# (“IPC”), (‘IPC’), (IPC) or the same with curly/smart quotes from Word/PDFs.
# [^\w)(]{0,3} accepts up to 3 non-word non-paren chars on each side of the
# abbreviation so any quote style is consumed without needing to enumerate them.
_ABBR_PARENS = (
    r'(?:\s*\([^\w)(]{0,3}'
    r'(?:IPC|I\.P\.C\.?|CrPC|Cr\.P\.C\.?|Cr\.PC|IEA|I\.E\.A\.?)'
    r'[^\w)(]{0,3}\))?'
)

# ── "Read with" / "and" / comma / slash chain ─────────────────────────────────
# Captures zero or more additional sections joined to the first by any of the
# connectors lawyers use:  "read with", "r/w", "and", ",", "/"
# Example: "Section 302 read with Section 34 and Section 149 IPC"
#          chain group = " read with Section 34 and Section 149"
_CHAIN = (
    r'(?P<chain>'
    r'(?:'
    r'(?:\s*,\s*|\s+and\s+|\s+read\s+with\s+|\s+r/w\s+|\s*/\s*)'
    r'(?:[Ss]ections?\s+)?'
    r'\d+[A-Z]*'
    r')*'
    r')'
)

# Splits the chain group into (connector, section_number) pairs
_CHAIN_ITEM_RE = re.compile(
    r'(\s*,\s*|\s+and\s+|\s+read\s+with\s+|\s+r/w\s+|\s*/\s*)'
    r'(?:[Ss]ections?\s+)?'
    r'(\d+[A-Z]*)',
    re.IGNORECASE,
)


def _compile(act_alias: str) -> re.Pattern:
    """Build one pattern for an old act.

    Named groups:
        kw  — keyword prefix ("Section", "Sec.", "S.", "u/s", "under section", or empty)
        sec — bare section number ("302", "498A")
    """
    kw = (
        r'(?P<kw>'
        r'(?:under\s+)?[Ss]ections?\s+'   # "Section", "Sections", "under Section"
        r'|[Ss]ec\.\s*'                   # "Sec."
        r'|[Ss]\.\s*'                     # "S."
        r'|u/s\s+'                        # "u/s"
        r'|)'                             # bare: no keyword (still needs act name after)
    )
    return re.compile(
        r'\b'
        + kw
        + r'(?P<sec>' + _SEC_NUM + r')'
        + _CHAIN                           # optional: "read with S.34 and S.149" etc.
        + r'(?:\s+of\s+(?:the\s+)?)?\s*'  # optional "of (the)"
        + act_alias
        + _ABBR_PARENS                     # optional trailing ("IPC") / ("CrPC") etc.
        + r'(?!\w)',                        # must not run into a word char after the match
        re.IGNORECASE,
    )


_PATTERNS: list[tuple[str, re.Pattern]] = [
    (act, _compile(alias)) for act, alias in _ACT_ALIAS.items()
]


# ── Mapping cache ─────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _get_mappings() -> dict[tuple[str, str], dict]:
    """Load all LegalCodeMapping rows into a dict keyed by (old_act, old_section).

    Section numbers are uppercased for case-insensitive lookup.
    """
    from ..models import LegalCodeMapping
    rows = LegalCodeMapping.objects.all().values(
        'old_act', 'old_section', 'new_act', 'new_section', 'changed', 'description'
    )
    result = {
        (r['old_act'], r['old_section'].upper()): {
            'new_act':     r['new_act'],
            'new_section': r['new_section'],
            'changed':     r['changed'],
            'description': r['description'],
        }
        for r in rows
    }
    logger.debug('Loaded %d legal-code mappings into cache.', len(result))
    return result


def invalidate_cache() -> None:
    """Clear the in-memory mapping cache.  Call after reloading fixtures."""
    _get_mappings.cache_clear()


# ── Replacement formatter ─────────────────────────────────────────────────────

def _format_new_ref(keyword: str, new_section: str, new_act: str) -> str:
    """Return replacement text that mirrors the keyword style of the original."""
    sec_act = f'{new_section} {new_act}'
    kw = keyword.strip().lower()
    if not kw:
        return sec_act
    if kw.startswith('u/s'):
        return f'u/s {sec_act}'
    plural = 'sections' in kw
    prefix = 'Sections' if plural else 'Section'
    if 'under' in kw:
        prefix = f'under {prefix}'
    return f'{prefix} {sec_act}'


def _format_chain_ref(
    kw: str,
    sec_results: list[tuple[str, dict | None]],
    chain_items: list[tuple[str, str]],
) -> str:
    """Build replacement text for a single section or a chain.

    sec_results : [(old_sec, row_or_None), ...]   first element = lead section
    chain_items : [(connector, old_sec), ...]     from _CHAIN_ITEM_RE

    The new-act abbreviation is appended once at the very end, e.g.:
        "Section 103 read with Section 3(5) BNS"
    """
    new_act = next(
        (r['new_act'] for _, r in sec_results if r and r['new_section']),
        None,
    )
    if not new_act:
        return None  # nothing in the chain is in our DB

    parts = []

    # ── Lead section ─────────────────────────────────────────────────────────
    first_sec, first_row = sec_results[0]
    new_sec = first_row['new_section'] if (first_row and first_row['new_section']) else first_sec

    kw_lower = kw.strip().lower()
    if not kw_lower:
        parts.append(new_sec)
    elif kw_lower.startswith('u/s'):
        parts.append(f'u/s {new_sec}')
    else:
        plural = 'sections' in kw_lower
        prefix = 'Sections' if plural else 'Section'
        if 'under' in kw_lower:
            prefix = f'under {prefix}'
        parts.append(f'{prefix} {new_sec}')

    # ── Chain sections ────────────────────────────────────────────────────────
    for i, (connector, old_sec) in enumerate(chain_items):
        row = sec_results[i + 1][1] if (i + 1) < len(sec_results) else None
        new_sec = row['new_section'] if (row and row['new_section']) else old_sec
        conn = connector.strip()
        # Comma stays tight to preceding text; other connectors get a leading space
        sep = '' if conn == ',' else ' '
        parts.append(f'{sep}{conn} Section {new_sec}')

    # ── New act abbreviation once at the end ──────────────────────────────────
    parts.append(f' {new_act}')

    return ''.join(parts)


# ── Core data model ───────────────────────────────────────────────────────────

@dataclass
class Replacement:
    """One matched and replaced legal-code reference."""
    original:    str   # full matched string, e.g. "Section 302 IPC"
    replaced:    str   # substituted string, e.g. "Section 103(1) BNS"
    old_act:     str   # e.g. "IPC"
    old_section: str   # e.g. "302"
    new_act:     str   # e.g. "BNS"
    new_section: str   # empty when the section is repealed
    changed:     bool  # True = substantive wording/penalty change in new code
    description: str   # provision title from the old act


# ── Text replacement ──────────────────────────────────────────────────────────

def apply_legal_replacements(text: str) -> tuple[str, list[Replacement]]:
    """Return *(updated_text, replacements)*.

    Finds all references to old criminal code sections in *text*, looks each up
    in LegalCodeMapping, and substitutes the new equivalent. Sections that were
    repealed with no equivalent are annotated inline so the lawyer notices them.

    Overlapping matches are resolved by taking the first (leftmost) match.
    All matched positions are replaced right-to-left to avoid offset drift.
    """
    if not text:
        return text, []

    mappings = _get_mappings()

    # Collect all (start, end, act_code, all_secs, chain_items, match).
    # all_secs  : [first_sec, sec2, sec3, ...]  — one entry per section in the chain
    # chain_items: [(connector, sec), ...]       — the "read with / and / ," parts
    candidates: list[tuple[int, int, str, list[str], list[tuple[str, str]], re.Match]] = []
    for act_code, pattern in _PATTERNS:
        for m in pattern.finditer(text):
            chain_items = _CHAIN_ITEM_RE.findall(m.group('chain') or '')
            all_secs = [m.group('sec')] + [sec for _, sec in chain_items]
            candidates.append((m.start(), m.end(), act_code, all_secs, chain_items, m))

    if not candidates:
        return text, []

    # Sort by start; drop overlaps by keeping first.
    candidates.sort(key=lambda x: x[0])
    live: list[tuple[int, int, str, list[str], list[tuple[str, str]], re.Match]] = []
    last_end = -1
    for item in candidates:
        if item[0] >= last_end:
            live.append(item)
            last_end = item[1]

    # Apply right-to-left so earlier offsets stay valid.
    result = text
    replacements: list[Replacement] = []

    for start, end, act_code, all_secs, chain_items, m in reversed(live):
        kw = m.group('kw') or ''

        # Look up every section in the chain
        sec_results: list[tuple[str, dict | None]] = [
            (sec, mappings.get((act_code, sec.upper())))
            for sec in all_secs
        ]

        # Skip the whole match if nothing in the chain is in our DB
        if not any(row for _, row in sec_results):
            continue

        replaced_text = _format_chain_ref(kw, sec_results, chain_items)
        if replaced_text is None:
            continue

        # Emit one Replacement record per known section (audit trail)
        full_original = text[start:end]
        for sec_raw, row in sec_results:
            if not row:
                continue
            if not row['new_section']:
                # Repealed — annotate the whole match once (only on the first repealed hit)
                replaced_text = (
                    f'{full_original}'
                    f' [repealed — no direct equivalent in {row["new_act"]}]'
                )
            replacements.append(Replacement(
                original=full_original,
                replaced=replaced_text,
                old_act=act_code,
                old_section=sec_raw,
                new_act=row['new_act'],
                new_section=row['new_section'],
                changed=row['changed'],
                description=row['description'],
            ))

        result = result[:start] + replaced_text + result[end:]

    replacements.sort(key=lambda r: text.index(r.original))
    return result, replacements


def _apply_to_html(html: str, replacements: list[Replacement]) -> str:
    """Apply the same substitutions to HTML content_html.

    Works on the raw HTML string — safe because legal section references
    (e.g. "Section 302 IPC") are never split across HTML tags in TipTap output.
    """
    result = html
    for r in reversed(replacements):  # right-to-left to preserve offsets
        result = result.replace(r.original, r.replaced, 1)
    return result


# ── Block / session helpers ───────────────────────────────────────────────────

def patch_draft_block(block) -> list[Replacement]:
    """Apply legal-code replacements to *block* in-place and save.

    Updates both ``text`` and ``content_html`` (if non-empty) and stores the
    replacement audit trail in ``block.legal_code_replacements``.

    Returns the list of Replacement objects (empty list if nothing changed).
    """
    updated_text, replacements = apply_legal_replacements(block.text)
    if not replacements:
        return []

    block.text = updated_text
    if block.content_html:
        block.content_html = _apply_to_html(block.content_html, replacements)
    block.legal_code_replacements = [asdict(r) for r in replacements]
    block.save(update_fields=['text', 'content_html', 'legal_code_replacements'])

    logger.info(
        'DraftBlock %s: %d legal-code reference(s) updated.',
        block.id, len(replacements),
    )
    return replacements


def patch_draft_session(session_id: int) -> dict:
    """Apply legal-code replacements to every block in a DraftSession.

    Returns a summary dict::

        {
            "session_id": 42,
            "blocks_scanned": 12,
            "blocks_updated": 3,
            "total_replacements": 7,
        }

    Safe to call multiple times — blocks that were already patched will have
    their old references updated to the new ones (idempotent via re-scan).
    """
    from ..models import DraftBlock

    # Reload mappings from the DB before every session patch. A long-lived Celery
    # worker holds the mapping set in an lru_cache from its startup; without this,
    # rows added by a later `load_legal_codes` run (e.g. the CrPC 227/231/239
    # supplements) would be invisible until the worker restarts. One extra query
    # per session — negligible, since the per-block loop below still shares the
    # freshly-warmed cache.
    invalidate_cache()

    blocks = list(DraftBlock.objects.filter(session_id=session_id))
    total_replacements = 0
    blocks_updated = 0

    for block in blocks:
        reps = patch_draft_block(block)
        if reps:
            blocks_updated += 1
            total_replacements += len(reps)

    summary = {
        'session_id':       session_id,
        'blocks_scanned':   len(blocks),
        'blocks_updated':   blocks_updated,
        'total_replacements': total_replacements,
    }
    logger.info('patch_draft_session %s: %s', session_id, summary)
    return summary
