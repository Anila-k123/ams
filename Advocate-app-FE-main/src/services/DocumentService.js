const API_BASE = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api/documents`;

class DocumentService {
  constructor() {
    this.cache = new Map();
    this.activeController = null;
  }

  getAuthHeaders() {
    const token = localStorage.getItem("token");
    return { Authorization: `Bearer ${token}` };
  }

  async fetchDocuments(params = {}) {
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
      const res = await fetch(`${API_BASE}?${query.toString()}`, {
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

  async uploadDocument(file, options = {}) {
    const formData = new FormData();
    formData.append("file", file);
    if (options.caseId) formData.append("caseId", options.caseId);
    if (options.clientId) formData.append("clientId", options.clientId);
    if (options.documentName) formData.append("documentName", options.documentName);
    if (options.category) formData.append("category", options.category);
    if (options.description) formData.append("description", options.description);

    const res = await fetch(`${API_BASE}/upload`, {
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

  async uploadMultiple(files, options = {}, onProgress) {
    const results = [];
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

  async getDocument(id) {
    const res = await fetch(`${API_BASE}/${id}`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch document");
    return await res.json();
  }

  async downloadDocument(id) {
    const token = localStorage.getItem("token");
    const res = await fetch(`${API_BASE}/download/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
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

  getPreviewUrl(id) {
    const token = localStorage.getItem("token");
    return `${API_BASE}/preview/${id}?token=${encodeURIComponent(token)}`;
  }

  async getPreviewBlob(id) {
    const token = localStorage.getItem("token");
    const res = await fetch(`${API_BASE}/preview/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Preview failed");
    const blob = await res.blob();
    const contentType = res.headers.get("Content-Type");
    return { blob, contentType };
  }

  async searchDocuments(keyword) {
    const query = keyword ? `?keyword=${encodeURIComponent(keyword)}` : "";
    const res = await fetch(`${API_BASE}/search${query}`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Search failed");
    return await res.json();
  }

  async filterDocuments(filters) {
    const query = new URLSearchParams();
    if (filters.category) query.set("category", filters.category);
    if (filters.status) query.set("status", filters.status);
    if (filters.fileType) query.set("fileType", filters.fileType);
    const res = await fetch(`${API_BASE}/filter?${query.toString()}`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Filter failed");
    return await res.json();
  }

  async getDocumentsByCase(caseId) {
    const res = await fetch(`${API_BASE}/by-case/${caseId}`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Failed");
    return await res.json();
  }

  async getDocumentsByClient(clientId) {
    const res = await fetch(`${API_BASE}/by-client/${clientId}`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Failed");
    return await res.json();
  }

  async updateDocument(id, updates) {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: "PUT",
      headers: { ...this.getAuthHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error("Update failed");
    return await res.json();
  }

  async deleteDocument(id) {
    const res = await fetch(`${API_BASE}/${id}`, {
      method: "DELETE",
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Delete failed");
  }

  async getStats() {
    const res = await fetch(`${API_BASE}/stats`, {
      headers: this.getAuthHeaders(),
    });
    if (!res.ok) throw new Error("Failed to fetch stats");
    return await res.json();
  }

  clearCache() {
    this.cache.clear();
  }
}

const documentService = new DocumentService();
export default documentService;
