import datetime
from django.db.models import Sum
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import ClientPayment, Case, Invoice
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import ClientPaymentSerializer
from core.practice import practice_ids
from core.finance import invoice_balance, recalc_case_totals, recalc_invoice_status
from invoices.models import PaymentInvoice
from notifications import client_events, internal_events

SORT_MAP = {'paymentDate': 'payment_date', 'amount': 'amount', 'id': 'id'}


def _base(request):
    return ClientPayment.objects.select_related('case', 'client').filter(advocate_id__in=practice_ids(request.user))


def _case_id(data):
    if data.get('caseId') is not None:
        return data.get('caseId')
    ce = data.get('caseEntity')
    return ce.get('id') if isinstance(ce, dict) else None


class PaymentListView(APIView):
    permission_classes = [RequirePermission('PAYMENT_VIEW')]

    def get(self, request):
        sort_by = SORT_MAP.get(request.query_params.get('sortBy', 'paymentDate'), 'payment_date')
        sort_dir = request.query_params.get('sortDir', 'desc')
        qs = _base(request).order_by(sort_by if sort_dir == 'asc' else '-' + sort_by, '-id')
        paginator = SpringStylePagination()
        page = paginator.paginate_queryset(qs, request, self)
        return paginator.get_paginated_response(ClientPaymentSerializer(page, many=True).data)


class PaymentsByCaseView(APIView):
    permission_classes = [RequirePermission('PAYMENT_VIEW')]

    def get(self, request, case_id):
        qs = _base(request).filter(case_id=case_id).order_by('-payment_date', '-id')
        return Response(ClientPaymentSerializer(qs, many=True).data)


class TodayPaymentsView(APIView):
    permission_classes = [RequirePermission('PAYMENT_VIEW')]

    def get(self, request):
        today = datetime.date.today()
        qs = _base(request).filter(payment_date=today).order_by('-id')
        total = qs.aggregate(s=Sum('amount'))['s'] or 0
        return Response({'payments': ClientPaymentSerializer(qs, many=True).data,
                         'totalAmount': total, 'date': today.isoformat()})


class MonthlyPaymentsView(APIView):
    permission_classes = [RequirePermission('PAYMENT_VIEW')]

    def get(self, request):
        try:
            year = int(request.query_params.get('year'))
            month = int(request.query_params.get('month'))
        except (TypeError, ValueError):
            now = datetime.date.today()
            year, month = now.year, now.month
        qs = _base(request).filter(payment_date__year=year, payment_date__month=month)
        total = qs.aggregate(s=Sum('amount'))['s'] or 0
        return Response({'payments': ClientPaymentSerializer(qs.order_by('-payment_date'), many=True).data,
                         'totalAmount': total, 'month': month, 'year': year})


class CreatePaymentView(APIView):
    permission_classes = [RequirePermission('PAYMENT_CREATE')]

    def post(self, request):
        data = request.data
        # Paying an invoice: the payment is linked to it, and the invoice
        # moves to PARTIAL / PAID from its linked payments. The case and
        # client are the invoice's.
        invoice = None
        if data.get('invoiceId'):
            invoice = (Invoice.objects.billable().select_related('case')
                       .filter(id=data.get('invoiceId'), advocate_id__in=practice_ids(request.user)).first())
            if invoice is None:
                return Response({'error': 'Invoice not found'}, status=status.HTTP_404_NOT_FOUND)
            try:
                amount = round(float(data.get('amount') or 0), 2)
            except (TypeError, ValueError):
                amount = 0
            balance = invoice_balance(invoice)
            if amount <= 0:
                return Response({'error': 'Enter the amount received.', 'errors': {'amount': 'Required'}},
                                status=status.HTTP_400_BAD_REQUEST)
            if balance <= 0:
                return Response({'error': 'This invoice is already paid.'}, status=status.HTTP_409_CONFLICT)
            if amount > balance + 0.005:
                return Response({'error': 'That is more than the Rs. {:,.2f} still due on this invoice.'.format(balance),
                                 'errors': {'amount': 'More than the balance'}},
                                status=status.HTTP_400_BAD_REQUEST)
            case = invoice.case
        else:
            cid = _case_id(data)
            case = Case.objects.filter(id=cid, advocate_id__in=practice_ids(request.user)).first() if cid else None
        payment = ClientPayment.objects.create(
            amount=data.get('amount'),
            payment_mode=data.get('paymentMode'),
            reference_number=data.get('referenceNumber'),
            payment_date=data.get('paymentDate') or None,
            description=data.get('description'),
            advocate_id=request.user.id,
            case=case,
            client=case.client if case else None,
        )
        if invoice is not None:
            PaymentInvoice.objects.create(payment_id=payment.id, invoice_id=invoice.id)
            recalc_invoice_status(invoice.id)
        recalc_case_totals(payment.case_id)
        client_events.payment_received(request.user, payment.client, payment, case)
        # Internal hand-off: tell the case's advocates the matter is settled.
        internal_events.payment_settled(request.user, payment, case,
                                        amount=payment.amount)
        return Response(ClientPaymentSerializer(payment).data, status=status.HTTP_201_CREATED)
