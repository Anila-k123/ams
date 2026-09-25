import { useState, useEffect, useCallback } from "react";
import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Message } from "primereact/message";
import { ProgressBar } from "primereact/progressbar";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import api from "../api/client";
import { useLoading } from "../contexts/LoadingContext";
import { useDownload } from "../hooks/useDownload";
import DownloadLoader from "../components/DownloadLoader";
import "../assets/styles/BackupPage.css";

const API = "/api/backup";

// Which sections each backup type actually writes. Mirrors TYPE_SECTIONS in
// backup/service.py.
const TYPE_SECTIONS: Record<string, string[]> = {
  QUICK: ["DATABASE", "DOCUMENTS"],
  FULL: ["DATABASE", "DOCUMENTS", "REPORTS", "SETTINGS"],
  DATABASE: ["DATABASE"],
  DOCUMENTS: ["DOCUMENTS"],
  REPORTS: ["REPORTS"],
  SETTINGS: ["SETTINGS"],
};

const SECTION_LABELS: Record<string, string> = {
  DATABASE: "Exporting records (SQL + JSON)",
  DOCUMENTS: "Copying uploaded documents",
  REPORTS: "Collecting generated reports",
  SETTINGS: "Saving profile & preferences",
};

// Restore types that DELETE existing rows before re-inserting: typed confirmation.
const DESTRUCTIVE_RESTORE = new Set(["FULL", "DATABASE"]);
const RESTORE_CONFIRM_WORD = "RESTORE";

const SECTION_ICONS: Record<string, string> = {
  DATABASE: "pi pi-database",
  JSON: "pi pi-file",
  DOCUMENTS: "pi pi-folder",
  REPORTS: "pi pi-file",
  SETTINGS: "pi pi-cog",
};
const secIcon = (name: string) => (SECTION_ICONS[name] ? <i className={`${SECTION_ICONS[name]} mr-1`} /> : null);

const BACKUP_TYPES = [
  { key: "DATABASE", label: "Database Only", desc: "Export database schema & data", icon: "pi pi-database" },
  { key: "DOCUMENTS", label: "Documents Only", desc: "Uploaded files & documents", icon: "pi pi-folder" },
  { key: "REPORTS", label: "Reports Only", desc: "Generated reports & PDFs", icon: "pi pi-file" },
  { key: "SETTINGS", label: "Settings Only", desc: "Application preferences", icon: "pi pi-cog" },
];

const RESTORE_TYPES = [
  { value: "FULL", label: "Full Restore" },
  { value: "DATABASE", label: "Database Only" },
  { value: "DOCUMENTS", label: "Documents Only" },
  { value: "REPORTS", label: "Reports Only" },
  { value: "SETTINGS", label: "Settings Only" },
];

