// "This event already exists" — shown when /api/events/create answers 409 with
// the existing event (events/views.py _find_duplicate: same case, date, type and
// title). Saving it again would also notify the client and the team twice, so
// the user decides: open the one that's there, go back, or add it anyway.
import { Modal } from "../ui/overlays";

const fmtDate = (iso?: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};
const fmtTime = (t?: string | null) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const d = new Date(); d.setHours(h, m || 0, 0, 0);
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
};
const typeLabel = (t?: string) => String(t || "Event").toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default function DuplicateEventDialog({ existing, busy, onOpen, onCancel, onAddAnyway }: {
  existing: any | null;           // the duplicate the server returned, or null when closed
  busy?: boolean;
  onOpen?: (ev: any) => void;     // omit where there's no event view to open
  onCancel: () => void;
  onAddAnyway: () => void;
}) {
  const ev = existing || {};
  const caseNo = ev.caseEntity?.caseNumber;
  return (
    <Modal open={!!existing} onClose={onCancel} size="narrow" title="This event already exists"
      footer={<>
        {onOpen && <button type="button" className="btn ghost" onClick={() => onOpen(existing)}>Open existing</button>}
        <span className="grow" />
        <button type="button" className="btn" onClick={onCancel} data-autofocus>Cancel</button>
        <button type="button" className={`btn primary${busy ? " loading" : ""}`} disabled={busy} onClick={onAddAnyway}>Add anyway</button>
      </>}>
      <p className="muted" style={{ fontSize: "var(--t-md)" }}>
        {typeLabel(ev.eventType)} <b>“{ev.title}”</b>
        {caseNo && <> for <span className="mono">{caseNo}</span></>} is already on <b>{fmtDate(ev.date)}</b>
        {ev.time ? <> at <b>{fmtTime(ev.time)}</b></> : null}.
      </p>
      <p className="faint small" style={{ marginTop: 10 }}>Adding it again also notifies the client and the team again.</p>
    </Modal>
  );
}
