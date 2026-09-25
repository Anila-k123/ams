import api from './client'
import type { Sample } from './drafting'

/** A case as listed by AMS (/api/drafting/ams-cases/). */
export interface AmsCase {
  id: number
  caseNumber: string
  caseTitle: string | null
  caseType?: string | null
  status?: string | null
  clientId?: number | null
  clientName?: string | null
}

export interface AmsTask {
  id: number
  title: string
  priority?: string
  deadline?: string | null
}

/** Result of linking a draft to an AMS case: the InstaDraft client/project that
 *  mirror it, plus candidate fact values keyed by slot key. */
export interface AmsLink {
  projectId: number
  clientId: number
  case: AmsCase
  prefill: Record<string, string>
  task: AmsTask | null
}

/** The practice's AMS cases and documents, served in-process under /api/drafting/. */
export const amsApi = {
  cases: (search = '', page = 0) =>
    api.get<{ content: AmsCase[]; totalElements: number }>('/ams-cases/', { params: { search, page } })
      .then(r => r.data),
  linkCase: (caseId: number, taskId?: number | null) =>
    api.post<AmsLink>('/link-case/', { caseId, taskId: taskId ?? undefined }).then(r => r.data),
}

/** "OS/12/2026 — Sharma v. State" */
export const amsCaseLabel = (c: Pick<AmsCase, 'caseNumber' | 'caseTitle'>) =>
  [c.caseNumber, c.caseTitle].filter(Boolean).join(' — ')

/** A document in the user's AMS (their practice's PDFs/DOCX), with its InstaDraft import. */
export interface AmsDocument {
  id: number
  documentName: string
  originalName: string
  version: number
  category?: string | null
  caseNumber?: string | null
  clientName?: string | null
  uploadedByName?: string | null
  uploadDate?: string | null
  // null = not prepared yet; current=false = AMS has a newer version than the import.
  sample: { id: number; status: Sample['status']; current: boolean } | null
}

export const amsDocumentsApi = {
  list: (search = '', page = 0) =>
    api.get<{ content: AmsDocument[]; totalElements: number; totalPages: number }>(
      '/ams-documents/', { params: { search, page } }).then(r => r.data),
  /** Import (or refresh) an AMS document for drafting; returns its Sample (processing starts). */
  prepare: (amsId: number) =>
    api.post<Sample>(`/ams-documents/${amsId}/import/`).then(r => r.data),
}

/** Display name with the file extension (the Documents page picks its icon from it). */
export const amsDocName = (d: Pick<AmsDocument, 'documentName' | 'originalName'>) => {
  const ext = (d.originalName.match(/\.[a-z0-9]+$/i)?.[0] || '').toLowerCase()
  return d.documentName.toLowerCase().endsWith(ext) ? d.documentName : `${d.documentName}${ext}`
}
