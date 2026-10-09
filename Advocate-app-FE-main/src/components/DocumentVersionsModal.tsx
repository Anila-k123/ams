import { useEffect, useState, useCallback, useRef } from "react";
import { Drawer } from "../ui/overlays";
import { Button, Chip, EmptyState, Icon, Spinner } from "../ui/kit";
import { TextField } from "../ui/forms";
import documentService from "../services/DocumentService";
import { formatBytes } from "./DocumentCard";
import "../ui/pages/clients.css";
import { DOCUMENT_ACCEPT } from "../utils/fileTypes";

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
    <Drawer open={!!doc} onClose={onClose} title="Version history" sub={<span className="muted small">{doc?.documentName || "Document"}</span>}
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <div className="stack">
        {canUpload && (
          <div className="panel"><div className="panel-body stack">
            <TextField label="What changed in this version?" hint="Optional. Replaces the current file; the old one is kept in history."
              value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="e.g. Signed copy" />
            <div>
              <Button variant="primary" icon="upload" onClick={() => fileRef.current?.click()} disabled={busy} loading={busy}>
                {busy ? "Uploading…" : "Choose file and upload new version"}
              </Button>
            </div>
            <input ref={fileRef} type="file" accept={DOCUMENT_ACCEPT} hidden onChange={onPickFile} aria-label="New version file" />
          </div></div>
        )}

        {err && <div className="callout bad"><Icon name="warn" size="sm" /><span>{err}</span></div>}
        {loading ? (
          <Spinner label="Loading versions" />
        ) : versions.length === 0 ? (
          <EmptyState icon="history" title="No versions found" />
        ) : (
          <ul className="dv-list">
            {versions.map((v) => (
              <li key={v.version} className={`dv-row${v.isCurrent ? " current" : ""}`}>
                <span className="dv-ver">v{v.version}</span>
                <div className="grow">
                  <div className="ellipsis small" title={v.originalName}><b>{v.originalName || "(file)"}</b>{v.isCurrent && <> <Chip tone="ok">Current</Chip></>}</div>
                  {v.note && <div className="small muted">“{v.note}”</div>}
                  <div className="faint xs">
                    {formatBytes(v.fileSize)}
                    {v.uploadedByName ? `, ${v.uploadedByName}` : ""}
                    {v.createdAt ? `, ${new Date(v.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}
                  </div>
                </div>
                <Button size="sm" variant="ghost" iconOnly icon="download" onClick={() => download(v.version)}
                  aria-label={`Download version ${v.version}`} title="Download this version" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}
