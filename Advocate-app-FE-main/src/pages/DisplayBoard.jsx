import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { FiAlertCircle, FiChevronDown, FiRefreshCw } from "react-icons/fi";
import "../assets/styles/DisplayBoard.css";

// Fallback list until the courts endpoint responds.
const FALLBACK_COURTS = [
  { value: "delhi", label: "Delhi High Court" },
  { value: "chennai", label: "Madras High Court" },
  { value: "madurai", label: "Madras High Court at Madurai" },
  { value: "kochi", label: "Kerala High Court" },
];

function formatFetchedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function authHeaders() {
  const token = localStorage.getItem("token");
  return { headers: { Authorization: `Bearer ${token}` } };
}

// The Supreme Court's own site splits its board into "Regular Court" and
// "Video Conferencing" toggles (same hearings, just how they're being
// attended), so the scraper exposes them as two court ids (sci / sci_vc).
// Collapse them into one "Supreme Court of India" entry for the accordion.
function mergeSciCourts(list) {
  let inserted = false;
  return list.reduce((acc, c) => {
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
// an actual case listed for that room (they're normally identical, but this
// stays correct if the two toggles ever genuinely diverge).
function mergeSciRows(rowsA = [], rowsB = []) {
  const byNumber = new Map();
  const order = [];
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
// one bench resolves to null rather than failing the whole board. Used only
// for SCI's Regular/VC toggle merge — every other court's benches (Madras,
// Karnataka, Bombay, ...) are shown as separate top-level entries, each with
// its own official name (e.g. "Karnataka High Court at Bengaluru" / "at
// Dharwad" / "at Kalaburagi"), matching how established legal-tech products
// like Provakil list them — no combining, no per-row bench tagging.
async function fetchBenches(benchValues) {
  const results = await Promise.allSettled(
    benchValues.map((v) => axios.get("/api/workspace/display-board", { ...authHeaders(), params: { bench: v } }))
  );
  return results.map((r) => (r.status === "fulfilled" ? r.value.data : null));
}

// One catalog entry per possible board field, covering every field the shared
// BoardRow shape can carry. A new court/scraper field means adding ONE entry
// here — the table shows it as a real column whenever any row in the
// currently loaded board actually populates it, and hides it everywhere
// else. Never hardcode a specific court's column set; the data decides.
const FIELD_CATALOG = [
  { key: "itemNumber", label: "Item", has: (r) => !!r.itemNumber, render: (r) => r.itemNumber },
  { key: "caseString", label: "Case No.", has: (r) => !!r.caseString, render: (r) => r.caseString },
  { key: "title", label: "Title", has: (r) => !!r.title, render: (r) => r.title },
  {
    key: "judges", label: "Judge(s)",
    has: (r) => !!(r.judge || (r.judges && r.judges.length)),
    render: (r) => (r.judges && r.judges.length
      ? r.judges.map((j, k) => <div key={k}>{j}</div>)
      : r.judge || "—"),
  },
  { key: "advocates", label: "Advocates", has: (r) => !!r.advocates, render: (r) => r.advocates },
  {
    key: "vcLink", label: "VC Link",
    has: (r) => !!r.vcLink,
    render: (r) => (
      <a className="board-vc" href={r.vcLink} target="_blank" rel="noreferrer">VC link</a>
    ),
  },
  { key: "cino", label: "CNR", has: (r) => !!r.cino, render: (r) => r.cino },
  { key: "keptBack", label: "Kept Back", has: (r) => !!r.keptBack, render: (r) => r.keptBack },
  { key: "venue", label: "Venue", has: (r) => !!r.venue, render: (r) => r.venue },
  { key: "message", label: "Message", has: (r) => !!r.message, render: (r) => r.message },
  { key: "stage", label: "Stage", has: (r) => !!r.stage, render: (r) => r.stage },
];

// One court row: header toggles open; the board loads lazily on first open.
function CourtPanel({ court, isOpen, onToggle }) {
  const [state, setState] = useState({ status: "idle", board: null, error: "" });

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
      const res = await axios.get("/api/workspace/display-board", {
        ...authHeaders(),
        params: { bench: court.value },
      });
      setState({ status: "done", board: res.data, error: "" });
    } catch (err) {
      const msg = err?.response?.data?.error || "Could not load this court's display board.";
      setState({ status: "error", board: null, error: msg });
    }
  }, [court.value]);

  // Fetch the first time this panel is opened.
  useEffect(() => {
    if (isOpen && state.status === "idle") load();
  }, [isOpen, state.status, load]);

  const { status, board, error } = state;
  const rows = board?.rows || [];

  // Which fields this specific board actually populates — every court shares
  // one field shape, but which of those fields carry real data varies a lot
  // (SCI has advocates, no judges; Kochi has a CNR; Bombay has kept-back
  // items; most have neither), so only show columns with real data in them.
  const visibleFields = FIELD_CATALOG.filter((f) => rows.some(f.has));

  return (
    <div className={`court-panel ${isOpen ? "open" : ""}`}>
      <button className="court-panel-header" onClick={onToggle} aria-expanded={isOpen}>
        <span className="court-panel-title-group">
          <span className="court-panel-title">{court.label}</span>
          {court.note && <span className="court-panel-note">{court.note}</span>}
        </span>
        <FiChevronDown className="court-panel-chevron" />
      </button>

      {isOpen && (
        <div className="court-panel-body">
          {board && status === "done" && (
            <div className="board-meta">
              {board.boardDate && <span>Board date: <strong>{board.boardDate}</strong></span>}
              <span>{rows.length} court{rows.length === 1 ? "" : "s"}</span>
              {board.fetchedAt && <span>Data as of {formatFetchedAt(board.fetchedAt)}</span>}
              <button className="board-refresh" onClick={load} title="Refresh">
                <FiRefreshCw /> Refresh
              </button>
            </div>
          )}

          {status === "loading" && <div className="board-loading">Loading display board…</div>}

          {status === "error" && (
            <div className="board-error">
              <FiAlertCircle />
              <span>{error}</span>
              <button onClick={load}>Retry</button>
            </div>
          )}

          {status === "done" && rows.length > 0 && (
            <div className="board-table-wrap">
              <table className="board-table">
                <thead>
                  <tr>
                    <th>Court</th>
                    {visibleFields.map((f) => <th key={f.key}>{f.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={`${r.courtNumber}-${i}`}
                      className={r.status === "list_over" || r.status === "no_case" ? "row-over" : ""}
                    >
                      <td className="board-court">{r.courtNumber || "—"}</td>
                      {visibleFields.map((f) => (
                        <td key={f.key} className={`board-field board-field-${f.key}`}>
                          {f.has(r) ? f.render(r) : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
  const [courts, setCourts] = useState(FALLBACK_COURTS);
  const [openKey, setOpenKey] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get("/api/workspace/display-board/courts", authHeaders());
        if (res.data?.courts?.length) setCourts(mergeSciCourts(res.data.courts));
      } catch {
        /* keep the fallback list */
      }
    })();
  }, []);

  return (
    <div className="board-container">
      <div className="board-header">
        <div>
          <h2>Court Display Board</h2>
          <p className="board-sub">Select a court to see its live cause list.</p>
        </div>
      </div>

      <div className="court-accordion">
        {courts.map((c) => (
          <CourtPanel
            key={c.value}
            court={c}
            isOpen={openKey === c.value}
            onToggle={() => setOpenKey((k) => (k === c.value ? null : c.value))}
          />
        ))}
      </div>
    </div>
  );
}
