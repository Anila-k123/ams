import csv
import datetime
from collections import defaultdict, OrderedDict

from django.http import HttpResponse
from rest_framework.views import APIView
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from core.models import (Case, Client, Document, Invoice, Expense, ClientPayment,
                         CaseEvent, Advocate)
from core.permissions import RequirePermission
from .pdf import build_pdf, money
from core.practice import practice_ids

MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def _pdf(pdf_bytes, filename):
    resp = HttpResponse(pdf_bytes, content_type='application/pdf')
    resp['Content-Disposition'] = f'attachment; filename={filename}'
    return resp


def _d(v):
    return v.isoformat() if isinstance(v, (datetime.date, datetime.datetime)) else (v or '')


# ============================== PDF REPORTS ==============================

class CaseReportView(APIView):
    def get(self, request):
        cases = Case.objects.select_related('client').filter(
            advocate_id__in=practice_ids(request.user), deleted=False).order_by('-created_at')
        counts = defaultdict(int)
        rows = []
        for c in cases:
            counts[c.status or 'Unknown'] += 1
            rows.append([c.case_number, c.case_title or '', c.case_type or '',
                         c.status or '', c.court_level or '',
                         c.client.name if c.client_id and c.client else ''])
        blocks = [
            {'type': 'heading', 'text': 'Summary by Status'},
            {'type': 'kv', 'rows': list(counts.items()) or [('Total', 0)]},
            {'type': 'heading', 'text': f'Cases ({len(rows)})'},
            {'type': 'table',
             'headers': ['Case #', 'Title', 'Type', 'Status', 'Court', 'Client'],
             'rows': rows},
        ]
        return _pdf(build_pdf('Case Report', blocks), 'CASE_REPORT.pdf')


class ClientReportView(APIView):
    permission_classes = [RequirePermission('REPORT_VIEW')]

    def get(self, request):
        clients = Client.objects.filter(advocate_id__in=practice_ids(request.user), deleted=False).order_by('name')
        case_qs = Case.objects.filter(advocate_id__in=practice_ids(request.user), deleted=False)
        by_client = defaultdict(lambda: defaultdict(int))
        for c in case_qs:
            by_client[c.client_id]['total'] += 1
            by_client[c.client_id][(c.status or '').lower()] += 1
        rows = []
        for cl in clients:
            s = by_client.get(cl.id, {})
            rows.append([cl.name or '', cl.phone or '', cl.email or '',
                         s.get('total', 0), s.get('active', 0), s.get('closed', 0)])
        blocks = [
            {'type': 'heading', 'text': f'Clients ({len(rows)})'},
            {'type': 'table',
             'headers': ['Name', 'Phone', 'Email', 'Cases', 'Active', 'Closed'],
             'rows': rows},
        ]
        return _pdf(build_pdf('Client Report', blocks), 'CLIENT_REPORT.pdf')


class ExpenseReportView(APIView):
    permission_classes = [RequirePermission('REPORT_VIEW')]

    def get(self, request):
        return _pdf(_expense_pdf(_expenses(request.user.id), 'All Expenses'), 'EXPENSE_REPORT.pdf')


def _expenses(advocate_id):
    return Expense.objects.select_related('case').filter(advocate_id=advocate_id).order_by('-payment_date')


def _expense_pdf(qs, subtitle):
    rows = []
    total = 0.0
    for e in qs:
        total += (e.amount or 0)
        rows.append([_d(e.payment_date), e.title or '', e.category or '',
                     money(e.amount), e.description or ''])
    blocks = [
        {'type': 'kv', 'rows': [('Total Expenses', money(total)), ('Count', len(rows))]},
        {'type': 'heading', 'text': 'Expenses'},
        {'type': 'table',
         'headers': ['Date', 'Title', 'Category', 'Amount', 'Description'], 'rows': rows},
    ]
    return build_pdf('Expense Report', blocks, subtitle=subtitle)


