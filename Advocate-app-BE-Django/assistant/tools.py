"""Read-only tools the AI assistant may call to answer questions about the
advocate's data. Every function is scoped via `_scope(advocate_id)` to the user's
team (the whole firm for Super Admin / Accountant) - the same visibility as the
Cases list - and checked against their role's permissions. Nothing here writes.

Each tool returns plain JSON-serializable data. `tools_for(advocate_id)` is the
OpenAI-style tool list this user may use; `run_tool(name, args, advocate_id)`
dispatches it and enforces permission and ownership.
"""

import contextlib
import contextvars
import datetime

from django.db.models import Count, Q, Sum

from core.models import Case, Client, CaseEvent, Document, Expense, Invoice, ClientPayment, Advocate
from core.practice import practice_ids
from workspace.models import CaseNote, CaseTag, CaseTask

# Who the assistant is answering for, set once per request (acting_as). Tools
# take an advocate id, but scope and permissions come from this user object so
# they're resolved once per request - and never from a process-wide cache,
# which kept serving the old team after a team change until a restart.
_ACTING = contextvars.ContextVar('assistant_acting_user', default=None)


@contextlib.contextmanager
def acting_as(user):
    token = _ACTING.set(user)
    try:
        yield user
    finally:
        _ACTING.reset(token)


def _user(advocate_id):
    u = _ACTING.get()
    if u is not None and getattr(u, 'id', None) == advocate_id:
        return u
    return Advocate.objects.filter(id=advocate_id).first()


def permissions(advocate_id):
    """The user's permission codes, resolved once per user object."""
    u = _user(advocate_id)
    if u is None:
        return set()
    cached = getattr(u, '_assistant_perms', None)
    if cached is None:
        try:
            cached = set(u.permission_codes())
        except Exception:                                    # noqa: BLE001
            cached = set()
        try:
            u._assistant_perms = cached
        except Exception:                                    # noqa: BLE001
            pass
    return cached


def allowed(advocate_id, *codes):
    """True when the user holds ANY of these codes - the same OR rule as
    RequirePermission. Lisa must never show what the user's own pages would
    refuse them (an intern asking "who owes us money?")."""
    have = permissions(advocate_id)
    return any(c in have for c in codes)


# The permission each kind of data needs, matching the API's own gates.
CASES, EVENTS, DOCUMENTS, CLIENTS = 'CASE_VIEW', 'EVENT_VIEW', 'DOCUMENT_VIEW', 'CLIENT_VIEW'
INVOICES, PAYMENTS, EXPENSES = 'INVOICE_VIEW', 'PAYMENT_VIEW', 'EXPENSE_VIEW'


def _iso(d):
    return d.isoformat() if d else ""


def _scope(advocate_id):
    """Advocate ids this user may reach: their team (or, for firm-wide staff,
    the whole firm), the same visibility as the Cases list. practice_ids()
    caches on the user object, so within a request this is one lookup, and a
    team change shows up on the next request."""
    adv = _user(advocate_id)
    return practice_ids(adv) if adv else [advocate_id]


def _tasks(advocate_id):
    """Tasks this user may see - the same rule as the Tasks page (workspace.access)."""
    from workspace.access import visible_tasks
    adv = Advocate.objects.filter(id=advocate_id).first()
    if adv is None:
        return CaseTask.objects.none()
    return visible_tasks(adv)


def _owned_case(advocate_id, case_id):
    """Return the case if it's in this user's practice (and isn't archived), else None."""
    try:
        cid = int(case_id)
    except (TypeError, ValueError):
        return None
    return Case.objects.filter(id=cid, advocate_id__in=_scope(advocate_id), deleted=False).select_related('client').first()


# --- tool implementations -------------------------------------------------

def find_case(advocate_id, query, limit=10):
    """Cases the text is about, best match first: one ranked query over case
    number, registration number, title, client, parties, with typo tolerance
    (assistant/search.py). `total` counts every match."""
    from .search import search_cases
    q = (query or '').strip()
    # A CNR is one 16-character token: match it exactly as typed.
    if len(q) == 16 and q[:4].isalpha() and q[4:].isdigit():
        qs = Case.objects.select_related('client').filter(
            advocate_id__in=_scope(advocate_id), deleted=False, case_number__iexact=q)
        rows = [{'caseId': c.id, 'caseNumber': c.case_number, 'caseTitle': c.case_title,
                 'status': c.status, 'client': c.client.name if c.client_id and c.client else None,
                 'matchedOn': ['number']} for c in qs[:limit]]
        if rows:
            return {'total': len(rows), 'cases': rows}
    found = search_cases(_scope(advocate_id), q, limit=limit)
    for row in found['cases']:
        row.pop('score', None)
    return found


def find_client(advocate_id, query):
    """Search clients by name/email/phone - mirrors the assistant router's
    own _search_clients() and the Client Directory's own search."""
    q = (query or '').strip()
    qs = Client.objects.filter(advocate_id__in=_scope(advocate_id), deleted=False).filter(
        Q(name__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q)
    )[:5]
    return {'clients': [{
        'clientId': c.id, 'name': c.name, 'email': c.email, 'phone': c.phone,
    } for c in qs]}


