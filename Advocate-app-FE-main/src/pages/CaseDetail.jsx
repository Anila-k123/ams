import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import AsyncSelect from "react-select/async";
import {
  FiArrowLeft, FiCalendar, FiFolder, FiEye, FiDownload, FiUpload, FiTrash2,
  FiPlus, FiClock, FiTag, FiCheckCircle, FiCircle, FiFileText, FiDollarSign,
  FiUsers, FiLink, FiPaperclip, FiBook, FiEdit2, FiSave, FiX
} from "react-icons/fi";
import CaseTimeline from "../components/CaseTimeline.jsx";
import CaseExtraDetails from "../components/CaseExtraDetails.jsx";
import { fetchCourtDocument, downloadHcOrderPdf, fetchHcBusiness } from "../services/courtDocuments";
import { useToast } from "../contexts/ToastContext.jsx";
import { usePermission } from "../contexts/PermissionContext.jsx";
import { useLoading } from "../contexts/LoadingContext.jsx";
import { formatCurrency } from "../utils/formatCurrency";
import { InlineLoader } from "../components/Loader";
import "../assets/styles/CaseDetail.css";

const TABS = ["Parties", "Related Cases", "Acts", "Expenses", "Payments", "Invoices", "Hearings", "Documents", "Notes", "Tasks", "Orders", "Extra Details", "Timeline"];
const STATUS_SELECT = [
  { value: "", label: "—" },
  { value: "Active", label: "Active" },
  { value: "Pending", label: "Pending" },
  { value: "Closed", label: "Closed" },
];
// Predefined tag choices — tags are picked from this list, not typed freehand.
const TAG_OPTIONS = [
  "High Priority", "Urgent", "Follow Up", "On Hold", "Important",
  "Awaiting Documents", "For Argument", "Reserved", "For Orders", "Appeal",
];

// One field's pencil-edit affordance: shows the value + a pencil; clicking turns
// it into an input/select with save/cancel. `onSave(newValue)` should throw to
// keep the field open on failure. `hideValue` shows only the pencil (e.g. next
// to a badge that already renders the value).
function InlineEdit({ value, display, type = "text", options, onSave, onStart, hideValue }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const [saving, setSaving] = useState(false);
  const start = () => { setVal(value == null ? "" : String(value)); if (onStart) onStart(); setEditing(true); };
  const commit = async () => {
    setSaving(true);
    try { await onSave(val); setEditing(false); } catch { /* stay open */ } finally { setSaving(false); }
  };
  if (!editing) {
    return (
      <span className="cd-inline">
        {!hideValue && <span className="cd-inline-val">{display ?? (value || "—")}</span>}
        <button className="cd-pencil" onClick={start} title="Edit"><FiEdit2 /></button>
      </span>
    );
  }
  return (
    <span className="cd-inline editing">
      {type === "select" ? (
        <select autoFocus value={val} onChange={(e) => setVal(e.target.value)}>
          {(options || []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input autoFocus type={type} value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} />
      )}
      <button className="cd-pencil ok" onClick={commit} disabled={saving} title="Save"><FiSave /></button>
      <button className="cd-pencil no" onClick={() => setEditing(false)} title="Cancel"><FiX /></button>
    </span>
  );
}

// react-select dark theme, matching ActDetail's picker.
const customSelectStyles = {
  control: (base, state) => ({
    ...base,
    backgroundColor: "var(--bg-primary)",
    borderColor: state.isFocused ? "var(--accent)" : "var(--border-color)",
    color: "var(--text-primary)",
    borderRadius: "8px",
    boxShadow: "none",
  }),
  menu: (base) => ({
    ...base,
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    zIndex: 9999,
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected ? "var(--accent)" : state.isFocused ? "var(--border-color)" : "transparent",
    color: state.isSelected ? "#fff" : "var(--text-primary)",
    cursor: "pointer",
  }),
  singleValue: (base) => ({ ...base, color: "var(--text-primary)" }),
  placeholder: (base) => ({ ...base, color: "var(--text-muted)" }),
  input: (base) => ({ ...base, color: "var(--text-primary)" }),
};

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
      out.push({ number: o.order_number || "", date: o.order_date || "", details: o.order_details || "", judge: o.judge || "",
                 pdf: o.pdf || null, pdfUrl: o.pdf_url || "", viewToken: c.view_token })));
    return out;
  }
  return (record.orders || []).map((o) => ({
    number: o.sl_no || "", date: o.order_date || "", details: o.case_details || "", judge: o.judge || "",
    pdf: null, pdfUrl: o.pdf_url || "",
  }));
}

