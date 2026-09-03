import datetime
from django.utils.dateparse import parse_date
from rest_framework import serializers
from core.models import Invoice
from invoices.models import InvoiceItem


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

    class Meta:
        model = Invoice
        fields = ['id', 'invoiceNumber', 'amount', 'invoiceDate', 'dueDate', 'status',
                  'caseId', 'caseTitle', 'clientId', 'clientName', 'caseEntity',
                  'particulars']

    def get_particulars(self, obj):
        return [{'description': it.description, 'amount': it.amount}
                for it in InvoiceItem.objects.filter(invoice_id=obj.id)]

    def get_status(self, obj):
        if (obj.status or '').upper() == 'PAID':
            return 'PAID'
        due = obj.due_date
        if isinstance(due, str):
            # A freshly-created instance can still hold the raw request string.
            due = parse_date(due)
        if isinstance(due, datetime.datetime):
            due = due.date()
        if due and due < datetime.date.today():
            return 'OVERDUE'
        return 'UNPAID'

    def get_caseTitle(self, obj):
        return obj.case.case_title if obj.case_id and obj.case else None

    def get_clientName(self, obj):
        return obj.client.name if obj.client_id and obj.client else None

    def get_caseEntity(self, obj):
        if not obj.case_id:
            return None
        return {'id': obj.case.id, 'caseNumber': obj.case.case_number, 'caseTitle': obj.case.case_title}
