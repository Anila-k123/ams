import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { Paginator } from "primereact/paginator";
import { Skeleton } from "primereact/skeleton";
import { ProgressSpinner } from "primereact/progressspinner";
import { Tag } from "primereact/tag";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import { formatCurrency } from "../utils/formatCurrency";
import usePagination from "../hooks/usePagination";
import "../assets/styles/Cases.css";

const SORT_OPTIONS = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "caseNumber:asc", label: "Case No (A→Z)" },
  { value: "caseTitle:asc", label: "Title (A→Z)" },
  { value: "status:asc", label: "Status" },
];
const STATUS_OPTIONS = ["Active", "Pending", "Closed"].map((v) => ({ value: v, label: v }));
const COURT_OPTIONS = ["District", "High Court", "Supreme Court"].map((v) => ({ value: v, label: v }));

const STATUS_SEVERITY: Record<string, any> = { active: "success", pending: "warning", closed: "secondary" };

function formatHearing(dateStr: any) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// First party name from a court "Petitioner/Respondent Details" blob (text before the first comma).
function firstParty(blob: any) {
  if (!blob) return "";
  return String(blob).split(",")[0].trim();
}

// Map an official court case record into the Add Case form fields.
function mapCourtRecordToCase(record: any, searchedType: any) {
  const f = (record && record.fields) || {};
  const pet = firstParty(f["Petitioner Details"]);
  const res = firstParty(f["Respondent Details"]);
  const title = pet && res ? `${pet} vs ${res}` : (f["Registration No"] || "");

  const stage = (f["Stage"] || "").toLowerCase();
  let status = "Active";
  if (/dispos|dismiss|withdraw|closed|allowed|rejected/.test(stage)) status = "Closed";
  else if (/pending/.test(stage)) status = "Pending";

  const desc: string[] = [];
  if (f["Registration No"]) desc.push(`Reg No: ${f["Registration No"]}`);
  if (f["Subject"]) desc.push(`Subject: ${f["Subject"]}`);
  if (f["Nature of Writ"]) desc.push(`Nature: ${f["Nature of Writ"]}`);
  if (f["Stage"]) desc.push(`Stage: ${f["Stage"]}`);

  return {
    caseNumber: (f["CNR"] || "").trim(),
    caseType: searchedType || "",
    caseTitle: title,
    courtLevel: "High Court",
    status,
    description: desc.join("\n"),
  };
}

const EMPTY_CASE = { caseNumber: "", caseTitle: "", caseType: "", courtLevel: "", status: "", amount: "", description: "", clientId: "" };