def list_cases_for_client(advocate_id, client_id):
    """All of one client's cases as light rows (not full detail) - grounds a
    "what are the cases of client X" style question without the per-case
    detail-fetching cost get_case_summary()/etc. carry."""
    qs = Case.objects.filter(advocate_id__in=_scope(advocate_id), client_id=client_id, deleted=False).order_by('-created_at')[:20]
    return {'cases': [{
        'caseId': c.id, 'caseNumber': c.case_number, 'caseTitle': c.case_title, 'status': c.status,
    } for c in qs]}


# Cap on rows returned by list_cases(). A "list/which/how many" question needs
# breadth, but the whole caseload could be thousands of rows - so the cap is
# generous and, critically, ALWAYS reported alongside the true total so the
# caller can say "17 total, showing 50" instead of implying it saw everything.
CASE_LIST_LIMIT = 50


def caseload_breakdown(advocate_id):
    """Exact counts across the WHOLE caseload, grouped by status and by court
    level. Cheap (two GROUP BYs) and always complete, so "how many High Court
    cases do I have" is answered from a real aggregate rather than from
    whichever cases happened to keyword-match the question."""
    base = Case.objects.filter(advocate_id__in=_scope(advocate_id), deleted=False)
    by_status, by_court = {}, {}
    for row in base.values('status').annotate(n=Count('id')):
        by_status[(row['status'] or 'Unspecified')] = row['n']
    for row in base.values('court_level').annotate(n=Count('id')):
        by_court[(row['court_level'] or 'Unspecified')] = row['n']
    return {'totalCases': base.count(), 'byStatus': by_status, 'byCourtLevel': by_court}


def list_cases(advocate_id, court_level=None, status=None, client_id=None,
               limit=CASE_LIST_LIMIT):
    """Light case rows for a real filter over the whole caseload.

    Returns {total, returned, truncated, cases:[...]} - `total` is the true
    match count BEFORE the limit, so a truncated list can never be mistaken
    for a complete one.
    """
    qs = Case.objects.select_related('client').filter(advocate_id__in=_scope(advocate_id), deleted=False)
    if court_level:
        qs = qs.filter(court_level__icontains=court_level)
    if status:
        qs = qs.filter(status__iexact=status)
    if client_id:
        qs = qs.filter(client_id=client_id)
    total = qs.count()
    rows = qs.order_by('-created_at')[:limit]
    return {
        'total': total,
        'returned': min(total, limit),
        'truncated': total > limit,
        'cases': [{
            'caseId': c.id, 'caseNumber': c.case_number, 'caseTitle': c.case_title,
            'status': c.status, 'courtLevel': c.court_level,
            'client': c.client.name if c.client_id and c.client else None,
        } for c in rows],
    }


def _due_words(deadline, today):
    """A deadline in words, worked out here so the model never has to do date
    arithmetic: "today", "tomorrow", "in 3 days", "overdue by 2 days", or None.
    A model given only "2026-10-07" called it "due today"."""
    if not deadline:
        return None
    days = (deadline - today).days
    if days == 0:
        return 'today'
    if days == 1:
        return 'tomorrow'
    if days > 1:
        return 'in {} days'.format(days)
    return 'overdue by {} day{}'.format(-days, '' if days == -1 else 's')


def _iso_day(value, default=None):
    try:
        return datetime.date.fromisoformat(str(value)[:10]) if value else default
    except ValueError:
        return default


def overdue_tasks(advocate_id, limit=30):
    """Open tasks whose deadline has passed, across EVERY case (not one case),
    newest deadline last. Case numbers are resolved in one extra query so the
    rows are readable without a join per task."""
    today = datetime.date.today()
    qs = _tasks(advocate_id).filter(
        completed=False, deadline__lt=today
    ).exclude(deadline=None).order_by('deadline')
    total = qs.count()
    rows = list(qs[:limit])
    numbers = dict(Case.objects.filter(
        advocate_id__in=_scope(advocate_id), id__in=[t.case_id for t in rows if t.case_id]
    ).values_list('id', 'case_number'))
    return {
        'total': total,
        'returned': len(rows),
        'truncated': total > len(rows),
        'tasks': [{
            'taskId': t.id, 'title': t.title, 'priority': t.priority,
            'deadline': _iso(t.deadline),
            'daysOverdue': (today - t.deadline).days if t.deadline else None,
            'due': _due_words(t.deadline, today),
            'caseNumber': numbers.get(t.case_id),
        } for t in rows],
    }


