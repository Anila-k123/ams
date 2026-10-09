// Documents: every file across the practice's matters. Grid of tiles or a list,
// filtered by category, case, status and type; preview, versions, AI summary and
// sharing with the client in the portal.
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DRAFTING } from "./Drafting/routes";
import documentService from "../services/DocumentService";
import DocumentCard, { DocumentActions, formatBytes, getFileIcon, shortDate } from "../components/DocumentCard";
import FilePreviewModal from "../components/FilePreviewModal";
import DocumentSummaryModal from "../components/DocumentSummaryModal";
import DocumentVersionsModal from "../components/DocumentVersionsModal";
import { useLoading } from "../contexts/LoadingContext";
import { usePermission } from "../contexts/PermissionContext";
import { useToast } from "../contexts/ToastContext";
import api from "../api/client";
import { usePageModal } from "../utils/pageModal";
import { Button, Chip, EmptyState, Icon, PageHead, Skel } from "../ui/kit";
import { FilterChip, SearchInput, Segmented, SelectField, TextArea, TextField } from "../ui/forms";
import { Modal, confirm } from "../ui/overlays";
import { DataTable, type Column } from "../ui/DataTable";
import "../ui/pages/clients.css";
import { DOCUMENT_ACCEPT, DOCUMENT_TYPES_LABEL, isAllowedDocument } from "../utils/fileTypes";

const CATEGORIES = [
  "Court Order", "Petition", "Evidence", "Agreement", "Affidavit",
  "Notice", "Judgment", "Invoice", "Payment Receipt",
  "Identity Proof", "Address Proof", "Other"
];

