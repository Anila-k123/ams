import api from './client'

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
  created_at: string
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
}

/** Senior review of a delegated AMS task (AMS workspace/review.py). */
export type AmsReviewStatus = 'SUBMITTED' | 'CHANGES_REQUESTED' | 'APPROVED'
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
  exportDocx: (id: number, branding = false) =>
    api.get<Blob>(`/drafts/${id}/export/docx/`, { params: branding ? { branding: 1 } : {}, responseType: 'blob' })
      .then(r => {
        const m = /filename="([^"]+)"/.exec(r.headers['content-disposition'] || '')
        return { blob: r.data, filename: m ? m[1] : `draft_${id}.docx` }
      }),
  // File the saved draft on its AMS case (+ task). `caseId` links an unlinked draft first.
  sendToAms: (id: number, caseId?: number) =>
    api.post<{ documentId: number; version: number; taskLinked: boolean; syncedAt: string; amsCaseId: number;
               reviewStatus: AmsReviewStatus | null }>(
      `/drafts/${id}/send-to-ams/`, caseId ? { caseId } : {}).then(r => r.data),
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