class InvoicePdfView(APIView):
    permission_classes = [RequirePermission('REPORT_VIEW')]

    def get(self, request, pk):
        inv = Invoice.objects.select_related('case', 'client').filter(
            id=pk, advocate_id__in=practice_ids(request.user)).first()
        if inv is None:
            return Response({'error': 'Invoice not found'}, status=404)
        blocks = [
            {'type': 'kv', 'rows': [
                ('Invoice Number', inv.invoice_number),
                ('Status', inv.status),
                ('Invoice Date', _d(inv.invoice_date)),
                ('Due Date', _d(inv.due_date)),
                ('Client', inv.client.name if inv.client_id and inv.client else ''),
                ('Case', inv.case.case_number if inv.case_id and inv.case else ''),
                ('Amount', money(inv.amount)),
            ]},
        ]
        return _pdf(build_pdf('Invoice ' + inv.invoice_number, blocks), f'{inv.invoice_number}.pdf')


class ReceiptPdfView(APIView):
    permission_classes = [RequirePermission('REPORT_VIEW')]

    def get(self, request, pk):
        p = ClientPayment.objects.select_related('case', 'client').filter(
            id=pk, advocate_id__in=practice_ids(request.user)).first()
        if p is None:
            return Response({'error': 'Payment not found'}, status=404)
        blocks = [
            {'type': 'kv', 'rows': [
                ('Receipt No', f'RECEIPT_{p.id}'),
                ('Date', _d(p.payment_date)),
                ('Client', p.client.name if p.client_id and p.client else ''),
                ('Payment Mode', p.payment_mode or ''),
                ('Reference', p.reference_number or ''),
                ('Amount Received', money(p.amount)),
            ]},
            {'type': 'para', 'text': p.description or ''},
        ]
        return _pdf(build_pdf('Payment Receipt', blocks), f'RECEIPT_{p.id}.pdf')


class ClientDetailPdfView(APIView):
    permission_classes = [RequirePermission('REPORT_EXPORT')]

    def get(self, request, pk):
        cl = Client.objects.filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if cl is None:
            return Response({'error': 'Client not found'}, status=404)
        cases = Case.objects.filter(advocate_id__in=practice_ids(request.user), client_id=pk, deleted=False)
        counts = defaultdict(int)
        for c in cases:
            counts[(c.status or '').lower()] += 1
        docs = Document.objects.filter(advocate_id__in=practice_ids(request.user), client_id=pk)
        pays = ClientPayment.objects.filter(advocate_id__in=practice_ids(request.user), client_id=pk).order_by('-payment_date')[:10]
        blocks = [
            {'type': 'kv', 'rows': [
                ('Name', cl.name or ''), ('Phone', cl.phone or ''), ('Email', cl.email or ''),
                ('Address', cl.address or ''),
                ('Total Cases', cases.count()),
                ('Active', counts.get('active', 0)), ('Closed', counts.get('closed', 0)),
                ('Pending', counts.get('pending', 0)),
            ]},
            {'type': 'heading', 'text': 'Documents'},
            {'type': 'table', 'headers': ['Document', 'Category', 'Uploaded'],
             'rows': [[d.document_name, d.category or '', _d(d.upload_date)] for d in docs]},
            {'type': 'heading', 'text': 'Recent Payments'},
            {'type': 'table', 'headers': ['Date', 'Amount', 'Mode', 'Reference'],
             'rows': [[_d(p.payment_date), money(p.amount), p.payment_mode or '', p.reference_number or ''] for p in pays]},
        ]
        safe = (cl.name or 'CLIENT').upper().replace(' ', '_')
        return _pdf(build_pdf('Client: ' + (cl.name or ''), blocks), f'CLIENT_{safe}.pdf')


