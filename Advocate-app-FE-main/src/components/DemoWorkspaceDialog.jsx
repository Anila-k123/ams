import { useState, useEffect } from "react";
import { FiDatabase, FiTrash2, FiRefreshCw, FiCheckCircle, FiAlertCircle, FiX, FiArrowRight } from "react-icons/fi";
import "../assets/styles/DemoWorkspaceDialog.css";

const API_BASE = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api/demo`;

function authHeaders() {
  const token = localStorage.getItem("token");
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export default function DemoWorkspaceDialog({ isOpen, onClose, onComplete, onClear }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    if (isOpen) fetchStatus();
  }, [isOpen]);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/status`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch demo status");
      const data = await res.json();
      setStatus(data);
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    }
  };

  const closeAndRefresh = async (data) => {
    // Refresh status to get latest workspaceEmpty/hasDemoWorkspace
    const fresh = await fetchStatus();
    if (onComplete) onComplete(data || fresh);
    if (onClose) onClose();
  };

  const loadDemo = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/load`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to load demo data");
      }
      await closeAndRefresh(await res.json());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const clearDemo = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/clear`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to clear demo data");
      }
      const fresh = await fetchStatus();
      if (onClear) onClear(fresh);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const isWorkspaceEmpty = status?.workspaceEmpty;
  const hasDemo = status?.hasDemoWorkspace;
  const recordCounts = status?.recordCounts || {};

  return (
    <div className="demo-overlay" onClick={isOpen ? onClose : undefined}>
      <div className="demo-modal" onClick={(e) => e.stopPropagation()}>
        <div className="demo-header">
          <div className="demo-icon">
            <FiDatabase size={28} />
          </div>
          <h2>Welcome to Advocate Management System</h2>
          <p className="demo-subtitle">
            Get started with sample data to explore all features, or begin with an empty workspace.
          </p>
          {isOpen && (
            <button className="demo-close-btn" onClick={onClose}>
              <FiX size={20} />
            </button>
          )}
        </div>

        <div className="demo-body">
          {error && (
            <div className="demo-alert demo-alert-error">
              <FiAlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="demo-alert demo-alert-success">
              <FiCheckCircle size={16} />
              <span>{success}</span>
            </div>
          )}

          {!isWorkspaceEmpty && status && !isOpen && (
            <div className="demo-status-section">
              <h3>Demo Workspace Status</h3>
              <div className="demo-stats-grid">
                {Object.entries(recordCounts).map(([key, count]) => (
                  <div key={key} className="demo-stat-card">
                    <span className="demo-stat-label">{key}</span>
                    <span className="demo-stat-value">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="demo-actions">
            <button
              className="demo-btn demo-btn-primary"
              onClick={loadDemo}
              disabled={loading || (hasDemo && !isOpen)}
            >
              <FiDatabase size={16} />
              {loading ? "Loading..." : hasDemo ? "Demo Data Already Loaded" : "Load Demo Workspace"}
            </button>

            {hasDemo && (
              <button
                className="demo-btn demo-btn-danger"
                onClick={clearDemo}
                disabled={loading}
              >
                <FiTrash2 size={16} />
                {loading ? "Clearing..." : "Clear Demo Data"}
              </button>
            )}

            {isOpen && (
              <button className="demo-btn demo-btn-secondary" onClick={onClose}>
                <FiArrowRight size={16} />
                Start Fresh
              </button>
            )}
          </div>

          {hasDemo && status?.generatedAt && (
            <p className="demo-generated-info">
              Generated: {new Date(status.generatedAt).toLocaleString()}
            </p>
          )}
        </div>

        {isWorkspaceEmpty && isOpen && (
          <div className="demo-footer">
            <FiRefreshCw size={14} />
            <span>You can also manage demo data from Profile &gt; Settings later.</span>
          </div>
        )}
      </div>
    </div>
  );
}
