from rest_framework import serializers
from .models import AppealAlert


class AppealAlertSerializer(serializers.ModelSerializer):
    """camelCase JSON matching the frontend form fields."""
    caseNumber = serializers.CharField(source='case_number', allow_null=True, allow_blank=True, required=False)
    caseYear = serializers.CharField(source='case_year', allow_null=True, allow_blank=True, required=False)
    dateOfJudgement = serializers.DateField(source='judgement_date', allow_null=True, required=False)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)

    class Meta:
        model = AppealAlert
        fields = ['id', 'forum', 'court', 'state', 'caseNumber', 'caseYear',
                  'dateOfJudgement', 'createdAt']
