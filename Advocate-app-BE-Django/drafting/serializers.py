from rest_framework import serializers
from .models import (
    Template, Sample, SampleClause, DraftSession, DraftBlock,
    Playbook, PlaybookDocument, PlaybookClause, PlaybookRisk,
)


from .files import FileUrlSerializerMixin, file_url

class TemplateSerializer(FileUrlSerializerMixin, serializers.ModelSerializer):
    file_basename = 'template'

    """Read/representation of a Template.

    slot_schema and body_json are read-only here: they are produced by parsing
    the uploaded file (see the view's create flow), not set by the client.
    """
    class Meta:
        model = Template
        fields = ('id', 'name', 'language', 'document_type', 'file', 'slot_schema', 'body_json', 'status', 'created_at')
        read_only_fields = ('slot_schema', 'body_json', 'status')


class TemplateUploadSerializer(serializers.ModelSerializer):
    """Write serializer for template creation — accepts only the file + metadata;
    the parsed body_json is filled in by the view afterwards."""
    class Meta:
        model = Template
        fields = ('id', 'name', 'language', 'document_type', 'file')


class SampleSerializer(FileUrlSerializerMixin, serializers.ModelSerializer):
    file_basename = 'sample'

    """Representation of a Sample. Pipeline-managed fields (status, translation)
    are read-only: the background tasks set them. No summary here: AMS summarises
    documents itself (documents/summarizer.py)."""
    class Meta:
        model = Sample
        fields = ('id', 'name', 'language', 'contract_type', 'variant', 'file', 'client', 'project',
                  'status',
                  'translation', 'translation_json', 'translation_target', 'translation_source',
                  'translation_status', 'ams_document_id', 'ams_version', 'created_at')
        # client/project: derived from the upload's case_id (views.SampleViewSet.create).
        read_only_fields = ('status',
                            'ams_document_id', 'ams_version', 'client', 'project',
                            'translation', 'translation_json', 'translation_target',
                            'translation_source', 'translation_status')


class SourceClauseSerializer(serializers.ModelSerializer):
    """Compact view of a cited SampleClause, nested inside a draft block so the
    UI can show what a block was drawn from — and open the source document."""
    sample_name = serializers.SerializerMethodField()
    sample_url = serializers.SerializerMethodField()

    class Meta:
        model = SampleClause
        fields = ('id', 'clause_type', 'position', 'text', 'sample_name', 'sample_url')

    def get_sample_name(self, obj):
        return obj.sample.name if obj.sample_id else None

    def get_sample_url(self, obj):
        req = self.context.get('request')
        return file_url(req, 'sample', obj.sample) if obj.sample_id else None


class DraftBlockSerializer(serializers.ModelSerializer):
    """Representation of one generated DraftBlock.

    source_clause is the cited clause's id; source_clause_detail nests its
    full text/metadata (read-only) so the client need not fetch it separately.
    """
    source_clause_detail = SourceClauseSerializer(source='source_clause', read_only=True)

    class Meta:
        model = DraftBlock
        fields = (
            'id', 'position', 'block_type', 'heading', 'text', 'content_html', 'is_edited',
            'style_json', 'source', 'source_clause', 'source_clause_detail',
            'verified', 'similarity_score',
        )


