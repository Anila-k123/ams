import { diffWords } from "diff";
import { Tag } from "primereact/tag";
import "../assets/styles/TaskReview.css";

// What a resubmitted draft changed since the last version the reviewer saw
// (backend: workspace/review.compare_drafts). Shown in the task's View work
// dialog and in the drafting editor's review bar, so a senior can check that a
// requested change was made without rereading the whole draft.

export type DraftChange = {
  heading: string;
  kind: "edited" | "added" | "removed";
  before: string;
  after: string;
};

const KIND: Record<DraftChange["kind"], { label: string; severity: "warning" | "success" | "danger" }> = {
  edited: { label: "Edited", severity: "warning" },
  added: { label: "Added", severity: "success" },
  removed: { label: "Removed", severity: "danger" },
};

// Unchanged text longer than this is shortened to its ends, so a one-figure
// change in a long clause stays easy to spot.
const KEEP = 60;

function shorten(text: string) {
  if (text.length <= KEEP * 2 + 20) return text;
  return `${text.slice(0, KEEP)} … ${text.slice(-KEEP)}`;
}

function WordDiff({ before, after }: { before: string; after: string }) {
  const parts = diffWords(before || "", after || "");
  return (
    <div className="draft-diff">
      {parts.map((p, i) =>
        p.added ? <ins key={i}>{p.value}</ins>
          : p.removed ? <del key={i}>{p.value}</del>
            : <span key={i}>{shorten(p.value)}</span>)}
    </div>
  );
}

/** "Reliefs claimed (edited), Prayer (added)" — for one-line summaries. */
export function changeSummary(changes?: DraftChange[] | null) {
  if (!changes || changes.length === 0) return "";
  return changes.map((c) => `${c.heading || "Untitled section"} (${c.kind})`).join(", ");
}

export default function DraftChanges({ changes }: { changes?: DraftChange[] | null }) {
  if (changes == null) return null;   // a first submission: nothing to compare with
  if (changes.length === 0) {
    return <div className="draft-changes-none">No text changes since the previous version.</div>;
  }
  return (
    <div className="draft-changes">
      {changes.map((c, i) => (
        <div key={i} className="draft-change">
          <div className="draft-change-head">
            <strong>{c.heading || "Untitled section"}</strong>
            <Tag value={KIND[c.kind].label} severity={KIND[c.kind].severity} rounded />
          </div>
          {c.kind === "edited" && <WordDiff before={c.before} after={c.after} />}
          {c.kind === "added" && <div className="draft-diff"><ins>{c.after}</ins></div>}
          {c.kind === "removed" && <div className="draft-diff"><del>{c.before}</del></div>}
        </div>
      ))}
    </div>
  );
}
