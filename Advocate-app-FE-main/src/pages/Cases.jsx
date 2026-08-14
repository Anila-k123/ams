import React, { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import { useLoading } from "../contexts/LoadingContext";
import Select from "react-select";
import { FiFolder, FiEye, FiDownload, FiX, FiUpload, FiClock, FiEdit2, FiTrash2, FiExternalLink, FiBriefcase, FiCalendar, FiCheckCircle, FiDollarSign } from "react-icons/fi";
import CaseTimeline from "../components/CaseTimeline.jsx";
import { useToast } from "../contexts/ToastContext.jsx";
import { formatCurrency } from "../utils/formatCurrency";
import Pagination from "../components/Pagination";
import usePagination from "../hooks/usePagination";
import { InlineLoader } from "../components/Loader";
import "../assets/styles/Cases.css";

const customSelectStyles = {
  control: (base, state) => ({
    ...base,
    backgroundColor: "var(--bg-primary)",
    borderColor: state.isFocused ? "var(--accent)" : "var(--border-color)",
    color: "var(--text-primary)",
    borderRadius: "8px",
    padding: "2px",
    boxShadow: "none",
    "&:hover": { borderColor: "var(--accent)" }
  }),
  menu: (base) => ({
    ...base,
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    borderRadius: "8px",
    boxShadow: "var(--shadow-md)",
    zIndex: 9999
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected ? "var(--accent)" : state.isFocused ? "var(--border-color)" : "transparent",
    color: state.isSelected ? "#ffffff" : "var(--text-primary)",
    cursor: "pointer",
    "&:active": { backgroundColor: "var(--accent)" }
  }),
  singleValue: (base) => ({ ...base, color: "var(--text-primary)" }),
  placeholder: (base) => ({ ...base, color: "var(--text-muted)" }),
  input: (base) => ({ ...base, color: "var(--text-primary)" })
};

const SORT_OPTIONS = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "caseNumber:asc", label: "Case No (A→Z)" },
  { value: "caseTitle:asc", label: "Title (A→Z)" },
  { value: "status:asc", label: "Status" },
];

