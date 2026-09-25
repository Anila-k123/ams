import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { InputNumber } from "primereact/inputnumber";
import { Dropdown } from "primereact/dropdown";
import { AutoComplete } from "primereact/autocomplete";
import { Calendar } from "primereact/calendar";
import { Checkbox } from "primereact/checkbox";
import { Dialog } from "primereact/dialog";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import { Tag } from "primereact/tag";
import { TabMenu } from "primereact/tabmenu";
import { Card } from "primereact/card";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Menu } from "primereact/menu";
import { ProgressSpinner } from "primereact/progressspinner";
import { Skeleton } from "primereact/skeleton";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { DRAFTING, newDraftUrl } from "./Drafting/routes";
import { ReviewActions, ReviewChip, ReviewNote } from "../components/TaskReview";
import CaseTimeline from "../components/CaseTimeline";
import DocumentSummaryModal from "../components/DocumentSummaryModal";
import CaseExtraDetails from "../components/CaseExtraDetails";
import { fetchCourtDocument, downloadHcOrderPdf, fetchHcBusiness } from "../services/courtDocuments";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import { useLoading } from "../contexts/LoadingContext";
import { formatCurrency } from "../utils/formatCurrency";
import "../assets/styles/CourtRecordView.css";
import "../assets/styles/CaseDetail.css";

const TABS = ["Parties", "Hearings", "Events", "Orders", "Expenses", "Invoices", "Tasks", "Notes", "Documents", "Related Cases", "Acts", "Extra Details", "Timeline"];

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

