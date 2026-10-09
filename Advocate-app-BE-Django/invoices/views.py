import datetime
from django.db import transaction
from django.utils import timezone
from django.db.models import Q, Sum
from django.utils.dateparse import parse_date
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http

import re

from core.models import Invoice, Case, Advocate
from core.permissions import RequirePermission
from core.pagination import SpringStylePagination
from .serializers import InvoiceSerializer, FirmBillingProfileSerializer, invoice_context
from .models import (InvoiceItem, InvoiceTaxDetail, FirmBillingProfile, InvoiceRequest,
                     InvoiceHandling, PaymentInvoice)
from core.practice import practice_ids, practice_root
from core.finance import invoice_paid_amounts, recalc_case_totals
from notifications import client_events, internal_events
from core.validators import check_payload, due_date_error, error_response

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


_TAX_KEYS = ('kind_attn', 'recipient_gstin', 'recipient_state',
             'recipient_state_code', 'recipient_address', 'place_of_supply')


def _recipient_defaults(client_id):
    """Suggested recipient GST details for a client: the client's own record
    first (GSTIN, state, address from the client form), then whatever their
    most recent invoice used. Keys as in _parse_tax; '' where nothing is known.

    The client record wins because it's what the office maintains; the last
    invoice fills what it doesn't hold (kind attn, an older GSTIN)."""
    from core.models import Client
    from clients.models import ClientProfile
    out = dict.fromkeys(_TAX_KEYS, '')
    prev = (InvoiceTaxDetail.objects
            .filter(invoice_id__in=Invoice.objects.filter(client_id=client_id)
                    .values_list('id', flat=True))
            .order_by('-id').first())
    if prev:
        out.update({k: getattr(prev, k) or '' for k in _TAX_KEYS})
    profile = ClientProfile.objects.filter(client_id=client_id).first()
    client = Client.objects.filter(id=client_id).first()
    gstin = ((profile.gstin if profile else '') or '').strip().upper()
    if gstin:
        out['recipient_gstin'] = gstin
        # A GSTIN starts with the two-digit state code (33 = Tamil Nadu).
        if gstin[:2].isdigit():
            out['recipient_state_code'] = gstin[:2]
    if profile and profile.state:
        out['recipient_state'] = profile.state.strip()
        # The last invoice's place of supply may name an older state; blank
        # lets create rebuild it from the state and code above.
        out['place_of_supply'] = ''
    if client and client.address:
        out['recipient_address'] = client.address
    return out


class RecipientDefaultsView(APIView):
    """What the invoice form should pre-fill for the case's client."""
    permission_classes = [RequirePermission('INVOICE_CREATE')]

    def get(self, request):
        case = Case.objects.filter(id=request.query_params.get('caseId') or 0,
                                   advocate_id__in=practice_ids(request.user)).first()
        if case is None or case.client_id is None:
            return Response({'error': 'Case not found'}, status=http.HTTP_404_NOT_FOUND)
        d = _recipient_defaults(case.client_id)
        return Response({'kindAttn': d['kind_attn'], 'recipientGstin': d['recipient_gstin'],
                         'recipientState': d['recipient_state'],
                         'recipientStateCode': d['recipient_state_code'],
                         'recipientAddress': d['recipient_address'],
                         'placeOfSupply': d['place_of_supply']})


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
        return paginator.get_paginated_response(
            InvoiceSerializer(page, many=True, context=invoice_context(page)).data)


class MyInvoicesView(APIView):
    permission_classes = [RequirePermission('INVOICE_VIEW')]

    def get(self, request):
        invoices = list(_base(request).order_by('-invoice_date', '-id'))
        return Response(InvoiceSerializer(invoices, many=True, context=invoice_context(invoices)).data)


