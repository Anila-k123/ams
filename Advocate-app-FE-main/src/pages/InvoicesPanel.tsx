// Invoices: GST invoices against cases. Advocates raise, accounts issue; after
// issue, accounts record payments against the invoice or cancel a wrong one.
import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import api from "../api/client";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import { useAuth } from "../context/AuthContext";
import { formatCurrency } from "../utils/formatCurrency";
import { PAYMENT_MODES } from "../constants/payments";
import usePagination from "../hooks/usePagination";
import { usePageModal } from "../utils/pageModal";
import { dueDateError, gstinError, gstinState, gstinStateMismatch, normaliseCode, todayISO } from "../utils/validators";
import { Button, Chip, Icon, PageHead, Panel, PopMenu, Skel, type MenuItem, type Tone } from "../ui/kit";
import { Field, SearchInput, SelectField, TextArea, TextField } from "../ui/forms";
import { Modal, Drawer, confirm } from "../ui/overlays";
import { DataTable, type Column } from "../ui/DataTable";
import "../ui/pages/finance.css";

const EMPTY_INVOICE = {
  invoiceDate: "",
  dueDate: "",
  caseId: "",
  // Line-item breakdown; the amount is the sum of these (no single-amount box).
  particulars: [{ description: "", amount: "" }],
  // Recipient GST/tax details for the invoice (snapshotted on the invoice).
  kindAttn: "",
  recipientGstin: "",
  recipientState: "",
  recipientStateCode: "",
  recipientAddress: "",
  placeOfSupply: "",
  // GST treatment: 'rcm' (reverse charge, recipient pays) or 'forward' (firm charges GST).
  taxMode: "rcm",
  gstRate: "18",
};

const TAX_MODES = [
  { label: "Reverse charge (recipient pays GST)", value: "rcm" },
  { label: "Forward charge (firm charges GST)", value: "forward" },
];

const STATUS_TONE: Record<string, Tone> = {
  PAID: "ok", PARTIAL: "info", UNPAID: "warn", OVERDUE: "bad", CANCELLED: "",
};
const STATUS_LABEL: Record<string, string> = {
  PAID: "Paid", PARTIAL: "Part-paid", UNPAID: "Unpaid", OVERDUE: "Overdue", CANCELLED: "Cancelled",
};
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_PAYMENT = { amount: "", paymentMode: "", referenceNumber: "", paymentDate: "", description: "" };

// An advocate-raised invoice waiting for accounts (invoices.models.InvoiceRequest).
const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
  SUBMITTED: { label: "With accounts", tone: "info" },
  RETURNED: { label: "Returned", tone: "warn" },
};

// en-IN date (7 Oct 2026). Plain ISO dates are read as local dates so IST never shifts them.
const fdate = (v?: string | null) => {
  if (!v) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};
