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
import { INDIAN_STATES } from "./Drafting/constants/legal";
import FieldError from "../components/FieldError";
import { formatErrors, gstinError, gstinState, gstinStateMismatch, normaliseCode } from "../utils/validators";

// Checked here as you leave a field, and again on the server (core/validators.py).
const CLIENT_FORMATS = { email: "email", phone: "phone", gstin: "gstin", pincode: "pincode" } as const;
import { usePageModal } from "../utils/pageModal";

// Indian states and UTs, southern states first: the same list drafting uses.
const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ label: s, value: s }));

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
    country: "India",
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
  // People who can take a new client's case, for the "Handling advocate" pick.
  const [handlers, setHandlers] = useState<any[]>([]);
  const canPickHandler = hasPermission("CLIENT_CREATE") || hasPermission("CLIENT_EDIT");
  useEffect(() => {
    if (!showModal || !canPickHandler || handlers.length) return;
    api.get("/api/clients/handlers")
      .then((res: any) => setHandlers(res.data || []))
      .catch(() => { /* the form still works without the pick */ });
  }, [showModal, canPickHandler, handlers.length]);
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
  }, [page, size, showArchived]);

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
  }, [fetchClients, searchKeyword, token]);

  // Quick Actions / Lisa: open the New Client form.
  usePageModal(["create-client"], () => {
    setNewClient(emptyClient);
    setEditClientId(null);
    setShowModal(true);
  });

  // AI Assistant: search
  useEffect(() => {
    const handleSearch = (e: any) => {
      if (e.detail?.query) {
        setSearchKeyword(e.detail.query);
        fetchClients(e.detail.query);
      }
    };
    window.addEventListener("assistant-search", handleSearch);
    return () => {
      window.removeEventListener("assistant-search", handleSearch);
    };
  }, [fetchClients]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a new hand-off; location.state persists, so fetchClients here would re-search on every page change
  }, [location.state]);

  const handleSearch = (e: any) => {
    const keyword = e.target.value;
    setSearchKeyword(keyword);
    fetchClients(keyword);
  };

  const handleChange = (e: any) => {
    const { name, value } = e.target;
    if (name === "gstin") return setGstin(value);
    setNewClient({ ...newClient, [name]: value });
  };

  // Format errors show once a field has been left, or after a save attempt,
  // not while the user is still typing.
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [triedSave, setTriedSave] = useState(false);
  useEffect(() => { if (showModal) { setTouched({}); setTriedSave(false); } }, [showModal]);
  const fmtErrs = formatErrors(newClient, CLIENT_FORMATS as any);
  const errFor = (name: string) => (touched[name] || triedSave ? fmtErrs[name] : "") || "";
  // A valid GSTIN says which state the client is registered in: fill State
  // from it when State is empty (or was filled from the GSTIN before), and
  // warn when someone has picked a different one.
  const setGstin = (raw: string) => {
    const g = normaliseCode(raw);
    setNewClient((prev: any) => {
      const next = { ...prev, gstin: g };
      const fromGstin = !gstinError(g) ? gstinState(g) : "";
      if (fromGstin && (!prev.state || prev.state === gstinState(prev.gstin))) next.state = fromGstin;
      return next;
    });
  };
  const gstinWarn = gstinStateMismatch(newClient.gstin, newClient.state);

  const ADDRESS_PARTS = ["building", "street", "city", "district", "state", "pincode", "country"];
  // Decided when the dialog opens, not per keystroke, so the field doesn't
  // vanish the moment the user starts typing a part.
  const [legacyAddress, setLegacyAddress] = useState(false);
  const openEdit = (c: any) => {
    const legacy = !!(c.address && ADDRESS_PARTS.every((k) => !c[k]));
    // Default the country to India, except for a client whose address is still
    // one saved line: a lone country part would replace that line on save.
    setNewClient({ ...c, handlingAdvocateId: c.handlingAdvocate?.id ?? null,
                   country: c.country || (legacy ? "" : "India") });
    setLegacyAddress(legacy);
    setEditClientId(c.id);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (Object.keys(fmtErrs).length) {
      setTriedSave(true);
      error("Fix the highlighted fields first.");
      return;
    }
    try {
      // handlingAdvocate is the server's read-back; the write field is its id.
      const { handlingAdvocate, ...rest } = newClient;
      const payload = { ...rest, handlingAdvocateId: newClient.handlingAdvocateId ?? null };
      if (editClientId) {
        await withLoading(api.put(`/api/clients/update/${editClientId}`, payload), "Updating Client...");
      } else {
        await withLoading(api.post("/api/clients/create", payload), "Saving Client...");
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
  }, []);

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
      <InputText id={`cf-${name}`} name={name} placeholder={placeholder} value={newClient[name] || ""} onChange={handleChange}
        onBlur={() => setTouched((t) => ({ ...t, [name]: true }))}
        className={errFor(name) ? "p-invalid" : undefined} {...opts} />
      <FieldError error={errFor(name)} warning={name === "gstin" ? gstinWarn : undefined} />
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
            <Button size="small" text label="Edit" icon="pi pi-pencil" onClick={() => openEdit(c)} />
          )}
          {hasPermission("CLIENT_EDIT") && (
            <Button size="small" text label="Logins" icon="pi pi-users" tooltip="Logins for this client" tooltipOptions={{ position: "top" }} onClick={() => setPortalFor(c)} />
          )}
          {hasPermission("CLIENT_DELETE") && (
            <Button size="small" text severity="danger" label="Archive" icon="pi pi-inbox" onClick={() => handleDelete(c.id)} />
          )}
        </>
      )}
      {hasPermission("REPORT_EXPORT") && (
        <Button size="small" text rounded icon="pi pi-file-pdf" tooltip="Export PDF" tooltipOptions={{ position: "top" }} aria-label="Export PDF"
          onClick={() => ReportService.downloadClientDetail(c.id, c.name)} />
      )}
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
            {field("name", "Name", "Name", { required: true })}
            {field("description", "Description", "Short Description about Client.")}
          </div>
          {field("website", "Website", "Website")}
          <div className="client-form-row">
            {field("email", "Email", "Email address", { required: true, type: "email" })}
            {field("phone", "Phone", "Phone number", { required: true })}
          </div>
          {/* Billing currency is always INR for now (set in emptyClient), so no picker. */}
          <div className="client-form-row">
            {field("gstin", "GSTIN", "15 characters, e.g. 33ABCDE1234F1Z7 (leave blank if none)", { maxLength: 15 })}
          </div>
          {canPickHandler && (
            <div className="client-form-row">
              <div className="client-form-field">
                <label htmlFor="cf-handlingAdvocate">Handling Advocate</label>
                <Dropdown inputId="cf-handlingAdvocate" value={newClient.handlingAdvocateId ?? null}
                  options={handlers} optionLabel="name" optionValue="id" showClear filter
                  placeholder="Who will take this client's case?"
                  onChange={(e) => setNewClient({ ...newClient, handlingAdvocateId: e.value ?? null })} />
                <small className="p-text-secondary">They're notified in the app and by email when you save.</small>
              </div>
            </div>
          )}

          <p className="client-form-section">Client's Address (Primary)</p>
          {/* Clients saved before the address was split into parts have only
              this one line. Show it so it can be read and corrected; typing
              the parts below replaces it on save. */}
          {editClientId && legacyAddress && (
            <div className="client-form-row">
              <div className="client-form-field" style={{ flex: 1 }}>
                <label htmlFor="cf-address">Saved address</label>
                <InputText id="cf-address" name="address" value={newClient.address || ""} onChange={handleChange} />
                <small className="p-text-secondary">Saved before the address had separate fields. Fill in the fields below to replace it.</small>
              </div>
            </div>
          )}
          <div className="client-form-row">
            {field("building", "Building", "Building")}
            {field("street", "Street", "Street")}
          </div>
          <div className="client-form-row">
            {field("city", "City", "City")}
            {field("district", "District", "District")}
          </div>
          <div className="client-form-row">
            <div className="client-form-field">
              <label htmlFor="cf-state">State</label>
              {/* Editable, so a value typed before the list existed ("TAMIL NADU") still shows. */}
              <Dropdown inputId="cf-state" value={newClient.state || ""} options={STATE_OPTIONS}
                filter editable placeholder="Select state" appendTo={document.body}
                onChange={(e) => setNewClient({ ...newClient, state: e.value ?? "" })} />
            </div>
            {field("pincode", "Pincode", "6 digits", { maxLength: 6, inputMode: "numeric" })}
          </div>
          {field("country", "Country", "Country")}

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
            <Column header="Advocate" body={(c: any) => {
              const v = c.handlingAdvocate?.name || "—";
              return <span className="clients-cell" title={v}>{v}</span>;
            }} />
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
                      <Button text rounded icon="pi pi-eye" tooltip="Preview" tooltipOptions={{ position: "top" }} onClick={() => handleClientDocPreview(d.id)} />
                      <Button text rounded icon="pi pi-download" tooltip="Download" tooltipOptions={{ position: "top" }} onClick={() => handleClientDocDownload(d.id, d.originalName || d.documentName)} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {hasPermission("DOCUMENT_UPLOAD") && (
              <div className="flex gap-2 align-items-center mt-3">
                <input type="file" onChange={(e) => setUploadClientDocFile(e.target.files?.[0] || null)} />
                <Button icon="pi pi-upload" label="Upload" onClick={uploadClientDoc} disabled={!uploadClientDocFile} />
              </div>
            )}
          </>
        )}
      </Dialog>
      <ConfirmDialog />
      <ClientPortalAccess client={portalFor} isOpen={!!portalFor} onClose={() => setPortalFor(null)} toast={toast} />
    </div>
  );
}

export default Clients;