// The court's full hearing/listing history (Provakil's "Listings"). HC stores it
// under detail.hearings, DC under detail.history (whose rows carry a `business`
// token that fetches that day's Daily Status). eCourts shapes only.
function extractHearingHistory(record) {
  if (!record?.cases) return [];
  const out = [];
  record.cases.forEach((c) => {
    const d = c.detail || {};
    (d.hearings || []).forEach((h) => out.push({
      causeList: h.cause_list_type || "", judge: h.judge || "",
      businessDate: h.business_on_date || "", hearingDate: h.hearing_date || "",
      // business_detail is the Daily Status pre-fetched & stored at import — shown
      // instantly, no re-scrape. `business` is the token for the live fallback.
      purpose: h.purpose || "", business: h.business || null,
      businessDetail: h.business_detail || null, viewToken: c.view_token,
    }));
    (d.history || []).forEach((h) => out.push({
      causeList: "", judge: h.judge || "",
      businessDate: h.business_date || "", hearingDate: h.hearing_date || "",
      purpose: h.purpose || "", business: h.business || null,
      businessDetail: h.business_detail || null, viewToken: c.view_token,
    }));
  });
  return out;
}

// Curated identity fields for the header strip, in display order. Each entry
// matches a source key by case-insensitive substring, so slightly different
// labels across courts (eCourts / SCI / Madras) still resolve. Unknown keys are
// left for the Extra Details tab.
const _IDENTITY_FIELDS = [
  { label: "Diary No", match: "diary" },
  { label: "CNR", match: "cnr" },
  { label: "Case Type", match: "case type" },
  { label: "Filing No", match: "filing number" },
  { label: "Filing Date", match: "filing date" },
  { label: "Registration No", match: "registration number" },
  { label: "Registration Date", match: "registration date" },
  { label: "Stage", match: "stage" },
  { label: "Status", match: "case status" },
  { label: "State", match: "state" },
  { label: "District", match: "district" },
  { label: "Bench", match: "bench type" },
  { label: "Coram", match: "coram" },
  { label: "First Hearing", match: "first hearing" },
  { label: "Decision Date", match: "decision date" },
  { label: "Nature of Disposal", match: "nature of disposal" },
  // Court registry classification. Exact-keyed so the three overlapping labels
  // ("category" ⊂ "sub category" ⊂ "sub sub category") each bind to their own key.
  { label: "Category", match: "category", exact: true },
  { label: "Sub Category", match: "sub category", exact: true },
  { label: "Sub Sub Category", match: "sub sub category", exact: true },
];

