import datetime
import hashlib
import json
import logging

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils.dateparse import parse_date
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from core.models import ClientPayment, Case, Invoice
from core.permissions import RequirePermission
from core.validators import error_response
from core.pagination import SpringStylePagination
from .serializers import ClientPaymentSerializer
from core.practice import practice_ids
from core.tenant import owned
from core.finance import invoice_balance, recalc_case_totals, recalc_invoice_status
from invoices.models import PaymentInvoice, PaymentRequestKey
from core.audit import business_event
from core.money import MoneyError, parse_amount, to_decimal

log = logging.getLogger(__name__)
from notifications import client_events, internal_events

SORT_MAP = {'paymentDate': 'payment_date', 'amount': 'amount', 'id': 'id'}


def _base(request):
    return owned(ClientPayment.objects.select_related('case', 'client').filter(advocate_id__in=practice_ids(request.user)), request.user)


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
    """Record money received from a client, optionally against an invoice.

    Safe to retry: send an `Idempotency-Key` header (the app does) and a
    repeated request returns the payment the first one recorded (200) instead
    of a second payment; the same key with a different body is a 409. Against
    an invoice, the invoice row is locked while the balance is checked, so two
    payments at once can't together exceed what is due.
    """
    permission_classes = [RequirePermission('PAYMENT_CREATE')]

    def post(self, request):
        data = request.data
        try:
            amount = parse_amount(data.get('amount'))
        except MoneyError as exc:
            return error_response({'amount': str(exc)})
        pay_date = None
        if data.get('paymentDate'):
            pay_date = parse_date(str(data.get('paymentDate')))
            if pay_date is None:
                return error_response({'paymentDate': 'Enter a valid date.'})
            if pay_date > datetime.date.today():
                return error_response({'paymentDate': 'A payment cannot be dated in the future.'})
        reference = (data.get('referenceNumber') or '').strip()[:255] or None
        key = (request.headers.get('Idempotency-Key') or '').strip()[:100]
        fingerprint = hashlib.sha256(json.dumps(
            [str(amount), data.get('invoiceId'), str(_case_id(data)), reference, str(pay_date),
             data.get('paymentMode')], default=str).encode()).hexdigest()

        if key:
            seen = PaymentRequestKey.objects.filter(advocate_id=request.user.id, key=key).first()
            if seen is not None:
                return self._replay(request, seen, fingerprint)

        with transaction.atomic():
            invoice = None
            if data.get('invoiceId'):
                # Paying an invoice: the payment is linked to it, and the invoice
                # moves to PARTIAL / PAID from its linked payments. The case and
                # client are the invoice's.
                invoice = owned(Invoice.objects.billable().filter(
                    id=data.get('invoiceId'), advocate_id__in=practice_ids(request.user)), request.user).first()
                if invoice is None:
                    return Response({'error': 'Invoice not found'}, status=status.HTTP_404_NOT_FOUND)
                invoice = Invoice.objects.select_for_update().select_related('case').get(id=invoice.id)
                balance = to_decimal(invoice_balance(invoice))
                if balance <= 0:
                    return Response({'error': 'This invoice is already paid.'}, status=status.HTTP_409_CONFLICT)
                if amount > balance:
                    return Response({'error': 'That is more than the Rs. {:,.2f} still due on this invoice.'.format(balance),
                                     'errors': {'amount': 'More than the balance'}},
                                    status=status.HTTP_400_BAD_REQUEST)
                case = invoice.case
            else:
                cid = _case_id(data)
                case = owned(Case.objects.filter(id=cid, advocate_id__in=practice_ids(request.user)), request.user).first() if cid else None
                if cid and case is None:
                    return Response({'error': 'Case not found'}, status=status.HTTP_404_NOT_FOUND)

            # The same bank / UPI reference, amount and invoice (or case) again is
            # the same money entered twice. One cheque split over two invoices
            # differs by invoice, so it passes; cash has no reference.
            dup = ClientPayment.objects.filter(
                advocate_id__in=practice_ids(request.user), reference_number__iexact=reference or '',
                amount=float(amount), case_id=case.id if case else None)
            if invoice is not None:
                dup = dup.filter(id__in=PaymentInvoice.objects.filter(invoice_id=invoice.id).values('payment_id'))
            if reference and owned(dup, request.user).exists() and not data.get('allowDuplicateReference'):
                return Response({'error': 'A payment with reference {} is already recorded.'.format(reference),
                                 'code': 'DUPLICATE_REFERENCE', 'errors': {'referenceNumber': 'Already recorded'}},
                                status=status.HTTP_409_CONFLICT)

            if key:
                try:
                    with transaction.atomic():
                        claim = PaymentRequestKey.objects.create(
                            advocate_id=request.user.id, key=key, fingerprint=fingerprint,
                            firm_id=getattr(case, 'firm_id', None) if case else None)
                except IntegrityError:
                    # A parallel retry claimed the key first: answer as it did.
                    claim = None
            if key and claim is None:
                seen = PaymentRequestKey.objects.filter(advocate_id=request.user.id, key=key).first()
                return self._replay(request, seen, fingerprint)

            payment = ClientPayment.objects.create(
                amount=float(amount),
                payment_mode=(data.get('paymentMode') or '')[:255] or None,
                reference_number=reference,
                payment_date=pay_date,
                description=(data.get('description') or '')[:255] or None,
                advocate_id=request.user.id,
                case=case,
                client=case.client if case else None,
            )
            if key:
                claim.payment_id = payment.id
                claim.save(update_fields=['payment_id'])
            if invoice is not None:
                PaymentInvoice.objects.create(payment_id=payment.id, invoice_id=invoice.id)
                recalc_invoice_status(invoice.id)
            recalc_case_totals(payment.case_id)
            business_event(request.user, 'PAYMENT', 'CREATE', 'Payment of Rs. {} recorded'.format(amount),
                           entity_type='PAYMENT', entity_id=payment.id,
                           detail={'amount': str(amount), 'invoiceId': invoice.id if invoice else None,
                                   'caseId': case.id if case else None, 'mode': payment.payment_mode},
                           firm_id=getattr(payment, 'firm_id', None))
            transaction.on_commit(lambda: self._announce(request.user, payment, case))
        return Response(ClientPaymentSerializer(payment).data, status=status.HTTP_201_CREATED)

    @staticmethod
    def _announce(user, payment, case):
        try:
            client_events.payment_received(user, payment.client, payment, case)
            # Internal hand-off: tell the case's advocates the matter is settled.
            internal_events.payment_settled(user, payment, case, amount=payment.amount)
        except Exception:                                   # noqa: BLE001
            log.exception('payment %s: announcement failed', payment.id)

    @staticmethod
    def _replay(request, seen, fingerprint):
        if seen is None or seen.fingerprint != fingerprint:
            return Response({'error': 'This request key was already used for a different payment.',
                             'code': 'IDEMPOTENCY_MISMATCH'}, status=status.HTTP_409_CONFLICT)
        payment = owned(ClientPayment.objects.filter(id=seen.payment_id), request.user).first() \
            if seen.payment_id else None
        if payment is None:
            return Response({'error': 'The first attempt is still being recorded. Try again in a moment.',
                             'code': 'IN_PROGRESS'}, status=status.HTTP_409_CONFLICT)
        return Response(ClientPaymentSerializer(payment).data, status=status.HTTP_200_OK)
