import { useEffect, useState } from "react";
import { Modal } from "../ui/overlays";
import { Button } from "../ui/kit";
import { TextArea } from "../ui/forms";
import { CLOSE_REASONS } from "../constants/caseClosure";

// Closing a case asks why (cases/closure.py): the answer decides whether PactPro keeps watching the court
// for it. Used by the case page's status field and its "reason not recorded" mark.
export default function CloseCaseDialog({ open, caseNumber, initialReason = "", initialNote = "", busy, onCancel, onConfirm }: {
  open: boolean;
  caseNumber?: string;
  initialReason?: string;
  initialNote?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, note: string) => void;
}) {
  const [reason, setReason] = useState(initialReason);
  const [note, setNote] = useState(initialNote);
  useEffect(() => { if (open) { setReason(initialReason); setNote(initialNote); } }, [open, initialReason, initialNote]);
  const needNote = reason === "other" && !note.trim();

  return (
    <Modal open={open} onClose={() => !busy && onCancel()} title="Close case" size="narrow"
      sub={caseNumber ? <span className="mono">{caseNumber}</span> : undefined}
      footer={<>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={!reason || needNote} onClick={() => onConfirm(reason, note.trim())}>Close case</Button>
      </>}>
      <div className="stack" style={{ gap: "var(--s3)" }}>
        <fieldset className="stack" style={{ gap: "var(--s2)", border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Why is it closed?</legend>
          {CLOSE_REASONS.map((r) => (
            <label key={r.value} className="check" style={{ alignItems: "flex-start" }}>
              <input type="radio" name="close-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
              <span>
                <b>{r.label}</b>
                <span className="faint xs" style={{ display: "block" }}>{r.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <TextArea label={reason === "other" ? "Note" : "Note (optional)"} required={reason === "other"} rows={2} maxLength={500}
          value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. NOC given on 14 Oct; client moved to another counsel" />
        <p className="faint xs">Notes, documents and bills stay. Anyone in the team who can edit the case can reopen it.</p>
      </div>
    </Modal>
  );
}
