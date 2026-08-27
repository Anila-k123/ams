import datetime
from collections import defaultdict

from rest_framework.views import APIView
from rest_framework.response import Response

from core.models import Case, Client, CaseEvent, Invoice, Expense, ClientPayment, Activity
from workspace.models import CaseTask

MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


class DashboardView(APIView):
    """GET /api/dashboard — aggregated dashboard payload.

    Mirrors Spring's DashboardDTO. Modules not yet ported (invoices/expenses/
    tasks/activities) return empty lists / zeros; the frontend uses nullish
    coalescing so the UI renders cleanly.
    """

    def get(self, request):
        advocate_id = request.user.id
        today = datetime.date.today()

        cases = list(Case.objects.filter(advocate_id=advocate_id, deleted=False)
                     .select_related('client'))
        clients_qs = Client.objects.filter(advocate_id=advocate_id, deleted=False)
        events = list(CaseEvent.objects.filter(advocate_id=advocate_id).select_related('case'))

        active_cases = sum(1 for c in cases if (c.status or '').lower() == 'active')
        upcoming = [e for e in events if e.date and e.date >= today]

        # caseStatus items
        status_counts = defaultdict(int)
        for c in cases:
            status_counts[c.status or 'Unknown'] += 1
        total_cases = len(cases)
        case_status_items = [
            {'status': s, 'count': n,
             'percentage': round(100.0 * n / total_cases, 1) if total_cases else 0.0}
            for s, n in status_counts.items()
        ]

        # courtStats items: per court_level, counts by status bucket
        court = defaultdict(lambda: {'active': 0, 'pending': 0, 'closed': 0, 'dismissed': 0})
        for c in cases:
            key = c.court_level or 'Unspecified'
            st = (c.status or '').lower()
            if st in court[key]:
                court[key][st] += 1
        court_items = [{'court': k, **v} for k, v in court.items()]

        # monthlyCases items: created per month (+ status buckets)
        monthly = defaultdict(lambda: {'created': 0, 'closed': 0, 'pending': 0, 'dismissed': 0})
        for c in cases:
            if c.created_at:
                m = MONTHS[c.created_at.month - 1]
                monthly[m]['created'] += 1
                st = (c.status or '').lower()
                if st in ('closed', 'pending', 'dismissed'):
                    monthly[m][st] += 1
        monthly_items = [{'month': m, **monthly[m]} for m in MONTHS if m in monthly]

        def case_brief(c):
            return {'id': c.id, 'caseNumber': c.case_number, 'caseTitle': c.case_title,
                    'status': c.status,
                    'clientName': c.client.name if c.client_id and c.client else None}

        def hearing_brief(e):
            return {'id': e.id, 'title': e.title, 'date': e.date.isoformat() if e.date else None,
                    'eventType': e.event_type,
                    'caseNumber': e.case.case_number if e.case_id and e.case else None}

        recent_cases = sorted(cases, key=lambda c: (c.created_at or datetime.date.min, c.id),
                              reverse=True)[:5]
        recent_clients = list(clients_qs.order_by('-created_at', '-id')[:4])

        # --- Financials ---
        invoices = list(Invoice.objects.filter(advocate_id=advocate_id))
        paid = unpaid = overdue = 0
        for inv in invoices:
            if (inv.status or '').upper() == 'PAID':
                paid += 1
            elif inv.due_date and inv.due_date < today:
                overdue += 1
            else:
                unpaid += 1

        income_by_month = defaultdict(float)
        for p in ClientPayment.objects.filter(advocate_id=advocate_id):
            if p.payment_date:
                income_by_month[p.payment_date.month] += (p.amount or 0)
        expense_by_month = defaultdict(float)
        for e in Expense.objects.filter(advocate_id=advocate_id):
            if e.payment_date:
                expense_by_month[e.payment_date.month] += (e.amount or 0)
        ie_months = sorted(set(income_by_month) | set(expense_by_month))
        income_expense_items = [{
            'month': MONTHS[m - 1],
            'income': income_by_month.get(m, 0.0),
            'expense': expense_by_month.get(m, 0.0),
            'net': income_by_month.get(m, 0.0) - expense_by_month.get(m, 0.0),
        } for m in ie_months]

        return Response({
            'summary': {
                'totalCases': total_cases,
                'activeCases': active_cases,
                'clients': clients_qs.count(),
                'upcomingHearings': len(upcoming),
                'pendingInvoices': unpaid + overdue,
            },
            'caseStatus': {'items': case_status_items},
            'courtStats': {'items': court_items},
            'monthlyCases': {'items': monthly_items},
            'incomeExpense': {'items': income_expense_items},
            'invoiceSummary': {'paid': paid, 'unpaid': unpaid, 'overdue': overdue},
            'hearings': [hearing_brief(e) for e in sorted(
                upcoming, key=lambda e: e.date)[:10]],
            'invoices': [{
                'id': inv.id, 'invoiceNumber': inv.invoice_number, 'amount': inv.amount,
                'status': 'PAID' if (inv.status or '').upper() == 'PAID'
                          else ('OVERDUE' if inv.due_date and inv.due_date < today else 'UNPAID'),
                'dueDate': inv.due_date.isoformat() if inv.due_date else None,
            } for inv in sorted(invoices, key=lambda i: i.invoice_date or datetime.date.min,
                                reverse=True)[:5]],
            'activities': [{
                'id': a.id, 'description': a.description, 'action': a.action_type,
                'actionType': a.action_type,
                'timestamp': a.timestamp.isoformat() if a.timestamp else None,
            } for a in Activity.objects.filter(advocate_id=advocate_id).order_by('-timestamp', '-id')[:10]],
            # Was hardcoded to [], so the checklist was always empty. Reads
            # workspace.CaseTask - the task system the app actually uses
            # (TasksPage and CaseDetail both go through /api/workspace/tasks).
            # core.Task is a legacy table nothing writes to. Open tasks only,
            # soonest deadline first, undated last.
            'tasks': [{
                'id': t.id, 'title': t.title, 'priority': t.priority,
                'completed': t.completed,
                'deadline': t.deadline.isoformat() if t.deadline else None,
                'caseId': t.case_id,
            } for t in sorted(
                CaseTask.objects.filter(advocate_id=advocate_id, completed=False),
                key=lambda t: (t.deadline is None, t.deadline or datetime.date.max),
            )[:5]],
            'recentClients': [{'id': c.id, 'name': c.name} for c in recent_clients],
            'recentCases': [case_brief(c) for c in recent_cases],
        })
