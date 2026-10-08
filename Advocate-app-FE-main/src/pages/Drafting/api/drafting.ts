import api from './client'
import type { DraftChange } from '../../../components/DraftChanges'

/** One user-fillable case fact captured by a template (e.g. "party_name"). */
export interface SlotField {
  key: string
  label: string
  required: boolean
  hint?: string // optional helper text shown beside the field
  type?: 'text' | 'date' | 'select' // widget to render (default 'text')
  option_set?: 'states' | 'entity_types' // named option list for a select
  options?: string[] // explicit options for a select (overrides option_set)
}

/** A positional slot in the template body that a generated block fills. */
export interface BodySlot {
  id: string
  type: string
  label: string
  description: string
}

/** A clause-skeleton template: declares the facts to collect (slot_schema)
 *  and the ordered body structure to fill (body_json). */
export interface Template {
  id: number
  name: string
  language: string
  document_type: string
  file?: string | null // optional uploaded source file for the template
  slot_schema: SlotField[] // facts the lawyer must enter
  body_json: BodySlot[] // ordered body slots to generate into
  status?: 'processing' | 'ready' | 'failed' // async parse+name pipeline state
}

/** A law-firm client (top of the Client -> Project -> Sample hierarchy). */
export interface Client {
  id: number
  name: string
}

/** A matter/project belonging to a client. */
export interface Project {
  id: number
  client: number // owning client id
  name: string
}

/** An uploaded past agreement used as a drafting reference. */
export interface Sample {
  id: number
  name: string
  language?: string
  client?: number
  project?: number
  file?: string | null
  // Backend ingestion lifecycle (parse -> split -> embed clauses).
  status: 'pending' | 'processing' | 'ready' | 'failed'
  summary?: string
  // Structured legal data the prose summary was built from (fixed core +
  // per-type extension, with source_refs). Stored for reuse beyond the prose.
  summary_json?: Record<string, unknown>
  // Independent lifecycle for the async LLM summary (see generateSummary).
  summary_status?: 'idle' | 'generating' | 'ready' | 'failed'
  // Cached document translation (latest target language).
  translation?: string
  // Structured translation for display — one {heading, body} per source clause,
  // preserving the section/heading outline.
  translation_json?: { heading?: string; body?: string }[]
  translation_target?: string // target language code (e.g. 'hi')
  translation_source?: string // auto-detected source language code
  translation_status?: 'idle' | 'generating' | 'ready' | 'failed'
  ams_document_id?: number | null // imported from this AMS document (private to its user)
  ams_version?: number | null
  created_at?: string
}

/** The originating sample clause a verified DraftBlock was cited from. */
export interface SourceClauseDetail {
  id: number
  clause_type: string
  position: number
  text: string
  sample_name?: string | null  // the source document's name
  sample_url?: string | null   // its file URL (to open in the reference viewer)
}

/** One block of a generated draft, traceable to its source.
 *  `source` distinguishes a cited sample clause, user-prompt text, or
 *  unverified AI output; `verified` and `similarity_score` describe the citation. */
export interface DraftBlock {
  id: number
  position: number // order within the document
  block_type: string
  heading?: string
  text: string // plain-text projection of the body
  content_html?: string // rich body from the editor (empty until first edited)
  is_edited?: boolean // true once a user edited it in the editor
  style_json?: { heading?: Record<string, unknown> } // captured template heading style
  source: 'sample_clause' | 'prompt' | 'generated'
  source_clause: number | null // id of the cited SampleClause, if any
  source_clause_detail: SourceClauseDetail | null // expanded citation detail
  verified: boolean // true when code confirmed the text matches source_clause
  similarity_score: number | null // cosine similarity to the cited clause (0..1)
}

/** A drafting run: optional template + one or more reference documents + entered
 *  facts, plus its generated blocks. `mode` = 'template' (Mode 1) | 'sample' (Mode 2). */
