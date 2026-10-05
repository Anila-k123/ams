"""Masking of private data before it is sent to a language model.

What Lisa sends to the model is the question, the recent chat and a block of
case data. Before it leaves the server, people's names and personal
identifiers in that text are replaced with stable tokens:

    Kannan           -> [CLIENT_1]       (every mention, same token)
    Seetharaman      -> [PARTY_1]        (a case party or opposing counsel)
    Priya Nair       -> [PERSON_1]       (firm staff)
    98400 12345      -> [PHONE_1]        plus EMAIL, PAN, GSTIN, AADHAAR, IFSC
    12, Anna Salai   -> [ADDRESS_1]      (a client's stored address)

The map from token to real value stays on the server for this one request;
the model's reply is unmasked (StreamUnmasker) before the user sees it.

Deliberately NOT masked: case numbers, courts, judges, dates, amounts and
statutes. They are public court data or meaningless alone, and the model
needs them to answer ("when is the next hearing", "who owes the most").

Names come from our own records (clients, case parties and counsel, staff)
within the user's scope, so masking is reliable for anyone the firm has
recorded. A name that appears only in free text (a note, a court filing) and
nowhere in the records is NOT caught - that is the known limit.
"""

from __future__ import annotations

import re

from django.db.models import Q

# Identifier patterns. Same shapes as core/validators.py, but unanchored, to
# FIND values inside text rather than check one whole field.
_ID_PATTERNS = [
    ('EMAIL', re.compile(r'[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}')),
    ('GSTIN', re.compile(r'\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b')),
    ('PAN', re.compile(r'\b[A-Z]{5}[0-9]{4}[A-Z]\b')),
    ('IFSC', re.compile(r'\b[A-Z]{4}0[A-Z0-9]{6}\b')),
    # 12 digits in 4-4-4 (spaces optional). \b keeps a CNR (letters glued to
    # its digits) from matching.
    ('AADHAAR', re.compile(r'\b[2-9][0-9]{3}[ \-]?[0-9]{4}[ \-]?[0-9]{4}\b')),
    # Indian mobile: optional +91 / 0, then 10 digits starting 6-9, with the
    # usual spacing ("98400 12345", "+91-98400-12345").
    ('PHONE', re.compile(r'(?<![\w+])(?:\+?91[ \-]?|0)?[6-9][0-9]{4}[ \-]?[0-9]{5}\b')),
]

# Words in party names that are not anyone's name: masking "State" or "Bank"
# on their own would garble every sentence that uses the word.
_NOT_A_NAME = {
    'the', 'and', 'of', 'for', 'rep', 'by', 'its', 'his', 'her', 'vs', 'versus', 'through',
    'state', 'union', 'india', 'indian', 'tamil', 'nadu', 'government', 'govt', 'district',
    'collector', 'commissioner', 'secretary', 'director', 'officer', 'department', 'bank',
    'limited', 'ltd', 'pvt', 'private', 'company', 'corporation', 'trust', 'society', 'club',
    'board', 'authority', 'municipal', 'council', 'police', 'station', 'inspector', 'chennai',
    'madras', 'court', 'high', 'city', 'civil', 'advocate', 'advocates', 'associates', 'counsel',
    'petitioner', 'respondent', 'appellant', 'plaintiff', 'defendant', 'accused', 'complainant',
    'others', 'another', 'minor', 'son', 'daughter', 'wife', 'husband', 'late', 'shri', 'smt',
    'mrs', 'miss', 'dr', 'senior', 'junior', 'legal', 'heirs', 'branch', 'manager', 'national',
}
_MIN_PART = 4          # shorter name parts ("Raj", initials) are too ambiguous alone

# A name with one of these words is an organisation or an office ("Income Tax
# Officer Ward 15(1)", "HCL Technologies Ltd."). Only its full name is masked:
# its single words ("Income", "Technologies") are ordinary words elsewhere.
_ORGANISATION = {
    'officer', 'office', 'tax', 'income', 'ward', 'bank', 'ltd', 'limited', 'pvt', 'private',
    'llp', 'inc', 'company', 'co', 'corporation', 'government', 'govt', 'state', 'union',
    'department', 'commissioner', 'collector', 'board', 'authority', 'municipal', 'council',
    'police', 'trust', 'society', 'club', 'registrar', 'tribunal', 'court', 'technologies',
    'industries', 'enterprises', 'services', 'solutions', 'traders', 'associates', 'agencies',
    'hospital', 'school', 'college', 'university', 'insurance', 'finance', 'housing',
    'secretary', 'director', 'manager', 'branch', 'india', 'national', 'district',
}


def _norm(s):
    return ' '.join((s or '').split()).lower()


def _name_parts(name):
    """Distinctive single words of a person's name, e.g. 'K.RATHINAVEL' ->
    ['RATHINAVEL'], so a mention by surname alone is masked too. None for an
    organisation (see _ORGANISATION)."""
    parts = re.split(r'[^A-Za-z]+', name or '')
    if any(p.lower() in _ORGANISATION for p in parts):
        return []
    return [p for p in parts if len(p) >= _MIN_PART and p.lower() not in _NOT_A_NAME]


