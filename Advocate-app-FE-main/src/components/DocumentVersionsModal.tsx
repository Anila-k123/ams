import { useEffect, useState, useCallback, useRef } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { ProgressSpinner } from "primereact/progressspinner";
import documentService from "../services/DocumentService";
import { formatBytes } from "./DocumentCard";
import "../assets/styles/DocumentVersionsModal.css";

export default function DocumentVersionsModal({ doc, onClose, canUpload = false, onUpdated }: {
  doc: any; onClose: () => void; canUpload?: boolean; onUpdated?: () => void;
}) {
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!doc) return;
    setLoading(true);
    setErr("");
    try {
      setVersions(await (documentService as any).getVersions(doc.id));
    } catch (e) {
      console.error("Versions load error:", e);
      setErr("Could not load version history.");
    } finally {
      setLoading(false);
    }
  }, [doc]);

  useEffect(() => { load(); }, [load]);

  const download = async (version: number) => {
    try {
      const { blob, filename } = await (documentService as any).downloadVersion(doc.id, version);
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

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setErr("");
    try {
      await (documentService as any).uploadNewVersion(doc.id, file, note.trim());
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
    <Dialog visible={!!doc} onHide={onClose} header={`Versions — ${doc?.documentName || "Document"}`}
      style={{ width: "36rem" }} breakpoints={{ "640px": "95vw" }} modal dismissableMask>
      <div className="flex flex-column gap-3">
        {canUpload && (
          <div className="dv-upload flex flex-column gap-2">
            <InputText placeholder="What changed in this version? (optional)" value={note}
              onChange={(e) => setNote(e.target.value)} disabled={busy} className="w-full" />
            <Button icon="pi pi-cloud-upload" label={busy ? "Uploading…" : "Choose file & upload new version"}
              onClick={() => fileRef.current?.click()} disabled={busy} loading={busy} />
            <input ref={fileRef} type="file" style={{ display: "none" }} onChange={onPickFile} />
            <small className="dv-muted">Replaces the current file; the old one is kept in history.</small>
          </div>
        )}

        {err && <div className="dv-error">{err}</div>}
        {loading ? (
          <div className="flex align-items-center gap-2 dv-muted">
            <ProgressSpinner style={{ width: 24, height: 24 }} strokeWidth="6" /> Loading…
          </div>
        ) : (
          <ul className="dv-list">
            {versions.map((v) => (
              <li key={v.version} className={`dv-row${v.isCurrent ? " current" : ""}`}>
                <span className="dv-ver">v{v.version}{v.isCurrent && <em> current</em>}</span>
                <div className="dv-info">
                  <span className="dv-name">{v.originalName || "(file)"}</span>
                  {v.note && <span className="dv-note">“{v.note}”</span>}
                  <span className="dv-muted">
                    {formatBytes(v.fileSize)}
                    {v.uploadedByName ? ` · ${v.uploadedByName}` : ""}
                    {v.createdAt ? ` · ${new Date(v.createdAt).toLocaleDateString()}` : ""}
                  </span>
                </div>
                <Button icon="pi pi-download" className="p-button-rounded p-button-text" onClick={() => download(v.version)}
                  tooltip="Download this version" aria-label="Download this version" />
              </li>
            ))}
            {versions.length === 0 && (
              <li className="dv-muted"><i className="pi pi-clock" /> No versions found.</li>
            )}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
