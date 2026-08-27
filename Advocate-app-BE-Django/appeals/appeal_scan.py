"""Find, in a higher court, a case that looks like an appeal against one of
this advocate's own decided cases.

This reports a fact from the court's own record. It never computes a statutory
limitation deadline: the periods differ by forum AND matter type (CPC s.96 is
90 days to a High Court but 30 to a District Court; Commercial Courts,
Arbitration, IBC and Consumer all override the Schedule), and s.12 requires
certified-copy dates nobody has entered. A confidently wrong deadline is worse
than none, so that arithmetic is deliberately out of scope.

Matching is intentionally conservative: a hit is a CANDIDATE for the advocate
to confirm or dismiss, never an assertion. Parties get reversed on appeal (the
loser appeals), so matching is on name overlap in either direction rather than
on who was petitioner.
"""

from __future__ import annotations

import datetime
import re

# Honorifics, party-role noise and corporate suffixes that inflate name overlap
# without identifying anybody.
_NOISE = {
    'shri', 'sri', 'smt', 'mr', 'mrs', 'ms', 'dr', 'm/s', 'messrs',
    'the', 'and', 'ors', 'anr', 'others', 'another', 'state', 'of', 'rep',
    'by', 'through', 'its', 'vs', 'v', 'versus', 'petitioner', 'respondent',
    'appellant', 'defendant', 'plaintiff', 'union', 'india', 'ltd', 'limited',
    'pvt', 'private', 'company', 'co', 'sons', 'inspector', 'police',
    'secretary', 'government', 'govt', 'district', 'collector', 'officer',
}
_WORD = re.compile(r'[A-Za-z]{3,}')


def name_tokens(text):
    """Distinctive lowercase word tokens from a party name or "X Vs Y" blob."""
    return {w for w in (m.group(0).lower() for m in _WORD.finditer(str(text or '')))
            if w not in _NOISE}


def case_parties(court_id, raw):
    """Party names on the advocate's own case, from its stored court record."""
    if not isinstance(raw, dict):
        return []
    names = []
    if court_id == 'sci':
        fields = raw.get('fields') or {}
        for key in ('Petitioner(s)', 'Respondent(s)'):
            blob = str(fields.get(key) or '')
            # SCI flattens a numbered list into one string.
            parts = re.split(r'(?:^|\s)\d+\s+', blob)
            names.extend(p.strip() for p in parts if p.strip())
    else:
        for c in (raw.get('cases') or []):
            d = c.get('detail') or {}
            for side in ('petitioners', 'respondents'):
                for p in (d.get(side) or []):
                    if p.get('name'):
                        names.append(p['name'])
            if not names and c.get('parties'):
                names.extend(str(c['parties']).split(' Vs '))
    # de-duplicate, keep order
    seen, out = set(), []
    for n in names:
        k = n.strip().lower()
        if k and k not in seen:
            seen.add(k)
            out.append(n.strip())
    return out


def score_match(our_names, candidate_text):
    """0..1 confidence that `candidate_text` names the same litigants.

    Jaccard-style overlap on distinctive tokens. Parties swap sides on appeal,
    so direction is ignored.
    """
    ours = set()
    for n in our_names:
        ours |= name_tokens(n)
    theirs = name_tokens(candidate_text)
    if not ours or not theirs:
        return 0.0
    shared = ours & theirs
    if not shared:
        return 0.0
    # Against the SMALLER set: an appeal often names fewer parties than the
    # original suit, and that should not be penalised.
    return len(shared) / float(min(len(ours), len(theirs)))


# A hit needs at least this much overlap AND this many shared tokens. Two
# distinctive surnames in common is a real signal; one common word is not.
MIN_SCORE = 0.5
MIN_SHARED_TOKENS = 2


def shared_tokens(our_names, candidate_text):
    ours = set()
    for n in our_names:
        ours |= name_tokens(n)
    return ours & name_tokens(candidate_text)


def is_candidate(our_names, candidate_text, filed_on=None, judgment_date=None):
    """Whether a higher-court row plausibly is an appeal against our case."""
    # An appeal cannot predate the judgment it challenges. When we know both
    # dates this is the single strongest filter available.
    if filed_on and judgment_date and filed_on < judgment_date:
        return False, 0.0, ''
    score = score_match(our_names, candidate_text)
    shared = shared_tokens(our_names, candidate_text)
    ok = score >= MIN_SCORE and len(shared) >= MIN_SHARED_TOKENS
    return ok, round(score, 3), ', '.join(sorted(shared)[:6])

# --- picking something a court search box will actually match ---------------
#
# Party fields from the eCourts High Court portal are polluted with advocate
# names, bar numbers and service notes, e.g.
#   "RAJA MOHAMED, V.S.KARTHI-MS/928/1995 FOR R2,DT 29/08/2022 SR24100,COURT
#    NOTICE ,--------,R1 - RAJA MOHAMED (NOTICE RECEIVED BY SOME OTHER PERSON)"
# The LONGEST name is therefore the WORST one to search on. What a registry
# will match is a short, clean, alphabetic personal or entity name.

# Everything from one of these onwards is procedural, not part of a name.
_NOISE_MARKERS = re.compile(
    r'\b(advocate|vak\.?|vakalath|rep\s+by|represented|notice'
    r'|proof\s+of\s+service|typed\s+set|filed\s+for|for\s+r\d'
    r'|dt\.?\s*\d|sr\d)', re.I)


def clean_party_name(raw):
    """Trim a court party string down to the name itself ('' if unusable).

    Cuts at the first procedural marker, then drops comma-separated segments
    that carry reference numbers. It deliberately does NOT just take the first
    segment: "Secretary, Pattikkad Service Co Operative Bank" would collapse
    to "Secretary", which matches half the register and identifies nobody.
    """
    text = str(raw or '').strip()
    if not text:
        return ''
    m = _NOISE_MARKERS.search(text)
    if m:
        text = text[:m.start()]
    text = re.sub(r'\([^)]*\)', ' ', text)          # bracketed asides
    kept = []
    for seg in text.split(','):
        seg = seg.strip()
        if not seg or any(ch.isdigit() for ch in seg):
            continue                                  # a reference, not a name
        kept.append(seg)
        if len(kept) == 2:
            break                                     # a name plus its qualifier
    text = ', '.join(kept)
    text = re.sub(r'\s+', ' ', text).strip(' .,-')
    return text


def searchable_names(names):
    """Party names ranked by how likely a court search box is to match them."""
    scored = []
    for raw in names:
        name = clean_party_name(raw)
        if not name or any(ch.isdigit() for ch in name):
            continue
        words = name.split()
        if len(words) > 8:
            continue                                  # a sentence, not a name
        distinctive = name_tokens(name)
        if not distinctive:
            continue                                  # only honorifics/roles
        # Two or three distinctive words is the sweet spot: enough to identify,
        # short enough that the registry's LIKE match still hits.
        penalty = abs(len(distinctive) - 2)
        scored.append((penalty, len(name), name))
    scored.sort()
    return [n for _, _, n in scored]