// The forms keep dates as "yyyy-mm-dd" and times as "HH:mm" strings (what the API
// takes); these bridge them to PrimeReact's Calendar, which works on Date objects.
const pad2 = (n: number) => String(n).padStart(2, "0");
function isoToDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}
function dateToIso(d: any): string {
  return d instanceof Date ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` : "";
}
function hmToDate(s: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(s || "");
  if (!m) return null;
  const d = new Date(); d.setHours(Number(m[1]), Number(m[2]), 0, 0); return d;
}
function dateToHm(d: any): string {
  return d instanceof Date ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : "";
}
function DateField({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <Calendar value={isoToDate(value)} onChange={(e) => onChange(dateToIso(e.value))} dateFormat="dd/mm/yy"
      showIcon showButtonBar placeholder={placeholder} className={className || "w-full"} />
  );
}

// window.confirm replacement on PrimeReact's ConfirmDialog (mounted by the page).
const confirmAsync = (message: string, header = "Please confirm") =>
  new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; resolve(v); } };
    confirmDialog({
      message, header, icon: "pi pi-exclamation-triangle", acceptClassName: "p-button-danger",
      accept: () => finish(true), reject: () => finish(false), onHide: () => finish(false),
    });
  });

const statusSeverity = (s: string): any => {
  const v = (s || "").toLowerCase();
  if (v === "active" || v === "paid") return "success";
  if (v === "pending" || v === "partial" || v === "partially_paid") return "warning";
  if (v === "closed" || v === "overdue" || v === "unpaid" || v === "cancelled") return "danger";
  return "info";
};
const prioSeverity = (p: string): any => (p === "HIGH" ? "danger" : p === "LOW" ? "success" : "warning");

// One field's pencil-edit affordance: shows the value + a pencil; clicking turns
// it into an input/select with save/cancel. `onSave(newValue)` should throw to
// keep the field open on failure. `hideValue` shows only the pencil (e.g. next
// to a badge that already renders the value).
function InlineEdit({ value, display, type = "text", options, onSave, onStart, hideValue }: any) {
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
        <Button icon="pi pi-pencil" rounded text size="small" className="cd-pencil" onClick={start} aria-label="Edit"
          tooltip="Edit" tooltipOptions={{ position: "top" }} />
      </span>
    );
  }
  return (
    <span className="cd-inline editing">
      {type === "select" ? (
        <Dropdown autoFocus value={val} options={options || []} optionLabel="label" optionValue="value"
          onChange={(e) => setVal(e.value)} filter={(options || []).length > 8} className="p-inputtext-sm" />
      ) : (
        <InputText autoFocus value={val} className="p-inputtext-sm"
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }} />
      )}
      <Button icon="pi pi-check" rounded text size="small" severity="success" onClick={commit} disabled={saving} aria-label="Save" />
      <Button icon="pi pi-times" rounded text size="small" severity="secondary" onClick={() => setEditing(false)} aria-label="Cancel" />
    </span>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setShowActions(false);
    if (!(await confirmAsync("Archive this case? It will be hidden from the workspace (you can restore it from the Cases list)."))) return;
    try {
      await api.delete(`/api/cases/delete/${id}`);
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
  const refreshCourtData = async () => {
    setShowActions(false);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients.length]);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await api.get(`/api/workspace/cases/${id}/events`);
      setEvents(res.data || []);
    } catch { setEvents([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchDocs = useCallback(async () => {
    try {
      const res = await api.get(`/api/documents/by-case/${id}`);
      setDocs(res.data || []);
    } catch { setDocs([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await api.get(`/api/workspace/cases/${id}/notes`);
      setNotes(res.data || []);
    } catch { setNotes([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await api.get(`/api/workspace/cases/${id}/tasks`);
      setTasks(res.data || []);
    } catch { setTasks([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchFinancials = useCallback(async () => {
    try {
      const res = await api.get(`/api/workspace/cases/${id}/financials`);
      setFinancials(res.data);
    } catch { setFinancials(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchParties = useCallback(async () => {
    try {
      const res = await api.get(`/api/workspace/cases/${id}/parties`);
      setParties(res.data || []);
    } catch { setParties([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchRelated = useCallback(async () => {
    try {
      const res = await api.get(`/api/workspace/cases/${id}/related`);
      setRelated(res.data || []);
    } catch { setRelated([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const fetchLinkableCases = useCallback(async () => {
    try {
      const res = await api.get(`/api/cases/my-cases`);
      setLinkableCases((res.data || []).filter((c) => c.id !== Number(id)));
    } catch { setLinkableCases([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const addExpense = async () => {
    if (!expenseForm.title.trim()) { error("Expense title is required."); return; }
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

  const addInvoice = async () => {
    const particulars = invoiceForm.particulars
      .map((p) => ({ description: (p.description || "").trim(), amount: parseFloat(p.amount) || 0 }))
      .filter((p) => p.description || p.amount);
    if (!particulars.length || particulars.reduce((s, p) => s + p.amount, 0) <= 0) {
      error("Add at least one particular with an amount."); return;
    }
    setSavingFin(true);
    try {
      await withLoading(
        api.post("/api/invoices/create", {
          particulars,
          invoiceDate: invoiceForm.invoiceDate || null,
          dueDate: invoiceForm.dueDate || null,
          caseId: Number(id),
        }),
        "Adding invoice..."
      );
      setShowInvoiceModal(false);
      setInvoiceForm({ invoiceDate: "", dueDate: "", particulars: [{ description: "", amount: "" }] });
      fetchFinancials();
      fetchSummary();
      success("Invoice added to this case.");
    } catch (err) {
      error(err.response?.data?.error || "Failed to add invoice.");
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
        await withLoading(api.post("/api/events/create", { ...payload, caseEntity: { id: Number(id) } }), "Adding hearing...");
      }
      setShowHearingModal(false);
      setEditingEventId(null);
      setHearingForm(EMPTY_HEARING);
      fetchEvents();
      fetchSummary();
      success(eventModalMode === "event"
        ? (editingEventId ? "Event updated." : "Event added to this case.")
        : (editingEventId ? "Hearing updated." : "Hearing added to this case."));
    } catch (err) {
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
    if (!(await confirmAsync("Delete this hearing/reminder?"))) return;
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
    try {
      await navigator.clipboard.writeText(parts.join("\n"));
      success("Listing copied to clipboard.");
    } catch { error("Couldn't copy to clipboard."); }
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
  useEffect(() => { fetchFinancials(); }, [fetchFinancials]);

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
    if (tab === "Parties") fetchParties();
    if (tab === "Related Cases") { fetchRelated(); fetchLinkableCases(); }
    if (tab === "Acts") { fetchLinkedActs(); fetchCitedActs(); }
    if (tab === "Expenses" || tab === "Invoices") fetchFinancials();
    if (tab === "Hearings" || tab === "Events") fetchEvents();
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
      const res = await api.put(`/api/workspace/tasks/${taskId}/toggle`, {});
      // On a delegated task the assignee's tick submits it for review instead.
      if (!res.data?.completed && res.data?.reviewStatus === "SUBMITTED") {
        success(`Submitted to ${res.data.assignedByName || "the assigner"} for review.`);
      }
      fetchTasks();
      fetchSummary();
    } catch { error("Failed to update task."); }
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


  if (loading) {
    return (
      <div className="case-detail flex flex-column gap-3">
        <Skeleton height="2rem" width="12rem" />
        <Skeleton height="10rem" />
        <Skeleton height="3rem" />
        <Skeleton height="16rem" />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="case-detail">
        <Button text icon="pi pi-arrow-left" label="Back to Workspace" className="cd-back" onClick={() => navigate("/dashboard/cases")} />
        <p className="cd-empty">Case not found or you don&apos;t have access.</p>
      </div>
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

  const actionItems = [
    ...(courtRecord ? [{ label: "Refresh court data", icon: "pi pi-clock", command: refreshCourtData }] : []),
    // Only when you can edit AND there's actually someone to transfer to — a solo
    // advocate has no target, so it hides.
    ...(canTransfer ? [{ label: "Transfer case…", icon: "pi pi-users", command: openTransfer }] : []),
    ...(hasPermission("CASE_DELETE") ? [{ label: "Archive case", icon: "pi pi-trash", className: "cd-menu-danger", command: archiveCase }] : []),
  ];

  const tabModel = TABS.map((t) => {
    const badge = t === "Notes" ? summary.noteCount : t === "Tasks" ? summary.taskCounts?.open : 0;
    return {
      label: t,
      template: (item: any, options: any) => (
        <a className={options.className} onClick={options.onClick} role="tab">
          <span className={options.labelClassName}>{item.label}</span>
          {badge ? <span className="cd-badge">{badge}</span> : null}
        </a>
      ),
    };
  });

  const sectionHead = (icon: string, title: any, action?: any) => (
    <div className="cd-section-head">
      <h4><i className={`pi ${icon}`} /> {title}</h4>
      {action}
    </div>
  );

  const listItem = (key: any, icon: string, body: any, trailing?: any) => (
    <div className="cd-list-item" key={key}>
      <div className="cd-li-icon"><i className={`pi ${icon}`} /></div>
      <div className="cd-li-body">{body}</div>
      {trailing}
    </div>
  );

  const eventDate = (ev: any) => (
    <span className="cd-li-date">{fmtDate(ev.date)}{ev.time ? ` · ${ev.time.slice(0, 5)}` : ""}</span>
  );

  const closeHearingModal = () => { setShowHearingModal(false); setEditingEventId(null); };
  const orders = extractOrders(courtRecord);
  const uploadedOrders = (docs || []).filter((d) => (d.category || "").toLowerCase() === "order");
  const transferTarget = advocates.find((a) => String(a.id) === String(transferTo));
  const advocateOption = (a: any) => ({ value: String(a.id), label: `${a.fullName || a.email}${a.email ? ` — ${a.email}` : ""}` });
  const transferGroups = [
    ...(advocates.some((a) => !a.crossTeam) ? [{ label: "Your team", items: advocates.filter((a) => !a.crossTeam).map(advocateOption) }] : []),
    ...(advocates.some((a) => a.crossTeam) ? [{ label: "Other teams (senior)", items: advocates.filter((a) => a.crossTeam).map(advocateOption) }] : []),
  ];

  return (
    <div className="case-detail">
      <ConfirmDialog />
      <Button text icon="pi pi-arrow-left" label="Back to Workspace" className="cd-back" onClick={() => navigate("/dashboard/cases")} />

      {/* Header */}
      <Card className="cd-header">
        <div className="flex flex-column lg:flex-row gap-4 justify-content-between">
          <div className="cd-header-main flex-1">
            <div className="cd-title-row">
              <h2>
                <InlineEdit value={summary.caseTitle} display={summary.caseTitle || summary.caseNumber}
                  onSave={(v) => patchCase({ caseTitle: v })} />
              </h2>
              <Tag rounded value={summary.status || "—"} severity={statusSeverity(summary.status)} />
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
              <span title="Total invoiced for this case">
                <strong>Amount:</strong>{" "}
                {formatCurrency(financials?.totals?.totalInvoiced || 0)}
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
              <i className="pi pi-tag cd-ht-icon" />
              {(summary.tags || []).map((t) => (
                <Tag key={t.id} className="cd-tag-chip" rounded>
                  <span className="flex align-items-center gap-1">
                    {t.label}
                    <i className="pi pi-times cd-tag-x" role="button" title="Remove" onClick={() => removeTag(t.id)} />
                  </span>
                </Tag>
              ))}
              <Dropdown value={null} placeholder="+ tag" className="cd-tag-select p-inputtext-sm"
                options={TAG_OPTIONS.filter((t) => !(summary.tags || []).some((x) => x.label === t))}
                onChange={(e) => { if (e.value) addTag(e.value); }} />
            </div>
          </div>

          <div className="cd-header-side">
            <div className="flex gap-2 justify-content-end flex-wrap">
              {hasPermission("INVOICE_CREATE") && (
                <Button size="small" icon="pi pi-indian-rupee" label="Raise Invoice" onClick={() => setShowInvoiceModal(true)} />
              )}
              {(courtRecord || hasPermission("CASE_DELETE") || canTransfer) && (
                <div className="cd-actions-wrap">
                  <Button size="small" outlined icon={refreshing ? "pi pi-spin pi-spinner" : "pi pi-chevron-down"} iconPos="right"
                    label={refreshing ? "Refreshing…" : "Actions"} onClick={() => setShowActions((s) => !s)} disabled={refreshing} />
                  {showActions && (
                    <>
                      <div className="cd-actions-backdrop" onClick={() => setShowActions(false)} />
                      <Menu model={actionItems} className="cd-actions-menu" />
                    </>
                  )}
                </div>
              )}
            </div>
            {summary.nextHearing ? (
              <div className="cd-next-hearing">
                <i className="pi pi-calendar" />
                <div>
                  <span className="cd-nh-label">Next Hearing</span>
                  <span className="cd-nh-date">{fmtDate(summary.nextHearing.date)}</span>
                </div>
              </div>
            ) : (
              <div className="cd-next-hearing muted"><i className="pi pi-calendar" /> No upcoming hearing</div>
            )}
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <TabMenu className="cd-tabs" model={tabModel} activeIndex={TABS.indexOf(tab)}
        onTabChange={(e) => setTab(TABS[e.index])} />

      <div className="cd-panel">
        {/* PARTIES */}
        {tab === "Parties" && (
          <div className="cd-card">
            {sectionHead("pi-users", "Parties")}
            {parties.length === 0 && <span className="cd-muted">No parties added yet.</span>}
            <div className="cd-list">
              {parties.map((p) => (
                <div className={`cd-list-item ${p.isOpponent ? "opponent" : ""}`} key={p.id}>
                  <div className="cd-li-icon"><i className="pi pi-user" /></div>
                  <div className="cd-li-body">
                    <span className="cd-li-title">
                      {p.name}
                      {p.role && <Tag className="cd-li-type" value={p.role} severity="info" />}
                      {p.isOpponent && <Tag className="cd-li-type" value="Opponent" severity="danger" />}
                    </span>
                    <span className="cd-li-desc">
                      {[p.counsel && `Counsel: ${p.counsel}`, p.contact].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {hasPermission("CASE_EDIT") && (
                    <Button icon="pi pi-trash" rounded text severity="danger" size="small" aria-label="Remove"
                      onClick={() => deleteParty(p.id)} />
                  )}
                </div>
              ))}
            </div>
            <div className="cd-add-row">
              <InputText placeholder="Party name" value={partyForm.name}
                onChange={(e) => setPartyForm({ ...partyForm, name: e.target.value })} />
              <Dropdown placeholder="Role" value={partyForm.role} options={PARTY_ROLES} showClear
                onChange={(e) => setPartyForm({ ...partyForm, role: e.value || "" })} />
              <InputText placeholder="Counsel (optional)" value={partyForm.counsel}
                onChange={(e) => setPartyForm({ ...partyForm, counsel: e.target.value })} />
              <InputText placeholder="Contact (optional)" value={partyForm.contact}
                onChange={(e) => setPartyForm({ ...partyForm, contact: e.target.value })} />
              <div className="flex align-items-center gap-2">
                <Checkbox inputId="party-opp" checked={partyForm.isOpponent}
                  onChange={(e) => setPartyForm({ ...partyForm, isOpponent: !!e.checked })} />
                <label htmlFor="party-opp">Opponent</label>
              </div>
              <Button icon="pi pi-plus" label="Add" onClick={addParty} />
            </div>
          </div>
        )}

        {/* HEARINGS */}
        {tab === "Hearings" && (
          <div>
            {sectionHead("pi-calendar", `Hearings (${hearingEvents.length})`,
              hasPermission("EVENT_CREATE") && (
                <Button size="small" icon="pi pi-plus" label="Add Hearing"
                  onClick={() => { setEditingEventId(null); setEventModalMode("hearing"); setHearingForm(EMPTY_HEARING); setShowHearingModal(true); }} />
              ))}
            <div className="cd-list">
              {hearingEvents.length === 0 ? (
                <p className="cd-muted">No upcoming hearings. Add one here — past court hearings appear under Court Hearing History below.</p>
              ) : hearingEvents.map((ev) => listItem(ev.id, "pi-calendar", (
                <>
                  <span className="cd-li-title">
                    {ev.title}
                    {ev.hearingDetail?.purpose && <Tag className="cd-li-type" value={ev.hearingDetail.purpose} severity="info" />}
                  </span>
                  {(ev.hearingDetail?.court || ev.hearingDetail?.benchHall || ev.hearingDetail?.judge) && (
                    <span className="cd-li-desc">
                      {[ev.hearingDetail.court, ev.hearingDetail.benchHall && `Hall ${ev.hearingDetail.benchHall}`, ev.hearingDetail.judge].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {ev.hearingDetail?.nextDate && <span className="cd-li-desc">Next date: {fmtDate(ev.hearingDetail.nextDate)}</span>}
                  {ev.hearingDetail?.outcome && <span className="cd-li-desc">Outcome: {ev.hearingDetail.outcome}</span>}
                  {ev.description && <span className="cd-li-desc">{ev.description}</span>}
                </>
              ), (
                <div className="cd-li-actions">
                  {eventDate(ev)}
                  {hearingBizByDate.has(ev.date) && (
                    <Button size="small" outlined label="View" loading={hearingViewBusy === ev.id}
                      onClick={() => viewHearingBusiness(ev)} />
                  )}
                  {hasPermission("EVENT_CREATE") && <Button size="small" text label="Edit" onClick={() => editHearing(ev)} />}
                  {hasPermission("EVENT_DELETE") && <Button size="small" text severity="danger" label="Delete" onClick={() => deleteHearingEvent(ev.id)} />}
                </div>
              )))}
            </div>

            {/* Court hearing/listing history from the imported record (Provakil "Listings"). */}
            {hearingHistory.length > 0 && (
              <div className="mt-4">
                {sectionHead("pi-calendar", `Court Hearing History (${hearingHistory.length})`)}
                <DataTable value={hearingHistory.map((h, i) => ({ ...h, _i: i }))} size="small" stripedRows scrollable className="text-sm">
                  <Column header="Cause List" body={(h) => h.causeList || "—"} />
                  <Column header="Judge / Bench" body={(h) => h.judge || "—"} />
                  <Column header="Business Date" body={(h) => h.businessDate || "—"} />
                  <Column header="Hearing Date" body={(h) => h.hearingDate || "—"} />
                  <Column header="Purpose" body={(h) => h.purpose || "—"} />
                  <Column header="Daily Status" body={(h) => (
                    (h.businessDetail && Object.keys(h.businessDetail.fields || {}).length) || (h.business && h.businessDate) ? (
                      <Button size="small" outlined label="View" loading={hearingViewBusy === `h${h._i}`}
                        onClick={() => viewHistoryBusiness(h, h._i)} />
                    ) : <span className="cd-muted">—</span>
                  )} />
                  <Column header="Actions" body={(h) => (
                    <div className="flex gap-1 flex-wrap">
                      <Button size="small" text label="Copy" onClick={() => copyHearing(h)} />
                      <Button size="small" text label={alertBusy === `a${h._i}` ? "Sending…" : "Send Alert to Client"}
                        tooltip={summary.clientId ? "Email this hearing to the client" : "No client email on this case"}
                        tooltipOptions={{ position: "top", showOnDisabled: true }}
                        disabled={!summary.clientId || alertBusy === `a${h._i}`} onClick={() => alertClient(h, h._i)} />
                      {hasPermission("INVOICE_CREATE") && <Button size="small" text label="Raise Invoice" onClick={() => setShowInvoiceModal(true)} />}
                    </div>
                  )} />
                </DataTable>
              </div>
            )}
          </div>
        )}

        {/* EVENTS */}
        {tab === "Events" && (
          <div>
            {sectionHead("pi-calendar", `Events (${otherEvents.length})`,
              hasPermission("EVENT_CREATE") && (
                <Button size="small" icon="pi pi-plus" label="Add Event"
                  onClick={() => { setEditingEventId(null); setEventModalMode("event"); setHearingForm({ ...EMPTY_HEARING, eventType: "MEETING" }); setShowHearingModal(true); }} />
              ))}
            <div className="cd-list">
              {otherEvents.length === 0 ? (
                <p className="cd-muted">No meetings, payment-due or document reminders for this case yet.</p>
              ) : otherEvents.map((ev) => listItem(ev.id, "pi-calendar", (
                <>
                  <span className="cd-li-title">{ev.title} <Tag className="cd-li-type" value={ev.eventType} severity="info" /></span>
                  {ev.description && <span className="cd-li-desc">{ev.description}</span>}
                </>
              ), (
                <div className="cd-li-actions">
                  {eventDate(ev)}
                  {hasPermission("EVENT_CREATE") && <Button size="small" text label="Edit" onClick={() => editHearing(ev)} />}
                  {hasPermission("EVENT_DELETE") && <Button size="small" text severity="danger" label="Delete" onClick={() => deleteHearingEvent(ev.id)} />}
                </div>
              )))}
            </div>
          </div>
        )}

        {/* ORDERS */}
        {tab === "Orders" && (
          <div>
            {sectionHead("pi-file", "Orders",
              hasPermission("DOCUMENT_UPLOAD") && (
                <Button size="small" icon="pi pi-upload" label="Upload Order" onClick={() => setShowUploadOrder(true)} />
              ))}

            {/* Court-record orders (scraped, downloaded live) */}
            {courtRecordLoading && <div className="flex justify-content-center p-4"><ProgressSpinner style={{ width: 36, height: 36 }} strokeWidth="4" /></div>}
            {!courtRecordLoading && orders.length === 0 && courtRecordLoaded && (
              <p className="cd-muted">No orders found on the court record for this case.</p>
            )}
            {!courtRecordLoading && orders.length > 0 && (
              <>
                <DataTable value={orders.map((o, i) => ({ ...o, _i: i }))} size="small" stripedRows scrollable className="text-sm">
                  <Column header="#" body={(o) => o.number || o._i + 1} />
                  <Column header="Order Date" field="date" />
                  <Column header="Details" field="details" />
                  <Column header="Judge" field="judge" />
                  <Column header="Document" body={(o) => (
                    o.pdf && o.pdf.filename ? (
                      <Button size="small" outlined icon="pi pi-download" label={orderDlBusy === o._i ? "Fetching…" : "Download PDF"}
                        disabled={orderDlBusy === o._i} onClick={() => downloadOrderPdf(o, o._i)} />
                    ) : o.pdfUrl ? (
                      <Button size="small" outlined icon="pi pi-download" label={orderDlBusy === o._i ? "Fetching…" : "Download PDF"}
                        disabled={orderDlBusy === o._i} onClick={() => downloadOrderPdfByUrl(o, o._i)} />
                    ) : <span className="cd-muted">—</span>
                  )} />
                </DataTable>
                <p className="cd-muted cd-orders-note">Court PDFs are fetched live from the court and downloaded to your device.</p>
              </>
            )}

            {/* Orders you've uploaded (stored documents tagged as "Order") */}
            {uploadedOrders.length > 0 && (
              <div className="mt-4">
                {sectionHead("pi-file", `Uploaded Orders (${uploadedOrders.length})`)}
                <div className="cd-list">
                  {uploadedOrders.map((d) => listItem(d.id, "pi-file", (
                    <>
                      <span className="cd-li-title">{d.documentName}</span>
                      <span className="cd-li-desc">{d.description || "Order"}{d.uploadDate ? ` · ${fmtDate(d.uploadDate)}` : ""}</span>
                    </>
                  ), (
                    <div className="cd-li-actions">
                      <Button size="small" outlined label="Preview" onClick={() => previewDoc(d.id)} />
                      <Button size="small" outlined label="Download" onClick={() => downloadDoc(d.id, d.documentName)} />
                    </div>
                  )))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* EXPENSES — live expenses for this case */}
        {tab === "Expenses" && (
          <div>
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
            {sectionHead("pi-indian-rupee", `Expenses ${financials ? `(${financials.totals.expenseCount})` : ""}`,
              hasPermission("EXPENSE_CREATE") && (
                <Button size="small" icon="pi pi-plus" label="Add Expense" onClick={() => setShowExpenseModal(true)} />
              ))}
            {!financials ? (
              <p className="cd-muted">Loading…</p>
            ) : financials.expenses.length === 0 ? (
              <p className="cd-muted">No expenses for this case yet. Add one here or from the Expenses section — it maps to this case automatically.</p>
            ) : (
              <div className="cd-list">
                {financials.expenses.map((exp) => listItem(exp.id, "pi-indian-rupee", (
                  <>
                    <span className="cd-li-title">{exp.title}
                      {exp.category && <Tag className="cd-li-type" value={exp.category} severity="info" />}
                    </span>
                    <span className="cd-li-desc">
                      {fmtDate(exp.paymentDate)}{exp.paymentStatus ? ` · ${exp.paymentStatus}` : ""}
                    </span>
                  </>
                ), <span className="cd-li-date">{formatCurrency(exp.amount || 0)}</span>))}
              </div>
            )}
          </div>
        )}

        {/* INVOICES — live invoices for this case */}
        {tab === "Invoices" && (
          <div>
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
            {sectionHead("pi-file", `Invoices ${financials ? `(${financials.totals.invoiceCount})` : ""}`,
              hasPermission("INVOICE_CREATE") && (
                <Button size="small" icon="pi pi-plus" label="Add Invoice" onClick={() => setShowInvoiceModal(true)} />
              ))}
            {!financials ? (
              <p className="cd-muted">Loading…</p>
            ) : financials.invoices.length === 0 ? (
              <p className="cd-muted">No invoices for this case yet. Add one here or from the Invoices section — it maps to this case automatically.</p>
            ) : (
              <div className="cd-list">
                {financials.invoices.map((inv) => listItem(inv.id, "pi-file", (
                  <>
                    <span className="cd-li-title">{inv.invoiceNumber}</span>
                    <span className="cd-li-desc">Issued {fmtDate(inv.invoiceDate)} · Due {fmtDate(inv.dueDate)}</span>
                  </>
                ), (
                  <div className="cd-li-actions">
                    <Tag rounded value={inv.status} severity={statusSeverity(inv.status)} />
                    <span className="cd-li-date">{formatCurrency(inv.amount || 0)}</span>
                  </div>
                )))}
              </div>
            )}
          </div>
        )}

        {/* TASKS */}
        {tab === "Tasks" && (
          <div>
            <div className="cd-task-add grid formgrid p-fluid">
              <div className="field col-12 md:col-4">
                <label>Task</label>
                <InputText placeholder="Task title" value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} />
              </div>
              <div className="field col-6 md:col-2">
                <label>Priority</label>
                <Dropdown value={newTask.priority} options={PRIORITIES} optionLabel="label" optionValue="value"
                  onChange={(e) => setNewTask({ ...newTask, priority: e.value })} />
              </div>
              <div className="field col-6 md:col-2">
                <label>Deadline</label>
                <DateField value={newTask.deadline} onChange={(v) => setNewTask({ ...newTask, deadline: v })} />
              </div>
              <div className="field col-6 md:col-2">
                <label>Documents</label>
                <label className="cd-task-attach p-button p-button-outlined p-button-secondary" title="Attach documents">
                  <i className="pi pi-paperclip mr-2" />
                  <span>{taskFiles.length ? `${taskFiles.length} file(s)` : "Attach files"}</span>
                  <input type="file" multiple style={{ display: "none" }}
                    onChange={(e) => setTaskFiles(Array.from(e.target.files || []))} />
                </label>
              </div>
              <div className="field col-6 md:col-2">
                <label>Category</label>
                <Dropdown value={newTask.category} options={DOC_CATEGORIES} placeholder="Select category" showClear
                  onChange={(e) => setNewTask({ ...newTask, category: e.value || "" })} />
              </div>
              {hasPermission("TASK_ASSIGN") && (
                <div className="field col-6 md:col-3">
                  <label>Assign to</label>
                  <Dropdown placeholder="Myself" value={newTask.assignedTo}
                    options={[{ value: "", label: "Myself" }, ...assignees.map((a) => ({ value: a.id, label: a.fullName || a.email }))]}
                    optionLabel="label" optionValue="value"
                    onChange={(e) => setNewTask({ ...newTask, assignedTo: e.value })} />
                </div>
              )}
              <div className="field col-6 md:col-2 flex align-items-end">
                {hasPermission("TASK_CREATE") && <Button icon="pi pi-plus" label="Add" onClick={addTask} />}
              </div>
            </div>
            {tasks.length === 0 ? (
              <p className="cd-muted">No tasks for this case.</p>
            ) : tasks.map((t) => (
              <div className={`cd-task ${t.completed ? "done" : ""}${t.cancelled ? " cancelled" : ""}`} key={t.id}>
                <Button rounded text className="cd-task-check" onClick={() => toggleTask(t.id)}
                  icon={t.completed ? "pi pi-check-circle" : "pi pi-circle"}
                  severity={t.completed ? "success" : "secondary"}
                  tooltip={t.needsReview && t.assignedToId === myId && !t.completed ? "Submit for review" : "Toggle"}
                  tooltipOptions={{ position: "top" }} />
                <div className="cd-task-main">
                  <span className="cd-task-title">{t.title}{t.cancelled && <span className="cd-task-cancelled"> Cancelled</span>}</span>
                  <ReviewNote task={t} />
                  {t.documents?.length > 0 && (
                    <div className="cd-task-docs">
                      {t.documents.map((d) => (
                        <span key={d.id} className="cd-task-doc" onClick={() => previewDoc(d.id)} title={`View ${d.name}`}>
                          <i className="pi pi-eye" style={{ fontSize: 11 }} /> {d.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <ReviewChip task={t} />
                <ReviewActions task={t} myId={myId} canAssign={hasPermission("TASK_ASSIGN")} toast={toast}
                  onDone={() => { fetchTasks(); fetchSummary(); }} />
                {t.assignedToName && (
                  <span className="cd-task-assignee" title={`Assigned to ${t.assignedToName}`}>
                    <i className="pi pi-user" style={{ fontSize: 11 }} /> {t.assignedToName}
                  </span>
                )}
                <Dropdown
                  className={`cd-task-prio p-inputtext-sm prio-${(t.priority || "medium").toLowerCase()}`}
                  value={t.priority || "MEDIUM"}
                  options={["HIGH", "MEDIUM", "LOW"]}
                  valueTemplate={(v) => <Tag value={v} severity={prioSeverity(v)} />}
                  onChange={(e) => changeTaskPriority(t.id, e.value)}
                  tooltip="Change priority" tooltipOptions={{ position: "top" }}
                />
                {t.deadline && <span className="cd-task-deadline"><i className="pi pi-clock" style={{ fontSize: 11 }} /> {fmtDate(t.deadline)}</span>}
                {t.draftSessionId && (
                  <Button size="small" text icon="pi pi-eye" label="Open draft"
                    tooltip="Open the draft in the drafting editor" tooltipOptions={{ position: "top" }}
                    onClick={() => navigate(DRAFTING.draft(t.draftSessionId))} />
                )}
                {!t.completed && !t.cancelled && (
                  <Button rounded text size="small" icon="pi pi-file-edit" aria-label="Draft for this task"
                    tooltip="Draft for this task" tooltipOptions={{ position: "top" }}
                    onClick={() => navigate(newDraftUrl({ caseId: Number(id), taskId: t.id }))} />
                )}
                {(t.assignedById ?? t.createdById) === myId && (
                  t.cancelled
                    ? <Button rounded text size="small" icon="pi pi-replay" aria-label="Restore task" tooltip="Restore task"
                        tooltipOptions={{ position: "top" }} onClick={() => cancelTask(t.id, false)} />
                    : <Button rounded text size="small" severity="danger" icon="pi pi-times-circle" aria-label="Cancel task"
                        tooltip="Cancel task" tooltipOptions={{ position: "top" }} onClick={() => cancelTask(t.id, true)} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* NOTES */}
        {tab === "Notes" && (
          <div>
            <div className="flex flex-column gap-2 mb-3">
              <InputTextarea rows={3} autoResize className="w-full"
                placeholder="Write a case note (diary entry)..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
              />
              {hasPermission("CASE_EDIT") && (
                <div className="flex justify-content-end"><Button icon="pi pi-plus" label="Add Note" onClick={addNote} /></div>
              )}
            </div>
            {notes.length === 0 ? (
              <p className="cd-muted">No notes yet.</p>
            ) : notes.map((n) => (
              <div className="cd-note" key={n.id}>
                <div className="cd-note-body">{n.body}</div>
                <div className="cd-note-foot">
                  <span>{new Date(n.createdAt).toLocaleString("en-IN")}</span>
                  {hasPermission("CASE_EDIT") && (
                    <Button icon="pi pi-trash" rounded text severity="danger" size="small" aria-label="Delete" onClick={() => deleteNote(n.id)} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* DOCUMENTS */}
        {tab === "Documents" && (
          <div>
            {hasPermission("DOCUMENT_UPLOAD") && (
              <div className="cd-add-row mb-3">
                <label className="p-button p-button-outlined p-button-secondary p-button-sm">
                  <i className="pi pi-paperclip mr-2" />
                  <span>{uploadFile ? uploadFile.name : "Choose file"}</span>
                  <input type="file" style={{ display: "none" }} onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
                </label>
                <Button size="small" icon="pi pi-upload" label="Upload" onClick={uploadDoc} disabled={!uploadFile} />
              </div>
            )}
            {docs.length === 0 ? (
              <p className="cd-muted">No documents linked to this case.</p>
            ) : (
              <div className="cd-list">
                {docs.map((d) => listItem(d.id, "pi-folder", (
                  <>
                    <span className="cd-li-title">{d.documentName}</span>
                    <span className="cd-li-desc">{d.category || "Other"} · {d.version > 1 ? `v${d.version}` : "v1"}</span>
                  </>
                ), (
                  <div className="cd-li-actions">
                    <Button rounded text size="small" icon="pi pi-eye" aria-label="Preview" tooltip="Preview"
                      tooltipOptions={{ position: "top" }} onClick={() => previewDoc(d.id)} />
                    <Button size="small" outlined icon="pi pi-bolt" label="See Summary" onClick={() => setSummaryDoc(d)} />
                    <Button rounded text size="small" icon="pi pi-download" aria-label="Download" tooltip="Download"
                      tooltipOptions={{ position: "top" }} onClick={() => downloadDoc(d.id, d.originalName || d.documentName)} />
                  </div>
                )))}
              </div>
            )}
          </div>
        )}

        {summaryDoc && (
          <DocumentSummaryModal
            doc={summaryDoc}
            onClose={() => setSummaryDoc(null)}
            canRegenerate={hasPermission("DOCUMENT_EDIT")}
          />
        )}

        {/* RELATED CASES */}
        {tab === "Related Cases" && (
          <div className="cd-card">
            {sectionHead("pi-link", "Related Cases")}
            {related.length === 0 && <span className="cd-muted">No linked cases.</span>}
            <div className="cd-list">
              {related.map((r) => listItem(`${r.direction}-${r.id}`, "pi-link", (
                <>
                  <span className="cd-li-title cd-link-case" onClick={() => r.linkedCaseId && navigate(`/dashboard/cases/${r.linkedCaseId}`)}>
                    {r.caseNumber || `Case #${r.linkedCaseId}`}
                    {r.relation && <Tag className="cd-li-type" value={r.relation} severity="info" />}
                  </span>
                  <span className="cd-li-desc">{r.caseTitle || ""}{r.note ? ` · ${r.note}` : ""}</span>
                </>
              ), hasPermission("CASE_EDIT") && (
                <Button icon="pi pi-trash" rounded text severity="danger" size="small" aria-label="Unlink" onClick={() => deleteRelated(r.id)} />
              )))}
            </div>
            <div className="cd-add-row">
              <Dropdown value={relatedForm.relatedCaseId} placeholder="Select a case to link…" filter showClear
                options={linkableCases.map((c) => ({ value: String(c.id), label: `${c.caseNumber} — ${c.caseTitle}` }))}
                optionLabel="label" optionValue="value" className="cd-grow"
                onChange={(e) => setRelatedForm({ ...relatedForm, relatedCaseId: e.value || "" })} />
              <Dropdown value={relatedForm.relation} placeholder="Relation" options={RELATION_TYPES} showClear
                onChange={(e) => setRelatedForm({ ...relatedForm, relation: e.value || "" })} />
              <InputText placeholder="Note (optional)" value={relatedForm.note}
                onChange={(e) => setRelatedForm({ ...relatedForm, note: e.target.value })} />
              <Button icon="pi pi-plus" label="Link" onClick={addRelated} />
            </div>
          </div>
        )}

        {/* ACTS — statutes linked to this case (for validation / reference) */}
        {tab === "Acts" && (
          <div className="flex flex-column gap-3">
            <div className="cd-card">
              {sectionHead("pi-book", "Linked Acts")}
              {linkedActs.length === 0 && <span className="cd-muted">No acts linked to this case yet.</span>}
              <div className="cd-list">
                {linkedActs.map((a) => listItem(a.id, "pi-book", (
                  <>
                    <span className="cd-li-title cd-link-case" onClick={() => navigate(`/dashboard/acts/${a.actId}`)}>
                      {a.actTitle || `Act #${a.actId}`}
                      {a.actNumber && <Tag className="cd-li-type" value={`No. ${a.actNumber}`} severity="info" />}
                    </span>
                    <span className="cd-li-desc">{[a.actYear, a.jurisdiction].filter(Boolean).join(" · ")}</span>
                  </>
                ), hasPermission("CASE_EDIT") && (
                  <Button icon="pi pi-trash" rounded text severity="danger" size="small" aria-label="Unlink act" onClick={() => deleteAct(a.actId)} />
                )))}
              </div>
              <div className="cd-add-row">
                <AutoComplete
                  className="cd-grow" inputClassName="w-full"
                  value={selectedAct}
                  suggestions={actSuggestions}
                  field="label"
                  dropdown
                  forceSelection
                  completeMethod={async (e) => setActSuggestions(await loadActOptions(e.query))}
                  onChange={(e) => setSelectedAct(e.value && typeof e.value === "object" ? e.value : (e.value ? e.value : null))}
                  placeholder="Search acts to link…"
                  emptyMessage="Type to search acts"
                  showEmptyMessage
                />
                {hasPermission("CASE_EDIT") && (
                  <Button icon="pi pi-plus" label={linkingAct ? "Linking…" : "Link"} onClick={addAct}
                    disabled={!selectedAct || typeof selectedAct !== "object" || linkingAct} />
                )}
              </div>
            </div>

            {/* Acts cited by the court on the imported record. Matched ones link
                to our library and can be added to Linked Acts in one click. */}
            {citedActs.length > 0 && (
              <div className="cd-card">
                {sectionHead("pi-book", "Cited by the court")}
                <div className="cd-list">
                  {citedActs.map((a, i) => {
                    const alreadyLinked = a.actId && linkedActs.some((l) => l.actId === a.actId);
                    return listItem(i, "pi-book", (
                      <>
                        {a.actId ? (
                          <span className="cd-li-title cd-link-case" onClick={() => navigate(`/dashboard/acts/${a.actId}`)}>
                            {a.actTitle}
                          </span>
                        ) : (
                          <span className="cd-li-title">
                            {a.name} <Tag className="cd-li-type" value="not in library" severity="secondary" />
                          </span>
                        )}
                        <span className="cd-li-desc">
                          {a.section ? `Section ${a.section}` : ""}
                          {a.actId && a.name !== a.actTitle ? `${a.section ? " · " : ""}cited as “${a.name}”` : ""}
                        </span>
                      </>
                    ), a.actId && (
                      alreadyLinked
                        ? <Tag value="Linked" icon="pi pi-check" severity="success" title="Already in Linked Acts" />
                        : <Button size="small" outlined icon="pi pi-plus" label="Link" tooltip="Add to Linked Acts"
                            tooltipOptions={{ position: "top" }} onClick={() => linkCitedAct(a.actId)} />
                    ));
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "Extra Details" && (
          <div>
            {courtRecordLoading && <div className="flex justify-content-center p-4"><ProgressSpinner style={{ width: 36, height: 36 }} strokeWidth="4" /></div>}
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
          <div className="flex flex-column align-items-start gap-3">
            <p className="cd-muted">View the full activity timeline for this case — payments, expenses, documents, hearings, status changes and more.</p>
            <Button icon="pi pi-clock" label="Open Full Timeline" onClick={() => setShowTimeline(true)} />
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

      {/* Transfer case */}
      <Dialog visible={showTransfer} onHide={() => setShowTransfer(false)} header="Transfer case" modal
        style={{ width: "30rem" }} breakpoints={{ "640px": "95vw" }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button text label="Cancel" onClick={() => setShowTransfer(false)} />
            <Button label={transferring ? "Transferring…" : "Transfer"} onClick={doTransfer} disabled={!transferTo || transferring} />
          </div>
        }>
        <p className="cd-muted mt-0">
          Reassign this case to another advocate. It will move out of your workspace into theirs.
        </p>
        <Dropdown value={transferTo} onChange={(e) => setTransferTo(e.value || "")} className="w-full"
          options={transferGroups} optionGroupLabel="label" optionGroupChildren="items"
          optionLabel="label" optionValue="value" placeholder="Select an advocate…" filter />
        {transferTarget?.crossTeam && (
          <p className="mt-3 mb-0" style={{ color: "var(--danger)" }}>
            This moves the entire matter — hearings, invoices, documents and the client — to
            {" "}{transferTarget?.fullName}&apos;s team.
            Your team will no longer see it.
          </p>
        )}
      </Dialog>

      {/* Daily status of a hearing */}
      <Dialog visible={!!hearingBizModal} onHide={() => setHearingBizModal(null)} header="Daily Status" modal
        style={{ width: "36rem" }} breakpoints={{ "640px": "95vw" }}>
        {hearingBizModal && (
          <>
            {hearingBizModal.court && <p className="cr-modal-court">{hearingBizModal.court}</p>}
            {hearingBizModal.parties && <p className="cr-modal-parties">{hearingBizModal.parties}</p>}
            <dl className="cr-kv">
              {Object.entries(hearingBizModal.fields || {}).map(([k, v]) => (
                <div className="cr-kv-row" key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>
              ))}
            </dl>
          </>
        )}
      </Dialog>

      {/* Add Expense */}
      <Dialog visible={showExpenseModal} onHide={() => setShowExpenseModal(false)} modal
        header={`Add Expense — ${summary.caseNumber}`} style={{ width: "32rem" }} breakpoints={{ "640px": "95vw" }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button text label="Cancel" onClick={() => setShowExpenseModal(false)} />
            <Button label={savingFin ? "Saving..." : "Add Expense"} onClick={addExpense} disabled={savingFin} />
          </div>
        }>
        <div className="flex flex-column gap-3 p-fluid">
          <InputText placeholder="Title *" value={expenseForm.title}
            onChange={(e) => setExpenseForm({ ...expenseForm, title: e.target.value })} />
          <InputNumber placeholder="Amount" value={expenseForm.amount === "" ? null : Number(expenseForm.amount)}
            mode="decimal" minFractionDigits={0} maxFractionDigits={2}
            onValueChange={(e) => setExpenseForm({ ...expenseForm, amount: e.value == null ? "" : String(e.value) })} />
          <InputText placeholder="Category" value={expenseForm.category}
            onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })} />
          <div className="flex flex-column gap-1">
            <label className="cd-modal-label">Payment Date</label>
            <DateField value={expenseForm.paymentDate} onChange={(v) => setExpenseForm({ ...expenseForm, paymentDate: v })} />
          </div>
          <Dropdown value={expenseForm.paymentStatus} placeholder="Payment Status" showClear
            options={PAYMENT_STATUSES} optionLabel="label" optionValue="value"
            onChange={(e) => setExpenseForm({ ...expenseForm, paymentStatus: e.value || "" })} />
        </div>
      </Dialog>

      {/* Add Invoice */}
      <Dialog visible={showInvoiceModal} onHide={() => setShowInvoiceModal(false)} modal
        header={`Add Invoice — ${summary.caseNumber}`} style={{ width: "40rem" }} breakpoints={{ "700px": "95vw" }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button text label="Cancel" onClick={() => setShowInvoiceModal(false)} />
            <Button label={savingFin ? "Saving..." : "Raise Invoice"} onClick={addInvoice} disabled={savingFin || invoiceTotal <= 0} />
          </div>
        }>
        {!summary.clientName && (
          <p className="cd-modal-warn">This case has no client linked. An invoice needs a client — set one on the case first.</p>
        )}
        <div className="flex flex-column gap-3">
          {hearingHistory.length > 0 && (
            <div className="flex flex-column gap-1">
              <label className="cd-modal-label">Link a hearing (optional)</label>
              <Dropdown className="w-full" placeholder="— none (bill by date) —" value={null}
                options={hearingHistory.map((h, idx) => ({
                  value: idx, label: `${h.hearingDate || h.businessDate || "hearing"}${h.purpose ? ` — ${h.purpose}` : ""}`,
                }))}
                optionLabel="label" optionValue="value"
                onChange={(e) => { if (e.value !== null && e.value !== undefined) prefillInvoiceFromHearing(e.value); }} />
            </div>
          )}
          <div className="grid">
            <div className="col-12 sm:col-6 flex flex-column gap-1">
              <label className="cd-modal-label">Invoice Date</label>
              <DateField value={invoiceForm.invoiceDate} onChange={(v) => setInvoiceForm({ ...invoiceForm, invoiceDate: v })} />
            </div>
            <div className="col-12 sm:col-6 flex flex-column gap-1">
              <label className="cd-modal-label">Due Date</label>
              <DateField value={invoiceForm.dueDate} onChange={(v) => setInvoiceForm({ ...invoiceForm, dueDate: v })} />
            </div>
          </div>

          <div className="flex justify-content-between align-items-center">
            <label className="cd-modal-label">Particulars</label>
            <Button text size="small" icon="pi pi-plus" label="Add Particulars" onClick={addInvParticular} />
          </div>
          {invoiceForm.particulars.map((p, i) => (
            <div className="flex gap-2 align-items-center" key={i}>
              <InputText className="flex-1" placeholder="Enter particulars" value={p.description}
                onChange={(e) => setInvParticular(i, "description", e.target.value)} />
              <InputNumber className="cd-inv-amount" inputClassName="w-full" placeholder="₹ Amount"
                value={p.amount === "" ? null : Number(p.amount)} min={0} mode="decimal" minFractionDigits={0} maxFractionDigits={2}
                onValueChange={(e) => setInvParticular(i, "amount", e.value == null ? "" : String(e.value))} />
              <Button icon="pi pi-times" rounded text severity="danger" aria-label="Remove line"
                onClick={() => removeInvParticular(i)} disabled={invoiceForm.particulars.length === 1} />
            </div>
          ))}
          <div className="cd-inv-total">
            <span>Total</span>
            <span>₹ {invoiceTotal.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        </div>
      </Dialog>

      {/* Upload Order */}
      <Dialog visible={showUploadOrder} onHide={() => setShowUploadOrder(false)} modal
        header={`Upload Order — ${summary.caseNumber}`} style={{ width: "32rem" }} breakpoints={{ "640px": "95vw" }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button text label="Cancel" onClick={() => setShowUploadOrder(false)} />
            <Button label={uploadingOrder ? "Uploading…" : "Upload Order"} onClick={uploadOrder} disabled={uploadingOrder || !orderForm.file} />
          </div>
        }>
        <div className="flex flex-column gap-2 p-fluid">
          <label className="cd-modal-label">Document name</label>
          <InputText placeholder="e.g. Interim Order 21-01-2025" value={orderForm.documentName}
            onChange={(e) => setOrderForm({ ...orderForm, documentName: e.target.value })} />
          <label className="cd-modal-label">Order date</label>
          <DateField value={orderForm.orderDate} onChange={(v) => setOrderForm({ ...orderForm, orderDate: v })} />
          <label className="cd-modal-label">Description (optional)</label>
          <InputText placeholder="Notes about this order" value={orderForm.description}
            onChange={(e) => setOrderForm({ ...orderForm, description: e.target.value })} />
          <label className="cd-modal-label">File *</label>
          <input type="file" className="cd-file-input" onChange={(e) => setOrderForm({ ...orderForm, file: e.target.files?.[0] || null })} />
        </div>
      </Dialog>

      {/* Add / Edit Hearing or Event */}
      <Dialog visible={showHearingModal} onHide={closeHearingModal} modal
        header={`${editingEventId
          ? (eventModalMode === "event" ? "Edit Event" : "Edit Hearing")
          : (eventModalMode === "event" ? "Add Event" : "Add Hearing")} — ${summary.caseNumber}`}
        style={{ width: "36rem" }} breakpoints={{ "640px": "95vw" }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button text label="Cancel" onClick={closeHearingModal} />
            <Button onClick={addHearing} disabled={savingFin || !hearingForm.title.trim() || !hearingForm.date}
              label={savingFin ? "Saving..." : (editingEventId
                ? (eventModalMode === "event" ? "Save Event" : "Save Hearing")
                : (eventModalMode === "event" ? "Add Event" : "Add Hearing"))} />
          </div>
        }>
        <div className="flex flex-column gap-2 p-fluid">
          <InputText placeholder="Title *" value={hearingForm.title}
            onChange={(e) => setHearingForm({ ...hearingForm, title: e.target.value })} />
          {eventModalMode === "event" && (
            <Dropdown value={hearingForm.eventType} options={OTHER_EVENT_TYPES} optionLabel="label" optionValue="value"
              onChange={(e) => setHearingForm({ ...hearingForm, eventType: e.value })} />
          )}
          <div className="grid">
            <div className="col-12 sm:col-6 flex flex-column gap-1">
              <label className="cd-modal-label">Date *</label>
              <DateField value={hearingForm.date} onChange={(v) => setHearingForm({ ...hearingForm, date: v })} />
            </div>
            <div className="col-12 sm:col-6 flex flex-column gap-1">
              <label className="cd-modal-label">Time</label>
              <Calendar timeOnly hourFormat="24" showIcon icon="pi pi-clock" value={hmToDate(hearingForm.time)}
                onChange={(e) => setHearingForm({ ...hearingForm, time: dateToHm(e.value) })} />
            </div>
          </div>

          {eventModalMode === "hearing" && (
            <>
              <label className="cd-modal-label">Purpose / stage</label>
              <Dropdown value={hearingForm.purpose} options={HEARING_PURPOSES} placeholder="Select purpose…" showClear
                onChange={(e) => setHearingForm({ ...hearingForm, purpose: e.value || "" })} />
              <InputText placeholder="Court" value={hearingForm.court}
                onChange={(e) => setHearingForm({ ...hearingForm, court: e.target.value })} />
              <InputText placeholder="Bench / Hall no." value={hearingForm.benchHall}
                onChange={(e) => setHearingForm({ ...hearingForm, benchHall: e.target.value })} />
              <InputText placeholder="Judge / Coram" value={hearingForm.judge}
                onChange={(e) => setHearingForm({ ...hearingForm, judge: e.target.value })} />
              <label className="cd-modal-label">Next hearing date</label>
              <DateField value={hearingForm.nextDate} onChange={(v) => setHearingForm({ ...hearingForm, nextDate: v })} />
              <InputTextarea rows={3} autoResize placeholder="Outcome / order (after the hearing)" value={hearingForm.outcome}
                onChange={(e) => setHearingForm({ ...hearingForm, outcome: e.target.value })} />
            </>
          )}

          <label className="cd-modal-label">Description</label>
          <InputTextarea rows={3} autoResize placeholder="Notes" value={hearingForm.description}
            onChange={(e) => setHearingForm({ ...hearingForm, description: e.target.value })} />
        </div>
      </Dialog>
    </div>
  );
}
