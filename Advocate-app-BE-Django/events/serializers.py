from rest_framework import serializers
from core.models import CaseEvent


class CaseEventSerializer(serializers.ModelSerializer):
    """Mirrors Spring CaseEventResponseDTO (nested caseEntity)."""
    eventType = serializers.CharField(source='event_type')
    caseEntity = serializers.SerializerMethodField()

    class Meta:
        model = CaseEvent
        fields = ['id', 'title', 'eventType', 'description', 'date', 'time', 'notified', 'caseEntity']

    def get_caseEntity(self, obj):
        if not obj.case_id:
            return None
        return {'id': obj.case.id, 'caseNumber': obj.case.case_number, 'caseTitle': obj.case.case_title}
