import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import {
  FiArrowLeft, FiCalendar, FiFolder, FiEye, FiDownload, FiUpload, FiTrash2,
  FiPlus, FiClock, FiTag, FiCheckCircle, FiCircle, FiFileText, FiDollarSign,
  FiUsers, FiLink, FiPaperclip
} from "react-icons/fi";
import CaseTimeline from "../components/CaseTimeline.jsx";
import CourtRecordView from "../components/CourtRecordView.jsx";
import { fetchCourtDocument } from "../services/courtDocuments";
import { useToast } from "../contexts/ToastContext.jsx";
import { useLoading } from "../contexts/LoadingContext.jsx";
import { formatCurrency } from "../utils/formatCurrency";
import { InlineLoader } from "../components/Loader";
import "../assets/styles/CaseDetail.css";

const TABS = ["Overview", "Expenses", "Payments", "Invoices", "Hearings", "Documents", "Notes", "Tasks", "Orders", "Court Record", "Timeline"];

// Parse the portal's mixed date formats into ISO (yyyy-mm-dd); "" if unparseable.
const _CD_MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,
  jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
function toISO(s) {
  if (!s) return "";
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
  m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?\s+(\d{4})/);
  if (m) { const mo = _CD_MONTHS[m[2].toLowerCase()]; if (mo) return `${m[3]}-${String(mo).padStart(2,"0")}-${m[1].padStart(2,"0")}`; }
  return "";
}

// Normalize orders out of a stored court record (Madras or eCourts) → [{number, date, details, judge}].
function extractOrders(record) {
  if (!record) return [];
  if (record.cases !== undefined) {
    const out = [];
    (record.cases || []).forEach((c) => (c.detail?.orders || []).forEach((o) =>
      out.push({ number: o.order_number || "", date: o.order_date || "", details: o.order_details || "", judge: "",
                 pdf: o.pdf || null, viewToken: c.view_token })));
    return out;
  }
  return (record.orders || []).map((o) => ({
    number: o.sl_no || "", date: o.order_date || "", details: o.case_details || "", judge: o.judge || "", pdf: null,
  }));
}

const PARTY_ROLES = ["Petitioner", "Respondent", "Appellant", "Complainant", "Accused", "Plaintiff", "Defendant", "Third Party", "Witness"];
const RELATION_TYPES = ["Appeal", "Connected", "Cross-Objection", "Same Parties", "Arising From", "Other"];
const EVENT_TYPES = [
  { value: "HEARING", label: "Hearing" },
  { value: "MEETING", label: "Client Meeting" },
  { value: "PAYMENT_DUE", label: "Payment Due" },
  { value: "DOCUMENT", label: "Document Filing" },
];

function fmtDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function CaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { success, error } = useToast();
  const { withLoading } = useLoading();

  const token = localStorage.getItem("token");
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  const [tab, setTab] = useState("Overview");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showTimeline, setShowTimeline] = useState(false);

  // Tab data
  const [events, setEvents] = useState([]);
  const [docs, setDocs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [financials, setFinancials] = useState(null);
  const [parties, setParties] = useState([]);
  const [related, setRelated] = useState([]);
  const [linkableCases, setLinkableCases] = useState([]);

  // Court record (imported from the court API)
  const [courtRecord, setCourtRecord] = useState(null);
  const [courtRecordComplex, setCourtRecordComplex] = useState("");
  const [courtRecordLoading, setCourtRecordLoading] = useState(false);
  const [courtRecordLoaded, setCourtRecordLoaded] = useState(false);
  const [orderDlBusy, setOrderDlBusy] = useState(-1);

  const [hearingBizModal, setHearingBizModal] = useState(null);
  const [hearingViewBusy, setHearingViewBusy] = useState(null);

  const downloadOrderPdf = async (order, i) => {
    setOrderDlBusy(i);
    try {
      await fetchCourtDocument({
        courtComplex: courtRecordComplex,
        viewToken: order.viewToken,
        kind: "order_pdf",
        token: order.pdf,
        label: `Order ${order.number || ""} ${order.date || ""}`.trim(),
      });
    } catch (e) {
      error && error(e?.message || "Couldn’t download the order PDF.");
    } finally {
      setOrderDlBusy(-1);
    }
  };

  // Map an event's ISO date -> the court record's hearing "business" token, so the
  // Hearings tab can offer a "View" (Daily Status) matching that date.
  const hearingBizByDate = useMemo(() => {
    const m = new Map();
    (courtRecord?.cases || []).forEach((c) => (c.detail?.history || []).forEach((h) => {
      if (!h.business) return;
      const iso = toISO(h.hearing_date) || toISO(h.business_date);
      if (iso && !m.has(iso)) m.set(iso, { business: h.business, viewToken: c.view_token, label: `Business ${h.business_date || ""}` });
    }));
    return m;
  }, [courtRecord]);

  const viewHearingBusiness = async (ev) => {
    const match = hearingBizByDate.get(ev.date);
    if (!match) return;
    setHearingViewBusy(ev.id);
    try {
      const biz = await fetchCourtDocument({
        courtComplex: courtRecordComplex, viewToken: match.viewToken,
        kind: "hearing_business", token: match.business, label: match.label,
      });
      if (biz) setHearingBizModal(biz);
    } catch (e) {
      error && error(e?.message || "Couldn’t fetch the hearing status.");
    } finally {
      setHearingViewBusy(null);
    }
  };

  // Inputs
  const [newTag, setNewTag] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newTask, setNewTask] = useState({ title: "", priority: "MEDIUM", deadline: "" });
  const [taskFiles, setTaskFiles] = useState([]);
  const [uploadFile, setUploadFile] = useState(null);

  // Add expense / invoice / payment / hearing modals
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showHearingModal, setShowHearingModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ title: "", amount: "", category: "", paymentDate: "", paymentStatus: "" });
  const [invoiceForm, setInvoiceForm] = useState({ invoiceNumber: "", amount: "", invoiceDate: "", dueDate: "" });
  const [paymentForm, setPaymentForm] = useState({ amount: "", paymentMode: "", referenceNumber: "", paymentDate: "", description: "" });
  const [hearingForm, setHearingForm] = useState({ title: "", eventType: "HEARING", date: "", time: "" });
  const [savingFin, setSavingFin] = useState(false);

  // Parties + related inline forms
  const [partyForm, setPartyForm] = useState({ name: "", role: "", counsel: "", contact: "", isOpponent: false });
  const [relatedForm, setRelatedForm] = useState({ relatedCaseId: "", relation: "", note: "" });

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/workspace/cases/${id}/summary`, authHeaders);
      setSummary(res.data);
    } catch (err) {
      console.error("Error loading case:", err);
      setSummary(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await axios.get(`/api/workspace/cases/${id}/events`, authHeaders);
      setEvents(res.data || []);
    } catch { setEvents([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  const fetchDocs = useCallback(async () => {
    try {
      const res = await axios.get(`/api/documents/by-case/${id}`, authHeaders);
      setDocs(res.data || []);
    } catch { setDocs([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await axios.get(`/api/workspace/cases/${id}/notes`, authHeaders);
      setNotes(res.data || []);
    } catch { setNotes([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await axios.get(`/api/workspace/cases/${id}/tasks`, authHeaders);
      setTasks(res.data || []);
    } catch { setTasks([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  const fetchFinancials = useCallback(async () => {
    try {
      const res = await axios.get(`/api/workspace/cases/${id}/financials`, authHeaders);
      setFinancials(res.data);
    } catch { setFinancials(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  const fetchParties = useCallback(async () => {
    try {
      const res = await axios.get(`/api/workspace/cases/${id}/parties`, authHeaders);
      setParties(res.data || []);
    } catch { setParties([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  const fetchRelated = useCallback(async () => {
    try {
      const res = await axios.get(`/api/workspace/cases/${id}/related`, authHeaders);
      setRelated(res.data || []);
    } catch { setRelated([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  const fetchLinkableCases = useCallback(async () => {
    try {
      const res = await axios.get(`/api/cases/my-cases`, authHeaders);
      setLinkableCases((res.data || []).filter((c) => c.id !== Number(id)));
    } catch { setLinkableCases([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token]);

  const addExpense = async () => {
    if (!expenseForm.title.trim()) { error("Expense title is required."); return; }
    setSavingFin(true);
    try {
      await withLoading(
        axios.post("/api/expenses/create", {
          title: expenseForm.title.trim(),
          amount: expenseForm.amount ? parseFloat(expenseForm.amount) : 0,
          category: expenseForm.category || null,
          paymentDate: expenseForm.paymentDate || null,
          paymentStatus: expenseForm.paymentStatus || null,
          caseId: Number(id),
        }, authHeaders),
        "Adding expense..."
      );
      setShowExpenseModal(false);
      setExpenseForm({ title: "", amount: "", category: "", paymentDate: "", paymentStatus: "" });
      fetchFinancials();
      fetchSummary();
      success("Expense added to this case.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to add expense.");
    } finally {
      setSavingFin(false);
    }
  };

  const addInvoice = async () => {
    if (!invoiceForm.invoiceNumber.trim()) { error("Invoice number is required."); return; }
    setSavingFin(true);
    try {
      await withLoading(
        axios.post("/api/invoices/create", {
          invoiceNumber: invoiceForm.invoiceNumber.trim(),
          amount: invoiceForm.amount ? parseFloat(invoiceForm.amount) : 0,
          invoiceDate: invoiceForm.invoiceDate || null,
          dueDate: invoiceForm.dueDate || null,
          caseId: Number(id),
        }, authHeaders),
        "Adding invoice..."
      );
      setShowInvoiceModal(false);
      setInvoiceForm({ invoiceNumber: "", amount: "", invoiceDate: "", dueDate: "" });
      fetchFinancials();
      fetchSummary();
      success("Invoice added to this case.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to add invoice.");
    } finally {
      setSavingFin(false);
    }
  };

  const addPayment = async () => {
    if (!paymentForm.amount) { error("Payment amount is required."); return; }
    setSavingFin(true);
    try {
      await withLoading(
        axios.post("/api/payments/create", {
          amount: parseFloat(paymentForm.amount),
          paymentMode: paymentForm.paymentMode || null,
          referenceNumber: paymentForm.referenceNumber || null,
          paymentDate: paymentForm.paymentDate || null,
          description: paymentForm.description || null,
          caseEntity: { id: Number(id) },
        }, authHeaders),
        "Recording payment..."
      );
      setShowPaymentModal(false);
      setPaymentForm({ amount: "", paymentMode: "", referenceNumber: "", paymentDate: "", description: "" });
      fetchFinancials();
      fetchSummary();
      success("Payment recorded for this case.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to record payment.");
    } finally {
      setSavingFin(false);
    }
  };

  const addHearing = async () => {
    if (!hearingForm.title.trim() || !hearingForm.date) { error("Title and date are required."); return; }
    setSavingFin(true);
    try {
      await withLoading(
        axios.post("/api/events/create", {
          title: hearingForm.title.trim(),
          eventType: hearingForm.eventType,
          date: hearingForm.date,
          time: hearingForm.time || null,
          caseEntity: { id: Number(id) },
        }, authHeaders),
        "Adding hearing..."
      );
      setShowHearingModal(false);
      setHearingForm({ title: "", eventType: "HEARING", date: "", time: "" });
      fetchEvents();
      fetchSummary();
      success("Hearing added to this case.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to add hearing.");
    } finally {
      setSavingFin(false);
    }
  };

  const addParty = async () => {
    if (!partyForm.name.trim()) { error("Party name is required."); return; }
    try {
      await axios.post(`/api/workspace/cases/${id}/parties`, {
        name: partyForm.name.trim(),
        role: partyForm.role || null,
        counsel: partyForm.counsel || null,
        contact: partyForm.contact || null,
        isOpponent: partyForm.isOpponent,
      }, authHeaders);
      setPartyForm({ name: "", role: "", counsel: "", contact: "", isOpponent: false });
      fetchParties();
      success("Party added.");
    } catch { error("Failed to add party."); }
  };

  const deleteParty = async (partyId) => {
    try {
      await axios.delete(`/api/workspace/parties/${partyId}`, authHeaders);
      fetchParties();
    } catch { error("Failed to remove party."); }
  };

  const addRelated = async () => {
    if (!relatedForm.relatedCaseId) { error("Select a case to link."); return; }
    try {
      await axios.post(`/api/workspace/cases/${id}/related`, {
        relatedCaseId: Number(relatedForm.relatedCaseId),
        relation: relatedForm.relation || null,
        note: relatedForm.note || null,
      }, authHeaders);
      setRelatedForm({ relatedCaseId: "", relation: "", note: "" });
      fetchRelated();
      success("Case linked.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to link case.");
    }
  };

  const deleteRelated = async (linkId) => {
    try {
      await axios.delete(`/api/workspace/related/${linkId}`, authHeaders);
      fetchRelated();
    } catch { error("Failed to remove link."); }
  };

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const fetchCourtRecord = useCallback(async () => {
    setCourtRecordLoading(true);
    try {
      const res = await axios.get(`/api/courtsearch/imported-records?caseId=${id}`, authHeaders);
      setCourtRecord(res.data?.raw || null);
      setCourtRecordComplex(res.data?.query?.court_complex || "");
    } catch {
      setCourtRecord(null); // 404 = no imported record for this case
    } finally {
      setCourtRecordLoading(false);
      setCourtRecordLoaded(true);
    }
  }, [id]);

  // Lazily load tab data on demand
  useEffect(() => {
    if (tab === "Overview") { fetchParties(); fetchRelated(); fetchLinkableCases(); }
    if (tab === "Expenses" || tab === "Invoices" || tab === "Payments") fetchFinancials();
    if (tab === "Hearings") fetchEvents();
    if (tab === "Documents") fetchDocs();
    if (tab === "Notes") fetchNotes();
    if (tab === "Tasks") fetchTasks();
    if ((tab === "Court Record" || tab === "Orders" || tab === "Hearings") && !courtRecordLoaded) fetchCourtRecord();
  }, [tab, fetchFinancials, fetchEvents, fetchDocs, fetchNotes, fetchTasks, fetchParties, fetchRelated, fetchLinkableCases, fetchCourtRecord, courtRecordLoaded]);

  // ---------- Tags ----------
  const addTag = async () => {
    const label = newTag.trim();
    if (!label) return;
    try {
      await axios.post(`/api/workspace/cases/${id}/tags`, { label }, authHeaders);
      setNewTag("");
      fetchSummary();
    } catch (err) { error("Failed to add tag."); }
  };

  const removeTag = async (tagId) => {
    try {
      await axios.delete(`/api/workspace/tags/${tagId}`, authHeaders);
      fetchSummary();
    } catch { error("Failed to remove tag."); }
  };

  // ---------- Notes ----------
  const addNote = async () => {
    const body = newNote.trim();
    if (!body) return;
    try {
      await withLoading(axios.post(`/api/workspace/cases/${id}/notes`, { body }, authHeaders), "Saving note...");
      setNewNote("");
      fetchNotes();
      fetchSummary();
      success("Note added.");
    } catch { error("Failed to add note."); }
  };

  const deleteNote = async (noteId) => {
    try {
      await axios.delete(`/api/workspace/notes/${noteId}`, authHeaders);
      fetchNotes();
      fetchSummary();
    } catch { error("Failed to delete note."); }
  };

  // ---------- Tasks ----------
  const addTask = async () => {
    const title = newTask.title.trim();
    if (!title) return;
    try {
      await withLoading((async () => {
        const res = await axios.post(`/api/workspace/cases/${id}/tasks`, {
          title, priority: newTask.priority, deadline: newTask.deadline || null,
        }, authHeaders);
        const taskId = res.data.id;
        for (const file of taskFiles) {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("caseId", id);
          const up = await axios.post("/api/documents/upload", fd, authHeaders);
          if (up.data?.id) {
            await axios.post(`/api/workspace/tasks/${taskId}/documents`, { documentId: up.data.id }, authHeaders);
          }
        }
      })(), "Adding task...");
      setNewTask({ title: "", priority: "MEDIUM", deadline: "" });
      setTaskFiles([]);
      fetchTasks();
      fetchSummary();
      success("Task added.");
    } catch { error("Failed to add task."); }
  };

  const toggleTask = async (taskId) => {
    try {
      await axios.put(`/api/workspace/tasks/${taskId}/toggle`, {}, authHeaders);
      fetchTasks();
      fetchSummary();
    } catch { error("Failed to update task."); }
  };

  const deleteTask = async (taskId) => {
    try {
      await axios.delete(`/api/workspace/tasks/${taskId}`, authHeaders);
      fetchTasks();
      fetchSummary();
    } catch { error("Failed to delete task."); }
  };

  // ---------- Documents ----------
  const previewDoc = async (docId) => {
    try {
      const res = await axios.get(`/api/documents/preview/${docId}`, { ...authHeaders, responseType: "blob" });
      window.open(URL.createObjectURL(res.data), "_blank");
    } catch { error("Preview failed."); }
  };

  const downloadDoc = async (docId, fileName) => {
    try {
      const res = await axios.get(`/api/documents/download/${docId}`, { ...authHeaders, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { error("Download failed."); }
  };

  const uploadDoc = async () => {
    if (!uploadFile) return;
    const fd = new FormData();
    fd.append("file", uploadFile);
    fd.append("caseId", id);
    try {
      await withLoading(axios.post("/api/documents/upload", fd, authHeaders), "Uploading...");
      setUploadFile(null);
      fetchDocs();
      success("Document uploaded.");
    } catch { error("Upload failed."); }
  };

  if (loading) {
    return (
      <div className="case-detail">
        <InlineLoader type="page" />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="case-detail">
        <button className="cd-back" onClick={() => navigate("/dashboard/cases")}>
          <FiArrowLeft /> Back to Workspace
        </button>
        <p className="cd-empty">Case not found or you don't have access.</p>
      </div>
    );
  }

  const f = summary.financials || {};

  return (
    <div className="case-detail">
      <button className="cd-back" onClick={() => navigate("/dashboard/cases")}>
        <FiArrowLeft /> Back to Workspace
      </button>

      {/* Header */}
      <div className="cd-header">
        <div className="cd-header-main">
          <div className="cd-title-row">
            <h2>{summary.caseTitle || summary.caseNumber}</h2>
            <span className={`status ${(summary.status || "").toLowerCase()}`}>{summary.status || "—"}</span>
          </div>
          <div className="cd-meta">
            <span><strong>Case No:</strong> {summary.caseNumber}</span>
            <span><strong>Type:</strong> {summary.caseType || "—"}</span>
            <span><strong>Court:</strong> {summary.courtLevel || "—"}</span>
            <span><strong>Client:</strong> {summary.clientName || "—"}</span>
          </div>
        </div>
        <div className="cd-header-side">
          {summary.nextHearing ? (
            <div className="cd-next-hearing">
              <FiCalendar />
              <div>
                <span className="cd-nh-label">Next Hearing</span>
                <span className="cd-nh-date">{fmtDate(summary.nextHearing.date)}</span>
              </div>
            </div>
          ) : (
            <div className="cd-next-hearing muted"><FiCalendar /> No upcoming hearing</div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="cd-tabs">
        {TABS.map((t) => (
          <button
            key={t}
            className={`cd-tab ${tab === t ? "active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t}
            {t === "Notes" && summary.noteCount ? <span className="cd-badge">{summary.noteCount}</span> : null}
            {t === "Tasks" && summary.taskCounts?.open ? <span className="cd-badge">{summary.taskCounts.open}</span> : null}
          </button>
        ))}
      </div>

      <div className="cd-panel">
        {/* OVERVIEW */}
        {tab === "Overview" && (
          <div className="cd-overview">
            <div className="cd-card">
              <h4>Description</h4>
              <p>{summary.description || "No description."}</p>
            </div>

            <div className="cd-card">
              <div className="cd-card-head">
                <h4><FiTag /> Tags</h4>
              </div>
              <div className="cd-tags">
                {(summary.tags || []).length === 0 && <span className="cd-muted">No tags yet.</span>}
                {(summary.tags || []).map((t) => (
                  <span key={t.id} className="cd-tag-chip">
                    {t.label}
                    <button onClick={() => removeTag(t.id)} title="Remove">×</button>
                  </span>
                ))}
              </div>
              <div className="cd-inline-add">
                <input
                  type="text" placeholder="Add a tag (e.g. High Risk)"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addTag()}
                />
                <button onClick={addTag}><FiPlus /> Add</button>
              </div>
            </div>

            <div className="cd-quick-stats">
              <div className="cd-quick">
                <span className="cd-quick-val">{summary.taskCounts?.open ?? 0}</span>
                <span className="cd-quick-lbl">Open Tasks</span>
              </div>
              <div className="cd-quick">
                <span className="cd-quick-val">{summary.taskCounts?.done ?? 0}</span>
                <span className="cd-quick-lbl">Done Tasks</span>
              </div>
              <div className="cd-quick">
                <span className="cd-quick-val">{summary.noteCount ?? 0}</span>
                <span className="cd-quick-lbl">Notes</span>
              </div>
              <div className="cd-quick">
                <span className="cd-quick-val">{formatCurrency(f.pendingFromClient || 0)}</span>
                <span className="cd-quick-lbl">Pending Dues</span>
              </div>
            </div>

            {/* Parties / opponents */}
            <div className="cd-card">
              <div className="cd-card-head">
                <h4><FiUsers /> Parties</h4>
              </div>
              {parties.length === 0 && <span className="cd-muted">No parties added yet.</span>}
              <div className="cd-party-list">
                {parties.map((p) => (
                  <div className={`cd-party ${p.isOpponent ? "opponent" : ""}`} key={p.id}>
                    <div className="cd-party-main">
                      <span className="cd-party-name">{p.name}</span>
                      {p.role && <span className="cd-party-role">{p.role}</span>}
                      {p.isOpponent && <span className="cd-party-opp">Opponent</span>}
                    </div>
                    <div className="cd-party-sub">
                      {p.counsel && <span>Counsel: {p.counsel}</span>}
                      {p.contact && <span>{p.contact}</span>}
                    </div>
                    <button className="cd-row-del" onClick={() => deleteParty(p.id)} title="Remove"><FiTrash2 /></button>
                  </div>
                ))}
              </div>
              <div className="cd-party-add">
                <input type="text" placeholder="Party name" value={partyForm.name}
                  onChange={(e) => setPartyForm({ ...partyForm, name: e.target.value })} />
                <select value={partyForm.role} onChange={(e) => setPartyForm({ ...partyForm, role: e.target.value })}>
                  <option value="">Role</option>
                  {PARTY_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <input type="text" placeholder="Counsel (optional)" value={partyForm.counsel}
                  onChange={(e) => setPartyForm({ ...partyForm, counsel: e.target.value })} />
                <input type="text" placeholder="Contact (optional)" value={partyForm.contact}
                  onChange={(e) => setPartyForm({ ...partyForm, contact: e.target.value })} />
                <label className="cd-party-opp-check">
                  <input type="checkbox" checked={partyForm.isOpponent}
                    onChange={(e) => setPartyForm({ ...partyForm, isOpponent: e.target.checked })} />
                  Opponent
                </label>
                <button onClick={addParty}><FiPlus /> Add</button>
              </div>
            </div>

            {/* Related cases */}
            <div className="cd-card">
              <div className="cd-card-head">
                <h4><FiLink /> Related Cases</h4>
              </div>
              {related.length === 0 && <span className="cd-muted">No linked cases.</span>}
              <div className="cd-list">
                {related.map((r) => (
                  <div className="cd-list-item" key={`${r.direction}-${r.id}`}>
                    <div className="cd-li-icon"><FiLink /></div>
                    <div className="cd-li-body">
                      <span className="cd-li-title cd-link-case" onClick={() => r.linkedCaseId && navigate(`/dashboard/cases/${r.linkedCaseId}`)}>
                        {r.caseNumber || `Case #${r.linkedCaseId}`}
                        {r.relation && <span className="cd-li-type">{r.relation}</span>}
                      </span>
                      <span className="cd-li-desc">{r.caseTitle || ""}{r.note ? ` · ${r.note}` : ""}</span>
                    </div>
                    <button className="cd-row-del" onClick={() => deleteRelated(r.id)} title="Unlink"><FiTrash2 /></button>
                  </div>
                ))}
              </div>
              <div className="cd-party-add">
                <select value={relatedForm.relatedCaseId}
                  onChange={(e) => setRelatedForm({ ...relatedForm, relatedCaseId: e.target.value })}>
                  <option value="">Select a case to link…</option>
                  {linkableCases.map((c) => (
                    <option key={c.id} value={c.id}>{c.caseNumber} — {c.caseTitle}</option>
                  ))}
                </select>
                <select value={relatedForm.relation}
                  onChange={(e) => setRelatedForm({ ...relatedForm, relation: e.target.value })}>
                  <option value="">Relation</option>
                  {RELATION_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <input type="text" placeholder="Note (optional)" value={relatedForm.note}
                  onChange={(e) => setRelatedForm({ ...relatedForm, note: e.target.value })} />
                <button onClick={addRelated}><FiPlus /> Link</button>
              </div>
            </div>
          </div>
        )}

        {/* EXPENSES — live expenses for this case */}
        {tab === "Expenses" && (
          <div className="cd-financials-tab">
            <div className="cd-financials">
              <div className="cd-fin-card">
                <span className="cd-fin-label">Total Expenses</span>
                <span className="cd-fin-value">{formatCurrency(financials?.totals?.totalExpenses || 0)}</span>
              </div>
              <div className="cd-fin-card">
                <span className="cd-fin-label">No. of Expenses</span>
                <span className="cd-fin-value">{financials?.totals?.expenseCount ?? 0}</span>
              </div>
            </div>

            <div className="cd-fin-section">
              <div className="cd-fin-section-head">
                <h4><FiDollarSign /> Expenses {financials ? `(${financials.totals.expenseCount})` : ""}</h4>
                <button className="cd-fin-add-btn" onClick={() => setShowExpenseModal(true)}><FiPlus /> Add Expense</button>
              </div>
              {!financials ? (
                <p className="cd-muted">Loading…</p>
              ) : financials.expenses.length === 0 ? (
                <p className="cd-muted">No expenses for this case yet. Add one here or from the Expenses section — it maps to this case automatically.</p>
              ) : (
                <div className="cd-list">
                  {financials.expenses.map((exp) => (
                    <div className="cd-list-item" key={exp.id}>
                      <div className="cd-li-icon"><FiDollarSign /></div>
                      <div className="cd-li-body">
                        <span className="cd-li-title">{exp.title}
                          {exp.category && <span className="cd-li-type">{exp.category}</span>}
                        </span>
                        <span className="cd-li-desc">
                          {fmtDate(exp.paymentDate)}{exp.paymentStatus ? ` · ${exp.paymentStatus}` : ""}
                        </span>
                      </div>
                      <span className="cd-li-date">{formatCurrency(exp.amount || 0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* PAYMENTS — client payments received for this case */}
        {tab === "Payments" && (
          <div className="cd-financials-tab">
            <div className="cd-financials">
              <div className="cd-fin-card">
                <span className="cd-fin-label">Total Received</span>
                <span className="cd-fin-value">{formatCurrency(financials?.totals?.totalPaymentsReceived || 0)}</span>
              </div>
              <div className="cd-fin-card">
                <span className="cd-fin-label">No. of Payments</span>
                <span className="cd-fin-value">{financials?.totals?.paymentCount ?? 0}</span>
              </div>
            </div>

            <div className="cd-fin-section">
              <div className="cd-fin-section-head">
                <h4><FiDollarSign /> Payments Received {financials ? `(${financials.totals.paymentCount})` : ""}</h4>
                <button className="cd-fin-add-btn" onClick={() => setShowPaymentModal(true)}><FiPlus /> Add Payment</button>
              </div>
              {!financials ? (
                <p className="cd-muted">Loading…</p>
              ) : financials.payments.length === 0 ? (
                <p className="cd-muted">No payments recorded for this case yet. Add one here or from the Expenses section — it maps to this case automatically.</p>
              ) : (
                <div className="cd-list">
                  {financials.payments.map((p) => (
                    <div className="cd-list-item" key={p.id}>
                      <div className="cd-li-icon"><FiDollarSign /></div>
                      <div className="cd-li-body">
                        <span className="cd-li-title">{p.paymentMode || "Payment"}
                          {p.referenceNumber && <span className="cd-li-type">Ref {p.referenceNumber}</span>}
                        </span>
                        <span className="cd-li-desc">{fmtDate(p.paymentDate)}{p.description ? ` · ${p.description}` : ""}</span>
                      </div>
                      <span className="cd-li-date cd-amount-in">{formatCurrency(p.amount || 0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* INVOICES — live invoices for this case */}
        {tab === "Invoices" && (
          <div className="cd-financials-tab">
            <div className="cd-financials">
              <div className="cd-fin-card">
                <span className="cd-fin-label">Total Invoiced</span>
                <span className="cd-fin-value">{formatCurrency(financials?.totals?.totalInvoiced || 0)}</span>
              </div>
              <div className="cd-fin-card">
                <span className="cd-fin-label">Paid</span>
                <span className="cd-fin-value">{formatCurrency(financials?.totals?.totalPaid || 0)}</span>
              </div>
              <div className="cd-fin-card">
                <span className="cd-fin-label">Unpaid</span>
                <span className="cd-fin-value">{formatCurrency(financials?.totals?.totalUnpaid || 0)}</span>
              </div>
              <div className="cd-fin-card">
                <span className="cd-fin-label">No. of Invoices</span>
                <span className="cd-fin-value">{financials?.totals?.invoiceCount ?? 0}</span>
              </div>
            </div>

            <div className="cd-fin-section">
              <div className="cd-fin-section-head">
                <h4><FiFileText /> Invoices {financials ? `(${financials.totals.invoiceCount})` : ""}</h4>
                <button className="cd-fin-add-btn" onClick={() => setShowInvoiceModal(true)}><FiPlus /> Add Invoice</button>
              </div>
              {!financials ? (
                <p className="cd-muted">Loading…</p>
              ) : financials.invoices.length === 0 ? (
                <p className="cd-muted">No invoices for this case yet. Add one here or from the Invoices section — it maps to this case automatically.</p>
              ) : (
                <div className="cd-list">
                  {financials.invoices.map((inv) => (
                    <div className="cd-list-item" key={inv.id}>
                      <div className="cd-li-icon"><FiFileText /></div>
                      <div className="cd-li-body">
                        <span className="cd-li-title">{inv.invoiceNumber}</span>
                        <span className="cd-li-desc">Issued {fmtDate(inv.invoiceDate)} · Due {fmtDate(inv.dueDate)}</span>
                      </div>
                      <span className={`cd-inv-status st-${(inv.status || "").toLowerCase()}`}>{inv.status}</span>
                      <span className="cd-li-date">{formatCurrency(inv.amount || 0)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* HEARINGS */}
        {tab === "Hearings" && (
          <div>
            <div className="cd-fin-section-head">
              <h4><FiCalendar /> Hearings & Events ({events.length})</h4>
              <button className="cd-fin-add-btn" onClick={() => setShowHearingModal(true)}><FiPlus /> Add Hearing</button>
            </div>
            <div className="cd-list">
            {events.length === 0 ? (
              <p className="cd-muted">No hearings or events for this case yet. Add one here — it also appears in the Hearings section.</p>
            ) : events.map((ev) => (
              <div className="cd-list-item" key={ev.id}>
                <div className="cd-li-icon"><FiCalendar /></div>
                <div className="cd-li-body">
                  <span className="cd-li-title">{ev.title} <span className="cd-li-type">{ev.eventType}</span></span>
                  {ev.description && <span className="cd-li-desc">{ev.description}</span>}
                </div>
                <span className="cd-li-date">{fmtDate(ev.date)}{ev.time ? ` · ${ev.time.slice(0, 5)}` : ""}</span>
                {hearingBizByDate.has(ev.date) && (
                  <button className="cd-order-dl" style={{ marginLeft: 10 }} disabled={hearingViewBusy === ev.id}
                    onClick={() => viewHearingBusiness(ev)}>
                    {hearingViewBusy === ev.id ? "…" : "👁 View"}
                  </button>
                )}
              </div>
            ))}
            </div>
          </div>
        )}

        {/* DOCUMENTS */}
        {tab === "Documents" && (
          <div className="cd-docs">
            <div className="cd-doc-upload">
              <input type="file" onChange={(e) => setUploadFile(e.target.files[0])} />
              <button onClick={uploadDoc} disabled={!uploadFile}><FiUpload /> Upload</button>
            </div>
            {docs.length === 0 ? (
              <p className="cd-muted">No documents linked to this case.</p>
            ) : docs.map((d) => (
              <div className="cd-list-item" key={d.id}>
                <div className="cd-li-icon"><FiFolder /></div>
                <div className="cd-li-body">
                  <span className="cd-li-title">{d.documentName}</span>
                  <span className="cd-li-desc">{d.category || "Other"} · {d.version > 1 ? `v${d.version}` : "v1"}</span>
                </div>
                <div className="cd-li-actions">
                  <button onClick={() => previewDoc(d.id)} title="Preview"><FiEye /></button>
                  <button onClick={() => downloadDoc(d.id, d.originalName || d.documentName)} title="Download"><FiDownload /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* NOTES */}
        {tab === "Notes" && (
          <div className="cd-notes">
            <div className="cd-note-add">
              <textarea
                placeholder="Write a case note (diary entry)..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
              <button onClick={addNote}><FiPlus /> Add Note</button>
            </div>
            {notes.length === 0 ? (
              <p className="cd-muted">No notes yet.</p>
            ) : notes.map((n) => (
              <div className="cd-note" key={n.id}>
                <div className="cd-note-body">{n.body}</div>
                <div className="cd-note-foot">
                  <span>{new Date(n.createdAt).toLocaleString("en-IN")}</span>
                  <button onClick={() => deleteNote(n.id)} title="Delete"><FiTrash2 /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* TASKS */}
        {tab === "Tasks" && (
          <div className="cd-tasks">
            <div className="cd-task-add">
              <div className="cd-task-field cd-task-field-title">
                <label>Task</label>
                <input
                  type="text" placeholder="Task title"
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                />
              </div>
              <div className="cd-task-field">
                <label>Priority</label>
                <select value={newTask.priority} onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}>
                  <option value="LOW">Low</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HIGH">High</option>
                </select>
              </div>
              <div className="cd-task-field">
                <label>Deadline</label>
                <input type="date" value={newTask.deadline} onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })} />
              </div>
              <div className="cd-task-field">
                <label>Documents</label>
                <label className="cd-task-attach" title="Attach documents">
                  <FiPaperclip />
                  <span>{taskFiles.length ? `${taskFiles.length} file(s)` : "Attach files"}</span>
                  <input type="file" multiple style={{ display: "none" }}
                    onChange={(e) => setTaskFiles(Array.from(e.target.files || []))} />
                </label>
              </div>
              <div className="cd-task-field cd-task-field-submit">
                <button onClick={addTask}><FiPlus /> Add</button>
              </div>
            </div>
            {tasks.length === 0 ? (
              <p className="cd-muted">No tasks for this case.</p>
            ) : tasks.map((t) => (
              <div className={`cd-task ${t.completed ? "done" : ""}`} key={t.id}>
                <button className="cd-task-check" onClick={() => toggleTask(t.id)} title="Toggle">
                  {t.completed ? <FiCheckCircle /> : <FiCircle />}
                </button>
                <div className="cd-task-main">
                  <span className="cd-task-title">{t.title}</span>
                  {t.documents?.length > 0 && (
                    <div className="cd-task-docs">
                      {t.documents.map((d) => (
                        <span key={d.id} className="cd-task-doc" onClick={() => previewDoc(d.id)} title={`View ${d.name}`}>
                          <FiEye size={11} /> {d.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className={`cd-task-prio prio-${(t.priority || "medium").toLowerCase()}`}>{t.priority}</span>
                {t.deadline && <span className="cd-task-deadline"><FiClock size={11} /> {fmtDate(t.deadline)}</span>}
                <button className="cd-task-del" onClick={() => deleteTask(t.id)} title="Delete"><FiTrash2 /></button>
              </div>
            ))}
          </div>
        )}

        {/* TIMELINE */}
        {tab === "Orders" && (
          <div className="cd-orders">
            {courtRecordLoading && <InlineLoader />}
            {!courtRecordLoading && (() => {
              const orders = extractOrders(courtRecord);
              if (orders.length === 0) {
                return courtRecordLoaded
                  ? <p className="cd-muted">No orders found on the court record for this case.</p>
                  : null;
              }
              return (
                <>
                  <div className="cd-orders-wrap">
                    <table className="cd-orders-table">
                      <thead><tr><th>#</th><th>Order Date</th><th>Details</th><th>Judge</th><th>Document</th></tr></thead>
                      <tbody>
                        {orders.map((o, i) => (
                          <tr key={i}>
                            <td>{o.number || i + 1}</td><td>{o.date}</td><td>{o.details}</td><td>{o.judge}</td>
                            <td>
                              {o.pdf && o.pdf.filename ? (
                                <button type="button" className="cd-order-dl" disabled={orderDlBusy === i}
                                  onClick={() => downloadOrderPdf(o, i)}>
                                  {orderDlBusy === i ? "Fetching…" : "⬇ Download PDF"}
                                </button>
                              ) : <span className="cd-order-muted">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="cd-muted cd-orders-note">PDFs are fetched live from the court and downloaded to your device; nothing is stored on our servers.</p>
                </>
              );
            })()}
          </div>
        )}

        {tab === "Court Record" && (
          <div className="cd-court-record">
            {courtRecordLoading && <InlineLoader />}
            {!courtRecordLoading && courtRecord && (
              <>
                <p className="cd-muted">The official court record captured when this case was imported. Shown as fetched — structured views will come later.</p>
                <CourtRecordView record={courtRecord} courtComplex={courtRecordComplex} />
              </>
            )}
            {!courtRecordLoading && courtRecordLoaded && !courtRecord && (
              <p className="cd-muted">No court record was imported for this case (it was added manually, or before import was available).</p>
            )}
          </div>
        )}

        {tab === "Timeline" && (
          <div className="cd-timeline-tab">
            <p className="cd-muted">View the full activity timeline for this case — payments, expenses, documents, hearings, status changes and more.</p>
            <button className="cd-open-timeline" onClick={() => setShowTimeline(true)}>
              <FiClock /> Open Full Timeline
            </button>
          </div>
        )}
      </div>

      {showTimeline && (
        <CaseTimeline
          caseId={summary.id}
          caseNumber={summary.caseNumber}
          onClose={() => setShowTimeline(false)}
        />
      )}

      {hearingBizModal && (
        <div className="cr-modal-overlay" onClick={() => setHearingBizModal(null)}>
          <div className="cr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cr-modal-head">
              <span>Daily Status</span>
              <button type="button" className="cr-modal-x" onClick={() => setHearingBizModal(null)}>×</button>
            </div>
            {hearingBizModal.court && <p className="cr-modal-court">{hearingBizModal.court}</p>}
            {hearingBizModal.parties && <p className="cr-modal-parties">{hearingBizModal.parties}</p>}
            <dl className="cr-kv">
              {Object.entries(hearingBizModal.fields || {}).map(([k, v]) => (
                <div className="cr-kv-row" key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* Add Expense modal */}
      {showExpenseModal && (
        <div className="cd-modal-overlay" onClick={() => setShowExpenseModal(false)}>
          <div className="cd-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Expense — {summary.caseNumber}</h3>
            <div className="cd-modal-form">
              <input type="text" placeholder="Title *" value={expenseForm.title}
                onChange={(e) => setExpenseForm({ ...expenseForm, title: e.target.value })} />
              <input type="number" placeholder="Amount" value={expenseForm.amount}
                onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
              <input type="text" placeholder="Category" value={expenseForm.category}
                onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })} />
              <label className="cd-modal-label">Payment Date</label>
              <input type="date" value={expenseForm.paymentDate}
                onChange={(e) => setExpenseForm({ ...expenseForm, paymentDate: e.target.value })} />
              <select value={expenseForm.paymentStatus}
                onChange={(e) => setExpenseForm({ ...expenseForm, paymentStatus: e.target.value })}>
                <option value="">Payment Status</option>
                <option value="PAID">Paid</option>
                <option value="PENDING">Pending</option>
                <option value="UNPAID">Unpaid</option>
              </select>
              <div className="cd-modal-actions">
                <button className="cd-modal-save" onClick={addExpense} disabled={savingFin}>
                  {savingFin ? "Saving..." : "Add Expense"}
                </button>
                <button className="cd-modal-cancel" onClick={() => setShowExpenseModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Invoice modal */}
      {showInvoiceModal && (
        <div className="cd-modal-overlay" onClick={() => setShowInvoiceModal(false)}>
          <div className="cd-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Invoice — {summary.caseNumber}</h3>
            {!summary.clientName && (
              <p className="cd-modal-warn">This case has no client linked. An invoice needs a client — set one on the case first.</p>
            )}
            <div className="cd-modal-form">
              <input type="text" placeholder="Invoice Number *" value={invoiceForm.invoiceNumber}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, invoiceNumber: e.target.value })} />
              <input type="number" placeholder="Amount" value={invoiceForm.amount}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, amount: e.target.value })} />
              <label className="cd-modal-label">Invoice Date</label>
              <input type="date" value={invoiceForm.invoiceDate}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, invoiceDate: e.target.value })} />
              <label className="cd-modal-label">Due Date</label>
              <input type="date" value={invoiceForm.dueDate}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })} />
              <div className="cd-modal-actions">
                <button className="cd-modal-save" onClick={addInvoice} disabled={savingFin}>
                  {savingFin ? "Saving..." : "Add Invoice"}
                </button>
                <button className="cd-modal-cancel" onClick={() => setShowInvoiceModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Payment modal */}
      {showPaymentModal && (
        <div className="cd-modal-overlay" onClick={() => setShowPaymentModal(false)}>
          <div className="cd-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Record Payment — {summary.caseNumber}</h3>
            <div className="cd-modal-form">
              <input type="number" placeholder="Amount *" value={paymentForm.amount}
                onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} />
              <input type="text" placeholder="Payment Mode (UPI/Bank/Cash)" value={paymentForm.paymentMode}
                onChange={(e) => setPaymentForm({ ...paymentForm, paymentMode: e.target.value })} />
              <input type="text" placeholder="Reference / Txn No." value={paymentForm.referenceNumber}
                onChange={(e) => setPaymentForm({ ...paymentForm, referenceNumber: e.target.value })} />
              <label className="cd-modal-label">Payment Date</label>
              <input type="date" value={paymentForm.paymentDate}
                onChange={(e) => setPaymentForm({ ...paymentForm, paymentDate: e.target.value })} />
              <input type="text" placeholder="Description" value={paymentForm.description}
                onChange={(e) => setPaymentForm({ ...paymentForm, description: e.target.value })} />
              <div className="cd-modal-actions">
                <button className="cd-modal-save" onClick={addPayment} disabled={savingFin}>
                  {savingFin ? "Saving..." : "Record Payment"}
                </button>
                <button className="cd-modal-cancel" onClick={() => setShowPaymentModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Hearing modal */}
      {showHearingModal && (
        <div className="cd-modal-overlay" onClick={() => setShowHearingModal(false)}>
          <div className="cd-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add Hearing — {summary.caseNumber}</h3>
            <div className="cd-modal-form">
              <input type="text" placeholder="Title *" value={hearingForm.title}
                onChange={(e) => setHearingForm({ ...hearingForm, title: e.target.value })} />
              <select value={hearingForm.eventType}
                onChange={(e) => setHearingForm({ ...hearingForm, eventType: e.target.value })}>
                {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <label className="cd-modal-label">Date *</label>
              <input type="date" value={hearingForm.date}
                onChange={(e) => setHearingForm({ ...hearingForm, date: e.target.value })} />
              <label className="cd-modal-label">Time</label>
              <input type="time" value={hearingForm.time}
                onChange={(e) => setHearingForm({ ...hearingForm, time: e.target.value })} />
              <div className="cd-modal-actions">
                <button className="cd-modal-save" onClick={addHearing} disabled={savingFin}>
                  {savingFin ? "Saving..." : "Add Hearing"}
                </button>
                <button className="cd-modal-cancel" onClick={() => setShowHearingModal(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
