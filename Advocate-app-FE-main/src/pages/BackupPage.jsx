import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { FiDownload, FiUpload, FiTrash2, FiRefreshCw, FiCheckCircle, FiXCircle, FiClock, FiAlertCircle, FiDatabase, FiFileText, FiSettings, FiFolder, FiZap, FiChevronDown, FiChevronRight, FiHeart } from "react-icons/fi";
import { useLoading } from "../contexts/LoadingContext";
import { useDownload } from "../hooks/useDownload";
import DownloadLoader from "../components/DownloadLoader";
import "../assets/styles/BackupPage.css";

const API = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api/backup`;
const PROGRESS_STAGES = [
  "Preparing Backup\u2026",
  "Exporting Database\u2026",
  "Exporting JSON Data\u2026",
  "Copying Documents\u2026",
  "Generating Metadata\u2026",
  "Compressing ZIP\u2026",
  "Calculating Checksum\u2026",
  "Saving Backup\u2026",
  "Completed"
];

const SECTION_ICONS = {
  DATABASE: <FiDatabase />,
  JSON: <FiFileText />,
  DOCUMENTS: <FiFolder />,
  REPORTS: <FiFileText />,
  SETTINGS: <FiSettings />
};

function BackupPage() {
  const { withLoading } = useLoading();
  const { isDownloading, withDownload } = useDownload();
  const token = localStorage.getItem("token");
  const authHeaders = { Authorization: `Bearer ${token}` };

  const [history, setHistory] = useState([]);
  const [stats, setStats] = useState({ totalBackups: 0, totalSize: 0 });
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: "", text: "" });
  const [showProgress, setShowProgress] = useState(false);
  const [currentStage, setCurrentStage] = useState(0);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successData, setSuccessData] = useState(null);
  const [showError, setShowError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmMessage, setConfirmMessage] = useState("");
  const [restoreFile, setRestoreFile] = useState(null);
  const [restoreType, setRestoreType] = useState("FULL");
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoreValidation, setRestoreValidation] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);

  const BACKUP_TYPES = [
    { key: "DATABASE", label: "Database Only", desc: "Export database schema & data", icon: <FiDatabase /> },
    { key: "DOCUMENTS", label: "Documents Only", desc: "Uploaded files & documents", icon: <FiFolder /> },
    { key: "REPORTS", label: "Reports Only", desc: "Generated reports & PDFs", icon: <FiFileText /> },
    { key: "SETTINGS", label: "Settings Only", desc: "Application preferences", icon: <FiSettings /> },
  ];

  const loadHistory = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/history`, { headers: authHeaders });
      setHistory(res.data || []);
    } catch (err) {
      console.error("Failed to load backup history:", err);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/stats`, { headers: authHeaders });
      setStats(res.data || { totalBackups: 0, totalSize: 0 });
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  }, []);

  useEffect(() => { loadHistory(); loadStats(); }, [loadHistory, loadStats]);

  const parseMetadata = (h) => {
    if (!h.metadataJson) return { sections: [], healthScore: 100 };
    try {
      return JSON.parse(h.metadataJson);
    } catch {
      return { sections: [], healthScore: 100 };
    }
  };

  const simulateProgress = async (type) => {
    setShowProgress(true);
    setCurrentStage(0);
    const stageCount = type === "QUICK" ? 6 : 9;
    for (let i = 0; i < stageCount; i++) {
      await new Promise(r => setTimeout(r, 400 + Math.random() * 600));
      setCurrentStage(i + 1);
    }
  };

  const createBackup = async (type) => {
    setLoading(true);
    setStatusMsg({ type: "", text: "" });
    simulateProgress(type);

    try {
      const endpoint = type === "FULL" ? "full" : type === "QUICK" ? "quick" : type.toLowerCase();
      const res = await withLoading(
        axios.post(`${API}/${endpoint}`, {}, { headers: authHeaders }),
        "Creating Backup..."
      );
      setShowProgress(false);
      setSuccessData({
        type: type,
        fileSize: res.data.fileSize,
        durationSeconds: res.data.durationSeconds,
        fileName: res.data.fileName,
        status: res.data.status,
      });
      setShowSuccess(true);
      setStatusMsg({ type: "success", text: `${type} backup completed!` });
      await loadHistory();
      await loadStats();
    } catch (err) {
      setShowProgress(false);
      setErrorMsg(err.response?.data?.message || err.message);
      setShowError(true);
      setStatusMsg({ type: "error", text: `Backup failed: ${err.response?.data?.message || err.message}` });
    } finally {
      setLoading(false);
      setCurrentStage(0);
    }
  };

  const handleRestoreConfirm = async () => {
    if (!restoreFile) {
      setStatusMsg({ type: "error", text: "Please select a backup file to restore" });
      return;
    }
    setShowRestoreConfirm(false);
    setRestoring(true);
    setStatusMsg({ type: "", text: "" });
    try {
      const formData = new FormData();
      formData.append("file", restoreFile);
      formData.append("type", restoreType);
      const res = await withLoading(
        axios.post(`${API}/restore`, formData, { headers: authHeaders }),
        "Restoring Backup..."
      );
      setStatusMsg({ type: "success", text: res.data.message || "Restore completed!" });
      setRestoreFile(null);
      await loadHistory();
      await loadStats();
    } catch (err) {
      setStatusMsg({ type: "error", text: `Restore failed: ${err.response?.data?.message || err.message}` });
    } finally {
      setRestoring(false);
    }
  };

  const handleValidate = async () => {
    if (!restoreFile) {
      setStatusMsg({ type: "error", text: "Please select a backup file to validate" });
      return;
    }
    try {
      const formData = new FormData();
      formData.append("file", restoreFile);
      const res = await axios.post(`${API}/validate`, formData, { headers: authHeaders });
      setRestoreValidation(res.data);
    } catch (err) {
      setStatusMsg({ type: "error", text: `Validation failed: ${err.response?.data?.message || err.message}` });
    }
  };

  const downloadBackup = async (id) => {
    await withDownload(async () => {
      try {
        const res = await axios.get(`${API}/download/${id}`, {
          headers: authHeaders,
          responseType: "blob",
        });
        const disposition = res.headers["content-disposition"];
        let filename = `backup_${id}.zip`;
        if (disposition) {
          const match = disposition.match(/filename="?(.+?)"?$/);
          if (match) filename = match[1];
        }
        const url = window.URL.createObjectURL(new Blob([res.data]));
        const link = document.createElement("a");
        link.href = url;
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
      } catch (err) {
        setStatusMsg({ type: "error", text: "Download failed" });
      }
    }, "Downloading Backup...");
  };

  const requestDelete = (id) => {
    setConfirmMessage("Delete this backup permanently?");
    setConfirmAction(() => async () => {
      try {
        await withLoading(
          axios.delete(`${API}/${id}`, { headers: authHeaders }),
          "Deleting Backup..."
        );
        setStatusMsg({ type: "success", text: "Backup deleted" });
        await loadHistory();
        await loadStats();
      } catch (err) {
        setStatusMsg({ type: "error", text: "Delete failed" });
      }
      setShowConfirm(false);
    });
    setShowConfirm(true);
  };

  const formatSize = (bytes) => {
    if (!bytes) return "0 B";
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(1) + " " + sizes[i];
  };

  const formatDuration = (seconds) => {
    if (!seconds && seconds !== 0) return "";
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  const formatDurationMs = (ms) => {
    if (!ms) return "";
    if (ms < 1000) return `${ms}ms`;
    return (ms / 1000).toFixed(1) + "s";
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleString();
  };

  const healthColor = (score) => {
    if (score >= 90) return "#22c55e";
    if (score >= 60) return "#f59e0b";
    return "#ef4444";
  };

  const statusIcon = (s) => {
    if (s === "SUCCESS") return <FiCheckCircle style={{ color: "#22c55e" }} />;
    if (s === "FAILED" || s === "PARTIAL") return <FiXCircle style={{ color: "#ef4444" }} />;
    if (s === "RUNNING") return <FiClock style={{ color: "#f59e0b" }} />;
    return <FiAlertCircle />;
  };

  const latestBackup = history.length > 0 ? history[0] : null;
  const latestMeta = latestBackup ? parseMetadata(latestBackup) : { healthScore: 100 };

  const toggleRow = (id) => {
    setExpandedRow(expandedRow === id ? null : id);
  };

  return (
    <div className="backup-page">
      {isDownloading && <DownloadLoader message="Downloading Backup..." />}
      <h2>Backup &amp; Restore</h2>

      {statusMsg.text && (
        <div className={`backup-status ${statusMsg.type}`}>
          {statusMsg.type === "success" ? <FiCheckCircle /> : <FiXCircle />}
          <span>{statusMsg.text}</span>
          <button className="close-msg" onClick={() => setStatusMsg({ type: "", text: "" })}>×</button>
        </div>
      )}

      <section className="dashboard-cards-section">
        <div className="dashboard-cards">
          <div className="dashboard-card">
            <div className="dashboard-card-icon latest"><FiClock /></div>
            <div className="dashboard-card-body">
              <span className="dashboard-card-label">Latest Backup</span>
              <span className="dashboard-card-value">
                {latestBackup ? `${latestBackup.backupType} - ${formatSize(latestBackup.fileSize)}` : "No backups"}
              </span>
              <span className="dashboard-card-sub">
                {latestBackup ? formatDate(latestBackup.createdAt) : "\u2014"}
              </span>
            </div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-card-icon storage"><FiDatabase /></div>
            <div className="dashboard-card-body">
              <span className="dashboard-card-label">Total Storage</span>
              <span className="dashboard-card-value">{formatSize(stats.totalSize)}</span>
              <span className="dashboard-card-sub">{stats.totalBackups} backup(s)</span>
            </div>
          </div>
          <div className="dashboard-card">
            <div className="dashboard-card-icon quick"><FiZap /></div>
            <div className="dashboard-card-body">
              <span className="dashboard-card-label">Quick Actions</span>
              <div className="quick-actions">
                <button className="quick-action-btn primary" onClick={() => createBackup("QUICK")} disabled={loading}>
                  <FiZap /> Quick Backup
                </button>
                <button className="quick-action-btn secondary" onClick={() => createBackup("FULL")} disabled={loading}>
                  <FiDatabase /> Full Backup
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="backup-cards-section">
        <h3>Create Backup</h3>
        <div className="backup-cards">
          {BACKUP_TYPES.map((bt) => (
            <div key={bt.key} className="backup-card" onClick={() => createBackup(bt.key)}>
              <div className="backup-card-icon">{bt.icon}</div>
              <div className="backup-card-body">
                <h4>{bt.label}</h4>
                <p>{bt.desc}</p>
              </div>
              <button className="backup-card-btn" disabled={loading}>
                <FiDownload /> Backup
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="restore-section">
        <h3>Restore Backup</h3>
        <div className="restore-card">
          <div className="restore-upload-zone"
               onDragOver={(e) => e.preventDefault()}
               onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) { setRestoreFile(f); setRestoreValidation(null); } }}>
            {restoreFile ? (
              <>
                <p className="restore-file-name"><FiUpload /> {restoreFile.name}</p>
                <p className="restore-file-size">{formatSize(restoreFile.size)}</p>
              </>
            ) : (
              <p className="restore-hint"><FiUpload /> Drag &amp; drop a backup ZIP file, or click to select</p>
            )}
            <input type="file" accept=".zip" onChange={(e) => { setRestoreFile(e.target.files[0]); setRestoreValidation(null); }} hidden id="restore-input" />
            <label htmlFor="restore-input" className="restore-browse-btn">Browse Files</label>
          </div>

          {restoreValidation && (
            <div className="restore-validation">
              <h4>Backup Details</h4>
              <div className="validation-grid">
                <div className="validation-item">
                  <span className="validation-label">Type</span>
                  <span className="validation-value">{restoreValidation.backupType || "N/A"}</span>
                </div>
                <div className="validation-item">
                  <span className="validation-label">Date</span>
                  <span className="validation-value">{restoreValidation.backupDate ? formatDate(restoreValidation.backupDate) : "N/A"}</span>
                </div>
                <div className="validation-item">
                  <span className="validation-label">Health</span>
                  <span className="validation-value" style={{ color: healthColor(restoreValidation.healthScore) }}>
                    <FiHeart /> {restoreValidation.healthScore}%
                  </span>
                </div>
                <div className="validation-item">
                  <span className="validation-label">Version</span>
                  <span className="validation-value">{restoreValidation.backupVersion || "N/A"}</span>
                </div>
                <div className="validation-item">
                  <span className="validation-label">Size</span>
                  <span className="validation-value">{formatSize(restoreFile?.size)}</span>
                </div>
              </div>
              {restoreValidation.failedSections?.length > 0 && (
                <div className="validation-warning">
                  <FiAlertCircle /> Failed sections: {restoreValidation.failedSections.join(", ")}
                </div>
              )}
              {restoreValidation.skippedSections?.length > 0 && (
                <div className="validation-warning skipped">
                  <FiAlertCircle /> Skipped sections: {restoreValidation.skippedSections.join(", ")}
                </div>
              )}
              {restoreValidation.healthScore < 100 && (
                <div className="validation-warning partial">
                  <FiAlertCircle /> This backup is partial. Some data may be missing.
                </div>
              )}
            </div>
          )}

          <div className="restore-actions">
            <button className="restore-btn validate" onClick={handleValidate} disabled={!restoreFile}>
              Validate
            </button>
            <button className="restore-btn" onClick={() => setShowRestoreConfirm(true)} disabled={!restoreFile || restoring}>
              {restoring ? "Restoring..." : "Restore"}
            </button>
          </div>

          <div className="restore-type-select">
            <label>Restore Type:</label>
            <select value={restoreType} onChange={(e) => setRestoreType(e.target.value)}>
              <option value="FULL">Full Restore</option>
              <option value="DATABASE">Database Only</option>
              <option value="DOCUMENTS">Documents Only</option>
              <option value="REPORTS">Reports Only</option>
              <option value="SETTINGS">Settings Only</option>
            </select>
          </div>
        </div>
      </section>

      <section className="history-section">
        <div className="history-header">
          <h3>Backup History</h3>
          <button className="refresh-btn" onClick={() => { loadHistory(); loadStats(); }}><FiRefreshCw /> Refresh</button>
        </div>
        {history.length === 0 ? (
          <p className="empty-history">No backups yet. Create your first backup above.</p>
        ) : (
          <div className="history-table-wrapper">
            <table className="history-table">
              <thead>
                <tr>
                  <th style={{ width: 30 }}></th>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Duration</th>
                  <th>Health</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const meta = parseMetadata(h);
                  const isExpanded = expandedRow === h.id;
                  return (
                    <React.Fragment key={h.id}>
                      <tr className={`history-row ${isExpanded ? "expanded" : ""}`} onClick={() => toggleRow(h.id)}>
                        <td className="expand-cell">
                          {isExpanded ? <FiChevronDown /> : <FiChevronRight />}
                        </td>
                        <td>{formatDate(h.createdAt)}</td>
                        <td><span className="backup-type-badge">{h.backupType}</span></td>
                        <td>{formatSize(h.fileSize)}</td>
                        <td>{formatDuration(h.durationSeconds)}</td>
                        <td>
                          <span className="health-badge" style={{ color: healthColor(meta.healthScore), borderColor: healthColor(meta.healthScore) }}>
                            {meta.healthScore}%
                          </span>
                        </td>
                        <td className={`status-${h.status?.toLowerCase()}`}>
                          {statusIcon(h.status)} {h.status}
                        </td>
                        <td className="actions-cell" onClick={(e) => e.stopPropagation()}>
                          <button className="action-btn download" onClick={() => downloadBackup(h.id)} title="Download">
                            <FiDownload />
                          </button>
                          <button className="action-btn delete" onClick={() => requestDelete(h.id)} title="Delete">
                            <FiTrash2 />
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="history-detail-row">
                          <td colSpan={8}>
                            <div className="section-breakdown">
                              <h4>Section Breakdown</h4>
                              <div className="section-list">
                                {meta.sections && meta.sections.length > 0 ? meta.sections.map((sec, idx) => (
                                  <div key={idx} className={`section-item section-${sec.status?.toLowerCase()}`}>
                                    <div className="section-icon">
                                      {sec.status === "SUCCESS" ? <FiCheckCircle style={{ color: "#22c55e" }} /> :
                                       sec.status === "FAILED" ? <FiXCircle style={{ color: "#ef4444" }} /> :
                                       <FiClock style={{ color: "#94a3b8" }} />}
                                    </div>
                                    <div className="section-info">
                                      <span className="section-name">{SECTION_ICONS[sec.name]} {sec.name}</span>
                                      <span className="section-status">{sec.status}</span>
                                      {sec.error && <span className="section-error">{sec.error}</span>}
                                    </div>
                                    <div className="section-duration">{sec.durationMs ? formatDurationMs(sec.durationMs) : ""}</div>
                                  </div>
                                )) : (
                                  <p className="no-sections">No section data available</p>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showProgress && (
        <div className="dialog-overlay" onClick={() => {}}>
          <div className="dialog progress-dialog">
            <div className="dialog-header">
              <FiClock className="dialog-icon spinning" />
              <h3>Backup in Progress</h3>
            </div>
            <div className="progress-stages">
              {PROGRESS_STAGES.map((stage, idx) => (
                <div key={idx} className={`progress-stage ${idx < currentStage ? "completed" : idx === currentStage ? "active" : "pending"}`}>
                  <div className="stage-indicator">
                    {idx < currentStage ? <FiCheckCircle /> : idx === currentStage ? <FiClock /> : <div className="stage-dot" />}
                  </div>
                  <span className="stage-label">{stage}</span>
                </div>
              ))}
            </div>
            <div className="progress-track">
              <div className="progress-track-fill" style={{ width: `${(currentStage / PROGRESS_STAGES.length) * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      {showSuccess && successData && (
        <div className="dialog-overlay" onClick={() => {}}>
          <div className="dialog success-dialog">
            <div className="dialog-header success">
              <FiCheckCircle className="dialog-icon" />
              <h3>Backup Completed</h3>
            </div>
            <div className="dialog-body">
              <div className="success-detail">
                <span className="detail-label">Type</span>
                <span className="detail-value">{successData.type}</span>
              </div>
              <div className="success-detail">
                <span className="detail-label">Size</span>
                <span className="detail-value">{formatSize(successData.fileSize)}</span>
              </div>
              <div className="success-detail">
                <span className="detail-label">Duration</span>
                <span className="detail-value">{formatDuration(successData.durationSeconds)}</span>
              </div>
              <div className="success-detail">
                <span className="detail-label">Status</span>
                <span className="detail-value" style={{ color: successData.status === "SUCCESS" ? "#22c55e" : "#f59e0b" }}>{successData.status}</span>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="dialog-btn primary" onClick={() => setShowSuccess(false)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {showError && (
        <div className="dialog-overlay" onClick={() => {}}>
          <div className="dialog error-dialog">
            <div className="dialog-header error">
              <FiXCircle className="dialog-icon" />
              <h3>Backup Failed</h3>
            </div>
            <div className="dialog-body">
              <p className="error-message">{errorMsg}</p>
            </div>
            <div className="dialog-actions">
              <button className="dialog-btn primary" onClick={() => setShowError(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {showConfirm && (
        <div className="dialog-overlay" onClick={() => {}}>
          <div className="dialog confirm-dialog">
            <div className="dialog-header">
              <FiAlertCircle className="dialog-icon warning" />
              <h3>Confirm</h3>
            </div>
            <div className="dialog-body">
              <p>{confirmMessage}</p>
            </div>
            <div className="dialog-actions">
              <button className="dialog-btn" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button className="dialog-btn danger" onClick={() => { if (confirmAction) confirmAction(); }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {showRestoreConfirm && (
        <div className="dialog-overlay" onClick={() => {}}>
          <div className="dialog confirm-dialog restore-confirm-dialog">
            <div className="dialog-header">
              <FiAlertCircle className="dialog-icon warning" />
              <h3>Confirm Restore</h3>
            </div>
            <div className="dialog-body">
              <div className="restore-summary">
                <div className="summary-row">
                  <span className="summary-label">File</span>
                  <span className="summary-value">{restoreFile?.name}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Type</span>
                  <span className="summary-value">{restoreType}</span>
                </div>
                <div className="summary-row">
                  <span className="summary-label">Size</span>
                  <span className="summary-value">{formatSize(restoreFile?.size)}</span>
                </div>
              </div>
              {restoreValidation?.healthScore !== undefined && (
                <div className="restore-health">
                  <span className="summary-label">Backup Health</span>
                  <span className="health-badge" style={{ color: healthColor(restoreValidation.healthScore), borderColor: healthColor(restoreValidation.healthScore) }}>
                    {restoreValidation.healthScore}%
                  </span>
                </div>
              )}
              {restoreValidation?.isPartial && (
                <div className="validation-warning partial" style={{ marginTop: 8 }}>
                  <FiAlertCircle /> This backup is partial. A rollback will be created automatically. Continue?
                </div>
              )}
              <p style={{ marginTop: 12, fontSize: "0.85rem", color: "#94a3b8" }}>
                A rollback backup will be created automatically before restore.
              </p>
            </div>
            <div className="dialog-actions">
              <button className="dialog-btn" onClick={() => setShowRestoreConfirm(false)}>Cancel</button>
              <button className="dialog-btn danger" onClick={handleRestoreConfirm}>Restore</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BackupPage;