export interface DraftSession {
  id: number
  template: number | null
  template_name?: string | null // denormalised for display (null in sample mode)
  document_type?: string | null // the template's document type (Mode 3 title)
  samples: number[] // reference document ids
  sample_names?: string[] // denormalised document names for display
  mode?: 'template' | 'sample' | 'library'
  llm?: string // chosen model ('gemini')
  reference_documents?: { kind: 'template' | 'sample'; id: number; name: string; url: string }[]
  status: 'pending' | 'generating' | 'ready' | 'failed'
  playbook: number | null
  risk_status: 'idle' | 'analyzing' | 'ready' | 'failed'
  risk_report?: RiskReport | null // document-level synthesis (null until analysed)
  facts: Record<string, string> // slot key -> value entered by the lawyer
  blocks: DraftBlock[]
  // AMS link: the case (via the project), the task it came from, and the last send.
  case_id?: number | null // the linked AMS case (Project.case_id)
  ams_task_id?: number | null
  ams_document_id?: number | null
  ams_document_version?: number | null
  ams_synced_at?: string | null
  // Senior review: who wrote it, and what the viewer may do (drafting/access.py).
  created_by_id?: number | null
  created_by_name?: string | null
  review?: DraftReview | null
  // What the viewer may do (drafting/access.py): edit directly, or only suggest.
  access?: DraftAccess | null
  created_at: string
}

/** The viewer's rights on a draft (docs/DRAFT_REVIEW.md). */
export interface DraftAccess {
  isOwner: boolean
  canWrite: boolean      // edit directly
  canSuggest: boolean    // propose changes for the owner to accept / decline
  request: { id: number; authority: 'binding' | 'suggest'; note: string } | null
}

/** The draft's AMS task as seen by the current viewer (author or reviewer). */
export interface DraftReview {
  taskId: number
  taskTitle: string
  status: 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | null
  note: string | null
  reviewedByName: string | null
  isOwner: boolean
  canReview: boolean
  canEdit: boolean
  // The latest hand-back: the author's note and what it changed (null for a first submission).
  lastNote?: string | null
  lastChanges?: DraftChange[] | null
}

/** Senior review of a delegated AMS task (AMS workspace/review.py). */
export type AmsReviewStatus = 'SUBMITTED' | 'CHANGES_REQUESTED' | 'APPROVED'
// A frozen copy of a draft (drafting.DraftVersion), listed without its content.
export interface DraftVersion {
  id: number
  number: number
  label: string
  kind: 'generated' | 'sent' | 'manual' | 'review' | 'returned'
  created_by_id: number | null
  created_at: string
}

/** One run of text in a compared paragraph: unchanged, added or removed. */
export interface CompareSeg { op: 'same' | 'ins' | 'del'; text: string; fmt: string[] }
/** A paragraph of the comparison: unchanged, changed word by word, or wholly added / removed. */
export interface CompareParagraph {
  kind: 'same' | 'changed' | 'ins' | 'del'
  style: string
  align: string | null
  change_id: number | null   // 1..n in document order, for next / previous
  segs: CompareSeg[]
  decision?: ChangeDecision | null   // review rounds only
  outdated?: boolean                 // review rounds: the draft moved on since
}
export interface CompareClause {
  block_id: number
  status: 'same' | 'changed' | 'added' | 'removed'
  label: string
  heading: CompareParagraph[]
  body: CompareParagraph[]
}
/** A decision on one change of a review round. */
export type ChangeDecisionKind = 'accepted' | 'declined' | 'rejected' | 'queried' | 'acknowledged'
export interface ChangeDecision { decision: ChangeDecisionKind; reason: string; by: number; at: string }

/** A comment thread on a passage of a draft (drafting/comments.py). */
export interface DraftCommentReply { id: number; body: string; author_id: number; author_name: string | null; created_at: string; can_delete: boolean }
export interface DraftCommentThread {
  id: number
  block_id: number | null
  quote: string
  body: string
  author_id: number
  author_name: string | null
  created_at: string
  resolved: boolean
  resolved_by_name: string | null
  resolved_at: string | null
  can_resolve: boolean
  can_delete: boolean
  replies: DraftCommentReply[]
}
export interface DraftComments { threads: DraftCommentThread[]; open: number; answered: number }