def my_tasks(advocate_id, limit=20, from_date=None, to_date=None):
    """Open tasks assigned to THIS user (a task with no assignee is its
    creator's), soonest deadline first - what "my tasks" / "anything I should
    worry about" means.

    With from_date / to_date (inclusive) only tasks whose deadline falls in
    that range are returned - "due today" is from_date = to_date = today. An
    empty list then means none are due then, and the answer must say so
    rather than offer the next one as if it were due."""
    today = datetime.date.today()
    mine = (_tasks(advocate_id).filter(completed=False, cancelled=False)
            .filter(Q(assigned_to_id=advocate_id) | Q(assigned_to_id__isnull=True, advocate_id=advocate_id)))
    qs = mine.order_by('deadline', 'id')
    start, end = _iso_day(from_date), _iso_day(to_date)
    if start and end and end < start:
        start, end = end, start
    if start:
        qs = qs.filter(deadline__gte=start)
    if end:
        qs = qs.filter(deadline__lte=end)
    total = qs.count()
    rows = list(qs[:limit])
    # Nothing due in the asked range: the next ones after it, so the answer can
    # be "none today - next is X, due in 2 days" instead of a bare "none".
    upcoming = []
    if (start or end) and total == 0:
        after = end or start
        upcoming = list(mine.filter(deadline__gt=after).order_by('deadline', 'id')[:3])
    numbers = dict(Case.objects.filter(
        advocate_id__in=_scope(advocate_id),
        id__in=[t.case_id for t in rows + upcoming if t.case_id]
    ).values_list('id', 'case_number'))

    def row(t):
        return {
            'taskId': t.id, 'title': t.title, 'priority': t.priority,
            'deadline': _iso(t.deadline),
            'due': _due_words(t.deadline, today),
            'overdue': bool(t.deadline and t.deadline < today),
            'review': t.review_status,
            'caseNumber': numbers.get(t.case_id),
        }
    out = {
        'today': _iso(today),
        'from': _iso(start), 'to': _iso(end),
        'total': total,
        'returned': len(rows),
        'truncated': total > len(rows),
        'tasks': [row(t) for t in rows],
    }
    if start or end:
        out['nextDue'] = [row(t) for t in upcoming]
    if allowed(advocate_id, 'TASK_VIEW'):
        # A button under the reply; the user opens the page when ready.
        out['_link'] = {'route': '/dashboard/tasks', 'label': 'Open Tasks'}
    return out


def client_financials(advocate_id, client_id):
    """Billed / paid / outstanding for ONE client across all their cases —
    the per-client sibling of get_case_financials()."""
    invoices = list(Invoice.objects.billable().filter(advocate_id__in=_scope(advocate_id), client_id=client_id))
    billed = sum((i.amount or 0) for i in invoices)
    unpaid = [i for i in invoices if (i.status or '').upper() != 'PAID']
    # Payments received need PAYMENT_VIEW, on top of the invoices' INVOICE_VIEW.
    paid = (sum((p.amount or 0) for p in
                ClientPayment.objects.filter(advocate_id__in=_scope(advocate_id), client_id=client_id))
            if allowed(advocate_id, PAYMENTS) else None)
    return {
        'totalBilled': billed,
        'totalPaid': paid,
        'outstanding': sum((i.amount or 0) for i in unpaid),
        'invoiceCount': len(invoices),
        'unpaidInvoices': [{
            'invoiceNumber': i.invoice_number, 'amount': i.amount,
            'status': i.status, 'dueDate': _iso(i.due_date),
        } for i in unpaid[:20]],
    }


def list_documents(advocate_id, case_id):
    """Documents filed against one case (name/category/type/date only — never
    file contents)."""
    c = _owned_case(advocate_id, case_id)
    if c is None:
        return {'error': 'Case not found or not accessible.'}
    qs = Document.objects.filter(advocate_id__in=_scope(advocate_id), case_id=c.id).order_by('-upload_date')
    total = qs.count()
    rows = qs[:20]
    return {
        'total': total,
        'returned': min(total, 20),
        'truncated': total > 20,
        'documents': [{
            'name': d.document_name, 'category': d.category,
            'fileType': d.file_type, 'uploadedAt': _iso(d.upload_date),
        } for d in rows],
    }


def pending_invoices(advocate_id, limit=25):
    """Every unsettled invoice with its amount, client and due date.

    dashboard_summary only carries the COUNT, so a question like "what
    invoices are still pending" could otherwise only be answered with a bare
    number. 'Unsettled' is anything not marked PAID — matching how
    dashboard_summary counts them, so the list and the count never disagree.
    """
    today = datetime.date.today()
    qs = (Invoice.objects.select_related('client')
          .open().filter(advocate_id__in=_scope(advocate_id))
          .order_by('due_date'))
    total = qs.count()
    rows = list(qs[:limit])
    return {
        'total': total,
        'returned': len(rows),
        'truncated': total > len(rows),
        'totalOutstanding': sum((i.amount or 0) for i in qs),
        'invoices': [{
            'invoiceNumber': i.invoice_number, 'amount': i.amount, 'status': i.status,
            'dueDate': _iso(i.due_date),
            'daysOverdue': (today - i.due_date).days if i.due_date and i.due_date < today else None,
            'client': i.client.name if i.client_id and i.client else None,
        } for i in rows],
    }


def _month_bounds(today=None):
    """(this_month_start, last_month_start, last_month_end) for `today`."""
    today = today or datetime.date.today()
    this_start = today.replace(day=1)
    last_end = this_start - datetime.timedelta(days=1)
    return this_start, last_end.replace(day=1), last_end


def expense_summary(advocate_id, limit=15):
    """Spend this month and last, a category breakdown, and recent entries.

    Both months are always included so "how much did I spend this month" and
    "what about last month" are answerable without parsing dates out of the
    question.
    """
    today = datetime.date.today()
    this_start, last_start, last_end = _month_bounds(today)
    base = Expense.objects.filter(advocate_id__in=_scope(advocate_id))

    def window(start, end):
        qs = base.filter(payment_date__gte=start, payment_date__lte=end)
        return {'from': _iso(start), 'to': _iso(end),
                'total': sum((e.amount or 0) for e in qs), 'count': qs.count()}

    by_cat = {}
    for r in (base.filter(payment_date__gte=this_start, payment_date__lte=today)
              .values('category').annotate(s=Sum('amount'))):
        by_cat[r['category'] or 'Uncategorised'] = r['s'] or 0
    recent = base.exclude(payment_date=None).order_by('-payment_date')[:limit]
    return {
        'thisMonth': window(this_start, today),
        'lastMonth': window(last_start, last_end),
        'thisMonthByCategory': by_cat,
        'recent': [{
            'title': e.title, 'amount': e.amount, 'category': e.category,
            'date': _iso(e.payment_date), 'status': e.payment_status,
        } for e in recent],
    }