const inr = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Indian-system amount in words for the paper invoice ("Rupees One Lakh ... Only").
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const three = (n: number) => [n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred` : "", two(n % 100)].filter(Boolean).join(" ");
function rupeesInWords(amount: number) {
  const r = Math.floor(Math.abs(amount));
  const p = Math.round((Math.abs(amount) - r) * 100);
  const parts: string[] = [];
  const cr = Math.floor(r / 1e7), la = Math.floor((r % 1e7) / 1e5), th = Math.floor((r % 1e5) / 1e3), rest = r % 1e3;
  if (cr) parts.push(`${cr >= 100 ? three(cr) : two(cr)} Crore`);
  if (la) parts.push(`${two(la)} Lakh`);
  if (th) parts.push(`${two(th)} Thousand`);
  if (rest) parts.push(three(rest));
  const words = parts.join(" ") || "Zero";
  return `Rupees ${words}${p ? ` and ${two(p)} Paise` : ""} Only`;
}

// What the invoice form is doing:
//   new     - a fresh invoice (issued directly, or sent to accounts)
//   resend  - the advocate edits their own waiting / returned request
//   review  - accounts check a submitted request before issuing it
type FormMode = { kind: "new" } | { kind: "resend" | "review"; request: any };

export default function InvoicesPanel() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [totalElements, setTotalElements] = useState(0);
  const [cases, setCases] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({
    paid: 0, unpaid: 0, overdue: 0,
    paidAmount: 0, unpaidAmount: 0, overdueAmount: 0, monthlyRevenue: 0,
  });
  const [showModal, setShowModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newInvoice, setNewInvoice] = useState<any>(EMPTY_INVOICE);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [highlightedId, setHighlightedId] = useState<any>(null);
  const location = useLocation();
  const { page, setPage, size, setSize } = usePagination({ defaultSize: 20, resetOn: [searchText] });

  const { withLoading } = useLoading() as any;
  const { success, error } = useToast() as any;
  const { hasPermission, loading: permsLoading } = usePermission() as any;
  const { advocateId: myId } = useAuth();
  // Raising a bill and issuing it are separate: advocates raise, accounts
  // (and seniors) issue. Without INVOICE_ISSUE the form sends it to accounts.
  const canIssue = hasPermission("INVOICE_ISSUE");
  const canRaise = hasPermission("INVOICE_CREATE");
  const [mode, setMode] = useState<FormMode>({ kind: "new" });
  const [requests, setRequests] = useState<any[]>([]);
  const [returning, setReturning] = useState<any>(null);   // request being sent back
  const [returnNote, setReturnNote] = useState("");
  // After issue, accounts own the invoice: payments against it, and
  // cancelling a wrong one (it is never edited or deleted).
  const [paying, setPaying] = useState<any>(null);          // invoice taking a payment
  const [payment, setPayment] = useState<any>(EMPTY_PAYMENT);
  const [cancelling, setCancelling] = useState<any>(null);  // invoice being cancelled
  const [cancelReason, setCancelReason] = useState("");
  const [viewing, setViewing] = useState<any>(null);        // invoice open in the drawer
  const [menu, setMenu] = useState<{ el: HTMLElement; inv: any } | null>(null);

  const fetchRequests = useCallback(async () => {
    if (!canRaise) return;
    try {
      setRequests((await api.get("/api/invoices/requests")).data || []);
    } catch (err) {
      console.error("Error fetching invoice requests:", err);
    }
  }, [canRaise]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const fetchInvoices = useCallback(async () => {
    try {
      const res = await api.get("/api/invoices", {
        params: { page, size, keyword: searchText || undefined }
      });
      setInvoices(res.data.content || []);
      setTotalElements(res.data.totalElements || 0);
    } catch (err) {
      console.error("Error fetching invoices:", err);
    } finally {
      setLoading(false);
    }
  }, [page, size, searchText]);

  const fetchCases = async () => {
    // Roles without CASE_VIEW (e.g. accounts) are refused this list; don't ask.
    if (!hasPermission("CASE_VIEW")) return;
    try {
      const res = await api.get("/api/cases/my-cases");
      setCases(res.data || []);
    } catch (err) {
      console.error("Error fetching cases:", err);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await api.get("/api/invoices/summary");
      setSummary(res.data || { paid: 0, unpaid: 0, overdue: 0, monthlyRevenue: 0 });
    } catch (err) {
      console.error("Error fetching invoice summary:", err);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  useEffect(() => { fetchSummary(); }, []);
  // Cases wait for permissions, or the CASE_VIEW check would skip them on first paint.
  useEffect(() => {
    if (!permsLoading) fetchCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permsLoading]);

  // Keep the open drawer in step with a refreshed list (after a payment, say).
  useEffect(() => {
    setViewing((v: any) => (v ? invoices.find((i) => i.id === v.id) || v : v));
  }, [invoices]);

  // Quick Actions / Lisa: open Generate Invoice.
  usePageModal(["create-invoice"], () => setShowModal(true));

  // Global Search navigation — read incoming state
  useEffect(() => {
    const st: any = location.state;
    if (st?.search) {
      setSearchText(st.search);
      setHighlightedId(st.id || null);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Scroll the highlighted row (from global search) into view.
  useEffect(() => {
    if (highlightedId == null) return;
    requestAnimationFrame(() => document.querySelector(".fin-invoices tr.hl")
      ?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [invoices, highlightedId]);

  const handleChange = (e: any) => {
    const { name, value } = e.target;
    if (name === "recipientGstin") return setRecipientGstin(value);
    setNewInvoice({ ...newInvoice, [name]: value });
  };

  // A valid GSTIN gives the recipient's state and its code (the first two
  // digits): fill them when empty or when they came from the GSTIN before.
  const setRecipientGstin = (raw: string) => {
    const g = normaliseCode(raw);
    setNewInvoice((prev: any) => {
      const next = { ...prev, recipientGstin: g };
      if (!gstinError(g) && g) {
        const st = gstinState(g);
        const prevAuto = gstinState(prev.recipientGstin);
        if (!prev.recipientState || prev.recipientState === prevAuto) next.recipientState = st;
        if (!prev.recipientStateCode || prev.recipientStateCode === normaliseCode(prev.recipientGstin).slice(0, 2)) {
          next.recipientStateCode = g.slice(0, 2);
        }
      }
      return next;
    });
  };
  const [gstinTouched, setGstinTouched] = useState(false);
  const recipientGstinError = gstinError(newInvoice.recipientGstin);

  // Recipient fields filled in from the client (field -> value we put there),
  // so picking a different case replaces our suggestions but never what the
  // user typed over them.
  const prefilled = useRef<Record<string, string>>({});
  const RECIPIENT_FIELDS = ["kindAttn", "recipientGstin", "recipientState", "recipientStateCode", "recipientAddress"];
  const selectCase = async (caseId: any) => {
    setNewInvoice((prev: any) => ({ ...prev, caseId }));
    if (!caseId) return;
    let defaults: any = {};
    try {
      defaults = (await api.get("/api/invoices/recipient-defaults", { params: { caseId } })).data || {};
    } catch { /* the form still works; the server fills blanks on save */ }
    setNewInvoice((prev: any) => {
      if (String(prev.caseId) !== String(caseId)) return prev;   // user moved on
      const next = { ...prev };
      const filled: Record<string, string> = {};
      for (const f of RECIPIENT_FIELDS) {
        const ours = prefilled.current[f];
        const untouched = !prev[f] || (ours !== undefined && prev[f] === ours);
        if (untouched) {
          next[f] = defaults[f] || "";
          if (defaults[f]) filled[f] = defaults[f];
        }
      }
      prefilled.current = filled;
      return next;
    });
  };

  const resetForm = () => {
    setShowModal(false);
    setNewInvoice(EMPTY_INVOICE);
    setMode({ kind: "new" });
    prefilled.current = {};
    setGstinTouched(false);
  };

  const handleClose = () => {
    if (submitting) return;
    resetForm();
  };

  // Open a request in the form: the advocate to change and resend it, or
  // accounts to check (and correct) it before issuing.
  const openRequest = (req: any, kind: "resend" | "review") => {
    const p = req.payload || {};
    const rows = (p.particulars || []).map((r: any) => ({ description: r.description || "", amount: String(r.amount ?? "") }));
    setNewInvoice({
      ...EMPTY_INVOICE,
      ...Object.fromEntries(Object.keys(EMPTY_INVOICE).filter((k) => p[k] != null).map((k) => [k, String(p[k])])),
      caseId: String(req.caseId),
      particulars: rows.length ? rows : EMPTY_INVOICE.particulars,
      gstRate: String(p.gstRate ?? "18"),
      taxMode: p.taxMode || "rcm",
    });
    prefilled.current = {};
    setMode({ kind, request: req });
    setShowModal(true);
  };

  const withdrawRequest = (req: any) => {
    confirm({
      title: "Withdraw invoice?",
      message: "Withdraw this invoice? Accounts will no longer see it.",
      confirmLabel: "Withdraw",
      danger: true,
      accept: async () => {
        try {
          await withLoading(api.delete(`/api/invoices/requests/${req.id}`), "Withdrawing...");
          fetchRequests();
          success("Invoice withdrawn.");
        } catch (err: any) {
          error(err.response?.data?.error || "Failed to withdraw.");
        }
      },
    });
  };

  const sendBack = async () => {
    if (!returning || !returnNote.trim()) return;
    try {
      await withLoading(api.post(`/api/invoices/requests/${returning.id}/return`, { note: returnNote.trim() }), "Returning...");
      setReturning(null);
      setReturnNote("");
      resetForm();
      fetchRequests();
      success("Returned to the advocate.");
    } catch (err: any) {
      error(err.response?.data?.error || "Failed to return the invoice.");
    }
  };

  const setParticular = (i: number, field: string, value: any) =>
    setNewInvoice((prev: any) => ({
      ...prev,
      particulars: prev.particulars.map((p: any, idx: number) => (idx === i ? { ...p, [field]: value } : p)),
    }));
  const addParticular = () =>
    setNewInvoice((prev: any) => ({ ...prev, particulars: [...prev.particulars, { description: "", amount: "" }] }));
  const removeParticular = (i: number) =>
    setNewInvoice((prev: any) => {
      const rows = prev.particulars.filter((_: any, idx: number) => idx !== i);
      return { ...prev, particulars: rows.length ? rows : [{ description: "", amount: "" }] };
    });
  const invoiceTotal = newInvoice.particulars.reduce((s: number, p: any) => s + (parseFloat(p.amount) || 0), 0);
  // Live GST preview for the form (the server recomputes + splits CGST/SGST vs IGST).
  const isForward = newInvoice.taxMode === "forward";
  const gstRateNum = parseFloat(newInvoice.gstRate) || 0;
  const gstAmount = isForward ? Math.round(invoiceTotal * gstRateNum) / 100 : 0;
  const grandTotal = invoiceTotal + gstAmount;

  // The due date may be today or later, and not before the invoice date. Not
  // checked when accounts issue a waiting request (its date may have passed meanwhile).
  const checkDue = mode.kind !== "review";
  const dueMin = checkDue ? [todayISO(), newInvoice.invoiceDate || ""].sort().pop() : undefined;
  const dueError = checkDue ? dueDateError(newInvoice.dueDate, "Due date", newInvoice.invoiceDate, "invoice date") : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (dueError) {
      error(dueError);
      return;
    }
    if (recipientGstinError) {
      setGstinTouched(true);
      error("Fix the recipient GSTIN first: " + recipientGstinError);
      return;
    }
    setSubmitting(true);
    try {
      const particulars = newInvoice.particulars
        .map((p: any) => ({ description: (p.description || "").trim(), amount: parseFloat(p.amount) || 0 }))
        .filter((p: any) => p.description || p.amount);
      const body = {
        // No invoiceNumber — the server assigns the next one on issue.
        particulars,
        invoiceDate: newInvoice.invoiceDate ? newInvoice.invoiceDate : null,
        dueDate: newInvoice.dueDate ? newInvoice.dueDate : null,
        caseId: Number(newInvoice.caseId),
        // Recipient GST/tax details (blank ones are prefilled server-side
        // from this client's most recent invoice).
        kindAttn: newInvoice.kindAttn,
        recipientGstin: newInvoice.recipientGstin,
        recipientState: newInvoice.recipientState,
        recipientStateCode: newInvoice.recipientStateCode,
        recipientAddress: newInvoice.recipientAddress,
        placeOfSupply: newInvoice.placeOfSupply,
        taxMode: newInvoice.taxMode,
        gstRate: newInvoice.gstRate,
      };
      let done = "Invoice issued.";
      if (mode.kind === "review") {
        await withLoading(api.post(`/api/invoices/requests/${mode.request.id}/issue`, body), "Issuing Invoice...");
      } else if (mode.kind === "resend") {
        await withLoading(api.put(`/api/invoices/requests/${mode.request.id}`, body), "Sending to Accounts...");
        done = "Sent to accounts.";
      } else if (canIssue) {
        await withLoading(api.post("/api/invoices/create", body), "Generating Invoice...");
      } else {
        await withLoading(api.post("/api/invoices/requests", body), "Sending to Accounts...");
        done = "Sent to accounts to issue.";
      }

      setSubmitting(false);
      resetForm();
      fetchInvoices();
      fetchSummary();
      fetchRequests();
      success(done);
    } catch (err: any) {
      setSubmitting(false);
      console.error("Error saving invoice:", err);
      const d = err.response?.data;
      error(d?.error || (typeof d === "string" ? d : "") || "Failed to save invoice.");
    }
  };

  // The form's wording follows what pressing the button will do.
  const formTitle = mode.kind === "review" ? "Review invoice"
    : mode.kind === "resend" ? "Edit invoice" : "Generate invoice";
  const formSubtitle = mode.kind === "review"
    ? `Raised by ${mode.request.requestedByName || "an advocate"}. Check it, correct if needed, then issue it or return it.`
    : canIssue && mode.kind === "new" ? "Create an invoice for the selected client."
    : "Accounts will check it and issue it to the client.";
  const submitLabel = mode.kind === "review" || (mode.kind === "new" && canIssue) ? "Issue invoice" : "Send to accounts";

  const doPay = async (id: any) => {
    try {
      await withLoading(api.put(`/api/invoices/pay/${id}`, {}), "Updating Invoice...");
      fetchInvoices();
      fetchSummary();
      success("Invoice marked as Paid!");
    } catch (err: any) {
      console.error("Error paying invoice:", err);
      error(err.response?.data?.error || "Failed to mark the invoice paid.");
    }
  };

  // For money already recorded without being linked to this invoice.
  const handlePay = (id: any) => {
    confirm({
      title: "Mark paid?",
      message: "Mark this invoice as Paid without recording a payment? Use this only if the money was already recorded elsewhere.",
      confirmLabel: "Mark paid",
      accept: () => doPay(id),
    });
  };

  const openPayment = (inv: any) => {
    setPaying(inv);
    setPayment({ ...EMPTY_PAYMENT, amount: String(inv.balance ?? inv.amount), paymentDate: today() });
  };

  const due = (inv: any) => inv?.balance ?? inv?.amount ?? 0;
  const payAmount = parseFloat(payment.amount) || 0;

  const savePayment = async () => {
    if (!paying || payAmount <= 0) return;
    try {
      await withLoading(api.post("/api/payments/create", {
        invoiceId: paying.id, amount: payAmount,
        paymentMode: payment.paymentMode || null, referenceNumber: payment.referenceNumber || null,
        paymentDate: payment.paymentDate || null, description: payment.description || null,
      }), "Recording Payment...");
      const full = payAmount >= due(paying) - 0.005;
      setPaying(null);
      fetchInvoices();
      fetchSummary();
      success(full ? "Payment recorded. Invoice paid." : "Part-payment recorded.");
    } catch (err: any) {
      error(err.response?.data?.error || "Failed to record the payment.");
    }
  };

  const confirmCancel = async () => {
    if (!cancelling || !cancelReason.trim()) return;
    try {
      await withLoading(api.post(`/api/invoices/${cancelling.id}/cancel`, { reason: cancelReason.trim() }), "Cancelling...");
      setCancelling(null);
      setCancelReason("");
      fetchInvoices();
      fetchSummary();
      success("Invoice cancelled.");
    } catch (err: any) {
      error(err.response?.data?.error || "Failed to cancel the invoice.");
    }
  };

  const handleDownloadPDF = async (id: any, invNum: string) => {
    try {
      const res = await api.get(`/api/reports/invoice/${id}`, { responseType: "blob" });
      const blob = new Blob([res.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${invNum}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error("Error exporting PDF:", err);
      error("Failed to download PDF invoice sheet.");
    }
  };

  const selectedCase = cases.find(c => c.id === Number(newInvoice.caseId));
  const caseOptions = cases.map((c) => ({
    value: String(c.id),
    label: `${c.caseNumber} — ${c.caseTitle} (Client: ${c.clientName || "N/A"})`,
  }));

  // What can be done to an issued invoice, by whom.
  const invActions = (inv: any) => {
    const open = inv.status !== "PAID" && inv.status !== "CANCELLED";
    const untouched = open && !(inv.paidAmount > 0);
    return {
      pay: open && hasPermission("PAYMENT_CREATE"),
      markPaid: untouched && hasPermission("INVOICE_EDIT"),
      cancel: untouched && hasPermission("INVOICE_EDIT"),
      pdf: hasPermission("REPORT_EXPORT"),
    };
  };
  const menuItems = (inv: any): MenuItem[] => {
    const a = invActions(inv);
    const items: MenuItem[] = [{ label: "View", icon: "eye", onClick: () => setViewing(inv) }];
    if (a.pay) items.push({ label: "Record payment", icon: "rupee", onClick: () => openPayment(inv) });
    if (a.markPaid) items.push({ label: "Mark paid (recorded elsewhere)", icon: "check", onClick: () => handlePay(inv.id) });
    if (a.pdf) items.push({ label: "Download PDF", icon: "download", onClick: () => handleDownloadPDF(inv.id, inv.invoiceNumber) });
    if (a.cancel) items.push("-", { label: "Cancel invoice", icon: "x", danger: true, onClick: () => { setCancelling(inv); setCancelReason(""); } });
    return items;
  };

  const statusChip = (s: string) => <Chip tone={STATUS_TONE[s] ?? "info"}>{STATUS_LABEL[s] || s}</Chip>;

  const columns: Column<any>[] = [
    { key: "invoiceNumber", label: "Invoice no", render: (inv) => (
      <div>
        <span className="mono small cell-title nowrap">{inv.invoiceNumber}</span>
        {inv.issuedAt && (
          <div className="cell-sub" title={inv.clientNotifiedAt
            ? `Client emailed ${new Date(inv.clientNotifiedAt).toLocaleString("en-IN")}`
            : "The client was not emailed: no email on file, or client email is switched off"}>
            Issued {fdate(inv.issuedAt)}{inv.clientNotifiedAt ? " · client emailed" : " · client not emailed"}
          </div>
        )}
      </div>
    ) },
    { key: "client", label: "Client", render: (inv) => inv.clientName || "—" },
    { key: "case", label: "Case", hideSm: true, render: (inv) => (
      <div><span className="mono small">{inv.caseEntity?.caseNumber || "—"}</span>
        {inv.caseTitle && <div className="cell-sub ellipsis fin-maxw">{inv.caseTitle}</div>}</div>
    ) },
    { key: "date", label: "Date", hideSm: true, render: (inv) => <span className="nowrap">{fdate(inv.invoiceDate)}</span> },
    { key: "due", label: "Due", render: (inv) => (
      <span className={`nowrap${inv.status === "OVERDUE" ? " fin-bad" : inv.status === "PAID" || inv.status === "CANCELLED" ? " faint" : ""}`}>{fdate(inv.dueDate)}</span>
    ) },
    { key: "amount", label: "Total", align: "right", render: (inv) => (
      <div>
        <span className={`mono${inv.status === "CANCELLED" ? " fin-struck" : ""}`}>{inr(Number(inv.amount) || 0)}</span>
        {inv.paidAmount > 0 && inv.balance > 0 && (
          <div className="cell-sub">Paid {formatCurrency(inv.paidAmount)} · Due {formatCurrency(inv.balance)}</div>
        )}
      </div>
    ) },
    { key: "status", label: "Status", render: (inv) => (
      <div>
        {statusChip(inv.status)}
        {inv.status === "CANCELLED" && inv.cancelReason && (
          <div className="cell-sub">{inv.cancelReason}{inv.cancelledByName ? ` (${inv.cancelledByName})` : ""}</div>
        )}
      </div>
    ) },
    // One column for both people keeps the table narrow enough for its actions.
    { key: "raised", label: "Raised / handled", hideSm: true, render: (inv) => (
      <><div className="small nowrap">{inv.raisedByName || "—"}</div>
        {inv.handledByName && inv.handledByName !== inv.raisedByName && <div className="cell-sub nowrap">{inv.handledByName}</div>}</>
    ) },
    { key: "a", label: <span className="sr-only">Actions</span>, className: "actions", render: (inv) => (
      <div className="row fin-actions">
        {invActions(inv).pay && (
          <Button size="sm" icon="rupee" onClick={() => openPayment(inv)}>Record payment</Button>
        )}
        <button type="button" className="icon-btn" aria-label={`More actions for ${inv.invoiceNumber}`}
          onClick={(e) => setMenu({ el: e.currentTarget, inv })}><Icon name="more" /></button>
      </div>
    ) },
  ];

  const requestColumns: Column<any>[] = [
    { key: "caseNumber", label: "Case", render: (r) => <span className="mono small">{r.caseNumber || "—"}</span> },
    { key: "clientName", label: "Client", render: (r) => r.clientName || "—" },
    { key: "amount", label: "Amount", align: "right", render: (r) => <span className="mono">{inr(Number(r.amount) || 0)}</span> },
    { key: "requestedByName", label: "Raised by", hideSm: true, render: (r) => r.requestedByName || "—" },
    { key: "status", label: "Status", render: (r) => (
      <div>
        <Chip tone={REQUEST_STATUS[r.status]?.tone || "info"}>{REQUEST_STATUS[r.status]?.label || r.status}</Chip>
        {r.status === "RETURNED" && r.note && <div className="cell-sub">{r.note}</div>}
      </div>
    ) },
    { key: "a", label: <span className="sr-only">Actions</span>, className: "actions", render: (r) => {
      const mine = r.requestedById === myId;
      return (
        <div className="row fin-actions">
          {canIssue && r.status === "SUBMITTED" && (
            <Button size="sm" variant="primary" icon="eye" onClick={() => openRequest(r, "review")}>Review</Button>
          )}
          {mine && (
            <Button size="sm" icon="edit" onClick={() => openRequest(r, "resend")}>{r.status === "RETURNED" ? "Edit & resend" : "Edit"}</Button>
          )}
          {mine && (
            <Button size="sm" variant="ghost" iconOnly icon="restore" aria-label="Withdraw" title="Withdraw" onClick={() => withdrawRequest(r)} />
          )}
        </div>
      );
    } },
  ];

  if (loading) {
    return (
      <div className="stack fin-page">
        <Skel h={40} w="40%" />
        <Skel h={96} />
        <Skel h={320} />
      </div>
    );
  }

  const v = viewing;
  const vActs = v ? invActions(v) : null;
  const vRows: any[] = v ? (v.particulars?.length ? v.particulars : [{ description: v.caseTitle || "Professional fees", amount: v.amount }]) : [];

  return (
    <div className="fin-page">
      <PageHead title="Invoices" sub="GST invoices for legal services, SAC 998212. Issue to clients and record what they pay."
        actions={canRaise && <Button variant="primary" icon="plus" onClick={() => setShowModal(true)}>Generate invoice</Button>} />

      <div className="figures fin-figs">
        <div className="figure"><div className="lbl">Collected</div><div className="val">{formatCurrency(summary.paidAmount)}</div>
          <div className="meta">{summary.paid || 0} paid invoice{summary.paid === 1 ? "" : "s"}</div></div>
        <div className="figure"><div className="lbl">Outstanding</div><div className="val">{formatCurrency(summary.unpaidAmount)}</div>
          <div className="meta">{summary.unpaid || 0} unpaid</div></div>
        <div className="figure"><div className="lbl">Overdue</div><div className={`val${summary.overdueAmount > 0 ? " fin-bad" : ""}`}>{formatCurrency(summary.overdueAmount)}</div>
          <div className="meta">{summary.overdue || 0} past due date</div></div>
        {canRaise && (
          <div className="figure"><div className="lbl">Waiting to be issued</div><div className="val">{requests.length}</div>
            <div className="meta">{canIssue ? "Raised by advocates" : "With accounts or returned"}</div></div>
        )}
      </div>

      {(requests.length > 0 || canIssue) && (
        <Panel title="Waiting to be issued" flush className="fin-block"
          sub={canIssue ? "Raised by advocates. Review each one, then issue it or return it." : "Sent to accounts. Returned ones need your changes."}>
          <DataTable rows={requests} rowKey={(r) => r.id} columns={requestColumns} flush pageSize={10} caption="Invoices waiting to be issued"
            empty={{ icon: "receipt", title: "Nothing waiting", text: "Invoices advocates send to accounts appear here to review and issue." }} />
        </Panel>
      )}

      <div className="toolbar">
        <SearchInput value={searchText} placeholder="Search invoice no, client or case"
          onChange={(val) => { setSearchText(val); setHighlightedId(null); }} />
        <span className="grow" />
        <label className="sr-only" htmlFor="inv-size">Rows per page</label>
        <select id="inv-size" className="input" value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>
          {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} per page</option>)}
        </select>
      </div>

      <div className="fin-invoices">
        <DataTable rows={invoices} rowKey={(inv) => inv.id} columns={columns} caption="Invoices"
          onRow={(inv) => setViewing(inv)}
          rowClass={(inv) => (highlightedId === inv.id ? "hl" : undefined)}
          pageSize={size} page={page} total={totalElements} onPage={setPage}
          empty={{ icon: "receipt", title: searchText ? "No invoices match" : "No invoices yet", text: "Generate an invoice against a case to bill a client." }} />
      </div>

      {menu && <PopMenu anchor={menu.el} items={menuItems(menu.inv)} onClose={() => setMenu(null)} align="right" />}

      {/* ------------ Invoice preview: the paper invoice ------------ */}
      <Drawer open={!!v} onClose={() => setViewing(null)} wide
        title={<>Invoice <span className="mono">{v?.invoiceNumber}</span></>}
        sub={v && <><span className="muted">{v.clientName || "—"}</span>{statusChip(v.status)}</>}
        footer={v && <>
          {vActs?.cancel && <Button variant="danger" icon="x" onClick={() => { setCancelling(v); setCancelReason(""); }}>Cancel invoice</Button>}
          <span className="grow" />
          {vActs?.markPaid && <Button icon="check" onClick={() => handlePay(v.id)}>Mark paid</Button>}
          {vActs?.pdf && <Button icon="download" onClick={() => handleDownloadPDF(v.id, v.invoiceNumber)}>Download PDF</Button>}
          {vActs?.pay && <Button variant="primary" icon="rupee" onClick={() => openPayment(v)}>Record payment</Button>}
        </>}>
        {v && (
          <div className="p3-inv">
            <div className="p3-inv-top">
              <div>
                <h3>Tax invoice</h3>
                <div className="muted">Legal services, SAC 998212</div>
              </div>
              <dl className="kv">
                <dt>Invoice no</dt><dd className="mono">{v.invoiceNumber}</dd>
                <dt>Date</dt><dd>{fdate(v.invoiceDate)}</dd>
                <dt>Due</dt><dd className={v.status === "OVERDUE" ? "fin-bad" : undefined}>{fdate(v.dueDate)}</dd>
                {v.issuedAt && <><dt>Issued</dt><dd>{fdate(v.issuedAt)}</dd></>}
              </dl>
            </div>
            <div className="p3-box">
              <div><div className="faint xs">Bill to</div><b>{v.clientName || "—"}</b>
                <div className="faint xs">{v.clientNotifiedAt ? `Emailed ${fdate(v.clientNotifiedAt)}` : "Client not emailed"}</div></div>
              <div><div className="faint xs">Matter</div><b className="mono">{v.caseEntity?.caseNumber || "—"}</b>
                <div className="muted">{v.caseTitle}</div></div>
            </div>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th scope="col">#</th><th scope="col">Particulars</th><th scope="col" className="amt">Amount</th></tr></thead>
                <tbody>
                  {vRows.map((it: any, n: number) => (
                    <tr key={n}><td>{n + 1}</td><td>{it.description || "—"}</td><td className="amt mono">{inr(Number(it.amount) || 0)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="kv p3-tot fin-tot">
              <dt className="fin-tot-lbl">Total</dt><dd className="right fin-tot-val">₹ {inr(Number(v.amount) || 0)}</dd>
              {v.paidAmount > 0 && <><dt>Received</dt><dd className="mono right">{inr(Number(v.paidAmount) || 0)}</dd></>}
              {v.status !== "CANCELLED" && v.balance > 0 && <><dt>Balance due</dt><dd className="mono right">{inr(Number(v.balance) || 0)}</dd></>}
            </dl>
            <div className="p3-words"><span className="faint xs">Amount in words</span><div><b>{rupeesInWords(Number(v.amount) || 0)}</b></div></div>
            {v.status === "CANCELLED" && (
              <div className="callout bad fin-block-top"><Icon name="warn" size="sm" />
                <div>Cancelled{v.cancelledByName ? ` by ${v.cancelledByName}` : ""}{v.cancelReason ? `: ${v.cancelReason}` : "."}</div></div>
            )}
            <dl className="kv fin-block-top">
              <dt>Raised by</dt><dd>{v.raisedByName || "—"}</dd>
              <dt>Handled by</dt><dd>{v.handledByName || "—"}</dd>
            </dl>
            <p className="faint xs fin-block-top">The PDF carries the firm letterhead, GST breakdown and bank details.</p>
          </div>
        )}
      </Drawer>

      {/* ------------ Generate / review / resend ------------ */}
      <Modal open={showModal} onClose={handleClose} dismissable={!submitting} size="wide" title={formTitle} sub={formSubtitle}
        footer={<>
          <button type="button" className="btn ghost" onClick={handleClose} disabled={submitting}>Cancel</button>
          {mode.kind === "review" && (
            <Button icon="restore" disabled={submitting} onClick={() => { setReturning(mode.request); setReturnNote(""); }}>Return to advocate</Button>
          )}
          <Button type="submit" form="inv-form" variant="primary" loading={submitting}
            disabled={submitting || !newInvoice.caseId || invoiceTotal <= 0}>{submitting ? "Saving…" : submitLabel}</Button>
        </>}>
        <form id="inv-form" onSubmit={handleSubmit} className="stack" noValidate>
          {mode.kind === "resend" && mode.request.status === "RETURNED" && mode.request.note && (
            <div className="callout warn"><Icon name="warn" size="sm" />
              <div><b>Returned by {mode.request.reviewedByName || "accounts"}:</b> {mode.request.note}</div></div>
          )}
          {/* A raised invoice stays on its case; only a new one picks a case. */}
          {mode.kind === "new" ? (
            <SelectField label="Case" required value={newInvoice.caseId} options={caseOptions} placeholder="Select a case…"
              autoFocus onChange={(e) => selectCase(e.target.value)} />
          ) : (
            <TextField label="Case" value={`${mode.request.caseNumber || ""} — ${mode.request.caseTitle || ""}`} disabled readOnly />
          )}

          <div className="form-grid">
            <TextField label="Invoice date" type="date" name="invoiceDate" required value={newInvoice.invoiceDate} onChange={handleChange} />
            <TextField label="Due date" type="date" name="dueDate" required min={dueMin} error={dueError} value={newInvoice.dueDate} onChange={handleChange} />
          </div>

          <fieldset className="fin-fieldset">
            <legend className="fieldset-title">Particulars</legend>
            {newInvoice.particulars.map((p: any, i: number) => (
              <div className="fin-line" key={i}>
                <input className="input" aria-label={`Particular ${i + 1}`} placeholder="Particulars" value={p.description}
                  onChange={(e) => setParticular(i, "description", e.target.value)} />
                <input className="input mono fin-amt" aria-label={`Amount for line ${i + 1}`} type="number" step="0.01" min="0" placeholder="₹ Amount"
                  value={p.amount} onChange={(e) => setParticular(i, "amount", e.target.value)} />
                <Button variant="ghost" iconOnly icon="x" aria-label={`Remove line ${i + 1}`} title="Remove line"
                  onClick={() => removeParticular(i)} disabled={newInvoice.particulars.length === 1} />
              </div>
            ))}
            <div><Button size="sm" variant="ghost" icon="plus" onClick={addParticular}>Add line</Button></div>
            <dl className="kv fin-sum">
              <dt>{isForward ? "Taxable value" : "Total"}</dt><dd className="mono right">₹ {inr(invoiceTotal)}</dd>
              {isForward && <>
                <dt>GST @ {gstRateNum || 0}% (CGST+SGST / IGST)</dt><dd className="mono right">₹ {inr(gstAmount)}</dd>
                <dt className="fin-tot-lbl">Grand total</dt><dd className="mono right fin-tot-lbl">₹ {inr(grandTotal)}</dd>
              </>}
            </dl>
          </fieldset>

          <fieldset className="fin-fieldset">
            <legend className="fieldset-title">Recipient and GST details <span className="faint small">(for the tax invoice)</span></legend>
            <div className="form-grid">
              <SelectField label="GST treatment" value={newInvoice.taxMode} options={TAX_MODES}
                onChange={(e) => setNewInvoice({ ...newInvoice, taxMode: e.target.value })} />
              {isForward
                ? <TextField label="GST rate (%)" name="gstRate" type="number" step="0.01" min="0" placeholder="18" value={newInvoice.gstRate} onChange={handleChange} />
                : <div />}
              <TextField full label="Kind Attn (contact person)" name="kindAttn" placeholder="e.g. Ms S V Archana" value={newInvoice.kindAttn} onChange={handleChange} />
              <TextField label="Recipient GSTIN" name="recipientGstin" className="mono" maxLength={15}
                placeholder="e.g. 33ABCDE1234F1Z7" value={newInvoice.recipientGstin}
                onChange={handleChange} onBlur={() => setGstinTouched(true)}
                error={gstinTouched ? recipientGstinError : ""}
                hint={gstinStateMismatch(newInvoice.recipientGstin, newInvoice.recipientState) || "Leave blank if the client has none."} />
              <div className="form-grid fin-state">
                <TextField label="State" name="recipientState" placeholder="e.g. TAMIL NADU" value={newInvoice.recipientState} onChange={handleChange} />
                <TextField label="State code" name="recipientStateCode" placeholder="e.g. 33" value={newInvoice.recipientStateCode} onChange={handleChange} />
              </div>
              <TextArea full label="Billing address" name="recipientAddress" rows={2} placeholder="Full billing address (one line per row)"
                value={newInvoice.recipientAddress} onChange={handleChange} />
              <TextField full label="Place of supply" name="placeOfSupply" placeholder="Defaults to State (e.g. TAMIL NADU - 33)"
                value={newInvoice.placeOfSupply} onChange={handleChange} />
            </div>
          </fieldset>

          {selectedCase && (
            <dl className="kv fin-case">
              <dt>Case number</dt><dd className="mono">{selectedCase.caseNumber}</dd>
              <dt>Case title</dt><dd>{selectedCase.caseTitle}</dd>
              <dt>Client</dt><dd>{selectedCase.clientName || "—"}</dd>
            </dl>
          )}
        </form>
      </Modal>

      <Modal open={!!returning} onClose={() => setReturning(null)} size="narrow" title="Return to advocate"
        footer={<>
          <button type="button" className="btn ghost" onClick={() => setReturning(null)}>Cancel</button>
          <Button variant="primary" icon="restore" disabled={!returnNote.trim()} onClick={sendBack}>Return</Button>
        </>}>
        <TextArea label={`What should ${returning?.requestedByName || "the advocate"} change?`} rows={4} autoFocus
          value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="What to change" />
      </Modal>

      <Modal open={!!paying} onClose={() => setPaying(null)} size="narrow" title="Record payment"
        sub={paying ? <><span className="mono">{paying.invoiceNumber}</span> · {paying.clientName || ""} · due {formatCurrency(due(paying))}</> : undefined}
        footer={<>
          <button type="button" className="btn ghost" onClick={() => setPaying(null)}>Cancel</button>
          <Button variant="primary" icon="rupee" disabled={payAmount <= 0} onClick={savePayment}>Record payment</Button>
        </>}>
        <div className="form-grid">
          <TextField label="Amount received" type="number" step="0.01" min="0" autoFocus className="mono" value={payment.amount}
            onChange={(e) => setPayment({ ...payment, amount: e.target.value })} />
          <TextField label="Date" type="date" value={payment.paymentDate}
            onChange={(e) => setPayment({ ...payment, paymentDate: e.target.value })} />
          <SelectField label="Mode" value={payment.paymentMode} options={PAYMENT_MODES} placeholder="Payment mode"
            onChange={(e) => setPayment({ ...payment, paymentMode: e.target.value })} />
          <TextField label="Reference" placeholder="Transaction / cheque no." value={payment.referenceNumber}
            onChange={(e) => setPayment({ ...payment, referenceNumber: e.target.value })} />
          {paying && payAmount > 0 && payAmount < due(paying) - 0.005 && (
            <Field full>{() => <div className="callout info"><Icon name="info" size="sm" />
              <div>Part-payment: {formatCurrency(due(paying) - payAmount)} will still be due.</div></div>}</Field>
          )}
        </div>
      </Modal>

      <Modal open={!!cancelling} onClose={() => setCancelling(null)} size="narrow" title="Cancel invoice"
        footer={<>
          <button type="button" className="btn ghost" onClick={() => setCancelling(null)}>Keep invoice</button>
          <Button variant="danger-solid" disabled={!cancelReason.trim()} onClick={confirmCancel}>Cancel invoice</Button>
        </>}>
        <div className="stack">
          <p className="muted">
            <span className="mono">{cancelling?.invoiceNumber}</span> stays on record with its number but is no longer owed. Raise a new invoice if one is still needed.
          </p>
          <TextArea label="Reason" rows={3} autoFocus value={cancelReason} required
            onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason" />
        </div>
      </Modal>
    </div>
  );
}
