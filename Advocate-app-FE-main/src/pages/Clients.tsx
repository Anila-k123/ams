// Clients: the practice's client list. A row opens the client in a wide drawer
// (contact, portal access, their matters, invoices and documents); the form adds
// or edits a client, and the portal dialog manages the client's own logins.
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import ReportService from "../services/ReportService";
import usePagination from "../hooks/usePagination";
import ClientPortalAccess from "../components/ClientPortalAccess";
import DocumentCard from "../components/DocumentCard";
import FilePreviewModal from "../components/FilePreviewModal";
import DocumentSummaryModal from "../components/DocumentSummaryModal";
import { INDIAN_STATES } from "./Drafting/constants/legal";
import FieldError from "../components/FieldError";
import { formatErrors, gstinError, gstinState, gstinStateMismatch, mobileInput, normaliseCode } from "../utils/validators";
import { usePageModal } from "../utils/pageModal";
import { formatCurrency } from "../utils/formatCurrency";
import { Avatar, Button, Chip, EmptyState, Icon, PageHead, PopMenu, Skel, StatusChip, type MenuItem } from "../ui/kit";
import { Field, FilterChip, SearchInput } from "../ui/forms";
import { Drawer, Modal, confirm } from "../ui/overlays";
import { DataTable, type Column } from "../ui/DataTable";
import "../ui/pages/clients.css";
import { DOCUMENT_ACCEPT } from "../utils/fileTypes";

// Checked here as you leave a field, and again on the server (core/validators.py).
const CLIENT_FORMATS = { name: "name", email: "email", phone: "phone", gstin: "gstin", pincode: "pincode" } as const;

