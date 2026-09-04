from rest_framework import serializers
from core.models import CaseEvent
from workspace.models import HearingDetail


class CaseEventSerializer(serializers.ModelSerializer):
    """Mirrors Spring CaseEventResponseDTO (nested caseEntity)."""
    eventType = serializers.CharField(source='event_type')
    caseEntity = serializers.SerializerMethodField()
    hearingDetail = serializers.SerializerMethodField()

    class Meta:
        model = CaseEvent
        fields = ['id', 'title', 'eventType', 'description', 'date', 'time',
                  'notified', 'caseEntity', 'hearingDetail']

    def get_caseEntity(self, obj):
        if not obj.case_id:
            return None
        return {'id': obj.case.id, 'caseNumber': obj.case.case_number, 'caseTitle': obj.case.case_title}

    def get_hearingDetail(self, obj):
        return HearingDetail.payload(obj.id)