/** A colleague who could review a draft, and what they could do (drafting/authority.py). */
export interface DraftReviewer { id: number; name: string; authority: 'binding' | 'suggest' }
/** "Please review my draft", for drafts without a task (drafting/review_requests.py). */
export interface DraftReviewRequest {
  id: number
  session: number
  reviewer_id: number
  reviewer_name: string | null
  requested_by_id: number
  requested_by_name: string | null
  note: string
  authority: 'binding' | 'suggest'
  status: 'open' | 'done' | 'cancelled'
  created_at: string
  closed_at: string | null
  title?: string            // drafts/for-review only
  progress?: ReviewProgress // drafts/for-review only
}

/** The draft's linked case and its papers (drafting/casefile.py). */
export interface CaseFileDocument {
  id: number
  name: string
  fileName: string
  fileType: string | null
  category: string | null
  uploadedAt: string
  onCase: boolean           // false = the client's own document, not filed on this case
}
export interface CaseFile {
  case: null | {
    id: number
    caseNumber: string
    caseTitle?: string | null
    caseType?: string | null
    status?: string | null
    court?: string
    cnr?: string
    judge?: string
    client?: { id: number; name: string; phone: string | null; email: string | null; address: string | null } | null
    parties?: { name: string; role: string | null; counsel: string | null; opponent: boolean }[]
    nextHearing?: { date: string; title: string } | null
  }
  documents: CaseFileDocument[]
  canSeeCase: boolean
  canSeeDocuments: boolean
}

/** How far a request has got, as the reviewer sees it (drafts/for-review). */
export interface ReviewProgress {
  sent: number              // suggestion / correction rounds sent
  waiting: number           // of those, still waiting for the author
  accepted: number
  declined: number
  queried: number
  decided_at: string | null
}

/** The review state of one of my own drafts (drafts/review-status), keyed by draft id. */
export interface MyReviewStatus {
  state: 'to_decide' | 'with_reviewer' | 'reviewed'
  who: string | null
  at?: string | null
}

/** A review round: suggestions (not applied) or changes (applied) waiting for decisions. */
export interface ReviewRoundSummary {
  id: number
  kind: 'suggestions' | 'changes'
  binding: boolean
  status: 'open' | 'finished' | 'cancelled'
  author_id: number
  decider_id: number
  author_name: string | null
  decider_name: string | null
  can_decide: boolean
  mine: boolean             // the viewer made these changes
  queries: string[]         // queries on a senior's corrections (binding rounds)
  counts: Partial<Record<ChangeDecisionKind, number>>  // decisions so far, by kind
  note: string
  changes: number
  pending: number
  created_at: string
  finished_at: string | null
}
export interface ReviewRound extends Omit<DraftComparison, 'from' | 'to'> {
  id: number
  kind: ReviewRoundSummary['kind']
  binding: boolean
  status: ReviewRoundSummary['status']
  note: string
  author_id: number
  decider_id: number
  author_name: string | null
  decider_name: string | null
  created_at: string
  finished_at: string | null
  allowed: ChangeDecisionKind[]
  needs_reason: ChangeDecisionKind[]
  decided: number
  pending: number
  can_decide: boolean
  can_cancel: boolean
  result?: { applied: number; outdated: number[] }
}

export interface DraftComparison {
  from: DraftVersion
  to: DraftVersion | null    // null = the current draft
  inserted: number           // words
  deleted: number
  changes: number            // changed paragraphs
  clauses: CompareClause[]
}

export interface AmsTaskReview {
  id: number
  title: string
  completed: boolean
  needsReview: boolean
  reviewStatus: AmsReviewStatus | null
  reviewNote: string | null
  reviewedByName: string | null
  reviewedAt: string | null
}

// DRF list endpoints are paginated; single-object endpoints are not.
interface Paginated<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

/** All drafting endpoints. Each method unwraps to the response body, and list
 *  calls additionally unwrap the DRF pagination envelope to a plain array. */
