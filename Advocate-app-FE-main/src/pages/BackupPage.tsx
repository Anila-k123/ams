// Backup & Restore: create backups by section, restore one from a .zip (typed
// confirmation when it deletes data), and the history of past backups.
import { useState, useEffect, useCallback } from "react";
import api from "../api/client";
import { useLoading } from "../contexts/LoadingContext";
import { useDownload } from "../hooks/useDownload";
import DownloadLoader from "../components/DownloadLoader";
import { PageHead, Button, Chip, Icon, Panel, type IconName, type Tone } from "../ui/kit";
import { Field } from "../ui/forms";
import { Modal, Drawer, confirm } from "../ui/overlays";
import { DataTable, type Column } from "../ui/DataTable";
import "../ui/pages/firm.css";

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

const SECTION_ICONS: Record<string, IconName> = {
  DATABASE: "database",
  JSON: "file",
  DOCUMENTS: "folder",
  REPORTS: "chart",
  SETTINGS: "cog",
};

const BACKUP_TYPES: { key: string; label: string; desc: string; icon: IconName }[] = [
  { key: "DATABASE", label: "Database only", desc: "Cases, clients, billing and history.", icon: "database" },
  { key: "DOCUMENTS", label: "Documents only", desc: "Uploaded files and documents.", icon: "folder" },
  { key: "REPORTS", label: "Reports only", desc: "Generated reports and PDFs.", icon: "chart" },
  { key: "SETTINGS", label: "Settings only", desc: "Profile and preferences.", icon: "cog" },
];

const RESTORE_TYPES = [
  { value: "FULL", label: "Full restore" },
  { value: "DATABASE", label: "Database only" },
  { value: "DOCUMENTS", label: "Documents only" },
  { value: "REPORTS", label: "Reports only" },
  { value: "SETTINGS", label: "Settings only" },
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
const formatDate = (dateStr: any) => (dateStr
  ? new Date(dateStr).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
  : "");
const healthTone = (score: number): Tone => (score >= 90 ? "ok" : score >= 60 ? "warn" : "bad");
const statusTone = (s: string): Tone =>
  s === "SUCCESS" ? "ok" : s === "FAILED" || s === "PARTIAL" ? "bad" : s === "RUNNING" ? "warn" : "";
const cap = (s?: string) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : "—");

const parseMetadata = (h: any) => {
  if (!h.metadataJson) return { sections: [], healthScore: 100 };
  try {
    return JSON.parse(h.metadataJson);
  } catch {
    return { sections: [], healthScore: 100 };
  }
};

