from rest_framework import serializers
from core.models import Case, Document, Advocate
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
    createdById = serializers.IntegerField(source='advocate_id', read_only=True)
    assignedToId = serializers.SerializerMethodField()
    assignedToName = serializers.SerializerMethodField()
    assignedById = serializers.IntegerField(source='assigned_by_id', read_only=True, allow_null=True)
    assignedByName = serializers.SerializerMethodField()
    # Senior review (workspace/review.py).
    needsReview = serializers.SerializerMethodField()
    reviewStatus = serializers.CharField(source='review_status', read_only=True, allow_null=True)
    reviewNote = serializers.CharField(source='review_note', read_only=True, allow_null=True)
    submittedAt = serializers.DateTimeField(source='submitted_at', read_only=True, allow_null=True)
    reviewedAt = serializers.DateTimeField(source='reviewed_at', read_only=True, allow_null=True)
    reviewedByName = serializers.SerializerMethodField()
    # The drafting session written for this task (drafting/filing.py), so a reviewer
    # can open it in the editor. Latest one if the task has several.
    draftSessionId = serializers.SerializerMethodField()

    class Meta:
        model = CaseTask
        fields = ['id', 'caseId', 'caseNumber', 'caseTitle', 'title', 'priority',
                  'deadline', 'completed', 'cancelled', 'createdAt', 'documents',
                  'createdById', 'assignedToId', 'assignedToName', 'assignedById',
                  'assignedByName', 'needsReview', 'reviewStatus', 'reviewNote',
                  'submittedAt', 'reviewedAt', 'reviewedByName', 'draftSessionId']

    def _name(self, advocate_id):
        if not advocate_id:
            return None
        cache = self.context.setdefault('_adv_names', {}) if isinstance(self.context, dict) else None
        if cache is not None and advocate_id in cache:
            return cache[advocate_id]
        a = Advocate.objects.filter(id=advocate_id).only('full_name').first()
        name = a.full_name if a else None
        if cache is not None:
            cache[advocate_id] = name
        return name

    def get_assignedToId(self, obj):
        # NULL assignee means the task is the creator's own.
        return obj.assigned_to_id or obj.advocate_id

    def get_assignedToName(self, obj):
        return self._name(obj.assigned_to_id or obj.advocate_id)

    def get_assignedByName(self, obj):
        return self._name(obj.assigned_by_id)

    def get_needsReview(self, obj):
        from .review import needs_review
        return needs_review(obj)

    def get_reviewedByName(self, obj):
        return self._name(obj.reviewed_by_id)

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

    def get_draftSessionId(self, obj):
        # One query for the whole list: on the first row, look up every task in it.
        cache = self.context.get('_draft_sessions')
        if cache is None:
            parent = getattr(self, 'parent', None)
            rows = list(parent.instance) if parent is not None and parent.instance is not None else [obj]
            from drafting.models import DraftSession
            cache = {}
            for task_id, sid in (DraftSession.objects.filter(ams_task_id__in=[t.id for t in rows])
                                 .order_by('created_at').values_list('ams_task_id', 'id')):
                cache[task_id] = sid                  # later sessions overwrite: the latest wins
            self.context['_draft_sessions'] = cache
        return cache.get(obj.id)

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
