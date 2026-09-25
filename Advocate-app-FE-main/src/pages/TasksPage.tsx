import { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Dialog } from "primereact/dialog";
import { SelectButton } from "primereact/selectbutton";
import { Tag } from "primereact/tag";
import { DRAFTING, newDraftUrl } from "./Drafting/routes";
import { ReviewActions, ReviewChip, ReviewNote } from "../components/TaskReview";
import { canReviewTask } from "../utils/taskReview";
import "../assets/styles/TasksPage.css";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import { useAuth } from "../context/AuthContext";
import api from "../api/client";

const FILTERS = [
  { value: "inprogress", label: "In Progress" },
  { value: "review", label: "To review" },
  { value: "completed", label: "Completed" },
  { value: "canceled", label: "Canceled" },
];
const SCOPES = [
  { value: "team", label: "Team" },
  { value: "mine", label: "Assigned to me" },
  { value: "created", label: "Created by me" },
];
const PRIORITY_OPTIONS = [
  { value: "HIGH", label: "High Priority" },
  { value: "MEDIUM", label: "Medium Priority" },
  { value: "LOW", label: "Low Priority" },
];
const PRIORITY_SHORT = [
  { value: "HIGH", label: "High" },
  { value: "MEDIUM", label: "Medium" },
  { value: "LOW", label: "Low" },
];

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