class DraftSessionSerializer(serializers.ModelSerializer):
    """Read serializer for a draft session: nests its generated blocks and
    flattens the template name + document names for convenient display."""
    blocks = DraftBlockSerializer(many=True, read_only=True)
    template_name = serializers.SerializerMethodField()
    document_type = serializers.SerializerMethodField()
    sample_names = serializers.SerializerMethodField()
    reference_documents = serializers.SerializerMethodField()
    # The linked AMS case (via the session's project), or None.
    case_id = serializers.SerializerMethodField()
    # Senior review (drafting/access.py): who wrote it, and the viewer's review role.
    created_by_name = serializers.SerializerMethodField()
    review = serializers.SerializerMethodField()

    class Meta:
        model = DraftSession
        fields = (
            'id', 'template', 'template_name', 'document_type', 'samples', 'sample_names',
            'created_by_id', 'created_by_name', 'review',
            'client', 'project', 'facts', 'mode', 'llm', 'status',
            'playbook', 'risk_status', 'risk_report', 'apply_bns_codes',
            'case_id', 'ams_task_id', 'ams_document_id', 'ams_document_version', 'ams_synced_at',
            'reference_documents', 'created_at', 'updated_at', 'blocks',
        )
        read_only_fields = ('status', 'celery_task_id', 'risk_status', 'risk_report',
                            'ams_document_id', 'ams_document_version', 'ams_synced_at')

    def get_case_id(self, obj):
        return obj.project.case_id if obj.project_id else None

    def get_created_by_name(self, obj):
        from core.models import Advocate
        a = Advocate.objects.filter(id=obj.created_by_id).only('full_name').first() if obj.created_by_id else None
        return a.full_name if a else None

    def get_review(self, obj):
        """The draft's task and what the viewer may do with it; None without a task
        or without a request (e.g. background serialisation)."""
        request = self.context.get('request')
        if request is None or not obj.ams_task_id:
            return None
        from .access import review_task
        task, can_review = review_task(obj, request.user)
        if task is None:
            return None
        from core.models import Advocate
        reviewer = (Advocate.objects.filter(id=task.reviewed_by_id).only('full_name').first()
                    if task.reviewed_by_id else None)
        is_owner = obj.created_by_id == request.user.id
        return {'taskId': task.id, 'taskTitle': task.title, 'status': task.review_status,
                'note': task.review_note, 'reviewedByName': reviewer.full_name if reviewer else None,
                'isOwner': is_owner, 'canReview': can_review,
                'canEdit': is_owner or (can_review and task.review_status == 'SUBMITTED')}

    def get_template_name(self, obj):
        """The template's name, or None when the session has no template (Mode 2)."""
        return obj.template.name if obj.template_id else None

    def get_document_type(self, obj):
        """The template's document type (used as the Mode 3 title instead of the
        template name, so a from-scratch draft doesn't reveal the template)."""
        return obj.template.document_type if obj.template_id else None

    def get_sample_names(self, obj):
        """Names of all reference documents on the session, in id order."""
        return [s.name for s in obj.samples.all()]

    def get_reference_documents(self, obj):
        """The template + samples this draft was built from, as {kind, id, name, url}
        for the editor's Reference-documents panel (absolute file URLs)."""
        req = self.context.get('request')

        def _url(f):
            if not f:
                return None
            return req.build_absolute_uri(f.url) if req else f.url

        docs = []
        if obj.template_id and obj.template.file:
            docs.append({'kind': 'template', 'id': obj.template_id,
                         'name': obj.template.name, 'url': _url(obj.template.file)})
        for s in obj.samples.all():
            if s.file:
                docs.append({'kind': 'sample', 'id': s.id, 'name': s.name, 'url': _url(s.file)})
        return docs


class DraftSessionCreateSerializer(serializers.ModelSerializer):
    """Write serializer for starting a draft session — accepts the inputs the
    generation engine needs (optional template, document set, facts, llm)."""
    # Documents are optional at the field level (Mode 3 sends none); the "≥1 for the
    # reference flow" rule is enforced in validate() below.
    samples = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Sample.objects.all(), required=False, allow_empty=True,
    )

    class Meta:
        model = DraftSession
        fields = ('template', 'samples', 'project', 'facts', 'llm', 'mode',
                  'apply_bns_codes', 'ams_task_id')

    def validate(self, attrs):
        """Mode 3 (library / from-scratch) needs a template but no documents; the
        reference flow needs at least one document and derives Mode 1 vs 2 from
        whether a template was chosen. The drafting client is the project's (the AMS
        case's); it is never sent separately (merge phase 08)."""
        # Only documents this advocate may see (their practice's; drafting/access.py).
        request = self.context.get('request')
        if request is not None and attrs.get('samples'):
            from .access import visible_samples
            allowed = set(visible_samples(request.user).filter(
                id__in=[s.id for s in attrs['samples']]).values_list('id', flat=True))
            if any(s.id not in allowed for s in attrs['samples']):
                raise serializers.ValidationError({'samples': 'One or more documents are not available to you.'})
        # An AMS task only makes sense on a draft linked to an AMS case.
        project = attrs.get('project')
        attrs['client'] = project.client if project is not None else None
        if attrs.get('ams_task_id') and not getattr(project, 'case_id', None):
            raise serializers.ValidationError(
                {'ams_task_id': 'Link an AMS case before attaching an AMS task.'})
        # Drafting projects are shared rows: the case behind one, and the task, must be
        # in the caller's practice (the same scope as /api/drafting/link-case/).
        if request is not None and getattr(project, 'case_id', None):
            from core.models import Case
            from core.practice import practice_ids
            practice = practice_ids(request.user)
            if not Case.objects.filter(id=project.case_id, advocate_id__in=practice, deleted=False).exists():
                raise serializers.ValidationError({'project': 'Case not found.'})
            if attrs.get('ams_task_id'):
                from workspace.models import CaseTask
                if not CaseTask.objects.filter(id=attrs['ams_task_id'], case_id=project.case_id,
                                               advocate_id__in=practice).exists():
                    raise serializers.ValidationError({'ams_task_id': 'Task not found on this case.'})
        if attrs.get('mode') == DraftSession.Mode.LIBRARY:
            if not attrs.get('template'):
                raise serializers.ValidationError(
                    {'template': 'A template (document type) is required to draft from the library.'})
            return attrs
        if not attrs.get('samples'):
            raise serializers.ValidationError({'samples': 'Select at least one document.'})
        attrs['mode'] = (DraftSession.Mode.TEMPLATE if attrs.get('template')
                         else DraftSession.Mode.SAMPLE)
        return attrs

    def create(self, validated_data):
        """Stamp the requesting user as the session creator, then create it.

        `samples` is a M2M — ModelSerializer sets it after the instance is saved.
        """
        validated_data['created_by_id'] = self.context['request'].user.id   # the AMS advocate
        # Gemini-only for now — always draft with Gemini regardless of the request body.
        validated_data['llm'] = 'gemini'
        return super().create(validated_data)


