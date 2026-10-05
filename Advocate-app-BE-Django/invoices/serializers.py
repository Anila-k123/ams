import datetime
from django.utils.dateparse import parse_date
from rest_framework import serializers
from core.models import Advocate, Invoice
from core.finance import invoice_balance, invoice_paid_amounts
from invoices.models import InvoiceItem, FirmBillingProfile, InvoiceHandling


def invoice_context(invoices):
    """Serializer context for a page of invoices: paid amounts, handling rows
    and people's names fetched once, not once per row."""
    invoices = list(invoices)
    ids = [i.id for i in invoices]
    handling = {h.invoice_id: h for h in InvoiceHandling.objects.filter(invoice_id__in=ids)}
    people = {i.advocate_id for i in invoices}
    for h in handling.values():
        people |= {h.issued_by_id, h.cancelled_by_id}
    return {
        'paid': invoice_paid_amounts(ids),
        'handling': handling,
        'names': dict(Advocate.objects.filter(id__in=[p for p in people if p])
                      .values_list('id', 'full_name')),
    }


class InvoiceSerializer(serializers.ModelSerializer):
    """Mirrors Spring InvoiceResponseDTO (+ nested caseEntity)."""
    invoiceNumber = serializers.CharField(source='invoice_number')
    invoiceDate = serializers.DateField(source='invoice_date')
    dueDate = serializers.DateField(source='due_date')
    status = serializers.SerializerMethodField()
    caseId = serializers.IntegerField(source='case_id', allow_null=True)
    clientId = serializers.IntegerField(source='client_id', allow_null=True)
    caseTitle = serializers.SerializerMethodField()
    clientName = serializers.SerializerMethodField()
    caseEntity = serializers.SerializerMethodField()
    # The line-item breakdown, in display order. Empty for older invoices that
    # were raised before particulars existed (they still carry a total `amount`).
    particulars = serializers.SerializerMethodField()
    # Settlement, from the payments linked to this invoice.
    paidAmount = serializers.SerializerMethodField()
    balance = serializers.SerializerMethodField()
    # Raised by = the invoice's advocate; handled by = who issued it, i.e.
    # whom to ask about collecting it (older invoices: their advocate).
    raisedById = serializers.IntegerField(source='advocate_id', read_only=True)
    raisedByName = serializers.SerializerMethodField()
    handledById = serializers.SerializerMethodField()
    handledByName = serializers.SerializerMethodField()
    cancelReason = serializers.SerializerMethodField()
    cancelledByName = serializers.SerializerMethodField()
    # When it was issued, and when the client was emailed (None: not emailed,
    # or an invoice from before this was recorded).
    issuedAt = serializers.SerializerMethodField()
    clientNotifiedAt = serializers.SerializerMethodField()

    class Meta:
        model = Invoice
        fields = ['id', 'invoiceNumber', 'amount', 'invoiceDate', 'dueDate', 'status',
                  'caseId', 'caseTitle', 'clientId', 'clientName', 'caseEntity',
                  'particulars', 'paidAmount', 'balance', 'raisedById', 'raisedByName',
                  'handledById', 'handledByName', 'cancelReason', 'cancelledByName',
                  'issuedAt', 'clientNotifiedAt']

    # Pages pass invoice_context(); a single invoice is looked up on its own.
    def _ctx(self, obj):
        if 'paid' not in self.context:
            self.context.update(invoice_context([obj]))
        return self.context

    def _handling(self, obj):
        return self._ctx(obj)['handling'].get(obj.id)

    def _name(self, obj, pid):
        names = self._ctx(obj)['names']
        if pid and pid not in names:
            names.update(Advocate.objects.filter(id=pid).values_list('id', 'full_name'))
        return names.get(pid)

    def get_paidAmount(self, obj):
        if (obj.status or '').upper() == 'PAID':
            # Older invoices were marked paid with the money recorded unlinked.
            return max(self._ctx(obj)['paid'].get(obj.id, 0.0), float(obj.amount or 0))
        return self._ctx(obj)['paid'].get(obj.id, 0.0)

    def get_balance(self, obj):
        return invoice_balance(obj, self._ctx(obj)['paid'].get(obj.id, 0.0))

    def get_raisedByName(self, obj):
        return self._name(obj, obj.advocate_id)

    def get_handledById(self, obj):
        h = self._handling(obj)
        return (h.issued_by_id if h and h.issued_by_id else obj.advocate_id)

    def get_handledByName(self, obj):
        return self._name(obj, self.get_handledById(obj))

    def get_issuedAt(self, obj):
        h = self._handling(obj)
        return h.created_at if h else None

    def get_clientNotifiedAt(self, obj):
        h = self._handling(obj)
        return h.client_notified_at if h else None

    def get_cancelReason(self, obj):
        h = self._handling(obj)
        return h.cancel_reason if h and h.cancelled_at else None

    def get_cancelledByName(self, obj):
        h = self._handling(obj)
        return self._name(obj, h.cancelled_by_id) if h and h.cancelled_by_id else None

    def get_particulars(self, obj):
        return [{'description': it.description, 'amount': it.amount}
                for it in InvoiceItem.objects.filter(invoice_id=obj.id)]

    def get_status(self, obj):
        """CANCELLED, PAID, OVERDUE (past due and not paid in full), PARTIAL
        (part-paid, not yet due) or UNPAID."""
        stored = (obj.status or '').upper()
        if stored in ('PAID', 'CANCELLED'):
            return stored
        due = obj.due_date
        if isinstance(due, str):
            # A freshly-created instance can still hold the raw request string.
            due = parse_date(due)
        if isinstance(due, datetime.datetime):
            due = due.date()
        if due and due < datetime.date.today():
            return 'OVERDUE'
        return 'PARTIAL' if stored == 'PARTIAL' else 'UNPAID'

    def get_caseTitle(self, obj):
        return obj.case.case_title if obj.case_id and obj.case else None

    def get_clientName(self, obj):
        return obj.client.name if obj.client_id and obj.client else None

    def get_caseEntity(self, obj):
        if not obj.case_id:
            return None
        return {'id': obj.case.id, 'caseNumber': obj.case.case_number, 'caseTitle': obj.case.case_title}


class FirmBillingProfileSerializer(serializers.ModelSerializer):
    """The firm's static invoice billing details, editable in Settings -> Billing."""
    payInFavourOf = serializers.CharField(source='pay_in_favour_of', required=False, allow_blank=True)
    bankName = serializers.CharField(source='bank_name', required=False, allow_blank=True)
    bankBranchAddress = serializers.CharField(source='bank_branch_address', required=False, allow_blank=True)
    accountNumber = serializers.CharField(source='account_number', required=False, allow_blank=True)
    ifscCode = serializers.CharField(source='ifsc_code', required=False, allow_blank=True)
    micrCode = serializers.CharField(source='micr_code', required=False, allow_blank=True)
    remittanceEmail = serializers.CharField(source='remittance_email', required=False, allow_blank=True)
    hsnCode = serializers.CharField(source='hsn_code', required=False, allow_blank=True)
    serviceCategory = serializers.CharField(source='service_category', required=False, allow_blank=True)
    gstNote = serializers.CharField(source='gst_note', required=False, allow_blank=True)
    isoNote = serializers.CharField(source='iso_note', required=False, allow_blank=True)

    class Meta:
        model = FirmBillingProfile
        fields = ['payInFavourOf', 'bankName', 'bankBranchAddress', 'accountNumber',
                  'ifscCode', 'micrCode', 'remittanceEmail', 'hsnCode', 'serviceCategory',
                  'gstNote', 'isoNote']
