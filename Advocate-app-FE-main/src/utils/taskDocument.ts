import api from "../api/client";

/**
 * "Write in editor" on a task: a blank Word document named after the task, on the task's case, attached
 * to the task (not submitting it), ready to open in the document editor (docs/ONLYOFFICE_PLAN.md). The
 * attached document then goes to the reviewer with the task, like an uploaded one. Returns its id.
 */
export async function createTaskDocument(task: { id: number; title?: string; caseId?: number | null }): Promise<number> {
  const name = (task.title || "").trim() || `Task ${task.id}`;
  const res = await api.post("/api/documents/new", { kind: "word", name, case_id: task.caseId || undefined });
  const docId = res.data.id as number;
  await api.post(`/api/workspace/tasks/${task.id}/documents`, { documentId: docId, submit: false });
  return docId;
}

export const documentEditorUrl = (docId: number) => `/dashboard/documents/${docId}/edit`;
