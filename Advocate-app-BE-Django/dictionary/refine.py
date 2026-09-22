"""Strip inline legal references from a dictionary definition so the reader sees
the plain meaning — not case citations, reporter runs or statute pin-cites.

This is *cleaning*, not rewriting: every surviving word is the source's own. It
removes the scaffolding lawyers cite by but a layperson doesn't want:

* bracketed statute pin-cites      ``[Indian Evidence Act, Ss. 115, 116]``
* citation clusters joined by ``=``  ``50 Bom 547=28 Bom LR 689=AIR 1926 Bom 427``
* case-name + citation sentences     ``B.V. Reddy v. State of Karnataka, AIR 1985 Kan 99, 106.``
* reference-only parentheticals      ``(Co Litt. 352a ; Tomlin's Law Dic.)`` ``(Webster)``
* stray reporter runs                ``(1976) 3 All ER 561, 564 (CA)``

It is deliberately idempotent, so it is safe to run over already-cleaned rows.
"""

import re

# Reporter / court / series abbreviations that mark a citation (not prose).
_REPORTERS = (
    r'AIR|SCC|SCR|SC|All\s?ER|ER|WLR|KB|QB|Ch|App\.?\s?Cas|Cranch|How|L\.?\s?[Ee]d|'
    r'Fed\.?\s?Cas|Fed|US|NE|NW|SW|SE|So|P|Am\.?\s?St\.?\s?Rep|Am\.?\s?Rep|LRA|CCA|'
    r'Bom\s?LR|Bom|Cal\s?WN|CWN|Cal|Mad|Ker|Kar|Kan|All|Pat|Lah|Nag|Raj|MP|MPLJ|MLJ|'
    r'MWN|WN|WRPC|WR|IC|MIA|BLR|CLJ|CLR|Sar|Suth|LJMC|LJ|LT|CB|ECL|CPD|Wis|Mass|Ohio|'
    r'Cd|CB|PC|Ch\.?\s?D|QBD|Ind\s?App|IA'
)
_YEAR = r'(?:1[6-9]\d\d|20\d\d)'


def _strip_citation_clusters(s):
    # Runs of citation-like tokens joined by '=' are always citation chains.
    # Match only digit-led / short-Capitalized-abbrev tokens so lowercase prose
    # ("...inveterate in India. (11 MIA...=") is never eaten before the '='.
    _CIT = r"(?:\d[\w./'-]*|[A-Z][A-Za-z.]{0,6})"
    s = re.sub(rf'\(?\b{_CIT}(?:\s+{_CIT})*(?:\s*=\s*{_CIT}(?:\s+{_CIT})*)+\)?', ' ', s)
    # (1976) 3 All ER 561, 564 (CA)  /  AIR 1985 Kan 99, 106  /  50 Bom 547
    s = re.sub(
        rf'\(?\b{_YEAR}\)?[\s,]*\d*\s*(?:{_REPORTERS})\b[\s.,]*\d+(?:[\s,]+\d+)*'
        rf'(?:\s*\((?:CA|PC|SC|HL|FB|DB|SN)\))?',
        ' ', s)
    s = re.sub(rf'\b\d+\s*(?:{_REPORTERS})\b[\s.,]*\d+(?:[\s,]+\d+)*', ' ', s)
    # Reporter-led: "AIR 1956 Punj 143, 144" / "AIR 1976 S.C. 1418, 1421". The court
    # tokens between year and page are limited to a few short Capitalized words so a
    # lazy match can never spill into prose ("AIR 1955 An income accrues…").
    s = re.sub(
        rf'\b(?:{_REPORTERS})\s+{_YEAR}(?:\s+[A-Z][A-Za-z.]{{0,10}}){{0,3}}\s+\d+(?:[\s,]+\d+)*',
        ' ', s)
    # Bare "(1976) 3 All ER" leftovers / reporter+year with no trailing page number.
    s = re.sub(rf'\(?\b{_YEAR}\)?\s+\d+\s*(?:{_REPORTERS})\b', ' ', s)
    s = re.sub(rf'\b(?:{_REPORTERS})\s+{_YEAR}\b', ' ', s)
    return s


