import datetime
from django.db.models import Q, Sum
from django.utils.dateparse import parse_date
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http

import re

from core.models import Invoice, Case, Advocate
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import InvoiceSerializer, FirmBillingProfileSerializer
from .models import InvoiceItem, InvoiceTaxDetail, FirmBillingProfile
from core.practice import practice_ids, practice_root
from notifications import client_events, internal_events

SORT_MAP = {'invoiceDate': 'invoice_date', 'dueDate': 'due_date', 'amount': 'amount', 'id': 'id'}


def _base(request):
    return Invoice.objects.select_related('case', 'client').filter(advocate_id__in=practice_ids(request.user))


def _as_date(value, default=None):
    """Coerce an incoming JSON date ("2026-09-25") to a real date.

    Django accepts a string on write, but the in-memory instance then keeps the
    string, so anything that compares the field to a date afterwards (see
    InvoiceSerializer.get_status) blows up with a TypeError. Parse on the way in
    so the saved object is consistent with one loaded from the database.
    """
    if not value:
        return default
    if isinstance(value, datetime.date):
        return value
    return parse_date(str(value)) or default


def _case_id(data):
    if data.get('caseId') is not None:
        return data.get('caseId')
    ce = data.get('caseEntity')
    return ce.get('id') if isinstance(ce, dict) else None


def _parse_particulars(data):
    """Clean the incoming line items into [{description, amount, position}].

    Blank rows (no description and no amount) are dropped, so a stray empty row
    the user left in the form does not become a zero line on the invoice.
    """
    items = []
    for i, row in enumerate(data.get('particulars') or []):
        if not isinstance(row, dict):
            continue
        desc = (row.get('description') or '').strip()
        try:
            amt = round(float(row.get('amount') or 0), 2)
        except (TypeError, ValueError):
            amt = 0
        if not desc and not amt:
            continue
        items.append({'description': desc[:500], 'amount': amt, 'position': i})
    return items


def _parse_tax(data):
    """Pull the recipient GST/tax fields from the create payload (camelCase)."""
    return {
        'kind_attn': (data.get('kindAttn') or '').strip()[:255],
        'recipient_gstin': (data.get('recipientGstin') or '').strip()[:32],
        'recipient_state': (data.get('recipientState') or '').strip()[:128],
        'recipient_state_code': (data.get('recipientStateCode') or '').strip()[:8],
        'recipient_address': (data.get('recipientAddress') or '').strip(),
        'place_of_supply': (data.get('placeOfSupply') or '').strip()[:128],
    }


def _norm_state(s):
    return ''.join((s or '').lower().split())


def _compute_gst(taxable, tax_mode, gst_rate, interstate):
    """Return (cgst, sgst, igst, total). RCM adds no tax (recipient pays under
    reverse charge); forward charge splits into CGST+SGST intra-state or IGST
    inter-state at the given rate."""
    cgst = sgst = igst = 0.0
    if tax_mode == 'forward' and gst_rate > 0 and taxable > 0:
        tax_amt = round(taxable * gst_rate / 100.0, 2)
        if interstate:
            igst = tax_amt
        else:
            cgst = round(tax_amt / 2, 2)
            sgst = round(tax_amt - cgst, 2)
    total = round(taxable + cgst + sgst + igst, 2)
    return cgst, sgst, igst, total


