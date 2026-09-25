import time
from django.db.models import ProtectedError
from django.shortcuts import get_object_or_404
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from .files import FileDownloadMixin
from .models import Template, Sample, DraftSession, Playbook, PlaybookClause, PlaybookRisk
from .serializers import (
    TemplateSerializer, TemplateUploadSerializer,
    SampleSerializer, DraftSessionSerializer, DraftSessionCreateSerializer,
    PlaybookSerializer, PlaybookListSerializer, PlaybookCreateSerializer,
    PlaybookClauseSerializer, PlaybookClauseWriteSerializer, PlaybookRiskSerializer,
)


class ProtectedDeleteMixin:
    """Return a clean 409 instead of a 500 when deleting a row a draft still references."""

    def destroy(self, request, *args, **kwargs):
        """Delete the object; map a PROTECT violation to 409 and tidy up its file."""
        instance = self.get_object()
        # A PROTECT FK (e.g. a draft session referencing this row) blocks deletion.
        try:
            self.perform_destroy(instance)
        except ProtectedError:
            return Response(
                {'detail': 'Cannot delete — it is still used by one or more draft sessions.'},
                status=status.HTTP_409_CONFLICT,
            )
        # Best-effort: remove the uploaded file from disk.
        file_field = getattr(instance, 'file', None)
        if file_field:
            file_field.delete(save=False)
        return Response(status=status.HTTP_204_NO_CONTENT)


def _dispatch(task, *args):
    """Start a background job without blocking the request; the client polls status.

    Celery worker when CELERY_TASK_ALWAYS_EAGER=False (the permanent setup), else a
    separate worker process on this machine (a stopgap). See drafting/jobs.py."""
    from .jobs import dispatch
    dispatch(task, *args)


# Drafting clients / projects are not edited through the API (merge phase 08): they
# are mirrors of AMS clients and cases, created by /api/drafting/link-case/ and by
# uploads that carry case_id (drafting/ams_cases.py). Members were retired.


