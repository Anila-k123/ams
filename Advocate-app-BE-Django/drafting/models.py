from django.db import models
from pgvector.django import VectorField


class Client(models.Model):
    """A law-firm client. Top of the ownership chain: clients have projects,
    samples, and draft sessions."""
    name = models.CharField(max_length=255)
    # The AMS client this mirrors, when created by linking an AMS case.
    ams_client_id = models.BigIntegerField(null=True, blank=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = '"drf"."client"'

    def __str__(self):
        return self.name



class Project(models.Model):
    """A matter/engagement under a Client. Groups the samples and draft
    sessions for a single piece of work."""
    client = models.ForeignKey(Client, on_delete=models.CASCADE, related_name='projects')
    name = models.CharField(max_length=255)
    # The AMS case this project is for (core.models.Case id). A plain id, not a foreign
    # key (AMS convention for the Spring-owned tables); at most one project per case.
    case_id = models.BigIntegerField(null=True, blank=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = '"drf"."project"'

    def __str__(self):
        # Show the owning client alongside the project name for readability.
        return f'{self.client.name} / {self.name}'


class Template(models.Model):
    """A reusable clause skeleton for one document type (e.g. an NDA).

    A template defines WHICH clauses a generated draft will contain and WHAT
    case-fact inputs the lawyer must supply, but holds no client-specific text:
    - slot_schema: the case-fact inputs to collect from the user.
    - body_json: the ordered list of clause slots the generation engine fills.
    """
    # Lifecycle of the async parse+name pipeline (process_template task).
    class Status(models.TextChoices):
        PROCESSING = 'processing', 'Processing'
        READY = 'ready', 'Ready'
        FAILED = 'failed', 'Failed'

    name = models.CharField(max_length=255)
    language = models.CharField(max_length=10, default='en')
    document_type = models.CharField(max_length=100, blank=True)  # e.g. 'nda', 'sha'
    # Set to READY by process_template once the file is parsed + slots named.
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.READY)
    # Optional source file an uploaded template was parsed from.
    file = models.FileField(upload_to='templates/', null=True, blank=True)
    # JSON list of {key, label, required, hint} describing case-fact inputs
    slot_schema = models.JSONField(default=list)
    # JSON list of clause-skeleton blocks the generation engine iterates over
    body_json = models.JSONField(default=list)
    # Firm set-up, like playbooks: seen only within the creator's firm, archived
    # (not deleted) by its creator or a Super Admin (drafting/access.py).
    created_by_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    archived_at = models.DateTimeField(null=True, blank=True)
    archived_by_id = models.BigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = '"drf"."template"'

    def __str__(self):
        return self.name


class Sample(models.Model):
    """An uploaded past agreement used as drafting reference.

    The uploaded file is parsed asynchronously into SampleClause records
    (see the process_sample task); status tracks that pipeline. A document
    summary can also be generated on demand, tracked separately by
    summary_status.
    """
    # Lifecycle of the upload-and-parse pipeline (process_sample task).
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        PROCESSING = 'processing', 'Processing'
        READY = 'ready', 'Ready'
        FAILED = 'failed', 'Failed'

    # Lifecycle of the on-demand summary (generate_summary task).
    class SummaryStatus(models.TextChoices):
        IDLE = 'idle', 'Idle'
        GENERATING = 'generating', 'Generating'
        READY = 'ready', 'Ready'
        FAILED = 'failed', 'Failed'

    # Lifecycle of the on-demand translation (translate_sample task).
    class TranslationStatus(models.TextChoices):
        IDLE = 'idle', 'Idle'
        GENERATING = 'generating', 'Generating'
        READY = 'ready', 'Ready'
        FAILED = 'failed', 'Failed'

    name = models.CharField(max_length=255)
    language = models.CharField(max_length=10, default='en')
    # Clause-library tagging, set on upload — process_sample promotes this
    # document's clauses into the library under this contract_type + variant.
    contract_type = models.CharField(max_length=100, blank=True)  # e.g. 'nda'
    variant = models.CharField(max_length=20, blank=True, default='any')  # mutual/one_way/any
    file = models.FileField(upload_to='samples/')
    # Nullable so playbook-generated samples (no client context) can be stored.
    client = models.ForeignKey(Client, on_delete=models.SET_NULL, related_name='samples', null=True, blank=True)
    project = models.ForeignKey(Project, on_delete=models.SET_NULL, related_name='samples', null=True, blank=True)
    # Keep the sample if the uploading user is later deleted (SET_NULL).
    # The AMS advocate (core.models.Advocate id). A plain id, not a foreign key: AMS
    # convention for tables that point at the Spring-owned schema (workspace/models.py).
    # Same column name (uploaded_by_id) as the InstaDraft foreign key it replaces.
    uploaded_by_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    # Cached document summary — generated on demand, reused so we never re-run
    # (or, for Claude, never re-pay for) the same summary twice.
    summary = models.TextField(blank=True, default='')  # the prose narrative
    # The structured legal JSON the prose was generated from (fixed core +
    # per-type extension, with source_refs). Stored for reuse — comparison,
    # obligation tracking, dashboards, semantic search — without reprocessing.
    summary_json = models.JSONField(default=dict, blank=True)
    summary_status = models.CharField(max_length=20, choices=SummaryStatus.choices, default=SummaryStatus.IDLE)
    # Cached document translation — the latest target language is stored/overwritten.
    translation = models.TextField(blank=True, default='')  # plain text (for download)
    # Structured translation for display: list of {heading, body} per source clause,
    # so the translated view mirrors the document's section/heading outline.
    translation_json = models.JSONField(default=list, blank=True)
    translation_target = models.CharField(max_length=10, blank=True)  # target lang (e.g. 'hi')
    translation_source = models.CharField(max_length=10, blank=True)  # detected source lang
    translation_status = models.CharField(max_length=20, choices=TranslationStatus.choices, default=TranslationStatus.IDLE)
    # Imported from AMS (old two-app integration): the AMS document and the version
    # imported. Such samples are private to `uploaded_by`; everything else is the
    # shared library that users who don't sign in from AMS see.
    ams_document_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    ams_version = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = '"drf"."sample"'
        constraints = [models.UniqueConstraint(fields=['uploaded_by_id', 'ams_document_id'],
                                               name='sample_one_import_per_user')]

    def __str__(self):
        return self.name


class SampleClause(models.Model):
    """One clause extracted from a Sample, with its embedding.

    Generation retrieves the most similar clauses to each template slot via
    the pgvector cosine-distance operator over `embedding`, then offers them
    to the LLM as drafting references / citation candidates.
    """
    sample = models.ForeignKey(Sample, on_delete=models.CASCADE, related_name='clauses')
    clause_type = models.CharField(max_length=100)  # e.g. 'definition', 'confidentiality_obligation'
    position = models.PositiveIntegerField()
    text = models.TextField()
    # 768-dim vector (nomic-embed-text-v1); null until process_sample embeds it.
    embedding = VectorField(dimensions=768, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = '"drf"."sample_clause"'
        # Preserve the clause order from the source document.
        ordering = ['position']


class LibraryClause(models.Model):
    """A reusable, firm-owned clause in the Clause Library (Mode 3 corpus).

    Unlike SampleClause (tied to one uploaded document), these are the vetted,
    reusable building blocks a from-scratch draft assembles from. Bootstrapped by
    promoting SampleClauses (copying text + embedding), then curated. Retrieval
    filters by contract_type (+ variant) and ranks by embedding similarity to each
    template slot, exactly like Mode 1's candidate retrieval.
    """
    class Variant(models.TextChoices):
        ANY = 'any', 'Any'
        MUTUAL = 'mutual', 'Mutual'
        ONE_WAY = 'one_way', 'One-way'

    contract_type = models.CharField(max_length=100)  # e.g. 'nda', 'msa'
    clause_type = models.CharField(max_length=100, blank=True)  # e.g. 'confidentiality_obligation'
    variant = models.CharField(max_length=20, choices=Variant.choices, default=Variant.ANY)
    title = models.CharField(max_length=255, blank=True)  # human label for the clause
    text = models.TextField()
    conditions = models.TextField(blank=True)  # e.g. "include only if IP is shared"
    tags = models.JSONField(default=list, blank=True)
    embedding = VectorField(dimensions=768, null=True, blank=True)
    is_active = models.BooleanField(default=True)  # curation: hide without deleting
    # Where it was promoted from (audit trail; null if manually authored / source deleted).
    source_sample = models.ForeignKey(
        Sample, on_delete=models.SET_NULL, null=True, blank=True, related_name='library_clauses'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = '"drf"."library_clause"'
        ordering = ['contract_type', 'title']

    def __str__(self):
        return f'[{self.contract_type}/{self.variant}] {self.title or self.clause_type}'


class DraftSession(models.Model):
    """One run of the drafting engine: reference document(s) + an optional
    template + case facts.

    Creating a session enqueues the generate_draft task, which produces the
    DraftBlock rows. status tracks that task's progress. The presence of a
    template selects the mode: with a template the draft follows its clause
    skeleton (Mode 1); without one it rewrites the documents' own clauses
    (Mode 2).
    """
    # Lifecycle of the generate_draft task.
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        GENERATING = 'generating', 'Generating'
        READY = 'ready', 'Ready'
        FAILED = 'failed', 'Failed'

    class Mode(models.TextChoices):
        TEMPLATE = 'template', 'Template + documents'  # Mode 1
        SAMPLE = 'sample', 'Documents only'            # Mode 2
        LIBRARY = 'library', 'From scratch (clause library)'  # Mode 3

    # Optional template — its slot skeleton drives the draft when present (Mode 1).
    # PROTECT: a template in use by a session can't be deleted out from under it.
    template = models.ForeignKey(
        Template, on_delete=models.PROTECT, related_name='sessions', null=True, blank=True
    )
    # One or more reference documents (past agreements / records). Retrieval pools
    # candidate clauses across all of them.
    samples = models.ManyToManyField(Sample, related_name='sessions')
    # SET_NULL: deleting a client keeps its drafts (with their generated content),
    # only detaching them from the removed client.
    client = models.ForeignKey(
        Client, on_delete=models.SET_NULL, related_name='sessions', null=True, blank=True
    )
    # Project groups reference-flow sessions (Modes 1 & 2). Nullable because the
    # from-scratch flow (Mode 3) may have no case.
    project = models.ForeignKey(
        Project, on_delete=models.CASCADE, related_name='sessions', null=True, blank=True
    )
    # Keep the session if the creating user is later deleted (SET_NULL).
    # The AMS advocate (core.models.Advocate id). A plain id, not a foreign key: AMS
    # convention for tables that point at the Spring-owned schema (workspace/models.py).
    # Same column name (created_by_id) as the InstaDraft foreign key it replaces.
    created_by_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    # Case facts entered by the lawyer, keyed by the template's slot_schema keys.
    facts = models.JSONField(default=dict)
    llm = models.CharField(max_length=20, default='gemini')  # chosen model (Gemini-only for now)
    mode = models.CharField(max_length=20, choices=Mode.choices, default=Mode.TEMPLATE)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    celery_task_id = models.CharField(max_length=255, blank=True)
    # Optional playbook used for risk analysis (set at session creation or later).
    playbook = models.ForeignKey(
        'Playbook', on_delete=models.SET_NULL, null=True, blank=True, related_name='sessions'
    )
    # Tracks the analyze_risks task: idle / analyzing / ready / failed.
    risk_status = models.CharField(max_length=20, default='idle')
    # Document-level synthesis produced after the per-clause risk pass:
    # {title, recommendation, risk_register, deal_breakers, open_questions}.
    # Null until analyse_risks has run at least once.
    risk_report = models.JSONField(null=True, blank=True)
    # When True, the generation pipeline applies BNS/BNSS/BSA code replacements
    # as a post-processing step (IPC → BNS, CrPC → BNSS, Evidence Act → BSA).
    apply_bns_codes = models.BooleanField(default=False)
    # AMS links. The case is project.case_id; these record the task the
    # draft was started from and the AMS document it was last sent to.
    ams_task_id = models.BigIntegerField(null=True, blank=True)
    ams_document_id = models.BigIntegerField(null=True, blank=True)
    ams_document_version = models.IntegerField(null=True, blank=True)  # AMS version last sent
    ams_synced_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = '"drf"."draft_session"'

    def __str__(self):
        return f'DraftSession {self.id} ({self.status})'


class DraftBlock(models.Model):
    """One generated clause in a draft, with its provenance.

    Every block is traceable to its origin via `source`. When the block was
    drawn from a sample clause AND code confirmed the match, source is
    SAMPLE_CLAUSE, source_clause points at the cited SampleClause, and
    verified is True; otherwise the block is treated as GENERATED / unverified.
    """
    # Where the block's text came from. SAMPLE_CLAUSE only when code-verified.
    class Source(models.TextChoices):
        SAMPLE_CLAUSE = 'sample_clause', 'Sample Clause'
        PROMPT = 'prompt', 'User Prompt'
        GENERATED = 'generated', 'AI Generated'

    session = models.ForeignKey(DraftSession, on_delete=models.CASCADE, related_name='blocks')
    position = models.PositiveIntegerField()
    block_type = models.CharField(max_length=100)  # e.g. 'heading', 'recital', 'clause'
    heading = models.CharField(max_length=255, blank=True)  # clause label/name from the template slot
    text = models.TextField()  # plain-text projection of the clause body (search, provenance, export)
    # Rich body as HTML from the editor; empty until first edited/saved (then `text`
    # is kept as the plain-text extraction of this).
    content_html = models.TextField(blank=True)
    # True once a user has edited the block in the editor (citation no longer implied).
    is_edited = models.BooleanField(default=False)
    # Captured template formatting (DOCX): {"heading": {...}} — align/font/size/color/
    # emphasis for the clause heading. Body style is baked into content_html.
    style_json = models.JSONField(default=dict, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices)
    # The verified citation, if any; cleared (not cascaded) if the clause is deleted.
    source_clause = models.ForeignKey(
        SampleClause, on_delete=models.SET_NULL, null=True, blank=True, related_name='draft_blocks'
    )
    # True only when code confirmed text matches source_clause (not the LLM's word).
    verified = models.BooleanField(default=False)
    # Cosine similarity between the drafted text and the cited clause, when verified.
    similarity_score = models.FloatField(null=True, blank=True)
    # Audit trail of BNS/BNSS/BSA auto-replacements applied to this block.
    # Each entry: {original, replaced, old_act, old_section, new_act, new_section, changed, description}
    legal_code_replacements = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = '"drf"."draft_block"'
        # Render blocks in document order.
        ordering = ['position']


class DraftVersion(models.Model):
    """A frozen copy of a whole draft at one moment, the "before" side of a redline.

    Blocks are copied into `blocks` (not referenced) because DraftBlock rows are
    edited in place and replaced on regenerate; a version must never change after it
    is saved. Taken automatically when the AI finishes a draft and when it is sent to
    AMS / for review, and by hand ("Save version")."""
    class Kind(models.TextChoices):
        GENERATED = 'generated', 'AI draft'
        SENT = 'sent', 'Sent to AMS / review'
        MANUAL = 'manual', 'Saved by user'
        REVIEW = 'review', 'After a review round'
        RETURNED = 'returned', 'Sent back for changes'

    session = models.ForeignKey(DraftSession, on_delete=models.CASCADE, related_name='versions')
    number = models.PositiveIntegerField()  # 1, 2, 3… per session
    label = models.CharField(max_length=255, blank=True)
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.MANUAL)
    # [{block_id, position, block_type, heading, text, content_html, style_json}] in document order.
    blocks = models.JSONField(default=list)
    created_by_id = models.BigIntegerField(null=True, blank=True)  # AMS advocate id (plain id, see above)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = '"drf"."draft_version"'
        ordering = ['number']
        constraints = [models.UniqueConstraint(fields=['session', 'number'], name='draft_version_unique_number')]


class DraftReviewRequest(models.Model):
    """"Please review my draft", for drafts not started from a task (a task's own
    submit / review covers those). docs/DRAFT_REVIEW.md, situations 2-4.

    `authority` is fixed when the request is made (drafting/authority.py): `binding` when
    the reviewer is senior over the author (may edit directly and suggest), else `suggest`
    (suggestions only)."""
    class Authority(models.TextChoices):
        BINDING = 'binding', 'May correct and suggest'
        SUGGEST = 'suggest', 'Suggestions only'

    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        DONE = 'done', 'Done'
        CANCELLED = 'cancelled', 'Cancelled'

    session = models.ForeignKey(DraftSession, on_delete=models.CASCADE, related_name='review_requests')
    requested_by_id = models.BigIntegerField()          # AMS advocate ids (plain ids, see above)
    reviewer_id = models.BigIntegerField(db_index=True)
    note = models.TextField(blank=True)
    authority = models.CharField(max_length=20, choices=Authority.choices)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = '"drf"."draft_review_request"'
        ordering = ['-created_at']


class DraftReviewRound(models.Model):
    """One set of changes waiting for someone's decisions (docs/DRAFT_REVIEW.md).

    - `suggestions`: proposed by a reviewer, NOT applied yet. Accept applies a change;
      decline keeps the draft's text (a reason is required).
    - `changes`: already in the draft (e.g. a junior's resubmission). Accept keeps a
      change; reject puts the old text back. `binding` rounds (a senior's corrections
      shown to the junior) can only be acknowledged or queried, never rejected.

    `base_blocks` / `target_blocks` are frozen snapshots (versions.snapshot_blocks), so a
    change's number (its change_id in the comparison) stays the same while the round is open."""
    class Kind(models.TextChoices):
        SUGGESTIONS = 'suggestions', 'Suggestions'
        CHANGES = 'changes', 'Changes to review'

    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        FINISHED = 'finished', 'Finished'
        CANCELLED = 'cancelled', 'Cancelled'

    session = models.ForeignKey(DraftSession, on_delete=models.CASCADE, related_name='review_rounds')
    kind = models.CharField(max_length=20, choices=Kind.choices)
    binding = models.BooleanField(default=False)
    author_id = models.BigIntegerField()                 # who made the changes
    decider_id = models.BigIntegerField(db_index=True)   # who accepts / rejects them
    review_request = models.ForeignKey(DraftReviewRequest, on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name='rounds')
    # Changes from outside (drafting/incoming.py): who sent the file. author_id is then whoever uploaded it.
    external_from = models.CharField(max_length=120, blank=True)
    note = models.TextField(blank=True)
    base_blocks = models.JSONField(default=list)
    target_blocks = models.JSONField(default=list)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = '"drf"."draft_review_round"'
        ordering = ['-created_at']


class DraftChangeDecision(models.Model):
    """The decision on one change of a round (change_id = its number in the round's comparison)."""
    class Decision(models.TextChoices):
        ACCEPTED = 'accepted', 'Accepted / kept'
        DECLINED = 'declined', 'Declined (suggestion)'
        REJECTED = 'rejected', 'Rejected (change undone)'
        QUERIED = 'queried', 'Queried (binding correction)'
        ACKNOWLEDGED = 'acknowledged', 'Acknowledged (binding correction)'

    round = models.ForeignKey(DraftReviewRound, on_delete=models.CASCADE, related_name='decisions')
    change_id = models.PositiveIntegerField()
    decision = models.CharField(max_length=20, choices=Decision.choices)
    reason = models.TextField(blank=True)
    decided_by_id = models.BigIntegerField()
    decided_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = '"drf"."draft_change_decision"'
        constraints = [models.UniqueConstraint(fields=['round', 'change_id'], name='draft_change_decision_once')]


class DraftComment(models.Model):
    """A comment on a passage of a draft, and its replies (docs/DRAFT_REVIEW.md, comments).

    In a task review the senior corrects directly and asks questions here ("Did the client agree to
    rent in advance?"); the junior replies or fixes the text; the senior resolves. The junior's
    queries on corrections are comments too. A thread is a top comment (`parent` NULL) and its
    replies; `block_id` + `quote` anchor it to the words it is about (they may change later: the
    quote is kept as written)."""
    session = models.ForeignKey(DraftSession, on_delete=models.CASCADE, related_name='comments')
    parent = models.ForeignKey('self', on_delete=models.CASCADE, null=True, blank=True, related_name='replies')
    block_id = models.BigIntegerField(null=True, blank=True)   # the clause (plain id: blocks are replaced on re-draft)
    quote = models.TextField(blank=True)                       # the words commented on, as they were
    body = models.TextField()
    author_id = models.BigIntegerField(db_index=True)          # AMS advocate ids (plain ids, see above)
    resolved_by_id = models.BigIntegerField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = '"drf"."draft_comment"'
        ordering = ['created_at']


class DraftEdit(models.Model):
    """One turn of the chat-edit loop: an instruction, the AI's proposed rewrite
    of a clause (before/after), and whether the lawyer accepted it. Kept as the
    chat transcript + audit trail (and, later, for undo)."""
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        ACCEPTED = 'accepted', 'Accepted'
        REJECTED = 'rejected', 'Rejected'

    session = models.ForeignKey(DraftSession, on_delete=models.CASCADE, related_name='edits')
    # The targeted clause; SET_NULL so the transcript survives if the block is removed.
    block = models.ForeignKey(DraftBlock, on_delete=models.SET_NULL, null=True, blank=True, related_name='edits')
    instruction = models.TextField()
    before_text = models.TextField(blank=True)
    after_text = models.TextField(blank=True)
    before_html = models.TextField(blank=True)
    after_html = models.TextField(blank=True)
    heading = models.CharField(max_length=255, blank=True)   # proposed heading (may equal the old one)
    rationale = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    # The AMS advocate (core.models.Advocate id). A plain id, not a foreign key: AMS
    # convention for tables that point at the Spring-owned schema (workspace/models.py).
    # Same column name (created_by_id) as the InstaDraft foreign key it replaces.
    created_by_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = '"drf"."draft_edit"'
        ordering = ['created_at']


class Playbook(models.Model):
    """A firm playbook: a curated set of fallback positions, red lines, and
    standard positions for each clause type in a given document category.

    Created either from scratch (lawyer writes the rules manually) or by
    processing one or more sample agreements (two-pass extraction + synthesis).
    Once READY the playbook can be attached to any DraftSession to drive
    automated risk analysis on the generated draft.
    """
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        PROCESSING = 'processing', 'Processing'
        READY = 'ready', 'Ready'
        FAILED = 'failed', 'Failed'

    class Method(models.TextChoices):
        SCRATCH = 'scratch', 'Write from Scratch'
        DOCUMENT = 'document', 'Generate from Documents'

    class LLMProvider(models.TextChoices):
        GEMINI = 'gemini', 'Gemini'

    name = models.CharField(max_length=255)
    category = models.CharField(max_length=100, blank=True)   # e.g. 'NDA', 'MSA'
    description = models.TextField(blank=True)                # what the playbook should do
    method = models.CharField(max_length=20, choices=Method.choices)
    llm_provider = models.CharField(max_length=20, choices=LLMProvider.choices, default=LLMProvider.GEMINI)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    # The AMS advocate (core.models.Advocate id). A plain id, not a foreign key: AMS
    # convention for tables that point at the Spring-owned schema (workspace/models.py).
    # Same column name (created_by_id) as the InstaDraft foreign key it replaces.
    created_by_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    # "Delete" archives: hidden and not offered for new drafts, restorable by the
    # creator or a Super Admin. Drafts already checked keep their findings.
    archived_at = models.DateTimeField(null=True, blank=True)
    archived_by_id = models.BigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = '"drf"."playbook"'
        ordering = ['-created_at']

    def __str__(self):
        return self.name


class PlaybookDocument(models.Model):
    """One uploaded source document used to generate a Playbook.

    Only relevant when method=DOCUMENT. process_playbook reads these files,
    extracts raw clauses into PlaybookClauseRaw, then synthesises them into
    PlaybookClause records. The files are kept for audit; raw clause rows are
    deleted after synthesis.
    """
    playbook = models.ForeignKey(Playbook, on_delete=models.CASCADE, related_name='documents')
    file = models.FileField(upload_to='playbooks/')
    original_filename = models.CharField(max_length=255, blank=True)
    # Sample created from this file so its Docling-parsed clauses feed Pass 1
    # and the document appears in the Samples page.
    sample = models.ForeignKey(
        'Sample', on_delete=models.SET_NULL, null=True, blank=True, related_name='playbook_documents'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = '"drf"."playbook_document"'


class PlaybookClauseRaw(models.Model):
    """Intermediate: one extracted clause from one PlaybookDocument (Pass 1).

    Deleted after synthesis (Pass 2) produces the consolidated PlaybookClause
    rows. Storing them lets the synthesis step load all source evidence for a
    given clause type in one query without re-parsing the files.
    """
    playbook = models.ForeignKey(Playbook, on_delete=models.CASCADE, related_name='raw_clauses')
    source_document = models.ForeignKey(
        PlaybookDocument, on_delete=models.SET_NULL, null=True, blank=True
    )
    clause_type = models.CharField(max_length=100)   # normalised type label, e.g. 'confidentiality'
    raw_text = models.TextField()
    # Structured extraction output from Pass 1 (parties, obligations, carve-outs, etc.)
    extracted_json = models.JSONField(default=dict)

    class Meta:
        db_table = '"drf"."playbook_clause_raw"'


class PlaybookClause(models.Model):
    """One consolidated clause position in a Playbook (Pass 2 output).

    Each row covers one clause type. The synthesis task decides which position
    is the firm's standard (most common across source docs), which variations
    are red lines (must-haves or must-nots), and which are acceptable fallbacks
    (negotiating room). The LLM writes natural-language descriptions; code
    decides the classification using frequency statistics.
    """
    playbook = models.ForeignKey(Playbook, on_delete=models.CASCADE, related_name='clauses')
    clause_type = models.CharField(max_length=100)
    position = models.PositiveIntegerField(default=0)  # display order
    # The firm's preferred / standard clause text for this type.
    standard_text = models.TextField()
    # List of {rule, rationale} dicts — firm's non-negotiable positions.
    red_lines = models.JSONField(default=list)
    # List of {text, condition} dicts — acceptable alternative positions.
    fallback_positions = models.JSONField(default=list)
    notes = models.TextField(blank=True)
    # Embedding of standard_text — used for semantic matching during risk analysis.
    embedding = VectorField(dimensions=768, null=True, blank=True)
    # How many source documents contributed to this clause (context for confidence).
    source_doc_count = models.PositiveIntegerField(default=1)

    class Meta:
        db_table = '"drf"."playbook_clause"'
        ordering = ['position']

    def __str__(self):
        return f'[{self.playbook.name}] {self.clause_type}'


class PlaybookRisk(models.Model):
    """One risk finding from analyzing a DraftSession against a Playbook.

    The analyze_risks task compares each DraftBlock against the matching
    PlaybookClause (via embedding similarity) and flags deviations from the
    firm's red lines or standard positions. Each finding is one row here.
    """
    class Severity(models.TextChoices):
        CRITICAL = 'critical', 'Critical'
        MAJOR = 'major', 'Major'
        MINOR = 'minor', 'Minor'
        INFO = 'info', 'Info'

    class RiskStatus(models.TextChoices):
        OPEN = 'open', 'Open'
        ACCEPTED = 'accepted', 'Accepted'
        DISMISSED = 'dismissed', 'Dismissed'

    session = models.ForeignKey(DraftSession, on_delete=models.CASCADE, related_name='risks')
    # The specific clause that triggered this risk (null if session-level finding).
    block = models.ForeignKey(
        DraftBlock, on_delete=models.SET_NULL, null=True, blank=True, related_name='risks'
    )
    # The playbook clause this risk was measured against.
    playbook_clause = models.ForeignKey(
        PlaybookClause, on_delete=models.SET_NULL, null=True, blank=True
    )
    severity = models.CharField(max_length=20, choices=Severity.choices)
    issue = models.TextField()       # what's wrong
    suggestion = models.TextField()  # how to fix it
    quote = models.TextField()       # verbatim excerpt from the draft that triggered this
    status = models.CharField(max_length=20, choices=RiskStatus.choices, default=RiskStatus.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = '"drf"."playbook_risk"'
        ordering = ['severity', 'created_at']


class LegalCodeMapping(models.Model):
    """Maps an old Indian criminal law section to its replacement in the 2023 codes.

    Covers three act pairs effective 1 July 2024:
      IPC  (1860) -> BNS  (Bharatiya Nyaya Sanhita, 2023)
      CrPC (1973) -> BNSS (Bharatiya Nagarik Suraksha Sanhita, 2023)
      IEA  (1872) -> BSA  (Bharatiya Sakshya Adhiniyam, 2023)

    Used by the drafting engine to auto-replace stale code references in generated
    DraftBlocks when the source sample/template predates the July 2024 switchover.
    """

    class OldAct(models.TextChoices):
        IPC  = 'IPC',  'Indian Penal Code, 1860'
        CRPC = 'CrPC', 'Code of Criminal Procedure, 1973'
        IEA  = 'IEA',  'Indian Evidence Act, 1872'

    class NewAct(models.TextChoices):
        BNS  = 'BNS',  'Bharatiya Nyaya Sanhita, 2023'
        BNSS = 'BNSS', 'Bharatiya Nagarik Suraksha Sanhita, 2023'
        BSA  = 'BSA',  'Bharatiya Sakshya Adhiniyam, 2023'

    old_act     = models.CharField(max_length=10, choices=OldAct.choices, db_index=True)
    old_section = models.CharField(max_length=30)
    description = models.CharField(max_length=300, blank=True)
    new_act     = models.CharField(max_length=10, choices=NewAct.choices)
    # blank means the old section was repealed with no direct equivalent.
    new_section = models.CharField(max_length=30, blank=True)
    # True when the provision's wording or penalty was substantively changed.
    changed     = models.BooleanField(default=False)

    class Meta:
        db_table = '"drf"."legal_code_mapping"'
        unique_together = [('old_act', 'old_section')]
        ordering = ['old_act', 'old_section']

    def __str__(self):
        new = f'{self.new_act} S.{self.new_section}' if self.new_section else 'repealed'
        return f'{self.old_act} S.{self.old_section} -> {new}'
