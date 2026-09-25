import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Paginator } from "primereact/paginator";
import { Skeleton } from "primereact/skeleton";
import { ProgressBar } from "primereact/progressbar";
import { Tag } from "primereact/tag";
import { SelectButton } from "primereact/selectbutton";
import "../assets/styles/DocumentsPanel.css";
import documentService from "../services/DocumentService";
import DocumentCard, { CategoryChip, DocumentActions, categoryColor, formatBytes, getFileIcon } from "../components/DocumentCard";
import FilePreviewModal from "../components/FilePreviewModal";
import DocumentSummaryModal from "../components/DocumentSummaryModal";
import DocumentVersionsModal from "../components/DocumentVersionsModal";
import { useLoading } from "../contexts/LoadingContext";
import { usePermission } from "../contexts/PermissionContext";
import { useToast } from "../contexts/ToastContext";
import api from "../api/client";

const CATEGORIES = [
  "Court Order", "Petition", "Evidence", "Agreement", "Affidavit",
  "Notice", "Judgment", "Invoice", "Payment Receipt",
  "Identity Proof", "Address Proof", "Other"
];

const FILE_TYPE_OPTIONS = [
  { value: "application/pdf", label: "PDF" },
  { value: "image/", label: "Images" },
  { value: "application/msword", label: "DOC" },
  { value: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "DOCX" },
  { value: "application/zip", label: "ZIP" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All Status" },
  { value: "ACTIVE", label: "Active" },
  { value: "ARCHIVED", label: "Archived" },
];

const PAGE_SIZE = 20;
const emptyUploadOptions = { category: "", caseId: "", clientId: "", documentName: "", description: "" };

export default function DocumentsPanel() {
  const [documents, setDocuments] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("grid");
  const [searchText, setSearchText] = useState("");
  const [highlightedId, setHighlightedId] = useState<any>(null);
  const location = useLocation();
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [selectedFileType, setSelectedFileType] = useState("");
  const [page, setPage] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
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
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);
  const [editDoc, setEditDoc] = useState<any>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchedFromGlobalNav = useRef(!!(location.state as any)?.search);
  const { hasPermission } = usePermission();
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
  }, [page, searchText, selectedCategory, selectedStatus, selectedFileType]);

  const fetchCases = useCallback(async () => {
    try {
      const res = await api.get("/api/cases/my-cases");
      setCases(res.data || []);
    } catch (err) {
      console.error("Error fetching cases:", err);
    }
  }, []);

  useEffect(() => {
    if (searchedFromGlobalNav.current) {
      searchedFromGlobalNav.current = false;
      return;
    }
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  // AI Assistant: search + modal listeners
  useEffect(() => {
    const handleSearch = (e: any) => {
      if (e.detail?.query) setSearchText(e.detail.query);
    };
    const handleModal = (e: any) => {
      if (e.detail === "create-document" || e.detail === "upload-document") {
        setShowUploadModal(true);
        setUploadResults([]);
        setUploadProgress({ current: 0, total: 0 });
      }
    };
    window.addEventListener("assistant-search", handleSearch);
    window.addEventListener("assistant-open-modal", handleModal);
    return () => {
      window.removeEventListener("assistant-search", handleSearch);
      window.removeEventListener("assistant-open-modal", handleModal);
    };
  }, []);

  // Global Search navigation — read incoming state
  useEffect(() => {
    const st = location.state as any;
    if (st?.search) {
      setSearchText(st.search);
      setHighlightedId(st.id || null);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => setPage(0), 400);
    return () => clearTimeout(timer);
  }, [searchText, selectedCategory, selectedStatus, selectedFileType]);

  const clearFilters = () => {
    setSearchText("");
    setSelectedCategory("");
    setSelectedStatus("");
    setSelectedFileType("");
    setPage(0);
  };

  const hasFilters = searchText || selectedCategory || selectedStatus || selectedFileType;

  const handleUploadClick = () => {
    setShowUploadModal(true);
    setUploadResults([]);
    setUploadProgress({ current: 0, total: 0 });
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    setUploadFiles((prev) => [...prev, ...files]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setUploadFiles((prev) => [...prev, ...files]);
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
      setError("Failed to download file");
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await withLoading((documentService as any).deleteDocument(deleteConfirm.id), "Deleting Document...");
      setDeleteConfirm(null);
      fetchDocuments();
    } catch (err) {
      console.error("Delete error:", err);
      setError("Failed to delete document");
    }
  };

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
      setError("Failed to update document");
    }
  };

  const handlers = {
    onPreview: setPreviewDoc,
    onSummary: setSummaryDoc,
    onVersions: setVersionsDoc,
    onDownload: handleDownload,
    onDelete: hasPermission("DOCUMENT_DELETE") ? setDeleteConfirm : undefined,
    onEdit: hasPermission("DOCUMENT_EDIT") ? setEditDoc : undefined,
    onShareToggle: hasPermission("DOCUMENT_EDIT") ? handleShareToggle : undefined,
  };

  if (loading && documents.length === 0) {
    return (
      <div className="documents-container">
        <div className="doc-grid">
          {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} height="220px" borderRadius="12px" />)}
        </div>
      </div>
    );
  }

  const categoryOptions = CATEGORIES.map((c) => ({ value: c, label: c }));
  const caseOptions = cases.map((c) => ({ value: c.id, label: `${c.caseNumber} — ${c.caseTitle}` }));

  return (
    <div className="documents-container">
      <div className="flex align-items-center justify-content-between gap-2 flex-wrap">
        <p className="doc-subtle">{totalElements} file{totalElements !== 1 ? "s" : ""}</p>
        {hasPermission("DOCUMENT_UPLOAD") && (
          <Button icon="pi pi-plus" label="Upload Files" onClick={handleUploadClick} />
        )}
      </div>

      {error && (
        <div className="doc-error-banner flex align-items-center justify-content-between">
          <span>{error}</span>
          <Button icon="pi pi-times" className="p-button-rounded p-button-text p-button-danger p-button-sm" onClick={() => setError("")} aria-label="Dismiss" />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap align-items-center gap-2">
        <span className="p-input-icon-left p-input-icon-right flex-1" style={{ minWidth: 220 }}>
          <i className="pi pi-search" />
          <InputText className="w-full" placeholder="Search documents..." value={searchText}
            onChange={(e) => setSearchText(e.target.value)} />
          {searchText && <i className="pi pi-times cursor-pointer" onClick={() => setSearchText("")} />}
        </span>
        <Dropdown placeholder="All Categories" value={selectedCategory} options={[{ value: "", label: "All Categories" }, ...categoryOptions]}
          onChange={(e) => { setSelectedCategory(e.value); setPage(0); }} />
        <Dropdown value={selectedStatus} options={STATUS_OPTIONS}
          onChange={(e) => { setSelectedStatus(e.value); setPage(0); }} />
        <Dropdown placeholder="All Types" value={selectedFileType} options={[{ value: "", label: "All Types" }, ...FILE_TYPE_OPTIONS]}
          onChange={(e) => { setSelectedFileType(e.value); setPage(0); }} />
        {hasFilters && <Button icon="pi pi-times" label="Clear" className="p-button-text" onClick={clearFilters} />}
        <SelectButton value={viewMode} onChange={(e) => e.value && setViewMode(e.value)}
          options={[{ value: "grid", icon: "pi pi-th-large" }, { value: "list", icon: "pi pi-list" }]}
          itemTemplate={(o) => <i className={o.icon} />} />
      </div>

      {/* Document Grid/List */}
      {documents.length === 0 ? (
        <div className="doc-empty">
          <i className="pi pi-folder-open" style={{ fontSize: 64 }} />
          <h3>No documents found</h3>
          <p>{hasFilters ? "Try adjusting your filters" : "Upload your first document to get started"}</p>
          {!hasFilters && hasPermission("DOCUMENT_UPLOAD") && <Button icon="pi pi-upload" label="Upload" onClick={handleUploadClick} />}
        </div>
      ) : viewMode === "grid" ? (
        <div className="doc-grid">
          {documents.map((doc) => (
            <div key={doc.id} className={highlightedId === doc.id ? "highlight-row" : ""}>
              <DocumentCard doc={doc} {...handlers} />
            </div>
          ))}
        </div>
      ) : (
        <DataTable value={documents} dataKey="id" size="small" stripedRows responsiveLayout="scroll"
          rowClassName={(d: any) => (highlightedId === d.id ? "highlight-row" : "")}>
          <Column header="Name" body={(doc: any) => (
            <div className="flex align-items-center gap-2">
              <i className={`pi ${getFileIcon(doc.fileType)}`} style={{ color: categoryColor(doc), fontSize: 18 }} />
              <strong>{doc.documentName}</strong>
              <button type="button" className="doc-card-version-btn" onClick={() => setVersionsDoc(doc)} title="Version history">v{doc.version}</button>
            </div>
          )} />
          <Column header="Category" body={(doc: any) => <CategoryChip doc={doc} />} />
          <Column header="Size" body={(doc: any) => formatBytes(doc.fileSize)} />
          <Column header="Case" body={(doc: any) => doc.caseEntity?.caseNumber || "-"} />
          <Column header="Client" body={(doc: any) => doc.client?.name || "-"} />
          <Column header="Uploaded" body={(doc: any) => new Date(doc.uploadDate).toLocaleDateString()} />
          <Column header="Status" body={(doc: any) => (
            <Tag value={doc.status || "ACTIVE"} severity={(doc.status || "ACTIVE") === "ACTIVE" ? "success" : "secondary"} />
          )} />
          <Column header="Actions" body={(doc: any) => (
            <div className="flex align-items-center gap-1">
              <Button icon="pi pi-bolt" label="Summary" className="p-button-text p-button-sm" onClick={() => setSummaryDoc(doc)} />
              <DocumentActions doc={doc} {...handlers} />
            </div>
          )} />
        </DataTable>
      )}

      {totalElements > PAGE_SIZE && (
        <Paginator first={page * PAGE_SIZE} rows={PAGE_SIZE} totalRecords={totalElements}
          onPageChange={(e) => setPage(e.page)} />
      )}

      {/* Upload Modal */}
      <Dialog visible={showUploadModal} header="Upload Files" style={{ width: "40rem" }} breakpoints={{ "640px": "95vw" }}
        onHide={() => { if (!uploading) setShowUploadModal(false); }} closable={!uploading} modal
        footer={
          <Button onClick={handleUpload} disabled={uploadFiles.length === 0 || uploading} loading={uploading}
            label={uploading ? `Uploading... (${uploadProgress.current}/${uploadProgress.total})` : `Upload ${uploadFiles.length} file${uploadFiles.length !== 1 ? "s" : ""}`} />
        }>
        <div className="flex flex-column gap-3">
          <div
            className={`upload-dropzone ${dragOver ? "drag-over" : ""}`}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileInputRef.current?.click()}
          >
            <i className="pi pi-upload" style={{ fontSize: 36 }} />
            <p>Drag & drop files here, or click to browse</p>
            <small>Supports PDF, DOC, DOCX, PNG, JPG, ZIP (max 25 MB each)</small>
            <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} style={{ display: "none" }} />
          </div>

          {uploadFiles.length > 0 && (
            <div className="flex flex-column gap-1">
              {uploadFiles.map((file, i) => (
                <div key={i} className="upload-file-item flex align-items-center gap-2">
                  <i className="pi pi-file" />
                  <span className="flex-1">{file.name}</span>
                  <small className="doc-subtle">{(file.size / 1024 / 1024).toFixed(1)} MB</small>
                  {!uploading && <Button icon="pi pi-times" className="p-button-rounded p-button-text p-button-sm" onClick={() => removeUploadFile(i)} aria-label="Remove" />}
                </div>
              ))}
            </div>
          )}

          <div className="grid">
            <div className="col-12 md:col-6">
              <Dropdown className="w-full" value={uploadOptions.category} options={categoryOptions} placeholder="Select Category" showClear
                onChange={(e) => setUploadOptions((o: any) => ({ ...o, category: e.value || "" }))} />
            </div>
            <div className="col-12 md:col-6">
              <Dropdown className="w-full" value={uploadOptions.caseId} options={caseOptions} placeholder="Link to Case (optional)" showClear filter
                onChange={(e) => setUploadOptions((o: any) => ({ ...o, caseId: e.value || "" }))} />
            </div>
            <div className="col-12">
              <InputText className="w-full" placeholder="Document name (optional)" value={uploadOptions.documentName}
                onChange={(e) => setUploadOptions((o: any) => ({ ...o, documentName: e.target.value }))} />
            </div>
          </div>

          {uploadProgress.total > 0 && (
            <div>
              <ProgressBar value={Math.round((uploadProgress.current / uploadProgress.total) * 100)} showValue={false} style={{ height: 8 }} />
              <small className="doc-subtle">{uploadProgress.current}/{uploadProgress.total} uploaded</small>
            </div>
          )}

          {uploadResults.length > 0 && (
            <div className="flex flex-column gap-1">
              {uploadResults.map((r, i) => (
                <div key={i} className={`upload-result ${r.success ? "success" : "error"}`}>
                  {r.success ? "✓" : "✗"} {r.file}
                  {!r.success && <span> — {r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </Dialog>

      {previewDoc && <FilePreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} onDownload={handleDownload} />}

      {summaryDoc && (
        <DocumentSummaryModal doc={summaryDoc} onClose={() => setSummaryDoc(null)} canRegenerate={hasPermission("DOCUMENT_EDIT")} />
      )}

      {versionsDoc && (
        <DocumentVersionsModal doc={versionsDoc} onClose={() => setVersionsDoc(null)}
          canUpload={hasPermission("DOCUMENT_UPLOAD")} onUpdated={fetchDocuments} />
      )}

      {/* Delete Confirmation */}
      <Dialog visible={!!deleteConfirm} header="Delete Document" onHide={() => setDeleteConfirm(null)} style={{ width: "28rem" }}
        breakpoints={{ "640px": "95vw" }} modal dismissableMask
        footer={<>
          <Button label="Cancel" className="p-button-text" onClick={() => setDeleteConfirm(null)} />
          <Button label="Delete" icon="pi pi-trash" className="p-button-danger" onClick={confirmDelete} />
        </>}>
        <p>Are you sure you want to delete <strong>{deleteConfirm?.documentName}</strong>?</p>
        <p style={{ color: "var(--danger)", fontSize: 13 }}>This action cannot be undone. The file will be permanently removed.</p>
      </Dialog>

      {/* Edit Modal */}
      <Dialog visible={!!editDoc} header="Edit Document" onHide={() => setEditDoc(null)} style={{ width: "32rem" }}
        breakpoints={{ "640px": "95vw" }} modal dismissableMask
        footer={<>
          <Button label="Cancel" className="p-button-text" onClick={() => setEditDoc(null)} />
          <Button label="Save Changes" icon="pi pi-check" onClick={saveEdit} />
        </>}>
        {editDoc && (
          <div className="flex flex-column gap-2">
            <label className="doc-label">Document Name</label>
            <InputText value={editDoc.documentName} onChange={(e) => setEditDoc((d: any) => ({ ...d, documentName: e.target.value }))} />
            <label className="doc-label">Category</label>
            <Dropdown value={editDoc.category} options={categoryOptions} onChange={(e) => setEditDoc((d: any) => ({ ...d, category: e.value }))} />
            <label className="doc-label">Description</label>
            <InputTextarea rows={3} value={editDoc.description || ""} onChange={(e) => setEditDoc((d: any) => ({ ...d, description: e.target.value }))} />
          </div>
        )}
      </Dialog>
    </div>
  );
}
