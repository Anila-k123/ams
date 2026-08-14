from rest_framework import serializers
from core.models import Case, Document
from .models import CaseNote, CaseTag, CaseTask, CaseParty, RelatedCase, CaseTaskDocument


class CaseNoteSerializer(serializers.ModelSerializer):
    caseId = serializers.IntegerField(source='case_id', read_only=True)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)

    class Meta:
        model = CaseNote
        fields = ['id', 'caseId', 'body', 'createdAt']


class CaseTagSerializer(serializers.ModelSerializer):
    caseId = serializers.IntegerField(source='case_id', read_only=True)

    class Meta:
        model = CaseTag
        fields = ['id', 'caseId', 'label', 'color']


class CaseTaskSerializer(serializers.ModelSerializer):
    caseId = serializers.IntegerField(source='case_id', read_only=True, allow_null=True)
    createdAt = serializers.DateTimeField(source='created_at', read_only=True)
    caseNumber = serializers.SerializerMethodField()
    caseTitle = serializers.SerializerMethodField()
    documents = serializers.SerializerMethodField()

    class Meta:
        model = CaseTask
        fields = ['id', 'caseId', 'caseNumber', 'caseTitle', 'title', 'priority',
                  'deadline', 'completed', 'createdAt', 'documents']

    def _case(self, obj):
        if not obj.case_id:
            return None
        return Case.objects.filter(id=obj.case_id).only('case_number', 'case_title').first()

    def get_caseNumber(self, obj):
        c = self._case(obj)
        return c.case_number if c else None

    def get_caseTitle(self, obj):
        c = self._case(obj)
        return c.case_title if c else None

    def get_documents(self, obj):
        links = CaseTaskDocument.objects.filter(task_id=obj.id)
        ids = [l.document_id for l in links]
        if not ids:
            return []
        docs = {d.id: d for d in Document.objects.filter(id__in=ids)}
        return [{'id': did, 'name': docs[did].document_name if did in docs else f'Document #{did}'}
                for did in ids]


class CasePartySerializer(serializers.ModelSerializer):
    caseId = serializers.IntegerField(source='case_id', read_only=True)
    isOpponent = serializers.BooleanField(source='is_opponent', required=False)

    class Meta:
        model = CaseParty
        fields = ['id', 'caseId', 'name', 'role', 'counsel', 'contact', 'isOpponent']
