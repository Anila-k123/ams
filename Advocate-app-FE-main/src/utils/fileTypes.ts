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

/** Largest upload the server accepts (DOCUMENT_MAX_UPLOAD_MB in settings.py). */
export const MAX_UPLOAD_MB = 25;

/** Why a file can't be uploaded, or null when it can. */
export function documentProblem(file: File): string | null {
  if (!isAllowedDocument(file.name)) return `${file.name} can't be uploaded. Use ${DOCUMENT_TYPES_LABEL}.`;
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return `${file.name} is ${(file.size / 1048576).toFixed(1)} MB. Files can be at most ${MAX_UPLOAD_MB} MB.`;
  }
  return null;
}

export function isAllowedDocument(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot > 0 && DOCUMENT_EXTENSIONS.includes(name.slice(dot).toLowerCase());
}