def income_summary(advocate_id, limit=15):
    """Payments actually RECEIVED this month and last, plus recent receipts.

    This is money in the door (ClientPayment) — deliberately distinct from
    what has merely been billed, which pending_invoices() covers.
    """
    today = datetime.date.today()
    this_start, last_start, last_end = _month_bounds(today)
    base = ClientPayment.objects.select_related('client').filter(advocate_id__in=_scope(advocate_id))

    def window(start, end):
        qs = base.filter(payment_date__gte=start, payment_date__lte=end)
        return {'from': _iso(start), 'to': _iso(end),
                'total': sum((p.amount or 0) for p in qs), 'count': qs.count()}

    recent = base.exclude(payment_date=None).order_by('-payment_date')[:limit]
    return {
        'thisMonth': window(this_start, today),
        'lastMonth': window(last_start, last_end),
        'recent': [{
            'amount': p.amount, 'date': _iso(p.payment_date), 'mode': p.payment_mode,
            'client': p.client.name if p.client_id and p.client else None,
        } for p in recent],
    }


def clients_by_case_count(advocate_id, limit=10):
    """Top clients by number of live cases — answers "which client has the
    most cases" from a real aggregate. Capped, with the true client total
    reported so a partial ranking is never mistaken for the whole book."""
    rows = (Case.objects.filter(advocate_id__in=_scope(advocate_id), deleted=False, client_id__isnull=False)
            .values('client_id', 'client__name')
            .annotate(n=Count('id')).order_by('-n')[:limit])
    return {
        'totalClientsWithCases': Case.objects.filter(
            advocate_id__in=_scope(advocate_id), deleted=False, client_id__isnull=False
        ).values('client_id').distinct().count(),
        'topClients': [{
            'clientId': r['client_id'], 'name': r['client__name'], 'caseCount': r['n'],
        } for r in rows],
    }


def get_case_summary(advocate_id, case_id):
    c = _owned_case(advocate_id, case_id)
    if c is None:
        return {'error': 'Case not found or not accessible.'}
    return {
        'caseId': c.id, 'caseNumber': c.case_number, 'caseTitle': c.case_title,
        'caseType': c.case_type, 'courtLevel': c.court_level, 'status': c.status,
        'amount': c.amount, 'description': c.description,
        'client': c.client.name if c.client_id and c.client else None,
        'createdAt': _iso(c.created_at),
    }


def _clean(v):
    """A court-API string, or None when it's a placeholder like '' / '--' / '~~~~'."""
    s = str(v or '').strip()
    return s if s.strip('-~ ') else None


_MAX_HISTORY = 15


def _table(t):
    """{'title', 'rows': [{header: cell}]} from a court-API table."""
    rows = t.get('rows') or []
    head = rows[0] if rows and isinstance(rows[0], list) else []
    body = [dict(zip(head, r)) for r in rows[1:11] if isinstance(r, list)]
    return {'title': _clean(t.get('title')), 'rows': body}