# ── Playbook serializers ───────────────────────────────────────────────────────

class PlaybookDocumentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlaybookDocument
        fields = ('id', 'file', 'original_filename', 'created_at')
        read_only_fields = ('original_filename',)


class PlaybookClauseSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlaybookClause
        fields = (
            'id', 'clause_type', 'position', 'standard_text',
            'red_lines', 'fallback_positions', 'notes', 'source_doc_count',
        )


class PlaybookClauseWriteSerializer(serializers.ModelSerializer):
    """Create / update a PlaybookClause. Re-embeds standard_text when it changes."""
    class Meta:
        model = PlaybookClause
        fields = (
            'id', 'playbook', 'clause_type', 'position',
            'standard_text', 'red_lines', 'fallback_positions', 'notes',
        )
        read_only_fields = ('id',)

    def _embed(self, text: str):
        from .providers.embeddings import get_embeddings
        return get_embeddings().embed(text)

    def create(self, validated_data):
        clause = super().create(validated_data)
        if clause.standard_text:
            clause.embedding = self._embed(clause.standard_text)
            clause.save(update_fields=['embedding'])
        return clause

    def update(self, instance, validated_data):
        re_embed = (
            'standard_text' in validated_data
            and validated_data['standard_text'] != instance.standard_text
        )
        instance = super().update(instance, validated_data)
        if re_embed and instance.standard_text:
            instance.embedding = self._embed(instance.standard_text)
            instance.save(update_fields=['embedding'])
        return instance


class PlaybookRiskSerializer(serializers.ModelSerializer):
    block_heading = serializers.SerializerMethodField()
    clause_type = serializers.SerializerMethodField()

    class Meta:
        model = PlaybookRisk
        fields = (
            'id', 'block', 'block_heading', 'playbook_clause', 'clause_type',
            'severity', 'issue', 'suggestion', 'quote', 'status', 'created_at',
        )
        read_only_fields = ('block', 'playbook_clause', 'severity', 'issue',
                            'suggestion', 'quote', 'created_at')

    def get_block_heading(self, obj):
        return obj.block.heading if obj.block_id else None

    def get_clause_type(self, obj):
        return obj.playbook_clause.clause_type if obj.playbook_clause_id else None


class PlaybookSerializer(serializers.ModelSerializer):
    """Full read representation of a Playbook — includes its clauses."""
    clauses = PlaybookClauseSerializer(many=True, read_only=True)
    document_count = serializers.SerializerMethodField()

    class Meta:
        model = Playbook
        fields = (
            'id', 'name', 'category', 'description', 'method', 'llm_provider', 'status',
            'document_count', 'clauses', 'created_at', 'updated_at',
        )
        read_only_fields = ('status',)

    def get_document_count(self, obj):
        return obj.documents.count()


class PlaybookListSerializer(serializers.ModelSerializer):
    """Lightweight list view — no clauses embedded."""
    document_count = serializers.SerializerMethodField()

    class Meta:
        model = Playbook
        fields = (
            'id', 'name', 'category', 'description', 'method', 'llm_provider', 'status',
            'document_count', 'created_at', 'updated_at',
        )

    def get_document_count(self, obj):
        return obj.documents.count()


class PlaybookCreateSerializer(serializers.ModelSerializer):
    """Write serializer — accepts documents as a multi-file upload."""
    documents = serializers.ListField(
        child=serializers.FileField(), write_only=True, required=False, allow_empty=True,
    )

    class Meta:
        model = Playbook
        fields = ('name', 'category', 'description', 'method', 'llm_provider', 'documents')

    def validate(self, attrs):
        method = attrs.get('method')
        docs = attrs.get('documents') or []
        if method == Playbook.Method.DOCUMENT and not docs:
            raise serializers.ValidationError(
                {'documents': 'Upload at least one document to generate a playbook.'}
            )
        return attrs

    def create(self, validated_data):
        docs = validated_data.pop('documents', [])
        validated_data['created_by_id'] = self.context['request'].user.id   # the AMS advocate
        playbook = super().create(validated_data)
        for f in docs:
            PlaybookDocument.objects.create(
                playbook=playbook,
                file=f,
                original_filename=f.name,
            )
        return playbook