export default function TasksPage() {
  const { hasPermission } = usePermission();
  const { advocateId: myId } = useAuth();
  const [tasks, setTasks] = useState<any[]>([]);
  const [cases, setCases] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [deadline, setDeadline] = useState("");
  const [linkedCase, setLinkedCase] = useState<any>(null);   // case id
  const [files, setFiles] = useState<File[]>([]);
  const [docCategory, setDocCategory] = useState("");
  const [searchText, setSearchText] = useState("");
  const [filter, setFilter] = useState("inprogress");
  const [scope, setScope] = useState("team");   // team | mine | created
  const [showAddModal, setShowAddModal] = useState(false);
  const [assignees, setAssignees] = useState<any[]>([]);
  const [assignTo, setAssignTo] = useState<any>("");   // "" = myself
  const [highlightedId, setHighlightedId] = useState<any>(null);
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
    if (!title.trim()) return;
    try {
      await withLoading((async () => {
        const caseId = linkedCase || null;
        // 1) create the task
        const res = await api.post("/api/workspace/tasks/create", {
          title: title.trim(), priority, deadline: deadline || null, caseId,
          assignedToId: assignTo || undefined,
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
      setTitle(""); setPriority("MEDIUM"); setDeadline(""); setLinkedCase(null); setFiles([]); setDocCategory(""); setAssignTo("");
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
      const res = await api.put(`/api/workspace/tasks/${id}/toggle`, {});
      // On a delegated task the assignee's tick submits it for review instead.
      if (!res.data?.completed && res.data?.reviewStatus === "SUBMITTED") {
        success(`Submitted to ${res.data.assignedByName || "the assigner"} for review.`);
      }
      fetchTasks();
    } catch (err) { console.error("Error toggling task:", err); }
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

  const visibleTasks = tasks.filter((t) => {
    if (filter === "inprogress" && (t.completed || t.cancelled)) return false;
    if (filter === "review" && !canReviewTask(t, myId, canAssign)) return false;
    if (filter === "completed" && (!t.completed || t.cancelled)) return false;
    if (filter === "canceled" && !t.cancelled) return false;
    if (scope === "mine" && t.assignedToId !== myId) return false;
    if (scope === "created" && t.createdById !== myId) return false;
    if (searchText.trim()) {
      const k = searchText.toLowerCase();
      return (t.title || "").toLowerCase().includes(k)
        || (t.caseNumber || "").toLowerCase().includes(k)
        || (t.caseTitle || "").toLowerCase().includes(k);
    }
    return true;
  });

  return (
    <div className="tasks-page-container">
      <div className="flex justify-content-end">
        {hasPermission("TASK_CREATE") && (
          <Button icon="pi pi-plus" label="Add Task" onClick={() => setShowAddModal(true)} />
        )}
      </div>

      {/* New Task Form (popup) */}
      <Dialog visible={showAddModal} onHide={() => setShowAddModal(false)} header="New Task" modal
        style={{ width: "36rem" }} breakpoints={{ "640px": "95vw" }}>
        <form onSubmit={handleCreateTask} className="flex flex-column gap-3">
          <div className="task-field">
            <label htmlFor="task-title">Task</label>
            <InputText id="task-title" placeholder="What needs to be done?" value={title}
              onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="grid">
            <div className="col-12 md:col-6 task-field">
              <label htmlFor="task-priority">Priority</label>
              <Dropdown inputId="task-priority" value={priority} options={PRIORITY_OPTIONS} onChange={(e) => setPriority(e.value)} />
            </div>
            <div className="col-12 md:col-6 task-field">
              <label htmlFor="task-deadline">Deadline</label>
              <Calendar inputId="task-deadline" value={deadline ? new Date(`${deadline}T00:00:00`) : null}
                onChange={(e) => setDeadline(toISODate(e.value as Date))} dateFormat="dd/mm/yy" showIcon showButtonBar appendTo="self" />
            </div>
          </div>
          <div className="task-field">
            <label>Link Case</label>
            <Dropdown value={linkedCase} options={caseOptions} onChange={(e) => setLinkedCase(e.value ?? null)}
              placeholder="Link case (optional)" filter showClear appendTo={document.body} />
          </div>
          <div className="grid">
            <div className="col-12 md:col-6 task-field">
              <label>Documents</label>
              <label className="task-attach-btn" title="Attach documents">
                <i className="pi pi-paperclip" />
                <span>{files.length ? `${files.length} file(s)` : "Attach files"}</span>
                <input type="file" multiple style={{ display: "none" }}
                  onChange={(e) => setFiles(Array.from(e.target.files || []))} />
              </label>
            </div>
            <div className="col-12 md:col-6 task-field">
              <label htmlFor="task-doc-category">Category</label>
              <Dropdown inputId="task-doc-category" value={docCategory} placeholder="Select category" showClear
                options={DOC_CATEGORIES.map((c) => ({ value: c, label: c }))} onChange={(e) => setDocCategory(e.value || "")} />
            </div>
          </div>
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((f, i) => (
                <Tag key={i} severity="info">
                  <span className="flex align-items-center gap-1">
                    {f.name}
                    <i className="pi pi-times cursor-pointer" onClick={() => setFiles(files.filter((_, idx) => idx !== i))} />
                  </span>
                </Tag>
              ))}
            </div>
          )}
          {canAssign && (
            <div className="task-field">
              <label htmlFor="task-assign-to">Assign to</label>
              <Dropdown placeholder="Myself" inputId="task-assign-to" value={assignTo} options={[{ value: "", label: "Myself" }, ...assigneeOptions]}
                onChange={(e) => setAssignTo(e.value)} />
            </div>
          )}
          {hasPermission("TASK_CREATE") && (
            <div className="flex justify-content-end">
              <Button type="submit" icon="pi pi-plus" label="Add Task" />
            </div>
          )}
        </form>
      </Dialog>

      {/* Filter + search */}
      <div className="flex flex-wrap align-items-center gap-2">
        <SelectButton value={scope} options={SCOPES} onChange={(e) => e.value && setScope(e.value)} />
        <SelectButton value={filter} options={FILTERS} onChange={(e) => e.value && setFilter(e.value)} />
        <span className="p-input-icon-left flex-1" style={{ minWidth: 200, maxWidth: 320 }}>
          <i className="pi pi-search" />
          <InputText className="w-full" placeholder="Search tasks or cases..." value={searchText}
            onChange={(e) => { setSearchText(e.target.value); setHighlightedId(null); }} />
        </span>
      </div>

      {/* Tasks List */}
      {visibleTasks.length === 0 ? (
        <p className="task-empty">All caught up! No tasks here.</p>
      ) : (
        <div className="flex flex-column gap-2">
          {visibleTasks.map((task) => (
            <div
              key={task.id}
              className={`task-row-card ${task.completed ? "completed" : ""}${task.cancelled ? " cancelled" : ""}${highlightedId === task.id ? " highlight-row" : ""}`}
              ref={(el) => { if (highlightedId === task.id && el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }}
            >
              <Button className="p-button-rounded p-button-text"
                icon={task.completed ? "pi pi-check-square" : "pi pi-stop"}
                onClick={() => handleToggle(task.id)} aria-label="Toggle complete"
                tooltip={task.needsReview && task.assignedToId === myId && !task.completed ? "Submit for review" : undefined} />
              <div className="task-content">
                <span className="task-title">{task.title}</span>
                <div className="flex align-items-center flex-wrap gap-2 mt-1">
                  {task.caseNumber && (
                    <span className="task-chip task-case-chip" onClick={() => navigate(`/dashboard/cases/${task.caseId}`)} title={task.caseTitle || ""}>
                      <i className="pi pi-briefcase" /> {task.caseNumber}
                    </span>
                  )}
                  {task.deadline && (
                    <span className="task-chip"><i className="pi pi-calendar" /> {new Date(task.deadline).toLocaleDateString()}</span>
                  )}
                  {task.draftSessionId && (
                    <span className="task-chip task-doc-chip" onClick={() => navigate(DRAFTING.draft(task.draftSessionId))}
                      title="Open the draft in the drafting editor">
                      <i className="pi pi-file-edit" /> Open draft
                    </span>
                  )}
                  {task.documents?.map((d: any) => (
                    <span key={d.id} className="task-chip task-doc-chip" onClick={() => viewDocument(d.id)} title={`View ${d.name}`}>
                      <i className="pi pi-eye" /> {d.name}
                    </span>
                  ))}
                  {task.assignedToName && (
                    <span className="task-chip" title={task.assignedToId === myId ? "Assigned to you" : `Assigned to ${task.assignedToName}`}>
                      <i className="pi pi-user" /> {task.assignedToId === myId ? "You" : task.assignedToName}
                    </span>
                  )}
                  {task.cancelled && <Tag severity="danger" value="Cancelled" />}
                  <ReviewChip task={task} />
                </div>
                <ReviewNote task={task} />
              </div>
              <div className="flex align-items-center flex-wrap gap-1 justify-content-end">
                <Dropdown className="p-inputtext-sm" value={task.priority || "MEDIUM"} options={PRIORITY_SHORT}
                  onChange={(e) => handleChangePriority(task.id, e.value)} tooltip="Change priority" />
                {canAssign && (
                  <Dropdown className="p-inputtext-sm" value={task.assignedToId || ""} tooltip="Reassign task"
                    options={[{ value: myId, label: "Me" }, ...assigneeOptions]}
                    onChange={(e) => handleReassign(task.id, e.value)} />
                )}
                <ReviewActions task={task} myId={myId} canAssign={canAssign} toast={toast} onDone={() => fetchTasks()} />
                {!task.completed && !task.cancelled && (
                  <Button icon="pi pi-pencil" className="p-button-rounded p-button-text" tooltip="Draft for this task" aria-label="Draft for this task"
                    onClick={() => navigate(newDraftUrl({ caseId: task.caseId, taskId: task.id }))} />
                )}
                {(task.assignedById ?? task.createdById) === myId && (
                  task.cancelled
                    ? <Button icon="pi pi-replay" className="p-button-rounded p-button-text" tooltip="Restore task" aria-label="Restore task" onClick={() => handleCancel(task.id, false)} />
                    : <Button icon="pi pi-times-circle" className="p-button-rounded p-button-text p-button-danger" tooltip="Cancel task" aria-label="Cancel task" onClick={() => handleCancel(task.id, true)} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
