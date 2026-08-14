"""AI Assistant — a rule-based (keyword-matching) command router, faithfully
ported from the Spring AssistantService. Not an LLM: it maps phrases to
navigation/data actions the frontend acts on.
"""

import datetime
from django.db.models import Q
from rest_framework.views import APIView
from rest_framework.response import Response

from core.models import Case, Client, CaseEvent, Invoice, Expense, ClientPayment, Document


def _any(text, *phrases):
    return any(p in text for p in phrases)


def _after(text, *prefixes):
    for p in prefixes:
        if text.startswith(p):
            return text[len(p):].strip()
    return ''


def _page(intent, message, route):
    return {'intent': intent, 'action': 'OPEN_PAGE', 'route': route, 'message': message}


def _modal(intent, message, route, modal):
    return {'intent': intent, 'action': 'OPEN_MODAL', 'route': route,
            'modalToOpen': modal, 'message': message}


def _answer(message):
    return {'intent': 'ANSWER', 'action': 'ANSWER', 'message': message}


class AssistantQueryView(APIView):
    def post(self, request):
        query = (request.data.get('query') or '').strip()
        clean = query.lower()
        aid = request.user.id
        return Response(self.process(clean, aid))

    # --- intent engine ---
    def process(self, clean, aid):
        # Page navigation
        pages = [
            (('open dashboard', 'dashboard', 'go to dashboard', 'show dashboard'), 'OPEN_DASHBOARD', 'Opening your Dashboard overview.', '/dashboard'),
            (('open cases', 'cases', 'go to cases', 'show cases'), 'OPEN_CASES', 'Opening Case Management.', '/dashboard/cases'),
            (('open clients', 'clients', 'go to clients', 'show clients', 'client list'), 'OPEN_CLIENTS', 'Opening Client Directory.', '/dashboard/clients'),
            (('open expenses', 'expenses', 'go to expenses', 'show expenses'), 'OPEN_EXPENSES', 'Opening Expense Tracker.', '/dashboard/expenses'),
            (('open calendar', 'calendar', 'go to calendar', 'open hearings'), 'OPEN_CALENDAR', 'Opening Hearings Calendar.', '/dashboard/hearings'),
            (('open documents', 'documents', 'go to documents', 'show documents'), 'OPEN_DOCUMENTS', 'Opening Documents Panel.', '/dashboard/documents'),
            (('open invoices', 'invoices', 'go to invoices', 'show invoices'), 'OPEN_INVOICES', 'Opening Invoices Panel.', '/dashboard/invoices'),
            (('open settings', 'settings', 'go to settings'), 'OPEN_SETTINGS', 'Opening Settings.', '/dashboard/settings'),
            (('open reports', 'reports', 'go to reports', 'show reports'), 'OPEN_REPORTS', 'Opening Reports & Analytics.', '/dashboard/reports'),
        ]
        # summaries / data intents that must be checked BEFORE bare page words
        if _any(clean, 'dashboard summary', 'show dashboard summary', 'overview'):
            return self._summary(aid)
        if _any(clean, "today's hearing", 'hearings today', 'today hearing', 'hearing today'):
            return self._hearings(aid, 0, 1, "Today's Hearings", '/dashboard/hearings')
        if _any(clean, 'upcoming hearings', 'next hearings', 'future hearings'):
            return self._hearings(aid, 0, 30, 'Upcoming Hearings', '/dashboard/hearings')
        if _any(clean, 'pending invoices', 'unpaid invoices', 'overdue invoices'):
            return self._pending_invoices(aid)
        if _any(clean, "today's expenses", 'today expense', 'expenses today'):
            return self._expenses(aid, datetime.date.today(), datetime.date.today(), "Today's Expenses")
        if _any(clean, 'monthly expenses', 'this month expenses', 'expenses this month'):
            return self._expenses(aid, datetime.date.today().replace(day=1), datetime.date.today(), "This Month's Expenses")
        if _any(clean, 'monthly income', 'income this month', 'revenue this month', 'monthly revenue'):
            return self._income(aid)
        if _any(clean, 'how many active cases', 'active cases count', 'number of active cases'):
            n = Case.objects.filter(advocate_id=aid, deleted=False, status__iexact='Active').count()
            return _answer(f'There are **{n}** active cases currently.')
        if _any(clean, 'how many clients', 'total clients', 'number of clients', 'client count'):
            n = Client.objects.filter(advocate_id=aid).count()
            return _answer(f'You have **{n}** clients registered.')
        if _any(clean, 'how many hearings today', 'hearings count today', 'number of hearings today'):
            n = CaseEvent.objects.filter(advocate_id=aid, date=datetime.date.today()).count()
            return _answer(f'There are **{n}** hearings scheduled for today.')

        # Searches (prefix-based)
        if clean.startswith(('find client ', 'search client ', 'search for client ')):
            return self._search_clients(aid, _after(clean, 'find client ', 'search client ', 'search for client '))
        if clean.startswith(('find case ', 'search case ', 'search for case ')):
            return self._search_cases(aid, _after(clean, 'find case ', 'search case ', 'search for case '))
        if clean.startswith(('find invoice ', 'search invoice ')):
            return self._search_invoices(aid, _after(clean, 'find invoice ', 'search invoice '))

        # Create modals
        creates = [
            (('create client', 'add client', 'new client', 'register client'), 'CREATE_CLIENT', 'Opening the New Client form.', '/dashboard/clients', 'create-client'),
            (('create case', 'add case', 'new case', 'register case'), 'CREATE_CASE', 'Opening the New Case form.', '/dashboard/cases', 'create-case'),
            (('create expense', 'add expense', 'new expense'), 'CREATE_EXPENSE', 'Opening the Add Expense form.', '/dashboard/expenses', 'create-expense'),
            (('create hearing', 'add hearing', 'schedule hearing', 'new hearing'), 'CREATE_HEARING', 'Opening the Add Hearing form.', '/dashboard/hearings', 'create-hearing'),
            (('create invoice', 'add invoice', 'generate invoice', 'new invoice'), 'CREATE_INVOICE', 'Opening the Invoice generator.', '/dashboard/invoices', 'create-invoice'),
        ]
        for phrases, intent, msg, route, modal in creates:
            if _any(clean, *phrases):
                return _modal(intent, msg, route, modal)

        if _any(clean, 'refresh dashboard', 'reload dashboard', 'refresh'):
            return _page('REFRESH_DASHBOARD', 'Refreshing Dashboard data.', '/dashboard')

        # Page navigation (checked last so data-intents win)
        for phrases, intent, msg, route in pages:
            if _any(clean, *phrases):
                return _page(intent, msg, route)

        return {
            'intent': 'UNKNOWN', 'action': 'ANSWER',
            'message': ("I didn't understand that command. Try something like:\n\n"
                        '• "Open Cases"\n• "Show today\'s hearings"\n• "Find client Rahul"\n'
                        '• "Create Client"\n• "How many active cases?"\n• "Dashboard summary"'),
        }

    # --- builders ---
    def _summary(self, aid):
        today = datetime.date.today()
        total = Case.objects.filter(advocate_id=aid, deleted=False).count()
        active = Case.objects.filter(advocate_id=aid, deleted=False, status__iexact='Active').count()
        clients = Client.objects.filter(advocate_id=aid, deleted=False).count()
        upcoming = CaseEvent.objects.filter(advocate_id=aid, date__gte=today).count()
        pending = sum(1 for i in Invoice.objects.filter(advocate_id=aid)
                      if (i.status or '').upper() != 'PAID')
        return {
            'intent': 'SHOW_SUMMARY', 'action': 'SHOW_DATA', 'route': '/dashboard',
            'message': (f'📊 **Dashboard Summary**\n\n• Total Cases: **{total}**\n'
                        f'• Active Cases: **{active}**\n• Clients: **{clients}**\n'
                        f'• Upcoming Hearings: **{upcoming}**\n• Pending Invoices: **{pending}**'),
            'data': {'totalCases': total, 'activeCases': active, 'clients': clients,
                     'upcomingHearings': upcoming, 'pendingInvoices': pending},
        }

    def _hearings(self, aid, start_off, end_off, label, route):
        today = datetime.date.today()
        start = today + datetime.timedelta(days=start_off)
        end = today + datetime.timedelta(days=end_off)
        qs = CaseEvent.objects.select_related('case', 'case__client').filter(
            advocate_id=aid, date__gte=start, date__lte=end, event_type__iexact='HEARING').order_by('date')[:10]
        results = [{
            'id': h.id, 'title': h.title, 'date': h.date.isoformat() if h.date else '',
            'time': str(h.time) if h.time else '',
            'caseNumber': h.case.case_number if h.case_id and h.case else 'N/A',
            'clientName': (h.case.client.name if h.case_id and h.case and h.case.client_id and h.case.client else 'N/A'),
        } for h in qs]
        return {
            'intent': 'SHOW_HEARINGS', 'action': 'SHOW_DATA', 'route': route,
            'message': (f'No {label.lower()} found.' if not results
                        else f'Found **{len(results)}** {label.lower()}.'),
            'data': {'label': label, 'count': len(results)}, 'results': results,
        }

    def _pending_invoices(self, aid):
        invs = [i for i in Invoice.objects.select_related('client').filter(advocate_id=aid)
                if (i.status or '').upper() in ('UNPAID', 'OVERDUE')][:10]
        results = [{
            'id': i.id, 'invoiceNumber': i.invoice_number, 'amount': i.amount, 'status': i.status,
            'clientName': i.client.name if i.client_id and i.client else 'N/A',
            'dueDate': i.due_date.isoformat() if i.due_date else '',
        } for i in invs]
        total = sum(i.amount or 0 for i in invs)
        return {
            'intent': 'SHOW_PENDING_INVOICES', 'action': 'SHOW_DATA', 'route': '/dashboard/invoices',
            'message': ('No pending invoices. Great job!' if not results
                        else f'You have **{len(results)}** pending invoice(s) totaling **₹{total:.0f}**.'),
            'results': results, 'data': {'count': len(results), 'total': total},
        }

    def _expenses(self, aid, start, end, label):
        qs = Expense.objects.filter(advocate_id=aid, payment_date__gte=start, payment_date__lte=end).order_by('-payment_date')[:10]
        results = [{'id': e.id, 'title': e.title, 'amount': e.amount, 'category': e.category,
                    'date': e.payment_date.isoformat() if e.payment_date else ''} for e in qs]
        total = sum(e.amount or 0 for e in qs)
        return {
            'intent': 'SHOW_EXPENSES', 'action': 'SHOW_DATA', 'route': '/dashboard/expenses',
            'message': (f'No {label.lower()} found.' if not results
                        else f'{label}: **{len(results)}** ent(ies) totaling **₹{total:.0f}**.'),
            'results': results, 'data': {'label': label, 'total': total},
        }

    def _income(self, aid):
        start = datetime.date.today().replace(day=1)
        end = datetime.date.today()
        total = sum(p.amount or 0 for p in ClientPayment.objects.filter(
            advocate_id=aid, payment_date__gte=start, payment_date__lte=end))
        return {
            'intent': 'SHOW_INCOME', 'action': 'SHOW_DATA', 'route': '/dashboard',
            'message': f"💰 This month's income (payments received): **₹{total:.0f}**.",
            'data': {'income': total},
        }

    def _search_clients(self, aid, name):
        qs = Client.objects.filter(advocate_id=aid, deleted=False).filter(
            Q(name__icontains=name) | Q(email__icontains=name) | Q(phone__icontains=name))[:10]
        results = [{'id': c.id, 'name': c.name, 'email': c.email, 'phone': c.phone} for c in qs]
        return {
            'intent': 'SEARCH_CLIENT', 'action': 'SEARCH', 'route': '/dashboard/clients',
            'searchQuery': name, 'highlightId': str(results[0]['id']) if len(results) == 1 else None,
            'message': (f'No clients matching "{name}".' if not results
                        else f'Found **{len(results)}** client(s) matching "{name}".'),
            'results': results,
        }

    def _search_cases(self, aid, kw):
        qs = Case.objects.select_related('client').filter(advocate_id=aid, deleted=False).filter(
            Q(case_number__icontains=kw) | Q(case_title__icontains=kw) | Q(status__icontains=kw))[:10]
        results = [{'id': c.id, 'caseNumber': c.case_number, 'caseTitle': c.case_title,
                    'status': c.status, 'clientName': c.client.name if c.client_id and c.client else 'N/A'} for c in qs]
        return {
            'intent': 'SEARCH_CASE', 'action': 'SEARCH', 'route': '/dashboard/cases',
            'searchQuery': kw, 'highlightId': str(results[0]['id']) if len(results) == 1 else None,
            'message': (f'No cases matching "{kw}".' if not results
                        else f'Found **{len(results)}** case(s) matching "{kw}".'),
            'results': results,
        }

    def _search_invoices(self, aid, kw):
        qs = Invoice.objects.select_related('client').filter(advocate_id=aid).filter(
            Q(invoice_number__icontains=kw) | Q(status__icontains=kw))[:10]
        results = [{'id': i.id, 'invoiceNumber': i.invoice_number, 'amount': i.amount,
                    'status': i.status, 'clientName': i.client.name if i.client_id and i.client else 'N/A'} for i in qs]
        return {
            'intent': 'SEARCH_INVOICE', 'action': 'SEARCH', 'route': '/dashboard/invoices',
            'searchQuery': kw, 'message': (f'No invoices matching "{kw}".' if not results
                        else f'Found **{len(results)}** invoice(s) matching "{kw}".'),
            'results': results,
        }
