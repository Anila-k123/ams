"""The pre-built context brief: Lisa's data when the model can't call tools
(a local model), or as the fallback when a tool-calling request fails.

The question's case(s) are found by keyword, and a permission-filtered bundle
of the user's data is put into the prompt as JSON.
"""

import datetime
import json
import re

from . import search, tools

_MAX_CASES_IN_CONTEXT = 2

# Words that name the kind of question, not a case or client (shared with search.py).
_STOPWORDS = search.STOPWORDS

# A question that points back at the last answer. With one of these and no
# case number in the question, the remembered case beats a stray keyword hit.
_REFERS_BACK = re.compile(
    r"\b(it|its|it's|this|that|these|those|he|him|his|she|her|they|them|their|same)\b", re.I)


def _refers_back(question):
    has_number = any(ch.isdigit() for ch in question or '')
    return bool(_REFERS_BACK.search(question or '')) and not has_number


# --- context building (replaces the tool-use loop for the local model) ----

def _candidate_case_ids(advocate_id, question):
    """Resolve which case(s) the question is about: one ranked search
    (assistant/search.py) over the whole question.

    Returns (caseIds, total_matched) — caseIds capped at _MAX_CASES_IN_CONTEXT
    but total_matched counting EVERY keyword hit, so build_context can tell the
    model the set it's seeing is partial instead of letting a 1-of-17 answer
    look complete.
    """
    found = tools.find_case(advocate_id, question, limit=_MAX_CASES_IN_CONTEXT)
    return [c['caseId'] for c in found['cases']], found['total']


# A question naming a court level or case status is asking about the caseload,
# not about whichever case happens to share a word with it — resolve those to a
# real filtered query. Values match the case table's own (verified: court_level
# is 'High Court'/'District'/'Supreme Court'; status is
# 'Active'/'Closed'/'Pending'/'Dismissed').
_COURT_LEVEL_HINTS = (
    ('supreme', 'Supreme Court'),
    ('high court', 'High Court'),
    ('district', 'District'),
)
_STATUS_HINTS = (
    ('active', 'Active'),
    ('closed', 'Closed'),
    ('disposed', 'Closed'),
    ('pending', 'Pending'),
    ('dismissed', 'Dismissed'),
)


def _filter_from_question(question):
    """(court_level, status) named in the question, or (None, None)."""
    q = (question or '').lower()
    court = next((v for k, v in _COURT_LEVEL_HINTS if k in q), None)
    status = next((v for k, v in _STATUS_HINTS if k in q), None)
    return court, status


def _resolve_client(advocate_id, question):
    """The client a question names ("what are the cases of client Anila"), or
    None. One query for all the question's words; the client whose name holds
    the most of them wins. find_case also matches client names, but a
    client-scoped question needs ALL that client's cases, not two."""
    from core.models import Client
    from django.db.models import Q
    words = [t.lower() for t in re.findall(r"[A-Za-z]{3,}", question or '') if t.lower() not in _STOPWORDS]
    if not words:
        return None
    match = Q()
    for w in words:
        match |= Q(name__icontains=w)
    rows = list(Client.objects.filter(match, advocate_id__in=tools._scope(advocate_id), deleted=False)[:20])
    if not rows:
        return None
    best = max(rows, key=lambda c: (sum(1 for w in words if w in (c.name or '').lower()), -len(c.name or '')))
    return {'clientId': best.id, 'name': best.name, 'email': best.email, 'phone': best.phone}


# Conversation memory is sent by the browser, so it is untrusted input: only
# these roles, and capped so a long chat can't crowd the context data out of
# the prompt (or run up the token bill).
_HISTORY_ROLES = {'user', 'assistant'}
_HISTORY_MAX_TURNS = 8
_HISTORY_MAX_CHARS = 1500
_HISTORY_TOTAL_CHARS = 8000
_MAX_FOCUS_IDS = 5


def clean_history(raw):
    """[{role, text}] from the request -> chat messages, newest turns kept."""
    if not isinstance(raw, list):
        return []
    turns = []
    for m in raw[-_HISTORY_MAX_TURNS:]:
        if not isinstance(m, dict) or m.get('role') not in _HISTORY_ROLES:
            continue
        text = str(m.get('text') or m.get('content') or '').strip()
        if text:
            turns.append({'role': m['role'], 'content': text[:_HISTORY_MAX_CHARS]})
    # Drop from the oldest end until the whole history fits.
    while turns and sum(len(t['content']) for t in turns) > _HISTORY_TOTAL_CHARS:
        turns.pop(0)
    return turns


def clean_focus_ids(raw):
    """Case ids the previous answer was about, as ints. Ownership is checked
    later by the tools (_owned_case), so a forged id just finds nothing."""
    if not isinstance(raw, list):
        return []
    ids = []
    for v in raw[:_MAX_FOCUS_IDS]:
        try:
            ids.append(int(v))
        except (TypeError, ValueError):
            continue
    return ids