def get_court_record(advocate_id, case_id):
    """What the court itself says about the case, from the raw response saved
    at import (courtsearch.ImportedCaseRecord): acts, stage, coram, next date,
    hearing history, orders, filings. The cases row keeps only a few fields,
    so without this the assistant can list fields but can't say what the case
    is about or where it stands. Trimmed to what a summary needs - the raw
    record is large and every token of it goes into the prompt."""
    c = _owned_case(advocate_id, case_id)
    if c is None:
        return {'error': 'Case not found or not accessible.'}
    from courtsearch.models import ImportedCaseRecord
    rec = ImportedCaseRecord.objects.filter(case_id=c.id).order_by('-fetched_at').first()
    if rec is None:
        return {'available': False}
    raw = rec.raw if isinstance(rec.raw, dict) else {}
    first = (raw.get('cases') or [{}])[0] if isinstance(raw.get('cases'), list) else raw
    d = first.get('detail') if isinstance(first.get('detail'), dict) else first
    status = d.get('case_status') if isinstance(d.get('case_status'), dict) else {}

    # High Court records list sittings under 'hearings' with 'business_on_date';
    # district-court records use 'history', where 'business_date' is the day
    # heard and 'hearing_date' the next date it was put off to.
    hearings = []
    for h in (d.get('hearings') or d.get('history') or [])[:_MAX_HISTORY]:
        if not isinstance(h, dict):
            continue
        heard = h.get('business_on_date') or h.get('business_date')
        row = {'date': _clean(heard or h.get('hearing_date')),
               'purpose': _clean(h.get('purpose')), 'judge': _clean(h.get('judge'))}
        if heard and _clean(h.get('hearing_date')):
            row['nextDate'] = _clean(h.get('hearing_date'))
        hearings.append(row)
    # District records keep the case numbers in a 'case_details' table.
    details = d.get('case_details') if isinstance(d.get('case_details'), dict) else {}

    def detail(flat_key, table_key):
        return _clean(d.get(flat_key)) or _clean(details.get(table_key))
    orders = [{'date': _clean(o.get('order_date')), 'judge': _clean(o.get('judge')),
               'orderNo': _clean(o.get('order_number'))}
              for o in d.get('orders') or [] if isinstance(o, dict)]
    filings = [{'document': _clean(x.get('Document Filed')), 'filedBy': _clean(x.get('Filed by')),
                'date': _clean(x.get('Date of Receiving'))}
               for x in (d.get('documents') or [])[:15] if isinstance(x, dict)]
    return {
        'available': True,
        'court': rec.court_id,
        'caseType': _clean(details.get('Case Type')),
        'registrationNumber': detail('registration_number', 'Registration Number'),
        'filingNumber': detail('filing_number', 'Filing Number'),
        # "TNCH010015532025 (Note the CNR number for future reference)" -> the number.
        'cnr': (detail('cnr_number', 'CNR Number') or '').split(' ')[0] or None,
        'filingDate': detail('filing_date', 'Filing Date'),
        'registrationDate': detail('registration_date', 'Registration Date'),
        'acts': [' '.join(filter(None, [_clean(a.get('act')),
                                        _clean(a.get('sections') or a.get('section'))]))
                 for a in d.get('acts') or [] if isinstance(a, dict)],
        'category': d.get('category') if isinstance(d.get('category'), dict) else None,
        'stage': _clean(status.get('Case Stage')),
        'coram': _clean(status.get('Coram') or status.get('Court Number and Judge')),
        'firstHearingDate': _clean(status.get('First Hearing Date')),
        'benchType': _clean(status.get('Bench Type')),
        'district': _clean(status.get('District')),
        'nextHearingDate': _clean(status.get('Next Hearing Date')),
        'petitioners': d.get('petitioners') or [],
        'respondents': d.get('respondents') or [],
        'hearingHistory': hearings,
        'orders': orders,
        'filings': filings,
        'filingsTotal': len(d.get('documents') or []),
        'objections': [_clean(o.get('Objection')) for o in d.get('objections') or [] if isinstance(o, dict)],
        'hearingsTotal': len(d.get('hearings') or d.get('history') or []),
        # District records carry extra tables (IA status, transfers) as a
        # header row plus data rows.
        'otherTables': [_table(t) for t in (d.get('extra') or [])[:4] if isinstance(t, dict)],
        'fetchedAt': _iso(rec.fetched_at),
    }


def get_hearings(advocate_id, case_id):
    c = _owned_case(advocate_id, case_id)
    if c is None:
        return {'error': 'Case not found or not accessible.'}
    today = datetime.date.today()
    qs = CaseEvent.objects.filter(advocate_id__in=_scope(advocate_id), case_id=c.id).order_by('date')
    rows = [{'title': e.title, 'type': e.event_type, 'date': _iso(e.date),
             'time': str(e.time) if e.time else '', 'upcoming': bool(e.date and e.date >= today)}
            for e in qs]
    return {'caseNumber': c.case_number, 'hearings': rows,
            'nextHearing': next((r['date'] for r in rows if r['upcoming']), None)}


def get_parties(advocate_id, case_id):
    c = _owned_case(advocate_id, case_id)
    if c is None:
        return {'error': 'Case not found or not accessible.'}
    # CaseParty lives in the workspace app; import lazily to avoid a hard dep here.
    from workspace.models import CaseParty
    qs = CaseParty.objects.filter(advocate_id__in=_scope(advocate_id), case_id=c.id)
    return {'parties': [{'name': p.name, 'role': p.role, 'counsel': p.counsel,
                         'contact': p.contact, 'isOpponent': p.is_opponent} for p in qs]}


def get_notes(advocate_id, case_id):
    c = _owned_case(advocate_id, case_id)
    if c is None:
        return {'error': 'Case not found or not accessible.'}
    qs = CaseNote.objects.filter(advocate_id__in=_scope(advocate_id), case_id=c.id)[:20]
    return {'notes': [{'body': n.body, 'createdAt': _iso(n.created_at)} for n in qs],
            'tags': list(CaseTag.objects.filter(advocate_id__in=_scope(advocate_id), case_id=c.id).values_list('label', flat=True))}


def get_tasks(advocate_id, case_id):
    c = _owned_case(advocate_id, case_id)
    if c is None:
        return {'error': 'Case not found or not accessible.'}
    qs = _tasks(advocate_id).filter(case_id=c.id)
    return {'tasks': [{'title': t.title, 'priority': t.priority, 'deadline': _iso(t.deadline),
                       'completed': t.completed} for t in qs]}


def get_case_financials(advocate_id, case_id):
    c = _owned_case(advocate_id, case_id)
    if c is None:
        return {'error': 'Case not found or not accessible.'}
    invoices = Invoice.objects.billable().filter(advocate_id__in=_scope(advocate_id), case_id=c.id)
    inv_rows = [{'invoiceNumber': i.invoice_number, 'amount': i.amount, 'status': i.status,
                 'dueDate': _iso(i.due_date)} for i in invoices]
    paid = (sum((p.amount or 0) for p in ClientPayment.objects.filter(advocate_id__in=_scope(advocate_id), case_id=c.id))
            if allowed(advocate_id, PAYMENTS) else None)
    unpaid = sum((i.amount or 0) for i in invoices if (i.status or '').upper() != 'PAID')
    return {'agreedAmount': c.amount, 'invoices': inv_rows,
            'totalPaid': paid, 'outstanding': unpaid}


