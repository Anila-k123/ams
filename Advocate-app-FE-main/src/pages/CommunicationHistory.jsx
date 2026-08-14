import React, { useEffect, useState } from "react";
import axios from "axios";
import { FiCheckCircle, FiXCircle, FiClock, FiSearch } from "react-icons/fi";
import "../assets/styles/Communication.css";

const API = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api/communication`;

const STATUS_ICONS = {
  SENT: <FiCheckCircle style={{ color: "#22c55e" }} />,
  FAILED: <FiXCircle style={{ color: "#ef4444" }} />,
  PENDING: <FiClock style={{ color: "#f59e0b" }} />,
};

export default function CommunicationHistory() {
  const token = localStorage.getItem("token");
  const [history, setHistory] = useState([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    axios
      .get(`${API}/history`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setHistory(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [token]);

  const filtered = history.filter(
    (h) =>
      h.recipient?.toLowerCase().includes(filter.toLowerCase()) ||
      h.subject?.toLowerCase().includes(filter.toLowerCase()) ||
      h.channel?.toLowerCase().includes(filter.toLowerCase())
  );

  if (loading) return <div className="comm-page"><div className="comm-loading">Loading history...</div></div>;

  return (
    <div className="comm-page">
      <h2>Notification History</h2>

      <div className="comm-search-bar">
        <FiSearch />
        <input
          type="text"
          placeholder="Search by recipient, subject, or channel..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="comm-table-wrap">
        <table className="comm-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Channel</th>
              <th>Type</th>
              <th>Recipient</th>
              <th>Subject</th>
              <th>Sent At</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="comm-empty">No history found</td></tr>
            )}
            {filtered.map((h) => (
              <tr key={h.id}>
                <td>{STATUS_ICONS[h.status] || <FiClock />}</td>
                <td><span className="comm-badge">{h.channel}</span></td>
                <td><span className="comm-badge comm-badge-type">{h.type}</span></td>
                <td>{h.recipient}</td>
                <td>{h.subject || "-"}</td>
                <td>{h.sentAt ? new Date(h.sentAt).toLocaleString() : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
