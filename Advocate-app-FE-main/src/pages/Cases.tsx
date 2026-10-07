// Cases: the practice's matters. Figures double as quick filters, the toolbar
// searches and filters server-side, and each row opens the case workspace.
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import { formatCurrency } from "../utils/formatCurrency";
import usePagination from "../hooks/usePagination";
import { usePageModal } from "../utils/pageModal";
import { Button, Chip, StatusChip, EmptyState, Spinner, PageHead, PopMenu, Icon, type MenuItem } from "../ui/kit";
import { TextField, TextArea, SelectField, SearchInput, Segmented, FilterChip } from "../ui/forms";
import { Modal, confirm } from "../ui/overlays";
import { DataTable, type Column } from "../ui/DataTable";
import "../ui/pages/cases.css";

const SORT_OPTIONS = [
  { value: "createdAt:desc", label: "Newest first" },
  { value: "createdAt:asc", label: "Oldest first" },
  { value: "caseNumber:asc", label: "Case No (A→Z)" },
  { value: "caseTitle:asc", label: "Title (A→Z)" },
  { value: "status:asc", label: "Status" },
];
const STATUSES = ["Active", "Pending", "Closed"];
const COURTS = ["District", "High Court", "Supreme Court"];
const PAGE_SIZES = [10, 20, 50, 100];

function formatHearing(dateStr: any) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
const isToday = (dateStr: any) => {
  const d = new Date(dateStr);
  return !Number.isNaN(d.getTime()) && d.toDateString() === new Date().toDateString();
};

const EMPTY_CASE = { caseNumber: "", caseTitle: "", caseType: "", courtLevel: "", status: "", amount: "", description: "", clientId: "" };

