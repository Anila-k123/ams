import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { FiAlertCircle, FiChevronDown, FiRefreshCw } from "react-icons/fi";
import "../assets/styles/DisplayBoard.css";

// Fallback list until the courts endpoint responds.
const FALLBACK_COURTS = [
  { value: "delhi", label: "Delhi High Court" },
  { value: "chennai", label: "Madras HC — Chennai (Principal Bench)" },
  { value: "madurai", label: "Madras HC — Madurai Bench" },
  { value: "kochi", label: "Kerala HC — Kochi" },
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

// One court row: header toggles open; the board loads lazily on first open.
function CourtPanel({ court, isOpen, onToggle }) {
  const [state, setState] = useState({ status: "idle", board: null, error: "" });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: "loading", error: "" }));
    try {
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

  return (
    <div className={`court-panel ${isOpen ? "open" : ""}`}>
      <button className="court-panel-header" onClick={onToggle} aria-expanded={isOpen}>
        <span className="court-panel-title">{court.label}</span>
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
                    <th>Item</th>
                    <th>Case</th>
                    <th>Judge(s)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr
                      key={`${r.courtNumber}-${i}`}
                      className={r.status === "list_over" || r.status === "no_case" ? "row-over" : ""}
                    >
                      <td className="board-court">{r.courtNumber || "—"}</td>
                      <td>{r.itemNumber || "—"}</td>
                      <td className="board-case">
                        <span>{r.caseString || "—"}</span>
                        {r.title && <div className="board-title">{r.title}</div>}
                        {r.vcLink && (
                          <a className="board-vc" href={r.vcLink} target="_blank" rel="noreferrer">
                            VC link
                          </a>
                        )}
                      </td>
                      <td className="board-judges">
                        {r.judges && r.judges.length
                          ? r.judges.map((j, k) => <div key={k}>{j}</div>)
                          : r.judge || "—"}
                      </td>
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
        if (res.data?.courts?.length) setCourts(res.data.courts);
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
