import { useState } from "react";
import api from "../api/client";
import { canReviewTask, canSubmitTask } from "../utils/taskReview";
import { usePermission } from "../contexts/PermissionContext";
import { Button, Chip, Icon, type Tone } from "../ui/kit";
import { TextArea, TextField, Field } from "../ui/forms";
import { Modal } from "../ui/overlays";
import DraftChanges from "./DraftChanges";
import "../ui/pages/casedetail.css";
import { DOCUMENT_ACCEPT } from "../utils/fileTypes";
import { saveBlob } from "../utils/openWith";

type SubmittedDoc = { id: number; version: number; name: string };

/** The exact version that was handed in, to this computer (when the document has changed since). Opening a
 * submitted document always goes through Open with (the editor, where the reviewer approves); the editor's
 * Version History shows every earlier version too. */
async function downloadSubmitted(d: SubmittedDoc) {
  const r = await api.get<Blob>(`/api/documents/${d.id}/versions/${d.version}/download`, { responseType: "blob" });
  const m = /filename="([^"]+)"/.exec(r.headers["content-disposition"] || "");
  saveBlob(r.data, m ? m[1] : d.name);
}

// Senior review of delegated tasks (backend: workspace/review.py). A task one
// advocate assigned to another is SUBMITTED by the assignee, then APPROVED (the
// task completes) or sent back with CHANGES_REQUESTED by whoever assigned it.

const STATUS: Record<string, { label: string; tone: Tone }> = {
  SUBMITTED: { label: "Awaiting review", tone: "warn" },
  CHANGES_REQUESTED: { label: "Changes requested", tone: "bad" },
  APPROVED: { label: "Approved", tone: "ok" },
};

const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";
const fmtWhen = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

export function ReviewChip({ task }: { task: any }) {
  const s = task.needsReview && STATUS[task.reviewStatus];
  if (!s) return null;
  const by = task.reviewedByName && task.reviewStatus !== "SUBMITTED" ? ` by ${task.reviewedByName}` : "";
  return <Chip tone={s.tone} title={`${s.label}${by}`}>{s.label}</Chip>;
}

/** The reviewer's comment, shown on the task when it was sent back (or approved with a note). */
export function ReviewNote({ task }: { task: any }) {
  if (!task.needsReview || !task.reviewNote || task.reviewStatus === "SUBMITTED") return null;
  return (
    <div className={`task-review-note ${task.reviewStatus === "CHANGES_REQUESTED" ? "changes" : ""}`}>
      <strong>{task.reviewedByName || "Reviewer"}:</strong> {task.reviewNote}
    </div>
  );
}

