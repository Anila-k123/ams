// Document preview: a wide drawer on the right (prototype: previewDoc), like the
// client detail drawer. The file itself on top, then its details and version
// history, with the document's actions in the footer.
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Drawer } from "../ui/overlays";
import { Button, Chip, EmptyState, Skel } from "../ui/kit";
import documentService from "../services/DocumentService";
import "../ui/pages/clients.css";
import { apiUrl, authHeaders } from "../api/client";
import { fileExt, formatBytes } from "./DocumentCard";

const fmt = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

export default function FilePreviewModal({ doc, onClose, onDownload, onSummary, onVersions, onEdit, onShareToggle }: {
  doc: any;
  onClose: () => void;
  onDownload?: (doc: any) => void;
  onSummary?: (doc: any) => void;
  onVersions?: (doc: any) => void;
  onEdit?: (doc: any) => void;
  onShareToggle?: (doc: any) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contentType, setContentType] = useState("");
  const [versions, setVersions] = useState<any[] | null>(null);

  const docId = doc?.id;
  useEffect(() => {
    if (!docId) return;
    setLoading(true);
    setError(null);
    let url: string | null = null;
    fetch(apiUrl(`/api/documents/preview/${docId}`), { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error("Preview unavailable");
        setContentType(res.headers.get("Content-Type") || "");
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [docId]);

  // Version history is a nice-to-have here: if it fails, the section just hides.
  useEffect(() => {
    if (!docId) return;
    setVersions(null);
    (documentService as any).getVersions(docId).then((v: any[]) => setVersions(Array.isArray(v) ? v : [])).catch(() => setVersions([]));
  }, [docId]);

  if (!doc) return null;

  const isImage = contentType.startsWith("image/");
  const isPdf = contentType === "application/pdf";
  const isText = contentType.startsWith("text/");
  const ext = fileExt(doc);
  const caseEntity = doc.caseEntity;
  const clientName = doc.client?.name || caseEntity?.client?.name;
  const shared = !!doc.clientVisible;

  const fallback = (msg: string) => (
    <EmptyState icon="file" title={msg} text="You can still download the file and open it on your computer."
      action={onDownload ? <Button variant="primary" icon="download" onClick={() => onDownload(doc)}>Download file</Button> : undefined} />
  );

  return (
    <Drawer open wide onClose={onClose} title={doc.documentName || doc.originalName}
      sub={<>
        <Chip plain>{ext.length > 6 ? "FILE" : ext}</Chip>
        <Chip plain>{doc.category || "Uncategorised"}</Chip>
        {doc.version > 1 && <Chip plain>Version {doc.version}</Chip>}
        {doc.fileSize ? <Chip plain>{formatBytes(doc.fileSize)}</Chip> : null}
        {(caseEntity || doc.client) && (shared ? <Chip tone="ok">Shared with client</Chip> : <Chip>Private</Chip>)}
      </>}
      footer={<>
        {onSummary && <Button icon="sparkle" onClick={() => onSummary(doc)}>Summarise</Button>}
        {onVersions && <Button icon="history" onClick={() => onVersions(doc)}>Versions</Button>}
        {onEdit && <Button icon="edit" onClick={() => onEdit(doc)}>Edit details</Button>}
        {onShareToggle && (caseEntity || doc.client) && (
          <Button icon="globe" onClick={() => onShareToggle(doc)}>{shared ? "Stop sharing" : "Share with client"}</Button>
        )}
        <span className="grow" />
        {onDownload && <Button variant="primary" icon="download" onClick={() => onDownload(doc)}>Download</Button>}
      </>}>

      {/* The file itself */}
      <div className="pv-box">
        {loading && (
          <div className="stack" style={{ alignItems: "center", padding: "var(--s8) 0" }}>
            <Skel w={80} h={100} />
            <Skel w="60%" />
            <Skel w="40%" h={12} />
          </div>
        )}
        {!loading && error && fallback("Preview unavailable")}
        {!loading && !error && previewUrl && (
          isImage ? <img className="pv-img" src={previewUrl} alt={doc.documentName} />
            : isPdf || isText ? <iframe className="pv-frame" src={previewUrl} title={doc.documentName} />
              : fallback("Preview not available for this file type")
        )}
      </div>

      {/* Details */}
      <dl className="kv" style={{ marginTop: "var(--s5)" }}>
        <dt>Case</dt>
        <dd>{caseEntity
          ? <><Link className="link mono" to={`/dashboard/cases/${caseEntity.id}`} onClick={onClose}>{caseEntity.caseNumber}</Link>
            {caseEntity.caseTitle && <div className="faint xs">{caseEntity.caseTitle}</div>}</>
          : "—"}</dd>
        <dt>Client</dt><dd>{clientName || "—"}</dd>
        <dt>Uploaded</dt><dd>{fmt(doc.uploadDate)}</dd>
        {doc.description && <><dt>Description</dt><dd style={{ whiteSpace: "pre-line" }}>{doc.description}</dd></>}
        <dt>File</dt><dd className="small" style={{ overflowWrap: "anywhere" }}>{doc.originalName || "—"}</dd>
      </dl>

      {/* Version history */}
      {versions === null ? (
        <div style={{ marginTop: "var(--s5)" }}><Skel h={12} w="40%" /></div>
      ) : versions.length > 0 && (
        <>
          <h4 style={{ margin: "var(--s6) 0 var(--s2)" }}>Versions</h4>
          <div className="timeline">
            {versions.map((v) => (
              <div key={v.version} className={`tl-item${v.isCurrent ? " key" : ""}`}>
                <div className="small"><b>v{v.version}</b>{v.isCurrent ? " (current)" : ""}{v.note ? ` · ${v.note}` : ""}</div>
                <div className="when">{fmt(v.createdAt)}{v.uploadedByName ? `, ${v.uploadedByName}` : ""}{v.fileSize ? ` · ${formatBytes(v.fileSize)}` : ""}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </Drawer>
  );
}
