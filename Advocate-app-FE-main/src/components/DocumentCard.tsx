// A document as a Red Tape tile (sheet with an extension badge), plus the shared
// per-document action menu used by both the grid and the list view.
import { useState } from "react";
import { Button, Chip, PopMenu, type IconName, type MenuItem } from "../ui/kit";
import { Switch } from "../ui/forms";
import "../ui/pages/clients.css";

const ICONS: Record<string, IconName> = {
  pdf: "file", doc: "file", docx: "file", txt: "note",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image",
  zip: "zip", rar: "zip", "7z": "zip",
};

// Short extension for the badge: from the file name first, then the MIME type.
export function fileExt(doc: any): string {
  const fromName = String(doc?.originalName || "").split(".").pop() || "";
  if (fromName && fromName.length <= 5 && fromName !== doc?.originalName) return fromName.toLowerCase();
  const t = String(doc?.fileType || "");
  if (t.includes("wordprocessingml")) return "docx";
  if (t.includes("msword")) return "doc";
  const sub = t.split("/")[1] || "";
  return sub && sub.length <= 5 ? sub.toLowerCase() : "file";
}

export function getFileIcon(doc: any): IconName {
  return ICONS[fileExt(doc)] || "file";
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export const shortDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";

export interface DocHandlers {
  onPreview: (doc: any) => void;
  onDownload: (doc: any) => void;
  onDelete?: (doc: any) => void;
  onEdit?: (doc: any) => void;
  onSummary?: (doc: any) => void;
  onVersions?: (doc: any) => void;
  onShareToggle?: (doc: any) => void;
  onUseInDraft?: (doc: any) => void;
}

// Shared in the client portal? Only offered when the doc is on a case or client.
export const canShare = (doc: any, h: DocHandlers) => !!(h.onShareToggle && (doc.caseEntity || doc.client));

export function docMenu(doc: any, h: DocHandlers): MenuItem[] {
  // Drafting reads PDF and Word files only.
  const draftable = h.onUseInDraft && /pdf|word|docx?$/i.test(`${doc.fileType || ""} ${doc.originalName || doc.documentName || ""}`);
  const items: MenuItem[] = [
    { label: "Preview", icon: "eye", onClick: () => h.onPreview(doc) },
    { label: "Download", icon: "download", onClick: () => h.onDownload(doc) },
  ];
  if (h.onSummary) items.push({ label: "AI summary", icon: "sparkle", onClick: () => h.onSummary!(doc) });
  if (h.onVersions) items.push({ label: "Versions / upload new", icon: "history", onClick: () => h.onVersions!(doc) });
  if (draftable) items.push({ label: "Use in a draft", icon: "pen", onClick: () => h.onUseInDraft!(doc) });
  if (h.onEdit) items.push({ label: "Edit details", icon: "edit", onClick: () => h.onEdit!(doc) });
  if (canShare(doc, h)) {
    items.push({ label: doc.clientVisible ? "Stop sharing with client" : "Share with client", icon: "globe", onClick: () => h.onShareToggle!(doc) });
  }
  if (h.onDelete) items.push("-", { label: "Delete", icon: "trash", danger: true, onClick: () => h.onDelete!(doc) });
  return items;
}

/** The "more" button that opens the document's action menu. */
export function DocumentActions({ doc, className, ...h }: DocHandlers & { doc: any; className?: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button size="sm" variant="ghost" iconOnly icon="more" className={className} aria-label={`Actions for ${doc.documentName}`}
        aria-haspopup="menu" aria-expanded={!!anchor}
        onClick={(e) => { e.stopPropagation(); setAnchor(anchor ? null : e.currentTarget); }} />
      {anchor && <PopMenu anchor={anchor} items={docMenu(doc, h)} onClose={() => setAnchor(null)} align="right" />}
    </>
  );
}

export default function DocumentCard(props: DocHandlers & { doc: any; className?: string; showShare?: boolean }) {
  const { doc, className, showShare = true, ...h } = props;
  return (
    <div className={`p3-tile-wrap${className ? " " + className : ""}`}>
      <button type="button" className="doc-tile" onClick={() => h.onPreview(doc)} aria-label={`Preview ${doc.documentName}`}>
        <div className="sheet" aria-hidden="true">
          <span className="ext">{fileExt(doc)}</span>
          <div className="pg">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</div>
        </div>
        <div className="body">
          <div className="name" title={doc.documentName}>{doc.documentName}</div>
          <div className="mono xs faint ellipsis" style={{ marginTop: 4 }}>
            {doc.caseEntity?.caseNumber || doc.client?.name || "Not linked"}
          </div>
          <div className="row between xs muted" style={{ marginTop: 6 }}>
            <span className="ellipsis">{doc.category || "Other"}</span><span className="mono">v{doc.version || 1}</span>
          </div>
          <div className="row between xs faint" style={{ marginTop: 6, gap: 6 }}>
            <span>{formatBytes(doc.fileSize)}, {shortDate(doc.uploadDate)}</span>
            {doc.clientVisible && <Chip tone="ok">Shared</Chip>}
            {doc.status === "ARCHIVED" && <Chip>Archived</Chip>}
          </div>
        </div>
      </button>
      <DocumentActions doc={doc} {...h} className="p3-tile-more" />
      {(h.onSummary || (showShare && canShare(doc, h))) && (
        <div className="p3-tile-foot">
          {h.onSummary && <Button size="sm" icon="sparkle" onClick={() => h.onSummary!(doc)}>Summary</Button>}
          {showShare && canShare(doc, h) && (
            <Switch className="xs" label="Shared with client" checked={!!doc.clientVisible} onChange={() => h.onShareToggle!(doc)} />
          )}
        </div>
      )}
    </div>
  );
}