function Cases() {
  const [cases, setCases] = useState<any[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [clients, setClients] = useState<any[]>([]);
  const location = useLocation();
  const navigate = useNavigate();
  const [newCase, setNewCase] = useState<any>(EMPTY_CASE);
  const [showModal, setShowModal] = useState(false);
  const [editCaseId, setEditCaseId] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [caseNumberError, setCaseNumberError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [highlightedId, setHighlightedId] = useState<any>(null);

  // Filters + sort
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCourt, setFilterCourt] = useState("");
  const [sort, setSort] = useState("createdAt:desc");

  // Workspace enrichment
  const [stats, setStats] = useState<any>(null);
  const [tagsByCase, setTagsByCase] = useState<any>({});
  const [nextHearings, setNextHearings] = useState<any>({});

  const { token } = useAuth();
  const { withLoading } = useLoading() as any;
  const { success, error } = useToast() as any;
  const { hasPermission } = usePermission() as any;
  const { page, setPage, size, setSize } = (usePagination as any)({ defaultSize: 20, resetOn: [searchKeyword, showArchived, filterStatus, filterCourt, sort] });
  const [pageLoading, setPageLoading] = useState(true);
  const searchedFromGlobalNav = useRef(!!(location.state as any)?.search);

  // Document modal state
  const [showCaseDocs, setShowCaseDocs] = useState(false);
  const [docCase, setDocCase] = useState<any>(null);
  const [caseDocs, setCaseDocs] = useState<any[]>([]);
  const [caseDocsLoading, setCaseDocsLoading] = useState(false);
  const [uploadDocFile, setUploadDocFile] = useState<any>(null);

  // ---------------- COURT LOOKUP (prefill Add Case from the official record) ----------------
  const [lkCourts, setLkCourts] = useState<any[]>([]);
  const [lkCourtId, setLkCourtId] = useState("");
  const [lkTypes, setLkTypes] = useState<any>({});
  const [lkType, setLkType] = useState<any>(null);
  const [lkNumber, setLkNumber] = useState("");
  const [lkYear, setLkYear] = useState("");
  const [lkLoading, setLkLoading] = useState(false);
  const [lkTypesLoading, setLkTypesLoading] = useState(false);
  const [lkError, setLkError] = useState("");
  const [lkInfo, setLkInfo] = useState("");
  const [caseMode, setCaseMode] = useState<any>(null);   // null | 'manual' | 'import'
  const [lkFetched, setLkFetched] = useState(false);

  // Load the court list the first time the Add-Case modal opens.
  useEffect(() => {
    if (!showModal || editCaseId || lkCourts.length) return;
    (async () => {
      try {
        const res = await api.get("/api/courtsearch/courts");
        setLkCourts(res.data || []);
        if (res.data && res.data.length) setLkCourtId(res.data[0].court_id);
      } catch { /* lookup is optional; leave the panel empty on failure */ }
    })();
  }, [showModal, editCaseId]);

  // Load case types whenever the lookup court changes.
  useEffect(() => {
    if (!lkCourtId) return;
    setLkType(null);
    setLkTypes({});
    setLkTypesLoading(true);
    (async () => {
      try {
        const res = await api.get(`/api/courtsearch/courts/${lkCourtId}/case-types`);
        setLkTypes(res.data || {});
      } catch { /* ignore */ }
      finally { setLkTypesLoading(false); }
    })();
  }, [lkCourtId]);

  // Reset lookup inputs and the add-mode each time the modal closes.
  useEffect(() => {
    if (!showModal) {
      setLkError(""); setLkInfo(""); setLkNumber(""); setLkYear(""); setLkType(null);
      setCaseMode(null); setLkFetched(false);
    }
  }, [showModal]);

  const handleCourtFetch = async () => {
    if (!lkCourtId || !lkType || !lkNumber.trim() || !lkYear) return;
    setLkLoading(true); setLkError(""); setLkInfo("");
    try {
      const res = await api.post("/api/courtsearch/search", {
        court_id: lkCourtId,
        case_type: lkType.value,
        case_number: lkNumber.trim(),
        case_year: Number(lkYear),
      });
      const mapped = mapCourtRecordToCase(res.data, lkType.value);
      setNewCase((prev: any) => ({ ...prev, ...mapped }));
      setCaseNumberError(mapped.caseNumber.length !== 16 ? "Case Number must be exactly 16 digits." : "");
      const reg = res.data?.fields?.["Registration No"];
      setLkInfo(`Prefilled from court record${reg ? ` — ${reg}` : ""}. Review the fields and choose a client.`);
      setLkFetched(true);
      success && success("Case details fetched from the court.");
    } catch (err: any) {
      setLkError(err?.response?.data?.error || "Lookup failed. Please try again.");
    } finally {
      setLkLoading(false);
    }
  };

  // ---------------- FETCH CASES ----------------
  const fetchCases = useCallback(async () => {
    setPageLoading(true);
    try {
      const [sortBy, sortDir] = sort.split(":");
      const params: any = { page, size, sortBy, sortDir };
      if (searchKeyword.trim()) params.keyword = searchKeyword;
      if (showArchived) params.archived = true;
      if (filterStatus) params.status = filterStatus;
      if (filterCourt) params.courtLevel = filterCourt;
      const response = await api.get("/api/cases", { params });
      setCases(response.data.content || []);
      setTotalPages(response.data.totalPages || 0);
      setTotalElements(response.data.totalElements || 0);
      setErrorMessage("");
    } catch (err: any) {
      console.error("Error fetching cases:", err);
      const errData = err.response?.data;
      setErrorMessage(typeof errData === "string" ? errData : (errData?.message || "Failed to fetch cases."));
    } finally {
      setPageLoading(false);
    }
  }, [token, page, size, searchKeyword, showArchived, filterStatus, filterCourt, sort]);

  // ---------------- FETCH CLIENTS ----------------
  const fetchClients = async () => {
    try {
      const response = await api.get("/api/clients/my-clients");
      setClients(response.data);
    } catch (err) {
      console.error("Error fetching clients:", err);
      setErrorMessage("Failed to fetch clients. Check server/CORS.");
    }
  };

  // ---------------- FETCH WORKSPACE ENRICHMENT ----------------
  const fetchWorkspaceMeta = useCallback(async () => {
    try {
      const [statsRes, tagsRes, hearingsRes] = await Promise.all([
        api.get("/api/workspace/stats"),
        api.get("/api/workspace/tags"),
        api.get("/api/workspace/next-hearings"),
      ]);
      setStats(statsRes.data);
      setTagsByCase(tagsRes.data?.tagsByCase || {});
      setNextHearings(hearingsRes.data || {});
    } catch (err) {
      console.error("Error fetching workspace meta:", err);
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      setErrorMessage("Please login first.");
      return;
    }
    fetchClients();
    fetchWorkspaceMeta();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    if (searchedFromGlobalNav.current) {
      searchedFromGlobalNav.current = false;
      return;
    }
    fetchCases();
  }, [fetchCases, token]);

  // AI Assistant: open create-case modal + search
  useEffect(() => {
    const handleModal = (e: any) => {
      if (e.detail === "create-case") {
        setShowModal(true);
        setEditCaseId(null);
      }
    };
    const handleSearch = (e: any) => {
      if (e.detail?.query) {
        const keyword = e.detail.query;
        setSearchKeyword(keyword);
        if (!keyword.trim()) {
          fetchCases();
          return;
        }
        api.get(`/api/cases/search?keyword=${keyword}`)
          .then(res => setCases(res.data)).catch(() => {});
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
    const st: any = location.state;
    if (st?.search) {
      const kw = st.search;
      setSearchKeyword(kw);
      setHighlightedId(st.id || null);
      if (!kw.trim()) { fetchCases(); return; }
      api.get(`/api/cases/search?keyword=${encodeURIComponent(kw)}`)
        .then(res => setCases(res.data)).catch(() => {});
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const setField = (name: string, value: any) => {
    setNewCase({ ...newCase, [name]: value });
    if (name === "caseNumber") {
      setCaseNumberError(value.length !== 16 ? "Case Number must be exactly 16 digits." : "");
    }
  };
  const handleChange = (e: any) => setField(e.target.name, e.target.value);

  // ---------------- CREATE/UPDATE CASE ----------------
  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!token) { setErrorMessage("Please login first."); return; }
    // Dropdowns carry no native `required`, so check them here.
    if (!newCase.courtLevel || !newCase.status) { setErrorMessage("Please select the court level and status."); return; }
    if (!newCase.clientId) { setErrorMessage("Please choose a client for this case."); return; }
    if (newCase.caseNumber.length !== 16) {
      setCaseNumberError("Case Number must be exactly 16 digits.");
      return;
    }

    const caseToSend = {
      ...newCase,
      amount: newCase.amount ? parseFloat(newCase.amount) : 0,
      client: { id: Number(newCase.clientId) },
    };

    try {
      if (editCaseId) {
        await withLoading(api.put(`/api/cases/update/${editCaseId}`, caseToSend), "Updating Case...");
        setEditCaseId(null);
      } else {
        await withLoading(api.post("/api/cases/create", caseToSend), "Creating Case...");
      }
      setNewCase(EMPTY_CASE);
      setShowModal(false);
      setCaseNumberError("");
      fetchCases();
      fetchWorkspaceMeta();
      setErrorMessage("");
      success(editCaseId ? "Case updated." : "Case created.");
    } catch (err: any) {
      console.error("Error saving case:", err);
      if (err.response?.status === 409) {
        setCaseNumberError("Case number already exists.");
        error("Case number already exists.");
      } else {
        const msg = typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "Failed to save case.";
        setErrorMessage(msg);
        error(msg);
      }
    }
  };

  const handleEdit = (caseData: any) => {
    setNewCase({
      caseNumber: caseData.caseNumber || "",
      caseTitle: caseData.caseTitle || "",
      caseType: caseData.caseType || "",
      courtLevel: caseData.courtLevel || "",
      status: caseData.status || "",
      amount: caseData.amount || "",
      description: caseData.description || "",
      clientId: caseData.clientId ? String(caseData.clientId) : "",
    });
    setEditCaseId(caseData.id);
    setShowModal(true);
  };

  const handleDelete = async (id: any) => {
    if (!token) { setErrorMessage("Please login first."); return; }
    try {
      await withLoading(api.delete(`/api/cases/delete/${id}`), showArchived ? "Deleting Case..." : "Archiving Case...");
      fetchCases();
      setErrorMessage("");
    } catch (err: any) {
      console.error("Error deleting case:", err);
      const errData = err.response?.data;
      setErrorMessage(typeof errData === "string" ? errData : (errData?.message || "Failed to archive case."));
    }
  };

  const handleRestore = async (id: any) => {
    if (!token) { setErrorMessage("Please login first."); return; }
    try {
      await withLoading(api.put(`/api/cases/restore/${id}`, {}), "Restoring Case...");
      fetchCases();
      setErrorMessage("");
    } catch (err: any) {
      console.error("Error restoring case:", err);
      const errData = err.response?.data;
      setErrorMessage(typeof errData === "string" ? errData : (errData?.message || "Failed to restore case."));
    }
  };

  // Document functions
  const openCaseDocs = useCallback(async (c: any) => {
    setDocCase(c);
    setShowCaseDocs(true);
    setCaseDocsLoading(true);
    try {
      const res = await api.get(`/api/documents/by-case/${c.id}`);
      setCaseDocs(res.data || []);
    } catch (err) {
      console.error("Error fetching case documents:", err);
      setCaseDocs([]);
    } finally {
      setCaseDocsLoading(false);
    }
  }, [token]);

  const handleDocDownload = async (docId: any, fileName: string) => {
    try {
      const res = await api.get(`/api/documents/download/${docId}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) { console.error("Download error:", err); }
  };

  const handleDocPreview = async (docId: any) => {
    try {
      const res = await api.get(`/api/documents/preview/${docId}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      window.open(url, "_blank");
    } catch (err) { console.error("Preview error:", err); }
  };

  const uploadCaseDoc = async () => {
    if (!uploadDocFile || !docCase) return;
    const formData = new FormData();
    formData.append("file", uploadDocFile);
    formData.append("caseId", docCase.id);
    try {
      await withLoading(api.post("/api/documents/upload", formData), "Uploading Document...");
      setUploadDocFile(null);
      openCaseDocs(docCase);
      success("Document uploaded.");
    } catch (err: any) {
      console.error("Upload error:", err);
      error(err.response?.data?.error || "Failed to upload the document.");
    }
  };

  const goToCase = (id: any) => navigate(`/dashboard/cases/${id}`);

  // Scroll the row a global search pointed at into view once it renders.
  useEffect(() => {
    if (!highlightedId || pageLoading) return;
    const el = document.querySelector(".cases-table .highlight-row");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedId, cases, pageLoading]);

  const STAT_CARDS = stats ? [
    { key: "total", label: "Total Cases", value: stats.totalCases, icon: "pi pi-briefcase", accent: "var(--primary)" },
    { key: "active", label: "Active", value: stats.activeCases, icon: "pi pi-check-circle", accent: "var(--success)" },
    { key: "pending", label: "Pending", value: stats.pendingCases, icon: "pi pi-clock", accent: "var(--warning)" },
    { key: "hearings", label: "Upcoming Hearings", value: stats.upcomingHearings, icon: "pi pi-calendar", accent: "#A855F7" },
    { key: "dues", label: "Outstanding Dues", value: formatCurrency(stats.outstandingDues), icon: "pi pi-indian-rupee", accent: "var(--danger)" },
  ] : [];

  const clientOptions = clients.map((c) => ({ value: c.id, label: `${c.name} — ${c.email}` }));
  const lkTypeOptions = Object.keys(lkTypes).sort().map((k) => ({ value: k, label: k }));

  const actionsBody = (c: any) => (
    <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
      <Button icon="pi pi-external-link" rounded text size="small" onClick={() => goToCase(c.id)} tooltip="Open workspace" tooltipOptions={{ position: "top" }} />
      {showArchived ? (
        hasPermission("CASE_EDIT") && (
          <Button icon="pi pi-replay" rounded text severity="success" size="small" onClick={() => handleRestore(c.id)} tooltip="Restore" tooltipOptions={{ position: "top" }} />
        )
      ) : (
        <>
          {hasPermission("CASE_EDIT") && (
            <Button icon="pi pi-pencil" rounded text size="small" onClick={() => handleEdit(c)} tooltip="Edit" tooltipOptions={{ position: "top" }} />
          )}
          {hasPermission("CASE_DELETE") && (
            <Button icon="pi pi-trash" rounded text severity="danger" size="small" onClick={() => handleDelete(c.id)} tooltip="Archive" tooltipOptions={{ position: "top" }} />
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="cases-container">
      {errorMessage && <p className="error-message">{errorMessage}</p>}

      {/* Dashboard cards */}
      {!showArchived && stats && (
        <div className="cases-stats">
          {STAT_CARDS.map((card) => (
            <div className="case-stat-card" key={card.key}>
              <div className="case-stat-icon" style={{ color: card.accent, background: `color-mix(in srgb, ${card.accent} 12%, transparent)` }}>
                <i className={card.icon} />
              </div>
              <div className="case-stat-body">
                <span className="case-stat-value">{card.value}</span>
                <span className="case-stat-label">{card.label}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Top Actions */}
      <div className="flex flex-wrap align-items-center gap-2 mb-3">
        {hasPermission("CASE_CREATE") && (
          <Button label="Add New Case" icon="pi pi-plus" onClick={() => navigate("/dashboard/cases/new")} />
        )}
        <span className="p-input-icon-left flex-1" style={{ minWidth: 220 }}>
          <i className="pi pi-search" />
          <InputText
            className="w-full"
            placeholder="Search by case number, client name, or email"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
          />
        </span>
        <Button
          outlined
          icon={showArchived ? "pi pi-arrow-left" : "pi pi-inbox"}
          label={showArchived ? "Back to Active" : "View Archived"}
          onClick={() => setShowArchived(!showArchived)}
        />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap align-items-center gap-2 mb-3">
        <Dropdown placeholder="All Statuses" value={filterStatus} options={[{ value: "", label: "All Statuses" }, ...STATUS_OPTIONS]}
          onChange={(e) => setFilterStatus(e.value)} />
        <Dropdown placeholder="All Courts" value={filterCourt} options={[{ value: "", label: "All Courts" }, ...COURT_OPTIONS]}
          onChange={(e) => setFilterCourt(e.value)} />
        <Dropdown value={sort} options={SORT_OPTIONS} onChange={(e) => setSort(e.value)} />
        {(filterStatus || filterCourt) && (
          <Button text label="Clear filters" onClick={() => { setFilterStatus(""); setFilterCourt(""); }} />
        )}
      </div>

      {/* Add / Edit modal */}
      <Dialog
        header={editCaseId ? "Edit Case" : "Add New Case"}
        visible={showModal}
        onHide={() => setShowModal(false)}
        style={{ width: "560px" }}
        breakpoints={{ "640px": "95vw" }}
        dismissableMask
      >
        {/* Step 1 — choose how to add a new case */}
        {!editCaseId && !caseMode && (
          <div className="flex flex-column gap-2">
            <button type="button" className="case-mode-card" onClick={() => setCaseMode("manual")}>
              <i className="pi pi-pencil case-mode-icon" />
              <span className="case-mode-title">Add Manually</span>
              <span className="case-mode-desc">Type in the case details yourself.</span>
            </button>
            <button type="button" className="case-mode-card" onClick={() => setCaseMode("import")}>
              <i className="pi pi-building-columns case-mode-icon" />
              <span className="case-mode-title">Import from Court Records</span>
              <span className="case-mode-desc">Fetch the official record and prefill the form.</span>
            </button>
            <Button type="button" label="Cancel" text severity="secondary" onClick={() => setShowModal(false)} />
          </div>
        )}

        {/* Step 2 — the chosen flow */}
        {(editCaseId || caseMode) && (
          <>
            {!editCaseId && (
              <Button type="button" text size="small" icon="pi pi-arrow-left" label="Back" className="mb-2"
                onClick={() => { setCaseMode(null); setLkFetched(false); setLkError(""); setLkInfo(""); }} />
            )}

            {caseMode === "import" && !editCaseId && (
              <div className="court-import">
                <div className="court-import-head">Find the case on the court record</div>
                <div className="grid">
                  <div className="col-12 md:col-6">
                    <Dropdown className="w-full"
                      options={lkCourts.map((c) => ({ value: c.court_id, label: c.name }))}
                      value={lkCourtId || null}
                      onChange={(e) => setLkCourtId(e.value || "")}
                      placeholder="Court" />
                  </div>
                  <div className="col-12 md:col-6">
                    <Dropdown className="w-full" filter
                      options={lkTypeOptions}
                      value={lkType ? lkType.value : null}
                      onChange={(e) => setLkType(e.value ? { value: e.value, label: e.value } : null)}
                      placeholder={lkTypesLoading ? "Loading types…" : "Case type"}
                      loading={lkTypesLoading} />
                  </div>
                  <div className="col-6 md:col-4">
                    <InputText className="w-full" placeholder="Case number" value={lkNumber} onChange={(e) => setLkNumber(e.target.value)} />
                  </div>
                  <div className="col-6 md:col-4">
                    <InputText className="w-full" type="number" placeholder="Year" value={lkYear} min="1900" max="2100"
                      onChange={(e) => setLkYear(e.target.value)} />
                  </div>
                  <div className="col-12 md:col-4">
                    <Button type="button" className="w-full" label={lkLoading ? "Fetching…" : "Fetch"} loading={lkLoading}
                      onClick={handleCourtFetch}
                      disabled={lkLoading || !lkCourtId || !lkType || !lkNumber.trim() || !lkYear} />
                  </div>
                </div>
                {lkLoading && <p className="court-import-note">Contacting the court website… this can take up to 30 seconds.</p>}
                {lkError && <p className="field-error">{lkError}</p>}
                {lkInfo && <p className="court-import-ok">{lkInfo}</p>}
              </div>
            )}

            {(editCaseId || caseMode === "manual" || (caseMode === "import" && lkFetched)) && (
              <form className="flex flex-column gap-2" onSubmit={handleSubmit}>
                <InputText
                  name="caseNumber" placeholder="Case Number (16 digits)"
                  value={newCase.caseNumber} onChange={handleChange} required
                  invalid={!!caseNumberError}
                />
                {caseNumberError && <p className="field-error">{caseNumberError}</p>}

                <InputText name="caseTitle" placeholder="Case Title" value={newCase.caseTitle} onChange={handleChange} required />
                <InputText name="caseType" placeholder="Case Type" value={newCase.caseType} onChange={handleChange} required />

                <Dropdown value={newCase.courtLevel || null} options={COURT_OPTIONS} placeholder="Select Court Level"
                  onChange={(e) => setField("courtLevel", e.value || "")} />
                <Dropdown value={newCase.status || null} options={STATUS_OPTIONS} placeholder="Select Status"
                  onChange={(e) => setField("status", e.value || "")} />

                <InputText type="number" name="amount" placeholder="Amount" value={newCase.amount} onChange={handleChange} />

                <Dropdown
                  options={clientOptions}
                  value={clients.find((c) => c.id === Number(newCase.clientId)) ? Number(newCase.clientId) : null}
                  onChange={(e) => setNewCase({ ...newCase, clientId: e.value ?? "" })}
                  showClear filter placeholder="Select Client"
                />

                <InputTextarea name="description" placeholder="Description" value={newCase.description} onChange={handleChange} rows={3} autoResize />

                <div className="flex gap-2">
                  <Button type="submit" label={editCaseId ? "Update Case" : "Save Case"} />
                  <Button type="button" label="Cancel" severity="secondary" outlined onClick={() => setShowModal(false)} />
                </div>
              </form>
            )}

            {caseMode === "import" && !editCaseId && !lkFetched && !lkLoading && (
              <p className="court-import-hint">Fetch a case above to prefill and review the details before saving.</p>
            )}
          </>
        )}
      </Dialog>

      {/* Cases Table */}
      <div className="cases-table">
        {pageLoading ? (
          <div className="flex flex-column gap-2 p-3">
            {Array.from({ length: Math.min(size, 10) }).map((_, i) => <Skeleton key={i} height="2rem" />)}
          </div>
        ) : (
          <DataTable
            value={cases}
            dataKey="id"
            size="small"
            stripedRows
            emptyMessage="No cases found."
            rowClassName={(c: any) => `clickable-row ${highlightedId === c.id ? "highlight-row" : ""}`}
            onRowClick={(e: any) => goToCase(e.data.id)}
          >
            <Column header="Case No" body={(c) => <span className="case-no-cell" title={c.caseNumber}>{c.caseNumber}</span>} />
            <Column header="Title" body={(c) => <span title={c.caseTitle}>{c.caseTitle}</span>} />
            <Column header="Type" body={(c) => <span title={c.caseType}>{c.caseType}</span>} />
            <Column header="Status" body={(c) => c.status ? <Tag value={c.status} severity={STATUS_SEVERITY[(c.status || "").toLowerCase()] || "info"} /> : null} />
            <Column header="Next Hearing" body={(c) => {
              const hearing = nextHearings[c.id];
              return hearing ? (
                <span className="hearing-badge" title={hearing.title}>
                  <i className="pi pi-calendar" style={{ fontSize: 11 }} /> {formatHearing(hearing.date)}
                </span>
              ) : <span className="muted-dash">—</span>;
            }} />
            <Column header="Tags" body={(c) => {
              const tags = tagsByCase[c.id] || [];
              return (
                <div className="tags-cell">
                  {tags.length ? tags.slice(0, 3).map((t: any) => (
                    <span key={t.id} className="case-tag-chip" style={t.color ? { borderColor: t.color, color: t.color } : undefined}>
                      {t.label}
                    </span>
                  )) : <span className="muted-dash">—</span>}
                  {tags.length > 3 && <span className="case-tag-more">+{tags.length - 3}</span>}
                </div>
              );
            }} />
            <Column header="Client" body={(c) => <span title={c.clientName || "N/A"}>{c.clientName || "N/A"}</span>} />
            <Column header="Amount" body={(c) => formatCurrency(c.amount)} />
            <Column header="Actions" body={actionsBody} />
          </DataTable>
        )}
        {totalPages > 0 && (
          <Paginator
            first={page * size}
            rows={size}
            totalRecords={totalElements}
            rowsPerPageOptions={[10, 20, 50, 100]}
            onPageChange={(e) => {
              if (e.rows !== size) { setSize(e.rows); setPage(0); }
              else setPage(e.page);
            }}
          />
        )}
      </div>

      {/* Case Documents Modal */}
      <Dialog
        header={docCase ? `Documents — ${docCase.caseNumber}` : "Documents"}
        visible={showCaseDocs && !!docCase}
        onHide={() => setShowCaseDocs(false)}
        style={{ width: "600px" }}
        breakpoints={{ "640px": "95vw" }}
        dismissableMask
      >
        {caseDocsLoading ? (
          <div className="flex justify-content-center p-3"><ProgressSpinner style={{ width: 40, height: 40 }} /></div>
        ) : (
          <>
            {caseDocs.length === 0 ? (
              <p className="no-data">No documents linked to this case.</p>
            ) : (
              <div className="flex flex-column gap-2">
                {caseDocs.map((d) => (
                  <div key={d.id} className="case-doc-item">
                    <i className="pi pi-folder" style={{ fontSize: 20 }} />
                    <span className="case-doc-name">{d.documentName}</span>
                    <span className="case-doc-meta">{d.category || "Other"}</span>
                    <span className="case-doc-meta">{d.version > 1 ? `v${d.version}` : "v1"}</span>
                    <div className="flex gap-1 ml-auto">
                      <Button icon="pi pi-eye" rounded text size="small" onClick={() => handleDocPreview(d.id)} tooltip="Preview" />
                      <Button icon="pi pi-download" rounded text size="small" onClick={() => handleDocDownload(d.id, d.originalName || d.documentName)} tooltip="Download" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex align-items-center gap-2 mt-3">
              <input type="file" onChange={(e) => setUploadDocFile(e.target.files?.[0] || null)} />
              <Button icon="pi pi-upload" label="Upload" onClick={uploadCaseDoc} disabled={!uploadDocFile} />
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}

export default Cases;
