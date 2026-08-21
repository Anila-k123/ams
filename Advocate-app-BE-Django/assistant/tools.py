"""Read-only tools the AI assistant may call to answer questions about the
logged-in advocate's own data. Every function is scoped to `advocate_id`, so the
assistant can never read another advocate's cases. Nothing here writes.

Each tool returns plain JSON-serializable data. `TOOLS` is the Claude tool-schema
list; `run_tool(name, args, advocate_id)` dispatches and enforces ownership.
"""

import datetime

from django.db.models import Q

from core.models import Case, Client, CaseEvent, Invoice, ClientPayment
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