class InvoiceSummaryView(APIView):
    permission_classes = [RequirePermission('INVOICE_VIEW')]

    def get(self, request):
        today = datetime.date.today()
        paid = unpaid = overdue = 0
        # The cards are labelled "Total cash collected" / "Outstanding client
        # dues" / "Payment deadline passed", i.e. they want AMOUNTS - but only
        # counts were returned, and the frontend ran them through a currency
        # formatter, so 7 paid invoices displayed as "₹7". Send both.
        # A part-paid invoice counts once, as outstanding or overdue, with only
        # its balance there; what was received on it is in "collected".
        # Cancelled invoices are not owed and are left out.
        paid_amount = unpaid_amount = overdue_amount = 0.0
        monthly_revenue = 0.0
        invoices = list(_base(request).billable())
        received = invoice_paid_amounts([i.id for i in invoices])
        for inv in invoices:
            amount = inv.amount or 0
            this_month = (inv.invoice_date and inv.invoice_date.year == today.year
                          and inv.invoice_date.month == today.month)
            if (inv.status or '').upper() == 'PAID':
                paid += 1
                paid_amount += amount
                if this_month:
                    monthly_revenue += amount
                continue
            got = min(received.get(inv.id, 0.0), amount)
            paid_amount += got
            if this_month:
                monthly_revenue += got
            if inv.due_date and inv.due_date < today:
                overdue += 1
                overdue_amount += amount - got
            else:
                unpaid += 1
                unpaid_amount += amount - got
        return Response({
            'paid': paid, 'unpaid': unpaid, 'overdue': overdue,
            'paidAmount': paid_amount, 'unpaidAmount': unpaid_amount,
            'overdueAmount': overdue_amount,
            'monthlyRevenue': monthly_revenue,
        })


def _billable_case(user, data):
    """The case an invoice is for, if `user` may bill it; else (None, 400)."""
    cid = _case_id(data)
    case = Case.objects.filter(id=cid, advocate_id__in=practice_ids(user)).first() if cid else None
    if case is None:
        return None, Response({'error': 'Valid caseId is required'}, status=http.HTTP_400_BAD_REQUEST)
    if case.client_id is None:
        return None, Response({'error': 'Selected case has no client; invoice needs a client.'},
                              status=http.HTTP_400_BAD_REQUEST)
    return case, None


def _taxable(data):
    """Taxable value = sum of the particulars; falls back to a flat `amount`
    for older callers that don't send a breakdown. Returns (particulars, total)."""
    particulars = _parse_particulars(data)
    if particulars:
        return particulars, round(sum(p['amount'] for p in particulars), 2)
    try:
        return particulars, round(float(data.get('amount') or 0), 2)
    except (TypeError, ValueError):
        return particulars, 0.0


class CreateInvoiceView(APIView):
    """Issue an invoice straight away. Needs INVOICE_ISSUE (accounts, seniors);
    advocates who may only raise one go through InvoiceRequestListView."""
    permission_classes = [RequirePermission('INVOICE_ISSUE')]

    def post(self, request):
        case, bad = _billable_case(request.user, request.data)
        if bad is not None:
            return bad
        bad = _due_date_bad(request.data)
        if bad is not None:
            return bad
        invoice, bad = _create_invoice(request.user, request.data, case)
        if bad is not None:
            return bad
        return Response(InvoiceSerializer(invoice).data, status=http.HTTP_201_CREATED)


def _create_invoice(actor, data, case, raised_by=None):
    """Create the GST invoice for `case` from a create-form body.

    Returns (invoice, None) or (None, error Response). `raised_by` is the
    advocate recorded on the invoice (defaults to `actor`); when accounts
    issue an advocate's request it is that advocate, so "raised by" and the
    team's scoping stay with the person who ran the case.
    """
    raised_by = raised_by or actor
    particulars, taxable = _taxable(data)

    # A GSTIN typed on the form must be a real one; a blank one is filled
    # from the client record below.
    data, bad = check_payload(data, {'recipientGstin': 'gstin'})
    if bad is not None:
        return None, bad
    # Recipient GST/tax details, snapshotted on the invoice. Fields left blank are
    # filled from the client's record, then their most recent invoice, so a
    # caller that skips them still gets a proper tax invoice.
    tax = _parse_tax(data)
    if not all(tax.get(k) for k in ('recipient_gstin', 'recipient_state')):
        defaults = _recipient_defaults(case.client_id)
        for k in _TAX_KEYS:
            tax[k] = tax.get(k) or defaults[k]
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
    owner = Advocate.objects.filter(id=practice_root(raised_by)).first()
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
        return None, Response({'error': 'Invoice number already exists'}, status=http.HTTP_409_CONFLICT)

    today = datetime.date.today()
    invoice = Invoice.objects.create(
        invoice_number=number,
        amount=total_value,           # gross for forward charge; == taxable for RCM
        invoice_date=_as_date(data.get('invoiceDate'), today),
        due_date=_as_date(data.get('dueDate'), today + datetime.timedelta(days=30)),
        status='UNPAID',
        advocate_id=raised_by.id,
        case=case,
        client_id=case.client_id,
    )
    if particulars:
        InvoiceItem.objects.bulk_create([
            InvoiceItem(invoice_id=invoice.id, description=p['description'],
                        amount=p['amount'], position=p['position'])
            for p in particulars])
    InvoiceTaxDetail.objects.create(invoice_id=invoice.id, **tax)
    # Whoever issues it handles it from here (accounts).
    handling = InvoiceHandling.objects.create(invoice_id=invoice.id, issued_by_id=actor.id)
    recalc_case_totals(case.id)

    # Issuing is what tells the client. Record whether the email actually went.
    if client_events.invoice_generated(raised_by, case.client, invoice, case):
        handling.client_notified_at = timezone.now()
        handling.save(update_fields=['client_notified_at'])
    # Internal hand-off: tell the accountants (and the team's finance
    # viewers) there's a new bill to collect.
    # The requester of an issued request hears about it from
    # invoice_request_issued instead, so they are not told twice.
    internal_events.invoice_raised(actor, invoice, case,
                                   skip_ids=() if raised_by is actor else (raised_by.id,))
    return invoice, None


