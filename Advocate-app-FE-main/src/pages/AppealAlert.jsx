import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { useToast } from "../contexts/ToastContext.jsx";
import "../assets/styles/AppealAlert.css";

// Appeal Alert is now entirely automatic: the nightly scan_appeals sweep reads
// each decided case, works out which higher court would hear an appeal, and
// searches it by party name. The old manual "Add Alert for Appeal" form was
// removed - it only recorded a court/case-number/judgment-date and did nothing
// with them, so it looked like a deadline tracker while tracking nothing.
//
// Nothing here computes a limitation period. Those vary by forum AND matter
// type, s.12 of the Limitation Act excludes certified-copy time that nobody
// has entered, and s.5 means no deadline is ever absolute - a confidently
// wrong date would be worse than none.
function AppealAlert() {
  const [detections, setDetections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const token = localStorage.getItem("token");
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };
  const { success, error } = useToast();

  const fetchDetections = useCallback(async () => {
    try {
      const res = await axios.get("/api/appeal-detections", authHeaders);
      setDetections(res.data || []);
    } catch {
      error("Couldn't load detected appeals.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    fetchDetections();
  }, [fetchDetections]);

  const setDetectionStatus = async (id, status) => {
    setBusyId(id);
    try {
      await axios.put(`/api/appeal-detections/${id}`, { status }, authHeaders);
      success(status === "CONFIRMED" ? "Marked as a real appeal." : "Dismissed as unrelated.");
      fetchDetections();
    } catch {
      error("Couldn't update that detection.");
    } finally {
      setBusyId(null);
    }
  };

  const open = detections.filter((d) => d.status !== "DISMISSED");
  const dismissed = detections.filter((d) => d.status === "DISMISSED");

  const renderRow = (d) => (
    <tr key={d.id} className={d.status === "DISMISSED" ? "appeal-row-dismissed" : ""}>
      <td>{d.sourceCaseNumber || "-"}</td>
      <td>{d.appealCaseNumber || "(number not listed)"}</td>
      <td>{d.forum || d.forumCourtId}</td>
      <td className="appeal-parties-cell">{d.appealParties || "-"}</td>
      <td>{d.appealFiledOn || "-"}</td>
      <td>
        <span className="appeal-match">{d.matchedOn || "-"}</span>
        {typeof d.matchScore === "number" && (
          <span className="appeal-score"> ({Math.round(d.matchScore * 100)}%)</span>
        )}
      </td>
      <td>
        <span className={`appeal-status appeal-status-${(d.status || "").toLowerCase()}`}>
          {d.status}
        </span>
      </td>
      <td>
        {d.status !== "CONFIRMED" && (
          <button className="appeal-confirm-btn" disabled={busyId === d.id}
                  onClick={() => setDetectionStatus(d.id, "CONFIRMED")}>
            It is an appeal
          </button>
        )}
        {d.status !== "DISMISSED" && (
          <button className="appeal-delete-btn" disabled={busyId === d.id}
                  onClick={() => setDetectionStatus(d.id, "DISMISSED")}>
            Not related
          </button>
        )}
      </td>
    </tr>
  );

  const table = (rows) => (
    <div className="appeal-table-wrap">
      <table className="appeal-table">
        <thead>
          <tr>
            <th>Your Case</th>
            <th>Appeal Found</th>
            <th>Forum</th>
            <th>Parties</th>
            <th>Filed</th>
            <th>Matched On</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>{rows.map(renderRow)}</tbody>
      </table>
    </div>
  );

  return (
    <div className="appeal-alert-page">
      <div className="appeal-alert-card">
        <h2 className="appeal-alert-title">Appeal Alerts</h2>
        <p className="appeal-detect-note">
          Your decided cases are checked automatically against the higher court that
          would hear an appeal — District Court cases against their High Court, and
          High Court cases against the Supreme Court — matching on party names.
          Anything found appears below and is emailed to you.
          <br /><br />
          Each entry is a <strong>candidate read from the court record</strong>, not a
          confirmed appeal: please verify it before acting. No filing or limitation
          deadline is calculated or implied.
        </p>
      </div>

      <div className="appeal-list-section">
        <h3>Detected Appeals</h3>
        {loading ? (
          <div className="appeal-empty">Loading…</div>
        ) : open.length === 0 ? (
          <div className="appeal-empty">
            No appeals detected against your decided cases.
          </div>
        ) : (
          table(open)
        )}
      </div>

      {dismissed.length > 0 && (
        <div className="appeal-list-section">
          <h3>Dismissed as unrelated</h3>
          <p className="appeal-detect-note">
            Kept so the nightly check does not report them again.
          </p>
          {table(dismissed)}
        </div>
      )}
    </div>
  );
}

export default AppealAlert;
