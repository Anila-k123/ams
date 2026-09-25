import { apiUrl, authHeaders, getToken } from "../api/client";

const BASE_URL = apiUrl("/api/documents");

class DocumentService {
  cache: Map<string, any>;
  activeController: AbortController | null;
  constructor() {
    this.cache = new Map();
    this.activeController = null;
  }

  getAuthHeaders(): Record<string, string> {
    return authHeaders();
  }

  async fetchDocuments(params: any = {}) {
    if (this.activeController) {
      this.activeController.abort();
    }
    this.activeController = new AbortController();
    const { signal } = this.activeController;

    const query = new URLSearchParams();
    if (params.page !== undefined) query.set("page", params.page);
    if (params.size) query.set("size", params.size);
    if (params.keyword) query.set("keyword", params.keyword);
    if (params.category) query.set("category", params.category);
    if (params.status) query.set("status", params.status);
    if (params.fileType) query.set("fileType", params.fileType);
    if (params.sortBy) query.set("sortBy", params.sortBy);
    if (params.sortDir) query.set("sortDir", params.sortDir);

    try {
      const res = await fetch(`${BASE_URL}?${query.toString()}`, {
        headers: this.getAuthHeaders(),
        signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (err.name === "AbortError") return null;
      throw err;
    } finally {
      this.activeController = null;
    }
  }

  async uploadDocument(file: any, options: any = {}) {
    const formData = new FormData();
    formData.append("file", file);
    if (options.caseId) formData.append("caseId", options.caseId);
    if (options.clientId) formData.append("clientId", options.clientId);
    if (options.documentName) formData.append("documentName", options.documentName);
    if (options.category) formData.append("category", options.category);
    if (options.description) formData.append("description", options.description);

    const res = await fetch(`${BASE_URL}/upload`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: formData,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "Upload failed");
      throw new Error(errText);
    }
    return await res.json();
  }

  async uploadMultiple(files: any, options: any = {}, onProgress?: any) {
    const results: any[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const result = await this.uploadDocument(file, options);
        results.push({ file: file.name, success: true, data: result });
      } catch (err) {
        results.push({ file: file.name, success: false, error: err.message });
      }
      if (onProgress) {
        onProgress({ current: i + 1, total: files.length, file: file.name });
      }
    }
    return results;
  }

  async getDocument(id: any) {
    const res = await fetch(`${BASE_URL}/${id}`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch document");
    return await res.json();
  }

  async downloadDocument(id: any) {
    const res = await fetch(`${BASE_URL}/download/${id}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition");
    let filename = "download";
    if (disposition) {
      const match = disposition.match(/filename="?(.+?)"?$/);
      if (match) filename = match[1];
    }
    return { blob, filename };
  }

  getPreviewUrl(id: any) {
    const token = getToken() || "";
    return `${BASE_URL}/preview/${id}?token=${encodeURIComponent(token)}`;
  }

  async getPreviewBlob(id: any) {
    const res = await fetch(`${BASE_URL}/preview/${id}`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Preview failed");
    const blob = await res.blob();
    const contentType = res.headers.get("Content-Type");
    return { blob, contentType };
  }

  async searchDocuments(keyword?: any) {
    const query = keyword ? `?keyword=${encodeURIComponent(keyword)}` : "";
    const res = await fetch(`${BASE_URL}/search${query}`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Search failed");
    return await res.json();
  }

  async filterDocuments(filters: any) {
    const query = new URLSearchParams();
    if (filters.category) query.set("category", filters.category);
    if (filters.status) query.set("status", filters.status);
    if (filters.fileType) query.set("fileType", filters.fileType);
    const res = await fetch(`${BASE_URL}/filter?${query.toString()}`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Filter failed");
    return await res.json();
  }

  async getDocumentsByCase(caseId: any) {
    const res = await fetch(`${BASE_URL}/by-case/${caseId}`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Failed");
    return await res.json();
  }

  async getDocumentsByClient(clientId: any) {
    const res = await fetch(`${BASE_URL}/by-client/${clientId}`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Failed");
    return await res.json();
  }

  async updateDocument(id: any, updates: any) {
    const res = await fetch(`${BASE_URL}/${id}`, {
      method: "PUT",
      headers: { ...this.getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error("Update failed");
    return await res.json();
  }

  async deleteDocument(id: any) {
    const res = await fetch(`${BASE_URL}/${id}`, {
      method: "DELETE",
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Delete failed");
  }

  async getStats() {
    const res = await fetch(`${BASE_URL}/stats`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch stats");
    return await res.json();
  }

  // AI summary: fetch the stored summary + key points for a document.
  // Returns { status, summary, keyPoints, modelUsed, error, updatedAt }.
  // status is one of NONE | PENDING | PROCESSING | READY | FAILED | UNSUPPORTED.
  async getSummary(id: any) {
    const res = await fetch(`${BASE_URL}/${id}/summary`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  // Re-run summarization in the background (requires DOCUMENT_EDIT). Returns
  // the queued status, e.g. { status: "PENDING" }.
  async regenerateSummary(id: any) {
    const res = await fetch(`${BASE_URL}/${id}/summary/regenerate`, {
      method: "POST",
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  // Version history for a document (newest first, current flagged isCurrent).
  async getVersions(id: any) {
    const res = await fetch(`${BASE_URL}/${id}/versions`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  // Upload a new version of an existing document (requires DOCUMENT_UPLOAD).
  // `note` (optional) describes what changed in this version.
  async uploadNewVersion(id: any, file: any, note?: any) {
    const formData = new FormData();
    formData.append("file", file);
    if (note) formData.append("note", note);
    const res = await fetch(`${BASE_URL}/${id}/versions`, {
      method: "POST",
      headers: this.getAuthHeaders(),
      body: formData,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "Upload failed");
      throw new Error(t);
    }
    return await res.json();
  }

  // Download a specific version's file.
  async downloadVersion(id: any, version: any) {
    const res = await fetch(`${BASE_URL}/${id}/versions/${version}/download`, {
      headers: authHeaders(),
    });
    if (!res.ok) throw new Error("Download failed");
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition");
    let filename = "download";
    if (disposition) {
      const match = disposition.match(/filename="?(.+?)"?$/);
      if (match) filename = match[1];
    }
    return { blob, filename };
  }

  clearCache() {
    this.cache.clear();
  }
}

const documentService = new DocumentService();
export default documentService;
