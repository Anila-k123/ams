from rest_framework import serializers
from core.models import Case


class CaseSerializer(serializers.ModelSerializer):
    """Mirrors Spring CaseResponseDTO."""
    caseNumber = serializers.CharField(source='case_number')
    caseTitle = serializers.CharField(source='case_title')
    caseType = serializers.CharField(source='case_type')
    courtLevel = serializers.CharField(source='court_level')
    totalClientAgreedAmount = serializers.FloatField(source='total_client_agreed_amount')
    totalPaidByClient = serializers.FloatField(source='total_paid_by_client')
    totalExpensesSoFar = serializers.FloatField(source='total_expenses_so_far')
    balanceInAccount = serializers.FloatField(source='balance_in_account')
    pendingFromClient = serializers.FloatField(source='pending_from_client')
    clientId = serializers.IntegerField(source='client_id')
    clientName = serializers.SerializerMethodField()

    class Meta:
        model = Case
        fields = [
            'id', 'caseNumber', 'caseTitle', 'caseType', 'courtLevel', 'status',
            'amount', 'description', 'totalClientAgreedAmount', 'totalPaidByClient',
            'totalExpensesSoFar', 'balanceInAccount', 'pendingFromClient',
            'deleted', 'clientId', 'clientName',
        ]

    def get_clientName(self, obj):
        return obj.client.name if obj.client_id and obj.client else None
