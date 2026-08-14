import React, { useState, useEffect } from "react";
import { FiX, FiDownload, FiFile, FiImage } from "react-icons/fi";
import { Skeleton } from "./Skeleton";

export default function FilePreviewModal({ doc, onClose, onDownload }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [contentType, setContentType] = useState("");

  useEffect(() => {
    if (!doc) return;
    setLoading(true);
    setError(null);

    const token = localStorage.getItem("token");
    fetch(`${window.API_BASE}/api/documents/preview/${doc.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error("Preview unavailable");
        const type = res.headers.get("Content-Type") || "";
        setContentType(type);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));

    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [doc?.id]);

  const isImage = contentType.startsWith("image/");
  const isPdf = contentType === "application/pdf";
  const isText = contentType.startsWith("text/");

  const handleDownload = () => {
    if (onDownload) onDownload(doc);
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  if (!doc) return null;

  return (
    <div className="preview-overlay" onClick={handleBackdropClick}>
      <div className="preview-container">
        <div className="preview-header">
          <h4>{doc.documentName}</h4>
          <div className="preview-header-actions">
            <button className="preview-action-btn" onClick={handleDownload} title="Download">
              <FiDownload />
            </button>
            <button className="preview-action-btn close" onClick={onClose} title="Close">
              <FiX />
            </button>
          </div>
        </div>
        <div className="preview-body">
          {loading && (
            <div className="preview-loading">
              <Skeleton width={80} height={80} borderRadius={12} style={{ margin: "0 auto 16px" }} />
              <Skeleton width="60%" height={14} style={{ margin: "0 auto" }} />
              <Skeleton width="40%" height={12} style={{ margin: "8px auto 0" }} />
            </div>
          )}
          {error && (
            <div className="preview-error">
              <FiFile size={48} />
              <p>{error}</p>
              <button className="preview-dl-btn" onClick={handleDownload}>Download instead</button>
            </div>
          )}
          {!loading && !error && previewUrl && (
            <>
              {isImage ? (
                <div className="preview-image-wrapper">
                  <img src={previewUrl} alt={doc.documentName} className="preview-image" />
                </div>
              ) : isPdf ? (
                <iframe
                  src={previewUrl}
                  title={doc.documentName}
                  className="preview-iframe"
                  frameBorder="0"
                />
              ) : isText ? (
                <iframe
                  src={previewUrl}
                  title={doc.documentName}
                  className="preview-iframe"
                  frameBorder="0"
                />
              ) : (
                <div className="preview-unsupported">
                  <FiFile size={64} />
                  <p>Preview not available for this file type</p>
                  <button className="preview-dl-btn" onClick={handleDownload}>Download file</button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="preview-footer">
          <span className="preview-meta">{doc.fileType?.split("/")[1]?.toUpperCase() || "FILE"}</span>
          <span className="preview-meta">{doc.category || "Uncategorized"}</span>
          {doc.caseEntity && <span className="preview-meta">Case: {doc.caseEntity.caseNumber}</span>}
          {doc.version > 1 && <span className="preview-meta">v{doc.version}</span>}
        </div>
      </div>
    </div>
  );
}
