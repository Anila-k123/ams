import { useState } from "react";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputTextarea } from "primereact/inputtextarea";
import { Tag } from "primereact/tag";
import api from "../api/client";
import { canReviewTask } from "../utils/taskReview";
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