def list_upcoming_hearings(advocate_id, days=14):
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = 14
    today = datetime.date.today()
    end = today + datetime.timedelta(days=days)
    qs = CaseEvent.objects.select_related('case').filter(
        advocate_id__in=_scope(advocate_id), date__gte=today, date__lte=end,
        event_type__iexact='HEARING').order_by('date')[:30]
    return {'hearings': [{
        'caseNumber': e.case.case_number if e.case_id and e.case else 'N/A',
        'title': e.title, 'date': _iso(e.date), 'time': str(e.time) if e.time else '',
    } for e in qs]}


def dashboard_summary(advocate_id):
    """Practice-wide counts - only the ones this user's role may see."""
    today = datetime.date.today()
    scope = _scope(advocate_id)
    out = {}
    if allowed(advocate_id, CASES):
        out['totalCases'] = Case.objects.filter(advocate_id__in=scope, deleted=False).count()
        out['activeCases'] = Case.objects.filter(advocate_id__in=scope, deleted=False, status__iexact='Active').count()
    if allowed(advocate_id, CLIENTS):
        out['clients'] = Client.objects.filter(advocate_id__in=scope, deleted=False).count()
    if allowed(advocate_id, EVENTS):
        out['upcomingHearings'] = CaseEvent.objects.filter(advocate_id__in=scope, date__gte=today).count()
    if allowed(advocate_id, INVOICES):
        out['pendingInvoices'] = Invoice.objects.open().filter(advocate_id__in=scope).count()
    return out


def hearings_between(advocate_id, from_date=None, to_date=None, limit=50):
    """Hearings across the caseload in a date range (both ends inclusive),
    soonest first, with the true total. Defaults: today to 14 days ahead."""
    today = datetime.date.today()

    def day(v, default):
        try:
            return datetime.date.fromisoformat(str(v)[:10]) if v else default
        except ValueError:
            return default
    start = day(from_date, today)
    end = day(to_date, start + datetime.timedelta(days=14))
    if end < start:
        start, end = end, start
    qs = CaseEvent.objects.select_related('case').filter(
        advocate_id__in=_scope(advocate_id), date__gte=start, date__lte=end,
        event_type__iexact='HEARING').order_by('date', 'time')
    total = qs.count()
    return {
        'from': _iso(start), 'to': _iso(end),
        'total': total, 'returned': min(total, limit), 'truncated': total > limit,
        'hearings': [{
            'caseId': e.case_id,
            'caseNumber': e.case.case_number if e.case_id and e.case else None,
            'title': e.title, 'date': _iso(e.date), 'time': str(e.time) if e.time else '',
        } for e in qs[:limit]],
    }


# --- actions: Lisa can open pages and forms, not just answer -------------
# Fixed choices only, so the model can't invent a route. Each needs the same
# permission as the page or form itself (pages/Dashboard.tsx PermissionRoute).
# An action tool returns '_action', which the planner sends to the browser as
# an `action` event (handled by AssistantContext.handleAction).

PAGES = {
    'dashboard': ('/dashboard', None, 'Dashboard'),
    'cases': ('/dashboard/cases', CASES, 'Cases'),
    'clients': ('/dashboard/clients', CLIENTS, 'Clients'),
    'hearings': ('/dashboard/hearings', EVENTS, 'Hearings'),
    'tasks': ('/dashboard/tasks', 'TASK_VIEW', 'Tasks'),
    'documents': ('/dashboard/documents', DOCUMENTS, 'Documents'),
    'invoices': ('/dashboard/invoices', INVOICES, 'Invoices'),
    'expenses': ('/dashboard/expenses', EXPENSES, 'Expenses'),
    'reports': ('/dashboard/reports', 'REPORT_VIEW', 'Reports'),
    'drafting': ('/dashboard/drafting', 'DRAFT_VIEW', 'Drafting'),
    'display_board': ('/dashboard/display-board', None, 'Display Board'),
    'cause_list': ('/dashboard/daily-causelist', None, 'Daily Cause List'),
    'settings': ('/dashboard/settings', None, 'Settings'),
}
# form -> (route, modal the page opens via usePageModal, permission, label)
FORMS = {
    'new_client': ('/dashboard/clients', 'create-client', 'CLIENT_CREATE', 'New Client form'),
    'new_case': ('/dashboard/cases/new', None, 'CASE_CREATE', 'Add Case page'),
    'new_hearing': ('/dashboard/hearings', 'create-hearing', 'EVENT_CREATE', 'New Hearing form'),
    'new_invoice': ('/dashboard/invoices', 'create-invoice', 'INVOICE_CREATE', 'New Invoice form'),
    'new_expense': ('/dashboard/expenses', 'create-expense', 'EXPENSE_CREATE', 'New Expense form'),
    'upload_document': ('/dashboard/documents', 'upload-document', 'DOCUMENT_UPLOAD', 'document upload'),
}
# Pages that listen for the assistant-search event.
SEARCHABLE = {'cases': CASES, 'clients': CLIENTS, 'documents': DOCUMENTS}


def _refuse(what):
    return {'error': f"Not permitted: your role can't open {what}."}


def open_page(advocate_id, page):
    spec = PAGES.get(page)
    if spec is None:
        return {'error': f'Unknown page: {page}'}
    route, need, label = spec
    if need and not allowed(advocate_id, need):
        return _refuse(label)
    return {'done': f'Opened {label}.', '_action': {'action': 'OPEN_PAGE', 'route': route}}


