from rest_framework import serializers
from core.models import Expense


def _case_entity(obj):
    if not obj.case_id:
        return None
    return {'id': obj.case.id, 'caseNumber': obj.case.case_number, 'caseTitle': obj.case.case_title}


class ExpenseSerializer(serializers.ModelSerializer):
    """Mirrors Spring ExpenseResponseDTO (+ nested caseEntity the frontend reads)."""
    paymentMode = serializers.CharField(source='payment_mode', allow_null=True, required=False)
    paymentStatus = serializers.CharField(source='payment_status', allow_null=True, required=False)
    referenceNumber = serializers.CharField(source='reference_number', allow_null=True, required=False)
    paymentDate = serializers.DateField(source='payment_date', allow_null=True, required=False)
    expenseType = serializers.CharField(source='expense_type', allow_null=True, required=False)
    caseId = serializers.IntegerField(source='case_id', allow_null=True, required=False)
    caseTitle = serializers.SerializerMethodField()
    caseEntity = serializers.SerializerMethodField()

    class Meta:
        model = Expense
        fields = ['id', 'title', 'amount', 'category', 'description', 'paymentMode',
                  'paymentStatus', 'referenceNumber', 'paymentDate', 'caseId', 'caseTitle',
                  'expenseType', 'caseEntity']

    def get_caseTitle(self, obj):
        return obj.case.case_title if obj.case_id and obj.case else None

    def get_caseEntity(self, obj):
        return _case_entity(obj)
