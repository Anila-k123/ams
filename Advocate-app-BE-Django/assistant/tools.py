"""Read-only tools the AI assistant may call to answer questions about the
logged-in advocate's own data. Every function is scoped to `advocate_id`, so the
assistant can never read another advocate's cases. Nothing here writes.

Each tool returns plain JSON-serializable data. `TOOLS` is the Claude tool-schema
list; `run_tool(name, args, advocate_id)` dispatches and enforces ownership.
"""

import datetime

from django.db.models import Count, Q, Sum

from core.models import Case, Client, CaseEvent, Document, Expense, Invoice, ClientPayment
from workspace.models import CaseNote, CaseTag, CaseTask


def _iso(d):
    return d.isoformat() if d else ""


def _owned_case(advocate_id, case_id):
    """Return the case if it belongs to this advocate (and isn't archived), else None."""
    try:
        cid = int(case_id)
    except (TypeError, ValueError):
        return None
    return Case.objects.filter(id=cid, advocate_id=advocate_id, deleted=False).select_related('client').first()


# --- tool implementations -------------------------------------------------

def find_case(advocate_id, query):
    q = (query or '').strip()
    qs = Case.objects.select_related('client').filter(advocate_id=advocate_id, deleted=False).filter(
        Q(case_number__icontains=q) | Q(case_title__icontains=q) | Q(status__icontains=q)
    )[:10]
    return {'cases': [{
        'caseId': c.id, 'caseNumber': c.case_number, 'caseTitle': c.case_title,
        'status': c.status, 'client': c.client.name if c.client_id and c.client else None,
    } for c in qs]}


def find_client(advocate_id, query):
    """Search clients by name/email/phone - mirrors the assistant router's
    own _search_clients() and the Client Directory's own search."""
    q = (query or '').strip()
    qs = Client.objects.filter(advocate_id=advocate_id, deleted=False).filter(
        Q(name__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q)
    )[:5]
    return {'clients': [{
        'clientId': c.id, 'name': c.name, 'email': c.email, 'phone': c.phone,
    } for c in qs]}


def list_cases_for_client(advocate_id, client_id):
    """All of one client's cases as light rows (not full detail) - grounds a
    "what are the cases of client X" style question without the per-case
    detail-fetching cost get_case_summary()/etc. carry."""
    qs = Case.objects.filter(advocate_id=advocate_id, client_id=client_id, deleted=False).order_by('-created_at')[:20]
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
    base = Case.objects.filter(advocate_id=advocate_id, deleted=False)
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
    qs = Case.objects.select_related('client').filter(advocate_id=advocate_id, deleted=False)
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


def overdue_tasks(advocate_id, limit=30):
    """Open tasks whose deadline has passed, across EVERY case (not one case),
    newest deadline last. Case numbers are resolved in one extra query so the
    rows are readable without a join per task."""
    today = datetime.date.today()
    qs = CaseTask.objects.filter(
        advocate_id=advocate_id, completed=False, deadline__lt=today
    ).exclude(deadline=None).order_by('deadline')
    total = qs.count()
    rows = list(qs[:limit])
    numbers = dict(Case.objects.filter(
        advocate_id=advocate_id, id__in=[t.case_id for t in rows if t.case_id]
    ).values_list('id', 'case_number'))
    return {
        'total': total,
        'returned': len(rows),
        'truncated': total > len(rows),
        'tasks': [{
            'taskId': t.id, 'title': t.title, 'priority': t.priority,
            'deadline': _iso(t.deadline),
            'daysOverdue': (today - t.deadline).days if t.deadline else None,
            'caseNumber': numbers.get(t.case_id),
        } for t in rows],
    }


