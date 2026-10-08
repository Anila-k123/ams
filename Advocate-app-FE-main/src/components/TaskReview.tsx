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
  if (!canSubmitTask(task, myId)) return null;
  const canUpload = hasPermission("DOCUMENT_UPLOAD");
  const resubmit = task.reviewStatus === "CHANGES_REQUESTED";

  const send = async () => {
    setBusy(true);
    try {
      // Files first, linked without submitting; then one submission with the report.
      for (const file of files) {
        const fd = new FormData();
        fd.append("file", file);
        const cid = caseId ?? task.caseId;
        if (cid) fd.append("caseId", String(cid));
        const up = await api.post("/api/documents/upload", fd);
        if (up.data?.id) {
          await api.post(`/api/workspace/tasks/${task.id}/documents`, { documentId: up.data.id, submit: false });
        }
      }
      const res = await api.post(`/api/workspace/tasks/${task.id}/submit`, { note: note.trim(), hours });
      toast?.success(`Submitted to ${task.assignedByName || "the assigner"} for review.`);
      setOpen(false); setNote(""); setHours(null); setFiles([]);
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
              {s.changes != null && (
                <div className="task-submission-changes">
                  <div className="task-submission-changes-title">What changed since the previous version</div>
                  <DraftChanges changes={s.changes} />
                </div>
              )}
            </div>
          ))}

          {((onViewDocument && task.documents?.length > 0) || (onOpenDraft && task.draftSessionId)) && (
            <div className="task-work-files">
              {onOpenDraft && task.draftSessionId && (
                <Button variant="ghost" size="sm" icon="pen" onClick={() => { setOpen(false); onOpenDraft(); }}>Open draft</Button>
              )}
              {onViewDocument && task.documents?.map((d: any) => (
                <Button key={d.id} variant="ghost" size="sm" icon="eye" onClick={() => onViewDocument(d.id)}>{d.name}</Button>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