export const draftingApi = {
  getTemplates: () =>
    api.get<Paginated<Template>>('/templates/').then(r => r.data.results),
  getTemplate: (id: number) =>
    api.get<Template>(`/templates/${id}/`).then(r => r.data),
  // Poll a template until its background parse finishes (status leaves 'processing').
  // Resolves with the ready template, or rejects if it fails / times out.
  waitForTemplate: async (id: number, tries = 40, delayMs = 1500): Promise<Template> => {
    for (let i = 0; i < tries; i++) {
      const t = await api.get<Template>(`/templates/${id}/`).then(r => r.data)
      if (t.status === 'ready') return t
      if (t.status === 'failed') throw new Error('Template processing failed')
      await new Promise(res => setTimeout(res, delayMs))
    }
    throw new Error('Template processing timed out')
  },
  uploadTemplate: (data: FormData) =>
    api.post<Template>('/templates/', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),
  getSamples: (projectId: number) =>
    api.get<Paginated<Sample>>(`/samples/?project=${projectId}`).then(r => r.data.results),
  // The list is paginated (PAGE_SIZE on the server). The Documents page shows ALL
  // documents, so follow the pages until exhausted instead of stopping at page 1.
  getAllSamples: async () => {
    const out: Sample[] = []
    for (let page = 1; ; page += 1) {
      const { data } = await api.get<Paginated<Sample>>(`/samples/?page=${page}`)
      out.push(...data.results)
      if (!data.next) break
    }
    return out
  },
  getSample: (id: number) =>
    api.get<Sample>(`/samples/${id}/`).then(r => r.data),
  deleteSample: (id: number) => api.delete(`/samples/${id}/`),
  deleteTemplate: (id: number) => api.delete(`/templates/${id}/`),
  // Async: kicks off translation into `target`; poll getSample(id) until translation_status settles.
  translateSample: (id: number, target: string) =>
    api.post<{ id: number; translation_status: string }>(`/samples/${id}/translate/`, { target }).then(r => r.data),
  uploadSample: (data: FormData) =>
    api.post<Sample>('/samples/', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),
  createSession: (data: {
    template: number | null
    samples: number[]
    project?: number // the AMS case's drafting project (link-case); the client follows it
    facts: Record<string, string>
    llm: string
    mode?: string    // 'library' for from-scratch (Mode 3); omitted = derived from template/samples
    apply_bns_codes?: boolean // replace stale IPC/CrPC/Evidence Act refs post-generation
    ams_task_id?: number | null // the AMS task this draft was started from
  }) => api.post<DraftSession>('/draft-sessions/', data).then(r => r.data),
  // Server-rendered Word file of the SAVED draft; `branding` puts it on the AMS letterhead.
  // `format: 'pdf'` = the same file converted on the server (LibreOffice); 503 when it isn't installed.
  exportDocx: (id: number, branding = false, format: 'docx' | 'pdf' = 'docx') =>
    api.get<Blob>(`/drafts/${id}/export/docx/`, {
      params: { ...(branding ? { branding: 1 } : {}), ...(format === 'pdf' ? { output: 'pdf' } : {}) }, responseType: 'blob',
    }).then(r => {
        const m = /filename="([^"]+)"/.exec(r.headers['content-disposition'] || '')
        return { blob: r.data, filename: m ? m[1] : `draft_${id}.${format}` }
      }),
  // Tracked changes from version `from` to version `to` (omitted = the current draft), as Word or PDF.
  exportRedline: (id: number, from: number, to?: number, branding = false, format: 'docx' | 'pdf' = 'docx') =>
    api.get<Blob>(`/drafts/${id}/export/redline/`, {
      params: { from, ...(to ? { to } : {}), ...(branding ? { branding: 1 } : {}), ...(format === 'pdf' ? { output: 'pdf' } : {}) },
      responseType: 'blob',
    }).then(r => {
      const m = /filename="([^"]+)"/.exec(r.headers['content-disposition'] || '')
      return {
        blob: r.data, filename: m ? m[1] : `draft_${id}_redline.docx`,
        inserted: Number(r.headers['x-redline-inserted'] || 0), deleted: Number(r.headers['x-redline-deleted'] || 0),
      }
    }),
  // Saved versions of the draft (newest first): the "before" side of a redline.
  // Comments on passages (drafting/comments.py).
  getCaseFile: (id: number) =>
    api.get<CaseFile>(`/draft-sessions/${id}/case-file/`).then(r => r.data),
  getComments: (id: number) =>
    api.get<DraftComments>(`/draft-sessions/${id}/comments/`).then(r => r.data),
  addComment: (id: number, body: string, blockId: number | null, quote: string) =>
    api.post<DraftComments>(`/draft-sessions/${id}/comments/`, { body, block_id: blockId, quote }).then(r => r.data),
  replyComment: (commentId: number, body: string) =>
    api.post<DraftComments>(`/comments/${commentId}/reply/`, { body }).then(r => r.data),
  resolveComment: (commentId: number, reopen = false) =>
    api.post<DraftComments>(`/comments/${commentId}/${reopen ? 'reopen' : 'resolve'}/`).then(r => r.data),
  deleteComment: (commentId: number) =>
    api.delete<DraftComments>(`/comments/${commentId}/`).then(r => r.data),
  // Request review (drafting/review_requests.py).
  getReviewers: (id: number) =>
    api.get<DraftReviewer[]>(`/draft-sessions/${id}/reviewers/`).then(r => r.data),
  getReviewRequests: (id: number) =>
    api.get<DraftReviewRequest[]>(`/draft-sessions/${id}/review-requests/`).then(r => r.data),
  requestReview: (id: number, reviewer: number, note = '') =>
    api.post<DraftReviewRequest>(`/draft-sessions/${id}/review-requests/`, { reviewer, note }).then(r => r.data),
  reviewRequestDone: (requestId: number, note = '') =>
    api.post<DraftReviewRequest>(`/review-requests/${requestId}/done/`, { note }).then(r => r.data),
  cancelReviewRequest: (requestId: number) =>
    api.post<DraftReviewRequest>(`/review-requests/${requestId}/cancel/`).then(r => r.data),
  forMyReview: () =>
    api.get<DraftReviewRequest[]>('/drafts/for-review/').then(r => r.data),
  myReviewStatus: () =>
    api.get<Record<string, MyReviewStatus>>('/drafts/review-status/').then(r => r.data),
  // Review rounds (drafting/review.py, docs/DRAFT_REVIEW.md).
  suggest: (id: number, blocks: { id: number; heading: string; content_html: string; text: string }[], note = '') =>
    api.post<ReviewRound>(`/draft-sessions/${id}/suggest/`, { blocks, note }).then(r => r.data),
  getRounds: (id: number) =>
    api.get<ReviewRoundSummary[]>(`/draft-sessions/${id}/rounds/`).then(r => r.data),
  getRound: (roundId: number) =>
    api.get<ReviewRound>(`/rounds/${roundId}/`).then(r => r.data),
  decideChange: (roundId: number, change: number | 'all', decision: ChangeDecisionKind, reason = '') =>
    api.post<ReviewRound>(`/rounds/${roundId}/decide/`, { change, decision, reason }).then(r => r.data),
  finishRound: (roundId: number) =>
    api.post<ReviewRound>(`/rounds/${roundId}/finish/`).then(r => r.data),
  cancelRound: (roundId: number) =>
    api.post<ReviewRound>(`/rounds/${roundId}/cancel/`).then(r => r.data),
  // On-screen compare (drafting/export/compare.py): `from` omitted = the server's default
  // (last version sent out, else the latest); `to` omitted = the current draft.
  compare: (id: number, from?: number, to?: number) =>
    api.get<DraftComparison>(`/draft-sessions/${id}/compare/`, {
      params: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
    }).then(r => r.data),
  getVersions: (id: number) =>
    api.get<DraftVersion[]>(`/draft-sessions/${id}/versions/`).then(r => r.data),
  saveVersion: (id: number, label = '') =>
    api.post<DraftVersion[]>(`/draft-sessions/${id}/versions/`, { label }).then(r => r.data),
  // File the saved draft on its AMS case (+ task). `caseId` links an unlinked draft first.
  // `note`: what the author changed, when resubmitting after changes were requested.
  sendToAms: (id: number, caseId?: number, note?: string) =>
    api.post<{ documentId: number; version: number; taskLinked: boolean; syncedAt: string; amsCaseId: number;
               reviewStatus: AmsReviewStatus | null }>(
      `/drafts/${id}/send-to-ams/`, { ...(caseId ? { caseId } : {}), ...(note ? { note } : {}) }).then(r => r.data),
  // The AMS task the draft came from, with the senior's review (null if none).
  getAmsTask: (id: number) =>
    api.get<{ task: AmsTaskReview | null }>(`/drafts/${id}/ams-task/`).then(r => r.data.task),
  getSessions: () =>
    api.get<Paginated<DraftSession>>('/draft-sessions/').then(r => r.data.results),
  getSession: (id: number) =>
    api.get<DraftSession>(`/draft-sessions/${id}/`).then(r => r.data),
  deleteSession: (id: number) => api.delete(`/draft-sessions/${id}/`),
  getSessionStatus: (id: number) =>
    api.get<{ id: number; status: string; risk_status: string }>(`/draft-sessions/${id}/status/`).then(r => r.data),
  // Persist editor changes to a session's blocks (manual save).
  saveBlocks: (id: number, blocks: { id: number; heading: string; content_html: string; text: string }[]) =>
    api.post<DraftSession>(`/draft-sessions/${id}/save-blocks/`, blocks).then(r => r.data),
  // Chat-edit: propose a clause rewrite for an instruction (records a pending edit).
  proposeEdit: (id: number, body: { instruction: string; focused_block_id?: number | null; current_text?: string; model?: string }) =>
    api.post<EditProposal>(`/draft-sessions/${id}/edit/`, body).then(r => r.data),
  acceptEdit: (id: number, editId: number) =>
    api.post(`/draft-sessions/${id}/edit/${editId}/accept/`).then(r => r.data),
  rejectEdit: (id: number, editId: number) =>
    api.post(`/draft-sessions/${id}/edit/${editId}/reject/`).then(r => r.data),
  // Consistency check: review the whole draft for contradictions + loose ends.
  // Send the editor's live clauses so the review reflects unsaved edits.
  checkConsistency: (id: number, body: { clauses?: { block_id: number; heading: string; text: string }[]; model?: string }) =>
    api.post<ConsistencyReport>(`/draft-sessions/${id}/consistency-check/`, body).then(r => r.data),
  // Whole-document refine (formal / concise / grammar): returns only changed clauses.
  refineDraft: (id: number, body: { action: string; clauses?: { block_id: number; heading: string; text: string }[]; model?: string }) =>
    api.post<RefineResponse>(`/draft-sessions/${id}/refine/`, body).then(r => r.data),
  // Wipe blocks and re-run draft generation with the same inputs.
  regenerateSession: (id: number) =>
    api.post<{ id: number; status: string }>(`/draft-sessions/${id}/regenerate/`).then(r => r.data),
}