class CaseDetailPdfView(APIView):
    permission_classes = [RequirePermission('REPORT_EXPORT')]

    def get(self, request, pk):
        c = Case.objects.select_related('client').filter(id=pk, advocate_id__in=practice_ids(request.user)).first()
        if c is None:
            return Response({'error': 'Case not found'}, status=404)
        expenses = Expense.objects.filter(advocate_id__in=practice_ids(request.user), case_id=pk)
        payments = ClientPayment.objects.filter(advocate_id__in=practice_ids(request.user), case_id=pk)
        invoices = Invoice.objects.filter(advocate_id__in=practice_ids(request.user), case_id=pk)
        docs = Document.objects.filter(advocate_id__in=practice_ids(request.user), case_id=pk)
        events = CaseEvent.objects.filter(advocate_id__in=practice_ids(request.user), case_id=pk).order_by('date')
        adv = request.user
        total_exp = sum(e.amount or 0 for e in expenses)
        total_pay = sum(p.amount or 0 for p in payments)
        blocks = [
            {'type': 'kv', 'rows': [
                ('Case Number', c.case_number), ('Title', c.case_title or ''),
                ('Type', c.case_type or ''), ('Court', c.court_level or ''),
                ('Status', c.status or ''), ('Filed', _d(c.created_at)),
                ('Client', c.client.name if c.client_id and c.client else ''),
                ('Advocate', adv.full_name),
                ('Total Expenses', money(total_exp)), ('Total Payments', money(total_pay)),
            ]},
            {'type': 'para', 'text': c.description or ''},
            {'type': 'heading', 'text': 'Invoices'},
            {'type': 'table', 'headers': ['Number', 'Amount', 'Status'],
             'rows': [[i.invoice_number, money(i.amount), i.status] for i in invoices]},
            {'type': 'heading', 'text': 'Documents'},
            {'type': 'table', 'headers': ['Document', 'Category'],
             'rows': [[d.document_name, d.category or ''] for d in docs]},
            {'type': 'heading', 'text': 'Timeline'},
            {'type': 'table', 'headers': ['Date', 'Event'],
             'rows': [[_d(e.date), e.title] for e in events]},
        ]
        return _pdf(build_pdf('Case: ' + c.case_number, blocks), f'CASE_{c.case_number}.pdf')


class MonthlyPdfView(APIView):
    permission_classes = [RequirePermission('REPORT_EXPORT')]

    def get(self, request):
        today = datetime.date.today()
        year = int(request.query_params.get('year') or today.year)
        month = int(request.query_params.get('month') or today.month)
        cases = Case.objects.filter(advocate_id__in=practice_ids(request.user), deleted=False)
        status_counts = defaultdict(int)
        for c in cases:
            status_counts[(c.status or '').lower()] += 1
        income = sum(p.amount or 0 for p in ClientPayment.objects.filter(
            advocate_id__in=practice_ids(request.user), payment_date__year=year, payment_date__month=month))
        expense = sum(e.amount or 0 for e in Expense.objects.filter(
            advocate_id__in=practice_ids(request.user), payment_date__year=year, payment_date__month=month))
        new_clients = Client.objects.filter(advocate_id__in=practice_ids(request.user), deleted=False,
                                            created_at__year=year, created_at__month=month).count()
        invoices_gen = Invoice.objects.filter(advocate_id__in=practice_ids(request.user),
                                              invoice_date__year=year, invoice_date__month=month).count()
        payments_recv = ClientPayment.objects.filter(advocate_id__in=practice_ids(request.user),
                                                     payment_date__year=year, payment_date__month=month).count()
        upcoming = CaseEvent.objects.filter(advocate_id__in=practice_ids(request.user), date__gte=today).count()
        blocks = [
            {'type': 'heading', 'text': 'Case Overview'},
            {'type': 'kv', 'rows': [
                ('Total Cases', cases.count()),
                ('Active', status_counts.get('active', 0)), ('Closed', status_counts.get('closed', 0)),
                ('Pending', status_counts.get('pending', 0)), ('Dismissed', status_counts.get('dismissed', 0)),
                ('Total Clients', Client.objects.filter(advocate_id__in=practice_ids(request.user), deleted=False).count()),
                ('New Clients (month)', new_clients),
            ]},
            {'type': 'heading', 'text': 'Financials'},
            {'type': 'kv', 'rows': [
                ('Income', money(income)), ('Expenses', money(expense)),
                ('Profit', money(income - expense)),
                ('Invoices Generated', invoices_gen), ('Payments Received', payments_recv),
                ('Upcoming Hearings', upcoming),
            ]},
        ]
        label = f'{MONTHS[month - 1]}_{year}'
        return _pdf(build_pdf(f'Monthly Report — {MONTHS[month - 1]} {year}', blocks),
                    f'MONTHLY_REPORT_{label}.pdf')


