"""Finding the case(s) a question is about, in ONE ranked database query.

This replaced a search that ran a separate `ILIKE '%word%'` query for every
word of the question and counted hits in Python: it picked unrelated cases
whose title merely contained "before" or "payment", missed typos, and cost a
query per word.

One query now scores every case in the user's scope by:

  number    a case number in the question ("900/2025", "O.S. No. 900/2025")
            matching the case number or the registration number kept in the
            description, on number boundaries (900/2025 is not 1900/2025)  +10
  words     PostgreSQL full-text search (English stems, so "payments" finds
            "payment") over title, client, case type and description, any of
            the words, ranked                                                +rank
  party     a word matching a party's or counsel's name on the case         +2
  typo      trigram word similarity (pg_trgm) of a word to the title or
            client name: "Seetharman" still finds "Seetharaman"             +similarity

and keeps cases with a number match, a word match, a party match, or a close
typo match. pg_trgm is optional: without it the typo part is skipped.
"""

from __future__ import annotations

import logging
import re

from django.contrib.postgres.search import SearchQuery, SearchRank, SearchVector
from django.db import connection, transaction
from django.db.models import Case as CaseWhen, Exists, F, FloatField, OuterRef, Q, Value, When
from django.db.models.functions import Coalesce, Greatest

from core.models import Case

log = logging.getLogger(__name__)

# Words that say what KIND of question it is, not which case. Ordinary English
# stop words ("the", "before", "about") are dropped by full-text search itself.
STOPWORDS = {
    'the', 'and', 'for', 'with', 'what', 'whats', 'show', 'tell', 'give', 'about', 'case',
    'cases', 'client', 'clients', 'hearing', 'hearings', 'follow', 'followup', 'follow-up',
    'summary', 'summarise', 'summarize', 'details', 'detail', 'need', 'needs', 'this', 'that',
    'have', 'any', 'all', 'from', 'please', 'next', 'upcoming', 'status', 'pending', 'due',
    'dues', 'its', 'his', 'her', 'him', 'she', 'they', 'them', 'their', 'these', 'those',
    'same', 'who', 'whom', 'whose', 'when', 'where', 'which', 'why', 'how', 'did', 'does',
    'was', 'were', 'are', 'has', 'had', 'can', 'will', 'there', 'then', 'also', 'judge',
    'matter', 'matters', 'anything', 'something', 'worry', 'should', 'would', 'could',
    'today', 'tomorrow', 'week', 'month', 'year', 'list', 'find', 'search', 'open', 'latest',
}
# PostgreSQL's English stop words (full-text search ignores them, but the typo
# matcher would not: "before" in a question must not match "...before the
# Tahsildar" in a title), plus days and months, which name a time, not a case.
STOPWORDS |= {
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are',
    'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but',
    'by', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from',
    'further', 'had', 'has', 'have', 'having', 'here', 'hers', 'herself', 'himself', 'into',
    'just', 'more', 'most', 'mine', 'myself', 'nor', 'not', 'now', 'off', 'once', 'only', 'other',
    'our', 'ours', 'ourselves', 'out', 'over', 'own', 'some', 'such', 'than', 'theirs',
    'themselves', 'through', 'too', 'under', 'until', 'very', 'what', 'while', 'with', 'you',
    'your', 'yours', 'yourself', 'yourselves', 'owes', 'owe', 'behind', 'still', 'get', 'got',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
    'october', 'november', 'december',
    # Generic legal-work words: in nearly every case, so they identify none.
    'suit', 'date', 'dates', 'time', 'happening', 'going', 'involved', 'order', 'orders',
    'listed', 'listing', 'stage', 'file', 'filed', 'counsel', 'advocate', 'lawyer', 'party',
    'parties', 'court', 'number', 'records', 'record',
}

_NUMBER_RE = re.compile(r'\d+(?:\s*/\s*\d+)*')
_WORD_RE = re.compile(r"[A-Za-z][A-Za-z'\-]{2,}")
# 0.5: a one-letter slip in a name, even where the title glues words together
# ('Kannan VsSeetharaman'). Stop words never reach the typo matcher.
_MIN_TYPO_SIMILARITY = 0.5
_SCORE = {'number': 10.0, 'party': 2.0}


_TRIGRAM = None


def _trigram_available():
    """Whether pg_trgm is installed - checked once per process (extensions
    don't come and go while the app runs)."""
    global _TRIGRAM
    if _TRIGRAM is None:
        try:
            with connection.cursor() as cur:
                cur.execute("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'")
                _TRIGRAM = cur.fetchone() is not None
        except Exception:                                    # noqa: BLE001
            return False
    return _TRIGRAM


def parse(text):
    """(number patterns, words) from free text."""
    text = text or ''
    numbers = []
    for raw in _NUMBER_RE.findall(text):
        compact = re.sub(r'\s+', '', raw)
        # A bare year ("2025") names no case, it'd match every case of that year.
        if '/' not in compact and (len(compact) < 2 or (len(compact) == 4 and 1900 <= int(compact) <= 2100)):
            continue
        numbers.append(compact)
    words = []
    for w in _WORD_RE.findall(text):
        w = w.strip("'-").lower()
        if len(w) >= 3 and w not in STOPWORDS and w not in words:
            words.append(w)
    return numbers, words


