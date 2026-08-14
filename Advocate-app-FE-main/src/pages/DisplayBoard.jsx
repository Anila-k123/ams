import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { FiAlertCircle } from "react-icons/fi";
import "../assets/styles/DisplayBoard.css";

// The display board is served for the Madras High Court principal bench (Chennai).
const BENCH = "chennai";

function formatFetchedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function DisplayBoard() {
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchBoard = useCallback(async () => {
    const token = localStorage.getItem("token");
    const authHeaders = { headers: { Authorization: `Bearer ${token}` } };
    setLoading(true);
    setError("");
    try {
      const res = await axios.get("/api/workspace/display-board", {
        ...authHeaders,
        params: { bench: BENCH },
      });
      setBoard(res.data);
    } catch (err) {
      const msg = err?.response?.data?.error || "Could not load the court display board.";
      setError(msg);
      setBoard(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  const rows = board?.rows || [];

  return (
    <div className="board-container">
      <div className="board-header">
        <div>
          <h2>Madras High Court</h2>
          <p className="board-sub">Live cause list from the court display board.</p>
        </div>
      </div>

      {board && !error && (
        <div className="board-meta">
          {board.boardDate && <span>Board date: <strong>{board.boardDate}</strong></span>}
          <span>{rows.length} court{rows.length === 1 ? "" : "s"}</span>
          {board.fetchedAt && <span>Data as of {formatFetchedAt(board.fetchedAt)}</span>}
        </div>
      )}

      {error && (
        <div className="board-error">
          <FiAlertCircle />
          <span>{error}</span>
          <button onClick={() => fetchBoard()}>Retry</button>
        </div>
      )}

      {loading && !board && <div className="board-loading">Loading display board…</div>}

      {!error && rows.length > 0 && (
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
                <tr key={`${r.courtNumber}-${i}`} className={r.status === "list_over" ? "row-over" : ""}>
                  <td className="board-court">{r.courtNumber || "—"}</td>
                  <td>{r.itemNumber || "—"}</td>
                  <td className="board-case">{r.caseString || "—"}</td>
                  <td className="board-judges">
                    {r.judges && r.judges.length
                      ? r.judges.map((j, k) => <div key={k}>{j}</div>)
                      : (r.judge || "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && rows.length === 0 && board && (
        <div className="board-empty">No courts are currently on the board.</div>
      )}
    </div>
  );
}