// Pull the header's structured identity fields out of a stored court record.
// Returns an ordered [{label, value}] of whichever curated fields are present.
// Same court-shape detection CourtRecordView uses.
function extractCaseIdentity(record, courtId) {
  if (!record) return [];
  // Flatten the source into one { key: value } bag per court shape.
  let bag = {};
  if (courtId === "sci" || record.diaryNo !== undefined) {
    bag = { ...(record.fields || {}) };
    if (record.diaryNo) bag["Diary Number"] = record.diaryNo;
  } else if (record.cases !== undefined) {
    const d = (record.cases[0] || {}).detail || {};
    bag = { ...(d.case_details || {}), ...(d.case_status || {}), ...(d.category || {}) };
  } else {
    bag = { ...(record.fields || {}) };
  }
  const entries = Object.entries(bag);
  const out = [];
  const usedKeys = new Set();
  for (const field of _IDENTITY_FIELDS) {
    const hit = entries.find(([k]) => {
      if (usedKeys.has(k)) return false;
      const kl = String(k).toLowerCase().trim();
      // `exact` avoids substring collisions (e.g. "category" ⊂ "sub category").
      return field.exact ? kl === field.match : kl.includes(field.match);
    });
    if (hit && hit[1] != null && String(hit[1]).trim() !== "") {
      usedKeys.add(hit[0]);
      out.push({ label: field.label, value: String(hit[1]).trim() });
    }
  }
  return out;
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
  const { hasPermission } = usePermission();
  const { withLoading } = useLoading();

  const token = localStorage.getItem("token");
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  const [tab, setTab] = useState("Parties");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showTimeline, setShowTimeline] = useState(false);

  // Inline edit of the case's own (app-owned) fields. Clients power the client picker.
  const [clients, setClients] = useState([]);
  // Header Actions menu + transfer modal.
  const [showActions, setShowActions] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [advocates, setAdvocates] = useState([]);
  const [transferTo, setTransferTo] = useState("");
  const [transferring, setTransferring] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Tab data
  const [events, setEvents] = useState([]);
  const [docs, setDocs] = useState([]);
  const [notes, setNotes] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [financials, setFinancials] = useState(null);
  const [parties, setParties] = useState([]);
  const [related, setRelated] = useState([]);
  const [linkedActs, setLinkedActs] = useState([]);
  const [selectedAct, setSelectedAct] = useState(null);
  const [linkingAct, setLinkingAct] = useState(false);
  const [citedActs, setCitedActs] = useState([]);
  const [linkableCases, setLinkableCases] = useState([]);

  // Court record (imported from the court API)
  const [courtRecord, setCourtRecord] = useState(null);
  const [courtRecordComplex, setCourtRecordComplex] = useState("");
  const [courtRecordCourtId, setCourtRecordCourtId] = useState("");
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

  // High Court orders carry an absolute pdf_url instead of a DC-style pdf token;
  // stream it through the same AMS proxy (mirrors CourtRecordView).
  const downloadOrderPdfByUrl = async (order, i) => {
    setOrderDlBusy(i);
    try {
      await downloadHcOrderPdf(order.pdfUrl, `Order ${order.number || ""} ${order.date || ""}`.trim());
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

  // Show a court-history row's Daily Status. Prefer the copy stored at import
  // (business_detail) — instant, no scrape. Only if it's missing (older records
  // / DC) do we fetch live: HC and DC use different portals/endpoints.
  const viewHistoryBusiness = async (row, i) => {
    if (row.businessDetail && Object.keys(row.businessDetail.fields || {}).length) {
      setHearingBizModal(row.businessDetail);
      return;
    }
    if (!row.business) return;
    setHearingViewBusy(`h${i}`);
    try {
      const biz = courtRecordCourtId === "ecourts_hc"
        ? await fetchHcBusiness(row.business)
        : await fetchCourtDocument({
            courtComplex: courtRecordComplex, viewToken: row.viewToken,
            kind: "hearing_business", token: row.business, label: `Business ${row.businessDate || ""}`,
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
  // Upload Order modal
  const [showUploadOrder, setShowUploadOrder] = useState(false);
  const [uploadingOrder, setUploadingOrder] = useState(false);
  const [orderForm, setOrderForm] = useState({ documentName: "", orderDate: "", description: "", file: null });

  // Add expense / invoice / payment / hearing modals
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showHearingModal, setShowHearingModal] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ title: "", amount: "", category: "", paymentDate: "", paymentStatus: "" });
  const [invoiceForm, setInvoiceForm] = useState({ invoiceNumber: "", amount: "", invoiceDate: "", dueDate: "" });
  const [paymentForm, setPaymentForm] = useState({ amount: "", paymentMode: "", referenceNumber: "", paymentDate: "", description: "" });
  const [hearingForm, setHearingForm] = useState({ title: "", eventType: "HEARING", date: "", time: "" });
  const [editingEventId, setEditingEventId] = useState(null);
  const [alertBusy, setAlertBusy] = useState(null);
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

  // ---------- Inline edit (app-owned case fields) ----------
  // Partial update — UpdateCaseView only writes the keys present, so each
  // per-field pencil can PUT just its own field. Throws so the field stays open on error.
  const patchCase = async (payload) => {
    try {
      await axios.put(`/api/cases/update/${id}`, payload, authHeaders);
      await fetchSummary();
      success("Case updated.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to update case.");
      throw err;
    }
  };

  // ---------- Header actions: archive / transfer ----------
  const archiveCase = async () => {
    setShowActions(false);
    if (!window.confirm("Archive this case? It will be hidden from the workspace (you can restore it from the Cases list).")) return;
    try {
      await axios.delete(`/api/cases/delete/${id}`, authHeaders);
      success("Case archived.");
      navigate("/dashboard/cases");
    } catch (err) {
      error(err.response?.data?.error || "Failed to archive case.");
    }
  };

  const openTransfer = async () => {
    setShowActions(false);
    setShowTransfer(true);
    if (advocates.length === 0) {
      try {
        const res = await axios.get("/api/admin/users", authHeaders);
        setAdvocates((res.data || []).filter((a) => a.active !== false));
      } catch {
        error("Couldn't load advocates (admin permission required).");
      }
    }
  };

  const doTransfer = async () => {
    if (!transferTo) { error("Select an advocate to transfer to."); return; }
    setTransferring(true);
    try {
      await axios.put(`/api/cases/transfer/${id}`, { advocateId: Number(transferTo) }, authHeaders);
      success("Case transferred.");
      setShowTransfer(false);
      navigate("/dashboard/cases");   // it may no longer be in this advocate's list
    } catch (err) {
      error(err.response?.data?.error || "Failed to transfer case.");
    } finally {
      setTransferring(false);
    }
  };

  // Re-scrape the court record and refresh the stored copy (new hearings/orders/
  // disposal, or a wrong scrape). Can take a while — it re-fetches full detail.
  const refreshCourtData = async () => {
    setShowActions(false);
    setRefreshing(true);
    try {
      const res = await axios.post(`/api/courtsearch/cases/${id}/refresh`, {}, { ...authHeaders, timeout: 240000 });
      if (res.data?.raw) {
        setCourtRecord(res.data.raw);
        setCourtRecordLoaded(true);
      }
      success("Court record refreshed.");
    } catch (err) {
      error(err.response?.data?.error || "Couldn’t refresh the court record.");
    } finally {
      setRefreshing(false);
    }
  };

  // Loaded lazily the first time the client field is edited.
  const fetchClients = useCallback(async () => {
    if (clients.length) return;
    try {
      const res = await axios.get("/api/clients/my-clients", authHeaders);
      setClients(res.data || []);
    } catch { /* picker falls back to the current client only */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients.length, token]);

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
    const payload = {
      title: hearingForm.title.trim(),
      eventType: hearingForm.eventType,
      date: hearingForm.date,
      time: hearingForm.time || null,
    };
    try {
      if (editingEventId) {
        await withLoading(axios.put(`/api/events/update/${editingEventId}`, payload, authHeaders), "Saving hearing...");
      } else {
        await withLoading(axios.post("/api/events/create", { ...payload, caseEntity: { id: Number(id) } }, authHeaders), "Adding hearing...");
      }
      setShowHearingModal(false);
      setEditingEventId(null);
      setHearingForm({ title: "", eventType: "HEARING", date: "", time: "" });
      fetchEvents();
      fetchSummary();
      success(editingEventId ? "Hearing updated." : "Hearing added to this case.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to save hearing.");
    } finally {
      setSavingFin(false);
    }
  };

  const editHearing = (ev) => {
    setEditingEventId(ev.id);
    setHearingForm({
      title: ev.title || "",
      eventType: ev.eventType || "HEARING",
      date: ev.date || "",
      time: ev.time ? ev.time.slice(0, 5) : "",
    });
    setShowHearingModal(true);
  };

  const deleteHearingEvent = async (evId) => {
    if (!window.confirm("Delete this hearing/reminder?")) return;
    try {
      await axios.delete(`/api/events/delete/${evId}`, authHeaders);
      fetchEvents();
      fetchSummary();
      success("Hearing removed.");
    } catch { error("Failed to delete hearing."); }
  };

  // ---------- Listing row actions (Court Hearing History) ----------
  const copyHearing = async (row) => {
    const parts = [
      summary.caseNumber || summary.caseTitle || "",
      row.hearingDate ? `Hearing: ${row.hearingDate}` : (row.businessDate ? `Business: ${row.businessDate}` : ""),
      row.purpose ? `Purpose: ${row.purpose}` : "",
      row.judge ? `Before: ${row.judge}` : "",
      row.causeList ? `List: ${row.causeList}` : "",
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(parts.join("\n"));
      success("Listing copied to clipboard.");
    } catch { error("Couldn't copy to clipboard."); }
  };

  const alertClient = async (row, i) => {
    setAlertBusy(`a${i}`);
    try {
      const res = await axios.post(`/api/cases/${id}/hearing-alert`, {
        date: row.hearingDate || row.businessDate || "",
        purpose: row.purpose || "",
        bench: row.judge || "",
      }, authHeaders);
      if (res.data?.success) success(`Alert sent to client (${res.data.recipient}).`);
      else error(res.data?.errorMessage || "Alert could not be sent.");
    } catch (err) {
      error(err.response?.data?.error || err.response?.data?.errorMessage || "Failed to send alert.");
    } finally {
      setAlertBusy(null);
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

  // ---------- Acts ----------
  const fetchLinkedActs = useCallback(async () => {
    try {
      const res = await axios.get(`/api/cases/${id}/acts`, authHeaders);
      setLinkedActs(res.data || []);
    } catch { setLinkedActs([]); }
  }, [id, token]);

  // Acts the court cited on the imported record, matched to our library server-side.
  const fetchCitedActs = useCallback(async () => {
    try {
      const res = await axios.get(`/api/cases/${id}/cited-acts`, authHeaders);
      setCitedActs(res.data || []);
    } catch { setCitedActs([]); }
  }, [id, token]);

  // Server-side search for the picker — 1250+ acts, so query as the user types
  // instead of loading them all (reuses the Acts page's /api/acts search).
  const loadActOptions = useCallback(async (input) => {
    try {
      const res = await axios.get(`/api/acts`, { ...authHeaders, params: { q: input, field: "all" } });
      const rows = res.data?.content || [];
      const linkedIds = new Set(linkedActs.map((a) => a.actId));
      return rows
        .filter((a) => !linkedIds.has(a.id))   // hide already-linked acts
        .map((a) => ({
          value: a.id,
          label: `${a.title}${a.actYear ? ` (${a.actYear})` : ""}${a.jurisdiction ? ` · ${a.jurisdiction}` : ""}`,
        }));
    } catch { return []; }
  }, [token, linkedActs]);

  const addAct = async () => {
    if (!selectedAct) { error("Select an act to link."); return; }
    setLinkingAct(true);
    try {
      await axios.post(`/api/cases/${id}/acts`, { actId: selectedAct.value }, authHeaders);
      setSelectedAct(null);
      fetchLinkedActs();
      success("Act linked.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to link act.");
    } finally {
      setLinkingAct(false);
    }
  };

  const deleteAct = async (actId) => {
    try {
      await axios.delete(`/api/cases/${id}/acts/${actId}`, authHeaders);
      fetchLinkedActs();
    } catch { error("Failed to unlink act."); }
  };

  // One-click add a court-cited act (that we matched to the library) into the
  // case's Linked Acts, reusing the same link endpoint.
  const linkCitedAct = async (actId) => {
    try {
      await axios.post(`/api/cases/${id}/acts`, { actId }, authHeaders);
      fetchLinkedActs();
      success("Act linked.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to link act.");
    }
  };

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const fetchCourtRecord = useCallback(async () => {
    setCourtRecordLoading(true);
    try {
      const res = await axios.get(`/api/courtsearch/imported-records?caseId=${id}`, authHeaders);
      setCourtRecord(res.data?.raw || null);
      setCourtRecordComplex(res.data?.query?.court_complex || "");
      setCourtRecordCourtId(res.data?.courtId || "");
    } catch {
      setCourtRecord(null); // 404 = no imported record for this case
    } finally {
      setCourtRecordLoading(false);
      setCourtRecordLoaded(true);
    }
  }, [id]);

  // Load the court record up front — it feeds the header's structured identity
  // strip, so it can't wait for a tab to open. Defined here (after
  // fetchCourtRecord) to avoid a temporal-dead-zone reference.
  useEffect(() => { fetchCourtRecord(); }, [fetchCourtRecord]);

  // Lazily load tab data on demand
  useEffect(() => {
    if (tab === "Parties") fetchParties();
    if (tab === "Related Cases") { fetchRelated(); fetchLinkableCases(); }
    if (tab === "Acts") { fetchLinkedActs(); fetchCitedActs(); }
    if (tab === "Expenses" || tab === "Invoices" || tab === "Payments") fetchFinancials();
    if (tab === "Hearings") fetchEvents();
    if (tab === "Documents" || tab === "Orders") fetchDocs();
    if (tab === "Notes") fetchNotes();
    if (tab === "Tasks") fetchTasks();
    if ((tab === "Extra Details" || tab === "Orders" || tab === "Hearings") && !courtRecordLoaded) fetchCourtRecord();
  }, [tab, fetchFinancials, fetchEvents, fetchDocs, fetchNotes, fetchTasks, fetchParties, fetchRelated, fetchLinkableCases, fetchLinkedActs, fetchCitedActs, fetchCourtRecord, courtRecordLoaded]);

  // ---------- Tags ----------
  const addTag = async (explicit) => {
    const label = (explicit ?? newTag).trim();
    if (!label) return;
    try {
      await axios.post(`/api/workspace/cases/${id}/tags`, { label }, authHeaders);
      setNewTag("");
      fetchSummary();
    } catch { error("Failed to add tag."); }
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

  // Upload an order document — stored as a normal case document tagged category "Order".
  const uploadOrder = async () => {
    if (!orderForm.file) { error("Choose a file to upload."); return; }
    setUploadingOrder(true);
    const fd = new FormData();
    fd.append("file", orderForm.file);
    fd.append("caseId", id);
    fd.append("category", "Order");
    if (orderForm.documentName.trim()) fd.append("documentName", orderForm.documentName.trim());
    const desc = [orderForm.orderDate ? `Order dated ${orderForm.orderDate}` : "", orderForm.description.trim()].filter(Boolean).join(" — ");
    if (desc) fd.append("description", desc);
    try {
      await axios.post("/api/documents/upload", fd, authHeaders);
      setShowUploadOrder(false);
      setOrderForm({ documentName: "", orderDate: "", description: "", file: null });
      fetchDocs();
      success("Order uploaded.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to upload order.");
    } finally {
      setUploadingOrder(false);
    }
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

  const caseIdentity = extractCaseIdentity(courtRecord, courtRecordCourtId);
  const hearingHistory = extractHearingHistory(courtRecord);
  // The top list is the advocate's calendar: upcoming hearings + any non-hearing
  // events (meetings, reminders). Past HEARING events are the court hearings that
  // import copied in — those live, in full, under Court Hearing History below, so
  // we hide them here to avoid the duplicate. Nothing is deleted.
  const _todayISO = new Date().toISOString().slice(0, 10);
  const myHearings = (events || []).filter(
    (ev) => (ev.date && ev.date >= _todayISO) || ev.eventType !== "HEARING");

  return (
    <div className="case-detail">
      <button className="cd-back" onClick={() => navigate("/dashboard/cases")}>
        <FiArrowLeft /> Back to Workspace
      </button>

      {/* Header */}
      <div className="cd-header">
        <div className="cd-header-main">
          <div className="cd-title-row">
            <h2>
              <InlineEdit value={summary.caseTitle} display={summary.caseTitle || summary.caseNumber}
                onSave={(v) => patchCase({ caseTitle: v })} />
            </h2>
            <span className={`status ${(summary.status || "").toLowerCase()}`}>{summary.status || "—"}</span>
            <InlineEdit value={summary.status} type="select" options={STATUS_SELECT} hideValue
              onSave={(v) => patchCase({ status: v })} />
          </div>
          <div className="cd-meta">
            <span><strong>Case No:</strong> {summary.caseNumber}</span>
            <span><strong>Type:</strong>{" "}
              <InlineEdit value={summary.caseType} display={summary.caseType || "—"}
                onSave={(v) => patchCase({ caseType: v })} />
            </span>
            <span><strong>Court:</strong>{" "}
              <InlineEdit value={summary.courtLevel} display={summary.courtLevel || "—"}
                onSave={(v) => patchCase({ courtLevel: v })} />
            </span>
            <span><strong>Client:</strong>{" "}
              <InlineEdit value={summary.clientId ?? ""} display={summary.clientName || "—"}
                type="select" onStart={fetchClients}
                options={[{ value: "", label: "— None —" },
                  ...(summary.clientId && !clients.some((c) => c.id === summary.clientId)
                    ? [{ value: String(summary.clientId), label: summary.clientName || `Client #${summary.clientId}` }] : []),
                  ...clients.map((c) => ({ value: String(c.id), label: c.name }))]}
                onSave={(v) => patchCase({ clientId: v === "" ? null : Number(v) })} />
            </span>
            <span><strong>Amount:</strong>{" "}
              <InlineEdit value={summary.amount ?? ""} display={formatCurrency(summary.amount || 0)} type="number"
                onSave={(v) => patchCase({ amount: v === "" ? null : Number(v) })} />
            </span>
          </div>

          {caseIdentity.length > 0 && (
            <div className="cd-court-strip">
              {caseIdentity.map((it) => (
                <div className="cd-cs-item" key={it.label}>
                  <span className="cd-cs-k">{it.label}</span>
                  <span className="cd-cs-v">{it.value}</span>
                </div>
              ))}
            </div>
          )}

          <div className="cd-header-tags">
            <FiTag className="cd-ht-icon" />
            {(summary.tags || []).map((t) => (
              <span key={t.id} className="cd-tag-chip">
                {t.label}
                <button onClick={() => removeTag(t.id)} title="Remove">×</button>
              </span>
            ))}
            <select className="cd-tag-select" value="" onChange={(e) => { if (e.target.value) addTag(e.target.value); }}>
              <option value="">+ tag</option>
              {TAG_OPTIONS.filter((t) => !(summary.tags || []).some((x) => x.label === t))
                .map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="cd-header-side">
          <div className="cd-header-actions">
            <button className="cd-raise-invoice" onClick={() => setShowInvoiceModal(true)}>
              <FiDollarSign /> Raise Invoice
            </button>
            {(courtRecord || hasPermission("CASE_DELETE") || hasPermission("USER_MANAGE")) && (
              <div className="cd-actions-wrap">
                <button className="cd-actions-btn" onClick={() => setShowActions((s) => !s)} disabled={refreshing}>
                  {refreshing ? "Refreshing…" : "Actions ▾"}
                </button>
                {showActions && (
                  <>
                    <div className="cd-actions-backdrop" onClick={() => setShowActions(false)} />
                    <div className="cd-actions-menu">
                      {courtRecord && (
                        <button onClick={refreshCourtData}><FiClock /> Refresh court data</button>
                      )}
                      {hasPermission("USER_MANAGE") && (
                        <button onClick={openTransfer}><FiUsers /> Transfer case…</button>
                      )}
                      {hasPermission("CASE_DELETE") && (
                        <button className="danger" onClick={archiveCase}><FiTrash2 /> Archive case</button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
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
        {/* PARTIES */}
        {tab === "Parties" && (
          <div className="cd-overview">
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
          </div>
        )}

        {/* RELATED CASES */}
        {tab === "Related Cases" && (
          <div className="cd-overview">
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

        {/* ACTS — statutes linked to this case (for validation / reference) */}
        {tab === "Acts" && (
          <div className="cd-overview">
            <div className="cd-card">
              <div className="cd-card-head">
                <h4><FiBook /> Linked Acts</h4>
              </div>
              {linkedActs.length === 0 && <span className="cd-muted">No acts linked to this case yet.</span>}
              <div className="cd-list">
                {linkedActs.map((a) => (
                  <div className="cd-list-item" key={a.id}>
                    <div className="cd-li-icon"><FiBook /></div>
                    <div className="cd-li-body">
                      <span className="cd-li-title cd-link-case" onClick={() => navigate(`/dashboard/acts/${a.actId}`)}>
                        {a.actTitle || `Act #${a.actId}`}
                        {a.actNumber && <span className="cd-li-type">No. {a.actNumber}</span>}
                      </span>
                      <span className="cd-li-desc">
                        {[a.actYear, a.jurisdiction].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                    <button className="cd-row-del" onClick={() => deleteAct(a.actId)} title="Unlink act"><FiTrash2 /></button>
                  </div>
                ))}
              </div>
              <div className="cd-party-add">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <AsyncSelect
                    cacheOptions
                    defaultOptions
                    loadOptions={loadActOptions}
                    value={selectedAct}
                    onChange={setSelectedAct}
                    placeholder="Search acts to link…"
                    noOptionsMessage={() => "Type to search acts"}
                    styles={customSelectStyles}
                    isClearable
                  />
                </div>
                <button onClick={addAct} disabled={!selectedAct || linkingAct}>
                  <FiPlus /> {linkingAct ? "Linking…" : "Link"}
                </button>
              </div>
            </div>

            {/* Acts cited by the court on the imported record. Matched ones link
                to our library and can be added to Linked Acts in one click. */}
            {citedActs.length > 0 && (
              <div className="cd-card">
                <div className="cd-card-head">
                  <h4><FiBook /> Cited by the court</h4>
                </div>
                <div className="cd-list">
                  {citedActs.map((a, i) => {
                    const alreadyLinked = a.actId && linkedActs.some((l) => l.actId === a.actId);
                    return (
                      <div className="cd-list-item" key={i}>
                        <div className="cd-li-icon"><FiBook /></div>
                        <div className="cd-li-body">
                          {a.actId ? (
                            <span className="cd-li-title cd-link-case" onClick={() => navigate(`/dashboard/acts/${a.actId}`)}>
                              {a.actTitle}
                            </span>
                          ) : (
                            <span className="cd-li-title">
                              {a.name} <span className="cd-li-type">not in library</span>
                            </span>
                          )}
                          <span className="cd-li-desc">
                            {a.section ? `Section ${a.section}` : ""}
                            {a.actId && a.name !== a.actTitle ? `${a.section ? " · " : ""}cited as “${a.name}”` : ""}
                          </span>
                        </div>
                        {a.actId && (
                          alreadyLinked
                            ? <span className="cd-li-type" title="Already in Linked Acts">✓ Linked</span>
                            : <button className="cd-order-dl" onClick={() => linkCitedAct(a.actId)} title="Add to Linked Acts"><FiPlus /> Link</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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
              <h4><FiCalendar /> Upcoming & My Hearings ({myHearings.length})</h4>
              <button className="cd-fin-add-btn" onClick={() => { setEditingEventId(null); setHearingForm({ title: "", eventType: "HEARING", date: "", time: "" }); setShowHearingModal(true); }}><FiPlus /> Add Hearing</button>
            </div>
            <div className="cd-list">
            {myHearings.length === 0 ? (
              <p className="cd-muted">No upcoming hearings or reminders. Add one here — past court hearings appear under Court Hearing History below.</p>
            ) : myHearings.map((ev) => (
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
                    {hearingViewBusy === ev.id ? "…" : "View"}
                  </button>
                )}
                <button className="cd-row-icon" title="Edit hearing" onClick={() => editHearing(ev)}>Edit</button>
                <button className="cd-row-del-labeled" title="Delete hearing" onClick={() => deleteHearingEvent(ev.id)}>Delete</button>
              </div>
            ))}
            </div>

            {/* Court hearing/listing history from the imported record (Provakil "Listings"). */}
            {hearingHistory.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div className="cd-fin-section-head">
                  <h4><FiCalendar /> Court Hearing History ({hearingHistory.length})</h4>
                </div>
                <div className="cd-orders-wrap">
                  <table className="cd-orders-table">
                    <thead><tr><th>Cause List</th><th>Judge / Bench</th><th>Business Date</th><th>Hearing Date</th><th>Purpose</th><th>Daily Status</th><th>Actions</th></tr></thead>
                    <tbody>
                      {hearingHistory.map((h, i) => (
                        <tr key={i}>
                          <td>{h.causeList || "—"}</td>
                          <td>{h.judge || "—"}</td>
                          <td>{h.businessDate || "—"}</td>
                          <td>{h.hearingDate || "—"}</td>
                          <td>{h.purpose || "—"}</td>
                          <td>
                            {(h.businessDetail && Object.keys(h.businessDetail.fields || {}).length) || (h.business && h.businessDate) ? (
                              <button type="button" className="cd-order-dl" disabled={hearingViewBusy === `h${i}`}
                                onClick={() => viewHistoryBusiness(h, i)}>
                                {hearingViewBusy === `h${i}` ? "…" : "View"}
                              </button>
                            ) : <span className="cd-order-muted">—</span>}
                          </td>
                          <td>
                            <div className="cd-listing-actions">
                              <button type="button" onClick={() => copyHearing(h)}>Copy</button>
                              <button type="button" title={summary.clientId ? "Email this hearing to the client" : "No client email on this case"}
                                disabled={!summary.clientId || alertBusy === `a${i}`} onClick={() => alertClient(h, i)}>
                                {alertBusy === `a${i}` ? "Sending…" : "Send Alert to Client"}
                              </button>
                              <button type="button" onClick={() => setShowInvoiceModal(true)}>Raise Invoice</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
            <div className="cd-fin-section-head">
              <h4><FiFileText /> Orders</h4>
              <button className="cd-fin-add-btn" onClick={() => setShowUploadOrder(true)}><FiUpload /> Upload Order</button>
            </div>

            {/* Court-record orders (scraped, downloaded live) */}
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
                                  {orderDlBusy === i ? "Fetching…" : "Download PDF"}
                                </button>
                              ) : o.pdfUrl ? (
                                <button type="button" className="cd-order-dl" disabled={orderDlBusy === i}
                                  onClick={() => downloadOrderPdfByUrl(o, i)}>
                                  {orderDlBusy === i ? "Fetching…" : "Download PDF"}
                                </button>
                              ) : <span className="cd-order-muted">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="cd-muted cd-orders-note">Court PDFs are fetched live from the court and downloaded to your device.</p>
                </>
              );
            })()}

            {/* Orders you've uploaded (stored documents tagged as "Order") */}
            {(() => {
              const uploaded = (docs || []).filter((d) => (d.category || "").toLowerCase() === "order");
              if (!uploaded.length) return null;
              return (
                <div style={{ marginTop: 22 }}>
                  <div className="cd-fin-section-head"><h4><FiFileText /> Uploaded Orders ({uploaded.length})</h4></div>
                  <div className="cd-list">
                    {uploaded.map((d) => (
                      <div className="cd-list-item" key={d.id}>
                        <div className="cd-li-icon"><FiFileText /></div>
                        <div className="cd-li-body">
                          <span className="cd-li-title">{d.documentName}</span>
                          <span className="cd-li-desc">{d.description || "Order"}{d.uploadDate ? ` · ${fmtDate(d.uploadDate)}` : ""}</span>
                        </div>
                        <button className="cd-order-dl" onClick={() => previewDoc(d.id)}>Preview</button>
                        <button className="cd-order-dl" style={{ marginLeft: 6 }} onClick={() => downloadDoc(d.id, d.documentName)}>Download</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {tab === "Extra Details" && (
          <div className="cd-court-record">
            {courtRecordLoading && <InlineLoader />}
            {!courtRecordLoading && courtRecord && (
              <>
                <p className="cd-muted">Additional details from the imported court record. The key fields (CNR, filing, status, jurisdiction, category, dates) are in the header; parties, hearings and orders — and the acts cited by the court — have their own tabs. This holds any other fields the court captured.</p>
                <CaseExtraDetails record={courtRecord} courtId={courtRecordCourtId} />
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

      {showTransfer && (
        <div className="cr-modal-overlay" onClick={() => setShowTransfer(false)}>
          <div className="cr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cr-modal-head">
              <span>Transfer case</span>
              <button type="button" className="cr-modal-x" onClick={() => setShowTransfer(false)}>×</button>
            </div>
            <p className="cd-muted" style={{ margin: "8px 0 12px" }}>
              Reassign this case to another advocate. It will move out of your workspace into theirs.
            </p>
            <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8 }}>
              <option value="">Select an advocate…</option>
              {advocates.map((a) => (
                <option key={a.id} value={a.id}>{a.fullName || a.email}{a.email ? ` — ${a.email}` : ""}</option>
              ))}
            </select>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="cd-actions-btn" onClick={doTransfer} disabled={!transferTo || transferring}>
                {transferring ? "Transferring…" : "Transfer"}
              </button>
              <button className="cd-edit-cancel" onClick={() => setShowTransfer(false)}>Cancel</button>
            </div>
          </div>
        </div>
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

      {/* Upload Order modal */}
      {showUploadOrder && (
        <div className="cd-modal-overlay" onClick={() => setShowUploadOrder(false)}>
          <div className="cd-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Upload Order — {summary.caseNumber}</h3>
            <div className="cd-modal-form">
              <label className="cd-modal-label">Document name</label>
              <input type="text" placeholder="e.g. Interim Order 21-01-2025" value={orderForm.documentName}
                onChange={(e) => setOrderForm({ ...orderForm, documentName: e.target.value })} />
              <label className="cd-modal-label">Order date</label>
              <input type="date" value={orderForm.orderDate}
                onChange={(e) => setOrderForm({ ...orderForm, orderDate: e.target.value })} />
              <label className="cd-modal-label">Description (optional)</label>
              <input type="text" placeholder="Notes about this order" value={orderForm.description}
                onChange={(e) => setOrderForm({ ...orderForm, description: e.target.value })} />
              <label className="cd-modal-label">File *</label>
              <input type="file" onChange={(e) => setOrderForm({ ...orderForm, file: e.target.files[0] })} />
              <div className="cd-modal-actions">
                <button className="cd-modal-save" onClick={uploadOrder} disabled={uploadingOrder || !orderForm.file}>
                  {uploadingOrder ? "Uploading…" : "Upload Order"}
                </button>
                <button className="cd-modal-cancel" onClick={() => setShowUploadOrder(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Hearing modal */}
      {showHearingModal && (
        <div className="cd-modal-overlay" onClick={() => { setShowHearingModal(false); setEditingEventId(null); }}>
          <div className="cd-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{editingEventId ? "Edit Hearing" : "Add Hearing"} — {summary.caseNumber}</h3>
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
                  {savingFin ? "Saving..." : (editingEventId ? "Save Hearing" : "Add Hearing")}
                </button>
                <button className="cd-modal-cancel" onClick={() => { setShowHearingModal(false); setEditingEventId(null); }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
