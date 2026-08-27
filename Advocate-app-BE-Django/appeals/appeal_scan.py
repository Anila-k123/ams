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
