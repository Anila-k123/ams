import datetime
from django.db.models import Q, Sum
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http

from core.models import Invoice, Case
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import InvoiceSerializer

SORT_MAP = {'invoiceDate': 'invoice_date', 'dueDate': 'due_date', 'amount': 'amount', 'id': 'id'}


def _base(request):
    return Invoice.objects.select_related('case', 'client').filter(advocate_id=request.user.id)


def _case_id(data):
    if data.get('caseId') is not None:
        return data.get('caseId')
    ce = data.get('caseEntity')
    return ce.get('id') if isinstance(ce, dict) else None


class InvoiceListView(APIView):
    permission_classes = [RequirePermission('INVOICE_VIEW')]

    def get(self, request):
        sort_by = SORT_MAP.get(request.query_params.get('sortBy', 'invoiceDate'), 'invoice_date')
        sort_dir = request.query_params.get('sortDir', 'desc')
        qs = _base(request)
        # The panel's search box has always sent ?keyword=, but it was never
        # read here — so typing in it did nothing at all.
        keyword = (request.query_params.get('keyword') or '').strip()
        if keyword:
            qs = qs.filter(
                Q(invoice_number__icontains=keyword) |
                Q(status__icontains=keyword) |
                Q(client__name__icontains=keyword) |
                Q(case__case_number__icontains=keyword) |
                Q(case__case_title__icontains=keyword)
            )
        qs = qs.order_by(sort_by if sort_dir == 'asc' else '-' + sort_by, '-id')
        paginator = SpringStylePagination()
        page = paginator.paginate_queryset(qs, request, self)
        return paginator.get_paginated_response(InvoiceSerializer(page, many=True).data)


class MyInvoicesView(APIView):
    permission_classes = [RequirePermission('INVOICE_VIEW')]

    def get(self, request):
        return Response(InvoiceSerializer(_base(request).order_by('-invoice_date', '-id'), many=True).data)


class InvoiceSummaryView(APIView):
    permission_classes = [RequirePermission('INVOICE_VIEW')]

    def get(self, request):
        today = datetime.date.today()
        paid = unpaid = overdue = 0
        # The cards are labelled "Total cash collected" / "Outstanding client
        # dues" / "Payment deadline passed", i.e. they want AMOUNTS - but only
        # counts were returned, and the frontend ran them through a currency
        # formatter, so 7 paid invoices displayed as "₹7". Send both.
        paid_amount = unpaid_amount = overdue_amount = 0.0
        monthly_revenue = 0.0
        for inv in _base(request):
            amount = inv.amount or 0
            if (inv.status or '').upper() == 'PAID':
                paid += 1
                paid_amount += amount
                if inv.invoice_date and inv.invoice_date.year == today.year and inv.invoice_date.month == today.month:
                    monthly_revenue += amount
            elif inv.due_date and inv.due_date < today:
                overdue += 1
                overdue_amount += amount
            else:
                unpaid += 1
                unpaid_amount += amount
        return Response({
            'paid': paid, 'unpaid': unpaid, 'overdue': overdue,
            'paidAmount': paid_amount, 'unpaidAmount': unpaid_amount,
            'overdueAmount': overdue_amount,
            'monthlyRevenue': monthly_revenue,
        })


class CreateInvoiceView(APIView):
    permission_classes = [RequirePermission('INVOICE_CREATE')]

    def post(self, request):
        data = request.data
        number = data.get('invoiceNumber')
        if not number:
            return Response({'error': 'invoiceNumber is required'}, status=http.HTTP_400_BAD_REQUEST)
        if Invoice.objects.filter(invoice_number=number).exists():
            return Response({'error': 'Invoice number already exists'}, status=http.HTTP_409_CONFLICT)
        cid = _case_id(data)
        case = Case.objects.filter(id=cid, advocate_id=request.user.id).first() if cid else None
        if case is None:
            return Response({'error': 'Valid caseId is required'}, status=http.HTTP_400_BAD_REQUEST)
        if case.client_id is None:
            return Response({'error': 'Selected case has no client; invoice needs a client.'},
                            status=http.HTTP_400_BAD_REQUEST)
        today = datetime.date.today()
        invoice = Invoice.objects.create(
            invoice_number=number,
            amount=data.get('amount') or 0,
            invoice_date=data.get('invoiceDate') or today,
            due_date=data.get('dueDate') or (today + datetime.timedelta(days=30)),
            status='UNPAID',
            advocate_id=request.user.id,
            case=case,
            client_id=case.client_id,
        )
        return Response(InvoiceSerializer(invoice).data, status=http.HTTP_201_CREATED)


class PayInvoiceView(APIView):
    permission_classes = [RequirePermission('INVOICE_EDIT')]

    def put(self, request, pk):
        invoice = _base(request).filter(id=pk).first()
        if invoice is None:
            return Response({'error': 'Invoice not found'}, status=http.HTTP_404_NOT_FOUND)
        invoice.status = 'PAID'
        invoice.save(update_fields=['status'])
        return Response(InvoiceSerializer(invoice).data)