class FilteredExpensePdfView(APIView):
    permission_classes = [RequirePermission('REPORT_EXPORT')]

    def get(self, request):
        p = request.query_params
        qs = Expense.objects.select_related('case').filter(advocate_id__in=practice_ids(request.user))
        if p.get('startDate'):
            qs = qs.filter(payment_date__gte=p['startDate'])
        if p.get('endDate'):
            qs = qs.filter(payment_date__lte=p['endDate'])
        if p.get('caseId'):
            qs = qs.filter(case_id=p['caseId'])
        if p.get('category'):
            qs = qs.filter(category__iexact=p['category'])
        return _pdf(_expense_pdf(qs.order_by('-payment_date'), 'Filtered Expenses'),
                    'EXPENSE_FILTERED_REPORT.pdf')


class DashboardPdfView(APIView):
    permission_classes = [RequirePermission('REPORT_EXPORT')]

    def get(self, request):
        today = datetime.date.today()
        cases = Case.objects.filter(advocate_id__in=practice_ids(request.user), deleted=False)
        status_counts = defaultdict(int)
        for c in cases:
            status_counts[c.status or 'Unknown'] += 1
        month_ago = today - datetime.timedelta(days=30)
        income = sum(p.amount or 0 for p in ClientPayment.objects.filter(
            advocate_id__in=practice_ids(request.user), payment_date__gte=month_ago))
        expense = sum(e.amount or 0 for e in Expense.objects.filter(
            advocate_id__in=practice_ids(request.user), payment_date__gte=month_ago))
        invoices = Invoice.objects.filter(advocate_id__in=practice_ids(request.user))
        pending_inv = sum(1 for i in invoices if (i.status or '').upper() != 'PAID')
        blocks = [
            {'type': 'heading', 'text': 'Summary'},
            {'type': 'kv', 'rows': [
                ('Total Cases', cases.count()),
                ('Active Cases', status_counts.get('Active', 0)),
                ('Total Clients', Client.objects.filter(advocate_id__in=practice_ids(request.user), deleted=False).count()),
                ('Upcoming Hearings', CaseEvent.objects.filter(advocate_id__in=practice_ids(request.user), date__gte=today).count()),
                ('Pending Invoices', pending_inv),
                ('Total Documents', Document.objects.filter(advocate_id__in=practice_ids(request.user)).count()),
            ]},
            {'type': 'heading', 'text': 'Financials (last 30 days)'},
            {'type': 'kv', 'rows': [('Income', money(income)), ('Expenses', money(expense))]},
            {'type': 'heading', 'text': 'Case Status Breakdown'},
            {'type': 'table', 'headers': ['Status', 'Count'],
             'rows': [[k, v] for k, v in status_counts.items()]},
        ]
        return _pdf(build_pdf('Dashboard Report', blocks), 'DASHBOARD_REPORT.pdf')


# ============================== REPORTS CENTER ==============================

def _date_ranges(filt, start, end):
    today = datetime.date.today()
    def month_start(d): return d.replace(day=1)
    if filt == 'today':
        cur = (today, today); prev = (today - datetime.timedelta(days=1),) * 2
    elif filt == 'yesterday':
        y = today - datetime.timedelta(days=1)
        cur = (y, y); prev = (today - datetime.timedelta(days=2),) * 2
    elif filt == 'last7':
        cur = (today - datetime.timedelta(days=6), today)
        prev = (today - datetime.timedelta(days=13), today - datetime.timedelta(days=7))
    elif filt == 'last30':
        cur = (today - datetime.timedelta(days=29), today)
        prev = (today - datetime.timedelta(days=59), today - datetime.timedelta(days=30))
    elif filt == 'last-month':
        first_this = month_start(today)
        last_prev_end = first_this - datetime.timedelta(days=1)
        cur = (month_start(last_prev_end), last_prev_end)
        prev_end = cur[0] - datetime.timedelta(days=1)
        prev = (month_start(prev_end), prev_end)
    elif filt == 'this-year':
        cur = (today.replace(month=1, day=1), today)
        prev = (today.replace(year=today.year - 1, month=1, day=1),
                today.replace(year=today.year - 1))
    elif filt == 'custom' and start and end:
        cs = datetime.date.fromisoformat(start); ce = datetime.date.fromisoformat(end)
        dur = (ce - cs).days or 1
        cur = (cs, ce); prev = (cs - datetime.timedelta(days=dur + 1), cs - datetime.timedelta(days=1))
    else:  # this-month (default)
        cur = (month_start(today), today)
        prev_end = cur[0] - datetime.timedelta(days=1)
        prev = (month_start(prev_end), prev_end)
    return cur, prev