/** One clause changed by a whole-document refine action. */
export interface RefineResult {
  block_id: number
  heading?: string
  before_text: string
  after_text: string
  after_html: string
  shrunk?: boolean // the revision is far shorter than the original (possible dropped content)
}

/** The whole-document refine response. */
export interface RefineResponse {
  action: string
  results: RefineResult[]
  changed: number
  model: string
  elapsed_ms: number
}

/** One issue surfaced by the consistency check. */
export interface ConsistencyFinding {
  id: number
  category: 'unfilled_blank' | 'party_variant' | 'cross_reference' | 'contradiction'
  severity: 'error' | 'warning' | 'info'
  title: string
  detail: string
  block_ids: number[] // clauses this finding points at (for jump-to)
  quotes: { block_id: number | null; text: string }[] // verified snippets
  suggestion?: string
}

/** The consistency-check response. */
export interface ConsistencyReport {
  findings: ConsistencyFinding[]
  checked: number // number of clauses reviewed
  model: string
  elapsed_ms: number
}

/** A proposed clause edit returned by the chat-edit endpoint. */
export interface EditProposal {
  edit_id: number
  block_id: number
  heading?: string
  before_text: string
  after_text: string
  after_html: string
  new_heading?: string
  rationale: string
  model: string
  elapsed_ms: number
  shrunk?: boolean // the revision is far shorter than the original (possible dropped content)
}

