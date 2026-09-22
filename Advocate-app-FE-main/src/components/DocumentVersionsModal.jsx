import { useEffect, useState, useCallback, useRef } from "react";
import { FiDownload, FiUploadCloud, FiClock } from "react-icons/fi";
import Modal from "./Modal";
import documentService from "../services/DocumentService";
import "../assets/styles/DocumentVersionsModal.css";

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function DocumentVersionsModal({ doc, onClose, canUpload = false, onUpdated }) {
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    if (!doc) return;
    setLoading(true);
    setErr("");
    try {
      setVersions(await documentService.getVersions(doc.id));
    } catch (e) {
      console.error("Versions load error:", e);
      setErr("Could not load version history.");
    } finally {
      setLoading(false);
    }
  }, [doc]);

  useEffect(() => { load(); }, [load]);

  const download = async (version) => {
    try {
      const { blob, filename } = await documentService.downloadVersion(doc.id, version);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Version download error:", e);
      setErr("Download failed.");
    }
  };

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      await documentService.uploadNewVersion(doc.id, file, note.trim());
      setNote("");
      await load();
      onUpdated?.();
    } catch (e2) {
      console.error("New version upload error:", e2);
      setErr("Could not upload the new version.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={!!doc} onClose={onClose} title={`Versions — ${doc?.documentName || "Document"}`}>
      <div className="dv-modal">
        {canUpload && (
          <div className="dv-upload">
            <input
              className="dv-note-input"
              type="text"
              placeholder="What changed in this version? (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
            />
            <button className="dv-upload-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
              <FiUploadCloud /> {busy ? "Uploading…" : "Choose file & upload new version"}
            </button>
            <input ref={fileRef} type="file" style={{ display: "none" }} onChange={onPickFile} />
            <span className="dv-hint">Replaces the current file; the old one is kept in history.</span>
          </div>
        )}

        {err && <div className="dv-error">{err}</div>}
        {loading ? (
          <div className="dv-state"><span className="dv-spinner" /> Loading…</div>
        ) : (
          <ul className="dv-list">
            {versions.map((v) => (
              <li key={v.version} className={`dv-row${v.isCurrent ? " current" : ""}`}>
                <span className="dv-ver">v{v.version}{v.isCurrent && <em> current</em>}</span>
                <div className="dv-info">
                  <span className="dv-name">{v.originalName || "(file)"}</span>
                  {v.note && <span className="dv-note">“{v.note}”</span>}
                  <span className="dv-meta">
                    {formatBytes(v.fileSize)}
                    {v.uploadedByName ? ` · ${v.uploadedByName}` : ""}
                    {v.createdAt ? ` · ${new Date(v.createdAt).toLocaleDateString()}` : ""}
                  </span>
                </div>
                <button className="dv-dl" onClick={() => download(v.version)} title="Download this version">
                  <FiDownload />
                </button>
              </li>
            ))}
            {versions.length === 0 && (
              <li className="dv-state"><FiClock /> No versions found.</li>
            )}
          </ul>
        )}
      </div>
    </Modal>
  );
}
