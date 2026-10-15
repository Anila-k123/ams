import { useCallback, useState, type ReactNode } from "react";
import api, { errorMessage } from "../api/client";
import { useToast } from "../contexts/ToastContext";
import { Button } from "../ui/kit";
import { Modal } from "../ui/overlays";
import { useOpenWith } from "./OpenWithDialog";
import { createTaskDocument, documentEditorUrl } from "../utils/taskDocument";

type TaskDoc = { id: number; name: string; version?: number | null; editable?: boolean; pendingWork?: boolean };
type Task = { id: number; title?: string; caseId?: number | null; documents?: TaskDoc[] };

/** The task's documents that can be worked on in an editor (Word, Excel, PowerPoint...). */
export const editableTaskDocs = (task: Task) => (task.documents || []).filter((d) => d.editable);

/** The task button's label: carry on with the task's document, or start one. */
export const taskDocumentLabel = (task: Task) => (editableTaskDocs(task).length ? "Continue document" : "Write in editor");

/**
 * "Write in editor" / "Continue document" on a task (docs/DESKTOP_EDITING.md, "Tasks"). A task keeps its
 * document: with one attached, it opens that one (Open with: PactPro editor or desktop); with several, the
 * user picks one or starts a new one; with none, a new Word document is made and attached. So going back to
 * a task picks up the earlier work instead of starting over.
 * `const { openTaskDocument, dialog, busy } = useTaskDocument()`; render `dialog` once in the page.
 */
export function useTaskDocument(): {
  openTaskDocument: (task: Task) => Promise<void>; openAttached: (task: Task, docId: number) => void;
  dialog: ReactNode; busy: boolean;
} {
  const toast = useToast();
  const openWith = useOpenWith();
  const [choose, setChoose] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);

  const openDoc = useCallback((id: number) => openWith.openDocument("doc", id, documentEditorUrl(id)), [openWith]);

  const startNew = useCallback(async (task: Task) => {
    setBusy(true);
    try {
      await openDoc(await createTaskDocument(task));
    } catch (e) {
      toast.error(errorMessage(e, "Could not create the document."));
    } finally {
      setBusy(false);
    }
  }, [openDoc, toast]);

  const openTaskDocument = useCallback(async (task: Task) => {
    const docs = editableTaskDocs(task);
    if (docs.length === 0) return startNew(task);
    if (docs.length === 1) return openDoc(docs[0].id);
    setChoose(task);
  }, [openDoc, startNew]);

  // A task's attached document (the Attached list, a submission, the reviewer's dialog): one the editor can
  // open goes through Open with (PactPro editor or desktop, where the reviewer also approves); others (PDF,
  // images) open in the browser's viewer as before.
  const openAttached = useCallback((task: Task, docId: number) => {
    const d = (task.documents || []).find((x) => x.id === docId);
    if (d?.editable) { void openDoc(docId); return; }
    api.get<Blob>(`/api/documents/preview/${docId}`, { responseType: "blob" })
      .then((r) => window.open(URL.createObjectURL(r.data), "_blank"))
      .catch(() => toast.error("Could not open the document."));
  }, [openDoc, toast]);

  const docs = choose ? editableTaskDocs(choose) : [];
  const dialog = (
    <>
      {openWith.dialog}
      <Modal open={!!choose} onClose={() => setChoose(null)} size="narrow" title="Continue which document?"
        sub={choose?.title}>
        <div className="stack">
          {docs.map((d) => (
            <Button key={d.id} icon="file" onClick={() => { setChoose(null); void openDoc(d.id); }}>
              {`${d.name}${d.version ? ` · v${d.version}` : ""}${d.pendingWork ? " · unsaved edits" : ""}`}
            </Button>
          ))}
          <Button variant="ghost" icon="plus" loading={busy}
            onClick={() => { const t = choose; setChoose(null); if (t) void startNew(t); }}>
            Start a new document for this task
          </Button>
        </div>
      </Modal>
    </>
  );
  return { openTaskDocument, openAttached, dialog, busy };
}
