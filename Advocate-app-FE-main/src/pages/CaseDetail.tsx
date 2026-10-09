// Case file (/dashboard/cases/:id): the docket cover (number, parties, court,
// tags, actions), tabs for every part of the matter, and a summary rail (next
// hearing, fees, client, team). Every action is shown only to a role that holds
// its permission; the API enforces the same rules.
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { DRAFTING, newDraftUrl } from "./Drafting/routes";
import { ReviewActions, ReviewChip, ReviewNote, SubmissionHistory, SubmitWork } from "../components/TaskReview";
import CaseTimeline from "../components/CaseTimeline";
import DocumentSummaryModal from "../components/DocumentSummaryModal";
import CaseExtraDetails from "../components/CaseExtraDetails";
import { fetchCourtDocument, downloadHcOrderPdf, fetchHcBusiness } from "../services/courtDocuments";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import { useLoading } from "../contexts/LoadingContext";
import { formatCurrency } from "../utils/formatCurrency";
import { persistCourtRecord } from "./AddCase";
import { Button, Chip, StatusChip, Avatar, Panel, EmptyState, Skel, Spinner, PopMenu, Icon, titleCase, type MenuItem, type Tone } from "../ui/kit";
import { TextField, TextArea, SelectField, Field, Check, Tabs, SearchInput } from "../ui/forms";
import { Modal, confirm } from "../ui/overlays";
import "../ui/pages/casedetail.css";
import { copyText } from "../utils/clipboard";
import DuplicateEventDialog from "../components/DuplicateEventDialog";
import { DOCUMENT_ACCEPT } from "../utils/fileTypes";
import { amountError, blockSignKeys, dueDateError, todayISO } from "../utils/validators";

type TabKey = "overview" | "parties" | "hearings" | "events" | "orders" | "docs" | "tasks" | "billing" | "notes" | "related" | "acts" | "court" | "timeline";

// Same document categories offered on the main Documents upload, so a document
// attached to a task is filed under the same taxonomy.
const DOC_CATEGORIES = [
  "Court Order", "Petition", "Evidence", "Agreement", "Affidavit",
  "Notice", "Judgment", "Invoice", "Payment Receipt",
  "Identity Proof", "Address Proof", "Other",
];
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
const HOT_TAGS = ["High Priority", "Urgent"];
const PRIORITIES = [
  { value: "LOW", label: "Low" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];
const PAYMENT_STATUSES = [
  { value: "PAID", label: "Paid" },
  { value: "PENDING", label: "Pending" },
  { value: "UNPAID", label: "Unpaid" },
];
const prioTone = (p: string): Tone => (p === "HIGH" ? "bad" : p === "LOW" ? "ok" : "warn");

// The kit's confirm() as a promise, so handlers read top to bottom.
const confirmAsync = (message: string, title = "Please confirm", confirmLabel = "Confirm") =>
  new Promise<boolean>((resolve) => {
    confirm({ title, message, danger: true, confirmLabel, accept: () => resolve(true), reject: () => resolve(false) });
  });

// One field's pencil-edit affordance: shows the value + a pencil; clicking turns
// it into an input/select with save/cancel. `onSave(newValue)` should throw to
// keep the field open on failure.
function InlineEdit({ value, display, type = "text", options, onSave, onStart, label }: any) {
  // Every inline field on this page edits the case, so without CASE_EDIT it is plain text.
  const { hasPermission } = usePermission();
  const canEdit = hasPermission("CASE_EDIT");
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
      <span className="cs-inline">
        <span>{display ?? (value || "—")}</span>
        {canEdit && <button type="button" className="btn ghost sm icon" onClick={start} aria-label={`Edit ${label || "field"}`} title="Edit"><Icon name="edit" size="sm" /></button>}
      </span>
    );
  }
  return (
    <span className="cs-inline">
      {type === "select" ? (
        <select autoFocus className="input" aria-label={label} value={val} onChange={(e) => setVal(e.target.value)}>
          {(options || []).map((o: any) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input autoFocus className="input" aria-label={label} value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} />
      )}
      <button type="button" className={`btn sm icon${saving ? " loading" : ""}`} onClick={commit} disabled={saving} aria-label="Save"><Icon name="check" size="sm" /></button>
      <button type="button" className="btn ghost sm icon" onClick={() => setEditing(false)} aria-label="Cancel"><Icon name="x" size="sm" /></button>
    </span>
  );
}

// Plain ISO date -> calendar days from today (0 today, 1 tomorrow), read as a
// local date so IST never shifts it.
function daysFrom(iso?: string | null) {
  if (!iso) return NaN;
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d).getTime() - t.getTime()) / 86400000);
}
const relDay = (iso?: string | null) => {
  const n = daysFrom(iso);
  if (Number.isNaN(n)) return "";
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
};
const fmtTime = (t?: string | null) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const d = new Date(); d.setHours(h, m || 0, 0, 0);
  return d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
};

function Stamp({ iso }: { iso: string }) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return (
    <div className={`stamp${daysFrom(iso) === 0 ? " today" : ""}`} aria-label={date.toDateString()}>
      <span>{date.toLocaleDateString("en-IN", { month: "short" })}</span><b>{d}</b>
    </div>
  );
}

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
// Non-hearing calendar entries live in their own "Events" tab, kept apart from
// hearings so the hearings view (which also lists past court hearings) is not
// cluttered by meetings/reminders.
const OTHER_EVENT_TYPES = EVENT_TYPES.filter((t) => t.value !== "HEARING");

const HEARING_PURPOSES = [
  "Arguments", "Evidence", "Framing of Issues", "For Counter / Reply",
  "For Orders", "Interim Application", "Mention", "Cross-examination", "Other",
];
const EMPTY_HEARING = {
  title: "", eventType: "HEARING", date: "", time: "", description: "",
  purpose: "", court: "", benchHall: "", judge: "", nextDate: "", outcome: "",
};