class TemplateViewSet(FileDownloadMixin, ProtectedDeleteMixin, viewsets.ModelViewSet):
    """CRUD endpoints for templates. Creation uploads a file that is parsed
    into clause slots; deletion is protected if a draft session uses it."""
    queryset = Template.objects.all().order_by('-created_at')
    serializer_class = TemplateSerializer

    def get_serializer_class(self):
        """Use the upload (write) serializer on create, the full one otherwise."""
        if self.action == 'create':
            return TemplateUploadSerializer
        return TemplateSerializer

    def create(self, request, *args, **kwargs):
        """Save the uploaded file, then parse + name its clause slots in the
        BACKGROUND (process_template). Returns immediately with status=processing so
        the UI shows the template card in a Processing state and polls until ready —
        the user isn't blocked on a modal."""
        # Dedup guard: if a template with the same (name, document_type) already
        # exists, return it instead of re-uploading + re-parsing a duplicate.
        name = (request.data.get('name') or '').strip()
        doc_type = (request.data.get('document_type') or '').strip()
        if name:
            existing = (Template.objects
                        .filter(name__iexact=name, document_type__iexact=doc_type)
                        .order_by('id').first())
            if existing:
                return Response(TemplateSerializer(existing).data, status=status.HTTP_200_OK)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # Templates accept PDF or DOCX. DOCX also captures formatting
        # (font/size/colour/alignment) so the draft reproduces the template's look;
        # PDF templates give clause STRUCTURE only (Docling), without style fidelity.
        upload = request.data.get('file')
        if upload and not str(getattr(upload, 'name', '')).lower().endswith(('.docx', '.pdf')):
            return Response(
                {'detail': 'Templates must be a PDF or DOCX file.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        template = serializer.save(status=Template.Status.PROCESSING)
        # Parse + name the slots in the background; the client polls status.
        from .tasks import process_template
        _dispatch(process_template, template.id)
        return Response(TemplateSerializer(template).data, status=status.HTTP_201_CREATED)


class SampleViewSet(FileDownloadMixin, ProtectedDeleteMixin, viewsets.ModelViewSet):
    """CRUD endpoints for samples, plus an on-demand summary action. Uploading
    a sample kicks off async parsing/embedding; deletion is protected."""
    serializer_class = SampleSerializer

    def get_queryset(self):
        """All samples, narrowed to one project when ?project=<id> is given.

        Ordered newest-first: the list is paginated (PAGE_SIZE), so without a
        stable order a freshly uploaded sample can land off page 1 and never
        appear in the Documents list.
        """
        # The advocate's practice's documents (drafting/access.py).
        from .access import visible_samples
        qs = visible_samples(self.request.user).order_by('-created_at')
        project_id = self.request.query_params.get('project')
        if project_id:
            qs = qs.filter(project_id=project_id)
        return qs

    def create(self, request, *args, **kwargs):
        """Dedup guard: if a document with the same (name, contract_type, variant)
        already exists, return it instead of re-uploading + re-processing a copy.
        (Merge phase 07 also files uploads as AMS documents.)"""
        from .access import visible_samples
        name = (request.data.get('name') or '').strip()
        contract_type = (request.data.get('contract_type') or '').strip()
        variant = (request.data.get('variant') or 'any').strip()
        if name:
            existing = (visible_samples(request.user)
                        .filter(name__iexact=name,
                                contract_type__iexact=contract_type,
                                variant__iexact=variant)
                        .order_by('id').first())
            if existing:
                return Response(SampleSerializer(existing).data, status=status.HTTP_200_OK)
        # Optional AMS case (merge phase 04): the drafting client/project are derived
        # from it (drafting/ams_cases.py) instead of being picked by hand.
        self._linked = None
        raw_case = request.data.get('case_id')
        if raw_case not in (None, ''):
            from .ams_cases import _cases, link_case
            try:
                case = _cases(request.user).filter(id=int(raw_case)).first()
            except (TypeError, ValueError):
                case = None
            if case is None:
                return Response({'case_id': ['Case not found.']}, status=status.HTTP_400_BAD_REQUEST)
            self._linked = link_case(case)
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        """Save the sample under the requesting user, then dispatch processing."""
        extra = {}
        if getattr(self, '_linked', None):
            extra['client'], extra['project'] = self._linked
        instance = serializer.save(uploaded_by_id=self.request.user.id, **extra)   # the AMS advocate
        # Parse + embed the file in the background; client polls status.
        from .tasks import process_sample
        _dispatch(process_sample, instance.id)

    # No drafting summary action: documents are summarised by AMS on upload
    # (documents/summarizer.py), one summary per AMS document.

    @action(detail=True, methods=['post'])
    def translate(self, request, pk=None):
        """Kick off translation into the chosen target language. Async — poll the
        sample (GET /samples/{id}/) until translation_status is 'ready'/'failed'."""
        sample = self.get_object()
        if sample.status != Sample.Status.READY:
            return Response(
                {'detail': 'Document is still being processed — wait until it is ready.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        target = request.data.get('target') or 'en'
        sample.translation_status = Sample.TranslationStatus.GENERATING
        sample.translation_target = target
        sample.save(update_fields=['translation_status', 'translation_target'])
        from .tasks import translate_sample
        _dispatch(translate_sample, sample.id, target)
        return Response(
            {'id': sample.id, 'translation_status': sample.translation_status},
            status=status.HTTP_202_ACCEPTED,
        )


class DraftSessionViewSet(viewsets.ModelViewSet):
    """Endpoints for draft sessions. Users see only their own sessions;
    creating one launches the generation task, with a status-polling action."""
    serializer_class = DraftSessionSerializer

    # Senior review (drafting/access.py): a reviewer may open a junior's submitted draft
    # and use these read-only actions (refine / consistency-check only return
    # suggestions)...
    REVIEW_READ = {'retrieve', 'status', 'refine', 'consistency_check', 'list_risks', 'risk_report'}
    # ...and edit it while the task awaits their review. Re-draft, delete, legal-code
    # rewrite, risk runs and filing stay with the author.
    REVIEW_WRITE = {'save_blocks', 'edit', 'accept_edit', 'reject_edit'}

    def get_queryset(self):
        """The requesting user's sessions (plus, for review actions, drafts submitted
        to them), newest first, with blocks prefetched."""
        from .access import own_sessions, viewable_sessions
        user = self.request.user
        base = (viewable_sessions(user) if self.action in self.REVIEW_READ | self.REVIEW_WRITE
                else own_sessions(user))
        # Blocks cite a clause of a source document: prefetch those too, else each
        # block costs two more queries (the list ran ~60 queries for 4 drafts).
        return (base.select_related('template', 'project')
                .order_by('-created_at')
                .prefetch_related('blocks__source_clause__sample', 'samples'))

    def get_object(self):
        obj = super().get_object()
        if self.action in self.REVIEW_WRITE:
            from rest_framework.exceptions import PermissionDenied
            from .access import can_write
            if not can_write(obj, self.request.user):
                raise PermissionDenied('This draft can only be edited while it awaits your review.')
        return obj

    def get_serializer_class(self):
        """Use the create (write) serializer on create, the full one otherwise."""
        if self.action == 'create':
            return DraftSessionCreateSerializer
        return DraftSessionSerializer

    def create(self, request, *args, **kwargs):
        """Create the session, dispatch draft generation, return the full session."""
        serializer = self.get_serializer(data=request.data, context={'request': request})
        serializer.is_valid(raise_exception=True)
        session = serializer.save()
        # Generate the draft blocks in the background; client polls status.
        from .tasks import generate_draft
        _dispatch(generate_draft, session.id)
        return Response(DraftSessionSerializer(session, context={'request': request}).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def status(self, request, pk=None):
        """Lightweight status poll — returns just the session's id and status."""
        session = self.get_object()
        return Response({'id': session.id, 'status': session.status, 'risk_status': session.risk_status})

    @action(detail=True, methods=['post'], url_path='save-blocks')
    def save_blocks(self, request, pk=None):
        """Persist editor changes to this session's blocks. Body: a list of
        {id, heading, content_html, text}; each block that belongs to this session
        is updated and flagged is_edited. Returns the refreshed session."""
        session = self.get_object()
        from .models import DraftBlock
        items = request.data if isinstance(request.data, list) else request.data.get('blocks', [])
        by_id = {b.id: b for b in session.blocks.all()}
        to_update = []
        for item in items:
            block = by_id.get(item.get('id'))
            if not block:
                continue  # ignore ids not in this session
            block.heading = item.get('heading', block.heading)
            block.content_html = item.get('content_html', block.content_html)
            block.text = item.get('text', block.text)
            block.is_edited = True
            to_update.append(block)
        if to_update:
            DraftBlock.objects.bulk_update(to_update, ['heading', 'content_html', 'text', 'is_edited'])
        return Response(DraftSessionSerializer(session, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def edit(self, request, pk=None):
        """Chat-edit: locate the clause an instruction refers to, propose a rewrite,
        and record it as a PENDING DraftEdit. Does not change the block yet."""
        session = self.get_object()
        from .services.edit import locate_clause, rewrite_clause, text_to_html
        from .models import DraftEdit
        instruction = (request.data.get('instruction') or '').strip()
        if not instruction:
            return Response({'detail': 'Enter an instruction.'}, status=status.HTTP_400_BAD_REQUEST)
        focused = request.data.get('focused_block_id')
        base_text = request.data.get('current_text')  # editor's live text, if sent
        model = request.data.get('model') or session.llm  # chat-picked model (Gemini)

        t0 = time.time()
        block = locate_clause(session, instruction, focused, model=model)
        if not block:
            return Response({'detail': "Couldn't match a clause to that instruction."},
                            status=status.HTTP_404_NOT_FOUND)
        # Use the editor's live text only if it targets the located block.
        live = base_text if (focused and block.id == int(focused)) else None
        result = rewrite_clause(session, block, instruction, base_text=live, model=model)
        edit = DraftEdit.objects.create(
            session=session, block=block, instruction=instruction,
            before_text=(live if live is not None else block.text),
            after_text=result['new_text'],
            before_html=block.content_html or text_to_html(block.text),
            after_html=text_to_html(result['new_text']),
            heading=result['new_heading'], rationale=result['rationale'],
            status=DraftEdit.Status.PENDING, created_by_id=request.user.id,
        )
        # Flag a likely content-drop: the revision is far shorter than the original.
        shrunk = len(edit.before_text) > 200 and len(edit.after_text) < 0.5 * len(edit.before_text)
        return Response({
            'edit_id': edit.id, 'block_id': block.id, 'heading': block.heading,
            'before_text': edit.before_text, 'after_text': edit.after_text,
            'after_html': edit.after_html, 'new_heading': edit.heading,
            'rationale': edit.rationale, 'model': model, 'shrunk': shrunk,
            'elapsed_ms': int((time.time() - t0) * 1000),
        })

    @action(detail=True, methods=['post'], url_path='refine')
    def refine(self, request, pk=None):
        """Whole-document refine: apply an action ('formal'|'concise'|'grammar') to
        every clause and return only the clauses that actually changed. Body:
        {action, clauses?: [{block_id, heading, text}], model?}. `clauses` is the
        editor's live content (so it refines unsaved edits); falls back to saved
        blocks. Nothing is persisted — the editor patches + Save apply the changes."""
        import re as _re
        session = self.get_object()
        from .services.edit import refine_clause, refine_clauses_batch, text_to_html, REFINE_DIRECTIVES
        action_key = (request.data.get('action') or '').strip()
        if action_key not in REFINE_DIRECTIVES:
            return Response({'detail': 'Unknown refine action.'}, status=status.HTTP_400_BAD_REQUEST)
        model = request.data.get('model') or session.llm or 'gemini'
        by_id = {b.id: b for b in session.blocks.all()}
        clauses = request.data.get('clauses') or [
            {'block_id': b.id, 'heading': b.heading, 'text': b.text}
            for b in session.blocks.all().order_by('position')
        ]

        # Strategy by model: a CLOUD model (Gemini) refines all clauses in ONE batched
        # call (a call per clause would waste tokens on the repeated system prompt);
        # the LOCAL model goes clause-by-clause. A batch that returns some clauses but
        # misses others still falls back per-clause for just those (the API is
        # responsive). But if the batched CALL itself fails (None — e.g. rate-limited),
        # do NOT fan out one request per clause into the same limit: fail cleanly.
        if model == 'local':
            batch = {}
        else:
            batch = refine_clauses_batch(session, clauses, action_key, model)
            if batch is None:
                return Response(
                    {'detail': 'The model is rate-limited right now — try again shortly, '
                               'or switch to the Local model.'},
                    status=status.HTTP_429_TOO_MANY_REQUESTS,
                )

        norm = lambda s: _re.sub(r'\s+', ' ', s or '').strip()
        t0, results = time.time(), []
        for c in clauses:
            block = by_id.get(c.get('block_id'))
            if not block:
                continue
            before = (c.get('text') if c.get('text') is not None else block.text) or ''
            after = batch.get(block.id)
            if after is None:  # local model, or the batch didn't return this clause
                after = refine_clause(session, block, action_key, base_text=before, model=model)
            if norm(after) == norm(before):
                continue  # unchanged — skip (common for grammar)
            results.append({
                'block_id': block.id, 'heading': c.get('heading') or block.heading,
                'before_text': before, 'after_text': after, 'after_html': text_to_html(after),
                # Content-loss guard: the revision is far shorter than the original
                # (a "concise" pass can silently drop a carve-out / liability cap).
                'shrunk': len(before) > 200 and len(after) < 0.5 * len(before),
            })
        return Response({
            'action': action_key, 'results': results, 'changed': len(results),
            'model': model, 'elapsed_ms': int((time.time() - t0) * 1000),
        })

    @action(detail=True, methods=['post'], url_path='consistency-check')
    def consistency_check(self, request, pk=None):
        """Review the whole draft for contradictions and loose ends. Body:
        {clauses?: [{block_id, heading, text}], model?}. When `clauses` is sent
        (the editor's live content) it's checked as-is; otherwise the saved blocks
        are used. Returns {findings, checked, model, elapsed_ms}."""
        session = self.get_object()
        from .services.consistency import check_consistency
        clauses = request.data.get('clauses')
        if not clauses:
            clauses = [{'block_id': b.id, 'heading': b.heading, 'text': b.text}
                       for b in session.blocks.all().order_by('position')]
        model = request.data.get('model') or session.llm or 'gemini'
        t0 = time.time()
        findings = check_consistency(clauses, session.facts, model=model)
        return Response({
            'findings': findings, 'checked': len(clauses), 'model': model,
            'elapsed_ms': int((time.time() - t0) * 1000),
        })

    @action(detail=True, methods=['post'], url_path=r'edit/(?P<edit_id>[0-9]+)/accept')
    def accept_edit(self, request, pk=None, edit_id=None):
        """Mark a proposed edit accepted (audit). The clause is patched in the
        editor and persisted by the normal Save (save-blocks), so the lawyer
        controls when edits are written."""
        from .models import DraftEdit
        session = self.get_object()
        edit = get_object_or_404(DraftEdit, id=edit_id, session=session)
        edit.status = DraftEdit.Status.ACCEPTED
        edit.save(update_fields=['status'])
        return Response({'status': 'accepted'})

    @action(detail=True, methods=['post'], url_path=r'edit/(?P<edit_id>[0-9]+)/reject')
    def reject_edit(self, request, pk=None, edit_id=None):
        """Discard a proposed edit."""
        from .models import DraftEdit
        session = self.get_object()
        edit = get_object_or_404(DraftEdit, id=edit_id, session=session)
        edit.status = DraftEdit.Status.REJECTED
        edit.save(update_fields=['status'])
        return Response({'status': 'rejected'})

    @action(detail=True, methods=['post'], url_path='regenerate')
    def regenerate(self, request, pk=None):
        """Wipe the existing draft blocks and re-run generation with the same inputs.

        Returns 409 if already generating. Client should poll /status/ until
        status transitions back to 'ready' or 'failed'.
        """
        from .models import DraftBlock
        from .tasks import generate_draft
        session = self.get_object()
        if session.status in (DraftSession.Status.PENDING, DraftSession.Status.GENERATING):
            return Response({'detail': 'Already generating.'}, status=status.HTTP_409_CONFLICT)
        DraftBlock.objects.filter(session=session).delete()
        session.status = DraftSession.Status.PENDING
        session.save(update_fields=['status'])
        _dispatch(generate_draft, session.id)
        return Response({'id': session.id, 'status': session.status})

    @action(detail=True, methods=['post'], url_path='update-legal-codes')
    def update_legal_codes(self, request, pk=None):
        """Re-apply BNS/BNSS/BSA legal-code replacements to every block in this session.

        Safe to call multiple times — already-replaced references are left unchanged
        (the old IPC/CrPC text is no longer present). Returns a summary:
        {session_id, blocks_scanned, blocks_updated, total_replacements}
        """
        from .services.legal_codes import patch_draft_session
        session = self.get_object()
        summary = patch_draft_session(session.id)
        return Response(summary)

    @action(detail=True, methods=['post'], url_path='analyse-risks')
    def analyse_risks(self, request, pk=None):
        """Attach a playbook to this session (if provided) and enqueue the
        analyse_risks task. Returns immediately; poll risk_status for progress."""
        from .tasks import analyse_risks as analyse_risks_task
        session = self.get_object()
        playbook_id = request.data.get('playbook_id')
        if playbook_id:
            try:
                pb = Playbook.objects.get(id=playbook_id)
            except Playbook.DoesNotExist:
                return Response({'detail': 'Playbook not found.'}, status=status.HTTP_404_NOT_FOUND)
            session.playbook = pb
            session.save(update_fields=['playbook'])
        if not session.playbook_id:
            return Response(
                {'detail': 'No playbook attached. Pass playbook_id.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        session.risk_status = 'idle'
        session.save(update_fields=['risk_status'])
        _dispatch(analyse_risks_task, session.id)
        return Response({'risk_status': 'analyzing'})

    @action(detail=True, methods=['get'], url_path='risks')
    def list_risks(self, request, pk=None):
        """Return all PlaybookRisk rows for this session."""
        from .models import PlaybookRisk
        session = self.get_object()
        risks = (
            PlaybookRisk.objects
            .filter(session=session)
            .select_related('block', 'playbook_clause')
            .order_by('severity', 'created_at')
        )
        return Response(PlaybookRiskSerializer(risks, many=True).data)

    @action(detail=True, methods=['get'], url_path='risk-report')
    def risk_report(self, request, pk=None):
        """Return the document-level risk report synthesised by analyse_risks,
        or null if it hasn't run yet."""
        session = self.get_object()
        return Response(session.risk_report)

    @action(detail=True, methods=['patch'], url_path=r'risks/(?P<risk_id>[0-9]+)/status')
    def update_risk_status(self, request, pk=None, risk_id=None):
        """Accept or dismiss a single risk finding."""
        from .models import PlaybookRisk
        session = self.get_object()
        risk = get_object_or_404(PlaybookRisk, id=risk_id, session=session)
        new_status = request.data.get('status')
        if new_status not in (PlaybookRisk.RiskStatus.ACCEPTED, PlaybookRisk.RiskStatus.DISMISSED,
                               PlaybookRisk.RiskStatus.OPEN):
            return Response({'detail': 'Invalid status.'}, status=status.HTTP_400_BAD_REQUEST)
        risk.status = new_status
        risk.save(update_fields=['status'])
        return Response({'status': risk.status})


class PlaybookViewSet(viewsets.ModelViewSet):
    """CRUD for Playbooks + actions to trigger processing and risk analysis."""
    queryset = Playbook.objects.prefetch_related('documents', 'clauses').order_by('-created_at')

    def get_serializer_class(self):
        if self.action == 'create':
            return PlaybookCreateSerializer
        if self.action in ('list',):
            return PlaybookListSerializer
        return PlaybookSerializer

    def get_parsers(self):
        """Accept multipart/form-data so documents can be uploaded with the create request."""
        from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
        return [MultiPartParser(), FormParser(), JSONParser()]

    def create(self, request, *args, **kwargs):
        """Create the Playbook (+ upload documents), then enqueue processing if method=document."""
        from .tasks import process_playbook
        # Dedup guard: return the existing playbook (200) instead of creating a
        # second row with the same (name, category).
        name = (request.data.get('name') or '').strip()
        category = (request.data.get('category') or '').strip()
        if name:
            existing = (Playbook.objects
                        .filter(name__iexact=name, category__iexact=category)
                        .order_by('id').first())
            if existing:
                out = PlaybookSerializer(existing, context={'request': request})
                return Response(out.data, status=status.HTTP_200_OK)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        playbook = serializer.save()
        if playbook.method == Playbook.Method.DOCUMENT:
            _dispatch(process_playbook, playbook.id)
        else:
            # Scratch playbooks are immediately ready (no extraction needed).
            playbook.status = Playbook.Status.READY
            playbook.save(update_fields=['status'])
        out = PlaybookSerializer(playbook, context={'request': request})
        return Response(out.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='reprocess')
    def reprocess(self, request, pk=None):
        """Re-run the extraction + synthesis pipeline (e.g. after adding more documents)."""
        from .tasks import process_playbook
        from .models import PlaybookClause, PlaybookClauseRaw
        playbook = self.get_object()
        if playbook.status == Playbook.Status.PROCESSING:
            return Response({'detail': 'Already processing.'}, status=status.HTTP_409_CONFLICT)
        # Wipe existing output so we start clean.
        PlaybookClause.objects.filter(playbook=playbook).delete()
        PlaybookClauseRaw.objects.filter(playbook=playbook).delete()
        playbook.status = Playbook.Status.PENDING
        playbook.save(update_fields=['status'])
        _dispatch(process_playbook, playbook.id)
        return Response({'status': 'processing'})

    @action(detail=True, methods=['get'], url_path='risks')
    def list_risks(self, request, pk=None):
        """List all PlaybookRisk rows for every session that uses this playbook."""
        from .models import PlaybookRisk
        playbook = self.get_object()
        risks = PlaybookRisk.objects.filter(
            session__playbook=playbook
        ).select_related('block', 'playbook_clause').order_by('session_id', 'severity')
        return Response(PlaybookRiskSerializer(risks, many=True).data)

    @action(detail=True, methods=['post'], url_path='add-documents')
    def add_documents(self, request, pk=None):
        """Upload additional source documents to an existing playbook."""
        from .models import PlaybookDocument
        playbook = self.get_object()
        files = request.FILES.getlist('documents')
        if not files:
            return Response({'detail': 'No files provided.'}, status=status.HTTP_400_BAD_REQUEST)
        for f in files:
            PlaybookDocument.objects.create(
                playbook=playbook, file=f, original_filename=f.name
            )
        return Response({'added': len(files)})


class PlaybookClauseViewSet(viewsets.ModelViewSet):
    """CRUD for individual PlaybookClause rows.

    Supports create, update (PATCH), and delete. Re-embeds standard_text
    on save so semantic risk-matching stays accurate after manual edits.
    """
    serializer_class = PlaybookClauseWriteSerializer

    def get_queryset(self):
        qs = PlaybookClause.objects.all()
        playbook_id = self.request.query_params.get('playbook')
        if playbook_id:
            qs = qs.filter(playbook_id=playbook_id)
        return qs.order_by('position')

    def perform_create(self, serializer):
        from django.db.models import Max
        playbook_id = self.request.data.get('playbook')
        max_pos = (
            PlaybookClause.objects.filter(playbook_id=playbook_id)
            .aggregate(Max('position'))['position__max']
        ) or 0
        serializer.save(position=max_pos + 1)

    def retrieve(self, request, *args, **kwargs):
        instance = self.get_object()
        return Response(PlaybookClauseSerializer(instance).data)


# Drafting keeps InstaDraft's paging contract ({count, next, previous, results}) that its
# pages expect; AMS's project-wide default is the Spring-style shape (core/pagination.py).
class DraftingPagination(PageNumberPagination):
    page_size = 20


for _viewset in (TemplateViewSet, SampleViewSet,
                 DraftSessionViewSet, PlaybookViewSet, PlaybookClauseViewSet):
    _viewset.pagination_class = DraftingPagination


# Drafting RBAC (merge phase 03), using AMS's table-driven permissions
# (core.permissions.RequirePermission; codes seeded by `manage.py seed_drafting_permissions`).
# Reads need DRAFT_VIEW. Changes need DRAFT_CREATE for a lawyer's own drafting work, or
# DRAFT_MANAGE for the shared set-up (templates, playbooks).
# This replaces InstaDraft's per-view settings, including the empty permission_classes on
# the playbook views, which inside AMS would have let anyone in without signing in.
from rest_framework.permissions import SAFE_METHODS  # noqa: E402

from core.permissions import RequirePermission  # noqa: E402

_WRITE_CODE = {
    TemplateViewSet: 'DRAFT_MANAGE', PlaybookViewSet: 'DRAFT_MANAGE', PlaybookClauseViewSet: 'DRAFT_MANAGE',
    SampleViewSet: 'DRAFT_CREATE', DraftSessionViewSet: 'DRAFT_CREATE',
}


def _drafting_permissions(write_code):
    def get_permissions(self):
        code = 'DRAFT_VIEW' if self.request.method in SAFE_METHODS else write_code
        return [RequirePermission(code)()]
    return get_permissions


for _viewset, _code in _WRITE_CODE.items():
    _viewset.get_permissions = _drafting_permissions(_code)