def _number_q(numbers):
    """Case number or description containing one of the numbers, on number
    boundaries; '/' may have spaces around it ('AS /700/2025')."""
    q = Q()
    for n in numbers:
        body = r'\s*/\s*'.join(re.escape(part) for part in n.split('/'))
        pattern = r'(^|[^0-9])' + body + r'($|[^0-9])'
        q |= Q(case_number__iregex=pattern) | Q(description__iregex=pattern)
    return q


def search_cases(scope_ids, text, limit=10):
    """Cases in `scope_ids` that `text` is about, best first.

    Returns {'total': n, 'cases': [{caseId, caseNumber, caseTitle, status,
    client, score, matchedOn}]} - `total` counts every match, not just the
    `limit` returned."""
    from workspace.models import CaseParty

    numbers, words = parse(text)
    if not numbers and not words:
        return {'total': 0, 'cases': []}

    qs = Case.objects.select_related('client').filter(advocate_id__in=scope_ids, deleted=False)
    keep = Q()
    score = Value(0.0, output_field=FloatField())

    if numbers:
        num_q = _number_q(numbers)
        qs = qs.annotate(_num=CaseWhen(When(num_q, then=Value(_SCORE['number'])),
                                    default=Value(0.0), output_field=FloatField()))
        keep |= Q(_num__gt=0)
        score = score + F('_num')

    if words:
        # Any of the words (OR), each stemmed by the English dictionary.
        query = None
        for w in words:
            part = SearchQuery(w, config='english', search_type='plain')
            query = part if query is None else query | part
        vector = (SearchVector('case_title', weight='A', config='english')
                  + SearchVector('client__name', weight='A', config='english')
                  + SearchVector('case_type', weight='C', config='english')
                  + SearchVector('description', weight='B', config='english'))
        qs = qs.annotate(_rank=SearchRank(vector, query))
        keep |= Q(_rank__gt=0)
        score = score + Coalesce(F('_rank'), Value(0.0)) * Value(5.0)

        party_q = Q()
        for w in words:
            party_q |= Q(name__icontains=w) | Q(counsel__icontains=w)
        parties = CaseParty.objects.filter(party_q, case_id=OuterRef('id'), advocate_id__in=scope_ids)
        qs = qs.annotate(_party=CaseWhen(When(Exists(parties), then=Value(_SCORE['party'])),
                                      default=Value(0.0), output_field=FloatField()))
        keep |= Q(_party__gt=0)
        score = score + F('_party')

        if _trigram_available():
            from django.contrib.postgres.search import TrigramWordSimilarity
            sims = []
            for w in words[:6]:
                sims.append(TrigramWordSimilarity(Value(w), 'case_title'))
                sims.append(TrigramWordSimilarity(Value(w), Coalesce('client__name', Value(''))))
            sim = Greatest(*sims) if len(sims) > 1 else sims[0]
            qs = qs.annotate(_sim=sim)
            keep |= Q(_sim__gte=_MIN_TYPO_SIMILARITY)
            score = score + CaseWhen(When(_sim__gte=_MIN_TYPO_SIMILARITY, then=F('_sim')),
                                  default=Value(0.0), output_field=FloatField())

    # A question naming a case number is about THAT case: if no case has the
    # number, words must not substitute some other case for it.
    qs = qs.filter(Q(_num__gt=0) if numbers else keep)
    qs = qs.annotate(_score=score).order_by('-_score', '-created_at', '-id')
    try:
        # A savepoint, so a failed query doesn't poison the caller's transaction.
        with transaction.atomic():
            total = qs.count()
            rows = list(qs[:limit])
    except Exception:                                        # noqa: BLE001
        # Never let search break Lisa: fall back to a plain number/title match.
        log.warning('assistant search: ranked query failed', exc_info=True)
        plain = _number_q(numbers) if numbers else Q()
        for w in words:
            plain |= Q(case_title__icontains=w) | Q(client__name__icontains=w)
        base = Case.objects.select_related('client').filter(advocate_id__in=scope_ids, deleted=False).filter(plain)
        total = base.count()
        return {'total': total, 'cases': [_row(c, None) for c in base.order_by('-created_at')[:limit]]}
    return {'total': total, 'cases': [_row(c, c) for c in rows]}


def _row(c, scored):
    matched = []
    if scored is not None:
        if getattr(scored, '_num', 0):
            matched.append('number')
        if getattr(scored, '_rank', 0):
            matched.append('words')
        if getattr(scored, '_party', 0):
            matched.append('party')
        if (getattr(scored, '_sim', 0) or 0) >= _MIN_TYPO_SIMILARITY:
            matched.append('similar spelling')
    return {
        'caseId': c.id, 'caseNumber': c.case_number, 'caseTitle': c.case_title, 'status': c.status,
        'client': c.client.name if c.client_id and c.client else None,
        'score': round(float(getattr(scored, '_score', 0) or 0), 3) if scored is not None else None,
        'matchedOn': matched,
    }