def _change(cur, prev):
    if not prev:
        return 0.0
    return round((cur - prev) / prev * 100, 1)


def _reports_center_data(advocate_id, filt, start, end):
    (cs, ce), (ps, pe) = _date_ranges(filt, start, end)
    pays = ClientPayment.objects.filter(advocate_id=advocate_id)
    exps = Expense.objects.filter(advocate_id=advocate_id)

    def total(qs, lo, hi):
        return sum(o.amount or 0 for o in qs if o.payment_date and lo <= o.payment_date <= hi)

    rev_cur, rev_prev = total(pays, cs, ce), total(pays, ps, pe)
    exp_cur, exp_prev = total(exps, cs, ce), total(exps, ps, pe)

    invoices = list(Invoice.objects.filter(advocate_id=advocate_id))
    outstanding = [i for i in invoices if (i.status or '').upper() != 'PAID']
    outstanding_total = sum(i.amount or 0 for i in outstanding)

    # cash flow: last 6 months
    today = datetime.date.today()
    cash = []
    for i in range(5, -1, -1):
        m = (today.month - i - 1) % 12 + 1
        y = today.year + ((today.month - i - 1) // 12)
        inc = sum(p.amount or 0 for p in pays if p.payment_date and p.payment_date.year == y and p.payment_date.month == m)
        exo = sum(e.amount or 0 for e in exps if e.payment_date and e.payment_date.year == y and e.payment_date.month == m)
        cash.append({'month': MONTHS[m - 1], 'income': inc, 'expense': exo})

    cases = list(Case.objects.filter(advocate_id=advocate_id, deleted=False))
    st = defaultdict(int)
    court = defaultdict(int)
    ctype = defaultdict(int)
    for c in cases:
        st[(c.status or '').lower()] += 1
        court[c.court_level or 'Unspecified'] += 1
        ctype[c.case_type or 'Unspecified'] += 1

    clients = list(Client.objects.filter(advocate_id=advocate_id, deleted=False))
    new_cur = sum(1 for c in clients if c.created_at and cs <= c.created_at <= ce)
    new_prev = sum(1 for c in clients if c.created_at and ps <= c.created_at <= pe)
    growth = []
    for i in range(5, -1, -1):
        m = (today.month - i - 1) % 12 + 1
        y = today.year + ((today.month - i - 1) // 12)
        growth.append({'month': MONTHS[m - 1],
                       'count': sum(1 for c in clients if c.created_at and c.created_at.year == y and c.created_at.month == m)})

    events = list(CaseEvent.objects.filter(advocate_id=advocate_id))
    ev_today = sum(1 for e in events if e.date == today)
    ev_up = sum(1 for e in events if e.date and e.date > today)
    ev_missed = sum(1 for e in events if e.date and e.date < today and not e.notified)
    court_wise = defaultdict(int)
    for e in events:
        court_wise[(e.case.court_level if e.case_id and e.case else None) or 'Unspecified'] += 1

    return {
        'financial': {
            'revenue': {'current': rev_cur, 'previous': rev_prev, 'change': _change(rev_cur, rev_prev)},
            'expenses': {'current': exp_cur, 'previous': exp_prev, 'change': _change(exp_cur, exp_prev)},
            'netIncome': {'current': rev_cur - exp_cur, 'previous': rev_prev - exp_prev,
                          'change': _change(rev_cur - exp_cur, rev_prev - exp_prev)},
            'outstandingPayments': {'total': outstanding_total, 'count': len(outstanding)},
            'cashFlow': cash,
        },
        'cases': {
            'active': st.get('active', 0), 'pending': st.get('pending', 0),
            'closed': st.get('closed', 0), 'dismissed': st.get('dismissed', 0),
            'courtDistribution': [{'name': k, 'count': v} for k, v in court.items()],
            'typeDistribution': [{'name': k, 'count': v} for k, v in ctype.items()],
        },
        'clients': {
            'newClients': {'current': new_cur, 'previous': new_prev, 'change': _change(new_cur, new_prev)},
            'growth': growth,
            'pendingPayments': {'total': outstanding_total, 'count': len(outstanding)},
        },
        'hearings': {
            'today': ev_today, 'upcoming': ev_up, 'missed': ev_missed,
            'courtWise': [{'name': k, 'count': v} for k, v in court_wise.items()],
        },
    }


class ReportsCenterView(APIView):
    permission_classes = [RequirePermission('REPORT_VIEW')]

    def get(self, request):
        p = request.query_params
        data = _reports_center_data(request.user.id, p.get('filter', 'this-month'),
                                    p.get('startDate'), p.get('endDate'))
        return Response(data)


class ReportsCenterCsvView(APIView):
    permission_classes = [RequirePermission('REPORT_EXPORT')]

    def get(self, request):
        p = request.query_params
        section = p.get('section', 'financial')
        data = _reports_center_data(request.user.id, p.get('filter', 'this-month'),
                                    p.get('startDate'), p.get('endDate'))
        resp = HttpResponse(content_type='text/csv')
        resp['Content-Disposition'] = f'attachment; filename=report-{section}.csv'
        w = csv.writer(resp)
        if section == 'cases':
            c = data['cases']
            w.writerow(['Status', 'Count'])
            for k in ('active', 'pending', 'closed', 'dismissed'):
                w.writerow([k.capitalize(), c[k]])
            w.writerow([]); w.writerow(['Court', 'Count'])
            for x in c['courtDistribution']:
                w.writerow([x['name'], x['count']])
            w.writerow([]); w.writerow(['Case Type', 'Count'])
            for x in c['typeDistribution']:
                w.writerow([x['name'], x['count']])
        elif section == 'clients':
            c = data['clients']
            w.writerow(['Metric', 'Value'])
            w.writerow(['New Clients (Current)', c['newClients']['current']])
            w.writerow(['New Clients (Previous)', c['newClients']['previous']])
            w.writerow(['Change (%)', c['newClients']['change']])
            w.writerow(['Pending Payments Total', c['pendingPayments']['total']])
            w.writerow(['Pending Payments Count', c['pendingPayments']['count']])
            w.writerow([]); w.writerow(['Month', 'New Clients'])
            for x in c['growth']:
                w.writerow([x['month'], x['count']])
        elif section == 'hearings':
            h = data['hearings']
            w.writerow(['Category', 'Count'])
            w.writerow(['Today', h['today']]); w.writerow(['Upcoming', h['upcoming']])
            w.writerow(['Missed', h['missed']])
            w.writerow([]); w.writerow(['Court', 'Count'])
            for x in h['courtWise']:
                w.writerow([x['name'], x['count']])
        else:  # financial
            f = data['financial']
            w.writerow(['Metric', 'Current', 'Previous', 'Change'])
            w.writerow(['Revenue', f['revenue']['current'], f['revenue']['previous'], f"{f['revenue']['change']}%"])
            w.writerow(['Expenses', f['expenses']['current'], f['expenses']['previous'], f"{f['expenses']['change']}%"])
            w.writerow(['Net Income', f['netIncome']['current'], f['netIncome']['previous'], f"{f['netIncome']['change']}%"])
            w.writerow([]); w.writerow(['Month', 'Income', 'Expense'])
            for x in f['cashFlow']:
                w.writerow([x['month'], x['income'], x['expense']])
        return resp
