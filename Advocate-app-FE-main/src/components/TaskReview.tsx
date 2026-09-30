import { useState } from "react";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputTextarea } from "primereact/inputtextarea";
import { InputNumber } from "primereact/inputnumber";
import { Tag } from "primereact/tag";
import api from "../api/client";
import { canReviewTask, canSubmitTask } from "../utils/taskReview";
import { usePermission } from "../contexts/PermissionContext";
import "../assets/styles/TaskReview.css";

// Senior review of delegated tasks (backend: workspace/review.py). A task one
// advocate assigned to another is SUBMITTED by the assignee, then APPROVED (the
// task completes) or sent back with CHANGES_REQUESTED by whoever assigned it.

const STATUS: Record<string, { label: string; severity: "warning" | "danger" | "success" }> = {
  SUBMITTED: { label: "Awaiting review", severity: "warning" },
  CHANGES_REQUESTED: { label: "Changes requested", severity: "danger" },
  APPROVED: { label: "Approved", severity: "success" },
};

export function ReviewChip({ task }: { task: any }) {
  const s = task.needsReview && STATUS[task.reviewStatus];
  if (!s) return null;
  const by = task.reviewedByName && task.reviewStatus !== "SUBMITTED" ? ` by ${task.reviewedByName}` : "";
  return <Tag className="task-review-chip" rounded severity={s.severity} value={s.label} title={`${s.label}${by}`} />;
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
      <Button className={buttonClass} size="small" outlined severity="success" icon="pi pi-check" label="Approve"
        disabled={busy} tooltip="Approve — completes the task" tooltipOptions={{ position: "top" }}
        onClick={() => send("approve")} />
      <Button className={buttonClass} size="small" outlined severity="danger" icon="pi pi-reply" label="Request changes"
        disabled={busy} tooltip="Send back with comments" tooltipOptions={{ position: "top" }}
        onClick={() => setAsking(true)} />
      <Dialog visible={asking} onHide={() => setAsking(false)} header={`Request changes — ${task.title}`}
        style={{ width: "32rem" }} breakpoints={{ "640px": "95vw" }} modal
        footer={
          <div className="flex justify-content-end gap-2">
            <Button label="Cancel" text size="small" onClick={() => setAsking(false)} />
            <Button label="Send back" severity="danger" size="small" disabled={busy || !note.trim()}
              onClick={() => send("request_changes", note.trim())} />
          </div>
        }>
        <div className="flex flex-column gap-2">
          <label htmlFor={`review-note-${task.id}`} className="font-semibold text-sm">
            What should {task.assignedToName || "they"} change?
          </label>
          <InputTextarea id={`review-note-${task.id}`} rows={4} value={note} autoFocus autoResize
            onChange={(e) => setNote(e.target.value)} placeholder="e.g. Add the cause of action and the prayer." />
        </div>
      </Dialog>
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
      <Button className="task-review-btn" size="small" icon="pi pi-send"
        label={resubmit ? "Resubmit" : "Submit work"} onClick={() => setOpen(true)}
        tooltip={`Hand this back to ${task.assignedByName || "the assigner"} for review`} tooltipOptions={{ position: "top" }} />
      <Dialog visible={open} onHide={() => setOpen(false)} header={`Submit work — ${task.title}`}
        style={{ width: "34rem" }} breakpoints={{ "640px": "95vw" }} modal
        footer={
          <div className="flex justify-content-end gap-2">
            <Button label="Cancel" text size="small" onClick={() => setOpen(false)} />
            <Button label={busy ? "Submitting…" : "Submit for review"} icon="pi pi-send" size="small"
              disabled={busy || !note.trim()} onClick={send} />
          </div>
        }>
        <div className="flex flex-column gap-3">
          {resubmit && task.reviewNote && (
            <div className="task-review-note changes">
              <strong>{task.reviewedByName || "Reviewer"} asked:</strong> {task.reviewNote}
            </div>
          )}
          <div className="flex flex-column gap-1">
            <label htmlFor={`submit-note-${task.id}`} className="font-semibold text-sm">What was done?</label>
            <InputTextarea id={`submit-note-${task.id}`} rows={4} autoResize autoFocus value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Filed the vakalat at the HC registry, diary no. 45/2026. Next listing 7 Oct." />
          </div>
          <div className="flex flex-column gap-1">
            <label htmlFor={`submit-hours-${task.id}`} className="font-semibold text-sm">
              Hours spent <span className="font-normal" style={{ color: "var(--text-muted)" }}>(optional)</span>
            </label>
            <InputNumber inputId={`submit-hours-${task.id}`} value={hours} onValueChange={(e) => setHours(e.value ?? null)}
              min={0} max={999} minFractionDigits={0} maxFractionDigits={2} placeholder="e.g. 1.5" />
          </div>
          {canUpload && (
            <div className="flex flex-column gap-1">
              <label className="font-semibold text-sm">
                Attach files <span className="font-normal" style={{ color: "var(--text-muted)" }}>(optional)</span>
              </label>
              <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}

/** Every hand-back on a delegated task, newest first, with the report and hours. */
export function SubmissionHistory({ task }: { task: any }) {
  const subs = task.submissions || [];
  if (!task.needsReview || subs.length === 0) return null;
  return (
    <div className="task-submissions">
      {subs.map((s: any) => (
        <div key={s.id} className="task-submission">
          <div className="task-submission-head">
            <i className="pi pi-send" /> {s.submittedByName || "Assignee"} submitted
            {s.createdAt ? ` on ${new Date(s.createdAt).toLocaleString()}` : ""}
            {s.hours ? ` · ${s.hours} h` : ""}
          </div>
          {s.note && <div className="task-submission-note">{s.note}</div>}
        </div>
      ))}
    </div>
  );
}
