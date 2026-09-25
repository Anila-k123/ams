import { useState, useEffect } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { Skeleton } from "primereact/skeleton";
import { Tag } from "primereact/tag";
import { apiUrl, authHeaders } from "../api/client";

export default function FilePreviewModal({ doc, onClose, onDownload }: {
  doc: any; onClose: () => void; onDownload?: (doc: any) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contentType, setContentType] = useState("");

  useEffect(() => {
    if (!doc) return;
    setLoading(true);
    setError(null);
    let url: string | null = null;
    fetch(apiUrl(`/api/documents/preview/${doc.id}`), { headers: authHeaders() })
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
  }, [doc?.id]);

  const isImage = contentType.startsWith("image/");
  const isPdf = contentType === "application/pdf";
  const isText = contentType.startsWith("text/");
  const handleDownload = () => { if (onDownload) onDownload(doc); };

  if (!doc) return null;

  const header = (
    <div className="flex align-items-center justify-content-between gap-2 pr-2">
      <span className="text-overflow-ellipsis overflow-hidden white-space-nowrap">{doc.documentName}</span>
      <Button icon="pi pi-download" className="p-button-rounded p-button-text" onClick={handleDownload} tooltip="Download" aria-label="Download" />
    </div>
  );
  const footer = (
    <div className="flex flex-wrap gap-2 justify-content-start">
      <Tag severity="info" value={doc.fileType?.split("/")[1]?.toUpperCase() || "FILE"} />
      <Tag severity="secondary" value={doc.category || "Uncategorized"} />
      {doc.caseEntity && <Tag severity="secondary" value={`Case: ${doc.caseEntity.caseNumber}`} />}
      {doc.version > 1 && <Tag severity="secondary" value={`v${doc.version}`} />}
    </div>
  );

  return (
    <Dialog visible onHide={onClose} header={header} footer={footer} modal dismissableMask maximizable
      style={{ width: "min(1000px, 95vw)" }} contentStyle={{ minHeight: "60vh" }}>
      {loading && (
        <div className="flex flex-column align-items-center gap-2 p-5">
          <Skeleton width="80px" height="80px" borderRadius="12px" />
          <Skeleton width="60%" height="14px" />
          <Skeleton width="40%" height="12px" />
        </div>
      )}
      {error && (
        <div className="flex flex-column align-items-center gap-3 p-5" style={{ color: "var(--text-muted)" }}>
          <i className="pi pi-file" style={{ fontSize: 48 }} />
          <p>{error}</p>
          <Button label="Download instead" icon="pi pi-download" onClick={handleDownload} />
        </div>
      )}
      {!loading && !error && previewUrl && (
        isImage ? (
          <div className="flex justify-content-center">
            <img src={previewUrl} alt={doc.documentName} style={{ maxWidth: "100%", maxHeight: "70vh", objectFit: "contain" }} />
          </div>
        ) : isPdf || isText ? (
          <iframe src={previewUrl} title={doc.documentName} style={{ width: "100%", height: "70vh", border: 0 }} />
        ) : (
          <div className="flex flex-column align-items-center gap-3 p-5" style={{ color: "var(--text-muted)" }}>
            <i className="pi pi-file" style={{ fontSize: 64 }} />
            <p>Preview not available for this file type</p>
            <Button label="Download file" icon="pi pi-download" onClick={handleDownload} />
          </div>
        )
      )}
    </Dialog>
  );
}
