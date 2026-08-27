from rest_framework import serializers
from .models import AppealDetection


class AppealDetectionSerializer(serializers.ModelSerializer):
    """camelCase JSON for a detected (candidate) appeal."""
    sourceCaseId = serializers.IntegerField(source='source_case_id', read_only=True)
    sourceCaseNumber = serializers.CharField(source='source_case_number', read_only=True)
    forum = serializers.CharField(source='forum_label', read_only=True)
    forumCourtId = serializers.CharField(source='forum_court_id', read_only=True)
    appealCaseNumber = serializers.CharField(source='appeal_case_number', read_only=True)
    appealCnr = serializers.CharField(source='appeal_cnr', read_only=True)
    appealParties = serializers.CharField(source='appeal_parties', read_only=True)
    appealFiledOn = serializers.DateField(source='appeal_filed_on', read_only=True)
    matchedOn = serializers.CharField(source='matched_on', read_only=True)
    matchScore = serializers.FloatField(source='match_score', read_only=True)
    detectedAt = serializers.DateTimeField(source='detected_at', read_only=True)
    notifiedEmail = serializers.BooleanField(source='notified_email', read_only=True)

    class Meta:
        model = AppealDetection
        fields = ['id', 'sourceCaseId', 'sourceCaseNumber', 'forum', 'forumCourtId',
                  'appealCaseNumber', 'appealCnr', 'appealParties', 'appealFiledOn',
                  'matchedOn', 'matchScore', 'status', 'detectedAt', 'notifiedEmail']
