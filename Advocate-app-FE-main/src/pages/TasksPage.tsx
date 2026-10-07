import { useState, useEffect, useCallback, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { DRAFTING, newDraftUrl } from "./Drafting/routes";
import { ReviewActions, ReviewChip, ReviewNote, SubmissionHistory, SubmitWork } from "../components/TaskReview";
import { canReviewTask, canSubmitTask } from "../utils/taskReview";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import { useAuth } from "../context/AuthContext";
import api from "../api/client";
import { Icon, Chip, PageHead, Avatar } from "../ui/kit";
import { TextField, SelectField, SearchInput, FilterChip, Field } from "../ui/forms";
import { Modal, Drawer, confirm } from "../ui/overlays";
import { DataTable, type Column } from "../ui/DataTable";
import "../ui/pages/court.css";

const FILTERS = [
  { value: "inprogress", label: "In progress" },
  { value: "review", label: "To review" },
  { value: "completed", label: "Completed" },
  { value: "canceled", label: "Canceled" },
];
const SCOPES = [
  { value: "team", label: "Whole team" },
  { value: "mine", label: "Assigned to me" },
  { value: "created", label: "Created by me" },
];
const PRIORITY_OPTIONS = [
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
];
const PRIORITY_TONE: Record<string, "bad" | "warn" | ""> = { HIGH: "bad", MEDIUM: "warn", LOW: "" };

// Same document categories as the Documents upload, so a file attached to a task
// is filed under the same taxonomy.
const DOC_CATEGORIES = [
  "Court Order", "Petition", "Evidence", "Agreement", "Affidavit",
  "Notice", "Judgment", "Invoice", "Payment Receipt",
  "Identity Proof", "Address Proof", "Other",
];

const toISODate = (d: Date | null | undefined) => {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const fdate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

// How urgent an open task's deadline is. Dates compare as local yyyy-mm-dd, so
// "today" is the user's today whatever the server time zone.
const DAY = 86400000;
const dayDiff = (iso: string) => {
  const today = new Date(`${toISODate(new Date())}T00:00:00`).getTime();
  return Math.round((new Date(`${iso.slice(0, 10)}T00:00:00`).getTime() - today) / DAY);
};
type Urgency = { kind: "overdue" | "today" | "soon" | "later" | "none"; label: string; days: number };
const deadlineState = (task: any): Urgency => {
  if (!task.deadline) return { kind: "none", label: "", days: Infinity };
  const days = dayDiff(task.deadline);
  if (task.completed || task.cancelled) return { kind: "later", label: "", days };
  if (days < 0) return { kind: "overdue", label: `${-days} day${days === -1 ? "" : "s"} overdue`, days };
  if (days === 0) return { kind: "today", label: "Due today", days };
  if (days <= 3) return { kind: "soon", label: days === 1 ? "Due tomorrow" : `Due in ${days} days`, days };
  return { kind: "later", label: "", days };
};
const PRIORITY_RANK: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const isOpen = (t: any) => !t.completed && !t.cancelled;
const statusOf = (t: any): { label: string; tone: "ok" | "warn" | "info" | "" } =>
  t.cancelled ? { label: "Canceled", tone: "" }
    : t.completed ? { label: "Completed", tone: "ok" }
    : t.needsReview && t.reviewStatus === "SUBMITTED" ? { label: "To review", tone: "warn" }
    : { label: "In progress", tone: "info" };

// The quick filters above the list.
const QUICK: { key: string; label: string; test: (t: any) => boolean }[] = [
  { key: "overdue", label: "Overdue", test: (t) => deadlineState(t).kind === "overdue" },
  { key: "today", label: "Due today", test: (t) => deadlineState(t).kind === "today" },
  { key: "week", label: "Due this week", test: (t) => { const d = deadlineState(t).days; return d >= 0 && d <= 7; } },
  { key: "high", label: "High priority", test: (t) => (t.priority || "MEDIUM") === "HIGH" },
];

export default function TasksPage() {
  const { hasPermission } = usePermission();
  const { advocateId: myId } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [cases, setCases] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [deadline, setDeadline] = useState("");
  const [linkedCase, setLinkedCase] = useState<any>("");   // case id
  const [files, setFiles] = useState<File[]>([]);
  const [docCategory, setDocCategory] = useState("");
  const [searchText, setSearchText] = useState("");
  const [filter, setFilter] = useState("inprogress");
  const [scope, setScope] = useState("team");   // team | mine | created
  const [quick, setQuick] = useState<string | null>(null);   // a QUICK key, or none
  const [showAddModal, setShowAddModal] = useState(false);
  const [titleError, setTitleError] = useState(false);
  const [assignees, setAssignees] = useState<any[]>([]);
  const [assignTo, setAssignTo] = useState<any>("");   // "" = myself
  const [highlightedId, setHighlightedId] = useState<any>(null);
  const [openId, setOpenId] = useState<any>(null);
  const location = useLocation();
  const navigate = useNavigate();

  const canAssign = hasPermission("TASK_ASSIGN");
  const { withLoading } = useLoading();
  const toast = useToast();
  const { success, error } = toast;

  const fetchTasks = useCallback(async () => {
    try {
      const res = await api.get("/api/workspace/tasks/all");
      setTasks(res.data || []);
    } catch (err) {
      console.error("Error fetching tasks:", err);
    } finally {
      setLoaded(true);
    }
  }, []);

  const fetchCases = useCallback(async () => {
    try {
      const res = await api.get("/api/cases/my-cases");
      setCases(res.data || []);
    } catch (err) {
      console.error("Error fetching cases:", err);
    }
  }, []);

  const fetchAssignees = useCallback(async () => {
    if (!canAssign) return;
    try {
      const res = await api.get("/api/workspace/assignable-advocates");
      setAssignees(res.data || []);
    } catch (err) {
      console.error("Error fetching assignable advocates:", err);
    }
  }, [canAssign]);

  useEffect(() => { fetchTasks(); fetchCases(); fetchAssignees(); }, [fetchTasks, fetchCases, fetchAssignees]);

  // Global Search navigation
  useEffect(() => {
    const st = location.state as any;
    if (st?.search) {
      setSearchText(st.search);
      setHighlightedId(st.id || null);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Upload files → return array of document ids (linked to case if chosen)
  const uploadFiles = async (caseId: any) => {
    const ids: any[] = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      if (caseId) fd.append("caseId", caseId);
      if (docCategory) fd.append("category", docCategory);
      const res = await api.post("/api/documents/upload", fd);
      if (res.data?.id) ids.push(res.data.id);
    }
    return ids;
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setTitleError(true); return; }
    try {
      await withLoading((async () => {
        const caseId = linkedCase ? Number(linkedCase) : null;
        // 1) create the task
        const res = await api.post("/api/workspace/tasks/create", {
          title: title.trim(), priority, deadline: deadline || null, caseId,
          assignedToId: assignTo ? Number(assignTo) : undefined,
        });
        const taskId = res.data.id;
        // 2) upload + attach documents
        if (files.length) {
          const docIds = await uploadFiles(caseId);
          for (const docId of docIds) {
            await api.post(`/api/workspace/tasks/${taskId}/documents`, { documentId: docId });
          }
        }
      })(), "Creating Task...");
      setTitle(""); setPriority("MEDIUM"); setDeadline(""); setLinkedCase(""); setFiles([]); setDocCategory(""); setAssignTo("");
      setShowAddModal(false);
      fetchTasks();
      success("Task created.");
    } catch (err: any) {
      console.error("Error creating task:", err);
      error(err.response?.data?.error || "Failed to create task.");
    }
  };

  const handleToggle = async (id: any) => {
    try {
      await api.put(`/api/workspace/tasks/${id}/toggle`, {});
      fetchTasks();
    } catch (err: any) {
      // A delegated task is handed back through "Submit work", with a report.
      if (err.response?.data?.submitRequired) error("Use Submit work to hand this task back with a report.");
      else console.error("Error toggling task:", err);
    }
  };

  const handleCancel = async (id: any, cancelled = true) => {
    try {
      await withLoading(
        api.put(`/api/workspace/tasks/${id}/cancel`, { cancelled }),
        cancelled ? "Cancelling Task..." : "Restoring Task...");
      fetchTasks();
    } catch (err: any) {
      console.error("Error cancelling task:", err);
      error(err.response?.data?.error || "Failed to update task.");
    }
  };
  const askCancel = (t: any) => confirm({
    title: "Cancel this task?", message: `"${t.title}" will move to Canceled. You can restore it later.`,
    confirmLabel: "Cancel task", cancelLabel: "Keep it", danger: true, accept: () => handleCancel(t.id, true),
  });

  const handleChangePriority = async (id: any, newPriority: string) => {
    try {
      await api.put(`/api/workspace/tasks/${id}/priority`, { priority: newPriority });
      fetchTasks();
    } catch (err: any) {
      console.error("Error updating priority:", err);
      error(err.response?.data?.error || "Failed to update priority.");
    }
  };

  const handleReassign = async (id: any, assignedToId: any) => {
    try {
      await api.put(`/api/workspace/tasks/${id}/assign`, { assignedToId });
      fetchTasks();
      success("Task reassigned.");
    } catch (err: any) {
      console.error("Error reassigning task:", err);
      error(err.response?.data?.error || "Failed to reassign task.");
    }
  };

  // Open a document in a new tab
  const viewDocument = async (docId: any) => {
    try {
      const res = await api.get(`/api/documents/preview/${docId}`, { responseType: "blob" });
      window.open(URL.createObjectURL(res.data), "_blank");
    } catch (err) {
      console.error("Preview error:", err);
      error("Could not open document.");
    }
  };

  const caseOptions = cases.map((c) => ({ value: c.id, label: `${c.caseNumber} — ${c.caseTitle}` }));
  const assigneeOptions = assignees.map((a) => ({ value: a.id, label: a.fullName || a.email }));

  const inScope = useCallback((t: any) =>
    !(scope === "mine" && t.assignedToId !== myId) && !(scope === "created" && t.createdById !== myId), [scope, myId]);
  // Figures and quick-filter counts: open tasks in the current scope.
  const openInScope = tasks.filter((t) => isOpen(t) && inScope(t));
  const reviewCount = tasks.filter((t) => inScope(t) && canReviewTask(t, myId, canAssign)).length;
  const countOf = (k: string) => openInScope.filter(QUICK.find((q) => q.key === k)!.test).length;
  const quickTest = QUICK.find((q) => q.key === quick)?.test;

  const visibleTasks = useMemo(() => {
    const filtered = tasks.filter((t) => {
      if (filter === "inprogress" && (t.completed || t.cancelled)) return false;
      if (filter === "review" && !canReviewTask(t, myId, canAssign)) return false;
      if (filter === "completed" && (!t.completed || t.cancelled)) return false;
      if (filter === "canceled" && !t.cancelled) return false;
      if (!inScope(t)) return false;
      if (quickTest && !(isOpen(t) && quickTest(t))) return false;
      if (searchText.trim()) {
        const k = searchText.toLowerCase();
        return (t.title || "").toLowerCase().includes(k)
          || (t.caseNumber || "").toLowerCase().includes(k)
          || (t.caseTitle || "").toLowerCase().includes(k)
          || (t.assignedToName || "").toLowerCase().includes(k);
      }
      return true;
    });
    // Open work, most urgent first: overdue, today, soonest, then no deadline;
    // within a day High before Medium before Low. Done tabs keep server order.
    return filter === "inprogress" || filter === "review"
      ? [...filtered].sort((a, b) =>
        (deadlineState(a).days - deadlineState(b).days)
        || (PRIORITY_RANK[a.priority || "MEDIUM"] - PRIORITY_RANK[b.priority || "MEDIUM"])
        || (a.id - b.id))
      : filtered;
  }, [tasks, filter, myId, canAssign, inScope, quickTest, searchText]);

  const isAssigner = (t: any) => (t.assignedById ?? t.createdById) === myId;
  const canToggle = (t: any) => hasPermission("TASK_EDIT") || t.assignedToId === myId;

  // Row actions: hand back, review, or complete. Clicks here never open the drawer.
  const rowActions = (t: any) => {
    const submit = canSubmitTask(t, myId);
    const review = canReviewTask(t, myId, canAssign);
    return (
      <div className="row court-acts" onClick={(e) => e.stopPropagation()}>
        <SubmitWork task={t} myId={myId} toast={toast} onDone={() => fetchTasks()} />
        <ReviewActions task={t} myId={myId} canAssign={canAssign} toast={toast} onDone={() => fetchTasks()} />
        {!submit && !review && isOpen(t) && canToggle(t) && (
          <button type="button" className="btn sm" onClick={() => handleToggle(t.id)}><Icon name="check" size="sm" />Complete</button>
        )}
        {!submit && !review && !isOpen(t) && <span className="faint xs">—</span>}
      </div>
    );
  };

  const columns: Column<any>[] = [
    {
      key: "title", label: "Task", sort: (t) => t.title || "",
      render: (t) => <>
        <div className="cell-title">{t.title}</div>
        {t.caseNumber ? <div className="cell-sub mono">{t.caseNumber}</div> : <div className="cell-sub">General practice task</div>}
      </>,
    },
    {
      key: "case", label: "Case", hideSm: true, sort: (t) => t.caseNumber || "",
      render: (t) => t.caseId
        ? <Link className="link mono small" to={`/dashboard/cases/${t.caseId}`} title={t.caseTitle || ""} onClick={(e) => e.stopPropagation()}>{t.caseNumber}</Link>
        : <span className="faint">—</span>,
    },
    {
      key: "assignee", label: "Assigned to", hideSm: true, sort: (t) => t.assignedToName || "",
      render: (t) => t.assignedToName
        ? <span className="row court-nowrap-row"><Avatar name={t.assignedToName} size="sm" /><span>{t.assignedToId === myId ? "Me" : t.assignedToName}</span></span>
        : <span className="faint">Unassigned</span>,
    },
    { key: "priority", label: "Priority", sort: (t) => PRIORITY_RANK[t.priority || "MEDIUM"], render: (t) => <Chip tone={PRIORITY_TONE[t.priority || "MEDIUM"]}>{PRIORITY_OPTIONS.find((p) => p.value === (t.priority || "MEDIUM"))?.label}</Chip> },
    {
      key: "due", label: "Due", sort: (t) => t.deadline || "9999",
      render: (t) => {
        if (!t.deadline) return <span className="faint">—</span>;
        const d = deadlineState(t);
        return <>
          <span className="nowrap">{fdate(t.deadline)}</span>
          {d.label && <div className={`cell-sub court-due-${d.kind}`}>{d.label}</div>}
        </>;
      },
    },
    {
      key: "status", label: "Status", hideSm: true, sort: (t) => statusOf(t).label,
      render: (t) => {
        const s = statusOf(t);
        return <div className="row wrap court-chips"><Chip tone={s.tone}>{s.label}</Chip>{s.label !== "To review" && <ReviewChip task={t} />}</div>;
      },
    },
    { key: "actions", label: <span className="sr-only">Actions</span>, className: "actions", render: rowActions },
  ];

  const openTask = tasks.find((t) => t.id === openId) || null;
  const filterLabel = FILTERS.find((f) => f.value === filter)?.label.toLowerCase();

  return (
    <div className="court">
      <PageHead title="Tasks"
        sub="Assignments, research, drafting and follow-ups across all matters. Review work that has been submitted to you and keep deadlines visible."
        actions={hasPermission("TASK_CREATE") && (
          <button type="button" className="btn primary" onClick={() => { setTitleError(false); setShowAddModal(true); }}><Icon name="plus" size="sm" />New task</button>
        )} />

      {/* Each figure narrows the list. */}
      <div className="figures court-gap-b">
        <button type="button" className="figure" aria-pressed={filter === "inprogress" && !quick} onClick={() => { setFilter("inprogress"); setQuick(null); }}>
          <div className="lbl">Open tasks</div><div className="val">{openInScope.length}</div>
        </button>
        <button type="button" className="figure" aria-pressed={filter === "review"} onClick={() => { setFilter("review"); setQuick(null); }}>
          <div className="lbl">Awaiting your review</div><div className="val">{reviewCount}</div>
        </button>
        <button type="button" className="figure" aria-pressed={quick === "today"} onClick={() => { setFilter("inprogress"); setQuick(quick === "today" ? null : "today"); }}>
          <div className="lbl">Due today</div><div className="val">{countOf("today")}</div>
        </button>
        <button type="button" className="figure" aria-pressed={quick === "overdue"} onClick={() => { setFilter("inprogress"); setQuick(quick === "overdue" ? null : "overdue"); }}>
          <div className="lbl">Overdue</div><div className={`val${countOf("overdue") ? " court-bad" : ""}`}>{countOf("overdue")}</div>
        </button>
      </div>

      <div className="toolbar">
        <SearchInput value={searchText} onChange={(v) => { setSearchText(v); setHighlightedId(null); }} placeholder="Search tasks, cases or people" className="court-search" />
        <label className="sr-only" htmlFor="tk-scope">Whose tasks</label>
        <select id="tk-scope" className="input court-select" value={scope} onChange={(e) => setScope(e.target.value)}>
          {SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <label className="sr-only" htmlFor="tk-status">Status</label>
        <select id="tk-status" className="input court-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          {FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {QUICK.filter((q) => q.key === "week" || q.key === "high").map((q) => (
          <FilterChip key={q.key} on={quick === q.key} onClick={() => setQuick(quick === q.key ? null : q.key)}>
            {q.label} <span className="faint">{countOf(q.key)}</span>
          </FilterChip>
        ))}
        {quick && <button type="button" className="btn ghost sm" onClick={() => setQuick(null)}>Show all</button>}
      </div>

      <DataTable rows={visibleTasks} columns={columns} rowKey={(t) => t.id} loading={!loaded}
        onRow={(t) => setOpenId(t.id)}
        rowClass={(t) => [highlightedId === t.id ? "hl" : "", t.cancelled ? "court-row-muted" : ""].filter(Boolean).join(" ") || undefined}
        empty={{ icon: "tasks", title: `No ${filterLabel} tasks`, text: searchText || quick ? "Clear the search or filters to see more." : "All caught up." }} />

      {/* Task details */}
      <Drawer open={!!openTask} onClose={() => setOpenId(null)} title={openTask?.title || ""}
        sub={openTask && <><Chip tone={statusOf(openTask).tone}>{statusOf(openTask).label}</Chip><Chip tone={PRIORITY_TONE[openTask.priority || "MEDIUM"]}>{PRIORITY_OPTIONS.find((p) => p.value === (openTask.priority || "MEDIUM"))?.label} priority</Chip><ReviewChip task={openTask} /></>}
        footer={openTask && <>
          {isAssigner(openTask) && (openTask.cancelled
            ? <button type="button" className="btn" onClick={() => handleCancel(openTask.id, false)}><Icon name="restore" size="sm" />Restore task</button>
            : <button type="button" className="btn danger" onClick={() => askCancel(openTask)}><Icon name="x" size="sm" />Cancel task</button>)}
          <span className="grow" />
          {openTask.completed && !openTask.cancelled && canToggle(openTask) && !openTask.needsReview && (
            <button type="button" className="btn" onClick={() => handleToggle(openTask.id)}>Reopen</button>
          )}
          {rowActions(openTask)}
        </>}>
        {openTask && (
          <div className="stack court-drawer">
            <dl className="kv">
              <dt>Case</dt>
              <dd>{openTask.caseId ? <><Link className="link mono" to={`/dashboard/cases/${openTask.caseId}`}>{openTask.caseNumber}</Link>{openTask.caseTitle && <div className="faint xs">{openTask.caseTitle}</div>}</> : "General practice task"}</dd>
              <dt>Assigned to</dt><dd>{openTask.assignedToName ? (openTask.assignedToId === myId ? "Me" : openTask.assignedToName) : "Unassigned"}</dd>
              <dt>Assigned by</dt><dd>{openTask.assignedByName || openTask.createdByName || "—"}</dd>
              <dt>Due</dt><dd>{openTask.deadline ? <>{fdate(openTask.deadline)}{deadlineState(openTask).label && <span className={`court-due-${deadlineState(openTask).kind}`}> · {deadlineState(openTask).label}</span>}</> : "—"}</dd>
            </dl>

            <ReviewNote task={openTask} />

            {(openTask.draftSessionId || openTask.documents?.length > 0) && (
              <div>
                <div className="label court-label">Attached</div>
                <div className="row wrap">
                  {openTask.draftSessionId && (
                    <button type="button" className="btn sm" onClick={() => navigate(DRAFTING.draft(openTask.draftSessionId))}><Icon name="pen" size="sm" />Open draft</button>
                  )}
                  {openTask.documents?.map((d: any) => (
                    <button key={d.id} type="button" className="btn sm" onClick={() => viewDocument(d.id)} title={`View ${d.name}`}><Icon name="eye" size="sm" />{d.name}</button>
                  ))}
                </div>
              </div>
            )}

            {/* Priority and cancel are the assigner's (the server enforces it). */}
            {(isAssigner(openTask) || canAssign) && isOpen(openTask) && (
              <div className="form-grid">
                {isAssigner(openTask) && (
                  <SelectField label="Priority" value={openTask.priority || "MEDIUM"} options={PRIORITY_OPTIONS}
                    onChange={(e) => handleChangePriority(openTask.id, e.target.value)} />
                )}
                {canAssign && (
                  <SelectField label="Assigned to" value={openTask.assignedToId || ""}
                    options={[...(openTask.assignedToId ? [] : [{ value: "", label: "Unassigned", disabled: true }]), { value: myId, label: "Me" }, ...assigneeOptions.filter((a) => a.value !== myId)]}
                    onChange={(e) => handleReassign(openTask.id, Number(e.target.value))} />
                )}
              </div>
            )}

            {isOpen(openTask) && hasPermission("DRAFT_CREATE") && (
              <button type="button" className="btn court-self-start" onClick={() => navigate(newDraftUrl({ caseId: openTask.caseId, taskId: openTask.id }))}>
                <Icon name="pen" size="sm" />Draft for this task
              </button>
            )}

            <SubmissionHistory task={openTask} myId={myId} canAssign={canAssign} toast={toast}
              onDone={() => fetchTasks()} onViewDocument={viewDocument}
              onOpenDraft={() => navigate(DRAFTING.draft(openTask.draftSessionId))} />
          </div>
        )}
      </Drawer>

      {/* New task */}
      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="New task"
        footer={<>
          <button type="button" className="btn ghost" onClick={() => setShowAddModal(false)}>Cancel</button>
          <button type="submit" form="task-form" className="btn primary"><Icon name="plus" size="sm" />Add task</button>
        </>}>
        <form id="task-form" onSubmit={handleCreateTask} className="form-grid" noValidate>
          <TextField full label="Task" required placeholder="What needs to be done?" value={title} autoFocus
            error={titleError && "Say what needs to be done."}
            onChange={(e) => { setTitle(e.target.value); setTitleError(false); }} />
          <SelectField label="Priority" value={priority} options={PRIORITY_OPTIONS} onChange={(e) => setPriority(e.target.value)} />
          <TextField label="Deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          <SelectField full label="Link case" value={linkedCase} placeholder="No case (general task)" options={caseOptions}
            onChange={(e) => setLinkedCase(e.target.value)} />
          {canAssign && (
            <SelectField full label="Assign to" value={assignTo} options={[{ value: "", label: "Myself" }, ...assigneeOptions]}
              onChange={(e) => setAssignTo(e.target.value)} />
          )}
          {hasPermission("DOCUMENT_UPLOAD") && <>
            <Field label="Documents">
              {(id) => (
                <label className="btn court-file" htmlFor={id}>
                  <Icon name="upload" size="sm" />{files.length ? `${files.length} file(s)` : "Attach files"}
                  <input id={id} type="file" multiple className="sr-only" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
                </label>
              )}
            </Field>
            <SelectField label="Category" value={docCategory} placeholder="Select category" options={DOC_CATEGORIES}
              onChange={(e) => setDocCategory(e.target.value)} />
          </>}
          {files.length > 0 && (
            <div className="row wrap full">
              {files.map((f, i) => (
                <span key={i} className="chip info">
                  {f.name}
                  <button type="button" className="court-chip-x" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, idx) => idx !== i))}><Icon name="x" size="sm" /></button>
                </span>
              ))}
            </div>
          )}
        </form>
      </Modal>
    </div>
  );
}
