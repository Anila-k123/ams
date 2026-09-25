import { Button } from "primereact/button";

export const CATEGORY_COLORS: Record<string, string> = {
  "Court Order": "#6366f1", "Petition": "#f59e0b", "Evidence": "#10b981",
  "Agreement": "#3b82f6", "Affidavit": "#8b5cf6", "Notice": "#ef4444",
  "Judgment": "#ec4899", "Invoice": "#14b8a6", "Payment Receipt": "#22c55e",
  "Identity Proof": "#f97316", "Address Proof": "#0ea5e9", "Other": "#6b7280",
};

const FILE_ICONS: Record<string, string> = {
  pdf: "pi-file-pdf", doc: "pi-file-word", docx: "pi-file-word",
  png: "pi-image", jpg: "pi-image", jpeg: "pi-image", gif: "pi-image", webp: "pi-image",
  zip: "pi-box", rar: "pi-box", "7z": "pi-box",
};

export function getFileIcon(fileType?: string): string {
  if (!fileType) return "pi-file";
  const ext = fileType.split("/")[1] || fileType.split(".").pop() || "";
  return FILE_ICONS[ext.toLowerCase()] || "pi-file";
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export const categoryColor = (doc: any) => CATEGORY_COLORS[doc.category] || CATEGORY_COLORS["Other"];

export function CategoryChip({ doc }: { doc: any }) {
  const c = categoryColor(doc);
  return (
    <span className="doc-card-category" style={{ backgroundColor: c + "20", color: c }}>
      {doc.category || "Other"}
    </span>
  );
}

export interface DocHandlers {
  onPreview: (doc: any) => void;
  onDownload: (doc: any) => void;
  onDelete?: (doc: any) => void;
  onEdit?: (doc: any) => void;
  onSummary?: (doc: any) => void;
  onVersions?: (doc: any) => void;
  onShareToggle?: (doc: any) => void;
}

/** The per-document icon actions, shared by the grid card and the list table. */
export function DocumentActions({ doc, onPreview, onDownload, onDelete, onEdit, onVersions, onShareToggle }: DocHandlers & { doc: any }) {
  // Shared in the client portal? Only offered when the doc is on a case/client.
  const canShare = onShareToggle && (doc.caseEntity || doc.client);
  const btn = "p-button-rounded p-button-text p-button-sm";
  return (
    <div className="doc-card-actions flex align-items-center gap-1">
      <Button icon="pi pi-eye" className={btn} onClick={() => onPreview(doc)} tooltip="Preview" tooltipOptions={{ position: "top" }} aria-label="Preview" />
      <Button icon="pi pi-download" className={btn} onClick={() => onDownload(doc)} tooltip="Download" tooltipOptions={{ position: "top" }} aria-label="Download" />
      {onVersions && <Button icon="pi pi-clone" className={btn} onClick={() => onVersions(doc)} tooltip="Versions / upload new" tooltipOptions={{ position: "top" }} aria-label="Versions" />}
      {canShare && (
        <Button icon="pi pi-users" label={doc.clientVisible ? "Shared" : undefined}
          className={`${btn}${doc.clientVisible ? " p-button-success" : ""}`}
          onClick={() => onShareToggle!(doc)} aria-pressed={!!doc.clientVisible}
          tooltip={doc.clientVisible ? "Shared with the client in the portal — click to stop sharing" : "Share with the client in the portal"}
          tooltipOptions={{ position: "top" }} />
      )}
      {onEdit && <Button icon="pi pi-pencil" className={btn} onClick={() => onEdit(doc)} tooltip="Edit" tooltipOptions={{ position: "top" }} aria-label="Edit" />}
      {onDelete && <Button icon="pi pi-trash" className={`${btn} p-button-danger`} onClick={() => onDelete(doc)} tooltip="Delete" tooltipOptions={{ position: "top" }} aria-label="Delete" />}
    </div>
  );
}

export default function DocumentCard(props: DocHandlers & { doc: any; className?: string }) {
  const { doc, onSummary, onVersions, className } = props;
  const catColor = categoryColor(doc);

  return (
    <div className={`doc-card${className ? " " + className : ""}`} title={doc.documentName}>
      <div className="doc-card-icon" style={{ backgroundColor: catColor + "18" }}>
        <i className={`pi ${getFileIcon(doc.fileType)}`} style={{ fontSize: 36, color: catColor }} />
      </div>
      <div className="doc-card-info">
        <div className="doc-card-name">{doc.documentName}</div>
        <div className="doc-card-meta">
          <CategoryChip doc={doc} />
          <span className="doc-card-size">{formatBytes(doc.fileSize)}</span>
        </div>
        {doc.caseEntity && <div className="doc-card-sub">Case: {doc.caseEntity.caseNumber}</div>}
        {doc.client && <div className="doc-card-sub">Client: {doc.client.name}</div>}
        <div className="doc-card-footer">
          {onVersions ? (
            <button type="button" className="doc-card-version doc-card-version-btn" onClick={() => onVersions(doc)} title="Version history">
              <i className="pi pi-clone" style={{ fontSize: 10 }} /> v{doc.version}
            </button>
          ) : (
            <span className="doc-card-version">v{doc.version}</span>
          )}
          <span>{new Date(doc.uploadDate).toLocaleDateString()}</span>
        </div>
      </div>
      {onSummary && (
        <Button icon="pi pi-bolt" label="See Summary" className="p-button-outlined p-button-sm w-full" onClick={() => onSummary(doc)} />
      )}
      <DocumentActions {...props} />
    </div>
  );
}
