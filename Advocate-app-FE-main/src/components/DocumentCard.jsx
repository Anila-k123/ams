import React from "react";
import { FiFile, FiFileText, FiImage, FiArchive, FiDownload, FiEye, FiTrash2, FiEdit2 } from "react-icons/fi";

const CATEGORY_COLORS = {
  "Court Order": "#6366f1", "Petition": "#f59e0b", "Evidence": "#10b981",
  "Agreement": "#3b82f6", "Affidavit": "#8b5cf6", "Notice": "#ef4444",
  "Judgment": "#ec4899", "Invoice": "#14b8a6", "Payment Receipt": "#22c55e",
  "Identity Proof": "#f97316", "Address Proof": "#0ea5e9", "Other": "#6b7280",
};

const FILE_ICONS = {
  pdf: FiFileText, doc: FiFileText, docx: FiFileText,
  png: FiImage, jpg: FiImage, jpeg: FiImage, gif: FiImage, webp: FiImage,
  zip: FiArchive, rar: FiArchive, "7z": FiArchive,
};

function getFileIcon(fileType) {
  if (!fileType) return FiFile;
  const ext = fileType.split("/")[1] || fileType.split(".").pop() || "";
  return FILE_ICONS[ext.toLowerCase()] || FiFile;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function DocumentCard({ doc, onPreview, onDownload, onDelete, onEdit, gridView, className }) {
  const Icon = getFileIcon(doc.fileType);
  const catColor = CATEGORY_COLORS[doc.category] || CATEGORY_COLORS["Other"];

  if (gridView) {
    return (
      <div className={`doc-card${className ? " " + className : ""}`} title={doc.documentName}>
        <div className="doc-card-icon" style={{ backgroundColor: catColor + "18" }}>
          <Icon size={36} color={catColor} />
        </div>
        <div className="doc-card-info">
          <div className="doc-card-name">{doc.documentName}</div>
          <div className="doc-card-meta">
            <span className="doc-card-category" style={{ backgroundColor: catColor + "20", color: catColor }}>
              {doc.category || "Other"}
            </span>
            <span className="doc-card-size">{formatBytes(doc.fileSize)}</span>
          </div>
          {doc.caseEntity && (
            <div className="doc-card-case">Case: {doc.caseEntity.caseNumber}</div>
          )}
          {doc.client && (
            <div className="doc-card-client">Client: {doc.client.name}</div>
          )}
          <div className="doc-card-footer">
            <span className="doc-card-version">v{doc.version}</span>
            <span className="doc-card-date">{new Date(doc.uploadDate).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="doc-card-actions">
          <button onClick={() => onPreview(doc)} title="Preview"><FiEye /></button>
          <button onClick={() => onDownload(doc)} title="Download"><FiDownload /></button>
          {onEdit && <button onClick={() => onEdit(doc)} title="Edit"><FiEdit2 /></button>}
          <button onClick={() => onDelete(doc)} title="Delete"><FiTrash2 /></button>
        </div>
      </div>
    );
  }

  return (
    <tr className={className || ""}>
      <td>
        <div className="doc-list-name">
          <Icon size={18} color={catColor} style={{ flexShrink: 0 }} />
          <div>
            <strong>{doc.documentName}</strong>
            {doc.version > 1 && <span className="doc-list-version"> v{doc.version}</span>}
          </div>
        </div>
      </td>
      <td><span className="doc-card-category" style={{ backgroundColor: catColor + "20", color: catColor }}>{doc.category || "Other"}</span></td>
      <td>{formatBytes(doc.fileSize)}</td>
      <td>{doc.caseEntity?.caseNumber || "-"}</td>
      <td>{doc.client?.name || "-"}</td>
      <td>{new Date(doc.uploadDate).toLocaleDateString()}</td>
      <td><span className={`doc-status-badge ${(doc.status || "ACTIVE").toLowerCase()}`}>{doc.status || "ACTIVE"}</span></td>
      <td className="actions-cell">
        <button className="icon-btn-action view" onClick={() => onPreview(doc)} title="Preview"><FiEye /></button>
        <button className="icon-btn-action download" onClick={() => onDownload(doc)} title="Download"><FiDownload /></button>
        {onEdit && <button className="icon-btn-action edit" onClick={() => onEdit(doc)} title="Edit"><FiEdit2 /></button>}
        <button className="icon-btn-action delete" onClick={() => onDelete(doc)} title="Delete"><FiTrash2 /></button>
      </td>
    </tr>
  );
}