def _next_invoice_number():
    """A unique, sequential invoice number ("INV-000123").

    Derived from the highest numeric suffix already in use, then bumped until it
    is free - so the user never has to type or track a number, matching the
    Provakil flow. A user-supplied number still wins when one is sent.
    """
    highest = 0
    for existing in Invoice.objects.values_list('invoice_number', flat=True):
        m = re.search(r'(\d+)\s*$', existing or '')
        if m:
            highest = max(highest, int(m.group(1)))
    nxt = highest + 1
    number = 'INV-{:06d}'.format(nxt)
    while Invoice.objects.filter(invoice_number=number).exists():
        nxt += 1
        number = 'INV-{:06d}'.format(nxt)
    return number


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
        cid = _case_id(data)
        case = Case.objects.filter(id=cid, advocate_id__in=practice_ids(request.user)).first() if cid else None
        if case is None:
            return Response({'error': 'Valid caseId is required'}, status=http.HTTP_400_BAD_REQUEST)
        if case.client_id is None:
            return Response({'error': 'Selected case has no client; invoice needs a client.'},
                            status=http.HTTP_400_BAD_REQUEST)

        # Taxable value = sum of the particulars; fall back to a flat `amount`
        # for older callers that don't send a breakdown.
        particulars = _parse_particulars(data)
        if particulars:
            taxable = round(sum(p['amount'] for p in particulars), 2)
        else:
            taxable = round(float(data.get('amount') or 0), 2)

        # Recipient GST/tax details, snapshotted on the invoice. Fields left blank are
        # prefilled from this client's most recent invoice so repeat billing is quick.
        tax = _parse_tax(data)
        if not all(tax.get(k) for k in ('recipient_gstin', 'recipient_state')):
            prev = (InvoiceTaxDetail.objects
                    .filter(invoice_id__in=Invoice.objects.filter(client_id=case.client_id)
                            .values_list('id', flat=True))
                    .order_by('-id').first())
            if prev:
                for k in ('kind_attn', 'recipient_gstin', 'recipient_state',
                          'recipient_state_code', 'recipient_address', 'place_of_supply'):
                    tax[k] = tax.get(k) or getattr(prev, k)
        if not tax['place_of_supply'] and tax['recipient_state']:
            tax['place_of_supply'] = '{} - {}'.format(
                tax['recipient_state'], tax['recipient_state_code']).strip(' -')

        # GST treatment. Forward charge splits CGST+SGST (intra-state) or IGST
        # (inter-state, by comparing the firm's state to the recipient's).
        tax_mode = (data.get('taxMode') or 'rcm').strip().lower()
        if tax_mode not in ('rcm', 'forward'):
            tax_mode = 'rcm'
        try:
            gst_rate = float(data.get('gstRate') or 18)
        except (TypeError, ValueError):
            gst_rate = 18.0
        owner = Advocate.objects.filter(id=practice_root(request.user)).first()
        supplier_state = (owner.state if owner else '') or ''
        interstate = bool(supplier_state and tax['recipient_state']
                          and _norm_state(supplier_state) != _norm_state(tax['recipient_state']))
        cgst, sgst, igst, total_value = _compute_gst(taxable, tax_mode, gst_rate, interstate)
        tax.update({'tax_mode': tax_mode, 'gst_rate': gst_rate, 'is_interstate': interstate,
                    'taxable_value': taxable, 'cgst_amount': cgst, 'sgst_amount': sgst,
                    'igst_amount': igst, 'total_value': total_value})

        # Auto-number when the client doesn't supply one (the new forms don't).
        number = (data.get('invoiceNumber') or '').strip() or _next_invoice_number()
        if Invoice.objects.filter(invoice_number=number).exists():
            return Response({'error': 'Invoice number already exists'}, status=http.HTTP_409_CONFLICT)

        today = datetime.date.today()
        invoice = Invoice.objects.create(
            invoice_number=number,
            amount=total_value,           # gross for forward charge; == taxable for RCM
            invoice_date=_as_date(data.get('invoiceDate'), today),
            due_date=_as_date(data.get('dueDate'), today + datetime.timedelta(days=30)),
            status='UNPAID',
            advocate_id=request.user.id,
            case=case,
            client_id=case.client_id,
        )
        if particulars:
            InvoiceItem.objects.bulk_create([
                InvoiceItem(invoice_id=invoice.id, description=p['description'],
                            amount=p['amount'], position=p['position'])
                for p in particulars])
        InvoiceTaxDetail.objects.create(invoice_id=invoice.id, **tax)

        client_events.invoice_generated(request.user, case.client, invoice, case)
        # Internal hand-off: tell the accountants (and the team's finance
        # viewers) there's a new bill to collect.
        internal_events.invoice_raised(request.user, invoice, case)
        return Response(InvoiceSerializer(invoice).data, status=http.HTTP_201_CREATED)


class PayInvoiceView(APIView):
    permission_classes = [RequirePermission('INVOICE_EDIT')]

    def put(self, request, pk):
        invoice = _base(request).filter(id=pk).first()
        if invoice is None:
            return Response({'error': 'Invoice not found'}, status=http.HTTP_404_NOT_FOUND)
        invoice.status = 'PAID'
        invoice.save(update_fields=['status'])
        client_events.invoice_paid(request.user, invoice.client, invoice, invoice.case)
        # Internal hand-off: tell the case's advocates it's settled.
        internal_events.payment_settled(request.user, invoice, invoice.case,
                                        amount=invoice.amount)
        return Response(InvoiceSerializer(invoice).data)


class BillingProfileView(APIView):
    """The firm's invoice billing profile (bank/HSN/GST-notes). Keyed by the practice
    OWNER, so the whole chambers shares one profile. GET returns it (creating an empty
    default on first read); PUT upserts. Editing is owner-only."""
    permission_classes = [RequirePermission('INVOICE_VIEW')]

    def get(self, request):
        owner_id = practice_root(request.user)
        profile, _ = FirmBillingProfile.objects.get_or_create(advocate_id=owner_id)
        return Response(FirmBillingProfileSerializer(profile).data)

    def put(self, request):
        owner_id = practice_root(request.user)
        # Only the practice owner may change the firm's billing details.
        if request.user.id != owner_id:
            return Response({'error': 'Only the firm owner can edit billing details.'},
                            status=http.HTTP_403_FORBIDDEN)
        profile, _ = FirmBillingProfile.objects.get_or_create(advocate_id=owner_id)
        ser = FirmBillingProfileSerializer(profile, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)