/** Approve / Request changes, for whoever may review. `onDone` gets the updated task. */
export function ReviewActions({ task, myId, canAssign, onDone, toast, buttonClass = "task-review-btn" }: any) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  if (!canReviewTask(task, myId, canAssign)) return null;

  const send = async (action: string, text = "") => {
    setBusy(true);
    try {
      const res = await api.post(`/api/workspace/tasks/${task.id}/review`, { action, note: text });
      toast?.success(action === "approve" ? "Approved — task completed." : "Sent back with your comments.");
      setAsking(false); setNote("");
      onDone?.(res.data);
    } catch (err: any) {
      toast?.error(err.response?.data?.error || "Could not save the review.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button className={buttonClass} size="sm" icon="check" disabled={busy}
        title="Approve — completes the task" onClick={() => send("approve")}>Approve</Button>
      <Button className={buttonClass} size="sm" variant="danger" icon="edit" disabled={busy}
        title="Send back with comments" onClick={() => setAsking(true)}>Request changes</Button>
      <Modal open={asking} onClose={() => setAsking(false)} title="Request changes" sub={task.title} size="narrow"
        footer={<>
          <Button variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
          <Button variant="danger-solid" loading={busy} disabled={busy || !note.trim()}
            onClick={() => send("request_changes", note.trim())}>Send back</Button>
        </>}>
        <TextArea label={`What should ${task.assignedToName || "they"} change?`} rows={4} value={note} autoFocus
          onChange={(e) => setNote(e.target.value)} placeholder="e.g. Add the cause of action and the prayer." />
      </Modal>
    </>
  );
}

/**
 * "Submit work": the assignee hands a delegated task back with a report of what
 * was done, optional hours and (with upload permission) files. Any task type -
 * research, a filing, a hearing attended - reviews the same way as a draft.
 */
export function SubmitWork({ task, myId, onDone, toast, caseId }: any) {
  const { hasPermission } = usePermission() as any;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [hours, setHours] = useState<number | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  // Attached documents with this user's edits not saved to PactPro yet (docs/DESKTOP_EDITING.md): the
  // reviewer would see the older version, so the dialog offers to save them first.
  const [saved, setSaved] = useState<number[]>([]);
  const [savingDoc, setSavingDoc] = useState<number | null>(null);
  // Attached documents left out of this submission (reference material): everything is handed in by default.
  const [skipped, setSkipped] = useState<number[]>([]);
  if (!canSubmitTask(task, myId)) return null;
  const attached: any[] = task.documents || [];
  const unsaved = attached.filter((d) => d.pendingWork && !saved.includes(d.id));
  const saveFirst = async (d: any) => {
    setSavingDoc(d.id);
    try {
      await api.post(`/api/desktop-work/doc/${d.id}`, { action: "save" });
      setSaved((s) => [...s, d.id]);
      toast?.success(`${d.name} saved to PactPro.`);
    } catch (err: any) {
      toast?.error(err.response?.data?.error || "Could not save the edits.");
    } finally {
      setSavingDoc(null);
    }
  };
  const canUpload = hasPermission("DOCUMENT_UPLOAD");
  const resubmit = task.reviewStatus === "CHANGES_REQUESTED";

  const send = async () => {
    setBusy(true);
    try {
      // Files first, linked without submitting; then one submission with the report and what it hands in.
      const handedIn = attached.map((d) => d.id).filter((id) => !skipped.includes(id));
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const cid = caseId ?? task.caseId;
        if (cid) fd.append("caseId", String(cid));
        const up = await api.post("/api/documents/upload", fd);
        if (up.data?.id) {
          await api.post(`/api/workspace/tasks/${task.id}/documents`, { documentId: up.data.id, submit: false });
          handedIn.push(up.data.id);
        }
      }
      const res = await api.post(`/api/workspace/tasks/${task.id}/submit`, { note: note.trim(), hours, documentIds: handedIn });
      toast?.success(`Submitted to ${task.assignedByName || "the assigner"} for review.`);
      setOpen(false); setNote(""); setHours(null); setFiles([]); setSkipped([]);
      onDone?.(res.data);
    } catch (err: any) {
      toast?.error(err.response?.data?.error || "Could not submit the task.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button className="task-review-btn" size="sm" variant="primary" icon="send" onClick={() => setOpen(true)}
        title={`Hand this back to ${task.assignedByName || "the assigner"} for review`}>
        {resubmit ? "Resubmit" : "Submit work"}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Submit work" sub={task.title}
        footer={<>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" icon="send" loading={busy} disabled={busy || !note.trim()} onClick={send}>
            {busy ? "Submitting…" : "Submit for review"}
          </Button>
        </>}>
        <div className="stack" style={{ gap: "var(--s4)" }}>
          {resubmit && task.reviewNote && (
            <div className="task-review-note changes">
              <strong>{task.reviewedByName || "Reviewer"} asked:</strong> {task.reviewNote}
            </div>
          )}
          <div>
            <div className="small" style={{ fontWeight: 600, marginBottom: 4 }}>Hand in for review</div>
            {attached.length > 0 && <p className="faint xs" style={{ margin: "0 0 4px" }}>Untick reference documents: they stay on the task but aren't reviewed or approved.</p>}
            {attached.length === 0 ? (
              <p className="faint small">No documents attached to this task{canUpload ? " (attach files below if needed)" : ""}.</p>
            ) : (
              <ul className="stack" style={{ gap: 4, margin: 0, padding: 0, listStyle: "none" }}>
                {attached.map((d) => {
                  const pending = d.pendingWork && !saved.includes(d.id);
                  return (
                    <li key={d.id} className="row" style={{ gap: 8, alignItems: "center" }}>
                      <label className="small row" style={{ flex: 1, gap: 6, alignItems: "center", cursor: "pointer" }}>
                        <input type="checkbox" checked={!skipped.includes(d.id)}
                          onChange={(e) => setSkipped((s) => (e.target.checked ? s.filter((x) => x !== d.id) : [...s, d.id]))} />
                        <span>
                          {d.name}{d.version ? <span className="faint">{` · v${d.version}`}</span> : null}
                          {pending && <span style={{ color: "var(--warn)" }}> · edits not saved to PactPro</span>}
                        </span>
                      </label>
                      {pending && (
                        <Button size="sm" loading={savingDoc === d.id} disabled={savingDoc !== null}
                          title="Make your latest edits a PactPro version, so the reviewer sees them"
                          onClick={() => void saveFirst(d)}>Save to PactPro</Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {unsaved.length > 0 && (
              <p className="small" style={{ color: "var(--warn)", marginTop: 4 }}>
                Unsaved edits are not submitted: the reviewer gets the last version saved to PactPro.
              </p>
            )}
          </div>
          <TextArea label="What was done?" rows={4} autoFocus value={note} required
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Filed the vakalat at the HC registry, diary no. 45/2026. Next listing 7 Oct." />
          <TextField label="Hours spent" hint="Optional" type="number" min={0} max={999} step="0.25"
            value={hours ?? ""} placeholder="e.g. 1.5"
            onChange={(e) => setHours(e.target.value === "" ? null : Number(e.target.value))} />
          {canUpload && (
            <Field label="Attach files" hint="Optional">
              {(id, d) => <input id={id} aria-describedby={d} type="file" accept={DOCUMENT_ACCEPT} multiple className="input"
                onChange={(e) => setFiles(Array.from(e.target.files || []))} />}
            </Field>
          )}
        </div>
      </Modal>
    </>
  );
}

/**
 * The hand-backs on a delegated task. The list shows one summary line; the
 * full reports (a research note can run to many lines) open in a dialog, so a
 * long submission doesn't push every other task down the page. The dialog also
 * carries the attachments and, for the reviewer, Approve / Request changes, so
 * the work can be read and decided in one place.
 *
 * Optional props come from the page: without myId/canAssign the dialog is
 * read-only; without onViewDocument / onOpenDraft those links are hidden.
 */
export function SubmissionHistory({ task, myId, canAssign, toast, onDone, onViewDocument, onOpenDraft }: {
  task: any; myId?: any; canAssign?: boolean; toast?: any; onDone?: (t?: any) => void;
  onViewDocument?: (id: any) => void; onOpenDraft?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const subs = task.submissions || [];
  if (!task.needsReview || subs.length === 0) return null;
  const latest = subs[0];   // the API lists them newest first
  // The task's attachments not handed in with the latest submission (all of them for older submissions,
  // which didn't record what they handed in).
  const handedIn = new Set<number>((Array.isArray(latest?.documents) ? latest.documents : []).map((d: SubmittedDoc) => d.id));
  const reference = (task.documents || []).filter((d: any) => !handedIn.has(d.id));

  return (
    <>
      <div className="task-submission task-submission-summary">
        <span className="task-submission-head" title={latest.note || ""}>
          {latest.submittedByName || "Assignee"} submitted
          {latest.createdAt ? ` · ${fmtDate(latest.createdAt)}` : ""}
          {latest.hours ? ` · ${latest.hours} h` : ""}
          {subs.length > 1 ? ` · ${subs.length} submissions` : ""}
          {latest.changes?.length
            ? ` · ${latest.changes.length} section${latest.changes.length > 1 ? "s" : ""} changed` : ""}
        </span>
        <Button variant="ghost" size="sm" icon="eye" onClick={() => setOpen(true)}>View work</Button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Submitted work" sub={task.title} size="wide"
        footer={myId !== undefined && canReviewTask(task, myId, canAssign) ? (
          <ReviewActions task={task} myId={myId} canAssign={canAssign} toast={toast}
            onDone={(t: any) => { setOpen(false); onDone?.(t); }} />
        ) : undefined}>
        <div className="task-work">
          <div className="task-work-facts">
            {task.caseNumber && <span><Icon name="case" size="sm" /><span className="mono">{task.caseNumber}</span></span>}
            {task.deadline && <span><Icon name="calendar" size="sm" />Due {fmtDate(task.deadline)}</span>}
            {task.assignedToName && <span><Icon name="user" size="sm" />{task.assignedToName}</span>}
            <ReviewChip task={task} />
          </div>
          <ReviewNote task={task} />

          {subs.map((s: any, i: number) => (
            <div key={s.id} className="task-submission">
              <div className="task-submission-head">
                <Icon name="send" size="sm" /> {i === 0 ? "Latest submission" : "Earlier submission"}:{" "}
                {s.submittedByName || "Assignee"}, {fmtWhen(s.createdAt)}
                {s.hours ? ` · ${s.hours} h` : ""}
              </div>
              {s.note ? <div className="task-submission-note">{s.note}</div>
                : <div className="task-submission-note task-muted">No report written.</div>}
              {Array.isArray(s.documents) && s.documents.length > 0 && (
                <div className="task-work-files">
                  {s.documents.map((d: SubmittedDoc) => {
                    const now = (task.documents || []).find((x: any) => x.id === d.id)?.version;
                    const changed = now != null && now !== d.version;
                    return (
                      <span key={d.id} className="row" style={{ gap: 2 }}>
                        <Button variant="ghost" size="sm" icon="eye" disabled={!onViewDocument}
                          title={changed ? `Open it (now v${now}; Version History in the editor shows v${d.version})` : "Open it"}
                          onClick={() => { setOpen(false); onViewDocument?.(d.id); }}>
                          {`${d.name} · submitted v${d.version}${changed ? ` · now v${now}` : ""}`}
                        </Button>
                        {changed && (
                          <Button variant="ghost" size="sm" iconOnly icon="download" aria-label={`Download v${d.version} as submitted`}
                            title={`Download v${d.version}, exactly as submitted`}
                            onClick={() => void downloadSubmitted(d).catch(() => toast?.error("Could not download that version."))} />
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
              {s.changes != null && (
                <div className="task-submission-changes">
                  <div className="task-submission-changes-title">What changed since the previous version</div>
                  <DraftChanges changes={s.changes} />
                </div>
              )}
            </div>
          ))}

          {((onViewDocument && reference.length > 0) || (onOpenDraft && task.draftSessionId)) && (
            <div className="task-work-files">
              {onOpenDraft && task.draftSessionId && (
                <Button variant="ghost" size="sm" icon="pen" onClick={() => { setOpen(false); onOpenDraft(); }}>Open draft</Button>
              )}
              {onViewDocument && reference.length > 0 && (
                <span className="faint small" title="Attached to the task but not handed in for review">
                  {Array.isArray(latest.documents) ? "Reference:" : "Attached:"}
                </span>
              )}
              {onViewDocument && reference.map((d: any) => (
                <Button key={d.id} variant="ghost" size="sm" icon="eye" onClick={() => { setOpen(false); onViewDocument(d.id); }}>{d.name}</Button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