// Filter by kind of file, not one exact MIME type: the same kind arrives under
// several (a ZIP from Windows is "application/x-zip-compressed"). The backend
// (documents/views.py FILE_KINDS) and matchesKind below use the same rules.
const FILE_TYPE_OPTIONS = [
  { value: "pdf", label: "PDF" },
  { value: "image", label: "Images" },
  { value: "doc", label: "DOC" },
  { value: "docx", label: "DOCX" },
  { value: "zip", label: "ZIP" },
];
const FILE_KINDS: Record<string, { mimes: string[]; exts: string[] }> = {
  pdf: { mimes: ["application/pdf"], exts: [".pdf"] },
  image: { mimes: ["image/"], exts: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tif", ".tiff"] },
  doc: { mimes: ["application/msword"], exts: [".doc"] },
  docx: { mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml"], exts: [".docx"] },
  zip: { mimes: ["application/zip", "application/x-zip", "application/x-zip-compressed", "multipart/x-zip"], exts: [".zip"] },
};
const matchesKind = (d: any, kind: string) => {
  const k = FILE_KINDS[kind];
  if (!k) return true;
  const type = String(d.fileType || "").toLowerCase();
  const name = String(d.originalName || d.documentName || "").toLowerCase();
  return k.mimes.some((m) => type.startsWith(m)) || k.exts.some((e) => name.endsWith(e));
};

const PAGE_SIZE = 20;
const emptyUploadOptions = { category: "", caseId: "", clientId: "", documentName: "", description: "" };

export default function DocumentsPanel() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchText, setSearchText] = useState("");
  const [highlightedId, setHighlightedId] = useState<any>(null);
  const location = useLocation();
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [selectedFileType, setSelectedFileType] = useState("");
  // Filtering by case reads that case's files (the list endpoint has no case filter).
  const [selectedCase, setSelectedCase] = useState("");
  const [sharedOnly, setSharedOnly] = useState(false);
  const [page, setPage] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [summaryDoc, setSummaryDoc] = useState<any>(null);
  const [versionsDoc, setVersionsDoc] = useState<any>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadOptions, setUploadOptions] = useState<any>(emptyUploadOptions);
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState<any[]>([]);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [dragOver, setDragOver] = useState(false);
  const [editDoc, setEditDoc] = useState<any>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchedFromGlobalNav = useRef(!!(location.state as any)?.search);
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const toast = useToast();
  const { withLoading } = useLoading();

  // Share / stop sharing a document with the client in the client portal.
  const handleShareToggle = async (doc: any) => {
    try {
      const r = await api.put(`/api/documents/${doc.id}/client-visible`, { visible: !doc.clientVisible });
      setDocuments((prev) => prev.map((d) => (d.id === doc.id ? { ...d, clientVisible: r.data.clientVisible } : d)));
      toast.success(r.data.clientVisible ? `"${doc.documentName}" is now visible to the client.` : `"${doc.documentName}" is no longer shared.`);
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Could not change sharing.");
    }
  };

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      if (selectedCase) {
        const all: any[] = (await (documentService as any).getDocumentsByCase(selectedCase)) || [];
        const kw = searchText.trim().toLowerCase();
        const rows = all.filter((d) =>
          (!kw || `${d.documentName} ${d.originalName || ""} ${d.category || ""} ${d.description || ""}`.toLowerCase().includes(kw))
          && (!selectedCategory || d.category === selectedCategory)
          && (!selectedStatus || (d.status || "ACTIVE") === selectedStatus)
          && (!selectedFileType || matchesKind(d, selectedFileType)));
        setTotalElements(rows.length);
        setDocuments(rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE));
        return;
      }
      const data = await (documentService as any).fetchDocuments({
        page, size: PAGE_SIZE, keyword: searchText || undefined,
        category: selectedCategory || undefined,
        status: selectedStatus || undefined,
        fileType: selectedFileType || undefined,
        sortBy: "uploadDate", sortDir: "desc"
      });
      if (data) {
        setDocuments(data.content || []);
        setTotalElements(data.totalElements || 0);
      }
    } catch (err) {
      console.error("Error fetching documents:", err);
      setError("Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [page, searchText, selectedCategory, selectedStatus, selectedFileType, selectedCase]);

  const fetchCases = useCallback(async () => {
    try {
      const res = await api.get("/api/cases/my-cases");
      setCases(res.data || []);
    } catch (err) {
      console.error("Error fetching cases:", err);
    }
  }, []);

  const fetchStats = useCallback(() => {
    (documentService as any).getStats().then(setStats).catch(() => { /* the line just hides */ });
  }, []);

  useEffect(() => {
    if (searchedFromGlobalNav.current) {
      searchedFromGlobalNav.current = false;
      return;
    }
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => { fetchCases(); fetchStats(); }, [fetchCases, fetchStats]);

  // AI Assistant: search
  useEffect(() => {
    const handleSearch = (e: any) => {
      if (e.detail?.query) setSearchText(e.detail.query);
    };
    window.addEventListener("assistant-search", handleSearch);
    return () => {
      window.removeEventListener("assistant-search", handleSearch);
    };
  }, []);

  const openUpload = () => {
    setShowUploadModal(true);
    setUploadResults([]);
    setUploadProgress({ current: 0, total: 0 });
  };

  // Quick Actions / Lisa: open the upload dialog.
  usePageModal(["create-document", "upload-document"], openUpload);

  // Global Search navigation — read incoming state
  useEffect(() => {
    const st = location.state as any;
    if (st?.search) {
      setSearchText(st.search);
      setHighlightedId(st.id || null);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Scroll the highlighted document (from global search) into view.
  useEffect(() => {
    if (highlightedId == null) return;
    requestAnimationFrame(() => document.querySelector(".dc-body .highlight-row")
      ?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [documents, highlightedId]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => setPage(0), 400);
    return () => clearTimeout(timer);
  }, [searchText, selectedCategory, selectedStatus, selectedFileType, selectedCase]);

  const clearFilters = () => {
    setSearchText("");
    setSelectedCategory("");
    setSelectedStatus("");
    setSelectedFileType("");
    setSelectedCase("");
    setSharedOnly(false);
    setPage(0);
  };

  const hasFilters = !!(searchText || selectedCategory || selectedStatus || selectedFileType || selectedCase || sharedOnly);

  // Only allowed document types join the upload list (utils/fileTypes); a dropped
  // web page or script is left out with a message. The server refuses them too.
  const addFiles = (files: File[]) => {
    const ok = files.filter((f) => isAllowedDocument(f.name));
    const refused = files.filter((f) => !isAllowedDocument(f.name));
    if (refused.length) {
      toast.error(`${refused.map((f) => f.name).join(", ")} can't be uploaded. Use ${DOCUMENT_TYPES_LABEL}.`);
    }
    if (ok.length) setUploadFiles((prev) => [...prev, ...ok]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files || []));
    e.target.value = "";
  };

  const removeUploadFile = (index: number) => setUploadFiles((prev) => prev.filter((_, i) => i !== index));

  const handleUpload = async () => {
    if (uploadFiles.length === 0) return;
    setUploading(true);
    setUploadResults([]);

    const results: any[] = await withLoading(
      (documentService as any).uploadMultiple(
        uploadFiles,
        {
          caseId: uploadOptions.caseId || undefined,
          clientId: uploadOptions.clientId || undefined,
          category: uploadOptions.category || undefined,
          documentName: uploadOptions.documentName || undefined,
          description: uploadOptions.description || undefined,
        },
        (progress: any) => setUploadProgress(progress)
      ),
      "Uploading Document..."
    );

    setUploadResults(results);
    if (results.every((r) => r.success)) {
      setTimeout(() => {
        setShowUploadModal(false);
        setUploadFiles([]);
        setUploadOptions(emptyUploadOptions);
        fetchDocuments();
        fetchStats();
      }, 1500);
    }
    setUploading(false);
  };

  const handleDownload = async (doc: any) => {
    try {
      const { blob, filename } = await (documentService as any).downloadDocument(doc.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download error:", err);
      // Action errors are toasts (they clear themselves); the banner is for page-load failures.
      toast.error("Failed to download file. It may be missing on the server.");
    }
  };

  const askDelete = (doc: any) => confirm({
    title: "Delete this document?",
    message: <><b>{doc.documentName}</b> and its version history will be permanently removed. This can&apos;t be undone.</>,
    confirmLabel: "Delete document",
    danger: true,
    accept: async () => {
      try {
        await withLoading((documentService as any).deleteDocument(doc.id), "Deleting Document...");
        fetchDocuments();
        fetchStats();
      } catch (err) {
        console.error("Delete error:", err);
        toast.error("Failed to delete document.");
      }
    },
  });

  const saveEdit = async () => {
    if (!editDoc) return;
    try {
      await withLoading(
        (documentService as any).updateDocument(editDoc.id, {
          documentName: editDoc.documentName,
          category: editDoc.category,
          description: editDoc.description,
        }),
        "Updating Document..."
      );
      setEditDoc(null);
      fetchDocuments();
    } catch (err) {
      console.error("Update error:", err);
      toast.error("Failed to update document.");
    }
  };

  const handlers = {
    onPreview: setPreviewDoc,
    onSummary: setSummaryDoc,
    onVersions: setVersionsDoc,
    onDownload: handleDownload,
    onDelete: hasPermission("DOCUMENT_DELETE") ? askDelete : undefined,
    onEdit: hasPermission("DOCUMENT_EDIT") ? setEditDoc : undefined,
    onShareToggle: hasPermission("DOCUMENT_EDIT") ? handleShareToggle : undefined,
    // Opens Draft Documents, where the file is prepared for drafting.
    onUseInDraft: hasPermission("DRAFT_VIEW") ? () => navigate(DRAFTING.samples) : undefined,
  };

  // "Shared with client" narrows the page already loaded (the API has no such filter).
  const shown = useMemo(() => (sharedOnly ? documents.filter((d) => d.clientVisible) : documents), [documents, sharedOnly]);

  const categoryOptions = CATEGORIES.map((c) => ({ value: c, label: c }));
  const caseOptions = cases.map((c) => ({ value: c.id, label: `${c.caseNumber} — ${c.caseTitle}` }));
  const pages = Math.max(1, Math.ceil(totalElements / PAGE_SIZE));

  const columns: Column<any>[] = [
    { key: "documentName", label: "Name", render: (d) => (
      <div className="row" style={{ gap: 8, minWidth: 0 }}>
        <Icon name={getFileIcon(d)} size="sm" />
        <span className="cell-title ellipsis" style={{ maxWidth: 280 }} title={d.documentName}>{d.documentName}</span>
      </div>
    ) },
    { key: "category", label: "Category", hideSm: true, render: (d) => d.category || "Other" },
    { key: "case", label: "Case", render: (d) => d.caseEntity?.caseNumber ? <span className="mono small">{d.caseEntity.caseNumber}</span> : <span className="faint">None</span> },
    { key: "client", label: "Client", hideSm: true, render: (d) => d.client?.name || <span className="faint">None</span> },
    { key: "fileSize", label: "Size", align: "right", hideSm: true, render: (d) => <span className="mono xs">{formatBytes(d.fileSize)}</span> },
    { key: "uploadDate", label: "Uploaded", hideSm: true, render: (d) => shortDate(d.uploadDate) },
    { key: "version", label: "Version", hideSm: true, render: (d) => (
      <button type="button" className="btn ghost sm mono" onClick={(e) => { e.stopPropagation(); setVersionsDoc(d); }} title="Version history">v{d.version || 1}</button>
    ) },
    { key: "shared", label: "Shared", render: (d) => d.clientVisible ? <Chip tone="ok">Shared</Chip> : <span className="faint small">Private</span> },
    { key: "status", label: "Status", hideSm: true, render: (d) => (d.status || "ACTIVE") === "ACTIVE" ? <Chip tone="ok">Active</Chip> : <Chip>Archived</Chip> },
    { key: "a", label: <span className="sr-only">Actions</span>, align: "right", render: (d) => (
      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
        <Button size="sm" variant="ghost" icon="sparkle" onClick={() => setSummaryDoc(d)}>Summary</Button>
        <DocumentActions doc={d} {...handlers} />
      </div>
    ) },
  ];

  const total = stats?.totalDocuments ?? totalElements;

  return (
    <div>
      <PageHead title="Documents" sub="Pleadings, orders, evidence and client papers across all matters."
        actions={hasPermission("DOCUMENT_UPLOAD") && <Button variant="primary" icon="upload" onClick={openUpload}>Upload</Button>} />

      <div className="p3-storage">
        <span><b className="num">{total}</b> file{total !== 1 ? "s" : ""}{stats && <>, <b className="num">{formatBytes(stats.totalStorageBytes)}</b> stored</>}</span>
      </div>

      {error && (
        <div className="callout bad" style={{ marginBottom: "var(--s4)" }}>
          <Icon name="warn" size="sm" /><span className="grow">{error}</span>
          <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => setError("")} aria-label="Dismiss"><Icon name="x" size="sm" /></button>
        </div>
      )}

      <div className="toolbar">
        <SearchInput value={searchText} onChange={setSearchText} placeholder="Search file, case or client" aria-label="Search documents" />
        <select className="input" aria-label="Category" value={selectedCategory} onChange={(e) => { setSelectedCategory(e.target.value); setPage(0); }}>
          <option value="">Category: All</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input" aria-label="Case" value={selectedCase} onChange={(e) => { setSelectedCase(e.target.value); setPage(0); }} style={{ maxWidth: 220 }}>
          <option value="">Case: All</option>
          {cases.map((c) => <option key={c.id} value={c.id}>{c.caseNumber}</option>)}
        </select>
        <select className="input" aria-label="Type" value={selectedFileType} onChange={(e) => { setSelectedFileType(e.target.value); setPage(0); }}>
          <option value="">Type: All</option>
          {FILE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select className="input" aria-label="Status" value={selectedStatus} onChange={(e) => { setSelectedStatus(e.target.value); setPage(0); }}>
          <option value="">Status: All</option>
          <option value="ACTIVE">Active</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <FilterChip on={sharedOnly} onClick={() => setSharedOnly((v) => !v)}><Icon name="globe" size="sm" />Shared with client</FilterChip>
        {hasFilters && <Button variant="ghost" size="sm" icon="x" onClick={clearFilters}>Clear</Button>}
        <span className="grow" />
        <Segmented<"grid" | "list"> label="View" value={viewMode} onChange={setViewMode} options={[
          { value: "grid", icon: "grid", label: <span className="sr-only">Grid</span> },
          { value: "list", icon: "rows", label: <span className="sr-only">List</span> },
        ]} />
      </div>

      <div className="dc-body">
        {viewMode === "grid" ? (
          loading && documents.length === 0 ? (
            <div className="doc-grid">{Array.from({ length: 8 }, (_, i) => <Skel key={i} h={220} />)}</div>
          ) : shown.length === 0 ? (
            <EmptyState icon="folder" title={hasFilters ? "No documents match" : "No documents yet"}
              text={hasFilters ? "Try another category or type, or clear the filters." : "Upload pleadings, orders and client papers to keep them with the matter."}
              action={hasFilters ? <Button size="sm" onClick={clearFilters}>Clear filters</Button>
                : hasPermission("DOCUMENT_UPLOAD") ? <Button size="sm" variant="primary" icon="upload" onClick={openUpload}>Upload</Button> : undefined} />
          ) : (
            <div className="doc-grid">
              {shown.map((doc) => (
                <DocumentCard key={doc.id} doc={doc} {...handlers} className={highlightedId === doc.id ? "highlight-row" : undefined} />
              ))}
            </div>
          )
        ) : (
          <DataTable rows={shown} columns={columns} rowKey={(d) => d.id} loading={loading && documents.length === 0}
            onRow={(d) => setPreviewDoc(d)} pageSize={0} caption="Documents"
            rowClass={(d) => (highlightedId === d.id ? "highlight-row" : undefined)}
            empty={{ icon: "folder", title: "No documents match", text: "Clear the filters above to see everything." }} />
        )}
      </div>

      {totalElements > PAGE_SIZE && (
        <div className="row between wrap" style={{ marginTop: "var(--s4)", gap: "var(--s3)" }}>
          <span className="faint small">Page {page + 1} of {pages}, {totalElements} files</span>
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" icon="chevronLeft" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
            <Button size="sm" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next<Icon name="chevron" size="sm" /></Button>
          </div>
        </div>
      )}

      {/* Upload */}
      <Modal open={showUploadModal} title="Upload documents" sub={`${DOCUMENT_TYPES_LABEL}, up to 25 MB each.`}
        onClose={() => { if (!uploading) setShowUploadModal(false); }} dismissable={!uploading}
        footer={<>
          <Button variant="ghost" onClick={() => setShowUploadModal(false)} disabled={uploading}>Cancel</Button>
          <Button variant="primary" icon="upload" onClick={handleUpload} disabled={uploadFiles.length === 0 || uploading} loading={uploading}>
            {uploading ? `Uploading (${uploadProgress.current}/${uploadProgress.total})` : `Upload ${uploadFiles.length} file${uploadFiles.length !== 1 ? "s" : ""}`}
          </Button>
        </>}>
        <div className="stack">
          <button type="button" className={`dropzone${dragOver ? " over" : ""}`}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}>
            <Icon name="upload" size="lg" />
            <div style={{ marginTop: 8 }}><b>Drop files here</b> or click to browse</div>
            <div className="faint xs" style={{ marginTop: 4 }}>You can add several files at once.</div>
          </button>
          <input ref={fileInputRef} type="file" accept={DOCUMENT_ACCEPT} multiple hidden onChange={handleFileSelect} aria-label="Choose files" />

          {uploadFiles.length > 0 && (
            <div className="dc-files">
              {uploadFiles.map((file, i) => (
                <div key={i} className="dc-file">
                  <Icon name="file" size="sm" />
                  <span className="grow ellipsis" title={file.name}>{file.name}</span>
                  <span className="faint xs mono">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                  {!uploading && (
                    <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => removeUploadFile(i)} aria-label={`Remove ${file.name}`}>
                      <Icon name="x" size="sm" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="form-grid">
            <SelectField label="Category" value={uploadOptions.category} options={categoryOptions} placeholder="Select category"
              onChange={(e) => setUploadOptions((o: any) => ({ ...o, category: e.target.value }))} />
            <SelectField label="Link to case" value={uploadOptions.caseId} options={caseOptions} placeholder="Not linked (optional)"
              onChange={(e) => setUploadOptions((o: any) => ({ ...o, caseId: e.target.value }))} />
            <TextField full label="Document name" hint="Optional. Defaults to the file name." value={uploadOptions.documentName}
              onChange={(e) => setUploadOptions((o: any) => ({ ...o, documentName: e.target.value }))} />
          </div>

          {uploadProgress.total > 0 && (
            <div>
              <div className="meter" role="progressbar" aria-label="Upload progress" aria-valuemin={0} aria-valuemax={100}
                aria-valuenow={Math.round((uploadProgress.current / uploadProgress.total) * 100)}>
                <i style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%`, background: "var(--ink)" }} />
              </div>
              <div className="faint xs" style={{ marginTop: 4 }}>{uploadProgress.current}/{uploadProgress.total} uploaded</div>
            </div>
          )}

          {uploadResults.length > 0 && (
            <div className="dc-files" role="status">
              {uploadResults.map((r, i) => (
                <div key={i} className={`dc-result ${r.success ? "ok" : "bad"}`}>
                  <Icon name={r.success ? "ok" : "warn"} size="sm" /> {r.file}
                  {!r.success && <span> — {r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {previewDoc && (
        <FilePreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} onDownload={handleDownload}
          onSummary={handlers.onSummary} onVersions={handlers.onVersions} onEdit={handlers.onEdit}
          onShareToggle={handlers.onShareToggle && ((d: any) => {
            handlers.onShareToggle!(d);
            // Keep the open drawer's "Shared" chip in step with the toggle.
            setPreviewDoc((p: any) => (p && p.id === d.id ? { ...p, clientVisible: !p.clientVisible } : p));
          })} />
      )}

      {summaryDoc && (
        <DocumentSummaryModal doc={summaryDoc} onClose={() => setSummaryDoc(null)} canRegenerate={hasPermission("DOCUMENT_EDIT")} />
      )}

      {versionsDoc && (
        <DocumentVersionsModal doc={versionsDoc} onClose={() => setVersionsDoc(null)}
          canUpload={hasPermission("DOCUMENT_UPLOAD")} onUpdated={fetchDocuments} />
      )}

      {/* Edit details */}
      <Modal open={!!editDoc} title="Edit document" size="narrow" onClose={() => setEditDoc(null)}
        footer={<>
          <Button variant="ghost" onClick={() => setEditDoc(null)}>Cancel</Button>
          <Button variant="primary" icon="check" onClick={saveEdit}>Save changes</Button>
        </>}>
        {editDoc && (
          <div className="stack">
            <TextField label="Document name" required value={editDoc.documentName || ""}
              onChange={(e) => setEditDoc((d: any) => ({ ...d, documentName: e.target.value }))} />
            <SelectField label="Category" value={editDoc.category || ""} options={categoryOptions} placeholder="Select category"
              onChange={(e) => setEditDoc((d: any) => ({ ...d, category: e.target.value }))} />
            <TextArea label="Description" rows={3} value={editDoc.description || ""}
              onChange={(e) => setEditDoc((d: any) => ({ ...d, description: e.target.value }))} />
          </div>
        )}
      </Modal>
    </div>
  );
}