function fmtDate(dateStr: any) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
export default function CaseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { success, error } = toast;
  const { hasPermission } = usePermission();
  const [summaryDoc, setSummaryDoc] = useState(null);
  const { withLoading } = useLoading();
  const { advocateId: myId } = useAuth();
  const [actSuggestions, setActSuggestions] = useState<any[]>([]);


  const [tab, setTab] = useState<TabKey>("overview");
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  // Inline edit of the case's own (app-owned) fields. Clients power the client picker.
  const [clients, setClients] = useState([]);
  // Transfer modal.
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

  // The court answers 200 with an empty {court, parties, fields} when it holds
  // no Daily Status for that date (common where the row's businessDate is
  // blank). That object is truthy, so without this check the modal opened
  // empty and looked broken.
  const hasBusinessContent = (biz) =>
    !!biz && (biz.court || biz.parties || Object.keys(biz.fields || {}).length > 0);

  const viewHearingBusiness = async (ev) => {
    const match = hearingBizByDate.get(ev.date);
    if (!match) return;
    setHearingViewBusy(ev.id);
    try {
      const biz = await fetchCourtDocument({
        courtComplex: courtRecordComplex, viewToken: match.viewToken,
        kind: "hearing_business", token: match.business, label: match.label,
      });
      if (hasBusinessContent(biz)) setHearingBizModal(biz);
      else error("The court has no daily status recorded for this hearing.");
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
      if (hasBusinessContent(biz)) setHearingBizModal(biz);
      else error("The court has no daily status recorded for this hearing.");
    } catch (e) {
      error && error(e?.message || "Couldn’t fetch the hearing status.");
    } finally {
      setHearingViewBusy(null);
    }
  };

  // Inputs
  const [newTag, setNewTag] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newTask, setNewTask] = useState({ title: "", priority: "MEDIUM", deadline: "", category: "", assignedTo: "" });
  const [assignees, setAssignees] = useState([]);
  const [taskFiles, setTaskFiles] = useState([]);
  const [uploadFile, setUploadFile] = useState(null);
  // Upload Order modal
  const [showUploadOrder, setShowUploadOrder] = useState(false);
  const [uploadingOrder, setUploadingOrder] = useState(false);
  const [orderForm, setOrderForm] = useState({ documentName: "", orderDate: "", description: "", file: null });

  // Add expense / invoice / hearing modals
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);
  const [showHearingModal, setShowHearingModal] = useState(false);
  const [dupEvent, setDupEvent] = useState<any>(null);   // the hearing a new one would repeat (409)
  // "hearing" → the Hearings tab (type locked to HEARING); "event" → the Events
  // tab (Meeting / Payment Due / Document). Controls the shared add/edit modal.
  const [eventModalMode, setEventModalMode] = useState("hearing");
  const [expenseForm, setExpenseForm] = useState({ title: "", amount: "", category: "", paymentDate: "", paymentStatus: "" });
  const [invoiceForm, setInvoiceForm] = useState({ invoiceDate: "", dueDate: "", particulars: [{ description: "", amount: "" }] });
  const [hearingForm, setHearingForm] = useState(EMPTY_HEARING);
  const [editingEventId, setEditingEventId] = useState(null);
  const [alertBusy, setAlertBusy] = useState(null);
  const [savingFin, setSavingFin] = useState(false);

  // Parties + related inline forms
  const [partyForm, setPartyForm] = useState({ name: "", role: "", counsel: "", contact: "", isOpponent: false });
  const [relatedForm, setRelatedForm] = useState({ relatedCaseId: "", relation: "", note: "" });

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/workspace/cases/${id}/summary`);
      setSummary(res.data);
    } catch (err) {
      console.error("Error loading case:", err);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // ---------- Inline edit (app-owned case fields) ----------
  // Partial update — UpdateCaseView only writes the keys present, so each
  // per-field pencil can PUT just its own field. Throws so the field stays open on error.
  const patchCase = async (payload) => {
    try {
      await api.put(`/api/cases/update/${id}`, payload);
      await fetchSummary();
      success("Case updated.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to update case.");
      throw err;
    }
  };

  // ---------- Header actions: archive / transfer ----------
  const archiveCase = async () => {
    if (!(await confirmAsync("Archive this case? It will be hidden from the workspace (you can restore it from the Cases list).", "Archive this case?", "Archive case"))) return;
    try {
      await api.delete(`/api/cases/delete/${id}`);
      success("Case archived.");
      navigate("/dashboard/cases");
    } catch (err) {
      error(err.response?.data?.error || "Failed to archive case.");
    }
  };

  const openTransfer = async () => {
    setShowTransfer(true);
    if (advocates.length === 0) {
      try {
        // Scoped to who you may transfer to (your team, or the whole firm for a
        // Super Admin) — no admin permission needed.
        const res = await api.get("/api/cases/transfer-targets");
        setAdvocates(res.data || []);
      } catch {
        error("Couldn't load advocates to transfer to.");
      }
    }
  };

  // Load transfer targets up front, so the Transfer action only appears when
  // there is actually someone to transfer to — a solo advocate has none, so it
  // stays hidden rather than opening an empty picker.
  useEffect(() => {
    if (!hasPermission("CASE_EDIT")) return;
    api.get("/api/cases/transfer-targets")
      .then((res) => setAdvocates(res.data || []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const doTransfer = async () => {
    if (!transferTo) { error("Select an advocate to transfer to."); return; }
    setTransferring(true);
    try {
      await api.put(`/api/cases/transfer/${id}`, { advocateId: Number(transferTo) });
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
  // ---- Link a manual case to its court record (by CNR) ----
  // A case entered by hand (a CNR not assigned yet, the scraper down) can pick
  // up its court record later without being re-created: the record, parties
  // and upcoming hearings are added to THIS case, keeping its notes, tasks and
  // bills. Same steps as an import (AddCase.persistCourtRecord).
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkCnr, setLinkCnr] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [linkFound, setLinkFound] = useState<any>(null);   // {courtId, record}
  const openLink = () => {
    setLinkCnr(""); setLinkError(""); setLinkFound(null); setLinkOpen(true);
  };
  const findCnr = async () => {
    const cnr = linkCnr.replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z]{4}\d{12}$/.test(cnr)) { setLinkError("A CNR is 16 characters: 4 letters then 12 digits."); return; }
    setLinkBusy(true); setLinkError(""); setLinkFound(null);
    try {
      const res = await api.post("/api/courtsearch/cnr", { cnr });
      const cases = res.data?.cases || [];
      if (!cases.length) { setLinkError("The court has no case with that CNR."); return; }
      setLinkFound({ courtId: res.data?.courtId === "ecourts_hc" ? "ecourts_hc" : "ecourts_dc",
                     record: { cases }, cnr });
    } catch (err: any) {
      setLinkError(err?.response?.data?.error || "Could not reach the court. Try again shortly.");
    } finally {
      setLinkBusy(false);
    }
  };
  const doLink = async () => {
    if (!linkFound) return;
    setLinkBusy(true); setLinkError("");
    try {
      const existing = await api.get(`/api/workspace/cases/${id}/parties`).then((r) => r.data || []).catch(() => []);
      await persistCourtRecord(Number(id), linkFound.courtId, { cnr: linkFound.cnr }, linkFound.record,
                               existing.map((p: any) => p.name || ""));
      await api.put(`/api/workspace/cases/${id}/profile`, { cnr: linkFound.cnr });
      setLinkOpen(false);
      toast.success("Linked to the court record. Parties and upcoming hearings were added.");
      fetchCourtRecord(); fetchParties(); fetchEvents(); fetchSummary();
    } catch (err: any) {
      setLinkError(err?.response?.data?.error || "Could not link the court record.");
    } finally {
      setLinkBusy(false);
    }
  };

  const refreshCourtData = async () => {
    setRefreshing(true);
    try {
      const res = await api.post(`/api/courtsearch/cases/${id}/refresh`, {}, { timeout: 240000 });
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
      const res = await api.get("/api/clients/my-clients");
      setClients(res.data || []);
    } catch { /* picker falls back to the current client only */ }
  }, [clients.length]);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await api.get(`/api/workspace/cases/${id}/events`);
      setEvents(res.data || []);
    } catch { setEvents([]); }
  }, [id]);

  const fetchDocs = useCallback(async () => {
    try {
      const res = await api.get(`/api/documents/by-case/${id}`);
      setDocs(res.data || []);
    } catch { setDocs([]); }
  }, [id]);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await api.get(`/api/workspace/cases/${id}/notes`);
      setNotes(res.data || []);
    } catch { setNotes([]); }
  }, [id]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await api.get(`/api/workspace/cases/${id}/tasks`);
      setTasks(res.data || []);
    } catch { setTasks([]); }
  }, [id]);

  const fetchFinancials = useCallback(async () => {
    try {
      const res = await api.get(`/api/workspace/cases/${id}/financials`);
      setFinancials(res.data);
    } catch { setFinancials(null); }
  }, [id]);

  const fetchParties = useCallback(async () => {
    try {
      const res = await api.get(`/api/workspace/cases/${id}/parties`);
      setParties(res.data || []);
    } catch { setParties([]); }
  }, [id]);

  const fetchRelated = useCallback(async () => {
    try {
      const res = await api.get(`/api/workspace/cases/${id}/related`);
      setRelated(res.data || []);
    } catch { setRelated([]); }
  }, [id]);

  const fetchLinkableCases = useCallback(async () => {
    try {
      const res = await api.get(`/api/cases/my-cases`);
      setLinkableCases((res.data || []).filter((c) => c.id !== Number(id)));
    } catch { setLinkableCases([]); }
  }, [id]);

  const addExpense = async () => {
    if (!expenseForm.title.trim()) { error("Expense title is required."); return; }
    if (!expenseForm.amount) { error("Enter the expense amount."); return; }
    if (amountError(expenseForm.amount)) { error(amountError(expenseForm.amount) as string); return; }
    setSavingFin(true);
    try {
      await withLoading(
        api.post("/api/expenses/create", {
          title: expenseForm.title.trim(),
          amount: expenseForm.amount ? parseFloat(expenseForm.amount) : 0,
          category: expenseForm.category || null,
          paymentDate: expenseForm.paymentDate || null,
          paymentStatus: expenseForm.paymentStatus || null,
          caseId: Number(id),
        }),
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

  const setInvParticular = (i, field, value) =>
    setInvoiceForm((prev) => ({ ...prev, particulars: prev.particulars.map((p, idx) => (idx === i ? { ...p, [field]: value } : p)) }));
  const addInvParticular = () =>
    setInvoiceForm((prev) => ({ ...prev, particulars: [...prev.particulars, { description: "", amount: "" }] }));
  const removeInvParticular = (i) =>
    setInvoiceForm((prev) => {
      const rows = prev.particulars.filter((_, idx) => idx !== i);
      return { ...prev, particulars: rows.length ? rows : [{ description: "", amount: "" }] };
    });
  // Picking a past hearing seeds a first particular and sets the invoice date,
  // so billing an appearance is one click. hearingHistory is built in render.
  const prefillInvoiceFromHearing = (idx) => {
    const h = hearingHistory[Number(idx)];
    if (!h) return;
    const when = h.hearingDate || h.businessDate || "";
    const label = `Appearance for hearing${when ? ` on ${when}` : ""}${h.purpose ? ` — ${h.purpose}` : ""}`;
    setInvoiceForm((prev) => {
      const first = prev.particulars[0];
      const particulars = (!first.description && !first.amount)
        ? [{ description: label, amount: "" }, ...prev.particulars.slice(1)]
        : [...prev.particulars, { description: label, amount: "" }];
      return { ...prev, invoiceDate: when || prev.invoiceDate, particulars };
    });
  };

  // Due dates and deadlines being set may be today or later (and an invoice's
  // not before its invoice date); the server checks the same.
  const invDueError = dueDateError(invoiceForm.dueDate, "Due date", invoiceForm.invoiceDate, "invoice date");
  const invDueMin = [todayISO(), invoiceForm.invoiceDate || ""].sort().pop();
  const taskDeadlineError = dueDateError(newTask.deadline, "Deadline");

  const addInvoice = async () => {
    if (invDueError) { error(invDueError); return; }
    const particulars = invoiceForm.particulars
      .map((p) => ({ description: (p.description || "").trim(), amount: parseFloat(p.amount) || 0 }))
      .filter((p) => p.description || p.amount);
    if (!particulars.length || particulars.reduce((s, p) => s + p.amount, 0) <= 0) {
      error("Add at least one particular with an amount."); return;
    }
    setSavingFin(true);
    try {
      const body = {
        particulars,
        invoiceDate: invoiceForm.invoiceDate || null,
        dueDate: invoiceForm.dueDate || null,
        caseId: Number(id),
      };
      // Without INVOICE_ISSUE the invoice goes to accounts to check and issue.
      const issue = hasPermission("INVOICE_ISSUE");
      await withLoading(
        api.post(issue ? "/api/invoices/create" : "/api/invoices/requests", body),
        issue ? "Adding invoice..." : "Sending to accounts..."
      );
      setShowInvoiceModal(false);
      setInvoiceForm({ invoiceDate: "", dueDate: "", particulars: [{ description: "", amount: "" }] });
      fetchFinancials();
      fetchSummary();
      success(issue ? "Invoice added to this case." : "Sent to accounts to issue.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to add invoice.");
    } finally {
      setSavingFin(false);
    }
  };

  const addHearing = async (allowDuplicate = false) => {
    if (!hearingForm.title.trim() || !hearingForm.date) { error("Title and date are required."); return; }
    setSavingFin(true);
    const payload = {
      title: hearingForm.title.trim(),
      eventType: hearingForm.eventType,
      date: hearingForm.date,
      time: hearingForm.time || null,
      description: hearingForm.description || "",
      ...(eventModalMode === "hearing" ? {
        purpose: hearingForm.purpose,
        court: hearingForm.court,
        benchHall: hearingForm.benchHall,
        judge: hearingForm.judge,
        nextDate: hearingForm.nextDate || null,
        outcome: hearingForm.outcome,
      } : {}),
    };
    try {
      if (editingEventId) {
        await withLoading(api.put(`/api/events/update/${editingEventId}`, payload), "Saving hearing...");
      } else {
        await withLoading(api.post("/api/events/create", { ...payload, caseEntity: { id: Number(id) }, ...(allowDuplicate ? { allowDuplicate: true } : {}) }), "Adding hearing...");
      }
      setShowHearingModal(false);
      setEditingEventId(null);
      setHearingForm(EMPTY_HEARING);
      setDupEvent(null);
      fetchEvents();
      fetchSummary();
      success(eventModalMode === "event"
        ? (editingEventId ? "Event updated." : "Event added to this case.")
        : (editingEventId ? "Hearing updated." : "Hearing added to this case."));
    } catch (err) {
      // Same hearing already on this case: ask before adding it again.
      if (err.response?.status === 409 && err.response.data?.duplicate) { setDupEvent(err.response.data.duplicate); return; }
      error(err.response?.data?.error || "Failed to save hearing.");
    } finally {
      setSavingFin(false);
    }
  };

  const editHearing = (ev) => {
    setEditingEventId(ev.id);
    setEventModalMode(ev.eventType === "HEARING" ? "hearing" : "event");
    const hd = ev.hearingDetail || {};
    setHearingForm({
      title: ev.title || "",
      eventType: ev.eventType || "HEARING",
      date: ev.date || "",
      time: ev.time ? ev.time.slice(0, 5) : "",
      description: ev.description || "",
      purpose: hd.purpose || "",
      court: hd.court || "",
      benchHall: hd.benchHall || "",
      judge: hd.judge || "",
      nextDate: hd.nextDate || "",
      outcome: hd.outcome || "",
    });
    setShowHearingModal(true);
  };

  const deleteHearingEvent = async (evId) => {
    if (!(await confirmAsync("This removes it from the case and the calendar.", "Delete this hearing or reminder?", "Delete"))) return;
    try {
      await api.delete(`/api/events/delete/${evId}`);
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
    if (await copyText(parts.join("\n"))) success("Listing copied to clipboard.");
    else error("Couldn't copy to clipboard.");
  };

  const alertClient = async (row, i) => {
    setAlertBusy(`a${i}`);
    try {
      const res = await api.post(`/api/cases/${id}/hearing-alert`, {
        date: row.hearingDate || row.businessDate || "",
        purpose: row.purpose || "",
        bench: row.judge || "",
      });
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
      await api.post(`/api/workspace/cases/${id}/parties`, {
        name: partyForm.name.trim(),
        role: partyForm.role || null,
        counsel: partyForm.counsel || null,
        contact: partyForm.contact || null,
        isOpponent: partyForm.isOpponent,
      });
      setPartyForm({ name: "", role: "", counsel: "", contact: "", isOpponent: false });
      fetchParties();
      success("Party added.");
    } catch { error("Failed to add party."); }
  };

  const deleteParty = async (partyId) => {
    try {
      await api.delete(`/api/workspace/parties/${partyId}`);
      fetchParties();
    } catch { error("Failed to remove party."); }
  };

  const addRelated = async () => {
    if (!relatedForm.relatedCaseId) { error("Select a case to link."); return; }
    try {
      await api.post(`/api/workspace/cases/${id}/related`, {
        relatedCaseId: Number(relatedForm.relatedCaseId),
        relation: relatedForm.relation || null,
        note: relatedForm.note || null,
      });
      setRelatedForm({ relatedCaseId: "", relation: "", note: "" });
      fetchRelated();
      success("Case linked.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to link case.");
    }
  };

  const deleteRelated = async (linkId) => {
    try {
      await api.delete(`/api/workspace/related/${linkId}`);
      fetchRelated();
    } catch { error("Failed to remove link."); }
  };

  // ---------- Acts ----------
  const fetchLinkedActs = useCallback(async () => {
    try {
      const res = await api.get(`/api/cases/${id}/acts`);
      setLinkedActs(res.data || []);
    } catch { setLinkedActs([]); }
  }, [id]);

  // Acts the court cited on the imported record, matched to our library server-side.
  const fetchCitedActs = useCallback(async () => {
    try {
      const res = await api.get(`/api/cases/${id}/cited-acts`);
      setCitedActs(res.data || []);
    } catch { setCitedActs([]); }
  }, [id]);

  // Server-side search for the picker — 1250+ acts, so query as the user types
  // instead of loading them all (reuses the Acts page's /api/acts search).
  const loadActOptions = useCallback(async (input) => {
    try {
      const res = await api.get(`/api/acts`, { params: { q: input, field: "all" } });
      const rows = res.data?.content || [];
      const linkedIds = new Set(linkedActs.map((a) => a.actId));
      return rows
        .filter((a) => !linkedIds.has(a.id))   // hide already-linked acts
        .map((a) => ({
          value: a.id,
          label: `${a.title}${a.actYear ? ` (${a.actYear})` : ""}${a.jurisdiction ? ` · ${a.jurisdiction}` : ""}`,
        }));
    } catch { return []; }
  }, [linkedActs]);

  const addAct = async () => {
    if (!selectedAct) { error("Select an act to link."); return; }
    setLinkingAct(true);
    try {
      await api.post(`/api/cases/${id}/acts`, { actId: selectedAct.value });
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
      await api.delete(`/api/cases/${id}/acts/${actId}`);
      fetchLinkedActs();
    } catch { error("Failed to unlink act."); }
  };

  // One-click add a court-cited act (that we matched to the library) into the
  // case's Linked Acts, reusing the same link endpoint.
  const linkCitedAct = async (actId) => {
    try {
      await api.post(`/api/cases/${id}/acts`, { actId });
      fetchLinkedActs();
      success("Act linked.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to link act.");
    }
  };

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // Load financials on mount too — the header "Amount" shows the total invoiced,
  // so it can't wait for the Expenses/Invoices tab to be opened.
  useEffect(() => {
    if (hasPermission("INVOICE_VIEW") || hasPermission("EXPENSE_VIEW")) fetchFinancials();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchFinancials]);

  const fetchCourtRecord = useCallback(async () => {
    setCourtRecordLoading(true);
    try {
      const res = await api.get(`/api/courtsearch/imported-records?caseId=${id}`);
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

  // Team members a senior can assign tasks to (only fetched if permitted).
  useEffect(() => {
    if (!hasPermission("TASK_ASSIGN")) return;
    api.get("/api/workspace/assignable-advocates")
      .then((res) => setAssignees(res.data || []))
      .catch((err) => console.error("Error fetching assignable advocates:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazily load tab data on demand
  useEffect(() => {
    // Overview pulls a little of everything it summarises (each only if the
    // role may see it, so the API is not asked for what it would refuse).
    if (tab === "overview") {
      if (hasPermission("EVENT_VIEW")) fetchEvents();
      if (hasPermission("TASK_VIEW")) fetchTasks();
      if (hasPermission("DOCUMENT_VIEW")) fetchDocs();
      fetchNotes();
    }
    if (tab === "parties") fetchParties();
    if (tab === "related") { fetchRelated(); fetchLinkableCases(); }
    if (tab === "acts") { fetchLinkedActs(); fetchCitedActs(); }
    if (tab === "billing") fetchFinancials();
    if (tab === "hearings" || tab === "events") fetchEvents();
    if (tab === "docs" || tab === "orders") fetchDocs();
    if (tab === "notes") fetchNotes();
    if (tab === "tasks") fetchTasks();
    if ((tab === "court" || tab === "orders" || tab === "hearings") && !courtRecordLoaded) fetchCourtRecord();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, fetchFinancials, fetchEvents, fetchDocs, fetchNotes, fetchTasks, fetchParties, fetchRelated, fetchLinkableCases, fetchLinkedActs, fetchCitedActs, fetchCourtRecord, courtRecordLoaded]);

  // ---------- Tags ----------
  const addTag = async (explicit) => {
    const label = (explicit ?? newTag).trim();
    if (!label) return;
    try {
      await api.post(`/api/workspace/cases/${id}/tags`, { label });
      setNewTag("");
      fetchSummary();
      success("Tag added.");
    } catch { error("Failed to add tag."); }
  };

  const removeTag = async (tagId) => {
    try {
      await api.delete(`/api/workspace/tags/${tagId}`);
      fetchSummary();
    } catch { error("Failed to remove tag."); }
  };

  // ---------- Notes ----------
  const addNote = async () => {
    const body = newNote.trim();
    if (!body) return;
    try {
      await withLoading(api.post(`/api/workspace/cases/${id}/notes`, { body }), "Saving note...");
      setNewNote("");
      fetchNotes();
      fetchSummary();
      success("Note added.");
    } catch { error("Failed to add note."); }
  };

  const deleteNote = async (noteId) => {
    try {
      await api.delete(`/api/workspace/notes/${noteId}`);
      fetchNotes();
      fetchSummary();
    } catch { error("Failed to delete note."); }
  };

  // ---------- Tasks ----------
  const addTask = async () => {
    const title = newTask.title.trim();
    if (!title) return;
    if (taskDeadlineError) { error(taskDeadlineError); return; }
    try {
      await withLoading((async () => {
        const res = await api.post(`/api/workspace/cases/${id}/tasks`, {
          title, priority: newTask.priority, deadline: newTask.deadline || null,
          assignedToId: newTask.assignedTo || undefined,
        });
        const taskId = res.data.id;
        for (const file of taskFiles) {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("caseId", id);
          if (newTask.category) fd.append("category", newTask.category);
          const up = await api.post("/api/documents/upload", fd);
          if (up.data?.id) {
            await api.post(`/api/workspace/tasks/${taskId}/documents`, { documentId: up.data.id });
          }
        }
      })(), "Adding task...");
      setNewTask({ title: "", priority: "MEDIUM", deadline: "", category: "", assignedTo: "" });
      setTaskFiles([]);
      fetchTasks();
      fetchSummary();
      success("Task added.");
    } catch { error("Failed to add task."); }
  };

  const toggleTask = async (taskId) => {
    try {
      await api.put(`/api/workspace/tasks/${taskId}/toggle`, {});
      fetchTasks();
      fetchSummary();
    } catch (err: any) {
      // A delegated task is handed back through "Submit work", with a report.
      error(err.response?.data?.submitRequired
        ? "Use Submit work to hand this task back with a report."
        : "Failed to update task.");
    }
  };

  const changeTaskPriority = async (taskId, priority) => {
    try {
      await api.put(`/api/workspace/tasks/${taskId}/priority`, { priority });
      fetchTasks();
    } catch { error("Failed to update priority."); }
  };

  const cancelTask = async (taskId, cancelled = true) => {
    try {
      await api.put(`/api/workspace/tasks/${taskId}/cancel`, { cancelled });
      fetchTasks();
      fetchSummary();
    } catch { error("Failed to update task."); }
  };

  // ---------- Documents ----------
  const previewDoc = async (docId) => {
    try {
      const res = await api.get(`/api/documents/preview/${docId}`, { responseType: "blob" });
      window.open(URL.createObjectURL(res.data), "_blank");
    } catch { error("Preview failed."); }
  };

  const downloadDoc = async (docId, fileName) => {
    try {
      const res = await api.get(`/api/documents/download/${docId}`, { responseType: "blob" });
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
      await withLoading(api.post("/api/documents/upload", fd), "Uploading...");
      setUploadFile(null);
      fetchDocs();
      success("Document uploaded.");
    } catch (err) { error(err.response?.data?.error || "Upload failed."); }
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
      await api.post("/api/documents/upload", fd);
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


  // ---------- Page chrome state (menus, act search) ----------
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const [tagAnchor, setTagAnchor] = useState<HTMLElement | null>(null);
  const [actQuery, setActQuery] = useState("");
  const actTimer = useRef<any>(null);
  // Search acts as the user types (1250+ acts, so the server filters).
  useEffect(() => {
    clearTimeout(actTimer.current);
    if (!actQuery.trim()) { setActSuggestions([]); return; }
    actTimer.current = setTimeout(async () => setActSuggestions(await loadActOptions(actQuery.trim())), 250);
    return () => clearTimeout(actTimer.current);
  }, [actQuery, loadActOptions]);

  const goTab = (k: TabKey) => {
    setTab(k);
    document.getElementById("case-tabs")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  if (loading) {
    return (
      <div className="stack" style={{ gap: "var(--s5)" }} aria-busy="true">
        <div className="docket"><Skel h={12} w={160} /><Skel h={34} w="60%" style={{ margin: "12px 0" }} /><Skel h={14} w="80%" /></div>
        <div className="split"><div className="stack" style={{ gap: 12 }}><Skel h={36} /><Skel h={180} /><Skel h={140} /></div><div className="stack" style={{ gap: 12 }}><Skel h={160} /><Skel h={120} /></div></div>
      </div>
    );
  }

  if (!summary) {
    return (
      <EmptyState icon="case" title="This case isn't in your workspace"
        text="It may have been archived or transferred, or the link is wrong. Search the register to find it."
        action={<Button variant="primary" onClick={() => navigate("/dashboard/cases")}>Back to cases</Button>} />
    );
  }

  const caseIdentity = extractCaseIdentity(courtRecord, courtRecordCourtId);
  const hearingHistory = extractHearingHistory(courtRecord);
  const invoiceTotal = invoiceForm.particulars.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
  // Transfer is offered only to an editor who has someone to transfer to.
  const canTransfer = hasPermission("CASE_EDIT") && advocates.length > 0;
  // Hearings tab: manually-added HEARING events (upcoming ones we track). Past
  // court hearings from the imported record live in full under Court Hearing
  // History below. Non-hearing entries move to the separate Events tab.
  const _todayISO = new Date().toISOString().slice(0, 10);
  const hearingEvents = (events || []).filter(
    (ev) => ev.eventType === "HEARING" && (!ev.date || ev.date >= _todayISO));
  const otherEvents = (events || []).filter((ev) => ev.eventType !== "HEARING");
  const orders = extractOrders(courtRecord);
  const uploadedOrders = (docs || []).filter((d) => (d.category || "").toLowerCase() === "order");
  const transferTarget = advocates.find((a) => String(a.id) === String(transferTo));

  const can = (p: string) => hasPermission(p);
  const canEdit = can("CASE_EDIT");
  const canEventCreate = can("EVENT_CREATE");
  const canBilling = can("INVOICE_VIEW") || can("EXPENSE_VIEW");
  const cnr = caseIdentity.find((f) => f.label === "CNR")?.value || "";
  const otherIdentity = caseIdentity.filter((f) => f.label !== "CNR");
  const titleParts = String(summary.caseTitle || "").split(/\s+(?:vs\.?|v\/s\.?|versus)\s+/i);
  const next = summary.nextHearing;
  const nd = next ? daysFrom(next.date) : NaN;
  const openTasks = tasks.filter((t) => !t.completed && !t.cancelled);
  const totals = financials?.totals;
  const paidPct = totals?.totalInvoiced ? Math.min(100, Math.round((totals.totalPaid / totals.totalInvoiced) * 100)) : 0;
  // People on the matter, as far as this page knows them: who assigned and who holds its tasks.
  const team: { name: string; role: string }[] = [];
  tasks.forEach((t) => {
    if (t.assignedByName && !team.some((x) => x.name === t.assignedByName)) team.push({ name: t.assignedByName, role: "Assigns work" });
    if (t.assignedToName && !team.some((x) => x.name === t.assignedToName)) team.push({ name: t.assignedToName, role: "Working on tasks" });
  });

  const openHearingModal = (mode: "hearing" | "event") => {
    setEditingEventId(null);
    setEventModalMode(mode);
    setHearingForm(mode === "event" ? { ...EMPTY_HEARING, eventType: "MEETING" } : EMPTY_HEARING);
    setShowHearingModal(true);
  };
  const closeHearingModal = () => { setShowHearingModal(false); setEditingEventId(null); };

  const moreItems: MenuItem[] = [
    ...(courtRecord && canEdit ? [{ label: "Refresh court data", icon: "refresh" as const, onClick: refreshCourtData }] : []),
    // A manual case with no court record yet can be linked to one by CNR.
    ...(!courtRecord && courtRecordLoaded && canEdit ? [{ label: "Link to court record…", icon: "link" as const, onClick: openLink }] : []),
    ...(canEventCreate ? [{ label: "Add event or reminder", icon: "calendar" as const, onClick: () => openHearingModal("event") }] : []),
    // Only when you can edit AND there's someone to transfer to — a solo advocate has no target.
    ...(canTransfer ? [{ label: "Transfer case…", icon: "swap" as const, onClick: openTransfer }] : []),
    ...(can("CASE_DELETE") ? ["-" as const, { label: "Archive case", icon: "archive" as const, danger: true, onClick: archiveCase }] : []),
  ];
  const showMore = moreItems.some((m) => m !== "-");

  const tabs: { value: TabKey; label: string; count?: number }[] = [
    { value: "overview", label: "Overview" },
    { value: "parties", label: "Parties", count: parties.length || undefined },
    ...(can("EVENT_VIEW") ? [
      { value: "hearings" as TabKey, label: "Hearings", count: (hearingEvents.length + hearingHistory.length) || undefined },
      { value: "events" as TabKey, label: "Events", count: otherEvents.length || undefined },
    ] : []),
    ...(can("DOCUMENT_VIEW") ? [
      { value: "orders" as TabKey, label: "Orders", count: (orders.length + uploadedOrders.length) || undefined },
      { value: "docs" as TabKey, label: "Documents", count: docs.length || undefined },
    ] : []),
    ...(can("TASK_VIEW") ? [{ value: "tasks" as TabKey, label: "Tasks", count: summary.taskCounts?.open || undefined }] : []),
    ...(canBilling ? [{ value: "billing" as TabKey, label: "Billing", count: (financials ? financials.totals.invoiceCount + financials.totals.expenseCount : 0) || undefined }] : []),
    { value: "notes", label: "Notes", count: summary.noteCount || undefined },
    { value: "related", label: "Related cases", count: related.length || undefined },
    { value: "acts", label: "Acts", count: linkedActs.length || undefined },
    { value: "court", label: "Court record" },
    { value: "timeline", label: "Timeline" },
  ];
  const activeTab: TabKey = tabs.some((t) => t.value === tab) ? tab : "overview";

  const copyCnr = async () => {
    if (await copyText(cnr)) success(`CNR ${cnr} copied.`);
    else error("Couldn't copy to clipboard.");
  };

  const openDocSummary = (d: any) => setSummaryDoc(d);

  // ---------- Row renderers ----------
  const eventWhen = (ev: any) => `${fmtDate(ev.date)}${ev.time ? `, ${fmtTime(ev.time)}` : ""}`;

  const eventRow = (ev: any, withBiz: boolean) => (
    <div className="list-item" key={ev.id} style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
      {ev.date ? <Stamp iso={ev.date} /> : <span className="stamp" aria-hidden="true"><span>—</span><b>?</b></span>}
      <div className="grow" style={{ minWidth: 180 }}>
        <div className="small" style={{ fontWeight: 500 }}>
          {ev.title}{" "}
          {ev.hearingDetail?.purpose && <Chip tone="info">{ev.hearingDetail.purpose}</Chip>}
          {ev.eventType !== "HEARING" && <Chip>{titleCase(ev.eventType)}</Chip>}
        </div>
        <div className="cs-sub">{eventWhen(ev)}{ev.date ? ` · ${relDay(ev.date)}` : ""}</div>
        {(ev.hearingDetail?.court || ev.hearingDetail?.benchHall || ev.hearingDetail?.judge) && (
          <div className="cs-sub">{[ev.hearingDetail.court, ev.hearingDetail.benchHall && `Hall ${ev.hearingDetail.benchHall}`, ev.hearingDetail.judge].filter(Boolean).join(" · ")}</div>
        )}
        {ev.hearingDetail?.nextDate && <div className="cs-sub">Next date: {fmtDate(ev.hearingDetail.nextDate)}</div>}
        {ev.hearingDetail?.outcome && <div className="cs-sub">Outcome: {ev.hearingDetail.outcome}</div>}
        {ev.description && <div className="cs-sub">{ev.description}</div>}
      </div>
      <div className="row wrap" style={{ gap: 4 }}>
        {withBiz && hearingBizByDate.has(ev.date) && (
          <Button size="sm" loading={hearingViewBusy === ev.id} onClick={() => viewHearingBusiness(ev)}>Daily status</Button>
        )}
        {canEventCreate && <Button size="sm" variant="ghost" icon="edit" onClick={() => editHearing(ev)}>Edit</Button>}
        {can("EVENT_DELETE") && <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={`Delete ${ev.title}`} onClick={() => deleteHearingEvent(ev.id)} />}
      </div>
    </div>
  );

  const taskRow = (t: any, full: boolean) => {
    const mine = (t.assignedById ?? t.createdById) === myId;
    const canToggle = hasPermission("TASK_EDIT") || t.assignedToId === myId;
    return (
      <div className={`cs-task${t.completed ? " done" : ""}${t.cancelled ? " cancelled" : ""}`} key={t.id}>
        <button type="button" className="cs-task-check" aria-pressed={!!t.completed} disabled={!canToggle}
          onClick={() => toggleTask(t.id)}
          aria-label={t.completed ? `Reopen ${t.title}` : `Mark ${t.title} done`}
          title={t.needsReview && t.assignedToId === myId && !t.completed ? "Submit for review" : "Mark done / reopen"}>
          {t.completed && <Icon name="check" size="sm" />}
        </button>
        <div className="grow">
          <div className="ttl">{t.title}{t.cancelled && <> <Chip>Cancelled</Chip></>}</div>
          <div className="cs-sub">
            {[t.assignedToName && `With ${t.assignedToName}`, t.deadline && `due ${fmtDate(t.deadline)}`].filter(Boolean).join(", ") || "No deadline"}
          </div>
          {full && <>
            <ReviewNote task={t} />
            <SubmissionHistory task={t} myId={myId} canAssign={hasPermission("TASK_ASSIGN")} toast={toast}
              onDone={() => { fetchTasks(); fetchSummary(); }} onViewDocument={previewDoc}
              onOpenDraft={() => navigate(DRAFTING.draft(t.draftSessionId))} />
            {t.documents?.length > 0 && (
              <div className="row wrap" style={{ gap: 4, marginTop: 6 }}>
                {t.documents.map((d: any) => (
                  <button type="button" key={d.id} className="cs-file-chip" onClick={() => previewDoc(d.id)} title={`View ${d.name}`}>
                    <Icon name="eye" size="sm" />{d.name}
                  </button>
                ))}
              </div>
            )}
          </>}
        </div>
        <div className="cs-task-side">
          <ReviewChip task={t} />
          {full && <>
            <SubmitWork task={t} myId={myId} toast={toast} caseId={Number(id)} onDone={() => { fetchTasks(); fetchSummary(); }} />
            <ReviewActions task={t} myId={myId} canAssign={hasPermission("TASK_ASSIGN")} toast={toast} onDone={() => { fetchTasks(); fetchSummary(); }} />
          </>}
          {/* Priority and cancel are the assigner's (the server enforces it). */}
          {full && mine ? (
            <select className="input" style={{ height: 28, width: "auto" }} aria-label={`Priority of ${t.title}`}
              value={t.priority || "MEDIUM"} onChange={(e) => changeTaskPriority(t.id, e.target.value)}>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          ) : <Chip tone={prioTone(t.priority || "MEDIUM")}>{titleCase(t.priority || "MEDIUM")}</Chip>}
          {full && t.draftSessionId && can("DRAFT_VIEW") && (
            <Button size="sm" variant="ghost" icon="eye" onClick={() => navigate(DRAFTING.draft(t.draftSessionId))}>Open draft</Button>
          )}
          {full && !t.completed && !t.cancelled && can("DRAFT_CREATE") && (
            <Button size="sm" variant="ghost" iconOnly icon="pen" aria-label={`Draft for ${t.title}`} title="Draft for this task"
              onClick={() => navigate(newDraftUrl({ caseId: Number(id), taskId: t.id }))} />
          )}
          {full && mine && (t.cancelled
            ? <Button size="sm" variant="ghost" iconOnly icon="restore" aria-label={`Restore ${t.title}`} title="Restore task" onClick={() => cancelTask(t.id, false)} />
            : <Button size="sm" variant="ghost" iconOnly icon="x" aria-label={`Cancel ${t.title}`} title="Cancel task" onClick={() => cancelTask(t.id, true)} />)}
        </div>
      </div>
    );
  };

  const docTable = (list: any[], kind: "docs" | "orders") => (
    <div className="table-wrap">
      <table className="t">
        <thead><tr>
          <th scope="col">Name</th>
          <th scope="col" className="hide-sm">{kind === "orders" ? "Details" : "Category"}</th>
          <th scope="col" className="hide-sm">{kind === "orders" ? "Uploaded" : "Version"}</th>
          <th scope="col"><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody>
          {list.map((d) => (
            <tr key={d.id}>
              <td>
                <button type="button" className="link" style={{ background: "none", border: 0, padding: 0, textAlign: "left", font: "inherit", cursor: "pointer" }}
                  onClick={() => previewDoc(d.id)}>
                  <span className="row" style={{ gap: 6 }}><Icon name="file" size="sm" />{d.documentName}</span>
                </button>
              </td>
              <td className="hide-sm small">{kind === "orders" ? (d.description || "Order") : (d.category || "Other")}</td>
              <td className="hide-sm small">{kind === "orders" ? fmtDate(d.uploadDate) : <span className="mono xs">v{d.version > 1 ? d.version : 1}</span>}</td>
              <td className="right nowrap">
                <Button size="sm" variant="ghost" iconOnly icon="eye" aria-label={`Preview ${d.documentName}`} title="Preview" onClick={() => previewDoc(d.id)} />
                {kind === "docs" && <Button size="sm" variant="ghost" icon="sparkle" onClick={() => openDocSummary(d)}><span className="hide-sm">Summary</span></Button>}
                <Button size="sm" variant="ghost" iconOnly icon="download" aria-label={`Download ${d.documentName}`} title="Download"
                  onClick={() => downloadDoc(d.id, kind === "docs" ? (d.originalName || d.documentName) : d.documentName)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const nothing = (text: string) => <p className="faint small" style={{ padding: "var(--s3) var(--s5)" }}>{text}</p>;

  return (
    <div className="cs-root">
      {/* ---------- Docket cover ---------- */}
      <header className="docket">
        <div className="row wrap" style={{ gap: "var(--s3)" }}>
          <span className="no">{summary.caseNumber}</span>
          <span className="faint xs">CNR</span><span className="mono xs">{cnr || "Not available"}</span>
          {cnr && <Button size="sm" variant="ghost" iconOnly icon="copy" aria-label="Copy CNR" onClick={copyCnr} />}
        </div>
        <h1>
          {titleParts.length === 2
            ? <>{titleParts[0]}<span className="vs">vs</span>{titleParts[1]}</>
            : (summary.caseTitle || summary.caseNumber)}
        </h1>
        <div className="meta-line">
          {summary.courtLevel && <span><Icon name="gavel" size="sm" />{summary.courtLevel} court</span>}
          {summary.caseType && <span><Icon name="file" size="sm" />{summary.caseType}</span>}
          {summary.clientName && <span><Icon name="user" size="sm" />Client: {summary.clientName}</span>}
          {can("INVOICE_VIEW") && <span title="Total invoiced for this case"><Icon name="rupee" size="sm" />{formatCurrency(financials?.totals?.totalInvoiced || 0)} invoiced</span>}
        </div>
        {otherIdentity.length > 0 && (
          <dl className="cs-court-strip">
            {otherIdentity.map((it) => (
              <div key={it.label}><dt>{it.label}</dt><dd>{it.value}</dd></div>
            ))}
          </dl>
        )}
        <div className="row wrap" style={{ marginTop: "var(--s4)", gap: 6 }}>
          <StatusChip status={summary.status || "—"} />
          {(summary.tags || []).map((t) => (
            <span key={t.id} className={`tag${HOT_TAGS.includes(t.label) ? " hot" : ""}`}>
              {t.label}
              {canEdit && <button type="button" onClick={() => removeTag(t.id)} aria-label={`Remove tag ${t.label}`}><Icon name="x" size="sm" /></button>}
            </span>
          ))}
          {canEdit && (
            <button type="button" className="filter-chip" style={{ height: 22 }} aria-haspopup="menu"
              onClick={(e) => setTagAnchor(tagAnchor ? null : e.currentTarget)}>
              <Icon name="plus" size="sm" />Add tag
            </button>
          )}
        </div>
        <div className="row wrap cs-docket-acts" style={{ gap: "var(--s2)" }}>
          {canEventCreate && <Button variant="primary" icon="calendar" onClick={() => openHearingModal("hearing")}>Add hearing</Button>}
          {can("DRAFT_CREATE") && <Button icon="pen" onClick={() => navigate(newDraftUrl({ caseId: Number(id) }))}>Draft for this case</Button>}
          {can("INVOICE_CREATE") && <Button icon="receipt" onClick={() => setShowInvoiceModal(true)}>Raise invoice</Button>}
          {showMore && (
            <Button variant="ghost" iconOnly icon="more" aria-label={refreshing ? "Refreshing court data" : "More actions"} aria-haspopup="menu"
              loading={refreshing} disabled={refreshing} onClick={(e) => setMoreAnchor(moreAnchor ? null : e.currentTarget)} />
          )}
          {refreshing && <Spinner label="Refreshing the court record" />}
        </div>
      </header>
      {moreAnchor && <PopMenu anchor={moreAnchor} items={moreItems} onClose={() => setMoreAnchor(null)} width={240} />}
      {tagAnchor && (
        <PopMenu anchor={tagAnchor} width={220} onClose={() => setTagAnchor(null)}
          items={(() => {
            const avail = TAG_OPTIONS.filter((t) => !(summary.tags || []).some((x) => x.label === t));
            return avail.length
              ? avail.map((t) => ({ label: t, icon: "tag" as const, onClick: () => addTag(t) }))
              : [{ label: "All tags are already on this case", onClick: () => {} }];
          })()} />
      )}

      <div className="split" style={{ marginTop: "var(--s6)" }}>
        <div style={{ minWidth: 0 }}>
          <div id="case-tabs">
            <Tabs label="Case sections" value={activeTab} onChange={(v) => setTab(v as TabKey)} tabs={tabs} />
          </div>

          {/* ---------- OVERVIEW ---------- */}
          {activeTab === "overview" && (
            <div className="cs-sec-gap">
              <Panel title="About this case">
                {summary.description ? <p>{summary.description}</p> : <p className="faint">No description yet.</p>}
                <dl className="kv" style={{ marginTop: "var(--s4)" }}>
                  <dt>Title</dt>
                  <dd><InlineEdit label="title" value={summary.caseTitle} display={summary.caseTitle || summary.caseNumber}
                    onSave={(v) => patchCase({ caseTitle: v })} /></dd>
                  <dt>Case number</dt><dd className="mono">{summary.caseNumber}</dd>
                  <dt>Status</dt>
                  <dd><InlineEdit label="status" value={summary.status} display={<StatusChip status={summary.status || "—"} />} type="select" options={STATUS_SELECT}
                    onSave={(v) => patchCase({ status: v })} /></dd>
                  <dt>Case type</dt>
                  <dd><InlineEdit label="case type" value={summary.caseType} display={summary.caseType || "—"}
                    onSave={(v) => patchCase({ caseType: v })} /></dd>
                  <dt>Court</dt>
                  <dd><InlineEdit label="court" value={summary.courtLevel} display={summary.courtLevel || "—"}
                    onSave={(v) => patchCase({ courtLevel: v })} /></dd>
                  <dt>Client</dt>
                  <dd><InlineEdit label="client" value={summary.clientId ?? ""} display={summary.clientName || "—"}
                    type="select" onStart={fetchClients}
                    options={[{ value: "", label: "— None —" },
                      ...(summary.clientId && !clients.some((c) => c.id === summary.clientId)
                        ? [{ value: String(summary.clientId), label: summary.clientName || `Client #${summary.clientId}` }] : []),
                      ...clients.map((c) => ({ value: String(c.id), label: c.name }))]}
                    onSave={(v) => patchCase({ clientId: v === "" ? null : Number(v) })} /></dd>
                </dl>
              </Panel>

              {can("EVENT_VIEW") && (
                <Panel title="Coming up" flush actions={<Button size="sm" variant="ghost" onClick={() => goTab("hearings")}>All hearings</Button>}>
                  {events.filter((ev) => !ev.date || ev.date >= _todayISO).length
                    ? <div className="list">{events.filter((ev) => !ev.date || ev.date >= _todayISO).slice(0, 3).map((ev) => eventRow(ev, true))}</div>
                    : nothing(summary.status === "Closed" ? "Nothing listed. This case is closed." : "Nothing listed. Add a hearing when the court gives a date.")}
                </Panel>
              )}

              <div className="cols g-2">
                <Panel title="Last hearings" actions={hearingHistory.length > 0 && <Button size="sm" variant="ghost" onClick={() => goTab("hearings")}>History</Button>}>
                  {hearingHistory.length ? (
                    <div className="timeline">
                      {hearingHistory.slice(-3).reverse().map((h, i) => (
                        <div key={i} className={`tl-item${i === 0 ? " key" : ""}`}>
                          <div className="small">{h.purpose || "Listed"}</div>
                          <div className="when">{h.hearingDate || h.businessDate || "—"}{h.judge ? `, ${h.judge}` : ""}</div>
                        </div>
                      ))}
                    </div>
                  ) : <p className="faint small">No court hearings on record yet.</p>}
                </Panel>
                {can("TASK_VIEW") ? (
                  <Panel title="Open tasks" flush actions={<Button size="sm" variant="ghost" icon={can("TASK_CREATE") ? "plus" : undefined} onClick={() => goTab("tasks")}>{can("TASK_CREATE") ? "Add" : "All tasks"}</Button>}>
                    {openTasks.length ? openTasks.slice(0, 4).map((t) => taskRow(t, false)) : nothing("Nothing open on this case.")}
                  </Panel>
                ) : <div />}
              </div>

              {can("DOCUMENT_VIEW") && (
                <Panel title="Recent documents" flush actions={<Button size="sm" variant="ghost" onClick={() => goTab("docs")}>All documents</Button>}>
                  {docs.length ? (
                    <div className="list">
                      {docs.slice(0, 4).map((d) => (
                        <button type="button" key={d.id} className="list-item" onClick={() => previewDoc(d.id)} style={{ font: "inherit", color: "inherit", cursor: "pointer" }}>
                          <Icon name="file" size="sm" /><span className="grow ellipsis small">{d.documentName}</span>
                          <span className="faint xs">{d.category || "Other"}</span>
                        </button>
                      ))}
                    </div>
                  ) : nothing("No documents yet.")}
                </Panel>
              )}

              {notes.length > 0 && (
                <Panel title="Latest note" actions={<Button size="sm" variant="ghost" onClick={() => goTab("notes")}>All notes</Button>}>
                  <p className="small" style={{ whiteSpace: "pre-wrap" }}>{notes[0].body}</p>
                  <div className="faint xs" style={{ marginTop: 6 }}>{new Date(notes[0].createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                </Panel>
              )}
            </div>
          )}

          {/* ---------- PARTIES ---------- */}
          {activeTab === "parties" && (
            <div className="cs-sec-gap">
              {parties.length ? (
                <div className="table-wrap">
                  <table className="t">
                    <thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col" className="hide-sm">Counsel</th><th scope="col" className="hide-sm">Contact</th><th scope="col"><span className="sr-only">Side and actions</span></th></tr></thead>
                    <tbody>
                      {parties.map((p) => (
                        <tr key={p.id}>
                          <td>{p.name}</td>
                          <td>{p.role || "—"}</td>
                          <td className="hide-sm">{p.counsel || "—"}</td>
                          <td className="hide-sm">{p.contact || "—"}</td>
                          <td className="right nowrap">
                            {p.isOpponent ? <Chip tone="bad">Opponent</Chip> : <Chip tone="info">Our side</Chip>}
                            {canEdit && <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={`Remove ${p.name}`} onClick={() => deleteParty(p.id)} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState icon="users" title="No parties yet" text="Add the petitioners, respondents and their counsel." />}
              {canEdit && (
                <Panel title="Add a party">
                  <form className="form-grid" noValidate onSubmit={(e) => { e.preventDefault(); addParty(); }}>
                    <TextField label="Name" required value={partyForm.name} onChange={(e) => setPartyForm({ ...partyForm, name: e.target.value })} />
                    <SelectField label="Role" placeholder="Select a role" options={PARTY_ROLES} value={partyForm.role}
                      onChange={(e) => setPartyForm({ ...partyForm, role: e.target.value })} />
                    <TextField label="Counsel" placeholder="Optional" value={partyForm.counsel} onChange={(e) => setPartyForm({ ...partyForm, counsel: e.target.value })} />
                    <TextField label="Contact" placeholder="Optional" value={partyForm.contact} onChange={(e) => setPartyForm({ ...partyForm, contact: e.target.value })} />
                    <div className="row" style={{ alignSelf: "end", gap: "var(--s4)" }}>
                      <Check label="Opponent" checked={partyForm.isOpponent} onChange={(e) => setPartyForm({ ...partyForm, isOpponent: e.target.checked })} />
                      <Button type="submit" variant="primary" icon="plus">Add party</Button>
                    </div>
                  </form>
                </Panel>
              )}
            </div>
          )}

          {/* ---------- HEARINGS ---------- */}
          {activeTab === "hearings" && (
            <div className="cs-sec-gap">
              <Panel title="Upcoming" sub={`${hearingEvents.length} listed`} flush
                actions={canEventCreate && <Button size="sm" icon="plus" onClick={() => openHearingModal("hearing")}>Add hearing</Button>}>
                {hearingEvents.length
                  ? <div className="list">{hearingEvents.map((ev) => eventRow(ev, true))}</div>
                  : nothing("No upcoming hearings. Add one here; past court hearings appear under Court hearing history below.")}
              </Panel>

              {/* Court hearing/listing history from the imported record (Provakil "Listings"). */}
              {hearingHistory.length > 0 && (
                <div>
                  <div className="section-title" style={{ marginTop: 0 }}><h2>Court hearing history</h2><span className="faint xs">From court records · {hearingHistory.length}</span></div>
                  <div className="table-wrap">
                    <table className="t">
                      <thead><tr>
                        <th scope="col">Hearing date</th>
                        <th scope="col" className="hide-sm">Business date</th>
                        <th scope="col" className="hide-sm">Cause list</th>
                        <th scope="col" className="hide-sm">Judge / bench</th>
                        <th scope="col">Purpose</th>
                        <th scope="col"><span className="sr-only">Actions</span></th>
                      </tr></thead>
                      <tbody>
                        {hearingHistory.map((h, i) => (
                          <tr key={i}>
                            <td className="nowrap">{h.hearingDate || "—"}</td>
                            <td className="hide-sm nowrap">{h.businessDate || "—"}</td>
                            <td className="hide-sm small">{h.causeList || "—"}</td>
                            <td className="hide-sm small">{h.judge || "—"}</td>
                            <td className="small">{h.purpose || "—"}</td>
                            <td className="right">
                              <div className="row wrap" style={{ gap: 2, justifyContent: "flex-end" }}>
                                {((h.businessDetail && Object.keys(h.businessDetail.fields || {}).length) || (h.business && h.businessDate)) ? (
                                  <Button size="sm" loading={hearingViewBusy === `h${i}`} onClick={() => viewHistoryBusiness(h, i)}>Daily status</Button>
                                ) : null}
                                <Button size="sm" variant="ghost" iconOnly icon="copy" aria-label="Copy listing" title="Copy listing" onClick={() => copyHearing(h)} />
                                {canEventCreate && (
                                  <Button size="sm" variant="ghost" icon="send" loading={alertBusy === `a${i}`}
                                    title={summary.clientId ? "Email this hearing to the client" : "No client email on this case"}
                                    disabled={!summary.clientId || alertBusy === `a${i}`} onClick={() => alertClient(h, i)}>
                                    <span className="hide-sm">Alert client</span>
                                  </Button>
                                )}
                                {can("INVOICE_CREATE") && (
                                  <Button size="sm" variant="ghost" iconOnly icon="receipt" aria-label="Raise invoice for this hearing" title="Raise invoice"
                                    onClick={() => { prefillInvoiceFromHearing(i); setShowInvoiceModal(true); }} />
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {courtRecordLoading && <Spinner label="Loading the court record" />}
            </div>
          )}

          {/* ---------- EVENTS ---------- */}
          {activeTab === "events" && (
            <Panel title="Meetings and reminders" sub={`${otherEvents.length}`} flush
              actions={canEventCreate && <Button size="sm" icon="plus" onClick={() => openHearingModal("event")}>Add event</Button>}>
              {otherEvents.length
                ? <div className="list">{otherEvents.map((ev) => eventRow(ev, false))}</div>
                : nothing("No meetings, payment-due or document reminders for this case yet.")}
            </Panel>
          )}

          {/* ---------- ORDERS ---------- */}
          {activeTab === "orders" && (
            <div className="cs-sec-gap">
              <div className="row wrap">
                <p className="muted small grow">Orders and judgments passed in this case. Court PDFs are fetched live from the court and downloaded to your device.</p>
                {can("DOCUMENT_UPLOAD") && <Button size="sm" icon="upload" onClick={() => setShowUploadOrder(true)}>Upload order</Button>}
              </div>
              {courtRecordLoading && <Spinner label="Loading the court record" />}
              {!courtRecordLoading && orders.length > 0 && (
                <div className="table-wrap">
                  <table className="t">
                    <thead><tr><th scope="col">#</th><th scope="col">Order date</th><th scope="col">Details</th><th scope="col" className="hide-sm">Judge</th><th scope="col"><span className="sr-only">Document</span></th></tr></thead>
                    <tbody>
                      {orders.map((o, i) => (
                        <tr key={i}>
                          <td className="mono small">{o.number || i + 1}</td>
                          <td className="nowrap">{o.date || "—"}</td>
                          <td className="small">{o.details || "—"}</td>
                          <td className="hide-sm small">{o.judge || "—"}</td>
                          <td className="right">
                            {o.pdf && o.pdf.filename ? (
                              <Button size="sm" icon="download" disabled={orderDlBusy === i} loading={orderDlBusy === i} onClick={() => downloadOrderPdf(o, i)}>
                                {orderDlBusy === i ? "Fetching…" : "PDF"}
                              </Button>
                            ) : o.pdfUrl ? (
                              <Button size="sm" icon="download" disabled={orderDlBusy === i} loading={orderDlBusy === i} onClick={() => downloadOrderPdfByUrl(o, i)}>
                                {orderDlBusy === i ? "Fetching…" : "PDF"}
                              </Button>
                            ) : <span className="faint">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!courtRecordLoading && courtRecordLoaded && orders.length === 0 && uploadedOrders.length === 0 && (
                <EmptyState icon="gavel" title="No orders yet" text="None on the court record. Upload interim orders and judgments as the court passes them." />
              )}
              {uploadedOrders.length > 0 && (
                <div>
                  <h3 style={{ fontSize: "var(--t-md)", marginBottom: "var(--s2)" }}>Uploaded orders</h3>
                  {docTable(uploadedOrders, "orders")}
                </div>
              )}
            </div>
          )}

          {/* ---------- DOCUMENTS ---------- */}
          {activeTab === "docs" && (
            <div className="cs-sec-gap">
              {can("DOCUMENT_UPLOAD") && (
                <div className="row wrap">
                  <p className="muted small grow">Everything filed on this case. Open a summary for a quick read.</p>
                  <label className="btn sm cs-file-btn">
                    <Icon name="upload" size="sm" />
                    <span className="ellipsis" style={{ maxWidth: 220 }}>{uploadFile ? uploadFile.name : "Choose file"}</span>
                    <input type="file" accept={DOCUMENT_ACCEPT} aria-label="Choose a file to upload" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
                  </label>
                  <Button size="sm" variant="primary" icon="upload" onClick={uploadDoc} disabled={!uploadFile}>Upload</Button>
                </div>
              )}
              {docs.length ? docTable(docs, "docs") : <EmptyState icon="folder" title="No documents yet" text="Upload the plaint, affidavits and evidence for this case." />}
            </div>
          )}

          {/* ---------- TASKS ---------- */}
          {activeTab === "tasks" && (
            <div className="cs-sec-gap">
              {can("TASK_CREATE") && (
                <Panel title="Add a task">
                  <form className="form-grid" noValidate onSubmit={(e) => { e.preventDefault(); addTask(); }}>
                    <TextField label="Task" required full placeholder="e.g. Draft the written statement" value={newTask.title}
                      onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} />
                    <SelectField label="Priority" options={PRIORITIES} value={newTask.priority}
                      onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })} />
                    <TextField label="Deadline" type="date" min={todayISO()} error={taskDeadlineError} value={newTask.deadline}
                      onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })} />
                    {can("TASK_ASSIGN") && (
                      <SelectField label="Assign to" options={[{ value: "", label: "Myself" }, ...assignees.map((a) => ({ value: String(a.id), label: a.fullName || a.email }))]}
                        value={String(newTask.assignedTo ?? "")} onChange={(e) => setNewTask({ ...newTask, assignedTo: e.target.value })} />
                    )}
                    {can("DOCUMENT_UPLOAD") && <>
                      <Field label="Documents" hint={taskFiles.length ? `${taskFiles.length} file(s) chosen` : "Optional"}>
                        {(fid, d) => <input id={fid} aria-describedby={d} type="file" accept={DOCUMENT_ACCEPT} multiple className="input"
                          onChange={(e) => setTaskFiles(Array.from(e.target.files || []))} />}
                      </Field>
                      <SelectField label="Document category" placeholder="Select category" options={DOC_CATEGORIES} value={newTask.category}
                        onChange={(e) => setNewTask({ ...newTask, category: e.target.value })} />
                    </>}
                    <div className="row full"><span className="grow" /><Button type="submit" variant="primary" icon="plus" disabled={!newTask.title.trim()}>Add task</Button></div>
                  </form>
                </Panel>
              )}
              <p className="muted small">{tasks.filter((t) => !t.completed && !t.cancelled).length} open, {tasks.filter((t) => t.completed).length} done.</p>
              {tasks.length ? (
                <div className="panel"><div className="panel-body flush" style={{ paddingBottom: "var(--s2)" }}>{tasks.map((t) => taskRow(t, true))}</div></div>
              ) : <EmptyState icon="tasks" title="No tasks" text="Assign research, drafting or filing work to the team." />}
            </div>
          )}

          {/* ---------- BILLING ---------- */}
          {activeTab === "billing" && (
            <div className="cs-sec-gap">
              {!financials ? <Skel h={90} /> : (
                <div className="figures">
                  {can("INVOICE_VIEW") && <>
                    <div className="figure"><div className="lbl">Invoiced</div><div className="val">{formatCurrency(totals.totalInvoiced || 0)}</div><div className="meta">{totals.invoiceCount ?? 0} invoices</div></div>
                    <div className="figure"><div className="lbl">Paid</div><div className="val">{formatCurrency(totals.totalPaid || 0)}</div></div>
                    <div className="figure"><div className="lbl">Unpaid</div><div className="val">{formatCurrency(totals.totalUnpaid || 0)}</div></div>
                  </>}
                  {can("EXPENSE_VIEW") && <div className="figure"><div className="lbl">Expenses</div><div className="val">{formatCurrency(totals.totalExpenses || 0)}</div><div className="meta">{totals.expenseCount ?? 0} entries</div></div>}
                </div>
              )}
              <div className="row wrap">
                {can("INVOICE_CREATE") && <Button icon="receipt" onClick={() => setShowInvoiceModal(true)}>Raise invoice</Button>}
                {can("EXPENSE_CREATE") && <Button icon="wallet" onClick={() => setShowExpenseModal(true)}>Add expense</Button>}
              </div>
              {financials && can("INVOICE_VIEW") && (
                <div>
                  <h3 style={{ fontSize: "var(--t-md)", marginBottom: "var(--s2)" }}>Invoices</h3>
                  {financials.invoices.length ? (
                    <div className="table-wrap">
                      <table className="t">
                        <thead><tr><th scope="col">Invoice</th><th scope="col" className="hide-sm">Issued</th><th scope="col" className="hide-sm">Due</th><th scope="col" className="right">Amount</th><th scope="col">Status</th></tr></thead>
                        <tbody>
                          {financials.invoices.map((inv) => (
                            <tr key={inv.id}>
                              <td>
                                <div className="mono small">{inv.invoiceNumber}</div>
                                <div className="cs-sub">
                                  {[inv.raisedByName && `Raised by ${inv.raisedByName}`,
                                    inv.handledByName && inv.handledByName !== inv.raisedByName && `Handled by ${inv.handledByName}`,
                                    inv.paidAmount > 0 && inv.balance > 0 && `${formatCurrency(inv.balance)} still due`].filter(Boolean).join(" · ")}
                                </div>
                              </td>
                              <td className="hide-sm nowrap">{fmtDate(inv.invoiceDate)}</td>
                              <td className="hide-sm nowrap">{fmtDate(inv.dueDate)}</td>
                              <td className="mono right nowrap">{formatCurrency(inv.amount || 0)}</td>
                              <td><StatusChip status={inv.status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="faint small">No invoices for this case yet. Raise one here or from Invoices; it maps to this case automatically.</p>}
                </div>
              )}
              {financials && can("PAYMENT_VIEW") && (financials.payments || []).length > 0 && (
                <div>
                  <h3 style={{ fontSize: "var(--t-md)", marginBottom: "var(--s2)" }}>Payments</h3>
                  <div className="table-wrap">
                    <table className="t">
                      <thead><tr><th scope="col">Date</th><th scope="col">Mode</th><th scope="col" className="hide-sm">Reference</th><th scope="col" className="right">Amount</th></tr></thead>
                      <tbody>
                        {financials.payments.map((p: any) => (
                          <tr key={p.id}>
                            <td className="nowrap">{fmtDate(p.paymentDate || p.date)}</td>
                            <td>{titleCase(p.paymentMode || p.mode || "—")}</td>
                            <td className="hide-sm mono xs">{p.referenceNumber || p.reference || "—"}</td>
                            <td className="mono right nowrap">{formatCurrency(p.amount || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {financials && can("EXPENSE_VIEW") && (
                <div>
                  <h3 style={{ fontSize: "var(--t-md)", marginBottom: "var(--s2)" }}>Expenses</h3>
                  {financials.expenses.length ? (
                    <div className="table-wrap">
                      <table className="t">
                        <thead><tr><th scope="col">Date</th><th scope="col">For</th><th scope="col" className="hide-sm">Category</th><th scope="col" className="hide-sm">Status</th><th scope="col" className="right">Amount</th></tr></thead>
                        <tbody>
                          {financials.expenses.map((exp) => (
                            <tr key={exp.id}>
                              <td className="nowrap">{fmtDate(exp.paymentDate)}</td>
                              <td>{exp.title}</td>
                              <td className="hide-sm">{exp.category || "—"}</td>
                              <td className="hide-sm">{exp.paymentStatus ? <StatusChip status={exp.paymentStatus} /> : "—"}</td>
                              <td className="mono right nowrap">{formatCurrency(exp.amount || 0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="faint small">No expenses for this case yet. Add one here or from Expenses; it maps to this case automatically.</p>}
                </div>
              )}
            </div>
          )}

          {/* ---------- NOTES ---------- */}
          {activeTab === "notes" && (
            <div className="cs-sec-gap">
              {canEdit && (
                <form className="panel" noValidate onSubmit={(e) => { e.preventDefault(); addNote(); }}>
                  <div className="panel-body stack" style={{ gap: "var(--s3)" }}>
                    <TextArea label="Add a note" rows={3} placeholder="A case diary entry. Only your team can see notes."
                      value={newNote} onChange={(e) => setNewNote(e.target.value)} />
                    <div className="row"><span className="grow" /><Button type="submit" size="sm" variant="primary" disabled={!newNote.trim()}>Add note</Button></div>
                  </div>
                </form>
              )}
              <div className="panel"><div className="panel-body" style={{ paddingBlock: "var(--s2)" }}>
                {notes.length ? notes.map((n) => (
                  <div className="cs-note" key={n.id}>
                    <div className="row">
                      <Icon name="note" size="sm" />
                      <span className="faint xs grow">{new Date(n.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                      {canEdit && <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label="Delete note"
                        onClick={async () => { if (await confirmAsync("This note will be removed from the case diary.", "Delete this note?", "Delete")) deleteNote(n.id); }} />}
                    </div>
                    <p className="small" style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{n.body}</p>
                  </div>
                )) : <p className="faint small" style={{ padding: "var(--s3) 0" }}>No notes yet.</p>}
              </div></div>
            </div>
          )}

          {/* ---------- RELATED CASES ---------- */}
          {activeTab === "related" && (
            <div className="cs-sec-gap">
              <p className="muted small">Appeals and connected matters, linked so the file stays together.</p>
              {related.length ? (
                <div className="table-wrap">
                  <table className="t">
                    <thead><tr><th scope="col">Case</th><th scope="col">Relation</th><th scope="col" className="hide-sm">Note</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                    <tbody>
                      {related.map((r) => (
                        <tr key={`${r.direction}-${r.id}`} className={r.linkedCaseId ? "clickable" : undefined}
                          onClick={() => r.linkedCaseId && navigate(`/dashboard/cases/${r.linkedCaseId}`)}>
                          <td>
                            <div className="mono small">{r.caseNumber || `Case #${r.linkedCaseId}`}</div>
                            <div className="cs-sub">{r.caseTitle || ""}</div>
                          </td>
                          <td>{r.relation ? <span className="tag">{r.relation}</span> : "—"}</td>
                          <td className="hide-sm small">{r.note || "—"}</td>
                          <td className="right">
                            {canEdit && <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={`Unlink ${r.caseNumber || "case"}`}
                              onClick={(e) => { e.stopPropagation(); deleteRelated(r.id); }} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState icon="link" title="No related cases" text="Link appeals and connected matters for this client." />}
              {canEdit && (
                <Panel title="Link a case">
                  <form className="form-grid" noValidate onSubmit={(e) => { e.preventDefault(); addRelated(); }}>
                    <SelectField label="Case" required full placeholder="Select a case to link…" value={relatedForm.relatedCaseId}
                      options={linkableCases.map((c) => ({ value: String(c.id), label: `${c.caseNumber} — ${c.caseTitle}` }))}
                      onChange={(e) => setRelatedForm({ ...relatedForm, relatedCaseId: e.target.value })} />
                    <SelectField label="Relation" placeholder="Select" options={RELATION_TYPES} value={relatedForm.relation}
                      onChange={(e) => setRelatedForm({ ...relatedForm, relation: e.target.value })} />
                    <TextField label="Note" placeholder="Optional" value={relatedForm.note} onChange={(e) => setRelatedForm({ ...relatedForm, note: e.target.value })} />
                    <div className="row full"><span className="grow" /><Button type="submit" variant="primary" icon="link">Link case</Button></div>
                  </form>
                </Panel>
              )}
            </div>
          )}

          {/* ---------- ACTS ---------- */}
          {activeTab === "acts" && (
            <div className="cs-sec-gap">
              <p className="muted small">Provisions this case is argued under. Linked acts open in Bare Acts.</p>
              <div className="row wrap" style={{ gap: 6 }}>
                {linkedActs.length ? linkedActs.map((a) => (
                  <span key={a.id} className="tag">
                    <Icon name="book" size="sm" />
                    <a className="link" href={`/dashboard/acts/${a.actId}`} onClick={(e) => { e.preventDefault(); navigate(`/dashboard/acts/${a.actId}`); }}>
                      {a.actTitle || `Act #${a.actId}`}
                    </a>
                    {[a.actNumber && `No. ${a.actNumber}`, a.actYear, a.jurisdiction].filter(Boolean).length > 0 &&
                      <span className="faint">{[a.actNumber && `No. ${a.actNumber}`, a.actYear, a.jurisdiction].filter(Boolean).join(" · ")}</span>}
                    {canEdit && <button type="button" onClick={() => deleteAct(a.actId)} aria-label={`Unlink ${a.actTitle || "act"}`}><Icon name="x" size="sm" /></button>}
                  </span>
                )) : <span className="faint small">No acts linked to this case yet.</span>}
              </div>
              {canEdit && (
                <Panel title="Link an act">
                  <div className="stack" style={{ gap: "var(--s2)" }}>
                    <SearchInput value={selectedAct ? selectedAct.label : actQuery} placeholder="Search acts to link…" aria-label="Search acts to link"
                      onChange={(v) => { setSelectedAct(null); setActQuery(v); }} />
                    {!selectedAct && actQuery.trim() && (
                      <div className="cs-act-results" role="listbox" aria-label="Matching acts">
                        {actSuggestions.length ? actSuggestions.slice(0, 30).map((o) => (
                          <button type="button" role="option" aria-selected={false} key={o.value} onClick={() => setSelectedAct(o)}>{o.label}</button>
                        )) : <p className="faint small" style={{ padding: "8px 12px" }}>No matching acts.</p>}
                      </div>
                    )}
                    <div className="row">
                      <span className="grow" />
                      {selectedAct && <Button variant="ghost" size="sm" onClick={() => { setSelectedAct(null); setActQuery(""); }}>Clear</Button>}
                      <Button variant="primary" icon="plus" loading={linkingAct} disabled={!selectedAct || typeof selectedAct !== "object" || linkingAct}
                        onClick={async () => { await addAct(); setActQuery(""); }}>{linkingAct ? "Linking…" : "Link act"}</Button>
                    </div>
                  </div>
                </Panel>
              )}

              {/* Acts cited by the court on the imported record. Matched ones link
                  to our library and can be added to Linked Acts in one click. */}
              {citedActs.length > 0 && (
                <Panel title="Cited by the court" flush>
                  <div className="list">
                    {citedActs.map((a, i) => {
                      const alreadyLinked = a.actId && linkedActs.some((l) => l.actId === a.actId);
                      return (
                        <div className="list-item" key={i}>
                          <Icon name="book" size="sm" />
                          <div className="grow" style={{ minWidth: 0 }}>
                            {a.actId ? (
                              <a className="link small" href={`/dashboard/acts/${a.actId}`} onClick={(e) => { e.preventDefault(); navigate(`/dashboard/acts/${a.actId}`); }}>{a.actTitle}</a>
                            ) : <span className="small">{a.name} <Chip>Not in library</Chip></span>}
                            <div className="cs-sub">
                              {a.section ? `Section ${a.section}` : ""}
                              {a.actId && a.name !== a.actTitle ? `${a.section ? " · " : ""}cited as “${a.name}”` : ""}
                            </div>
                          </div>
                          {a.actId && (alreadyLinked
                            ? <Chip tone="ok" title="Already in Linked Acts">Linked</Chip>
                            : canEdit && <Button size="sm" icon="plus" title="Add to Linked Acts" onClick={() => linkCitedAct(a.actId)}>Link</Button>)}
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              )}
            </div>
          )}

          {/* ---------- COURT RECORD (extra details) ---------- */}
          {activeTab === "court" && (
            <div className="cs-sec-gap">
              {courtRecordLoading && <Spinner label="Loading the court record" />}
              {!courtRecordLoading && courtRecord && (
                <>
                  <p className="muted small">Further details from the imported court record. Key fields (CNR, filing, status, category, dates) are on the cover above; parties, hearings, orders and cited acts have their own tabs.</p>
                  <CaseExtraDetails record={courtRecord} courtId={courtRecordCourtId} />
                </>
              )}
              {!courtRecordLoading && courtRecordLoaded && !courtRecord && (
                <EmptyState icon="gavel" title="No court record imported"
                  text="This case was added by hand, or before import was available."
                  action={canEdit ? <Button variant="primary" icon="link" onClick={openLink}>Link to court record</Button> : undefined} />
              )}
            </div>
          )}

          {/* ---------- TIMELINE ---------- */}
          {activeTab === "timeline" && <CaseTimeline caseId={summary.id} caseNumber={summary.caseNumber} />}
        </div>

        {/* ---------- Summary rail ---------- */}
        <aside className="rail stack" style={{ gap: "var(--s4)" }} aria-label="Case summary">
          <Panel title={next && next.eventType !== "HEARING" ? "Coming up" : "Next hearing"} actions={nd === 0 ? <Chip tone="tape">Today</Chip> : undefined}>
            {next ? <>
              <div className="cs-big-date">{new Date(`${next.date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long" })}</div>
              <div className="muted small" style={{ margin: "4px 0 var(--s3)" }}>
                {new Date(`${next.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "long" })}
                {next.time ? `, ${fmtTime(next.time)}` : ""}. <span className={nd === 0 ? "cs-today" : ""}>{relDay(next.date)}</span>
              </div>
              <dl className="kv">
                <dt>What</dt><dd>{next.title}</dd>
                {next.eventType !== "HEARING" && <><dt>Type</dt><dd>{titleCase(next.eventType)}</dd></>}
                {next.hearingDetail?.benchHall && <><dt>Hall</dt><dd>{next.hearingDetail.benchHall}</dd></>}
                {next.hearingDetail?.purpose && <><dt>Purpose</dt><dd>{next.hearingDetail.purpose}</dd></>}
              </dl>
              {can("EVENT_VIEW") && <div className="row wrap" style={{ marginTop: "var(--s4)" }}><Button size="sm" icon="calendar" onClick={() => goTab(next.eventType === "HEARING" ? "hearings" : "events")}>View</Button></div>}
            </> : <p className="faint small">Nothing listed. {summary.status === "Closed" ? "The case is closed." : ""}</p>}
          </Panel>

          {canBilling && (
            <Panel title="Fees" actions={<Button size="sm" variant="ghost" onClick={() => goTab("billing")}>Billing</Button>}>
              {!financials ? <Skel h={50} /> : <>
                {can("INVOICE_VIEW") && <>
                  <div className="row between small"><span className="muted">Paid</span><span className="mono">{formatCurrency(totals.totalPaid || 0)} of {formatCurrency(totals.totalInvoiced || 0)}</span></div>
                  <div className="meter" style={{ margin: "8px 0" }} role="progressbar" aria-valuenow={paidPct} aria-valuemin={0} aria-valuemax={100} aria-label="Invoiced amount paid">
                    <i style={{ width: `${paidPct}%`, background: paidPct >= 100 ? "var(--ok)" : "var(--ink)" }} />
                  </div>
                  <div className="row between small"><span className="muted">Unpaid</span><b className="mono">{formatCurrency(totals.totalUnpaid || 0)}</b></div>
                </>}
                {can("EXPENSE_VIEW") && <div className="row between small" style={{ marginTop: 6 }}><span className="muted">Expenses</span><span className="mono">{formatCurrency(totals.totalExpenses || 0)}</span></div>}
              </>}
            </Panel>
          )}

          <Panel title="Client">
            {summary.clientName ? (
              <div className="row">
                <Avatar name={summary.clientName} />
                <div className="grow" style={{ minWidth: 0 }}>
                  {can("CLIENT_VIEW")
                    ? <a className="link" href="/dashboard/clients" onClick={(e) => { e.preventDefault(); navigate("/dashboard/clients", { state: { search: summary.clientName, id: summary.clientId } }); }}><b>{summary.clientName}</b></a>
                    : <b>{summary.clientName}</b>}
                  <div className="cs-sub">Client on this case</div>
                </div>
              </div>
            ) : <p className="faint small">No client linked. {canEdit ? "Set one under Overview." : ""}</p>}
          </Panel>

          {(team.length > 0 || canTransfer) && (
            <Panel title="Team" flush actions={canTransfer && <Button size="sm" variant="ghost" onClick={openTransfer}>Transfer</Button>}>
              {team.length ? (
                <div className="list">
                  {team.map((m) => (
                    <div className="list-item" key={m.name}>
                      <Avatar name={m.name} size="sm" />
                      <div className="grow"><div className="small"><b>{m.name}</b></div><div className="cs-sub">{m.role}</div></div>
                    </div>
                  ))}
                </div>
              ) : nothing("No one else is working on this case yet.")}
            </Panel>
          )}
        </aside>
      </div>

      {summaryDoc && (
        <DocumentSummaryModal doc={summaryDoc} onClose={() => setSummaryDoc(null)} canRegenerate={hasPermission("DOCUMENT_EDIT")} />
      )}

      {/* ---------- Link to court record ---------- */}
      <Modal open={linkOpen} onClose={() => !linkBusy && setLinkOpen(false)} title="Link to court record" size="narrow"
        footer={<>
          <Button variant="ghost" disabled={linkBusy} onClick={() => setLinkOpen(false)}>Cancel</Button>
          {linkFound
            ? <Button variant="primary" icon="link" loading={linkBusy} onClick={doLink}>Link this record</Button>
            : <Button variant="primary" icon="search" loading={linkBusy} onClick={findCnr} disabled={!linkCnr.trim()}>Find</Button>}
        </>}>
        <div className="stack" style={{ gap: "var(--s3)" }}>
          <p className="muted small">For a case entered by hand: once it has a CNR, its court record (parties, hearings, orders) is added to this case. Notes, tasks, documents and bills stay as they are.</p>
          <TextField label="CNR" className="mono" value={linkCnr} maxLength={16} autoFocus placeholder="16 characters, e.g. TNCH010015532025"
            error={linkError || undefined}
            onChange={(e) => { setLinkCnr(e.target.value.toUpperCase()); setLinkFound(null); setLinkError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !linkFound) findCnr(); }} />
          {linkFound && (
            <div className="callout ok">
              <Icon name="ok" size="sm" />
              <div>
                Found <strong className="mono">{linkFound.record.cases[0]?.case_number || linkFound.cnr}</strong>
                {linkFound.record.cases[0]?.parties ? <> · {linkFound.record.cases[0].parties}</> : null}
                <div className="muted small">Check this is the same case, then link it.</div>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ---------- Transfer ---------- */}
      <Modal open={showTransfer} onClose={() => setShowTransfer(false)} title="Transfer case" sub={<span className="mono">{summary.caseNumber}</span>} size="narrow"
        footer={<>
          <Button variant="ghost" onClick={() => setShowTransfer(false)}>Cancel</Button>
          <Button variant="primary" loading={transferring} onClick={doTransfer} disabled={!transferTo || transferring}>{transferring ? "Transferring…" : "Transfer case"}</Button>
        </>}>
        <div className="stack" style={{ gap: "var(--s3)" }}>
          <p className="muted small">Reassign this case to another advocate. It moves out of your workspace into theirs.</p>
          <Field label="New handling advocate" required>
            {(fid) => (
              <select id={fid} className="input" value={transferTo} onChange={(e) => setTransferTo(e.target.value)}>
                <option value="">Select an advocate…</option>
                {advocates.some((a) => !a.crossTeam) && (
                  <optgroup label="Your team">
                    {advocates.filter((a) => !a.crossTeam).map((a) => <option key={a.id} value={String(a.id)}>{a.fullName || a.email}{a.email ? ` — ${a.email}` : ""}</option>)}
                  </optgroup>
                )}
                {advocates.some((a) => a.crossTeam) && (
                  <optgroup label="Other teams (senior)">
                    {advocates.filter((a) => a.crossTeam).map((a) => <option key={a.id} value={String(a.id)}>{a.fullName || a.email}{a.email ? ` — ${a.email}` : ""}</option>)}
                  </optgroup>
                )}
              </select>
            )}
          </Field>
          {transferTarget?.crossTeam && (
            <div className="callout warn"><Icon name="warn" size="sm" />
              <div>This moves the entire matter (hearings, invoices, documents and the client) to {transferTarget?.fullName}&apos;s team. Your team will no longer see it.</div>
            </div>
          )}
        </div>
      </Modal>

      {/* ---------- Daily status of a hearing ---------- */}
      <Modal open={!!hearingBizModal} onClose={() => setHearingBizModal(null)} title="Daily status" sub={hearingBizModal?.court}>
        {hearingBizModal && (
          <div className="stack" style={{ gap: "var(--s3)" }}>
            {hearingBizModal.parties && <p className="small"><b>{hearingBizModal.parties}</b></p>}
            <dl className="kv">
              {Object.entries(hearingBizModal.fields || {}).map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}><dt>{k}</dt><dd style={{ wordBreak: "break-word" }}>{String(v)}</dd></div>
              ))}
            </dl>
          </div>
        )}
      </Modal>

      {/* ---------- Add expense ---------- */}
      <Modal open={showExpenseModal} onClose={() => setShowExpenseModal(false)} title="Add expense" sub={<span className="mono">{summary.caseNumber}</span>}
        footer={<>
          <Button variant="ghost" onClick={() => setShowExpenseModal(false)}>Cancel</Button>
          <Button variant="primary" loading={savingFin} onClick={addExpense} disabled={savingFin}>{savingFin ? "Saving…" : "Add expense"}</Button>
        </>}>
        <form className="form-grid" noValidate onSubmit={(e) => { e.preventDefault(); addExpense(); }}>
          <TextField label="Title" required full value={expenseForm.title} onChange={(e) => setExpenseForm({ ...expenseForm, title: e.target.value })} />
          <TextField label="Amount (₹)" type="number" required min="0.01" step="0.01" value={expenseForm.amount}
            error={amountError(expenseForm.amount)} onKeyDown={blockSignKeys}
            onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
          <TextField label="Category" value={expenseForm.category} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })} />
          <TextField label="Payment date" type="date" value={expenseForm.paymentDate} onChange={(e) => setExpenseForm({ ...expenseForm, paymentDate: e.target.value })} />
          <SelectField label="Payment status" placeholder="—" options={PAYMENT_STATUSES} value={expenseForm.paymentStatus}
            onChange={(e) => setExpenseForm({ ...expenseForm, paymentStatus: e.target.value })} />
        </form>
      </Modal>

      {/* ---------- Raise invoice ---------- */}
      <Modal open={showInvoiceModal} onClose={() => setShowInvoiceModal(false)} size="wide"
        title={hasPermission("INVOICE_ISSUE") ? "Raise invoice" : "Send invoice to accounts"} sub={<span className="mono">{summary.caseNumber}</span>}
        footer={<>
          <Button variant="ghost" onClick={() => setShowInvoiceModal(false)}>Cancel</Button>
          <Button variant="primary" loading={savingFin} onClick={addInvoice} disabled={savingFin || invoiceTotal <= 0}>
            {savingFin ? "Saving…" : hasPermission("INVOICE_ISSUE") ? "Raise invoice" : "Send to accounts"}
          </Button>
        </>}>
        <div className="stack" style={{ gap: "var(--s4)" }}>
          {!summary.clientName && (
            <div className="callout warn"><Icon name="warn" size="sm" /><div>This case has no client linked. An invoice needs a client; set one on the case first.</div></div>
          )}
          {hearingHistory.length > 0 && (
            <SelectField label="Link a hearing" hint="Optional. Adds an appearance line and sets the invoice date." value="" placeholder="— none (bill by date) —"
              options={hearingHistory.map((h, idx) => ({ value: idx, label: `${h.hearingDate || h.businessDate || "hearing"}${h.purpose ? ` — ${h.purpose}` : ""}` }))}
              onChange={(e) => { if (e.target.value !== "") prefillInvoiceFromHearing(Number(e.target.value)); }} />
          )}
          <div className="form-grid">
            <TextField label="Invoice date" type="date" value={invoiceForm.invoiceDate} onChange={(e) => setInvoiceForm({ ...invoiceForm, invoiceDate: e.target.value })} />
            <TextField label="Due date" type="date" min={invDueMin} error={invDueError} value={invoiceForm.dueDate} onChange={(e) => setInvoiceForm({ ...invoiceForm, dueDate: e.target.value })} />
          </div>
          <div className="row between"><span className="label">Particulars</span><Button size="sm" variant="ghost" icon="plus" onClick={addInvParticular}>Add line</Button></div>
          {invoiceForm.particulars.map((p, i) => (
            <div className="cs-inv-line" key={i}>
              <TextField label={`Particular ${i + 1}`} placeholder="e.g. Appearance fee" value={p.description} onChange={(e) => setInvParticular(i, "description", e.target.value)} />
              <TextField label="Amount (₹)" type="number" min={0} step="0.01" value={p.amount} onChange={(e) => setInvParticular(i, "amount", e.target.value)} />
              <Button variant="ghost" iconOnly icon="x" aria-label={`Remove line ${i + 1}`} onClick={() => removeInvParticular(i)} disabled={invoiceForm.particulars.length === 1} />
            </div>
          ))}
          <div className="cs-inv-total"><span>Total</span><span className="mono">{formatCurrency(invoiceTotal)}</span></div>
        </div>
      </Modal>

      {/* ---------- Upload order ---------- */}
      <Modal open={showUploadOrder} onClose={() => setShowUploadOrder(false)} title="Upload order" sub={<span className="mono">{summary.caseNumber}</span>}
        footer={<>
          <Button variant="ghost" onClick={() => setShowUploadOrder(false)}>Cancel</Button>
          <Button variant="primary" icon="upload" loading={uploadingOrder} onClick={uploadOrder} disabled={uploadingOrder || !orderForm.file}>{uploadingOrder ? "Uploading…" : "Upload order"}</Button>
        </>}>
        <div className="form-grid">
          <TextField label="Document name" full placeholder="e.g. Interim Order 21-01-2025" value={orderForm.documentName}
            onChange={(e) => setOrderForm({ ...orderForm, documentName: e.target.value })} />
          <TextField label="Order date" type="date" value={orderForm.orderDate} onChange={(e) => setOrderForm({ ...orderForm, orderDate: e.target.value })} />
          <TextField label="Description" placeholder="Optional" value={orderForm.description} onChange={(e) => setOrderForm({ ...orderForm, description: e.target.value })} />
          <Field label="File" required full>
            {(fid) => <input id={fid} type="file" accept={DOCUMENT_ACCEPT} className="input" onChange={(e) => setOrderForm({ ...orderForm, file: e.target.files?.[0] || null })} />}
          </Field>
        </div>
      </Modal>

      {/* ---------- Add / edit hearing or event ---------- */}
      <Modal open={showHearingModal} onClose={closeHearingModal} sub={<span className="mono">{summary.caseNumber}</span>}
        title={editingEventId
          ? (eventModalMode === "event" ? "Edit event" : "Edit hearing")
          : (eventModalMode === "event" ? "Add event" : "Add hearing")}
        footer={<>
          <Button variant="ghost" onClick={closeHearingModal}>Cancel</Button>
          <Button variant="primary" loading={savingFin} onClick={() => addHearing()} disabled={savingFin || !hearingForm.title.trim() || !hearingForm.date}>
            {savingFin ? "Saving…" : (editingEventId
              ? (eventModalMode === "event" ? "Save event" : "Save hearing")
              : (eventModalMode === "event" ? "Add event" : "Add hearing"))}
          </Button>
        </>}>
        <form className="form-grid" noValidate onSubmit={(e) => { e.preventDefault(); addHearing(); }}>
          <TextField label="Title" required full value={hearingForm.title} onChange={(e) => setHearingForm({ ...hearingForm, title: e.target.value })} />
          {eventModalMode === "event" && (
            <SelectField label="Type" full options={OTHER_EVENT_TYPES} value={hearingForm.eventType}
              onChange={(e) => setHearingForm({ ...hearingForm, eventType: e.target.value })} />
          )}
          <TextField label="Date" required type="date" value={hearingForm.date} onChange={(e) => setHearingForm({ ...hearingForm, date: e.target.value })} />
          <TextField label="Time" type="time" value={hearingForm.time} onChange={(e) => setHearingForm({ ...hearingForm, time: e.target.value })} />
          {eventModalMode === "hearing" && <>
            <SelectField label="Purpose / stage" placeholder="Select purpose…" options={HEARING_PURPOSES} value={hearingForm.purpose}
              onChange={(e) => setHearingForm({ ...hearingForm, purpose: e.target.value })} />
            <TextField label="Court" value={hearingForm.court} onChange={(e) => setHearingForm({ ...hearingForm, court: e.target.value })} />
            <TextField label="Bench / hall no." value={hearingForm.benchHall} onChange={(e) => setHearingForm({ ...hearingForm, benchHall: e.target.value })} />
            <TextField label="Judge / coram" value={hearingForm.judge} onChange={(e) => setHearingForm({ ...hearingForm, judge: e.target.value })} />
            <TextField label="Next hearing date" type="date" value={hearingForm.nextDate} onChange={(e) => setHearingForm({ ...hearingForm, nextDate: e.target.value })} />
            <TextArea label="Outcome / order" hint="After the hearing" full rows={3} value={hearingForm.outcome}
              onChange={(e) => setHearingForm({ ...hearingForm, outcome: e.target.value })} />
          </>}
          <TextArea label="Description" full rows={3} placeholder="Notes" value={hearingForm.description}
            onChange={(e) => setHearingForm({ ...hearingForm, description: e.target.value })} />
        </form>
      </Modal>
      <DuplicateEventDialog existing={dupEvent} busy={savingFin}
        onCancel={() => setDupEvent(null)} onAddAnyway={() => addHearing(true)} />
    </div>
  );
}