def _strip_section_refs(s):
    """Remove statutory pin-cites: `S. 11`, `Ss. 115, 116`, `Sec. 5(1)`, `Art. 226`,
    `O. 41, R. 1`, `r. 29(m)`, and `Act XLV of 1860` / `Act X of 1897`. Bounded so it
    only consumes the cite tokens (letters/digits/roman/brackets), never sentence prose."""
    # Section / order / rule / article pin-cites, incl. chained "S. 115, O. 41, R. 1"
    # and the plural "Ss. 107-114".
    _num = r'\d[\dA-Za-z()\-]*(?:\s*,\s*\d[\dA-Za-z()\-]*)*'   # "182" or "182, 194"
    s = re.sub(
        rf'\b(?:S[Ss]?\.|Sec(?:s|tion)?\.?|Art(?:s|icle)?\.?|O\.|R\.|r\.|cl\.|Cl\.|para\.?|Sch\.?)'
        rf'\s*{_num}'
        rf'(?:\s*;?\s*(?:S[Ss]?\.|Sec\.?|Art\.?|O\.|R\.|r\.|cl\.|Cl\.)\s*{_num})*',
        ' ', s)
    # "Act XLV of 1860" (roman) and "Act 9, 1872" / "Act 6 of 1874" (numbered) act cites.
    s = re.sub(r'\bAct\s+[IVXLCDM]+\s+of\s+\d{4}\b', ' ', s)
    s = re.sub(r'\bAct\s+\d+\s*(?:,|of)\s*\d{4}\b', ' ', s)
    return s


def _strip_case_names(s):
    # "Something v. Something, <citation-ish up to sentence end>."
    return re.sub(
        r'\b[A-Z][A-Za-z.\'’&-]*(?:\s+[A-Z&][A-Za-z.\'’&-]*){0,5}\s+v\.?\s+'
        r'[A-Z][^.;:()\[\]]{0,80}?(?=[.;]|\s\()',
        ' ', s)


def _strip_ref_parens(s):
    # Parentheticals that are references (contain a citation marker), removed;
    # short glosses like "(Lat.)", "(H.)", "(as)" are kept.
    # Treatise / law-dictionary author attributions the book cites definitions from.
    sources = (
        r'Black|Stroude?|Wharton|Bouvier|Mozley|Jowitt|Tomlin|Cowel|Coke|Jarman|'
        r'Rastell|Burrill|Rapalje|Ballentine|Anderson|Cunningham|Sweet|Termes|'
        r'Latin for Lawyers|Mac\s?Naughten|Wil\.')
    marker = re.compile(
        rf'\bv\.|Dict|Gloss|Law\s?Dic|Comm\.|Litt|Cyc|Webster|Story|Blackstone|'
        rf'{sources}|'
        rf'\bed\.|\bp\.?\s*\d|\bpp\.|Sec\.|\bS\.\s?\d|\bArt\.|{_REPORTERS}|{_YEAR}|\d{{3,}}')
    out, i, n = [], 0, len(s)
    while i < n:
        if s[i] == '(':
            depth, j = 0, i
            while j < n:
                if s[j] == '(':
                    depth += 1
                elif s[j] == ')':
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            inner = s[i + 1:j]
            if marker.search(inner):
                i = j + 1
                continue
            out.append(s[i:j + 1])
            i = j + 1
        else:
            out.append(s[i])
            i += 1
    return ''.join(out)


def _tidy(s):
    s = re.sub(r'[\[{][^\]}\n]*[\]}]', ' ', s)   # any leftover bracket/brace cite
    s = re.sub(r'\(\s*[),;.]*\s*\)', ' ', s)     # empty / punctuation-only parens
    s = re.sub(r'\s*[;,]\s*(?=[.;,])', '', s)    # stranded separators
    s = re.sub(r'\s+([.,;:])', r'\1', s)         # space before punctuation
    s = re.sub(r'\.\s*[,;:]+', '. ', s)          # ".," left by a removed trailing paren
    s = re.sub(r'([.,;:])\1+', r'\1', s)         # doubled punctuation
    s = re.sub(r'\(\s+', '(', s)
    s = re.sub(r'\s+\)', ')', s)
    s = re.sub(r'[ \t]{2,}', ' ', s)
    s = re.sub(r'\s+\n', '\n', s)
    s = re.sub(r'^[\s.,;:)]+', '', s)            # leading junk
    return s.strip(' \t;,')


def refine_definition(text):
    if not text:
        return ''
    s = re.sub(r'[\[{][^\]}\n]*[\]}]', ' ', text)   # 1. bracketed/brace statute pin-cites
    s = _strip_citation_clusters(s)          # 2. reporter runs / =-chains
    s = _strip_case_names(s)                 # 3. "X v. Y, <cite>."
    s = _strip_ref_parens(s)                 # 4. reference parentheticals
    s = _strip_citation_clusters(s)          # 5. mop up cites the parens exposed
    s = _strip_section_refs(s)               # 6. S./Art./O./R. statute pin-cites
    return _tidy(s)
