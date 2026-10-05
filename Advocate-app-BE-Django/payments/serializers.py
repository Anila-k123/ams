from rest_framework import serializers
from core.models import ClientPayment


class ClientPaymentSerializer(serializers.ModelSerializer):
    """Mirrors Spring ClientPaymentResponseDTO (+ nested caseEntity)."""
    paymentMode = serializers.CharField(source='payment_mode', allow_null=True, required=False)
    referenceNumber = serializers.CharField(source='reference_number', allow_null=True, required=False)
    paymentDate = serializers.DateField(source='payment_date', allow_null=True, required=False)
    caseId = serializers.IntegerField(source='case_id', allow_null=True, required=False)
    clientId = serializers.IntegerField(source='client_id', allow_null=True, required=False)
    caseTitle = serializers.SerializerMethodField()
    clientName = serializers.SerializerMethodField()
    caseEntity = serializers.SerializerMethodField()
    # The invoice this payment settles, if it was recorded against one.
    invoiceId = serializers.SerializerMethodField()
    invoiceNumber = serializers.SerializerMethodField()

    class Meta:
        model = ClientPayment
        fields = ['id', 'amount', 'paymentMode', 'referenceNumber', 'paymentDate',
                  'description', 'caseId', 'caseTitle', 'clientId', 'clientName', 'caseEntity',
                  'invoiceId', 'invoiceNumber']

    def _invoice(self, obj):
        cache = self.context.setdefault('_invoice_by_payment', {})
        if obj.id not in cache:
            from core.models import Invoice
            from invoices.models import PaymentInvoice
            link = PaymentInvoice.objects.filter(payment_id=obj.id).first()
            cache[obj.id] = Invoice.objects.filter(id=link.invoice_id).first() if link else None
        return cache[obj.id]

    def get_invoiceId(self, obj):
        inv = self._invoice(obj)
        return inv.id if inv else None

    def get_invoiceNumber(self, obj):
        inv = self._invoice(obj)
        return inv.invoice_number if inv else None

    def get_caseTitle(self, obj):
        return obj.case.case_title if obj.case_id and obj.case else None

    def get_clientName(self, obj):
        return obj.client.name if obj.client_id and obj.client else None

    def get_caseEntity(self, obj):
        if not obj.case_id:
            return None
        return {'id': obj.case.id, 'caseNumber': obj.case.case_number, 'caseTitle': obj.case.case_title}