function Cases() {
  const [cases, setCases] = useState<any[]>([]);
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
  const [view, setView] = useState<"table" | "board">("table");
  const [menu, setMenu] = useState<{ el: HTMLElement; row: any } | null>(null);

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
      setTotalElements(response.data.totalElements || 0);
      setErrorMessage("");
    } catch (err: any) {
      console.error("Error fetching cases:", err);
      const errData = err.response?.data;
      setErrorMessage(typeof errData === "string" ? errData : (errData?.message || "Failed to fetch cases."));
    } finally {
      setPageLoading(false);
    }
  }, [page, size, searchKeyword, showArchived, filterStatus, filterCourt, sort]);

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
  }, []);

  useEffect(() => {
    if (!token) {
      setErrorMessage("Please login first.");
      return;
    }
    fetchClients();
    fetchWorkspaceMeta();
  }, [token, fetchWorkspaceMeta]);

  useEffect(() => {
    if (!token) return;
    if (searchedFromGlobalNav.current) {
      searchedFromGlobalNav.current = false;
      return;
    }
    fetchCases();
  }, [fetchCases, token]);

  // "Create case" from anywhere opens the full Add Case page: the pop-up here
  // only saves the case row, without the court record, parties or hearings.
  // The pop-up is kept for Edit Case.
  usePageModal(["create-case"], () => navigate("/dashboard/cases/new"));

  // AI Assistant: search
  useEffect(() => {
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
    window.addEventListener("assistant-search", handleSearch);
    return () => {
      window.removeEventListener("assistant-search", handleSearch);
    };
  }, [fetchCases]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a new hand-off; location.state persists, so fetchCases here would re-search on every filter change
  }, [location.state]);

  const setField = (name: string, value: any) => {
    setNewCase({ ...newCase, [name]: value });
    if (name === "caseNumber") {
      setCaseNumberError(value.length !== 16 ? "Case Number must be exactly 16 digits." : "");
    }
  };
  const handleChange = (e: any) => setField(e.target.name, e.target.value);

  // ---------------- UPDATE CASE ----------------
  const handleSubmit = async (e: any) => {
    e.preventDefault();
    if (!token) { setErrorMessage("Please login first."); return; }
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
    setErrorMessage("");
    setCaseNumberError("");
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
  }, []);

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
    const el = document.querySelector(".cs-list tr.hl, .cs-list .card-mini.hl");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedId, cases, pageLoading, view]);

  const menuItems = (c: any): MenuItem[] => {
    const items: MenuItem[] = [
      { label: "Open case", icon: "external", onClick: () => goToCase(c.id) },
      { label: "Documents", icon: "folder", onClick: () => openCaseDocs(c) },
    ];
    if (showArchived) {
      if (hasPermission("CASE_EDIT")) items.push("-", { label: "Restore", icon: "restore", onClick: () => handleRestore(c.id) });
    } else {
      if (hasPermission("CASE_EDIT")) items.push({ label: "Edit details", icon: "edit", onClick: () => handleEdit(c) });
      if (hasPermission("CASE_DELETE")) items.push("-", {
        label: "Archive", icon: "archive", danger: true,
        onClick: () => confirm({
          title: "Archive this case?",
          message: `${c.caseNumber || "This case"} moves to the archive. You can restore it later.`,
          confirmLabel: "Archive", danger: true, accept: () => handleDelete(c.id),
        }),
      });
    }
    return items;
  };

  const actionBtn = (c: any) => (
    <Button variant="ghost" size="sm" iconOnly icon="more" aria-label={`Actions for ${c.caseNumber || c.caseTitle || "case"}`} aria-haspopup="menu"
      onClick={(e) => setMenu({ el: e.currentTarget, row: c })} />
  );

  const hearingCell = (c: any) => {
    const hearing = nextHearings[c.id];
    if (!hearing) return <span className="faint">Not listed</span>;
    return (
      <>
        <span className={isToday(hearing.date) ? "cs-today" : undefined}>{formatHearing(hearing.date)}</span>
        {hearing.title && <div className="cs-sub ellipsis" style={{ maxWidth: "24ch" }} title={hearing.title}>{hearing.title}</div>}
      </>
    );
  };

  const tagsCell = (c: any) => {
    const tags = tagsByCase[c.id] || [];
    if (!tags.length) return <span className="faint">—</span>;
    return (
      <div className="cs-tags">
        {tags.slice(0, 3).map((t: any) => <Chip key={t.id} plain>{t.label}</Chip>)}
        {tags.length > 3 && <span className="faint xs">+{tags.length - 3}</span>}
      </div>
    );
  };

  const columns: Column<any>[] = [
    { key: "caseNumber", label: "Case", render: (c) => (
      <>
        <a className="mono small link" href={`/dashboard/cases/${c.id}`} onClick={(e) => { e.preventDefault(); goToCase(c.id); }}>{c.caseNumber || "—"}</a>
        <div className="cs-sub ellipsis cs-title" title={c.caseTitle}>{c.caseTitle}</div>
      </>
    ) },
    { key: "caseType", label: "Type", hideSm: true, render: (c) => <span className="small">{c.caseType || "—"}</span> },
    { key: "next", label: "Next hearing", render: hearingCell },
    { key: "client", label: "Client", hideSm: true, render: (c) => <span className="small">{c.clientName || "N/A"}</span> },
    { key: "tags", label: "Tags", hideSm: true, render: tagsCell },
    ...(hasPermission("INVOICE_VIEW") ? [{ key: "amount", label: "Agreed fee", align: "right" as const, hideSm: true, render: (c: any) => formatCurrency(c.amount) }] : []),
    { key: "status", label: "Status", render: (c) => <StatusChip status={c.status} /> },
    { key: "act", label: <span className="sr-only">Actions</span>, align: "right", render: actionBtn },
  ];

  const setFig = (v: string) => { setFilterStatus(filterStatus === v ? "" : v); };
  const openCount = stats ? (Number(stats.activeCases || 0) + Number(stats.pendingCases || 0)) : null;
  const emptyState = searchKeyword || filterStatus || filterCourt
    ? { icon: "search" as const, title: "No cases match", text: "Try a different search or clear the filters." }
    : showArchived
      ? { icon: "archive" as const, title: "No archived cases" }
      : {
          icon: "case" as const, title: "No cases yet", text: "Add your first case by importing it from court records.",
          action: hasPermission("CASE_CREATE") ? <Button variant="primary" size="sm" onClick={() => navigate("/dashboard/cases/new")}>Add case</Button> : undefined,
        };

  return (
    <div className="cs-root">
      <PageHead
        title="Cases"
        sub={stats ? `${openCount} open matters, ${stats.upcomingHearings ?? 0} upcoming hearings.` : "Every matter the practice is handling."}
        actions={hasPermission("CASE_CREATE") && <Button variant="primary" icon="plus" onClick={() => navigate("/dashboard/cases/new")}>Add case</Button>}
      />

      {errorMessage && !showModal && <div className="callout bad" role="alert" style={{ marginBottom: "var(--s4)" }}><Icon name="warn" size="sm" /><div>{errorMessage}</div></div>}

      {stats && !showArchived && (
        <div className="figures" style={{ marginBottom: "var(--s5)" }} role="group" aria-label="Quick filters">
          <button type="button" className="figure" aria-pressed={!filterStatus} onClick={() => setFilterStatus("")}>
            <div className="lbl">All cases</div><div className="val">{stats.totalCases ?? 0}</div><div className="meta">Not archived</div>
          </button>
          <button type="button" className="figure" aria-pressed={filterStatus === "Active"} onClick={() => setFig("Active")}>
            <div className="lbl">Active</div><div className="val">{stats.activeCases ?? 0}</div><div className="meta">Being heard</div>
          </button>
          <button type="button" className="figure" aria-pressed={filterStatus === "Pending"} onClick={() => setFig("Pending")}>
            <div className="lbl">Pending</div><div className="val">{stats.pendingCases ?? 0}</div><div className="meta">Admission or reserved</div>
          </button>
          <div className="figure">
            <div className="lbl">Upcoming hearings</div><div className="val">{stats.upcomingHearings ?? 0}</div><div className="meta">Listed ahead</div>
          </div>
          {stats.outstandingDues != null && (
            <div className="figure">
              <div className="lbl">Outstanding fees</div><div className="val">{formatCurrency(stats.outstandingDues)}</div><div className="meta">Agreed fee less paid</div>
            </div>
          )}
        </div>
      )}

      <div className="toolbar">
        <SearchInput value={searchKeyword} onChange={setSearchKeyword} placeholder="Search case no., title, client or email" />
        <select className="input" aria-label="Status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" aria-label="Court level" value={filterCourt} onChange={(e) => setFilterCourt(e.target.value)}>
          <option value="">All courts</option>
          {COURTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {(filterStatus || filterCourt) && (
          <Button variant="ghost" size="sm" onClick={() => { setFilterStatus(""); setFilterCourt(""); }}>Clear filters</Button>
        )}
      </div>

      <div className="row wrap between" style={{ marginBottom: "var(--s3)" }}>
        <Segmented<"table" | "board"> label="View" value={view} onChange={setView}
          options={[{ value: "table", label: "Table", icon: "rows" }, { value: "board", label: "Board", icon: "kanban" }]} />
        <div className="row wrap">
          <select className="input" aria-label="Cases per page" value={size} style={{ width: "auto" }}
            onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} per page</option>)}
          </select>
          <FilterChip on={showArchived} onClick={() => setShowArchived(!showArchived)}><Icon name="archive" size="sm" />Show archived</FilterChip>
        </div>
      </div>

      <div className="cs-list">
        {view === "table" ? (
          <DataTable
            rows={cases}
            columns={columns}
            rowKey={(c) => c.id}
            loading={pageLoading}
            onRow={(c) => goToCase(c.id)}
            rowClass={(c) => [highlightedId === c.id ? "hl" : "", showArchived || c.status === "Closed" ? "muted" : ""].join(" ").trim() || undefined}
            page={page} total={totalElements} pageSize={size} onPage={setPage}
            empty={emptyState}
            caption="Cases"
          />
        ) : (
          <>
            <div className="board cs-board">
              {STATUSES.map((lane) => {
                const list = cases.filter((c) => (c.status || "") === lane);
                return (
                  <section className="lane" aria-label={lane} key={lane}>
                    <h4><span>{lane}</span><span className="badge-n">{list.length}</span></h4>
                    {list.map((c) => {
                      const h = nextHearings[c.id];
                      return (
                        <div key={c.id} className={`card-mini${highlightedId === c.id ? " hl" : ""}`} role="link" tabIndex={0}
                          onClick={(e) => { if (!(e.target as HTMLElement).closest("button")) goToCase(c.id); }}
                          onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) goToCase(c.id); }}>
                          <div className="row between"><span className="mono xs">{c.caseNumber}</span>{actionBtn(c)}</div>
                          <div className="small" style={{ fontWeight: 500, margin: "2px 0 6px" }}>{c.caseTitle}</div>
                          <div className="row between xs">
                            <span className="faint">{c.clientName || ""}</span>
                            <span className={h && isToday(h.date) ? "cs-today" : "faint"}>{h ? formatHearing(h.date) : "Not listed"}</span>
                          </div>
                        </div>
                      );
                    })}
                    {!list.length && <p className="faint small" style={{ padding: "8px 4px" }}>{pageLoading ? "Loading…" : "No cases here."}</p>}
                  </section>
                );
              })}
            </div>
            {totalElements > size && (
              <div className="row between small faint" style={{ marginTop: "var(--s3)" }}>
                <span>Page {page + 1} of {Math.ceil(totalElements / size)}</span>
                <div className="row">
                  <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                  <Button size="sm" disabled={(page + 1) * size >= totalElements} onClick={() => setPage(page + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {menu && <PopMenu anchor={menu.el} items={menuItems(menu.row)} onClose={() => setMenu(null)} align="right" width={200} />}

      {/* Edit modal */}
      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editCaseId ? "Edit case" : "Add case"}
        sub={newCase.caseNumber ? <span className="mono">{newCase.caseNumber}</span> : undefined}
        footer={<>
          <Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button variant="primary" type="submit" form="cs-edit-form">{editCaseId ? "Update case" : "Save case"}</Button>
        </>}
      >
        <form id="cs-edit-form" className="form-grid" onSubmit={handleSubmit} noValidate={false}>
          {errorMessage && <div className="callout bad full" role="alert"><Icon name="warn" size="sm" /><div>{errorMessage}</div></div>}
          <TextField label="Case number" name="caseNumber" value={newCase.caseNumber} onChange={handleChange} required
            className="mono" hint="16 digits" error={caseNumberError || undefined} />
          <TextField label="Case type" name="caseType" value={newCase.caseType} onChange={handleChange} required />
          <TextField label="Title" name="caseTitle" value={newCase.caseTitle} onChange={handleChange} required full placeholder="Petitioner vs Respondent" />
          <SelectField label="Court level" required value={newCase.courtLevel} placeholder="Select court level" options={COURTS}
            onChange={(e) => setField("courtLevel", e.target.value)} />
          <SelectField label="Status" required value={newCase.status} placeholder="Select status" options={STATUSES}
            onChange={(e) => setField("status", e.target.value)} />
          <SelectField label="Client" required value={clients.find((c) => c.id === Number(newCase.clientId)) ? String(newCase.clientId) : ""}
            placeholder="Select client" options={clients.map((c) => ({ value: String(c.id), label: `${c.name} — ${c.email}` }))}
            onChange={(e) => setNewCase({ ...newCase, clientId: e.target.value })} />
          {hasPermission("INVOICE_VIEW") && (
            <TextField label="Agreed fee (₹)" type="number" name="amount" value={newCase.amount} onChange={handleChange} min={0} />
          )}
          <TextArea label="Description" name="description" value={newCase.description} onChange={handleChange} rows={3} full />
        </form>
      </Modal>

      {/* Case Documents Modal */}
      <Modal
        open={showCaseDocs && !!docCase}
        onClose={() => setShowCaseDocs(false)}
        title="Documents"
        sub={docCase ? <span className="mono">{docCase.caseNumber}</span> : undefined}
      >
        {caseDocsLoading ? (
          <Spinner />
        ) : (
          <div className="stack">
            {caseDocs.length === 0 ? (
              <EmptyState icon="folder" title="No documents linked to this case" />
            ) : (
              <ul className="list" style={{ margin: 0, padding: 0, listStyle: "none" }}>
                {caseDocs.map((d) => (
                  <li key={d.id} className="row" style={{ padding: "8px 0", borderBottom: "1px solid var(--line)" }}>
                    <Icon name="file" size="sm" />
                    <span className="grow ellipsis small">{d.documentName}</span>
                    <Chip plain>{d.category || "Other"}</Chip>
                    <span className="faint xs">{d.version > 1 ? `v${d.version}` : "v1"}</span>
                    <Button variant="ghost" size="sm" iconOnly icon="eye" aria-label={`Preview ${d.documentName}`} onClick={() => handleDocPreview(d.id)} />
                    <Button variant="ghost" size="sm" iconOnly icon="download" aria-label={`Download ${d.documentName}`} onClick={() => handleDocDownload(d.id, d.originalName || d.documentName)} />
                  </li>
                ))}
              </ul>
            )}
            {hasPermission("DOCUMENT_UPLOAD") && (
              <div className="row wrap">
                <input type="file" aria-label="Choose a document to upload" onChange={(e) => setUploadDocFile(e.target.files?.[0] || null)} />
                <Button icon="upload" onClick={uploadCaseDoc} disabled={!uploadDocFile}>Upload</Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

export default Cases;