function SectionItem({ sec, label }: { sec: any; label?: boolean }) {
  const ok = sec.status === "SUCCESS";
  const bad = sec.status === "FAILED";
  return (
    <div className={`fm-sec${ok ? " ok" : bad ? " bad" : ""}`}>
      <Icon name={ok ? "ok" : bad ? "x" : "clock"} size="sm" />
      <div className="grow">
        <div className="row" style={{ gap: 6 }}>
          {SECTION_ICONS[sec.name] && <Icon name={SECTION_ICONS[sec.name]} size="sm" />}
          <b className="small">{label ? SECTION_LABELS[sec.name] || sec.name : sec.name}</b>
        </div>
        {!label && <div className="faint xs">{cap(sec.status)}</div>}
        {sec.error && <div className="xs fm-err">{sec.error}</div>}
      </div>
      <span className="faint xs num">{formatDurationMs(sec.durationMs)}</span>
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
  const [detailRow, setDetailRow] = useState<any>(null);
  const [dragOver, setDragOver] = useState(false);

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
    confirm({
      title: "Delete this backup?",
      message: "The backup file is removed permanently.",
      danger: true,
      confirmLabel: "Delete backup",
      accept: async () => {
        try {
          await withLoading(api.delete(`${API}/${id}`), "Deleting Backup...");
          setStatusMsg({ type: "success", text: "Backup deleted" });
          setDetailRow(null);
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
  const healthBadge = (score: number) => <Chip tone={healthTone(score)}>{score}%</Chip>;

  const columns: Column<any>[] = [
    { key: "createdAt", label: "Created", render: (h) => <span className="nowrap">{formatDate(h.createdAt)}</span> },
    { key: "backupType", label: "Type", render: (h) => cap(h.backupType) },
    { key: "fileSize", label: "Size", align: "right", render: (h) => <span className="num nowrap">{formatSize(h.fileSize)}</span> },
    { key: "durationSeconds", label: "Took", hideSm: true, render: (h) => <span className="num">{formatDuration(h.durationSeconds)}</span> },
    { key: "health", label: "Health", hideSm: true, render: (h) => healthBadge(parseMetadata(h).healthScore) },
    { key: "status", label: "Status", render: (h) => <Chip tone={statusTone(h.status)}>{cap(h.status)}</Chip> },
    {
      key: "act", label: <span className="sr-only">Actions</span>, render: (h) => (
        <div className="row nowrap" style={{ gap: 2 }}>
          <button type="button" className="btn ghost sm icon" aria-label="Download backup" onClick={() => downloadBackup(h.id)}><Icon name="download" size="sm" /></button>
          <button type="button" className="btn ghost sm icon" aria-label="Delete backup" onClick={() => requestDelete(h.id)}><Icon name="trash" size="sm" /></button>
        </div>
      ),
    },
  ];

  const detail = detailRow ? parseMetadata(detailRow) : null;

  return (
    <div>
      {isDownloading && <DownloadLoader />}
      <PageHead
        title="Backup & Restore"
        sub="Take a fresh backup before you restore: a restore replaces current data."
        actions={<>
          <Button icon="refresh" onClick={() => { loadHistory(); loadStats(); }}>Refresh</Button>
          <Button icon="archive" onClick={() => createBackup("FULL")} disabled={loading}>Full backup</Button>
          <Button variant="primary" icon="bolt" onClick={() => createBackup("QUICK")} disabled={loading}>Quick backup</Button>
        </>}
      />

      {statusMsg.text && (
        <div className={`callout ${statusMsg.type === "success" ? "ok" : "bad"}`} role="status" style={{ marginBottom: 16 }}>
          <Icon name={statusMsg.type === "success" ? "ok" : "warn"} className="i" size="sm" />
          <div className="grow">{statusMsg.text}</div>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setStatusMsg({ type: "", text: "" })}><Icon name="x" size="sm" /></button>
        </div>
      )}

      <div className="figures">
        <div className="figure">
          <div className="lbl">Latest backup</div>
          <div className="val fm-val">{latestBackup ? formatDate(latestBackup.createdAt) : "None yet"}</div>
          <div className="meta">
            {latestBackup ? `${cap(latestBackup.backupType)}, ${formatSize(latestBackup.fileSize)}` : "Create your first backup below."}
            {latestBackup && latestMeta.healthScore < 100 && <> · partial ({latestMeta.healthScore}%)</>}
          </div>
        </div>
        <div className="figure">
          <div className="lbl">Storage used</div>
          <div className="val">{formatSize(stats.totalSize)}</div>
          <div className="meta">{stats.totalBackups} backup{stats.totalBackups === 1 ? "" : "s"}</div>
        </div>
        <div className="figure">
          <div className="lbl">Latest health</div>
          <div className="val">{latestBackup ? `${latestMeta.healthScore}%` : "—"}</div>
          <div className="meta">{latestBackup ? (latestMeta.healthScore < 100 ? "Some sections failed" : "Every section completed") : "No backups"}</div>
        </div>
      </div>

      <div className="section-title"><h2>Create a backup</h2></div>
      {/* A backup covers the rows this account created, not everything it can see. */}
      <p className="muted small" style={{ marginBottom: 12 }}>
        Covers the records <strong>you created</strong>. If you share a practice, colleagues' records are backed up from their own accounts.
      </p>
      <div className="pp-type-cards">
        {BACKUP_TYPES.map((bt) => (
          <button key={bt.key} type="button" onClick={() => createBackup(bt.key)} disabled={loading}>
            <Icon name={bt.icon} />
            <b>{bt.label}</b>
            <span className="small muted">{bt.desc}</span>
          </button>
        ))}
      </div>

      <div className="section-title"><h2>Restore from a backup</h2></div>
      <Panel>
        <div className="stack">
          <label className={`dropzone${dragOver ? " over" : ""}`} htmlFor="restore-input"
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) pickFile(f); }}>
            <Icon name="upload" size="lg" />
            {restoreFile ? (
              <div style={{ marginTop: 8 }}><b className="mono">{restoreFile.name}</b>, {formatSize(restoreFile.size)}</div>
            ) : (
              <div style={{ marginTop: 8 }}><b>Drop a backup .zip here</b> or <span className="link">browse</span></div>
            )}
            <div className="faint xs" style={{ marginTop: 4 }}>AMS backup files only</div>
            <input type="file" accept=".zip" className="sr-only" id="restore-input" onChange={(e) => pickFile(e.target.files?.[0])} />
          </label>

          {restoreValidation && (
            <div className={`callout ${restoreValidation.healthScore < 100 ? "warn" : "ok"}`}>
              <Icon name={restoreValidation.healthScore < 100 ? "warn" : "ok"} className="i" size="sm" />
              <div className="grow stack" style={{ gap: 8 }}>
                <b>{restoreValidation.healthScore < 100 ? "This backup is partial. Some data may be missing." : `Backup is readable. Health ${restoreValidation.healthScore}%.`}</b>
                <dl className="kv">
                  <dt>Type</dt><dd>{restoreValidation.backupType || "N/A"}</dd>
                  <dt>Created</dt><dd>{restoreValidation.backupDate ? formatDate(restoreValidation.backupDate) : "N/A"}</dd>
                  <dt>Health</dt><dd>{healthBadge(restoreValidation.healthScore)}</dd>
                  <dt>Version</dt><dd>{restoreValidation.backupVersion || "N/A"}</dd>
                  <dt>Size</dt><dd>{formatSize(restoreFile?.size)}</dd>
                </dl>
                {restoreValidation.failedSections?.length > 0 && (
                  <div className="small fm-err">Failed sections: {restoreValidation.failedSections.join(", ")}</div>
                )}
                {restoreValidation.skippedSections?.length > 0 && (
                  <div className="small muted">Skipped sections: {restoreValidation.skippedSections.join(", ")}</div>
                )}
              </div>
            </div>
          )}

          <div className="row wrap" style={{ alignItems: "flex-end" }}>
            <Field label="Restore type">
              {(id) => (
                <select id={id} className="input" value={restoreType} onChange={(e) => { setRestoreType(e.target.value); setRestoreConfirmText(""); }}>
                  {RESTORE_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </Field>
            <Button icon="shield" onClick={handleValidate} disabled={!restoreFile}>Validate</Button>
            <Button variant="danger-solid" icon="restore" loading={restoring} onClick={() => setShowRestoreConfirm(true)} disabled={!restoreFile || restoring}>
              {restoring ? "Restoring…" : "Restore"}
            </Button>
            <span className="faint xs">Validate checks the file before anything is changed.</span>
          </div>
        </div>
      </Panel>

      <div className="section-title"><h2>History</h2></div>
      <DataTable
        rows={history}
        columns={columns}
        rowKey={(h) => h.id}
        onRow={setDetailRow}
        caption="Backup history"
        empty={{ icon: "archive", title: "No backups yet", text: "Create your first backup above." }}
      />

      <Drawer
        open={!!detailRow}
        onClose={() => setDetailRow(null)}
        title={detailRow ? `${cap(detailRow.backupType)} backup` : ""}
        sub={detailRow ? <span className="faint small">{formatDate(detailRow.createdAt)}</span> : null}
        footer={detailRow ? <>
          <Button icon="download" onClick={() => downloadBackup(detailRow.id)}>Download</Button>
          <Button variant="primary" onClick={() => setDetailRow(null)}>Done</Button>
        </> : null}
      >
        {detailRow && detail && (
          <div className="stack" style={{ gap: 20 }}>
            <dl className="kv">
              <dt>Size</dt><dd>{formatSize(detailRow.fileSize)}</dd>
              <dt>Took</dt><dd>{formatDuration(detailRow.durationSeconds) || "—"}</dd>
              <dt>Health</dt><dd>{healthBadge(detail.healthScore)}</dd>
              <dt>Status</dt><dd><Chip tone={statusTone(detailRow.status)}>{cap(detailRow.status)}</Chip></dd>
            </dl>
            <div>
              <h4 className="fm-h4">Sections</h4>
              {detail.sections && detail.sections.length > 0
                ? <div className="stack" style={{ gap: 8 }}>{detail.sections.map((sec: any, idx: number) => <SectionItem key={idx} sec={sec} />)}</div>
                : <p className="faint small">No section data available</p>}
            </div>
          </div>
        )}
      </Drawer>

      <Modal open={showProgress} onClose={() => {}} dismissable={false} size="narrow"
        title="Backup in progress" sub="This runs in one step on the server, so there is nothing to report until it finishes.">
        <div className="pp-progress fm-indet" role="progressbar" aria-label="Backup progress" aria-busy="true"><i /></div>
        <div className="pp-steps">
          {(TYPE_SECTIONS[progressType] || TYPE_SECTIONS.FULL).map((s) => (
            <div key={s} className="on">
              <Icon name={SECTION_ICONS[s] || "clock"} size="sm" />
              <span className="grow">{SECTION_LABELS[s] || s}</span>
            </div>
          ))}
        </div>
      </Modal>

      <Modal open={showSuccess && !!successData} onClose={() => setShowSuccess(false)} size="narrow" title="Backup completed"
        footer={<Button variant="primary" onClick={() => setShowSuccess(false)}>Done</Button>}>
        {successData && (
          <div className="stack" style={{ gap: 16 }}>
            <dl className="kv">
              <dt>Type</dt><dd>{cap(successData.type)}</dd>
              <dt>Size</dt><dd>{formatSize(successData.fileSize)}</dd>
              <dt>Took</dt><dd>{formatDuration(successData.durationSeconds)}</dd>
              <dt>Status</dt><dd><Chip tone={successData.status === "SUCCESS" ? "ok" : "warn"}>{cap(successData.status)}</Chip></dd>
              {successData.healthScore !== undefined && <><dt>Health</dt><dd>{healthBadge(successData.healthScore)}</dd></>}
            </dl>
            {successData.sections?.length > 0 && (
              <div className="stack" style={{ gap: 8 }}>
                {successData.sections.map((sec: any, idx: number) => <SectionItem key={idx} sec={sec} label />)}
              </div>
            )}
            {Object.keys(successData.recordCounts || {}).length > 0 && (
              <p className="muted small">
                Captured{" "}
                {Object.entries(successData.recordCounts)
                  .filter(([, n]: any) => n > 0)
                  .map(([t, n]) => `${n} ${t.replace(/_/g, " ")}`)
                  .join(", ") || "no records (this account is empty)"}
                .
              </p>
            )}
          </div>
        )}
      </Modal>

      <Modal open={showError} onClose={() => setShowError(false)} size="narrow" title="Backup failed"
        footer={<Button variant="primary" onClick={() => setShowError(false)}>Close</Button>}>
        <div className="callout bad"><Icon name="warn" className="i" size="sm" /><div>{errorMsg}</div></div>
      </Modal>

      <Modal open={showRestoreConfirm} onClose={closeRestoreConfirm} title="Restore this backup?"
        footer={<>
          <Button variant="ghost" onClick={closeRestoreConfirm}>Cancel</Button>
          <Button variant="danger-solid" icon="restore" onClick={handleRestoreConfirm}
            disabled={isDestructiveRestore && !restoreConfirmed}
            title={isDestructiveRestore && !restoreConfirmed ? `Type ${RESTORE_CONFIRM_WORD} to enable` : undefined}>
            {isDestructiveRestore ? "Delete & restore" : "Restore"}
          </Button>
        </>}>
        <div className="stack" style={{ gap: 14 }}>
          <dl className="kv">
            <dt>File</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{restoreFile?.name}</dd>
            <dt>Type</dt><dd>{RESTORE_TYPES.find((t) => t.value === restoreType)?.label}</dd>
            <dt>Size</dt><dd>{formatSize(restoreFile?.size)}</dd>
            {restoreValidation?.healthScore !== undefined && <><dt>Backup health</dt><dd>{healthBadge(restoreValidation.healthScore)}</dd></>}
          </dl>
          {restoreValidation?.isPartial && (
            <div className="callout warn"><Icon name="warn" className="i" size="sm" />
              <div>This backup is partial. Some sections failed when it was created, so restoring it may leave gaps.</div>
            </div>
          )}

          {/* A FULL/DATABASE restore deletes every row this account owns first: make someone type. */}
          {isDestructiveRestore ? (
            <>
              <div className="callout bad"><Icon name="alert" className="i" size="sm" />
                <div>
                  <strong>This deletes your current data.</strong> A {restoreType.toLowerCase()} restore removes every client, case,
                  hearing, document record, invoice, expense and task on this account, then re-inserts only what is in this
                  file. Anything added since{" "}
                  {restoreValidation?.backupDate ? formatDate(restoreValidation.backupDate) : "the backup was taken"} will be lost.
                </div>
              </div>
              {!restoreValidation && (
                <p className="muted small">
                  You have not validated this file yet. Cancel and click <strong>Validate</strong> first to see what it contains.
                </p>
              )}
              <p className="faint small">A rollback backup of the current data is created first, so this can be undone by restoring that file.</p>
              <Field label={<>Type <strong className="mono">{RESTORE_CONFIRM_WORD}</strong> to continue</>}>
                {(id) => (
                  <input id={id} className="input mono" value={restoreConfirmText} autoFocus spellCheck={false} autoComplete="off"
                    placeholder={RESTORE_CONFIRM_WORD} onChange={(e) => setRestoreConfirmText(e.target.value)} />
                )}
              </Field>
            </>
          ) : (
            <p className="muted small">
              A {restoreType.toLowerCase()} restore only adds files back; it does not delete your records. A rollback backup is still created first.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}

export default BackupPage;