// ── Playbook types ────────────────────────────────────────────────────────────

export type PlaybookMethod = 'scratch' | 'document'
export type PlaybookStatus = 'pending' | 'processing' | 'ready' | 'failed'
export type PlaybookLLMProvider = 'local' | 'gemini'
export type RiskSeverity = 'critical' | 'major' | 'minor' | 'info'
export type RiskStatus = 'open' | 'accepted' | 'dismissed'

export interface PlaybookClause {
  id: number
  clause_type: string
  position: number
  standard_text: string
  red_lines: { rule: string; rationale: string }[]
  fallback_positions: { text: string; condition: string }[]
  notes: string
  source_doc_count: number
}

export interface Playbook {
  id: number
  name: string
  category: string
  description: string
  method: PlaybookMethod
  llm_provider: PlaybookLLMProvider
  status: PlaybookStatus
  document_count: number
  clauses: PlaybookClause[]
  created_at: string
  updated_at: string
}

export interface PlaybookListItem extends Omit<Playbook, 'clauses'> {}

export interface PlaybookRisk {
  id: number
  block: number | null
  block_heading: string | null
  playbook_clause: number | null
  clause_type: string | null
  severity: RiskSeverity
  issue: string
  suggestion: string
  quote: string
  status: RiskStatus
  created_at: string
}

