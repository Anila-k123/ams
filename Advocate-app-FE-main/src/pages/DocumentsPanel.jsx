import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import {
  FiUpload, FiGrid, FiList, FiSearch, FiX, FiFolder,
  FiFile, FiFileText, FiImage, FiArchive, FiDownload,
  FiEye, FiTrash2, FiEdit2, FiChevronLeft, FiChevronRight,
  FiChevronDown, FiPlus
} from "react-icons/fi";
import "../assets/styles/DocumentsPanel.css";
import documentService from "../services/DocumentService";
import DocumentCard from "../components/DocumentCard";
import FilePreviewModal from "../components/FilePreviewModal";
import { SkeletonDocCard } from "../components/Skeleton";
import { useLoading } from "../contexts/LoadingContext.jsx";
import Pagination from "../components/Pagination";

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

export default function DocumentsPanel() {
  const [documents, setDocuments] = useState([]);
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState("grid");
  const [searchText, setSearchText] = useState("");
  const [highlightedId, setHighlightedId] = useState(null);
  const location = useLocation();
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [selectedFileType, setSelectedFileType] = useState("");
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFiles, setUploadFiles] = useState([]);
  const [uploadOptions, setUploadOptions] = useState({ category: "", caseId: "", clientId: "", documentName: "", description: "" });
  const [uploading, setUploading] = useState(false);
  const [uploadResults, setUploadResults] = useState([]);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [dragOver, setDragOver] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [editDoc, setEditDoc] = useState(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);
  const searchedFromGlobalNav = useRef(!!location.state?.search);

  const token = localStorage.getItem("token");
  const { withLoading } = useLoading();

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    try {
      const data = await documentService.fetchDocuments({
        page, size: 20, keyword: searchText || undefined,
        category: selectedCategory || undefined,
        status: selectedStatus || undefined,
        fileType: selectedFileType || undefined,
        sortBy: "uploadDate", sortDir: "desc"
      });
      if (data) {
        setDocuments(data.content || []);
        setTotalPages(data.totalPages || 0);
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
      const res = await axios.get("/api/cases/my-cases", {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCases(res.data || []);
    } catch (err) {
      console.error("Error fetching cases:", err);
    }
  }, [token]);

  useEffect(() => {
    if (searchedFromGlobalNav.current) {
      searchedFromGlobalNav.current = false;
      return;
    }
    fetchDocuments();
  }, [fetchDocuments]);

  useEffect(() => {
    fetchCases();
  }, [fetchCases]);

  // AI Assistant: search + modal listeners
  useEffect(() => {
    const handleSearch = (e) => {
      if (e.detail?.query) setSearchText(e.detail.query);
    };
    const handleModal = (e) => {
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
    if (location.state?.search) {
      setSearchText(location.state.search);
      setHighlightedId(location.state.id || null);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(0);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchText, selectedCategory, selectedStatus, selectedFileType]);

  const handleSearchChange = (e) => setSearchText(e.target.value);

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

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    setUploadFiles((prev) => [...prev, ...files]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    setUploadFiles((prev) => [...prev, ...files]);
    e.target.value = "";
  };

  const removeUploadFile = (index) => {
    setUploadFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (uploadFiles.length === 0) return;
    setUploading(true);
    setUploadResults([]);

    const results = await withLoading(
      documentService.uploadMultiple(
        uploadFiles,
        {
          caseId: uploadOptions.caseId || undefined,
          clientId: uploadOptions.clientId || undefined,
          category: uploadOptions.category || undefined,
          documentName: uploadOptions.documentName || undefined,
          description: uploadOptions.description || undefined,
        },
        (progress) => setUploadProgress(progress)
      ),
      "Uploading Document..."
    );

    setUploadResults(results);
    const allSuccess = results.every((r) => r.success);
    if (allSuccess) {
      setTimeout(() => {
        setShowUploadModal(false);
        setUploadFiles([]);
        setUploadOptions({ category: "", caseId: "", clientId: "", documentName: "", description: "" });
        fetchDocuments();
      }, 1500);
    }
    setUploading(false);
  };

  const handlePreview = (doc) => setPreviewDoc(doc);

  const handleDownload = async (doc) => {
    try {
      const { blob, filename } = await documentService.downloadDocument(doc.id);
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

  const handleDelete = async (doc) => {
    setDeleteConfirm(doc);
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await withLoading(
        documentService.deleteDocument(deleteConfirm.id),
        "Deleting Document..."
      );
      setDeleteConfirm(null);
      fetchDocuments();
    } catch (err) {
      console.error("Delete error:", err);
      setError("Failed to delete document");
    }
  };

  const handleEdit = (doc) => setEditDoc(doc);

  const saveEdit = async () => {
    if (!editDoc) return;
    try {
      await withLoading(
        documentService.updateDocument(editDoc.id, {
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

  if (loading && documents.length === 0) {
    return (
      <div className="documents-container">
        <div className="documents-header">
          <h2>Documents</h2>
        </div>
        <div className="doc-grid">
          {[1, 2, 3, 4, 5, 6].map(i => <SkeletonDocCard key={i} />)}
        </div>
      </div>
    );
  }

  return (
    <div className="documents-container">
      <div className="documents-header">
        <div>
          <h2>Documents</h2>
          <p className="subtle">{totalElements} file{totalElements !== 1 ? "s" : ""}</p>
        </div>
        <button className="upload-btn" onClick={handleUploadClick}>
          <FiPlus /> Upload Files
        </button>
      </div>

      {error && <div className="doc-error-banner">{error} <button onClick={() => setError("")}><FiX /></button></div>}

      {/* Toolbar */}
      <div className="documents-toolbar">
        <div className="doc-search-box">
          <FiSearch className="doc-search-icon" />
          <input
            type="text"
            placeholder="Search documents..."
            value={searchText}
            onChange={handleSearchChange}
          />
          {searchText && <button className="doc-search-clear" onClick={() => setSearchText("")}><FiX /></button>}
        </div>

        <div className="doc-filter-chips">
          <select value={selectedCategory} onChange={(e) => { setSelectedCategory(e.target.value); setPage(0); }}>
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={selectedStatus} onChange={(e) => { setSelectedStatus(e.target.value); setPage(0); }}>
            <option value="">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="ARCHIVED">Archived</option>
          </select>
          <select value={selectedFileType} onChange={(e) => { setSelectedFileType(e.target.value); setPage(0); }}>
            <option value="">All Types</option>
            {FILE_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {hasFilters && (
            <button className="doc-clear-filters" onClick={clearFilters}>
              <FiX /> Clear
            </button>
          )}
        </div>

        <div className="doc-view-toggle">
          <button className={`view-btn ${viewMode === "grid" ? "active" : ""}`} onClick={() => setViewMode("grid")}>
            <FiGrid />
          </button>
          <button className={`view-btn ${viewMode === "list" ? "active" : ""}`} onClick={() => setViewMode("list")}>
            <FiList />
          </button>
        </div>
      </div>

      {/* Document Grid/List */}
      {documents.length === 0 ? (
        <div className="doc-empty">
          <FiFolder size={64} />
          <h3>No documents found</h3>
          <p>{hasFilters ? "Try adjusting your filters" : "Upload your first document to get started"}</p>
          {!hasFilters && <button className="upload-btn" onClick={handleUploadClick}><FiUpload /> Upload</button>}
        </div>
      ) : viewMode === "grid" ? (
          <div className="doc-grid">
            {documents.map((doc) => (
              <div key={doc.id} className={highlightedId === doc.id ? "highlight-row" : ""}>
                <DocumentCard
                  doc={doc}
                  gridView={true}
                  onPreview={handlePreview}
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                />
              </div>
            ))}
          </div>
      ) : (
        <div className="doc-table-wrapper">
          <table className="doc-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Size</th>
                <th>Case</th>
                <th>Client</th>
                <th>Uploaded</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  doc={doc}
                  gridView={false}
                  className={highlightedId === doc.id ? "highlight-row" : ""}
                  onPreview={handlePreview}
                  onDownload={handleDownload}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        totalElements={totalElements}
        size={20}
        onPageChange={setPage}
        onSizeChange={() => {}}
      />

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="upload-modal-overlay" onClick={() => { if (!uploading) setShowUploadModal(false); }}>
          <div className="upload-modal" onClick={(e) => e.stopPropagation()}>
            <div className="upload-modal-header">
              <h3>Upload Files</h3>
              <button onClick={() => setShowUploadModal(false)} disabled={uploading}><FiX /></button>
            </div>

            <div
              className={`upload-dropzone ${dragOver ? "drag-over" : ""}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              <FiUpload size={36} />
              <p>Drag & drop files here, or click to browse</p>
              <span>Supports PDF, DOC, DOCX, PNG, JPG, ZIP (max 25 MB each)</span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFileSelect}
                style={{ display: "none" }}
              />
            </div>

            {uploadFiles.length > 0 && (
              <div className="upload-file-list">
                {uploadFiles.map((file, i) => (
                  <div key={i} className="upload-file-item">
                    <FiFileText />
                    <span>{file.name}</span>
                    <span className="upload-file-size">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
                    {!uploading && <button onClick={() => removeUploadFile(i)}><FiX /></button>}
                  </div>
                ))}
              </div>
            )}

            <div className="upload-options">
              <select value={uploadOptions.category} onChange={(e) => setUploadOptions((o) => ({ ...o, category: e.target.value }))}>
                <option value="">Select Category</option>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={uploadOptions.caseId} onChange={(e) => setUploadOptions((o) => ({ ...o, caseId: e.target.value }))}>
                <option value="">Link to Case (optional)</option>
                {cases.map((c) => (
                  <option key={c.id} value={c.id}>{c.caseNumber} — {c.caseTitle}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Document name (optional)"
                value={uploadOptions.documentName}
                onChange={(e) => setUploadOptions((o) => ({ ...o, documentName: e.target.value }))}
              />
            </div>

            {uploadProgress.total > 0 && (
              <div className="upload-progress-bar">
                <div
                  className="upload-progress-fill"
                  style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                />
                <span>{uploadProgress.current}/{uploadProgress.total} uploaded</span>
              </div>
            )}

            {uploadResults.length > 0 && (
              <div className="upload-results">
                {uploadResults.map((r, i) => (
                  <div key={i} className={`upload-result ${r.success ? "success" : "error"}`}>
                    {r.success ? "✓" : "✗"} {r.file}
                    {!r.success && <span> — {r.error}</span>}
                  </div>
                ))}
              </div>
            )}

            <div className="upload-modal-actions">
              <button
                className="upload-submit-btn"
                onClick={handleUpload}
                disabled={uploadFiles.length === 0 || uploading}
              >
                {uploading ? `Uploading... (${uploadProgress.current}/${uploadProgress.total})` : `Upload ${uploadFiles.length} file${uploadFiles.length !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal */}
      {previewDoc && (
        <FilePreviewModal
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
          onDownload={handleDownload}
        />
      )}

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <div className="delete-confirm-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="delete-confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Document</h3>
            <p>Are you sure you want to delete <strong>{deleteConfirm.documentName}</strong>?</p>
            <p className="delete-warning">This action cannot be undone. The file will be permanently removed.</p>
            <div className="delete-confirm-actions">
              <button className="delete-cancel-btn" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="delete-confirm-btn" onClick={confirmDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editDoc && (
        <div className="edit-modal-overlay" onClick={() => setEditDoc(null)}>
          <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit Document</h3>
            <div className="edit-form">
              <label>Document Name</label>
              <input
                type="text"
                value={editDoc.documentName}
                onChange={(e) => setEditDoc((d) => ({ ...d, documentName: e.target.value }))}
              />
              <label>Category</label>
              <select value={editDoc.category} onChange={(e) => setEditDoc((d) => ({ ...d, category: e.target.value }))}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <label>Description</label>
              <textarea
                value={editDoc.description || ""}
                onChange={(e) => setEditDoc((d) => ({ ...d, description: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="edit-actions">
              <button className="edit-cancel-btn" onClick={() => setEditDoc(null)}>Cancel</button>
              <button className="edit-save-btn" onClick={saveEdit}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
