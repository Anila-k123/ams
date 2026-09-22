import React, { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import { jwtDecode } from "jwt-decode";
import { FiPlus, FiXCircle, FiRotateCcw, FiCheckSquare, FiSquare, FiSearch, FiPaperclip, FiEye, FiX, FiUser } from "react-icons/fi";
import "../assets/styles/TasksPage.css";
import { useLoading } from "../contexts/LoadingContext.jsx";
import { useToast } from "../contexts/ToastContext.jsx";
import { usePermission } from "../contexts/PermissionContext";
import Modal from "../components/Modal";

const FILTERS = [
  { key: "inprogress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "canceled", label: "Canceled" },
];

// Same document categories as the Documents upload, so a file attached to a task
// is filed under the same taxonomy.
const DOC_CATEGORIES = [
  "Court Order", "Petition", "Evidence", "Agreement", "Affidavit",
  "Notice", "Judgment", "Invoice", "Payment Receipt",
  "Identity Proof", "Address Proof", "Other",
];

const selectStyles = {
  control: (base, state) => ({
    ...base,
    backgroundColor: "var(--input-bg)",
    borderColor: state.isFocused ? "var(--input-focus-border)" : "var(--input-border)",
    borderRadius: "8px",
    minHeight: "42px",
    boxShadow: "none",
    "&:hover": { borderColor: "var(--input-focus-border)" },
  }),
  menu: (base) => ({ ...base, backgroundColor: "var(--bg-secondary)", zIndex: 9999 }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected ? "var(--accent)" : state.isFocused ? "var(--border-color)" : "transparent",
    color: state.isSelected ? "#fff" : "var(--text-primary)",
  }),
  singleValue: (base) => ({ ...base, color: "var(--text-primary)" }),
  placeholder: (base) => ({ ...base, color: "var(--text-muted)" }),
  input: (base) => ({ ...base, color: "var(--text-primary)" }),
};

export default function TasksPage() {
  const { hasPermission } = usePermission();
  const [tasks, setTasks] = useState([]);
  const [cases, setCases] = useState([]);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [deadline, setDeadline] = useState("");
  const [linkedCase, setLinkedCase] = useState(null);
  const [files, setFiles] = useState([]);
  const [docCategory, setDocCategory] = useState("");
  const [searchText, setSearchText] = useState("");
  const [filter, setFilter] = useState("inprogress");
  const [scope, setScope] = useState("team");   // team | mine | created
  const [showAddModal, setShowAddModal] = useState(false);
  const [assignees, setAssignees] = useState([]);
  const [assignTo, setAssignTo] = useState("");   // "" = myself
  const [highlightedId, setHighlightedId] = useState(null);
  const location = useLocation();
  const navigate = useNavigate();

  const token = localStorage.getItem("token");
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };
  const canAssign = hasPermission("TASK_ASSIGN");
  const myId = (() => {
    try { return jwtDecode(token)?.advocateId ?? null; } catch { return null; }
  })();
  const { withLoading } = useLoading();
  const { success, error } = useToast();

  const fetchTasks = useCallback(async () => {
    try {
      const res = await axios.get("/api/workspace/tasks/all", authHeaders);
      setTasks(res.data || []);
    } catch (err) {
      console.error("Error fetching tasks:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchCases = useCallback(async () => {
    try {
      const res = await axios.get("/api/cases/my-cases", authHeaders);
      setCases(res.data || []);
    } catch (err) {
      console.error("Error fetching cases:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const fetchAssignees = useCallback(async () => {
    if (!canAssign) return;
    try {
      const res = await axios.get("/api/workspace/assignable-advocates", authHeaders);
      setAssignees(res.data || []);
    } catch (err) {
      console.error("Error fetching assignable advocates:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, canAssign]);

  useEffect(() => { fetchTasks(); fetchCases(); fetchAssignees(); }, [fetchTasks, fetchCases, fetchAssignees]);

  // Global Search navigation
  useEffect(() => {
    if (location.state?.search) {
      setSearchText(location.state.search);
      setHighlightedId(location.state.id || null);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Upload files → return array of document ids (linked to case if chosen)
  const uploadFiles = async (caseId) => {
    const ids = [];
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      if (caseId) fd.append("caseId", caseId);
      if (docCategory) fd.append("category", docCategory);
      const res = await axios.post("/api/documents/upload", fd, authHeaders);
      if (res.data?.id) ids.push(res.data.id);
    }
    return ids;
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await withLoading((async () => {
        const caseId = linkedCase?.value || null;
        // 1) create the task
        const res = await axios.post("/api/workspace/tasks/create", {
          title: title.trim(), priority, deadline: deadline || null, caseId,
          assignedToId: assignTo || undefined,
        }, authHeaders);
        const taskId = res.data.id;
        // 2) upload + attach documents
        if (files.length) {
          const docIds = await uploadFiles(caseId);
          for (const docId of docIds) {
            await axios.post(`/api/workspace/tasks/${taskId}/documents`, { documentId: docId }, authHeaders);
          }
        }
      })(), "Creating Task...");
      setTitle(""); setPriority("MEDIUM"); setDeadline(""); setLinkedCase(null); setFiles([]); setDocCategory(""); setAssignTo("");
      setShowAddModal(false);
      fetchTasks();
      success("Task created.");
    } catch (err) {
      console.error("Error creating task:", err);
      error(err.response?.data?.error || "Failed to create task.");
    }
  };

  const handleToggle = async (id) => {
    try {
      await axios.put(`/api/workspace/tasks/${id}/toggle`, {}, authHeaders);
      fetchTasks();
    } catch (err) { console.error("Error toggling task:", err); }
  };

  const handleCancel = async (id, cancelled = true) => {
    try {
      await withLoading(
        axios.put(`/api/workspace/tasks/${id}/cancel`, { cancelled }, authHeaders),
        cancelled ? "Cancelling Task..." : "Restoring Task...");
      fetchTasks();
    } catch (err) {
      console.error("Error cancelling task:", err);
      error(err.response?.data?.error || "Failed to update task.");
    }
  };

  const handleChangePriority = async (id, newPriority) => {
    try {
      await axios.put(`/api/workspace/tasks/${id}/priority`, { priority: newPriority }, authHeaders);
      fetchTasks();
    } catch (err) {
      console.error("Error updating priority:", err);
      error(err.response?.data?.error || "Failed to update priority.");
    }
  };

  const handleReassign = async (id, assignedToId) => {
    try {
      await axios.put(`/api/workspace/tasks/${id}/assign`, { assignedToId }, authHeaders);
      fetchTasks();
      success("Task reassigned.");
    } catch (err) {
      console.error("Error reassigning task:", err);
      error(err.response?.data?.error || "Failed to reassign task.");
    }
  };

  // Open a document in a new tab
  const viewDocument = async (docId) => {
    try {
      const res = await axios.get(`/api/documents/preview/${docId}`, { ...authHeaders, responseType: "blob" });
      window.open(URL.createObjectURL(res.data), "_blank");
    } catch (err) {
      console.error("Preview error:", err);
      error("Could not open document.");
    }
  };

  const caseOptions = cases.map((c) => ({ value: c.id, label: `${c.caseNumber} — ${c.caseTitle}` }));

  const visibleTasks = tasks.filter((t) => {
    if (filter === "inprogress" && (t.completed || t.cancelled)) return false;
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
      <div className="tasks-page-header">
        {hasPermission("TASK_CREATE") && (
          <button className="tasks-add-btn" onClick={() => setShowAddModal(true)}>
            <FiPlus /> Add Task
          </button>
        )}
      </div>

      {/* New Task Form (popup) */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="New Task">
        <div className="task-form-modal">
      <form onSubmit={handleCreateTask} className="task-creation-form task-creation-form-rich">
        <div className="task-field task-field-title">
          <label htmlFor="task-title">Task</label>
          <input
            id="task-title"
            type="text"
            placeholder="What needs to be done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="task-title-input"
          />
        </div>
        <div className="task-field">
          <label htmlFor="task-priority">Priority</label>
          <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
            <option value="HIGH">High Priority</option>
            <option value="MEDIUM">Medium Priority</option>
            <option value="LOW">Low Priority</option>
          </select>
        </div>
        <div className="task-field">
          <label htmlFor="task-deadline">Deadline</label>
          <input id="task-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <div className="task-field task-field-case">
          <label>Link Case</label>
          <Select
            options={caseOptions}
            value={linkedCase}
            onChange={setLinkedCase}
            placeholder="Link case (optional)"
            styles={selectStyles}
            menuPortalTarget={typeof document !== "undefined" ? document.body : null}
            menuPosition="fixed"
            isClearable
          />
        </div>
        <div className="task-field">
          <label>Documents</label>
          <label className="task-attach-btn" title="Attach documents">
            <FiPaperclip />
            <span>{files.length ? `${files.length} file(s)` : "Attach files"}</span>
            <input type="file" multiple style={{ display: "none" }}
              onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          </label>
        </div>
        <div className="task-field">
          <label htmlFor="task-doc-category">Category</label>
          <select id="task-doc-category" value={docCategory} onChange={(e) => setDocCategory(e.target.value)}>
            <option value="">Select category</option>
            {DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {canAssign && (
          <div className="task-field">
            <label htmlFor="task-assign-to">Assign to</label>
            <select id="task-assign-to" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
              <option value="">Myself</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>{a.fullName || a.email}</option>
              ))}
            </select>
          </div>
        )}
        {hasPermission("TASK_CREATE") && (
          <div className="task-field task-field-submit">
            <button type="submit"><FiPlus /> Add Task</button>
          </div>
        )}
      </form>
      {files.length > 0 && (
        <div className="task-file-chips">
          {files.map((f, i) => (
            <span className="task-file-chip" key={i}>
              {f.name}
              <button type="button" onClick={() => setFiles(files.filter((_, idx) => idx !== i))}><FiX /></button>
            </span>
          ))}
        </div>
      )}
        </div>
      </Modal>

      {/* Filter + search */}
      <div className="tasks-toolbar">
        <div className="tasks-filter-tabs">
          {[{ key: "team", label: "Team" }, { key: "mine", label: "Assigned to me" }, { key: "created", label: "Created by me" }].map((s) => (
            <button key={s.key} className={`tasks-filter-tab ${scope === s.key ? "active" : ""}`} onClick={() => setScope(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="tasks-filter-tabs">
          {FILTERS.map((f) => (
            <button key={f.key} className={`tasks-filter-tab ${filter === f.key ? "active" : ""}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="task-search-bar">
          <FiSearch className="task-search-icon" />
          <input
            type="text"
            placeholder="Search tasks or cases..."
            value={searchText}
            onChange={(e) => { setSearchText(e.target.value); setHighlightedId(null); }}
          />
        </div>
      </div>

      {/* Tasks List */}
      <div className="tasks-list-panel">
        {visibleTasks.length === 0 ? (
          <p className="no-data">All caught up! No tasks here.</p>
        ) : (
          <div className="tasks-rows-grid">
            {visibleTasks.map((task) => (
              <div
                key={task.id}
                className={`task-row-card ${task.completed ? "completed" : ""}${task.cancelled ? " cancelled" : ""}${highlightedId === task.id ? " highlight-row" : ""}`}
                ref={(el) => { if (highlightedId === task.id && el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }}
              >
                <button className="toggle-complete-btn" onClick={() => handleToggle(task.id)}>
                  {task.completed ? <FiCheckSquare className="icon-chk checked" /> : <FiSquare className="icon-chk" />}
                </button>
                <div className="task-content">
                  <span className="task-title">{task.title}</span>
                  <div className="task-meta-row">
                    {task.caseNumber && (
                      <span className="task-case-chip" onClick={() => navigate(`/dashboard/cases/${task.caseId}`)} title={task.caseTitle || ""}>
                        ⚖ {task.caseNumber}
                      </span>
                    )}
                    {task.deadline && (
                      <span className="task-due-date">📅 {new Date(task.deadline).toLocaleDateString()}</span>
                    )}
                    {task.documents?.map((d) => (
                      <span key={d.id} className="task-doc-chip" onClick={() => viewDocument(d.id)} title={`View ${d.name}`}>
                        <FiEye /> {d.name}
                      </span>
                    ))}
                    {task.assignedToName && (
                      <span className="task-assignee-chip" title={task.assignedToId === myId ? "Assigned to you" : `Assigned to ${task.assignedToName}`}>
                        <FiUser /> {task.assignedToId === myId ? "You" : task.assignedToName}
                      </span>
                    )}
                    {task.cancelled && <span className="task-cancelled-chip">Cancelled</span>}
                  </div>
                </div>
                <div className="task-side-actions">
                  <select
                    className="task-reassign-select"
                    value={task.priority || "MEDIUM"}
                    onChange={(e) => handleChangePriority(task.id, e.target.value)}
                    title="Change priority"
                  >
                    <option value="HIGH">High</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="LOW">Low</option>
                  </select>
                  {canAssign && (
                    <select
                      className="task-reassign-select"
                      value={task.assignedToId || ""}
                      onChange={(e) => handleReassign(task.id, e.target.value)}
                      title="Reassign task"
                    >
                      <option value={myId}>Me</option>
                      {assignees.map((a) => (
                        <option key={a.id} value={a.id}>{a.fullName || a.email}</option>
                      ))}
                    </select>
                  )}
                  {(task.assignedById ?? task.createdById) === myId && (
                    task.cancelled
                      ? <button className="delete-task-btn" title="Restore task" onClick={() => handleCancel(task.id, false)}><FiRotateCcw /></button>
                      : <button className="delete-task-btn" title="Cancel task" onClick={() => handleCancel(task.id, true)}><FiXCircle /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