def open_form(advocate_id, form):
    spec = FORMS.get(form)
    if spec is None:
        return {'error': f'Unknown form: {form}'}
    route, modal, need, label = spec
    if need and not allowed(advocate_id, need):
        return _refuse(label)
    if modal is None:
        return {'done': f'Opened the {label}.', '_action': {'action': 'OPEN_PAGE', 'route': route}}
    return {'done': f'Opened the {label}.',
            '_action': {'action': 'OPEN_MODAL', 'route': route, 'modalToOpen': modal}}


def search_in_page(advocate_id, page, text):
    need = SEARCHABLE.get(page)
    if need is None:
        return {'error': f'Searching is available on: {", ".join(SEARCHABLE)}.'}
    if not allowed(advocate_id, need):
        return _refuse(PAGES[page][2])
    text = (text or '').strip()[:100]
    if not text:
        return {'error': 'Nothing to search for.'}
    return {'done': f'Opened {PAGES[page][2]} filtered by the search.',
            '_action': {'action': 'SEARCH', 'route': PAGES[page][0], 'searchQuery': text}}


def open_case(advocate_id, case_id):
    if not allowed(advocate_id, CASES):
        return _refuse('cases')
    c = _owned_case(advocate_id, case_id)
    if c is None:
        return {'error': 'Case not found or not accessible.'}
    return {'done': f'Opened case {c.case_number}.',
            '_action': {'action': 'OPEN_PAGE', 'route': f'/dashboard/cases/{c.id}'}}


# --- tool catalogue (OpenAI-style function calling) -----------------------
# One entry per tool: description, JSON-schema parameters, the permission it
# needs (ANY of; None = any signed-in user) and how to call it. The planner
# only offers the model the tools this user is allowed, and run_tool refuses
# the rest anyway.

_CASE_ID = {'case_id': {'type': 'integer', 'description': 'The numeric caseId (from find_case or a list).'}}
_NONE = {'type': 'object', 'properties': {}, 'required': []}


def _obj(props, required=()):
    return {'type': 'object', 'properties': props, 'required': list(required)}


