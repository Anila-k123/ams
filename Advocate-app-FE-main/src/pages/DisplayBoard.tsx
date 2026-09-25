import { useState, useEffect, useCallback } from "react";
import { Button } from "primereact/button";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { ProgressSpinner } from "primereact/progressspinner";
import { SelectButton } from "primereact/selectbutton";
import api from "../api/client";
import "../assets/styles/DisplayBoard.css";

// Fallback list until the courts endpoint responds.
const FALLBACK_COURTS: any[] = [
  { value: "delhi", label: "Delhi High Court" },
  { value: "chennai", label: "Madras High Court" },
  { value: "madurai", label: "Madras High Court at Madurai" },
  { value: "kochi", label: "Kerala High Court" },
];

function formatFetchedAt(iso: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// The Supreme Court's own site splits its board into "Regular Court" and
// "Video Conferencing" toggles (same hearings), so the scraper exposes them as
// two court ids (sci / sci_vc). Collapse them into one entry for the accordion.
function mergeSciCourts(list: any[]) {
  let inserted = false;
  return list.reduce((acc: any[], c) => {
    if (c.value === "sci" || c.value === "sci_vc") {
      if (!inserted) {
        acc.push({
          value: "sci",
          label: "Supreme Court of India",
          note: "Combines the Regular Court and Video Conferencing listings — same courtrooms, shown together.",
        });
        inserted = true;
      }
      return acc;
    }
    acc.push(c);
    return acc;
  }, []);
}

// Merge two boards' rows by courtroom number, preferring whichever side has
// an actual case listed for that room.
function mergeSciRows(rowsA: any[] = [], rowsB: any[] = []) {
  const byNumber = new Map();
  const order: any[] = [];
  for (const r of [...rowsA, ...rowsB]) {
    const existing = byNumber.get(r.courtNumber);
    if (!existing) order.push(r.courtNumber);
    if (!existing || (r.status === "listed" && existing.status !== "listed")) {
      byNumber.set(r.courtNumber, r);
    }
  }
  return order.map((cn) => byNumber.get(cn));
}

// Fetches several underlying bench court ids in parallel; a failed fetch for
// one bench resolves to null. Used only for SCI's Regular/VC toggle merge.
async function fetchBenches(benchValues: string[]) {
  const results = await Promise.allSettled(
    benchValues.map((v) => api.get("/api/workspace/display-board", { params: { bench: v } }))
  );
  return results.map((r) => (r.status === "fulfilled" ? r.value.data : null));
}

// One catalog entry per possible board field. The table shows a column whenever
// any row in the loaded board populates it. Never hardcode a court's column set.
const FIELD_CATALOG: { key: string; label: string; has: (r: any) => boolean; render: (r: any) => any }[] = [
  { key: "itemNumber", label: "Item", has: (r) => !!r.itemNumber, render: (r) => r.itemNumber },
  // Where YOUR case sits in this courtroom's list today, from the stored cause list.
  { key: "yourItem", label: "Your Item", has: (r) => !!r.yourItem, render: (r) => <strong className="board-your-item">{r.yourItem}</strong> },
  { key: "listType", label: "List", has: (r) => !!r.listType, render: (r) => r.listType },
  { key: "caseString", label: "Case No.", has: (r) => !!r.caseString, render: (r) => r.caseString },
  { key: "title", label: "Title", has: (r) => !!r.title, render: (r) => r.title },
  {
    key: "judges", label: "Judge(s)",
    has: (r) => !!(r.judge || (r.judges && r.judges.length)),
    render: (r) => (r.judges && r.judges.length ? r.judges.map((j: string, k: number) => <div key={k}>{j}</div>) : r.judge || "—"),
  },
  { key: "advocates", label: "Advocates", has: (r) => !!r.advocates, render: (r) => r.advocates },
  {
    key: "vcLink", label: "VC Link", has: (r) => !!r.vcLink,
    render: (r) => <a className="board-vc" href={r.vcLink} target="_blank" rel="noreferrer">VC link</a>,
  },
  { key: "cino", label: "CNR", has: (r) => !!r.cino, render: (r) => r.cino },
  { key: "keptBack", label: "Kept Back", has: (r) => !!r.keptBack, render: (r) => r.keptBack },
  { key: "venue", label: "Venue", has: (r) => !!r.venue, render: (r) => r.venue },
  { key: "message", label: "Message", has: (r) => !!r.message, render: (r) => r.message },
  { key: "stage", label: "Stage", has: (r) => !!r.stage, render: (r) => r.stage },
  { key: "progress", label: "Progress", has: (r) => !!r.progress, render: (r) => r.progress },
  { key: "reference", label: "Reference", has: (r) => !!r.reference, render: (r) => r.reference },
];

// One court row: header toggles open; the board loads lazily on first open.
function CourtPanel({ court, isOpen, onToggle }: { court: any; isOpen: boolean; onToggle: () => void }) {
  const [state, setState] = useState<{ status: string; board: any; error: string }>({ status: "idle", board: null, error: "" });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: "loading", error: "" }));
    try {
      if (court.value === "sci") {
        const [rcBoard, vcBoard] = await fetchBenches(["sci", "sci_vc"]);
        if (!rcBoard && !vcBoard) throw new Error("SCI board unavailable");
        setState({
          status: "done",
          board: {
            boardDate: rcBoard?.boardDate || vcBoard?.boardDate || "",
            fetchedAt: rcBoard?.fetchedAt || vcBoard?.fetchedAt || "",
            rows: mergeSciRows(rcBoard?.rows, vcBoard?.rows),
          },
          error: "",
        });
        return;
      }
      const res = await api.get("/api/workspace/display-board", { params: { bench: court.value } });
      setState({ status: "done", board: res.data, error: "" });
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Could not load this court's display board.";
      setState({ status: "error", board: null, error: msg });
    }
  }, [court.value]);

  // Fetch the first time this panel is opened.
  useEffect(() => {
    if (isOpen && state.status === "idle") load();
  }, [isOpen, state.status, load]);

  const { status, board, error } = state;
  const rows: any[] = board?.rows || [];
  const visibleFields = FIELD_CATALOG.filter((f) => rows.some(f.has));

  return (
    <div className={`court-panel ${isOpen ? "open" : ""}`}>
      <button type="button" className="court-panel-header" onClick={onToggle} aria-expanded={isOpen}>
        <span className="court-panel-title-group">
          <span className="court-panel-title">{court.label}</span>
          {court.note && <span className="court-panel-note">{court.note}</span>}
        </span>
        <i className="pi pi-chevron-down court-panel-chevron" />
      </button>

      {isOpen && (
        <div className="court-panel-body">
          {board && status === "done" && (
            <div className="board-meta">
              {board.boardDate && <span>Board date: <strong>{board.boardDate}</strong></span>}
              <span>{rows.length} court{rows.length === 1 ? "" : "s"}</span>
              {board.fetchedAt && <span>Data as of {formatFetchedAt(board.fetchedAt)}</span>}
              <Button icon="pi pi-refresh" label="Refresh" className="p-button-outlined p-button-sm ml-auto" onClick={load} />
            </div>
          )}

          {status === "loading" && (
            <div className="board-empty flex align-items-center gap-2">
              <ProgressSpinner style={{ width: 20, height: 20 }} strokeWidth="6" /> Loading display board…
            </div>
          )}

          {status === "error" && (
            <div className="board-error">
              <i className="pi pi-exclamation-circle" />
              <span>{error}</span>
              <Button label="Retry" className="p-button-text p-button-sm p-button-danger" onClick={load} />
            </div>
          )}

          {status === "done" && rows.length > 0 && (
            <DataTable value={rows} size="small" responsiveLayout="scroll"
              rowClassName={(r: any) => (r.status === "list_over" || r.status === "no_case" ? "row-over" : "")}>
              <Column header="Court" body={(r: any) => r.courtNumber || "—"} className="board-court" />
              {visibleFields.map((f) => (
                <Column key={f.key} header={f.label} className={`board-field-${f.key}`}
                  body={(r: any) => (f.has(r) ? f.render(r) : "—")} />
              ))}
            </DataTable>
          )}

          {status === "done" && rows.length === 0 && (
            <div className="board-empty">No courts are currently on the board.</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DisplayBoard() {
  const [courts, setCourts] = useState<any[]>(FALLBACK_COURTS);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [myForums, setMyForums] = useState<any[]>([]);
  // Default to All Forums and switch once we know the practice has courts of its own.
  const [tab, setTab] = useState("all");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/api/workspace/display-board/courts");
        if (res.data?.courts?.length) setCourts(mergeSciCourts(res.data.courts));
      } catch { /* keep the fallback list */ }
    })();
  }, []);

  // My Forums (courts the practice has cases in) is cheap stored data, so it loads up front.
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/api/causelist/my-forums");
        const mine = res.data?.courts || [];
        setMyForums(mine);
        if (mine.length) setTab("mine");
      } catch { /* leave My Forums empty; All Forums still works */ }
    })();
  }, []);

  // SCI is shown as one entry but is two provider keys; a case resolves to "sci".
  const mineKeys = new Set(myForums.map((c) => c.value));
  const shown = tab === "mine" ? courts.filter((c) => mineKeys.has(c.value)) : courts;

  const tabOptions = [
    { value: "mine", label: `My Forums${myForums.length ? ` (${myForums.length})` : ""}`, disabled: !myForums.length },
    { value: "all", label: `All Forums (${courts.length})` },
  ];

  return (
    <div className="board-container">
      <p className="board-sub mb-3">Select a court to see its live cause list.</p>

      <SelectButton className="mb-3" value={tab} options={tabOptions} optionDisabled="disabled"
        onChange={(e) => e.value && setTab(e.value)} />

      <div className="court-accordion">
        {shown.map((c) => (
          <CourtPanel key={c.value} court={c} isOpen={openKey === c.value}
            onToggle={() => setOpenKey((k) => (k === c.value ? null : c.value))} />
        ))}
        {tab === "mine" && !shown.length && (
          <p className="board-empty-note">
            None of your cases could be matched to a court yet. Import a case
            from the court record to link it, or use All Forums.
          </p>
        )}
      </div>
    </div>
  );
}