def client_financials(advocate_id, client_id):
    """Billed / paid / outstanding for ONE client across all their cases —
    the per-client sibling of get_case_financials()."""
    invoices = list(Invoice.objects.filter(advocate_id=advocate_id, client_id=client_id))
    billed = sum((i.amount or 0) for i in invoices)
    unpaid = [i for i in invoices if (i.status or '').upper() != 'PAID']
    paid = sum((p.amount or 0) for p in
               ClientPayment.objects.filter(advocate_id=advocate_id, client_id=client_id))
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
    qs = Document.objects.filter(advocate_id=advocate_id, case_id=c.id).order_by('-upload_date')
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
          .filter(advocate_id=advocate_id).exclude(status__iexact='PAID')
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
    base = Expense.objects.filter(advocate_id=advocate_id)

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
    base = ClientPayment.objects.select_related('client').filter(advocate_id=advocate_id)

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
    rows = (Case.objects.filter(advocate_id=advocate_id, deleted=False, client_id__isnull=False)
            .values('client_id', 'client__name')
            .annotate(n=Count('id')).order_by('-n')[:limit])
    return {
        'totalClientsWithCases': Case.objects.filter(
            advocate_id=advocate_id, deleted=False, client_id__isnull=False
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


def get_hearings(advocate_id, case_id):
    c = _owned_case(advocate_id, case_id)
    if c is None:
        return {'error': 'Case not found or not accessible.'}
    today = datetime.date.today()
    qs = CaseEvent.objects.filter(advocate_id=advocate_id, case_id=c.id).order_by('date')
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
    qs = CaseParty.objects.filter(advocate_id=advocate_id, case_id=c.id)
    return {'parties': [{'name': p.name, 'role': p.role, 'counsel': p.counsel,
                         'contact': p.contact, 'isOpponent': p.is_opponent} for p in qs]}


def get_notes(advocate_id, case_id):
    c = _owned_case(advocate_id, case_id)
    if c is None:
        return {'error': 'Case not found or not accessible.'}
    qs = CaseNote.objects.filter(advocate_id=advocate_id, case_id=c.id)[:20]
    return {'notes': [{'body': n.body, 'createdAt': _iso(n.created_at)} for n in qs],
            'tags': list(CaseTag.objects.filter(advocate_id=advocate_id, case_id=c.id).values_list('label', flat=True))}


def get_tasks(advocate_id, case_id):
    c = _owned_case(advocate_id, case_id)
    if c is None:
        return {'error': 'Case not found or not accessible.'}
    qs = CaseTask.objects.filter(advocate_id=advocate_id, case_id=c.id)
    return {'tasks': [{'title': t.title, 'priority': t.priority, 'deadline': _iso(t.deadline),
                       'completed': t.completed} for t in qs]}


def get_case_financials(advocate_id, case_id):
    c = _owned_case(advocate_id, case_id)
    if c is None:
        return {'error': 'Case not found or not accessible.'}
    invoices = Invoice.objects.filter(advocate_id=advocate_id, case_id=c.id)
    inv_rows = [{'invoiceNumber': i.invoice_number, 'amount': i.amount, 'status': i.status,
                 'dueDate': _iso(i.due_date)} for i in invoices]
    paid = sum((p.amount or 0) for p in ClientPayment.objects.filter(advocate_id=advocate_id, case_id=c.id))
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
        advocate_id=advocate_id, date__gte=today, date__lte=end,
        event_type__iexact='HEARING').order_by('date')[:30]
    return {'hearings': [{
        'caseNumber': e.case.case_number if e.case_id and e.case else 'N/A',
        'title': e.title, 'date': _iso(e.date), 'time': str(e.time) if e.time else '',
    } for e in qs]}


def dashboard_summary(advocate_id):
    today = datetime.date.today()
    total = Case.objects.filter(advocate_id=advocate_id, deleted=False).count()
    active = Case.objects.filter(advocate_id=advocate_id, deleted=False, status__iexact='Active').count()
    clients = Client.objects.filter(advocate_id=advocate_id, deleted=False).count()
    upcoming = CaseEvent.objects.filter(advocate_id=advocate_id, date__gte=today).count()
    pending = sum(1 for i in Invoice.objects.filter(advocate_id=advocate_id) if (i.status or '').upper() != 'PAID')
    return {'totalCases': total, 'activeCases': active, 'clients': clients,
            'upcomingHearings': upcoming, 'pendingInvoices': pending}


# --- Claude tool schema + dispatch ---------------------------------------

_CASE_ID = {'case_id': {'type': 'integer', 'description': 'The numeric caseId from find_case.'}}

TOOLS = [
    {'name': 'find_case', 'description': "Find the advocate's cases by number, title, party, or status. Use this first to get a caseId.",
     'input_schema': {'type': 'object', 'properties': {'query': {'type': 'string'}}, 'required': ['query']}},
    {'name': 'get_case_summary', 'description': 'Core details of one case (number, title, type, court, status, amount, client, description).',
     'input_schema': {'type': 'object', 'properties': _CASE_ID, 'required': ['case_id']}},
    {'name': 'get_hearings', 'description': 'All hearings/events for a case, past and upcoming, with the next hearing date.',
     'input_schema': {'type': 'object', 'properties': _CASE_ID, 'required': ['case_id']}},
    {'name': 'get_parties', 'description': 'Petitioners, respondents, and their counsel for a case.',
     'input_schema': {'type': 'object', 'properties': _CASE_ID, 'required': ['case_id']}},
    {'name': 'get_notes', 'description': 'Case notes/diary entries and tags for a case.',
     'input_schema': {'type': 'object', 'properties': _CASE_ID, 'required': ['case_id']}},
    {'name': 'get_tasks', 'description': 'To-do tasks for a case, with priority, deadline, and completion.',
     'input_schema': {'type': 'object', 'properties': _CASE_ID, 'required': ['case_id']}},
    {'name': 'get_case_financials', 'description': 'Invoices, payments received, and outstanding dues for a case.',
     'input_schema': {'type': 'object', 'properties': _CASE_ID, 'required': ['case_id']}},
    {'name': 'list_upcoming_hearings', 'description': "All upcoming hearings across the advocate's cases within N days (default 14).",
     'input_schema': {'type': 'object', 'properties': {'days': {'type': 'integer'}}, 'required': []}},
    {'name': 'dashboard_summary', 'description': 'Practice-wide counts: total/active cases, clients, upcoming hearings, pending invoices.',
     'input_schema': {'type': 'object', 'properties': {}, 'required': []}},
]

_DISPATCH = {
    'find_case': lambda aid, a: find_case(aid, a.get('query', '')),
    'get_case_summary': lambda aid, a: get_case_summary(aid, a.get('case_id')),
    'get_hearings': lambda aid, a: get_hearings(aid, a.get('case_id')),
    'get_parties': lambda aid, a: get_parties(aid, a.get('case_id')),
    'get_notes': lambda aid, a: get_notes(aid, a.get('case_id')),
    'get_tasks': lambda aid, a: get_tasks(aid, a.get('case_id')),
    'get_case_financials': lambda aid, a: get_case_financials(aid, a.get('case_id')),
    'list_upcoming_hearings': lambda aid, a: list_upcoming_hearings(aid, a.get('days', 14)),
    'dashboard_summary': lambda aid, a: dashboard_summary(aid),
}


def run_tool(name, args, advocate_id):
    fn = _DISPATCH.get(name)
    if fn is None:
        return {'error': f'Unknown tool: {name}'}
    try:
        return fn(advocate_id, args or {})
    except Exception as exc:  # noqa: BLE001 — surface a clean error to the model
        return {'error': f'Tool failed: {exc}'}