class Masker:
    """Per-request token map. Build with `for_user`, then `mask()` every piece
    of text bound for the model and `unmask()` (or StreamUnmasker) the reply."""

    def __init__(self):
        self._token_of = {}        # normalised value -> token
        self._value_of = {}        # token -> real value as first seen
        self._counts = {}          # kind -> n
        self._names = []           # (surface, kind) registered names
        self._pattern = None
        self.masked = {}           # kind -> number of replacements made

    # --- vocabulary ------------------------------------------------------
    def add(self, value, kind):
        """Register a known name/address. Its distinctive parts are added too,
        mapping to the SAME token, so 'Murugan' and 'R. Murugan' agree."""
        value = ' '.join((value or '').split())
        if len(value) < 3:
            return
        token = self._token(value, kind)
        self._names.append((value, token))
        if kind in ('CLIENT', 'PARTY', 'PERSON'):
            for part in _name_parts(value):
                if _norm(part) not in self._token_of:
                    self._token_of[_norm(part)] = token
                    self._names.append((part, token))
        self._pattern = None

    def _token(self, value, kind):
        key = _norm(value)
        if key in self._token_of:
            return self._token_of[key]
        n = self._counts.get(kind, 0) + 1
        self._counts[kind] = n
        token = '[{}_{}]'.format(kind, n)
        self._token_of[key] = token
        self._value_of[token] = value
        return token

    @classmethod
    def for_user(cls, advocate_id):
        """A masker knowing every name the user's scope can reach."""
        from core.models import Advocate, Client
        from clients.models import ClientProfile
        from workspace.models import CaseParty
        from . import tools

        m = cls()
        scope = tools._scope(advocate_id)
        clients = list(Client.objects.filter(advocate_id__in=scope)
                       .values_list('id', 'name', 'address'))
        for _cid, name, address in clients:
            m.add(name, 'CLIENT')
            if address:
                m.add(address, 'ADDRESS')
        for building, street in (ClientProfile.objects
                                 .filter(client_id__in=[c[0] for c in clients])
                                 .values_list('building', 'street')):
            for v in (building, street):
                if v and len(v) >= 6:
                    m.add(v, 'ADDRESS')
        for name, counsel in (CaseParty.objects.filter(advocate_id__in=scope)
                              .values_list('name', 'counsel')):
            m.add(name, 'PARTY')
            if counsel:
                m.add(counsel, 'PARTY')
        for name, in Advocate.objects.filter(Q(id__in=scope)).values_list('full_name'):
            m.add(name, 'PERSON')
        return m

    # --- masking ---------------------------------------------------------
    def _names_re(self):
        if self._pattern is None:
            # Longest first, so 'R. Murugan' wins over its part 'Murugan'.
            surfaces = sorted({s for s, _ in self._names}, key=len, reverse=True)
            if not surfaces:
                self._pattern = False
            else:
                alt = '|'.join(re.escape(s).replace(r'\ ', r'\s+') for s in surfaces)
                # Not inside a word, number or case number ('TEST/61/2026'
                # must stay a case number even if someone is called Test).
                self._pattern = re.compile(r'(?<![A-Za-z0-9/])(?:' + alt + r')(?![A-Za-z0-9/])', re.I)
        return self._pattern

    def mask(self, text):
        if not text:
            return text
        for kind, pat in _ID_PATTERNS:
            text = pat.sub(lambda mo, k=kind: self._sub(mo.group(0), k), text)
        pat = self._names_re()
        if pat:
            text = pat.sub(self._sub_name, text)
        return text

    def _sub(self, value, kind):
        self.masked[kind] = self.masked.get(kind, 0) + 1
        return self._token(value, kind)

    def _sub_name(self, mo):
        token = self._token_of.get(_norm(mo.group(0)))
        if token is None:                        # whitespace variant of a known name
            return mo.group(0)
        kind = token[1:token.rindex('_')]
        self.masked[kind] = self.masked.get(kind, 0) + 1
        return token

    # --- unmasking -------------------------------------------------------
    _TOKEN_RE = re.compile(r'\[([A-Z]+)_(\d+)\]')

    def unmask(self, text):
        """Put the real values back. A token the model made up (not in the
        map) is left as written rather than guessed."""
        if not text:
            return text
        return self._TOKEN_RE.sub(lambda mo: self._value_of.get(mo.group(0), mo.group(0)), text)

    def summary(self):
        """{kind: count} of what was masked - for the audit log, never values."""
        return dict(self.masked)


class StreamUnmasker:
    """Unmasks a reply that arrives in pieces. A token can be split across
    pieces ('[CLI' + 'ENT_1]'), so text from an unclosed '[' is held back
    until it closes (or is clearly not a token)."""

    _MAX_TOKEN = 20

    def __init__(self, masker):
        self.masker = masker
        self._buf = ''

    def feed(self, piece):
        self._buf += piece or ''
        cut = self._buf.rfind('[')
        if cut != -1 and ']' not in self._buf[cut:] and len(self._buf) - cut <= self._MAX_TOKEN:
            ready, self._buf = self._buf[:cut], self._buf[cut:]
        else:
            ready, self._buf = self._buf, ''
        return self.masker.unmask(ready)

    def flush(self):
        out, self._buf = self.masker.unmask(self._buf), ''
        return out