const formatSize = (bytes: any) => {
  if (!bytes) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + " " + sizes[i];
};
const formatDuration = (seconds: any) => {
  if (!seconds && seconds !== 0) return "";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
const formatDurationMs = (ms: any) => {
  if (!ms) return "";
  if (ms < 1000) return `${ms}ms`;
  return (ms / 1000).toFixed(1) + "s";
};
const formatDate = (dateStr: any) => (dateStr ? new Date(dateStr).toLocaleString() : "");
const healthColor = (score: number) => (score >= 90 ? "var(--success)" : score >= 60 ? "var(--warning)" : "var(--danger)");
const statusSeverity = (s: string): any =>
  s === "SUCCESS" ? "success" : s === "FAILED" || s === "PARTIAL" ? "danger" : s === "RUNNING" ? "warning" : "secondary";

const parseMetadata = (h: any) => {
  if (!h.metadataJson) return { sections: [], healthScore: 100 };
  try {
    return JSON.parse(h.metadataJson);
  } catch {
    return { sections: [], healthScore: 100 };
  }
};

function SectionItem({ sec, label }: { sec: any; label?: boolean }) {
  const icon = sec.status === "SUCCESS" ? "pi pi-check-circle" : sec.status === "FAILED" ? "pi pi-times-circle" : "pi pi-clock";
  const color = sec.status === "SUCCESS" ? "var(--success)" : sec.status === "FAILED" ? "var(--danger)" : "var(--text-muted)";
  return (
    <div className="backup-section-item">
      <i className={icon} style={{ color }} />
      <div className="flex flex-column flex-1">
        <span className="font-semibold">{secIcon(sec.name)}{label ? SECTION_LABELS[sec.name] || sec.name : sec.name}</span>
        {!label && <span className="backup-muted text-sm">{sec.status}</span>}
        {sec.error && <span className="backup-error text-sm">{sec.error}</span>}
      </div>
      <span className="backup-muted text-sm">{formatDurationMs(sec.durationMs)}</span>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: any }) {
  return (
    <div className="flex justify-content-between gap-3 py-1 backup-detail-row">
      <span className="backup-muted">{label}</span>
      <span className="font-semibold">{children}</span>
    </div>
  );
}

function BackupPage() {
  const { withLoading } = useLoading() as any;
  const { isDownloading, withDownload } = useDownload() as any;

  const [history, setHistory] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({ totalBackups: 0, totalSize: 0 });
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [statusMsg, setStatusMsg] = useState({ type: "", text: "" });
  const [showProgress, setShowProgress] = useState(false);
  const [progressType, setProgressType] = useState("FULL");
  const [showSuccess, setShowSuccess] = useState(false);
  const [successData, setSuccessData] = useState<any>(null);
  const [showError, setShowError] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreType, setRestoreType] = useState("FULL");
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoreConfirmText, setRestoreConfirmText] = useState("");
  const [restoreValidation, setRestoreValidation] = useState<any>(null);
  const [expandedRows, setExpandedRows] = useState<any>(null);

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.get(`${API}/history`);
      setHistory(res.data || []);
    } catch (err) {
      console.error("Failed to load backup history:", err);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const res = await api.get(`${API}/stats`);
      setStats(res.data || { totalBackups: 0, totalSize: 0 });
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  }, []);

  useEffect(() => { loadHistory(); loadStats(); }, [loadHistory, loadStats]);

  const createBackup = async (type: string) => {
    setLoading(true);
    setStatusMsg({ type: "", text: "" });
    // One request does the whole backup: show what it's working on until it lands.
    setProgressType(type);
    setShowProgress(true);
    try {
      const endpoint = type === "FULL" ? "full" : type === "QUICK" ? "quick" : type.toLowerCase();
      const res = await withLoading(api.post(`${API}/${endpoint}`, {}), "Creating Backup...");
      setShowProgress(false);
      setSuccessData({
        type,
        fileSize: res.data.fileSize,
        durationSeconds: res.data.durationSeconds,
        fileName: res.data.fileName,
        status: res.data.status,
        sections: res.data.sections || [],
        healthScore: res.data.healthScore,
        recordCounts: res.data.recordCounts || {},
      });
      setShowSuccess(true);
      setStatusMsg({ type: "success", text: `${type} backup completed!` });
      await loadHistory();
      await loadStats();
    } catch (err: any) {
      setShowProgress(false);
      setErrorMsg(err.response?.data?.message || err.message);
      setShowError(true);
      setStatusMsg({ type: "error", text: `Backup failed: ${err.response?.data?.message || err.message}` });
    } finally {
      setLoading(false);
      setShowProgress(false);
    }
  };

  const isDestructiveRestore = DESTRUCTIVE_RESTORE.has(restoreType);
  const restoreConfirmed = restoreConfirmText.trim().toUpperCase() === RESTORE_CONFIRM_WORD;

  const closeRestoreConfirm = () => {
    setShowRestoreConfirm(false);
    setRestoreConfirmText("");
  };

  const handleRestoreConfirm = async () => {
    if (!restoreFile) {
      setStatusMsg({ type: "error", text: "Please select a backup file to restore" });
      return;
    }
    // The button is disabled without the typed word; the check lives here too.
    if (isDestructiveRestore && !restoreConfirmed) return;
    closeRestoreConfirm();
    setRestoring(true);
    setStatusMsg({ type: "", text: "" });
    try {
      const formData = new FormData();
      formData.append("file", restoreFile);
      formData.append("type", restoreType);
      const res = await withLoading(api.post(`${API}/restore`, formData), "Restoring Backup...");
      setStatusMsg({ type: "success", text: res.data.message || "Restore completed!" });
      setRestoreFile(null);
      await loadHistory();
      await loadStats();
    } catch (err: any) {
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
      const res = await api.post(`${API}/validate`, formData);
      setRestoreValidation(res.data);
    } catch (err: any) {
      setStatusMsg({ type: "error", text: `Validation failed: ${err.response?.data?.message || err.message}` });
    }
  };

  const downloadBackup = async (id: any) => {
    await withDownload(async () => {
      try {
        const res = await api.get(`${API}/download/${id}`, { responseType: "blob" });
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
      } catch {
        setStatusMsg({ type: "error", text: "Download failed" });
      }
    }, "Downloading Backup...");
  };

  const requestDelete = (id: any) => {
    confirmDialog({
      header: "Confirm",
      message: "Delete this backup permanently?",
      icon: "pi pi-exclamation-triangle",
      acceptClassName: "p-button-danger",
      acceptLabel: "Confirm",
      rejectLabel: "Cancel",
      accept: async () => {
        try {
          await withLoading(api.delete(`${API}/${id}`), "Deleting Backup...");
          setStatusMsg({ type: "success", text: "Backup deleted" });
          await loadHistory();
          await loadStats();
        } catch {
          setStatusMsg({ type: "error", text: "Delete failed" });
        }
      },
    });
  };

  const pickFile = (f: File | null | undefined) => {
    setRestoreFile(f || null);
    setRestoreValidation(null);
  };

  const latestBackup = history.length > 0 ? history[0] : null;
  const latestMeta = latestBackup ? parseMetadata(latestBackup) : { healthScore: 100 };

  const healthBadge = (score: number) => (
    <span className="backup-health-badge" style={{ color: healthColor(score), borderColor: healthColor(score) }}>{score}%</span>
  );

  const rowExpansion = (h: any) => {
    const meta = parseMetadata(h);
    return (
      <div className="p-2">
        <h4 className="mt-0 mb-2">Section Breakdown</h4>
        {meta.sections && meta.sections.length > 0
          ? meta.sections.map((sec: any, idx: number) => <SectionItem key={idx} sec={sec} />)
          : <p className="backup-muted m-0">No section data available</p>}
      </div>
    );
  };

  return (
    <div className="backup-page">
      <ConfirmDialog />
      {isDownloading && <DownloadLoader />}

      {statusMsg.text && (
        <div className="flex align-items-center gap-2 mb-3">
          <Message
            className="flex-1 justify-content-start"
            severity={statusMsg.type === "success" ? "success" : "error"}
            text={statusMsg.text}
          />
          <Button icon="pi pi-times" rounded text severity="secondary" aria-label="Dismiss" onClick={() => setStatusMsg({ type: "", text: "" })} />
        </div>
      )}

      <div className="grid">
        <div className="col-12 md:col-4">
          <Card className="h-full">
            <div className="flex gap-3">
              <i className="pi pi-clock backup-card-icon" />
              <div className="flex flex-column gap-1">
                <span className="backup-muted text-sm">Latest Backup</span>
                <span className="font-bold">{latestBackup ? `${latestBackup.backupType} - ${formatSize(latestBackup.fileSize)}` : "No backups"}</span>
                <span className="backup-muted text-sm">
                  {latestBackup ? formatDate(latestBackup.createdAt) : "—"}
                  {latestBackup && latestMeta.healthScore < 100 && (
                    <span style={{ color: healthColor(latestMeta.healthScore), marginLeft: 6 }}>
                      {"·"} partial ({latestMeta.healthScore}%)
                    </span>
                  )}
                </span>
              </div>
            </div>
          </Card>
        </div>
        <div className="col-12 md:col-4">
          <Card className="h-full">
            <div className="flex gap-3">
              <i className="pi pi-database backup-card-icon" />
              <div className="flex flex-column gap-1">
                <span className="backup-muted text-sm">Total Storage</span>
                <span className="font-bold">{formatSize(stats.totalSize)}</span>
                <span className="backup-muted text-sm">{stats.totalBackups} backup(s)</span>
              </div>
            </div>
          </Card>
        </div>
        <div className="col-12 md:col-4">
          <Card className="h-full">
            <div className="flex gap-3">
              <i className="pi pi-bolt backup-card-icon" />
              <div className="flex flex-column gap-2">
                <span className="backup-muted text-sm">Quick Actions</span>
                <div className="flex flex-wrap gap-2">
                  <Button size="small" icon="pi pi-bolt" label="Quick Backup" onClick={() => createBackup("QUICK")} disabled={loading} />
                  <Button size="small" outlined icon="pi pi-database" label="Full Backup" onClick={() => createBackup("FULL")} disabled={loading} />
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <h3>Create Backup</h3>
      {/* A backup covers the rows this account created, not everything it can see. */}
      <p className="backup-muted">
        Covers the records <strong>you created</strong>. If you share a practice,
        colleagues' records are backed up from their own accounts.
      </p>
      <div className="grid">
        {BACKUP_TYPES.map((bt) => (
          <div key={bt.key} className="col-12 sm:col-6 lg:col-3">
            <Card className="h-full backup-type-card" onClick={() => createBackup(bt.key)}>
              <i className={`${bt.icon} backup-card-icon`} />
              <h4 className="mb-1">{bt.label}</h4>
              <p className="backup-muted mt-0">{bt.desc}</p>
              <Button size="small" outlined icon="pi pi-download" label="Backup" disabled={loading} />
            </Card>
          </div>
        ))}
      </div>

      <h3>Restore Backup</h3>
      <Card>
        <div
          className="backup-drop-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) pickFile(f); }}
        >
          {restoreFile ? (
            <>
              <p className="font-semibold m-0"><i className="pi pi-upload mr-2" />{restoreFile.name}</p>
              <p className="backup-muted m-0">{formatSize(restoreFile.size)}</p>
            </>
          ) : (
            <p className="backup-muted m-0"><i className="pi pi-upload mr-2" />Drag &amp; drop a backup ZIP file, or click to select</p>
          )}
          <input type="file" accept=".zip" onChange={(e) => pickFile(e.target.files?.[0])} hidden id="restore-input" />
          <label htmlFor="restore-input" className="p-button p-button-outlined p-button-sm">Browse Files</label>
        </div>

        {restoreValidation && (
          <div className="mt-3">
            <h4 className="mb-2">Backup Details</h4>
            <div className="grid">
              <div className="col-6 md:col"><div className="backup-muted text-sm">Type</div>{restoreValidation.backupType || "N/A"}</div>
              <div className="col-6 md:col"><div className="backup-muted text-sm">Date</div>{restoreValidation.backupDate ? formatDate(restoreValidation.backupDate) : "N/A"}</div>
              <div className="col-6 md:col">
                <div className="backup-muted text-sm">Health</div>
                <span style={{ color: healthColor(restoreValidation.healthScore) }}><i className="pi pi-heart mr-1" />{restoreValidation.healthScore}%</span>
              </div>
              <div className="col-6 md:col"><div className="backup-muted text-sm">Version</div>{restoreValidation.backupVersion || "N/A"}</div>
              <div className="col-6 md:col"><div className="backup-muted text-sm">Size</div>{formatSize(restoreFile?.size)}</div>
            </div>
            {restoreValidation.failedSections?.length > 0 && (
              <Message className="w-full justify-content-start mt-2" severity="error" text={`Failed sections: ${restoreValidation.failedSections.join(", ")}`} />
            )}
            {restoreValidation.skippedSections?.length > 0 && (
              <Message className="w-full justify-content-start mt-2" severity="info" text={`Skipped sections: ${restoreValidation.skippedSections.join(", ")}`} />
            )}
            {restoreValidation.healthScore < 100 && (
              <Message className="w-full justify-content-start mt-2" severity="warn" text="This backup is partial. Some data may be missing." />
            )}
          </div>
        )}

        <div className="flex flex-wrap align-items-center gap-2 mt-3">
          <Button outlined label="Validate" onClick={handleValidate} disabled={!restoreFile} />
          <Button label={restoring ? "Restoring..." : "Restore"} onClick={() => setShowRestoreConfirm(true)} disabled={!restoreFile || restoring} />
          <label className="ml-auto">Restore Type:</label>
          <Dropdown value={restoreType} options={RESTORE_TYPES} onChange={(e) => { setRestoreType(e.value); setRestoreConfirmText(""); }} />
        </div>
      </Card>

      <div className="flex justify-content-between align-items-center mt-4">
        <h3>Backup History</h3>
        <Button outlined size="small" icon="pi pi-refresh" label="Refresh" onClick={() => { loadHistory(); loadStats(); }} />
      </div>
      {history.length === 0 ? (
        <p className="backup-muted">No backups yet. Create your first backup above.</p>
      ) : (
        <DataTable
          value={history}
          dataKey="id"
          size="small"
          expandedRows={expandedRows}
          onRowToggle={(e) => setExpandedRows(e.data)}
          rowExpansionTemplate={rowExpansion}
        >
          <Column expander style={{ width: "3rem" }} />
          <Column header="Date" body={(h: any) => formatDate(h.createdAt)} />
          <Column header="Type" body={(h: any) => <Tag severity="info" value={h.backupType} />} />
          <Column header="Size" body={(h: any) => formatSize(h.fileSize)} />
          <Column header="Duration" body={(h: any) => formatDuration(h.durationSeconds)} />
          <Column header="Health" body={(h: any) => healthBadge(parseMetadata(h).healthScore)} />
          <Column header="Status" body={(h: any) => <Tag severity={statusSeverity(h.status)} value={h.status} />} />
          <Column header="Actions" body={(h: any) => (
            <div className="flex gap-1">
              <Button icon="pi pi-download" rounded text tooltip="Download" onClick={() => downloadBackup(h.id)} />
              <Button icon="pi pi-trash" rounded text severity="danger" tooltip="Delete" onClick={() => requestDelete(h.id)} />
            </div>
          )} />
        </DataTable>
      )}

      <Dialog
        visible={showProgress}
        onHide={() => {}}
        closable={false}
        header={<span><i className="pi pi-spin pi-spinner mr-2" />Backup in Progress</span>}
        style={{ width: "min(480px, 95vw)" }}
      >
        <p className="backup-muted mt-0">
          Building a {progressType} backup. This runs in one step on the
          server, so there is nothing to report until it finishes.
        </p>
        <div className="flex flex-column gap-2 mb-3">
          {(TYPE_SECTIONS[progressType] || TYPE_SECTIONS.FULL).map((s) => (
            <div key={s} className="flex align-items-center gap-2">
              <i className={SECTION_ICONS[s] || "pi pi-clock"} />
              <span>{SECTION_LABELS[s] || s}</span>
            </div>
          ))}
        </div>
        <ProgressBar mode="indeterminate" style={{ height: 6 }} />
      </Dialog>

      <Dialog
        visible={showSuccess && !!successData}
        onHide={() => setShowSuccess(false)}
        closable={false}
        header={<span className="backup-success"><i className="pi pi-check-circle mr-2" />Backup Completed</span>}
        footer={<Button label="Done" onClick={() => setShowSuccess(false)} />}
        style={{ width: "min(520px, 95vw)" }}
      >
        {successData && (
          <>
            <Detail label="Type">{successData.type}</Detail>
            <Detail label="Size">{formatSize(successData.fileSize)}</Detail>
            <Detail label="Duration">{formatDuration(successData.durationSeconds)}</Detail>
            <Detail label="Status">
              <span style={{ color: successData.status === "SUCCESS" ? "var(--success)" : "var(--warning)" }}>{successData.status}</span>
            </Detail>
            {successData.healthScore !== undefined && (
              <Detail label="Health">
                <span style={{ color: healthColor(successData.healthScore) }}><i className="pi pi-heart mr-1" />{successData.healthScore}%</span>
              </Detail>
            )}
            {successData.sections?.length > 0 && (
              <div className="mt-3">
                {successData.sections.map((sec: any, idx: number) => <SectionItem key={idx} sec={sec} label />)}
              </div>
            )}
            {Object.keys(successData.recordCounts || {}).length > 0 && (
              <p className="backup-muted">
                Captured{" "}
                {Object.entries(successData.recordCounts)
                  .filter(([, n]: any) => n > 0)
                  .map(([t, n]) => `${n} ${t.replace(/_/g, " ")}`)
                  .join(", ") || "no records (this account is empty)"}
                .
              </p>
            )}
          </>
        )}
      </Dialog>

      <Dialog
        visible={showError}
        onHide={() => setShowError(false)}
        closable={false}
        header={<span className="backup-error"><i className="pi pi-times-circle mr-2" />Backup Failed</span>}
        footer={<Button label="Close" onClick={() => setShowError(false)} />}
        style={{ width: "min(480px, 95vw)" }}
      >
        <p className="m-0">{errorMsg}</p>
      </Dialog>

      <Dialog
        visible={showRestoreConfirm}
        onHide={closeRestoreConfirm}
        closable={false}
        header={<span><i className="pi pi-exclamation-triangle mr-2 backup-warning" />Confirm Restore</span>}
        style={{ width: "min(560px, 95vw)" }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button label="Cancel" outlined severity="secondary" onClick={closeRestoreConfirm} />
            <Button
              severity="danger"
              label={isDestructiveRestore ? "Delete & Restore" : "Restore"}
              disabled={isDestructiveRestore && !restoreConfirmed}
              tooltip={isDestructiveRestore && !restoreConfirmed ? `Type ${RESTORE_CONFIRM_WORD} to enable` : undefined}
              tooltipOptions={{ showOnDisabled: true }}
              onClick={handleRestoreConfirm}
            />
          </div>
        }
      >
        <Detail label="File">{restoreFile?.name}</Detail>
        <Detail label="Type">{restoreType}</Detail>
        <Detail label="Size">{formatSize(restoreFile?.size)}</Detail>
        {restoreValidation?.healthScore !== undefined && (
          <Detail label="Backup Health">{healthBadge(restoreValidation.healthScore)}</Detail>
        )}
        {restoreValidation?.isPartial && (
          <Message className="w-full justify-content-start mt-2" severity="warn"
            text="This backup is partial. Some sections failed when it was created, so restoring it may leave gaps." />
        )}

        {/* A FULL/DATABASE restore deletes every row this account owns first: make someone type. */}
        {isDestructiveRestore ? (
          <>
            <Message
              className="w-full justify-content-start mt-3"
              severity="error"
              content={
                <span>
                  <strong>This deletes your current data.</strong> A {restoreType}{" "}
                  restore removes every client, case, hearing, document record,
                  invoice, expense and task on this account, then re-inserts
                  only what is in this file. Anything added since{" "}
                  {restoreValidation?.backupDate ? formatDate(restoreValidation.backupDate) : "the backup was taken"}{" "}
                  will be lost.
                </span>
              }
            />
            {!restoreValidation && (
              <p className="backup-muted">
                You have not validated this file yet. Cancel and click
                <strong> Validate</strong> first to see what it contains.
              </p>
            )}
            <p className="backup-muted text-sm mt-3">
              A rollback backup of the current data is created first, so this
              can be undone by restoring that file.
            </p>
            <div className="flex flex-column gap-1">
              <label htmlFor="restore-confirm">Type <strong>{RESTORE_CONFIRM_WORD}</strong> to continue:</label>
              <InputText
                id="restore-confirm"
                value={restoreConfirmText}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => setRestoreConfirmText(e.target.value)}
                placeholder={RESTORE_CONFIRM_WORD}
              />
            </div>
          </>
        ) : (
          <p className="backup-muted text-sm mt-3">
            A {restoreType} restore only adds files back; it does not delete
            your records. A rollback backup is still created first.
          </p>
        )}
      </Dialog>
    </div>
  );
}

export default BackupPage;
