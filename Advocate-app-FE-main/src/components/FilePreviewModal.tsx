import { useState, useEffect } from "react";
import { Modal } from "../ui/overlays";
import { Button, Chip, EmptyState, Skel } from "../ui/kit";
import "../ui/pages/clients.css";
import { apiUrl, authHeaders } from "../api/client";

export default function FilePreviewModal({ doc, onClose, onDownload }: {
  doc: any; onClose: () => void; onDownload?: (doc: any) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [contentType, setContentType] = useState("");

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

  const isImage = contentType.startsWith("image/");
  const isPdf = contentType === "application/pdf";
  const isText = contentType.startsWith("text/");
  const handleDownload = () => { if (onDownload) onDownload(doc); };

  if (!doc) return null;

  const ext = (doc.fileType?.split("/")[1] || (doc.originalName || "").split(".").pop() || "file").toUpperCase();
  const fallback = (msg: string) => (
    <EmptyState icon="file" title={msg} text="You can still download the file and open it on your computer."
      action={onDownload ? <Button variant="primary" icon="download" onClick={handleDownload}>Download file</Button> : undefined} />
  );

  return (
    <Modal open onClose={onClose} size="xwide" title={doc.documentName}
      sub={<span className="row wrap" style={{ gap: 6 }}>
        <Chip plain>{ext.length > 6 ? "FILE" : ext}</Chip>
        <Chip plain>{doc.category || "Uncategorised"}</Chip>
        {doc.caseEntity && <Chip plain><span className="mono">{doc.caseEntity.caseNumber}</span></Chip>}
        {doc.version > 1 && <Chip plain>v{doc.version}</Chip>}
      </span>}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {onDownload && <Button variant="primary" icon="download" onClick={handleDownload}>Download</Button>}
      </>}>
      {loading && (
        <div className="stack" style={{ alignItems: "center", padding: "var(--s8) 0" }}>
          <Skel w={80} h={80} />
          <Skel w="60%" />
          <Skel w="40%" h={12} />
        </div>
      )}
      {error && fallback("Preview unavailable")}
      {!loading && !error && previewUrl && (
        isImage ? <img className="pv-img" src={previewUrl} alt={doc.documentName} />
          : isPdf || isText ? <iframe className="pv-frame" src={previewUrl} title={doc.documentName} />
            : fallback("Preview not available for this file type")
      )}
    </Modal>
  );
}
