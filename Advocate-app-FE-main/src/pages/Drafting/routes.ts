// Where the drafting screens live inside AMS (merge phase 04). The list pages sit in the
// AMS sidebar shell (/dashboard/*); the document tools and the editor are full-screen.
export const DRAFTING = {
  drafts: '/dashboard/drafting/drafts',
  newDraft: '/dashboard/drafting/new',
  templates: '/dashboard/drafting/templates',
  samples: '/dashboard/drafting/samples',
  playbooks: '/dashboard/drafting/playbooks',
  draft: (id: number | string) => `/draft/${id}`,
  sampleTool: (id: number | string, tool: string) => `/samples/${id}/${tool}`,
}

/** Start a new draft, optionally for an AMS case and task (the wizard reads the query). */
export function newDraftUrl({ caseId, taskId }: { caseId?: number | null; taskId?: number | null } = {}) {
  const q = new URLSearchParams()
  if (caseId) q.set('caseId', String(caseId))
  if (taskId) q.set('taskId', String(taskId))
  const qs = q.toString()
  return qs ? `${DRAFTING.newDraft}?${qs}` : DRAFTING.newDraft
}