def build_context(advocate_id, question, focus_case_ids=None, history=None):
    """Assemble a compact, grounded data brief for the prompt (read-only, own cases).

    A follow-up ("when is its next hearing?") names no case, so when the
    question itself matches nothing, fall back to the case(s) the previous
    answer was about, then to whatever the last user turn matched."""
    # The model has no clock; without today it can't tell an upcoming date
    # from a stale one (court "next dates" are often long past).
    can = lambda *codes: tools.allowed(advocate_id, *codes)          # noqa: E731
    me = tools._user(advocate_id)
    ctx = {'today': datetime.date.today().isoformat(),
           # Who is asking: "I", "me", "my" in the question mean this person.
           'me': {'name': getattr(me, 'full_name', None),
                  'roles': me.role_names() if me else [],
                  # The brief is text for the model; the button is for the tool path.
                  'myOpenTasks': {k: v for k, v in tools.my_tasks(advocate_id).items() if k != '_link'}},
           'dashboard': tools.dashboard_summary(advocate_id),
           # Small, always-useful cross-caseload facts: what's past its
           # deadline anywhere, and who the biggest clients are. Both are
           # capped and report their true totals.
           'overdueTasks': tools.overdue_tasks(advocate_id)}
    # Each block only when the user's role may see it - the same permission
    # the app's own page for that data requires. What's withheld is named in
    # notPermitted so Lisa can say "you don't have access" instead of "none".
    withheld = []
    if can(tools.CASES):
        # Exact whole-caseload counts: "how many High Court cases" is answered
        # from a real aggregate, not from whichever cases keyword-matched.
        ctx['caseloadBreakdown'] = tools.caseload_breakdown(advocate_id)
    else:
        withheld.append('cases')
    if can(tools.EVENTS):
        ctx['upcomingHearings'] = tools.list_upcoming_hearings(advocate_id, 14).get('hearings', [])
    else:
        withheld.append('hearings')
    if can(tools.INVOICES):
        ctx['pendingInvoices'] = tools.pending_invoices(advocate_id)
    else:
        withheld.append('invoices and dues')
    if can(tools.EXPENSES):
        ctx['expenses'] = tools.expense_summary(advocate_id)
    else:
        withheld.append('expenses')
    if can(tools.PAYMENTS):
        ctx['income'] = tools.income_summary(advocate_id)
    else:
        withheld.append('payments received / income')
    if can(tools.CLIENTS):
        ctx['clientsByCaseCount'] = tools.clients_by_case_count(advocate_id)
    else:
        withheld.append('client details')
    if not can(tools.DOCUMENTS):
        withheld.append('documents')
    ctx['notPermitted'] = withheld

    if not can(tools.CASES):
        return ctx
    case_ids, total_matched = _candidate_case_ids(advocate_id, question)
    if focus_case_ids and _refers_back(question):
        case_ids, total_matched = [], 0
    if not case_ids and focus_case_ids:
        case_ids = list(focus_case_ids)[:_MAX_CASES_IN_CONTEXT]
        total_matched = len(case_ids)
    if not case_ids and history:
        last_user = next((t['content'] for t in reversed(history) if t['role'] == 'user'), '')
        if last_user:
            case_ids, total_matched = _candidate_case_ids(advocate_id, last_user)
    cases = []
    for cid in case_ids:
        summary = tools.get_case_summary(advocate_id, cid)
        if summary.get('error'):
            continue
        detail = {
            'summary': summary,
            'courtRecord': tools.get_court_record(advocate_id, cid),
            'parties': tools.get_parties(advocate_id, cid).get('parties', []),
            'tasks': tools.get_tasks(advocate_id, cid).get('tasks', []),
            'notes': tools.get_notes(advocate_id, cid).get('notes', []),
        }
        if can(tools.EVENTS):
            detail['hearings'] = tools.get_hearings(advocate_id, cid)
        if can(tools.INVOICES):
            detail['financials'] = tools.get_case_financials(advocate_id, cid)
        if can(tools.DOCUMENTS):
            detail['documents'] = tools.list_documents(advocate_id, cid)
        cases.append(detail)
    # Report the cap explicitly. Without this the model sees N detailed cases
    # with no hint that more matched, and presents them as the complete answer
    # (a 1-of-17 "here are your High Court cases" is worse than no answer).
    ctx['matchedCases'] = {
        'note': ('Keyword matches for this question, with full detail. NOT a complete '
                 'caseload list — use caseloadBreakdown/filteredCases for totals.'),
        'totalMatched': total_matched,
        'shown': len(cases),
        'truncated': total_matched > len(cases),
        'cases': cases,
    }

    # A question naming a court level or status is about the caseload as a
    # whole, so answer it from a real filtered query (with its true total)
    # rather than from keyword matches.
    court_level, case_status = _filter_from_question(question)
    if court_level or case_status:
        ctx['filteredCases'] = {
            'filter': {'courtLevel': court_level, 'status': case_status},
            **tools.list_cases(advocate_id, court_level=court_level, status=case_status),
        }

    # A question scoped to a client ("what are the cases of client Anila")
    # won't hit anything via _candidate_case_ids (find_case has no
    # client-name search), so resolve one separately and give the model
    # ALL of that client's cases as light rows - not capped/detail-fetched
    # like matchedCases, since this is meant to answer "list them", not
    # "summarise this one case".
    client = _resolve_client(advocate_id, question) if can(tools.CLIENTS) else None
    if client:
        ctx['matchedClient'] = client
        ctx['matchedClientCases'] = tools.list_cases_for_client(advocate_id, client['clientId']).get('cases', [])
        if can(tools.INVOICES):
            ctx['matchedClientFinancials'] = tools.client_financials(advocate_id, client['clientId'])
    return ctx


def _user_message(question, ctx):
    return (f"Question: {question}\n\n"
            f"CONTEXT DATA (the only source of truth — do not go beyond it):\n"
            f"```json\n{json.dumps(ctx, ensure_ascii=False, default=str, indent=1)}\n```")


def context_case_ids(ctx):
    """Ids of the cases actually put in front of the model (all ownership-checked)."""
    return [c['summary']['caseId'] for c in ctx.get('matchedCases', {}).get('cases', [])]