const fdate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—";

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
  const navigate = useNavigate();
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
  const { page, setPage, size } = usePagination({ defaultSize: 20, resetOn: [searchKeyword, showArchived] });
  const searchedFromGlobalNav = useRef(!!(location.state as any)?.search);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; client: any } | null>(null);

  // Client drawer state
  const [openClient, setOpenClient] = useState<any>(null);
  const [clientDocs, setClientDocs] = useState<any[]>([]);
  const [clientDocsLoading, setClientDocsLoading] = useState(false);
  const [clientCases, setClientCases] = useState<any[] | null>(null);
  const [clientInvoices, setClientInvoices] = useState<any[] | null>(null);
  const [portalLogins, setPortalLogins] = useState<any[] | null>(null);
  const [uploadClientDocFile, setUploadClientDocFile] = useState<File | null>(null);
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [summaryDoc, setSummaryDoc] = useState<any>(null);

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

  const handleSearch = (keyword: string) => {
    setSearchKeyword(keyword);
    fetchClients(keyword);
  };

  const handleChange = (e: any) => {
    const { name, value } = e.target;
    if (name === "gstin") return setGstin(value);
    // Mobile: only what can be valid (10 digits, starting 6-9) gets into the box.
    setNewClient({ ...newClient, [name]: name === "phone" ? mobileInput(value) : value });
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
      let saved: any = null;
      if (editClientId) {
        saved = await withLoading(api.put(`/api/clients/update/${editClientId}`, payload), "Updating Client...");
      } else {
        await withLoading(api.post("/api/clients/create", payload), "Saving Client...");
      }
      setNewClient(emptyClient);
      setShowModal(false);
      fetchClients();
      // Keep an open drawer in step with the edit.
      if (editClientId && openClient?.id === editClientId) setOpenClient((c: any) => ({ ...c, ...(saved?.data || payload) }));
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
      if (openClient?.id === id) setOpenClient(null);
    } catch (err) {
      console.error("Error deleting client:", err);
      setErrorMessage(errText(err, "Failed to delete client."));
    }
  };

  const handleDelete = (c: any) => {
    confirm({
      title: "Archive this client?",
      message: `${c.name} will be hidden from lists. Their cases, invoices and documents stay as they are. You can restore the client later.`,
      confirmLabel: "Archive client",
      danger: true,
      accept: () => doDelete(c.id),
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

  // ---------------- CLIENT DRAWER ----------------
  const loadClientDocs = useCallback(async (c: any) => {
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

  const openClientDrawer = (c: any) => {
    setOpenClient(c);
    setClientCases(null); setClientInvoices(null); setPortalLogins(null);
    setClientDocs([]); setUploadClientDocFile(null);
    if (hasPermission("DOCUMENT_VIEW")) loadClientDocs(c);
    // No per-client endpoints for these: read the firm's lists and keep this client's rows.
    if (hasPermission("CASE_VIEW")) {
      api.get("/api/cases/my-cases")
        .then((r: any) => setClientCases((r.data || []).filter((x: any) => x.clientId === c.id)))
        .catch(() => setClientCases([]));
    }
    if (hasPermission("INVOICE_VIEW")) {
      api.get("/api/invoices/my-invoices")
        .then((r: any) => setClientInvoices((r.data || []).filter((x: any) => x.clientId === c.id)))
        .catch(() => setClientInvoices([]));
    }
    if (hasPermission("CLIENT_EDIT")) {
      api.get(`/api/clients/${c.id}/logins`)
        .then((r: any) => setPortalLogins(r.data || []))
        .catch(() => setPortalLogins(null));
    }
  };

  const handleClientDocDownload = async (d: any) => {
    try {
      const res = await api.get(`/api/documents/download/${d.id}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = d.originalName || d.documentName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) { console.error("Download error:", err); }
  };

  const handleShareToggle = async (doc: any) => {
    try {
      const r = await api.put(`/api/documents/${doc.id}/client-visible`, { visible: !doc.clientVisible });
      setClientDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, clientVisible: r.data.clientVisible } : d)));
      success(r.data.clientVisible ? `"${doc.documentName}" is now visible to the client.` : `"${doc.documentName}" is no longer shared.`);
    } catch (err: any) {
      error(err.response?.data?.error || "Could not change sharing.");
    }
  };

  // Same confirm and endpoint as the Documents page (DELETE /api/documents/{id}).
  const deleteClientDoc = (doc: any) => confirm({
    title: "Delete this document?",
    message: <><b>{doc.documentName}</b> and its version history will be permanently removed{doc.clientVisible ? ", and the client will no longer see it on the portal" : ""}. This can&apos;t be undone.</>,
    confirmLabel: "Delete document",
    danger: true,
    accept: async () => {
      try {
        await withLoading(api.delete(`/api/documents/${doc.id}`), "Deleting Document...");
        setClientDocs((prev) => prev.filter((d) => d.id !== doc.id));
        if (previewDoc?.id === doc.id) setPreviewDoc(null);
        success("Document deleted.");
      } catch (err: any) {
        error(err.response?.data?.error || "Failed to delete the document.");
      }
    },
  });

  const uploadClientDoc = async () => {
    if (!uploadClientDocFile || !openClient) return;
    const formData = new FormData();
    formData.append("file", uploadClientDocFile);
    formData.append("clientId", openClient.id);
    try {
      await withLoading(api.post("/api/documents/upload", formData), "Uploading Document...");
      setUploadClientDocFile(null);
      loadClientDocs(openClient);
      success("Document uploaded.");
    } catch (err: any) {
      console.error("Upload error:", err);
      error(err.response?.data?.error || "Failed to upload the document.");
    }
  };

  // ---------------- FORM ----------------
  const field = (name: string, label: string, placeholder: string, opts: any = {}) => {
    const { full, hint, ...inputOpts } = opts;
    return (
      <Field label={label} required={inputOpts.required} full={full} hint={hint}>
        {(id, d) => (
          <>
            <input id={id} aria-describedby={d} className="input" name={name} placeholder={placeholder} value={newClient[name] || ""}
              onChange={handleChange} onBlur={() => setTouched((t) => ({ ...t, [name]: true }))}
              aria-invalid={!!errFor(name) || undefined} {...inputOpts} />
            <FieldError error={errFor(name)} warning={name === "gstin" ? gstinWarn : undefined} />
          </>
        )}
      </Field>
    );
  };

  const rowMenu = (c: any): MenuItem[] => {
    const items: MenuItem[] = [{ label: "Open", icon: "eye", onClick: () => openClientDrawer(c) }];
    if (showArchived) {
      if (hasPermission("CLIENT_EDIT")) items.push({ label: "Restore", icon: "restore", onClick: () => handleRestore(c.id) });
    } else if (hasPermission("CLIENT_EDIT")) {
      items.push({ label: "Edit", icon: "edit", onClick: () => openEdit(c) });
      items.push({ label: "Portal access", icon: "key", onClick: () => setPortalFor(c) });
    }
    if (hasPermission("REPORT_EXPORT")) items.push({ label: "Export PDF", icon: "download", onClick: () => ReportService.downloadClientDetail(c.id, c.name) });
    if (!showArchived && hasPermission("CLIENT_DELETE")) items.push("-", { label: "Archive", icon: "archive", danger: true, onClick: () => handleDelete(c) });
    return items;
  };

  const columns: Column<any>[] = [
    { key: "name", label: "Client", render: (c) => (
      <div className="row" style={{ gap: 10, minWidth: 0 }}>
        <Avatar name={c.name} size="sm" />
        <div style={{ minWidth: 0 }}>
          <div className="cell-title ellipsis" title={c.name}>{c.name}{showArchived && <> <Chip>Archived</Chip></>}</div>
          {c.description && <div className="cell-sub ellipsis" style={{ maxWidth: 260 }} title={c.description}>{c.description}</div>}
        </div>
      </div>
    ) },
    { key: "phone", label: "Contact", hideSm: true, render: (c) => (
      <><div className="small nowrap">{c.phone || "—"}</div><div className="cell-sub">{c.email}</div></>
    ) },
    { key: "city", label: "Location", hideSm: true, render: (c) => (
      <>{c.city || <span className="faint">—</span>}{c.state && <div className="cell-sub">{c.state}</div>}</>
    ) },
    { key: "advocate", label: "Handling advocate", hideSm: true, render: (c) => c.handlingAdvocate?.name || <span className="faint">—</span> },
    { key: "gstin", label: "GSTIN", hideSm: true, render: (c) => c.gstin ? <span className="mono xs">{c.gstin}</span> : <span className="faint">—</span> },
    { key: "a", label: <span className="sr-only">Actions</span>, align: "right", render: (c) => (
      <Button size="sm" variant="ghost" iconOnly icon="more" aria-label={`Actions for ${c.name}`} aria-haspopup="menu"
        onClick={(e) => { e.stopPropagation(); setMenu({ anchor: e.currentTarget, client: c }); }} />
    ) },
  ];

  const oc = openClient;
  const portalOn = !!portalLogins?.some((a) => a.isActive);
  const address = oc ? ([oc.building, oc.street, oc.city, oc.district, oc.state, oc.pincode].filter(Boolean).join(", ") || oc.address) : "";
  const billed = (clientInvoices || []).filter((i) => !/CANCEL/i.test(i.status || "")).reduce((s, i) => s + Number(i.amount || 0), 0);
  const outstanding = (clientInvoices || []).filter((i) => !/CANCEL/i.test(i.status || "")).reduce((s, i) => s + Number(i.balance || 0), 0);
  const activeCases = (clientCases || []).filter((x) => !/CLOSED|DISPOSED/i.test(x.status || ""));

  return (
    <div>
      <PageHead title="Clients"
        sub={`${totalElements} ${showArchived ? "archived " : ""}client${totalElements !== 1 ? "s" : ""}. Open a client to see their matters, invoices and documents.`}
        actions={hasPermission("CLIENT_CREATE") && (
          <Button variant="primary" icon="plus" onClick={() => { setNewClient(emptyClient); setEditClientId(null); setShowModal(true); }}>Add client</Button>
        )} />

      <div className="toolbar">
        <SearchInput value={searchKeyword} onChange={handleSearch} placeholder="Search name, email or phone" aria-label="Search clients" />
        <FilterChip on={showArchived} onClick={() => setShowArchived(!showArchived)}><Icon name="archive" size="sm" />Show archived</FilterChip>
      </div>

      {errorMessage && <div className="callout bad" style={{ marginBottom: "var(--s4)" }}><Icon name="warn" size="sm" /><span>{errorMessage}</span></div>}

      <div className="clients-table">
        <DataTable rows={clients} columns={columns} rowKey={(c) => c.id} loading={pageLoading} caption="Clients"
          page={page} total={totalElements} onPage={setPage} pageSize={size}
          onRow={openClientDrawer}
          rowClass={(c) => (highlightedId === c.id ? "highlight-row" : undefined)}
          empty={searchKeyword
            ? { icon: "search", title: "No clients match", text: "Try a different name, email or phone number." }
            : showArchived ? { icon: "archive", title: "No archived clients" }
              : { icon: "users", title: "No clients yet", text: "Add your first client to open matters and raise invoices." }} />
      </div>
      {menu && <PopMenu anchor={menu.anchor} items={rowMenu(menu.client)} onClose={() => setMenu(null)} align="right" />}

      {/* Add / edit client */}
      <Modal open={showModal} onClose={() => setShowModal(false)} size="wide"
        title={editClientId ? "Edit client" : "Add client"}
        sub={editClientId ? newClient.name : "Contact details, GST registration and the advocate who will handle the matter."}
        footer={<>
          <Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button type="submit" variant="primary" form="client-form">{editClientId ? "Update client" : "Save client"}</Button>
        </>}>
        <form id="client-form" className="form-grid cl-form" onSubmit={handleSubmit} noValidate>
          <p className="cl-form-section">Basic details</p>
          {field("name", "Name", "e.g. K. M. Anand Joshi, M/s. Akshayam Traders", { required: true, maxLength: 150, hint: "2–150 characters, e.g. initials, & Ors., M/s." })}
          {field("description", "Description", "Short description about the client")}
          {field("website", "Website", "Website", { full: true })}
          {field("email", "Email", "name@example.com", { required: true, type: "email" })}
          {field("phone", "Mobile", "98765 43210", { required: true, type: "tel", inputMode: "numeric", maxLength: 10, autoComplete: "tel-national", hint: "10 digits, starting with 6, 7, 8 or 9." })}
          {/* Billing currency is always INR for now (set in emptyClient), so no picker. */}
          {field("gstin", "GSTIN", "e.g. 33ABCDE1234F1Z7", { maxLength: 15, hint: "15 characters. Leave blank if none.", className: "input mono" })}
          {canPickHandler && (
            <Field label="Handling advocate" hint="They're notified in the app and by email when you save.">
              {(id, d) => (
                <select id={id} aria-describedby={d} className="input" value={newClient.handlingAdvocateId ?? ""}
                  onChange={(e) => setNewClient({ ...newClient, handlingAdvocateId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Who will take this client&apos;s case?</option>
                  {handlers.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              )}
            </Field>
          )}

          <p className="cl-form-section">Client&apos;s address (primary)</p>
          {/* Clients saved before the address was split into parts have only
              this one line. Show it so it can be read and corrected; typing
              the parts below replaces it on save. */}
          {editClientId && legacyAddress && (
            <Field label="Saved address" full hint="Saved before the address had separate fields. Fill in the fields below to replace it.">
              {(id, d) => <input id={id} aria-describedby={d} className="input" name="address" value={newClient.address || ""} onChange={handleChange} />}
            </Field>
          )}
          {field("building", "Building", "Building")}
          {field("street", "Street", "Street")}
          {field("city", "City", "City")}
          {field("district", "District", "District")}
          {/* A free-typed value ("TAMIL NADU") from before the list existed still shows. */}
          <Field label="State">
            {(id) => (
              <>
                <input id={id} className="input" list="cl-states" placeholder="Select state" value={newClient.state || ""}
                  onChange={(e) => setNewClient({ ...newClient, state: e.target.value })} />
                <datalist id="cl-states">{INDIAN_STATES.map((s: string) => <option key={s} value={s} />)}</datalist>
              </>
            )}
          </Field>
          {field("pincode", "Pincode", "6 digits", { maxLength: 6, inputMode: "numeric" })}
          {field("country", "Country", "Country")}
        </form>
      </Modal>

      {/* Client detail */}
      <Drawer open={!!oc} onClose={() => setOpenClient(null)} wide title="Client"
        footer={oc && <>
          {hasPermission("REPORT_EXPORT") && <Button icon="download" onClick={() => ReportService.downloadClientDetail(oc.id, oc.name)}>Export PDF</Button>}
          <Button variant="primary" onClick={() => setOpenClient(null)}>Done</Button>
        </>}>
        {oc && (
          <>
            <div className="cl-head">
              <Avatar name={oc.name} size="lg" />
              <div className="grow">
                <div className="row wrap" style={{ gap: 8 }}>
                  <Chip plain>{oc.gstin ? "GST registered" : "Client"}</Chip>
                  {showArchived && <Chip>Archived</Chip>}
                  {portalLogins && (portalOn ? <Chip tone="ok">Portal access on</Chip> : <Chip>No portal access</Chip>)}
                  {oc.createdAt && <span className="faint small">Client since {new Date(oc.createdAt).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</span>}
                </div>
                <h2>{oc.name}</h2>
                {oc.description && <p className="muted small" style={{ marginBottom: 8 }}>{oc.description}</p>}
                <div className="meta-line">
                  {oc.phone && <span><Icon name="phone" size="sm" /><a className="link" href={`tel:${oc.phone}`}>{oc.phone}</a></span>}
                  {oc.email && <span><Icon name="mail" size="sm" /><a className="link" href={`mailto:${oc.email}`}>{oc.email}</a></span>}
                  {address && <span><Icon name="pin" size="sm" />{address}</span>}
                  {oc.handlingAdvocate?.name && <span><Icon name="user" size="sm" />{oc.handlingAdvocate.name}</span>}
                  {oc.gstin && <span className="mono">GSTIN {oc.gstin}</span>}
                  {oc.website && <span><Icon name="globe" size="sm" />{oc.website}</span>}
                </div>
              </div>
              {!showArchived && hasPermission("CLIENT_EDIT") && (
                <div className="row wrap" style={{ gap: 8 }}>
                  <Button icon="edit" onClick={() => openEdit(oc)}>Edit</Button>
                  <Button icon="globe" onClick={() => setPortalFor(oc)}>Portal access</Button>
                </div>
              )}
            </div>

            <div className="figures">
              {hasPermission("CASE_VIEW") && (
                <div className="figure"><div className="lbl">Active matters</div>
                  <div className="val">{clientCases ? activeCases.length : "…"}</div>
                  <div className="meta">{clientCases ? `${clientCases.length} in total` : "Loading"}</div></div>
              )}
              {hasPermission("INVOICE_VIEW") && <>
                <div className="figure"><div className="lbl">Billed</div>
                  <div className="val">{clientInvoices ? formatCurrency(billed) : "…"}</div>
                  <div className="meta">{clientInvoices ? `${clientInvoices.length} invoice${clientInvoices.length !== 1 ? "s" : ""}` : "Loading"}</div></div>
                <div className="figure"><div className="lbl">Outstanding</div>
                  <div className="val">{clientInvoices ? formatCurrency(outstanding) : "…"}</div>
                  <div className="meta">{outstanding ? "Unpaid on invoices" : "Nothing due"}</div></div>
              </>}
              {hasPermission("DOCUMENT_VIEW") && (
                <div className="figure"><div className="lbl">Documents</div>
                  <div className="val">{clientDocsLoading ? "…" : clientDocs.length}</div>
                  <div className="meta">{clientDocs.filter((d) => d.clientVisible).length} shared on the portal</div></div>
              )}
            </div>

            {hasPermission("CASE_VIEW") && (
              <section className="cl-section">
                <h3>Matters <span className="faint small">{clientCases?.length ?? ""}</span></h3>
                <DataTable rows={clientCases || []} loading={!clientCases} rowKey={(x) => x.id} pageSize={8} caption="Matters"
                  onRow={(x) => navigate(`/dashboard/cases/${x.id}`)}
                  columns={[
                    { key: "caseNumber", label: "Case", render: (x) => <><div className="mono small cell-title">{x.caseNumber}</div><div className="cell-sub ellipsis" style={{ maxWidth: 280 }}>{x.caseTitle}</div></> },
                    { key: "courtLevel", label: "Court", hideSm: true, render: (x) => x.courtLevel || <span className="faint">—</span> },
                    { key: "pendingFromClient", label: "Fee due", align: "right", render: (x) => Number(x.pendingFromClient) > 0 ? <span className="mono">{formatCurrency(x.pendingFromClient)}</span> : <span className="faint">Nil</span> },
                    { key: "status", label: "Status", render: (x) => <StatusChip status={x.status} /> },
                  ]}
                  empty={{ icon: "case", title: "No matters yet", text: "Open a case for this client to start tracking hearings." }} />
              </section>
            )}

            {hasPermission("INVOICE_VIEW") && (
              <section className="cl-section">
                <h3>Invoices <span className="faint small">{clientInvoices?.length ?? ""}</span></h3>
                <DataTable rows={clientInvoices || []} loading={!clientInvoices} rowKey={(i) => i.id} pageSize={8} caption="Invoices"
                  columns={[
                    { key: "invoiceNumber", label: "Invoice no", render: (i) => <span className="mono small">{i.invoiceNumber}</span> },
                    { key: "caseTitle", label: "Case", hideSm: true, render: (i) => i.caseEntity?.caseNumber ? <span className="mono small">{i.caseEntity.caseNumber}</span> : (i.caseTitle || <span className="faint">—</span>) },
                    { key: "invoiceDate", label: "Date", render: (i) => fdate(i.invoiceDate) },
                    { key: "amount", label: "Total", align: "right", render: (i) => <span className="mono">{formatCurrency(i.amount)}</span> },
                    { key: "status", label: "Status", render: (i) => <StatusChip status={i.status} /> },
                  ]}
                  empty={{ icon: "receipt", title: "No invoices yet" }} />
              </section>
            )}

            {hasPermission("DOCUMENT_VIEW") && (
              <section className="cl-section">
                <div className="row between wrap" style={{ gap: 8, marginBottom: 8 }}>
                  <h3 style={{ fontSize: "var(--t-md)" }}>Documents</h3>
                  {hasPermission("DOCUMENT_UPLOAD") && (
                    <div className="row wrap" style={{ gap: 6 }}>
                      <label className="btn sm">
                        <Icon name="file" size="sm" />{uploadClientDocFile ? <span className="ellipsis" style={{ maxWidth: 160 }}>{uploadClientDocFile.name}</span> : "Choose file"}
                        <input type="file" accept={DOCUMENT_ACCEPT} hidden onChange={(e) => setUploadClientDocFile(e.target.files?.[0] || null)} aria-label="Document to upload" />
                      </label>
                      <Button size="sm" variant="primary" icon="upload" onClick={uploadClientDoc} disabled={!uploadClientDocFile}>Upload</Button>
                    </div>
                  )}
                </div>
                <p className="faint xs" style={{ marginBottom: 10 }}>Shared documents appear on the client&apos;s portal.</p>
                {clientDocsLoading ? (
                  <div className="doc-grid">{[1, 2, 3].map((i) => <Skel key={i} h={200} />)}</div>
                ) : clientDocs.length === 0 ? (
                  <EmptyState icon="folder" title="No documents" text="No documents are linked to this client yet." />
                ) : (
                  <div className="doc-grid">
                    {clientDocs.map((d) => (
                      <DocumentCard key={d.id} doc={d} onPreview={setPreviewDoc} onDownload={handleClientDocDownload}
                        onSummary={setSummaryDoc}
                        onShareToggle={hasPermission("DOCUMENT_EDIT") ? handleShareToggle : undefined}
                        onDelete={hasPermission("DOCUMENT_DELETE") ? deleteClientDoc : undefined} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </Drawer>

      {previewDoc && (
        <FilePreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} onDownload={handleClientDocDownload}
          onSummary={setSummaryDoc}
          onShareToggle={hasPermission("DOCUMENT_EDIT") ? (d: any) => {
            handleShareToggle(d);
            setPreviewDoc((p: any) => (p && p.id === d.id ? { ...p, clientVisible: !p.clientVisible } : p));
          } : undefined} />
      )}
      {summaryDoc && <DocumentSummaryModal doc={summaryDoc} onClose={() => setSummaryDoc(null)} canRegenerate={hasPermission("DOCUMENT_EDIT")} />}
      <ClientPortalAccess client={portalFor} isOpen={!!portalFor} onClose={() => setPortalFor(null)} toast={toast}
        onChanged={(acc) => { if (openClient && portalFor?.id === openClient.id) setPortalLogins(acc); }} />
    </div>
  );
}

export default Clients;