export type RiskRecommendation = 'proceed' | 'negotiate' | 'decline'

export interface RiskRegisterItem {
  clause_type: string
  severity: RiskSeverity
  issue: string
  location: string
  recommendation: string
}

/** Document-level synthesis produced after the per-clause risk pass. */
export interface RiskReport {
  title: string
  recommendation: RiskRecommendation
  risk_register: RiskRegisterItem[]
  deal_breakers: string[]
  open_questions: string[]
  counts: Record<RiskSeverity, number>
}

export const playbookApi = {
  list: () =>
    api.get<Paginated<PlaybookListItem>>('/playbooks/').then(r => r.data.results),
  get: (id: number) =>
    api.get<Playbook>(`/playbooks/${id}/`).then(r => r.data),
  create: (data: FormData) =>
    api.post<Playbook>('/playbooks/', data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),
  delete: (id: number) => api.delete(`/playbooks/${id}/`),
  reprocess: (id: number) =>
    api.post(`/playbooks/${id}/reprocess/`).then(r => r.data),
  addDocuments: (id: number, data: FormData) =>
    api.post(`/playbooks/${id}/add-documents/`, data, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then(r => r.data),
  // Risk analysis on a draft session
  analyseRisks: (sessionId: number, playbookId?: number) =>
    api.post<{ risk_status: string }>(`/draft-sessions/${sessionId}/analyse-risks/`,
      playbookId ? { playbook_id: playbookId } : {}
    ).then(r => r.data),
  listSessionRisks: (sessionId: number) =>
    api.get<PlaybookRisk[]>(`/draft-sessions/${sessionId}/risks/`).then(r => r.data),
  getRiskReport: (sessionId: number) =>
    api.get<RiskReport | null>(`/draft-sessions/${sessionId}/risk-report/`).then(r => r.data),
  updateRiskStatus: (sessionId: number, riskId: number, riskStatus: RiskStatus) =>
    api.patch<{ status: RiskStatus }>(
      `/draft-sessions/${sessionId}/risks/${riskId}/status/`, { status: riskStatus }
    ).then(r => r.data),
  // Clause-level editing
  createClause: (data: Omit<PlaybookClause, 'id' | 'source_doc_count' | 'position'> & { playbook: number }) =>
    api.post<PlaybookClause>('/playbook-clauses/', data).then(r => r.data),
  updateClause: (id: number, data: Partial<Omit<PlaybookClause, 'id' | 'source_doc_count'>>) =>
    api.patch<PlaybookClause>(`/playbook-clauses/${id}/`, data).then(r => r.data),
  deleteClause: (id: number) => api.delete(`/playbook-clauses/${id}/`),
}

// Gemini-only for now. Kept as a list so review-screen label lookups still work;
// re-add the local model entry here to restore the model picker.
export const LLM_OPTIONS = [
  { label: 'Google Gemini (2.5 Flash)', value: 'gemini' },
]

// Translation target languages (IndicTrans2 via the translation endpoint).
export const TRANSLATE_LANGUAGES = [
  { label: 'English', value: 'en' },
  { label: 'Hindi', value: 'hi' },
  { label: 'Kannada', value: 'kn' },
  { label: 'Tamil', value: 'ta' },
  { label: 'Telugu', value: 'te' },
  { label: 'Malayalam', value: 'ml' },
  { label: 'Marathi', value: 'mr' },
  { label: 'Gujarati', value: 'gu' },
  { label: 'Bengali', value: 'bn' },
  { label: 'Punjabi', value: 'pa' },
  { label: 'Urdu', value: 'ur' },
]