_CATALOGUE = {
    'find_case': (
        "Find cases by case number (e.g. 'O.S. 900/2025', '900/2025'), title words or a party/client "
        "name. Returns caseIds. Use this first when the question names a case.",
        _obj({'query': {'type': 'string'}}, ['query']), (CASES,),
        lambda aid, a: find_case(aid, a.get('query', ''))),
    'list_cases': (
        'Cases filtered by court level (District / High Court / Supreme Court), status '
        '(Active / Pending / Closed / Dismissed) and/or client, with the true total.',
        _obj({'court_level': {'type': 'string'}, 'status': {'type': 'string'},
              'client_id': {'type': 'integer'}}), (CASES,),
        lambda aid, a: list_cases(aid, court_level=a.get('court_level'), status=a.get('status'),
                                  client_id=a.get('client_id'))),
    'caseload_breakdown': (
        'Exact counts of all cases by status and by court level.', _NONE, (CASES,),
        lambda aid, a: caseload_breakdown(aid)),
    'get_case_summary': (
        'Core details of one case: number, title, type, court, status, agreed fee, client, description.',
        _obj(_CASE_ID, ['case_id']), (CASES,), lambda aid, a: get_case_summary(aid, a.get('case_id'))),
    'get_court_record': (
        "The court's own record of a case: acts, stage, coram, next date, hearing history, orders, "
        'filings, petitioners and respondents. Use it to explain what a case is about.',
        _obj(_CASE_ID, ['case_id']), (CASES,), lambda aid, a: get_court_record(aid, a.get('case_id'))),
    'get_parties': (
        'Parties on a case (our side and the other side) and their counsel.',
        _obj(_CASE_ID, ['case_id']), (CASES,), lambda aid, a: get_parties(aid, a.get('case_id'))),
    'get_notes': (
        'Case notes / diary entries and tags.',
        _obj(_CASE_ID, ['case_id']), (CASES,), lambda aid, a: get_notes(aid, a.get('case_id'))),
    'get_tasks': (
        'Tasks on one case, with priority, deadline and completion.',
        _obj(_CASE_ID, ['case_id']), (CASES,), lambda aid, a: get_tasks(aid, a.get('case_id'))),
    'get_hearings': (
        'All hearings/events of one case, past and upcoming, with its next hearing date.',
        _obj(_CASE_ID, ['case_id']), (EVENTS,), lambda aid, a: get_hearings(aid, a.get('case_id'))),
    'hearings_between': (
        'Hearings across ALL cases between two dates (YYYY-MM-DD, inclusive). Use for "this week", '
        '"before Friday", "next month".',
        _obj({'from_date': {'type': 'string'}, 'to_date': {'type': 'string'}}), (EVENTS,),
        lambda aid, a: hearings_between(aid, a.get('from_date'), a.get('to_date'))),
    'list_documents': (
        'Documents filed on one case (names, categories, dates; not their contents).',
        _obj(_CASE_ID, ['case_id']), (DOCUMENTS,), lambda aid, a: list_documents(aid, a.get('case_id'))),
    'my_tasks': (
        "The asking user's OWN open tasks (assigned to them), soonest deadline first. Use for "
        '"my tasks", "what should I do", "anything I should worry about". For a date question '
        '("due today", "due this week", "due by Friday") pass from_date/to_date (YYYY-MM-DD, '
        'inclusive; "today" = both set to today). Each task has `due` in words ("today", '
        '"tomorrow", "in 3 days", "overdue by 2 days"): repeat it as given. If none match the '
        'dates, say none are due then, then name the tasks in `nextDue` with their `due`. '
        'An "Open Tasks" button is added under the reply by itself; do not write a link.',
        _obj({'from_date': {'type': 'string'}, 'to_date': {'type': 'string'}}), None,
        lambda aid, a: my_tasks(aid, from_date=a.get('from_date'), to_date=a.get('to_date'))),
    'overdue_tasks': (
        'Open tasks past their deadline across the cases this user can see.',
        _NONE, None, lambda aid, a: overdue_tasks(aid)),
    'find_client': (
        'Find clients by name, email or phone. Returns clientIds.',
        _obj({'query': {'type': 'string'}}, ['query']), (CLIENTS,),
        lambda aid, a: find_client(aid, a.get('query', ''))),
    'list_cases_for_client': (
        "All of one client's cases.",
        _obj({'client_id': {'type': 'integer'}}, ['client_id']), (CASES,),
        lambda aid, a: list_cases_for_client(aid, a.get('client_id'))),
    'clients_by_case_count': (
        'Clients ranked by number of live cases.', _NONE, (CLIENTS,),
        lambda aid, a: clients_by_case_count(aid)),
    'get_case_financials': (
        'Invoices, payments received and outstanding dues for one case.',
        _obj(_CASE_ID, ['case_id']), (INVOICES,), lambda aid, a: get_case_financials(aid, a.get('case_id'))),
    'client_financials': (
        'Billed, paid and outstanding for one client across all their cases.',
        _obj({'client_id': {'type': 'integer'}}, ['client_id']), (INVOICES,),
        lambda aid, a: client_financials(aid, a.get('client_id'))),
    'pending_invoices': (
        'Every unpaid invoice with amount, client, due date and days overdue. Use for '
        '"who owes us", "pending dues", "is X behind on payment".',
        _NONE, (INVOICES,), lambda aid, a: pending_invoices(aid)),
    'expense_summary': (
        'Expenses this month and last, by category, and recent entries.', _NONE, (EXPENSES,),
        lambda aid, a: expense_summary(aid)),
    'income_summary': (
        'Payments received this month and last, and recent receipts.', _NONE, (PAYMENTS,),
        lambda aid, a: income_summary(aid)),
    'open_page': (
        'Take the user to a page of the app. Use when they ask to open, go to or show a page.',
        _obj({'page': {'type': 'string', 'enum': list(PAGES)}}, ['page']), None,
        lambda aid, a: open_page(aid, a.get('page'))),
    'open_form': (
        'Open a form to create something: a client, a case, a hearing, an invoice, an expense, '
        'or a document upload. Use when they ask to add, create, register, schedule or upload.',
        _obj({'form': {'type': 'string', 'enum': list(FORMS)}}, ['form']), None,
        lambda aid, a: open_form(aid, a.get('form'))),
    'search_in_page': (
        'Open the cases, clients or documents page filtered by a search text.',
        _obj({'page': {'type': 'string', 'enum': list(SEARCHABLE)}, 'text': {'type': 'string'}},
             ['page', 'text']), None,
        lambda aid, a: search_in_page(aid, a.get('page'), a.get('text'))),
    'open_case': (
        "Open one case's page (find its caseId with find_case first).",
        _obj(_CASE_ID, ['case_id']), (CASES,), lambda aid, a: open_case(aid, a.get('case_id'))),
    'dashboard_summary': (
        'Headline counts: cases, active cases, clients, upcoming hearings, pending invoices '
        "(only those this user's role may see).", _NONE, None, lambda aid, a: dashboard_summary(aid)),
}

# Kept for callers and tests that look tools up by name.
TOOL_PERMISSIONS = {name: spec[2] for name, spec in _CATALOGUE.items() if spec[2]}
# Tools whose case_id argument names "the case we're talking about".
CASE_TOOLS = {name for name, spec in _CATALOGUE.items() if 'case_id' in spec[1]['properties']}


def tools_for(advocate_id):
    """The OpenAI-style tool list this user may use."""
    return [{'type': 'function',
             'function': {'name': name, 'description': desc, 'parameters': params}}
            for name, (desc, params, need, _fn) in _CATALOGUE.items()
            if not need or allowed(advocate_id, *need)]


def run_tool(name, args, advocate_id):
    spec = _CATALOGUE.get(name)
    if spec is None:
        return {'error': f'Unknown tool: {name}'}
    need = spec[2]
    if need and not allowed(advocate_id, *need):
        return {'error': 'Not permitted: your role does not have access to this information.'}
    try:
        return spec[3](advocate_id, args or {})
    except Exception as exc:  # noqa: BLE001 - surface a clean error to the model
        return {'error': f'Tool failed: {exc}'}


def not_permitted(advocate_id):
    """The kinds of data this user's role can't see, in plain words - so Lisa
    says "your role doesn't have access" rather than "there is none"."""
    kinds = [(CASES, 'cases'), (EVENTS, 'hearings'), (DOCUMENTS, 'documents'),
             (CLIENTS, 'client details'), (INVOICES, 'invoices and dues'),
             (PAYMENTS, 'payments received / income'), (EXPENSES, 'expenses')]
    return [label for code, label in kinds if not allowed(advocate_id, code)]