class PayInvoiceView(APIView):
    permission_classes = [RequirePermission('INVOICE_EDIT')]

    def put(self, request, pk):
        invoice = _base(request).filter(id=pk).first()
        if invoice is None:
            return Response({'error': 'Invoice not found'}, status=http.HTTP_404_NOT_FOUND)
        if (invoice.status or '').upper() == 'CANCELLED':
            return Response({'error': 'A cancelled invoice cannot be paid.'}, status=http.HTTP_409_CONFLICT)
        # For money already recorded without a link to this invoice. A new
        # payment is recorded against the invoice instead (payments/create
        # with invoiceId), which moves it to PARTIAL / PAID by itself.
        invoice.status = 'PAID'
        invoice.save(update_fields=['status'])
        client_events.invoice_paid(request.user, invoice.client, invoice, invoice.case)
        # Internal hand-off: tell the case's advocates it's settled.
        internal_events.payment_settled(request.user, invoice, invoice.case,
                                        amount=invoice.amount)
        return Response(InvoiceSerializer(invoice).data)


class CancelInvoiceView(APIView):
    """Cancel an issued invoice, with the reason. A GST invoice is never edited
    or deleted: a wrong one is cancelled (kept, its number used, out of every
    total) and a correct one raised. Not once money has been received on it.
    INVOICE_EDIT, not INVOICE_ISSUE: a senior may issue an invoice, but after
    issue the invoice is accounts' (payments, corrections)."""
    permission_classes = [RequirePermission('INVOICE_EDIT')]

    def post(self, request, pk):
        invoice = _base(request).filter(id=pk).first()
        if invoice is None:
            return Response({'error': 'Invoice not found'}, status=http.HTTP_404_NOT_FOUND)
        status = (invoice.status or '').upper()
        if status == 'CANCELLED':
            return Response({'error': 'This invoice is already cancelled.'}, status=http.HTTP_409_CONFLICT)
        if status in ('PAID', 'PARTIAL') or PaymentInvoice.objects.filter(invoice_id=invoice.id).exists():
            return Response({'error': 'Money has been received on this invoice, so it cannot be cancelled.'},
                            status=http.HTTP_409_CONFLICT)
        reason = (request.data.get('reason') or '').strip()
        if not reason:
            return Response({'error': 'Give the reason for cancelling.', 'errors': {'reason': 'Required'}},
                            status=http.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            invoice.status = 'CANCELLED'
            invoice.save(update_fields=['status'])
            handling, _ = InvoiceHandling.objects.get_or_create(
                invoice_id=invoice.id, defaults={'issued_by_id': invoice.advocate_id})
            handling.cancelled_by_id, handling.cancel_reason = request.user.id, reason[:2000]
            handling.cancelled_at = timezone.now()
            handling.save(update_fields=['cancelled_by_id', 'cancel_reason', 'cancelled_at'])
        recalc_case_totals(invoice.case_id)
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
        data, bad = check_payload(request.data, {'ifscCode': 'ifsc', 'remittanceEmail': 'email'})
        if bad is not None:
            return bad
        profile, _ = FirmBillingProfile.objects.get_or_create(advocate_id=owner_id)
        ser = FirmBillingProfileSerializer(profile, data=data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)


# ---------------------------------------------------------------------------
# Advocate-raised invoices: raise -> accounts issue (or return with a note).
# ---------------------------------------------------------------------------

def _requests_in_scope(user):
    """Invoice requests on cases this user's team (or firm) can see."""
    case_ids = Case.objects.filter(advocate_id__in=practice_ids(user)).values_list('id', flat=True)
    return InvoiceRequest.objects.filter(case_id__in=list(case_ids))


def _request_json(req, cases=None, people=None):
    case = (cases or {}).get(req.case_id) or Case.objects.select_related('client').filter(id=req.case_id).first()
    names = people if people is not None else dict(
        Advocate.objects.filter(id__in=[req.requested_by_id, req.reviewed_by_id])
        .values_list('id', 'full_name'))
    p = req.payload or {}
    return {
        'id': req.id, 'status': req.status, 'amount': req.amount, 'note': req.note,
        'caseId': req.case_id, 'caseNumber': case.case_number if case else None,
        'caseTitle': case.case_title if case else None,
        'clientId': req.client_id,
        'clientName': case.client.name if case and case.client_id and case.client else None,
        'requestedById': req.requested_by_id, 'requestedByName': names.get(req.requested_by_id),
        'reviewedById': req.reviewed_by_id, 'reviewedByName': names.get(req.reviewed_by_id),
        'invoiceId': req.invoice_id, 'payload': p,
        'invoiceDate': p.get('invoiceDate'), 'dueDate': p.get('dueDate'),
        'createdAt': req.created_at, 'updatedAt': req.updated_at,
    }


def _clean_payload(data, case_id):
    """The form body as stored on a request: no invoice number (accounts number
    it on issue), and the request's own case (it cannot be moved to another)."""
    body = {k: v for k, v in dict(data).items() if k not in ('invoiceNumber', 'caseEntity')}
    body['caseId'] = case_id
    return body


def _due_date_bad(data):
    """400 when the due date is in the past or before the invoice date. Checked
    when an invoice is created or a request raised / edited, not when accounts
    issue a request later (its due date may have passed while it waited)."""
    msg = due_date_error(data.get('dueDate'), 'Due date', data.get('invoiceDate'), 'invoice date')
    return error_response({'dueDate': msg}) if msg else None


def _check_request_body(data):
    """(taxable, None) if the body can become an invoice, else (None, 400)."""
    _, bad = check_payload(data, {'recipientGstin': 'gstin'})
    if bad is not None:
        return None, bad
    bad = _due_date_bad(data)
    if bad is not None:
        return None, bad
    _, taxable = _taxable(data)
    if taxable <= 0:
        return None, Response({'error': 'Add at least one particular with an amount.'},
                              status=http.HTTP_400_BAD_REQUEST)
    return taxable, None


class InvoiceRequestListView(APIView):
    """GET: requests in scope (?status=SUBMITTED,RETURNED is the default).
    POST: an advocate raises an invoice for accounts to issue."""
    permission_classes = [RequirePermission('INVOICE_CREATE')]

    def get(self, request):
        wanted = [s.strip().upper() for s in (request.query_params.get('status') or
                                               'SUBMITTED,RETURNED').split(',') if s.strip()]
        reqs = list(_requests_in_scope(request.user).filter(status__in=wanted)
                    .order_by('-updated_at', '-id')[:200])
        cases = {c.id: c for c in Case.objects.select_related('client')
                 .filter(id__in=[r.case_id for r in reqs])}
        people = dict(Advocate.objects.filter(
            id__in={r.requested_by_id for r in reqs} | {r.reviewed_by_id for r in reqs if r.reviewed_by_id})
            .values_list('id', 'full_name'))
        return Response([_request_json(r, cases, people) for r in reqs])

    def post(self, request):
        case, bad = _billable_case(request.user, request.data)
        if bad is not None:
            return bad
        taxable, bad = _check_request_body(request.data)
        if bad is not None:
            return bad
        req = InvoiceRequest.objects.create(
            case_id=case.id, client_id=case.client_id, requested_by_id=request.user.id,
            payload=_clean_payload(request.data, case.id), amount=taxable)
        internal_events.invoice_submitted(request.user, req, case)
        return Response(_request_json(req), status=http.HTTP_201_CREATED)


class InvoiceRequestDetailView(APIView):
    """PUT: the advocate edits a waiting or returned request (a returned one is
    sent to accounts again). DELETE: the advocate withdraws it. Only the
    advocate who raised it may do either."""
    permission_classes = [RequirePermission('INVOICE_CREATE')]

    def _own_open(self, request, pk):
        req = _requests_in_scope(request.user).filter(id=pk).first()
        if req is None:
            return None, Response({'error': 'Invoice request not found'}, status=http.HTTP_404_NOT_FOUND)
        if req.requested_by_id != request.user.id:
            return None, Response({'error': 'Only the advocate who raised it can change it.'},
                                  status=http.HTTP_403_FORBIDDEN)
        if req.status not in (InvoiceRequest.SUBMITTED, InvoiceRequest.RETURNED):
            return None, Response({'error': 'This request is already {}.'.format(req.status.lower())},
                                  status=http.HTTP_409_CONFLICT)
        return req, None

    def put(self, request, pk):
        req, bad = self._own_open(request, pk)
        if bad is not None:
            return bad
        taxable, bad = _check_request_body(request.data)
        if bad is not None:
            return bad
        was_returned = req.status == InvoiceRequest.RETURNED
        req.payload, req.amount = _clean_payload(request.data, req.case_id), taxable
        req.status = InvoiceRequest.SUBMITTED
        req.save(update_fields=['payload', 'amount', 'status', 'updated_at'])
        if was_returned:
            case = Case.objects.filter(id=req.case_id).first()
            internal_events.invoice_submitted(request.user, req, case, resubmitted=True)
        return Response(_request_json(req))

    def delete(self, request, pk):
        req, bad = self._own_open(request, pk)
        if bad is not None:
            return bad
        req.status = InvoiceRequest.WITHDRAWN
        req.save(update_fields=['status', 'updated_at'])
        return Response(status=http.HTTP_204_NO_CONTENT)


class InvoiceRequestIssueView(APIView):
    """Accounts issue a request: the real invoice is created now - numbered,
    counted, sent to the client - with the requesting advocate as its advocate.
    The body may carry corrected fields (GST, dates, particulars); they win."""
    permission_classes = [RequirePermission('INVOICE_ISSUE')]

    def post(self, request, pk):
        req = _requests_in_scope(request.user).filter(id=pk).first()
        if req is None:
            return Response({'error': 'Invoice request not found'}, status=http.HTTP_404_NOT_FOUND)
        data = dict(req.payload or {})
        data.update({k: v for k, v in dict(request.data).items() if k not in ('caseId', 'caseEntity')})
        data['caseId'] = req.case_id
        case, bad = _billable_case(request.user, data)
        if bad is not None:
            return bad
        raised_by = Advocate.objects.filter(id=req.requested_by_id).first() or request.user
        with transaction.atomic():
            # Lock the row so two people pressing Issue together make one invoice.
            req = InvoiceRequest.objects.select_for_update().get(id=req.id)
            if req.status != InvoiceRequest.SUBMITTED:
                return Response({'error': 'Only a submitted request can be issued (this one is {}).'
                                 .format(req.status.lower())}, status=http.HTTP_409_CONFLICT)
            invoice, bad = _create_invoice(request.user, data, case, raised_by=raised_by)
            if bad is not None:
                return bad
            req.status, req.invoice_id, req.reviewed_by_id = InvoiceRequest.ISSUED, invoice.id, request.user.id
            req.payload, req.note = _clean_payload(data, req.case_id), ''
            req.save(update_fields=['status', 'invoice_id', 'reviewed_by_id', 'payload', 'note', 'updated_at'])
        internal_events.invoice_request_issued(request.user, req, invoice)
        return Response({'request': _request_json(req), 'invoice': InvoiceSerializer(invoice).data},
                        status=http.HTTP_201_CREATED)


class InvoiceRequestReturnView(APIView):
    """Accounts send a request back to the advocate, saying what to fix."""
    permission_classes = [RequirePermission('INVOICE_ISSUE')]

    def post(self, request, pk):
        req = _requests_in_scope(request.user).filter(id=pk).first()
        if req is None:
            return Response({'error': 'Invoice request not found'}, status=http.HTTP_404_NOT_FOUND)
        if req.status != InvoiceRequest.SUBMITTED:
            return Response({'error': 'Only a submitted request can be returned.'},
                            status=http.HTTP_409_CONFLICT)
        note = (request.data.get('note') or '').strip()
        if not note:
            return Response({'error': 'Say what needs to change.', 'errors': {'note': 'Required'}},
                            status=http.HTTP_400_BAD_REQUEST)
        req.status, req.note, req.reviewed_by_id = InvoiceRequest.RETURNED, note[:2000], request.user.id
        req.save(update_fields=['status', 'note', 'reviewed_by_id', 'updated_at'])
        internal_events.invoice_returned(request.user, req)
        return Response(_request_json(req))
