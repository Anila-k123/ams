"""A clause's heading, kept apart from its body from upload to download (docs/DRAFT_EXPORT.md,
"Headings").

The AI writes only clause BODIES; it is given the heading as a label and never writes it. The heading
itself is decided by rule:
- a FIXED heading (no blanks, no case details: "VERSUS", "1. PREMISES", "LEASE AGREEMENT") stays
  exactly as the template / reference document has it;
- a VARIABLE heading (a [[blank]], a court, a case number, a name or a date: "IN THE COURT OF
  [[Court Name]], CHENNAI", "O.S. No. 145 of 2024") gets only its details filled from the facts
  (tasks._fill_variable_headings); what can't be filled stays a [[blank]].

Which line is a heading is what the parsers detected: a Word heading (services/parser.py
_docx_is_heading, carried on the clause as `heading`), else the same heading-line rules the
splitters cut clauses on. A short first sentence is never guessed to be a heading.
"""

import re

# Lines that open a clause but are recital connectors or lead-ins, not headings.
_NOT_HEADINGS = {'whereas', 'now therefore', 'now, therefore', 'and', 'or', 'between', 'by and between',
                 'witnesseth', 'in witness whereof', 'recitals'}
_NUMBERING = re.compile(r'^\s*(?:(?:article|section|clause|schedule|part)\s+)?(?:\d+(?:\.\d+)*|[ivxlc]+)[.):]?\s+', re.I)
# Case details in a heading: a blank, a digit (after the clause number), a person / firm, a forum.
_VARIABLE = re.compile(r'\[\[|_{3,}|\.{4,}|…{2,}|\d|\b(?:mr|mrs|ms|dr|m/s|smt|shri|sri|thiru)\b\.?|sd/-'
                       r'|^\s*(?:in\s+the\s+(?:high\s+)?court|before\s+the|in\s+the\s+matter\s+of)\b', re.I)


def _title_shaped(line):
    line = (line or '').strip()
    if not line or len(line) > 120 or line.endswith(('.', ';', ',')):
        return False
    return re.sub(r'[\s:.,\-]+$', '', line.lower()) not in _NOT_HEADINGS


def split_heading(clause):
    """(heading, body) of a parsed clause {'text', optional 'heading'}. `heading` is '' when the
    clause has none (a preamble, a signature block, numbered clauses without titles)."""
    from .parser import _is_allcaps_heading, _is_heading_line
    text = (clause.get('text') or '').strip('\n')
    lines = text.split('\n')
    first_i = next((i for i, x in enumerate(lines) if x.strip()), None)
    if first_i is None:
        return '', text
    first = lines[first_i].strip()
    rest = '\n'.join(lines[first_i + 1:]).strip('\n')
    if 'heading' in clause:                                       # detected by the Word parser
        detected = (clause.get('heading') or '').strip()
        if detected and detected == first and rest.strip():
            return first, rest
        return '', text
    # PDF (Docling) / plain-text clauses: the splitters' own heading rules.
    if rest.strip() and _title_shaped(first) and (_is_heading_line(first) or _is_allcaps_heading(first)):
        return first, rest
    return '', text


def is_variable_heading(heading):
    """A heading carrying case details (filled per case), as opposed to fixed wording."""
    body = _NUMBERING.sub('', heading or '', count=1)
    return bool(_VARIABLE.search(body))


def heading_kind(heading):
    return '' if not heading else ('variable' if is_variable_heading(heading) else 'fixed')
