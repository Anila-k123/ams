import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { Paginator } from "primereact/paginator";
import { Skeleton } from "primereact/skeleton";
import { ProgressSpinner } from "primereact/progressspinner";
import { Message } from "primereact/message";
import { IconField } from "primereact/iconfield";
import { InputIcon } from "primereact/inputicon";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import ReportService from "../services/ReportService";
import usePagination from "../hooks/usePagination";
import "../assets/styles/Clients.css";
import ClientPortalAccess from "../components/ClientPortalAccess";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED"].map((c) => ({ label: c, value: c }));

function Clients() {
  const [clients, setClients] = useState<any[]>([]);
  const [totalElements, setTotalElements] = useState(0);
  const [showArchived, setShowArchived] = useState(false);
  const emptyClient: any = {
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
  const [newClient, setNewClient] = useState<any>(emptyClient);
  const [showModal, setShowModal] = useState(false);
  const [editClientId, setEditClientId] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [highlightedId, setHighlightedId] = useState<any>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const location = useLocation();
  const { token } = useAuth();
  const { withLoading } = useLoading() as any;
  const toast: any = useToast();
  const { success, error } = toast;
  const [portalFor, setPortalFor] = useState<any>(null);   // client whose portal access is open
  const { hasPermission } = usePermission() as any;
  const { page, setPage, size, setSize } = usePagination({ defaultSize: 20, resetOn: [searchKeyword, showArchived] });
  const searchedFromGlobalNav = useRef(!!(location.state as any)?.search);

  // Document tab state
  const [showClientDocs, setShowClientDocs] = useState(false);
  const [docClient, setDocClient] = useState<any>(null);
  const [clientDocs, setClientDocs] = useState<any[]>([]);
  const [clientDocsLoading, setClientDocsLoading] = useState(false);
  const [uploadClientDocFile, setUploadClientDocFile] = useState<File | null>(null);

  const errText = (err: any, fallback: string) => {
    const errData = err.response?.data;
    return typeof errData === "string" ? errData : (errData?.message || fallback);
  };

  // ---------------- FETCH CLIENTS ----------------
  const fetchClients = useCallback(async (keyword = "") => {
    setPageLoading(true);
    try {
      const params: any = { page, size };
      if (keyword.trim()) params.keyword = keyword;
      if (showArchived) params.archived = true;

      const response = await api.get("/api/clients", { params });
      setClients(response.data.content || []);
      setTotalElements(response.data.totalElements || 0);
      setErrorMessage("");
    } catch (err) {
      console.error("Error fetching clients:", err);
      setErrorMessage(errText(err, "Failed to fetch clients."));
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
    const handleModal = (e: any) => {
      if (e.detail === "create-client") {
        setNewClient(emptyClient);
        setEditClientId(null);
        setShowModal(true);
      }
    };
    const handleSearch = (e: any) => {
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

  // Scroll the highlighted row (from global search) into view.
  useEffect(() => {
    if (highlightedId == null) return;
    requestAnimationFrame(() => document.querySelector(".clients-table .highlight-row")
      ?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [clients, highlightedId]);

  // Global Search navigation — read incoming state
  useEffect(() => {
    const st: any = location.state;
    if (st?.search) {
      const kw = st.search;
      setSearchKeyword(kw);
      setHighlightedId(st.id || null);
      fetchClients(kw);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const handleSearch = (e: any) => {
    const keyword = e.target.value;
    setSearchKeyword(keyword);
    fetchClients(keyword);
  };

  const handleChange = (e: any) => {
    setNewClient({ ...newClient, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editClientId) {
        await withLoading(api.put(`/api/clients/update/${editClientId}`, newClient), "Updating Client...");
      } else {
        await withLoading(api.post("/api/clients/create", newClient), "Saving Client...");
      }
      setNewClient(emptyClient);
      setShowModal(false);
      fetchClients();
      success(editClientId ? "Client updated." : "Client created.");
    } catch (err: any) {
      console.error("Error saving client:", err);
      const errData = err.response?.data;
      const msg = typeof errData === "string"
        ? errData
        : (errData?.error || errData?.message || "Failed to save client.");
      setErrorMessage(msg);
      error(msg);
    }
  };

  const doDelete = async (id: any) => {
    try {
      await withLoading(api.delete(`/api/clients/delete/${id}`), "Deleting Client...");
      fetchClients();
    } catch (err) {
      console.error("Error deleting client:", err);
      setErrorMessage(errText(err, "Failed to delete client."));
    }
  };

  const handleDelete = (id: any) => {
    confirmDialog({
      message: "Archive this client?",
      header: "Archive client",
      icon: "pi pi-exclamation-triangle",
      acceptClassName: "p-button-danger",
      accept: () => doDelete(id),
    });
  };

  const handleRestore = async (id: any) => {
    try {
      await withLoading(api.put(`/api/clients/restore/${id}`, {}), "Restoring Client...");
      fetchClients();
    } catch (err) {
      console.error("Error restoring client:", err);
      setErrorMessage(errText(err, "Failed to restore client."));
    }
  };

  // Document functions
  const openClientDocs = useCallback(async (c: any) => {
    setDocClient(c);
    setShowClientDocs(true);
    setClientDocsLoading(true);
    try {
      const res = await api.get(`/api/documents/by-client/${c.id}`);
      setClientDocs(res.data || []);
    } catch (err) {
      console.error("Error fetching client documents:", err);
      setClientDocs([]);
    } finally {
      setClientDocsLoading(false);
    }
  }, [token]);

  const handleClientDocDownload = async (docId: any, fileName: string) => {
    try {
      const res = await api.get(`/api/documents/download/${docId}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) { console.error("Download error:", err); }
  };

  const handleClientDocPreview = async (docId: any) => {
    try {
      const res = await api.get(`/api/documents/preview/${docId}`, { responseType: "blob" });
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
      await withLoading(api.post("/api/documents/upload", formData), "Uploading Document...");
      setUploadClientDocFile(null);
      openClientDocs(docClient);
      success("Document uploaded.");
    } catch (err: any) {
      console.error("Upload error:", err);
      error(err.response?.data?.error || "Failed to upload the document.");
    }
  };

  const field = (name: string, label: string, placeholder: string, opts: any = {}) => (
    <div className="client-form-field">
      <label htmlFor={`cf-${name}`}>{label}{opts.required && <span className="required"> *</span>}</label>
      <InputText id={`cf-${name}`} name={name} placeholder={placeholder} value={newClient[name] || ""} onChange={handleChange} {...opts} />
    </div>
  );

  const actionsBody = (c: any) => (
    <div className="flex gap-1 align-items-center">
      {showArchived ? (
        hasPermission("CLIENT_EDIT") && (
          <Button size="small" text icon="pi pi-replay" label="Restore" onClick={() => handleRestore(c.id)} />
        )
      ) : (
        <>
          {hasPermission("CLIENT_EDIT") && (
            <Button size="small" text label="Edit" icon="pi pi-pencil" onClick={() => { setNewClient(c); setEditClientId(c.id); setShowModal(true); }} />
          )}
          {hasPermission("CLIENT_EDIT") && (
            <Button size="small" text label="Logins" icon="pi pi-users" tooltip="Logins for this client" onClick={() => setPortalFor(c)} />
          )}
          {hasPermission("CLIENT_DELETE") && (
            <Button size="small" text severity="danger" label="Archive" icon="pi pi-inbox" onClick={() => handleDelete(c.id)} />
          )}
        </>
      )}
      <Button size="small" text rounded icon="pi pi-file-pdf" tooltip="Export PDF" aria-label="Export PDF"
        onClick={() => ReportService.downloadClientDetail(c.id, c.name)} />
    </div>
  );

  const cell = (key: string, dash = false) => (c: any) => {
    const v = dash ? (c[key] || "—") : c[key];
    return <span className="clients-cell" title={v}>{v}</span>;
  };

  return (
    <div className="clients-container">
      <div className="clients-header flex flex-wrap gap-2 align-items-center">
        <IconField iconPosition="left" className="flex-1" style={{ minWidth: 220 }}>
          <InputIcon className="pi pi-search" />
          <InputText className="w-full" placeholder="Search by name, email, or phone" value={searchKeyword} onChange={handleSearch} />
        </IconField>
        {hasPermission("CLIENT_CREATE") && (
          <Button icon="pi pi-plus" label="Add New Client" onClick={() => { setNewClient(emptyClient); setEditClientId(null); setShowModal(true); }} />
        )}
        <Button outlined icon={showArchived ? "pi pi-arrow-left" : "pi pi-inbox"} label={showArchived ? "Back to Active" : "View Archived"}
          onClick={() => setShowArchived(!showArchived)} />
      </div>

      {errorMessage && <Message severity="error" text={errorMessage} className="w-full justify-content-start mb-3" />}

      <Dialog visible={showModal} onHide={() => setShowModal(false)} header={editClientId ? "Edit Client" : "Add New Client"}
        style={{ width: "min(720px, 95vw)" }} modal>
        <form className="client-form" onSubmit={handleSubmit}>
          <p className="client-form-section">Basic Details</p>
          <div className="client-form-row">
            {field("name", "Name", "Name of Client", { required: true })}
            {field("description", "Description", "Short Description about Client.")}
          </div>
          {field("website", "Website", "Enter client's website")}
          <div className="client-form-row">
            {field("email", "Email", "Email address", { required: true, type: "email" })}
            {field("phone", "Phone", "Phone number", { required: true })}
          </div>
          <div className="client-form-row">
            <div className="client-form-field">
              <label htmlFor="cf-billingCurrency">Billing Currency</label>
              <Dropdown inputId="cf-billingCurrency" value={newClient.billingCurrency} options={CURRENCIES}
                onChange={(e) => setNewClient({ ...newClient, billingCurrency: e.value })} />
            </div>
            {field("gstin", "GSTIN", "Enter GST number")}
          </div>

          <p className="client-form-section">Client's Address (Primary)</p>
          <div className="client-form-row">
            {field("building", "Building", "Name of Building")}
            {field("street", "Street", "Name of Street")}
          </div>
          <div className="client-form-row">
            {field("city", "City", "Name of City")}
            {field("district", "District", "Name of District")}
          </div>
          <div className="client-form-row">
            {field("state", "State", "Name of State")}
            {field("pincode", "Pincode", "Enter pin code of the area")}
          </div>
          {field("country", "Country", "Name of Country")}

          <div className="flex justify-content-end gap-2 mt-3">
            <Button type="button" outlined label="Cancel" onClick={() => setShowModal(false)} />
            <Button type="submit" label={editClientId ? "Update Client" : "Save Client"} />
          </div>
        </form>
      </Dialog>

      <div className="clients-table">
        {pageLoading ? (
          <div className="flex flex-column gap-2 p-2">
            {Array.from({ length: Math.min(size, 10) }).map((_, i) => <Skeleton key={i} height="2rem" />)}
          </div>
        ) : clients.length === 0 ? (
          <p className="no-data">No clients found.</p>
        ) : (
          <DataTable value={clients} dataKey="id" size="small" scrollable
            rowClassName={(c: any) => (highlightedId === c.id ? "highlight-row" : "")}>
            <Column header="Name" body={cell("name")} />
            <Column header="Email" body={cell("email")} />
            <Column header="Phone" body={cell("phone")} />
            <Column header="GSTIN" body={cell("gstin", true)} />
            <Column header="City" body={cell("city", true)} />
            <Column header="State" body={cell("state", true)} />
            <Column header="Actions" body={actionsBody} />
          </DataTable>
        )}
        {totalElements > 0 && (
          <Paginator first={page * size} rows={size} totalRecords={totalElements} rowsPerPageOptions={[10, 20, 50, 100]}
            onPageChange={(e) => { if (e.rows !== size) { setSize(e.rows); setPage(0); } else setPage(e.page); }} />
        )}
      </div>

      {/* Client Documents Modal */}
      <Dialog visible={showClientDocs && !!docClient} onHide={() => setShowClientDocs(false)}
        header={`Documents — ${docClient?.name || ""}`} style={{ width: "min(640px, 95vw)" }} modal>
        {clientDocsLoading ? (
          <div className="flex justify-content-center p-3"><ProgressSpinner style={{ width: 36, height: 36 }} /></div>
        ) : (
          <>
            {clientDocs.length === 0 ? (
              <p className="no-data">No documents linked to this client.</p>
            ) : (
              <div className="case-docs-list">
                {clientDocs.map((d) => (
                  <div key={d.id} className="case-doc-item">
                    <i className="pi pi-folder" />
                    <span className="case-doc-name">{d.documentName}</span>
                    <span className="case-doc-meta">{d.category || "Other"}</span>
                    <span className="case-doc-meta">{d.version > 1 ? `v${d.version}` : "v1"}</span>
                    <div className="flex gap-1">
                      <Button text rounded icon="pi pi-eye" tooltip="Preview" onClick={() => handleClientDocPreview(d.id)} />
                      <Button text rounded icon="pi pi-download" tooltip="Download" onClick={() => handleClientDocDownload(d.id, d.originalName || d.documentName)} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2 align-items-center mt-3">
              <input type="file" onChange={(e) => setUploadClientDocFile(e.target.files?.[0] || null)} />
              <Button icon="pi pi-upload" label="Upload" onClick={uploadClientDoc} disabled={!uploadClientDocFile} />
            </div>
          </>
        )}
      </Dialog>
      <ConfirmDialog />
      <ClientPortalAccess client={portalFor} isOpen={!!portalFor} onClose={() => setPortalFor(null)} toast={toast} />
    </div>
  );
}

export default Clients;