function formatHearing(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// First party name from a court "Petitioner/Respondent Details" blob (text before the first comma).
function firstParty(blob) {
  if (!blob) return "";
  return String(blob).split(",")[0].trim();
}

// Map an official court case record into the Add Case form fields.
function mapCourtRecordToCase(record, searchedType) {
  const f = (record && record.fields) || {};
  const pet = firstParty(f["Petitioner Details"]);
  const res = firstParty(f["Respondent Details"]);
  const title = pet && res ? `${pet} vs ${res}` : (f["Registration No"] || "");

  const stage = (f["Stage"] || "").toLowerCase();
  let status = "Active";
  if (/dispos|dismiss|withdraw|closed|allowed|rejected/.test(stage)) status = "Closed";
  else if (/pending/.test(stage)) status = "Pending";

  const desc = [];
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

function Cases() {
  const [cases, setCases] = useState([]);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [clients, setClients] = useState([]);
  const location = useLocation();
  const navigate = useNavigate();
  const [newCase, setNewCase] = useState({
    caseNumber: "",
    caseTitle: "",
    caseType: "",
    courtLevel: "",
    status: "",
    amount: "",
    description: "",
    clientId: "",
  });
  const [showModal, setShowModal] = useState(false);
  const [editCaseId, setEditCaseId] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [caseNumberError, setCaseNumberError] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState("");
  const [highlightedId, setHighlightedId] = useState(null);

  // Filters + sort
  const [filterStatus, setFilterStatus] = useState("");
  const [filterCourt, setFilterCourt] = useState("");
  const [sort, setSort] = useState("createdAt:desc");

  // Workspace enrichment
  const [stats, setStats] = useState(null);
  const [tagsByCase, setTagsByCase] = useState({});
  const [nextHearings, setNextHearings] = useState({});

  const token = localStorage.getItem("token");
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };
  const { withLoading } = useLoading();
  const { success, error, warning, info } = useToast();
  const { page, setPage, size, setSize } = usePagination({ defaultSize: 20, resetOn: [searchKeyword, showArchived, filterStatus, filterCourt, sort] });
  const [pageLoading, setPageLoading] = useState(true);
  const searchedFromGlobalNav = useRef(!!location.state?.search);

  // Document modal state
  const [showCaseDocs, setShowCaseDocs] = useState(false);
  const [docCase, setDocCase] = useState(null);
  const [caseDocs, setCaseDocs] = useState([]);
  const [caseDocsLoading, setCaseDocsLoading] = useState(false);
  const [uploadDocFile, setUploadDocFile] = useState(null);

  // Timeline modal state
  const [showTimeline, setShowTimeline] = useState(false);
  const [timelineCase, setTimelineCase] = useState(null);

  const openTimeline = (c) => {
    setTimelineCase(c);
    setShowTimeline(true);
  };

  // ---------------- COURT LOOKUP (prefill Add Case from the official record) ----------------
  const [lkCourts, setLkCourts] = useState([]);
  const [lkCourtId, setLkCourtId] = useState("");
  const [lkTypes, setLkTypes] = useState({});
  const [lkType, setLkType] = useState(null);
  const [lkNumber, setLkNumber] = useState("");
  const [lkYear, setLkYear] = useState("");
  const [lkLoading, setLkLoading] = useState(false);
  const [lkTypesLoading, setLkTypesLoading] = useState(false);
  const [lkError, setLkError] = useState("");
  const [lkInfo, setLkInfo] = useState("");
  const [caseMode, setCaseMode] = useState(null);   // null | 'manual' | 'import' — how to add a new case
  const [lkFetched, setLkFetched] = useState(false); // a court record has been fetched & applied

  // Load the court list the first time the Add-Case modal opens.
  useEffect(() => {
    if (!showModal || editCaseId || lkCourts.length) return;
    (async () => {
      try {
        const res = await axios.get("/api/courtsearch/courts", authHeaders);
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
        const res = await axios.get(`/api/courtsearch/courts/${lkCourtId}/case-types`, authHeaders);
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
      const res = await axios.post("/api/courtsearch/search", {
        court_id: lkCourtId,
        case_type: lkType.value,
        case_number: lkNumber.trim(),
        case_year: Number(lkYear),
      }, authHeaders);
      const mapped = mapCourtRecordToCase(res.data, lkType.value);
      setNewCase((prev) => ({ ...prev, ...mapped }));
      setCaseNumberError(mapped.caseNumber.length !== 16 ? "Case Number must be exactly 16 digits." : "");
      const reg = res.data?.fields?.["Registration No"];
      setLkInfo(`Prefilled from court record${reg ? ` — ${reg}` : ""}. Review the fields and choose a client.`);
      setLkFetched(true);
      success && success("Case details fetched from the court.");
    } catch (err) {
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
      const params = { page, size, sortBy, sortDir };
      if (searchKeyword.trim()) params.keyword = searchKeyword;
      if (showArchived) params.archived = true;
      if (filterStatus) params.status = filterStatus;
      if (filterCourt) params.courtLevel = filterCourt;
      const response = await axios.get("/api/cases", { ...authHeaders, params });
      setCases(response.data.content || []);
      setTotalPages(response.data.totalPages || 0);
      setTotalElements(response.data.totalElements || 0);
      setErrorMessage("");
    } catch (err) {
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
      const response = await axios.get("/api/clients/my-clients", authHeaders);
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
        axios.get("/api/workspace/stats", authHeaders),
        axios.get("/api/workspace/tags", authHeaders),
        axios.get("/api/workspace/next-hearings", authHeaders),
      ]);
      setStats(statsRes.data);
      setTagsByCase(tagsRes.data?.tagsByCase || {});
      setNextHearings(hearingsRes.data || {});
    } catch (err) {
      console.error("Error fetching workspace meta:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const handleModal = (e) => {
      if (e.detail === "create-case") {
        setShowModal(true);
        setEditCaseId(null);
      }
    };
    const handleSearch = (e) => {
      if (e.detail?.query) {
        const keyword = e.detail.query;
        setSearchKeyword(keyword);
        if (!keyword.trim()) {
          fetchCases();
          return;
        }
        axios.get(`/api/cases/search?keyword=${keyword}`, authHeaders)
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
    if (location.state?.search) {
      const kw = location.state.search;
      setSearchKeyword(kw);
      setHighlightedId(location.state.id || null);
      if (!kw.trim()) { fetchCases(); return; }
      axios.get(`/api/cases/search?keyword=${encodeURIComponent(kw)}`, authHeaders)
        .then(res => setCases(res.data)).catch(() => {});
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  const handleSearch = (e) => setSearchKeyword(e.target.value);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setNewCase({ ...newCase, [name]: value });
    if (name === "caseNumber") {
      setCaseNumberError(value.length !== 16 ? "Case Number must be exactly 16 digits." : "");
    }
  };

  // ---------------- CREATE/UPDATE CASE ----------------
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!token) { setErrorMessage("Please login first."); return; }
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
        await withLoading(
          axios.put(`/api/cases/update/${editCaseId}`, caseToSend, authHeaders),
          "Updating Case..."
        );
        setEditCaseId(null);
      } else {
        await withLoading(
          axios.post("/api/cases/create", caseToSend, authHeaders),
          "Creating Case..."
        );
      }
      setNewCase({ caseNumber: "", caseTitle: "", caseType: "", courtLevel: "", status: "", amount: "", description: "", clientId: "" });
      setShowModal(false);
      setCaseNumberError("");
      fetchCases();
      fetchWorkspaceMeta();
      setErrorMessage("");
    } catch (err) {
      console.error("Error saving case:", err);
      if (err.response?.status === 409) {
        setCaseNumberError("Case number already exists.");
        error("Case number already exists.");
      } else {
        setErrorMessage(
          typeof err.response?.data?.message === "string"
            ? err.response.data.message
            : "Failed to save case."
        );
      }
    }
  };

  const handleEdit = (caseData) => {
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

  const handleDelete = async (id) => {
    if (!token) { setErrorMessage("Please login first."); return; }
    try {
      await withLoading(
        axios.delete(`/api/cases/delete/${id}`, authHeaders),
        showArchived ? "Deleting Case..." : "Archiving Case..."
      );
      fetchCases();
      setErrorMessage("");
    } catch (err) {
      console.error("Error deleting case:", err);
      const errData = err.response?.data;
      setErrorMessage(typeof errData === "string" ? errData : (errData?.message || "Failed to archive case."));
    }
  };

  const handleRestore = async (id) => {
    if (!token) { setErrorMessage("Please login first."); return; }
    try {
      await withLoading(
        axios.put(`/api/cases/restore/${id}`, {}, authHeaders),
        "Restoring Case..."
      );
      fetchCases();
      setErrorMessage("");
    } catch (err) {
      console.error("Error restoring case:", err);
      const errData = err.response?.data;
      setErrorMessage(typeof errData === "string" ? errData : (errData?.message || "Failed to restore case."));
    }
  };

  // Document functions
  const openCaseDocs = useCallback(async (c) => {
    setDocCase(c);
    setShowCaseDocs(true);
    setCaseDocsLoading(true);
    try {
      const res = await axios.get(`/api/documents/by-case/${c.id}`, authHeaders);
      setCaseDocs(res.data || []);
    } catch (err) {
      console.error("Error fetching case documents:", err);
      setCaseDocs([]);
    } finally {
      setCaseDocsLoading(false);
    }
  }, [token]);

  const handleDocDownload = async (docId, fileName) => {
    try {
      const res = await axios.get(`/api/documents/download/${docId}`, { ...authHeaders, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) { console.error("Download error:", err); }
  };

  const handleDocPreview = async (docId) => {
    try {
      const res = await axios.get(`/api/documents/preview/${docId}`, { ...authHeaders, responseType: "blob" });
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
      await withLoading(
        axios.post("/api/documents/upload", formData, authHeaders),
        "Uploading Document..."
      );
      setUploadDocFile(null);
      openCaseDocs(docCase);
    } catch (err) { console.error("Upload error:", err); }
  };

  const goToCase = (id) => navigate(`/dashboard/cases/${id}`);

  const STAT_CARDS = stats ? [
    { key: "total", label: "Total Cases", value: stats.totalCases, icon: <FiBriefcase />, accent: "var(--primary)" },
    { key: "active", label: "Active", value: stats.activeCases, icon: <FiCheckCircle />, accent: "var(--success)" },
    { key: "pending", label: "Pending", value: stats.pendingCases, icon: <FiClock />, accent: "var(--warning)" },
    { key: "hearings", label: "Upcoming Hearings", value: stats.upcomingHearings, icon: <FiCalendar />, accent: "#A855F7" },
    { key: "dues", label: "Outstanding Dues", value: formatCurrency(stats.outstandingDues), icon: <FiDollarSign />, accent: "var(--danger)" },
  ] : [];

  return (
    <div className="cases-container">
      <h2>{showArchived ? "Archived Cases" : "Case Workspace"}</h2>
      {errorMessage && <p className="error-message">{errorMessage}</p>}

      {/* Dashboard cards */}
      {!showArchived && stats && (
        <div className="cases-stats">
          {STAT_CARDS.map((card) => (
            <div className="case-stat-card" key={card.key}>
              <div className="case-stat-icon" style={{ color: card.accent, background: `color-mix(in srgb, ${card.accent} 12%, transparent)` }}>
                {card.icon}
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
      <div className="cases-top-actions">
        <button onClick={() => navigate("/dashboard/cases/new")}>
          Add New Case
        </button>
        <input
          type="text"
          placeholder="🔍 Search by case number, client name, or email"
          value={searchKeyword}
          onChange={handleSearch}
          className="search-bar"
        />
        <button className="view-archived-btn" onClick={() => setShowArchived(!showArchived)}>
          {showArchived ? "🔙 Back to Active" : "🗄️ View Archived"}
        </button>
      </div>

      {/* Filter bar */}
      <div className="cases-filter-bar">
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="Active">Active</option>
          <option value="Pending">Pending</option>
          <option value="Closed">Closed</option>
        </select>
        <select value={filterCourt} onChange={(e) => setFilterCourt(e.target.value)}>
          <option value="">All Courts</option>
          <option value="District">District</option>
          <option value="High Court">High Court</option>
          <option value="Supreme Court">Supreme Court</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {(filterStatus || filterCourt) && (
          <button className="clear-filters-btn" onClick={() => { setFilterStatus(""); setFilterCourt(""); }}>
            Clear filters
          </button>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>{editCaseId ? "Edit Case" : "Add New Case"}</h3>

            {/* Step 1 — choose how to add a new case */}
            {!editCaseId && !caseMode && (
              <div className="case-mode">
                <button type="button" className="case-mode-card" onClick={() => setCaseMode("manual")}>
                  <span className="case-mode-icon">✍️</span>
                  <span className="case-mode-title">Add Manually</span>
                  <span className="case-mode-desc">Type in the case details yourself.</span>
                </button>
                <button type="button" className="case-mode-card" onClick={() => setCaseMode("import")}>
                  <span className="case-mode-icon">🏛️</span>
                  <span className="case-mode-title">Import from Court Records</span>
                  <span className="case-mode-desc">Fetch the official record and prefill the form.</span>
                </button>
                <button type="button" className="close-btn case-mode-cancel" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            )}

            {/* Step 2 — the chosen flow */}
            {(editCaseId || caseMode) && (
              <>
                {!editCaseId && (
                  <button
                    type="button" className="case-back"
                    onClick={() => { setCaseMode(null); setLkFetched(false); setLkError(""); setLkInfo(""); }}
                  >
                    ← Back
                  </button>
                )}

                {caseMode === "import" && !editCaseId && (
                <div className="court-import">
                  <div className="court-import-head">Find the case on the court record</div>
                  <div className="court-import-grid">
                    <Select
                      options={lkCourts.map((c) => ({ value: c.court_id, label: c.name }))}
                      value={lkCourts.filter((c) => c.court_id === lkCourtId).map((c) => ({ value: c.court_id, label: c.name }))[0] || null}
                      onChange={(opt) => setLkCourtId(opt ? opt.value : "")}
                      placeholder="Court"
                      isSearchable={false}
                      styles={customSelectStyles}
                    />
                    <Select
                      options={Object.keys(lkTypes).sort().map((k) => ({ value: k, label: k }))}
                      value={lkType}
                      onChange={setLkType}
                      placeholder={lkTypesLoading ? "Loading types…" : "Case type"}
                      isLoading={lkTypesLoading}
                      styles={customSelectStyles}
                    />
                    <input
                      type="text" placeholder="Case number" value={lkNumber}
                      onChange={(e) => setLkNumber(e.target.value)}
                    />
                    <input
                      type="number" placeholder="Year" value={lkYear} min="1900" max="2100"
                      onChange={(e) => setLkYear(e.target.value)}
                    />
                    <button
                      type="button" className="court-import-btn"
                      onClick={handleCourtFetch}
                      disabled={lkLoading || !lkCourtId || !lkType || !lkNumber.trim() || !lkYear}
                    >
                      {lkLoading ? "Fetching…" : "Fetch"}
                    </button>
                  </div>
                  {lkLoading && <p className="court-import-note">Contacting the court website… this can take up to 30 seconds.</p>}
                  {lkError && <p className="field-error">{lkError}</p>}
                  {lkInfo && <p className="court-import-ok">{lkInfo}</p>}
                </div>
                )}

                {(editCaseId || caseMode === "manual" || (caseMode === "import" && lkFetched)) && (
                <form className="case-form" onSubmit={handleSubmit}>
              <input
                type="text" name="caseNumber" placeholder="Case Number (16 digits)"
                value={newCase.caseNumber} onChange={handleChange} required
                className={caseNumberError ? "input-error" : ""}
              />
              {caseNumberError && <p className="field-error">{caseNumberError}</p>}

              <input type="text" name="caseTitle" placeholder="Case Title" value={newCase.caseTitle} onChange={handleChange} required />
              <input type="text" name="caseType" placeholder="Case Type" value={newCase.caseType} onChange={handleChange} required />

              <select name="courtLevel" value={newCase.courtLevel} onChange={handleChange} required>
                <option value="">Select Court Level</option>
                <option value="District">District</option>
                <option value="High Court">High Court</option>
                <option value="Supreme Court">Supreme Court</option>
              </select>

              <select name="status" value={newCase.status} onChange={handleChange} required>
                <option value="">Select Status</option>
                <option value="Active">Active</option>
                <option value="Pending">Pending</option>
                <option value="Closed">Closed</option>
              </select>

              <input type="number" name="amount" placeholder="Amount" value={newCase.amount} onChange={handleChange} />

              <Select
                options={clients.map((c) => ({ value: c.id, label: `${c.name} — ${c.email}` }))}
                value={
                  clients.find((c) => c.id === Number(newCase.clientId))
                    ? { value: Number(newCase.clientId), label: clients.find((c) => c.id === Number(newCase.clientId)).name }
                    : null
                }
                onChange={(selected) => setNewCase({ ...newCase, clientId: selected ? selected.value : "" })}
                isClearable placeholder="Select Client" styles={customSelectStyles}
              />

              <textarea name="description" placeholder="Description" value={newCase.description} onChange={handleChange} />

              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit">{editCaseId ? "Update Case" : "Save Case"}</button>
                <button type="button" className="close-btn" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </form>
                )}

                {caseMode === "import" && !editCaseId && !lkFetched && !lkLoading && (
                  <p className="court-import-hint">Fetch a case above to prefill and review the details before saving.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Cases Table */}
      <div className="cases-table">
        {pageLoading ? (
          <InlineLoader type="table" rows={size} cols={9} />
        ) : cases.length === 0 ? (
          <p className="no-data">No cases found.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Case No</th>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th>Next Hearing</th>
                <th>Tags</th>
                <th>Client</th>
                <th>Amount</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const hearing = nextHearings[c.id];
                const tags = tagsByCase[c.id] || [];
                return (
                  <tr
                    key={c.id}
                    className={`clickable-row ${highlightedId === c.id ? "highlight-row" : ""}`}
                    onClick={() => goToCase(c.id)}
                    ref={(el) => { if (highlightedId === c.id && el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                  >
                    <td className="case-no-cell" title={c.caseNumber}>{c.caseNumber}</td>
                    <td title={c.caseTitle}>{c.caseTitle}</td>
                    <td title={c.caseType}>{c.caseType}</td>
                    <td>
                      <span className={`status ${(c.status || "").toLowerCase()}`}>{c.status}</span>
                    </td>
                    <td>
                      {hearing ? (
                        <span className="hearing-badge" title={hearing.title}>
                          <FiCalendar size={11} /> {formatHearing(hearing.date)}
                        </span>
                      ) : <span className="muted-dash">—</span>}
                    </td>
                    <td className="tags-cell">
                      {tags.length ? tags.slice(0, 3).map((t) => (
                        <span key={t.id} className="case-tag-chip" style={t.color ? { borderColor: t.color, color: t.color } : undefined}>
                          {t.label}
                        </span>
                      )) : <span className="muted-dash">—</span>}
                      {tags.length > 3 && <span className="case-tag-more">+{tags.length - 3}</span>}
                    </td>
                    <td title={c.clientName || "N/A"}>{c.clientName || "N/A"}</td>
                    <td className="amount-cell">{formatCurrency(c.amount)}</td>
                    <td className="actions-cell" onClick={(e) => e.stopPropagation()}>
                      <div className="action-btns">
                        <button className="action-btn view-btn" onClick={() => goToCase(c.id)} title="Open workspace">
                          <FiExternalLink />
                        </button>
                        {showArchived ? (
                          <button className="action-btn restore-btn" onClick={() => handleRestore(c.id)} title="Restore">♻️</button>
                        ) : (
                          <>
                            <button className="action-btn edit-btn" onClick={() => handleEdit(c)} title="Edit"><FiEdit2 /></button>
                            <button className="action-btn delete-btn" onClick={() => handleDelete(c.id)} title="Archive"><FiTrash2 /></button>
                          </>
                        )}
                        <button className="action-btn timeline-btn" onClick={() => openTimeline(c)} title="Timeline"><FiClock /></button>
                        <button className="action-btn docs-btn" onClick={() => openCaseDocs(c)} title="Documents"><FiFolder /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
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

      {/* Case Documents Modal */}
      {showCaseDocs && docCase && (
        <div className="modal-overlay" onClick={() => setShowCaseDocs(false)}>
          <div className="modal-content case-docs-modal" onClick={(e) => e.stopPropagation()}>
            <div className="case-docs-header">
              <h3>Documents — {docCase.caseNumber}</h3>
              <button className="close-btn" onClick={() => setShowCaseDocs(false)}><FiX /></button>
            </div>
            {caseDocsLoading ? (
              <p>Loading documents...</p>
            ) : (
              <>
                {caseDocs.length === 0 ? (
                  <p className="no-data">No documents linked to this case.</p>
                ) : (
                  <div className="case-docs-list">
                    {caseDocs.map((d) => (
                      <div key={d.id} className="case-doc-item">
                        <FiFolder size={20} />
                        <span className="case-doc-name">{d.documentName}</span>
                        <span className="case-doc-meta">{d.category || "Other"}</span>
                        <span className="case-doc-meta">{d.version > 1 ? `v${d.version}` : "v1"}</span>
                        <div className="case-doc-actions">
                          <button onClick={() => handleDocPreview(d.id)} title="Preview"><FiEye /></button>
                          <button onClick={() => handleDocDownload(d.id, d.originalName || d.documentName)} title="Download"><FiDownload /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="case-doc-upload">
                  <input type="file" onChange={(e) => setUploadDocFile(e.target.files[0])} />
                  <button onClick={uploadCaseDoc} disabled={!uploadDocFile}><FiUpload /> Upload</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Case Timeline Modal */}
      {showTimeline && timelineCase && (
        <CaseTimeline
          caseId={timelineCase.id}
          caseNumber={timelineCase.caseNumber}
          onClose={() => { setShowTimeline(false); setTimelineCase(null); }}
        />
      )}
    </div>
  );
}

export default Cases;
