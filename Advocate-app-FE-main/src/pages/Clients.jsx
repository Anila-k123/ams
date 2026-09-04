import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext.jsx";
import { usePermission } from "../contexts/PermissionContext.jsx";
import { FiFolder, FiEye, FiDownload, FiX, FiUpload, FiFile } from "react-icons/fi";
import ReportService from "../services/ReportService";
import Pagination from "../components/Pagination";
import usePagination from "../hooks/usePagination";
import { InlineLoader } from "../components/Loader";
import "../assets/styles/Clients.css";

function Clients() {
  const [clients, setClients] = useState([]);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const emptyClient = {
    name: "",
    description: "",
    website: "",
    billingCurrency: "INR",
    gstin: "",
    email: "",
    phone: "",
    building: "",
    street: "",
    city: "",
    district: "",
    state: "",
    pincode: "",
    country: "",
  };
  const [newClient, setNewClient] = useState(emptyClient);
  const [showModal, setShowModal] = useState(false);
  const [editClientId, setEditClientId] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [highlightedId, setHighlightedId] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);
  const location = useLocation();
  const token = localStorage.getItem("token");
  const { withLoading } = useLoading();
  const { success, error } = useToast();
  const { hasPermission } = usePermission();
  const { page, setPage, size, setSize } = usePagination({ defaultSize: 20, resetOn: [searchKeyword, showArchived] });
  const searchedFromGlobalNav = useRef(!!location.state?.search);

  // Document tab state
  const [showClientDocs, setShowClientDocs] = useState(false);
  const [docClient, setDocClient] = useState(null);
  const [clientDocs, setClientDocs] = useState([]);
  const [clientDocsLoading, setClientDocsLoading] = useState(false);
  const [uploadClientDocFile, setUploadClientDocFile] = useState(null);

  // ---------------- FETCH CLIENTS ----------------
  const fetchClients = useCallback(async (keyword = "") => {
    setPageLoading(true);
    try {
      const params = { page, size };
      if (keyword.trim()) params.keyword = keyword;
      if (showArchived) params.archived = true;

      const response = await axios.get("/api/clients", {
        headers: { Authorization: `Bearer ${token}` },
        params,
      });
      setClients(response.data.content || []);
      setTotalPages(response.data.totalPages || 0);
      setTotalElements(response.data.totalElements || 0);
      setErrorMessage("");
    } catch (error) {
      console.error("Error fetching clients:", error);
      const errData = error.response?.data;
      setErrorMessage(typeof errData === "string" ? errData : (errData?.message || "Failed to fetch clients."));
    } finally {
      setPageLoading(false);
    }
  }, [token, page, size, showArchived]);

  useEffect(() => {
    if (!token) {
      setErrorMessage("Please login first.");
      return;
    }
    if (searchedFromGlobalNav.current) {
      searchedFromGlobalNav.current = false;
      return;
    }
    fetchClients(searchKeyword);
  }, [fetchClients, searchKeyword]);

  // AI Assistant: open create-client modal + search
  useEffect(() => {
    const handleModal = (e) => {
      if (e.detail === "create-client") {
        setNewClient(emptyClient);
        setEditClientId(null);
        setShowModal(true);
      }
    };
    const handleSearch = (e) => {
      if (e.detail?.query) {
        setSearchKeyword(e.detail.query);
        fetchClients(e.detail.query);
      }
    };
    window.addEventListener("assistant-open-modal", handleModal);
    window.addEventListener("assistant-search", handleSearch);
    return () => {
      window.removeEventListener("assistant-open-modal", handleModal);
      window.removeEventListener("assistant-search", handleSearch);
    };
  }, []);

  // Global Search navigation — read incoming state
  useEffect(() => {
    if (location.state?.search) {
      const kw = location.state.search;
      setSearchKeyword(kw);
      setHighlightedId(location.state.id || null);
      fetchClients(kw);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const handleSearch = (e) => {
    const keyword = e.target.value;
    setSearchKeyword(keyword);
    fetchClients(keyword);
  };

  const handleChange = (e) => {
    setNewClient({ ...newClient, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editClientId) {
        await withLoading(
          axios.put(
            `/api/clients/update/${editClientId}`,
            newClient,
            { headers: { Authorization: `Bearer ${token}` } }
          ),
          "Updating Client..."
        );
      } else {
        await withLoading(
          axios.post(
            "/api/clients/create",
            newClient,
            { headers: { Authorization: `Bearer ${token}` } }
          ),
          "Saving Client..."
        );
      }
      setNewClient(emptyClient);
      setShowModal(false);
      fetchClients();
      success(editClientId ? "Client updated." : "Client created.");
    } catch (err) {
      console.error("Error saving client:", err);
      const errData = err.response?.data;
      const msg = typeof errData === "string"
        ? errData
        : (errData?.error || errData?.message || "Failed to save client.");
      setErrorMessage(msg);
      error(msg);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Archive this client?")) return;
    try {
      await withLoading(
        axios.delete(`/api/clients/delete/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        "Deleting Client..."
      );
      fetchClients();
    } catch (error) {
      console.error("Error deleting client:", error);
      const errData = error.response?.data;
      setErrorMessage(typeof errData === "string" ? errData : (errData?.message || "Failed to delete client."));
    }
  };

  const handleRestore = async (id) => {
    try {
      await withLoading(
        axios.put(`/api/clients/restore/${id}`, {}, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        "Restoring Client..."
      );
      fetchClients();
    } catch (error) {
      console.error("Error restoring client:", error);
      const errData = error.response?.data;
      setErrorMessage(typeof errData === "string" ? errData : (errData?.message || "Failed to restore client."));
    }
  };

  // Document functions
  const openClientDocs = useCallback(async (c) => {
    setDocClient(c);
    setShowClientDocs(true);
    setClientDocsLoading(true);
    try {
      const res = await axios.get(`/api/documents/by-client/${c.id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setClientDocs(res.data || []);
    } catch (err) {
      console.error("Error fetching client documents:", err);
      setClientDocs([]);
    } finally {
      setClientDocsLoading(false);
    }
  }, [token]);

  const handleClientDocDownload = async (docId, fileName) => {
    try {
      const res = await axios.get(`/api/documents/download/${docId}`, {
        headers: { Authorization: `Bearer ${token}` }, responseType: "blob"
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) { console.error("Download error:", err); }
  };

  const handleClientDocPreview = async (docId) => {
    try {
      const res = await axios.get(`/api/documents/preview/${docId}`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "blob"
      });
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank");
    } catch (err) {
      console.error("Preview error:", err);
    }
  };

  const uploadClientDoc = async () => {
    if (!uploadClientDocFile || !docClient) return;
    const formData = new FormData();
    formData.append("file", uploadClientDocFile);
    formData.append("clientId", docClient.id);
    try {
      await withLoading(
        axios.post("/api/documents/upload", formData, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        "Uploading Document..."
      );
      setUploadClientDocFile(null);
      openClientDocs(docClient);
      success("Document uploaded.");
    } catch (err) {
      console.error("Upload error:", err);
      error(err.response?.data?.error || "Failed to upload the document.");
    }
  };

  return (
    <div className="clients-container">
      <div className="clients-header">
        <div className="header-actions">
          <input
            type="text"
            placeholder="🔍 Search by name, email, or phone"
            value={searchKeyword}
            onChange={handleSearch}
            className="search-bar"
          />
          {hasPermission("CLIENT_CREATE") && (
          <button className="add-client-btn" onClick={() => { setNewClient(emptyClient); setEditClientId(null); setShowModal(true); }}>
            Add New Client
          </button>
          )}
          <button className="view-archived-btn" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? "🔙 Back to Active" : "🗄️ View Archived"}
          </button>
        </div>
      </div>

      {errorMessage && <p className="error-message">{errorMessage}</p>}

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>{editClientId ? "Edit Client" : "Add New Client"}</h3>
            <form className="client-form" onSubmit={handleSubmit}>
              <p className="client-form-section">Basic Details</p>
              <div className="client-form-row">
                <div className="client-form-field">
                  <label>Name <span className="required">*</span></label>
                  <input name="name" placeholder="Name of Client" value={newClient.name} onChange={handleChange} required />
                </div>
                <div className="client-form-field">
                  <label>Description</label>
                  <input name="description" placeholder="Short Description about Client." value={newClient.description} onChange={handleChange} />
                </div>
              </div>
              <div className="client-form-field">
                <label>Website</label>
                <input name="website" placeholder="Enter client's website" value={newClient.website} onChange={handleChange} />
              </div>
              <div className="client-form-row">
                <div className="client-form-field">
                  <label>Email <span className="required">*</span></label>
                  <input name="email" type="email" placeholder="Email address" value={newClient.email} onChange={handleChange} required />
                </div>
                <div className="client-form-field">
                  <label>Phone <span className="required">*</span></label>
                  <input name="phone" placeholder="Phone number" value={newClient.phone} onChange={handleChange} required />
                </div>
              </div>
              <div className="client-form-row">
                <div className="client-form-field">
                  <label>Billing Currency</label>
                  <select name="billingCurrency" value={newClient.billingCurrency} onChange={handleChange} className="client-form-select">
                    <option value="INR">INR</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="GBP">GBP</option>
                    <option value="AED">AED</option>
                  </select>
                </div>
                <div className="client-form-field">
                  <label>GSTIN</label>
                  <input name="gstin" placeholder="Enter GST number" value={newClient.gstin} onChange={handleChange} />
                </div>
              </div>

              <p className="client-form-section">Client's Address (Primary)</p>
              <div className="client-form-row">
                <div className="client-form-field">
                  <label>Building</label>
                  <input name="building" placeholder="Name of Building" value={newClient.building} onChange={handleChange} />
                </div>
                <div className="client-form-field">
                  <label>Street</label>
                  <input name="street" placeholder="Name of Street" value={newClient.street} onChange={handleChange} />
                </div>
              </div>
              <div className="client-form-row">
                <div className="client-form-field">
                  <label>City</label>
                  <input name="city" placeholder="Name of City" value={newClient.city} onChange={handleChange} />
                </div>
                <div className="client-form-field">
                  <label>District</label>
                  <input name="district" placeholder="Name of District" value={newClient.district} onChange={handleChange} />
                </div>
              </div>
              <div className="client-form-row">
                <div className="client-form-field">
                  <label>State</label>
                  <input name="state" placeholder="Name of State" value={newClient.state} onChange={handleChange} />
                </div>
                <div className="client-form-field">
                  <label>Pincode</label>
                  <input name="pincode" placeholder="Enter pin code of the area" value={newClient.pincode} onChange={handleChange} />
                </div>
              </div>
              <div className="client-form-field">
                <label>Country</label>
                <input name="country" placeholder="Name of Country" value={newClient.country} onChange={handleChange} />
              </div>

              <div className="modal-buttons">
                <button type="submit" className="save-client-btn">{editClientId ? "Update Client" : "Save Client"}</button>
                <button type="button" className="close-btn" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="clients-table">
        {pageLoading ? (
          <InlineLoader type="table" rows={size} cols={5} />
        ) : clients.length === 0 ? (
          <p>No clients found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Email</th><th>Phone</th><th>GSTIN</th><th>City</th><th>State</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className={highlightedId === c.id ? "highlight-row" : ""} ref={(el) => { if (highlightedId === c.id && el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
                  <td title={c.name}>{c.name}</td><td title={c.email}>{c.email}</td><td title={c.phone}>{c.phone}</td><td title={c.gstin || "—"}>{c.gstin || "—"}</td><td title={c.city || "—"}>{c.city || "—"}</td><td title={c.state || "—"}>{c.state || "—"}</td>
                  <td>
                    <div className="client-actions">
                      {showArchived ? (
                        hasPermission("CLIENT_EDIT") && (
                          <button className="restore-btn" onClick={() => handleRestore(c.id)}>♻️ Restore</button>
                        )
                      ) : (
                        <>
                          {hasPermission("CLIENT_EDIT") && (
                            <button className="edit-btn" onClick={() => { setNewClient(c); setEditClientId(c.id); setShowModal(true); }}>Edit</button>
                          )}
                          {hasPermission("CLIENT_DELETE") && (
                            <button className="archive-btn" onClick={() => handleDelete(c.id)}>Archive</button>
                          )}
                        </>
                      )}
                      <button className="pdf-btn" onClick={() => ReportService.downloadClientDetail(c.id, c.name)} title="Export PDF">
                        <FiFile />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Pagination
          page={page}
          totalPages={totalPages}
          totalElements={totalElements}
          size={size}
          onPageChange={setPage}
          onSizeChange={setSize}
        />
      </div>

      {/* Client Documents Modal */}
      {showClientDocs && docClient && (
        <div className="modal-overlay" onClick={() => setShowClientDocs(false)}>
          <div className="modal-content case-docs-modal" onClick={(e) => e.stopPropagation()}>
            <div className="case-docs-header">
              <h3>Documents — {docClient.name}</h3>
              <button className="close-btn" onClick={() => setShowClientDocs(false)}><FiX /></button>
            </div>
            {clientDocsLoading ? (
              <p>Loading documents...</p>
            ) : (
              <>
                {clientDocs.length === 0 ? (
                  <p className="no-data">No documents linked to this client.</p>
                ) : (
                  <div className="case-docs-list">
                    {clientDocs.map((d) => (
                      <div key={d.id} className="case-doc-item">
                        <FiFolder size={20} />
                        <span className="case-doc-name">{d.documentName}</span>
                        <span className="case-doc-meta">{d.category || "Other"}</span>
                        <span className="case-doc-meta">{d.version > 1 ? `v${d.version}` : "v1"}</span>
                        <div className="case-doc-actions">
                          <button onClick={() => handleClientDocPreview(d.id)} title="Preview"><FiEye /></button>
                          <button onClick={() => handleClientDocDownload(d.id, d.originalName || d.documentName)} title="Download"><FiDownload /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="case-doc-upload">
                  <input type="file" onChange={(e) => setUploadClientDocFile(e.target.files[0])} />
                  <button onClick={uploadClientDoc} disabled={!uploadClientDocFile}><FiUpload /> Upload</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default Clients;
