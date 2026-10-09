// File types a document upload accepts. Kept in step with the server's list in
// documents/storage.py (ALLOWED_EXTENSIONS), which refuses anything else; the
// pickers use this so people only see files they can actually upload.
export const DOCUMENT_EXTENSIONS = [
  ".pdf", ".doc", ".docx", ".odt", ".rtf", ".txt",
  ".xls", ".xlsx", ".ods", ".csv",
  ".ppt", ".pptx", ".odp",
  ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".heic",
  ".eml", ".msg",
  ".zip",
];

/** For <input type="file" accept={DOCUMENT_ACCEPT}>. */
export const DOCUMENT_ACCEPT = DOCUMENT_EXTENSIONS.join(",");

export const DOCUMENT_TYPES_LABEL = "PDF, Word, Excel, PowerPoint, text, images (JPG, PNG, TIFF), emails (EML, MSG) or ZIP";

export function isAllowedDocument(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && DOCUMENT_EXTENSIONS.includes(name.slice(dot).toLowerCase());
}
