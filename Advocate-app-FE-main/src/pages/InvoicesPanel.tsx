import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "react-router-dom";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { Paginator } from "primereact/paginator";
import { Skeleton } from "primereact/skeleton";
import { Tag } from "primereact/tag";
import { IconField } from "primereact/iconfield";
import { InputIcon } from "primereact/inputicon";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import api from "../api/client";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import { useAuth } from "../context/AuthContext";
import { formatCurrency } from "../utils/formatCurrency";
import { PAYMENT_MODES } from "../constants/payments";
import usePagination from "../hooks/usePagination";
import "../assets/styles/InvoicesPanel.css";
import { usePageModal } from "../utils/pageModal";
import FieldError from "../components/FieldError";
import { gstinError, gstinState, gstinStateMismatch, normaliseCode } from "../utils/validators";

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

const STATUS_SEVERITY: Record<string, any> = {
  PAID: "success", PARTIAL: "info", UNPAID: "warning", OVERDUE: "danger", CANCELLED: "secondary",
};
const STATUS_LABEL: Record<string, string> = {
  PAID: "Paid", PARTIAL: "Part-paid", UNPAID: "Unpaid", OVERDUE: "Overdue", CANCELLED: "Cancelled",
};
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY_PAYMENT = { amount: "", paymentMode: "", referenceNumber: "", paymentDate: "", description: "" };

// An advocate-raised invoice waiting for accounts (invoices.models.InvoiceRequest).
const REQUEST_STATUS: Record<string, { label: string; severity: any }> = {
  SUBMITTED: { label: "With accounts", severity: "info" },
  RETURNED: { label: "Returned", severity: "warning" },
};

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
  const { hasPermission } = usePermission() as any;
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

  useEffect(() => {
    fetchCases();
    fetchSummary();
  }, []);

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
    requestAnimationFrame(() => document.querySelector(".invoices-table-card .highlight-row")
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
    confirmDialog({
      message: "Withdraw this invoice? Accounts will no longer see it.",
      header: "Withdraw invoice",
      icon: "pi pi-undo",
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
  const inr = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      error(err.response?.data?.error || err.response?.data || "Failed to save invoice.");
    }
  };

  // The form's wording follows what pressing the button will do.
  const formTitle = mode.kind === "review" ? "Review Invoice"
    : mode.kind === "resend" ? "Edit Invoice" : "Generate Invoice";
  const formSubtitle = mode.kind === "review"
    ? `Raised by ${mode.request.requestedByName || "an advocate"}. Check it, correct if needed, then issue it or return it.`
    : canIssue && mode.kind === "new" ? "Create an invoice for the selected client."
    : "Accounts will check it and issue it to the client.";
  const submitLabel = mode.kind === "review" || (mode.kind === "new" && canIssue) ? "Issue Invoice" : "Send to Accounts";

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
    confirmDialog({
      message: "Mark this invoice as Paid without recording a payment? Use this only if the money was already recorded elsewhere.",
      header: "Mark paid",
      icon: "pi pi-check-circle",
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

  if (loading) {
    return (
      <div className="invoices-container flex flex-column gap-3">
        <Skeleton height="2.5rem" />
        <div className="grid">{[0, 1, 2].map((i) => <div key={i} className="col-12 md:col-4"><Skeleton height="6rem" /></div>)}</div>
        <Skeleton height="20rem" />
      </div>
    );
  }

  const input = (name: string, label: string, placeholder = "", extra: any = {}) => (
    <div className="inv-form-group">
      <label htmlFor={`inv-${name}`}>{label}</label>
      <InputText id={`inv-${name}`} name={name} value={newInvoice[name]} onChange={handleChange} placeholder={placeholder} {...extra} />
    </div>
  );

  const card = (cls: string, icon: string, title: string, amount: any, count: number, note: string) => (
    <div className="col-12 md:col-4">
      <div className={`inv-card ${cls}`}>
        <div className="inv-card-header">
          <span>{title}</span>
          <i className={`pi ${icon} card-icon`} />
        </div>
        <h3>{formatCurrency(amount)}</h3>
        <p>{note} · {count} invoice{count === 1 ? "" : "s"}</p>
      </div>
    </div>
  );

  return (
    <div className="invoices-container">
      <ConfirmDialog />
      <div className="flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
        <p className="subtle m-0">Track billing summaries, issue client invoices, and record payments.</p>
        {hasPermission("INVOICE_CREATE") && (
          <Button icon="pi pi-plus" label="Generate Invoice" onClick={() => setShowModal(true)} />
        )}
      </div>

      <IconField iconPosition="left" className="mb-3">
        <InputIcon className="pi pi-search" />
        <InputText className="w-full" placeholder="Search by invoice number, client, or case..." value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setHighlightedId(null); }} />
      </IconField>

      <div className="grid mb-2">
        {card("paid", "pi-check-circle", "Paid Invoices", summary.paidAmount, summary.paid, "Total cash collected")}
        {card("unpaid", "pi-hourglass", "Unpaid Invoices", summary.unpaidAmount, summary.unpaid, "Outstanding client dues")}
        {card("overdue", "pi-exclamation-circle", "Overdue Dues", summary.overdueAmount, summary.overdue, "Payment deadline passed")}
      </div>

      {(requests.length > 0 || canIssue) && (
        <div className="invoices-table-card mb-3">
          <div className="inv-requests-heading">
            <strong>Waiting to be issued</strong>
            <span className="subtle">
              {canIssue ? "Raised by advocates. Review each one, then issue it or return it." : "Sent to accounts. Returned ones need your changes."}
            </span>
          </div>
          {requests.length === 0 ? (
            <p className="subtle m-0">Nothing waiting. Invoices advocates send to accounts appear here to review and issue.</p>
          ) : (
          <DataTable value={requests} dataKey="id" size="small" scrollable>
            <Column header="Case Number" field="caseNumber" />
            <Column header="Client" field="clientName" />
            <Column header="Amount" body={(r) => formatCurrency(r.amount)} />
            <Column header="Raised by" field="requestedByName" />
            <Column header="Status" body={(r) => (
              <div>
                <Tag value={REQUEST_STATUS[r.status]?.label || r.status} severity={REQUEST_STATUS[r.status]?.severity || "info"} rounded />
                {r.status === "RETURNED" && r.note && <div className="inv-request-note">{r.note}</div>}
              </div>
            )} />
            <Column header="Actions" body={(r) => {
              const mine = r.requestedById === myId;
              return (
                <div className="flex gap-2 white-space-nowrap">
                  {canIssue && r.status === "SUBMITTED" && (
                    <Button size="small" icon="pi pi-eye" label="Review" onClick={() => openRequest(r, "review")} />
                  )}
                  {mine && (
                    <Button size="small" outlined icon="pi pi-pencil" label={r.status === "RETURNED" ? "Edit & Resend" : "Edit"}
                      onClick={() => openRequest(r, "resend")} />
                  )}
                  {mine && (
                    <Button size="small" text severity="danger" icon="pi pi-undo" tooltip="Withdraw" tooltipOptions={{ position: "top" }} aria-label="Withdraw"
                      onClick={() => withdrawRequest(r)} />
                  )}
                </div>
              );
            }} />
          </DataTable>
          )}
        </div>
      )}

      <div className="invoices-table-card">
        {invoices.length === 0 ? (
          <p className="no-data">No invoices generated yet.</p>
        ) : (
          <DataTable value={invoices} dataKey="id" size="small" scrollable
            rowClassName={(inv: any) => (highlightedId === inv.id ? "highlight-row" : "")}>
            <Column header="Invoice Number" body={(inv) => (
              <div>
                <strong>{inv.invoiceNumber}</strong>
                {inv.issuedAt && (
                  <div className="inv-sub-line" title={inv.clientNotifiedAt
                    ? `Client emailed ${new Date(inv.clientNotifiedAt).toLocaleString()}`
                    : "The client was not emailed: no email on file, or client email is switched off"}>
                    Issued {new Date(inv.issuedAt).toLocaleDateString()}
                    {inv.clientNotifiedAt ? " · client emailed" : " · client not emailed"}
                  </div>
                )}
              </div>
            )} />
            <Column header="Client" field="clientName" />
            <Column header="Case Number" body={(inv) => inv.caseEntity?.caseNumber} />
            <Column header="Amount" body={(inv) => (
              <div>
                <div className={inv.status === "CANCELLED" ? "inv-struck" : undefined}>{formatCurrency(inv.amount)}</div>
                {inv.paidAmount > 0 && inv.balance > 0 && (
                  <div className="inv-sub-line">Paid {formatCurrency(inv.paidAmount)} · Due {formatCurrency(inv.balance)}</div>
                )}
              </div>
            )} />
            <Column header="Due Date" body={(inv) => new Date(inv.dueDate).toLocaleDateString()} />
            <Column header="Status" body={(inv) => (
              <div>
                <Tag value={STATUS_LABEL[inv.status] || inv.status} severity={STATUS_SEVERITY[inv.status] || "info"} rounded />
                {inv.status === "CANCELLED" && inv.cancelReason && (
                  <div className="inv-request-note">{inv.cancelReason}{inv.cancelledByName ? ` (${inv.cancelledByName})` : ""}</div>
                )}
              </div>
            )} />
            <Column header="Raised by" body={(inv) => inv.raisedByName || "—"} />
            <Column header="Handled by" body={(inv) => inv.handledByName || "—"} />
            <Column header="Actions" body={(inv) => {
              const open = inv.status !== "PAID" && inv.status !== "CANCELLED";
              const untouched = open && !(inv.paidAmount > 0);
              return (
              <div className="flex gap-2 white-space-nowrap">
                {open && hasPermission("PAYMENT_CREATE") && (
                  <Button size="small" outlined severity="success" icon="pi pi-wallet" label="Record Payment" onClick={() => openPayment(inv)} />
                )}
                {untouched && hasPermission("INVOICE_EDIT") && (
                  <Button size="small" text severity="success" icon="pi pi-check-circle" tooltip="Mark paid (money recorded elsewhere)" tooltipOptions={{ position: "top" }}
                    aria-label="Mark paid" onClick={() => handlePay(inv.id)} />
                )}
                {untouched && hasPermission("INVOICE_EDIT") && (
                  <Button size="small" text severity="danger" icon="pi pi-ban" tooltip="Cancel invoice" tooltipOptions={{ position: "top" }} aria-label="Cancel invoice"
                    onClick={() => { setCancelling(inv); setCancelReason(""); }} />
                )}
                {hasPermission("REPORT_EXPORT") && (
                  <Button size="small" outlined icon="pi pi-download" label="Export" tooltip="Download PDF" tooltipOptions={{ position: "top" }}
                    onClick={() => handleDownloadPDF(inv.id, inv.invoiceNumber)} />
                )}
              </div>
              );
            }} />
          </DataTable>
        )}
        {totalElements > 0 && (
          <Paginator first={page * size} rows={size} totalRecords={totalElements} rowsPerPageOptions={[10, 20, 50, 100]}
            onPageChange={(e) => { if (e.rows !== size) { setSize(e.rows); setPage(0); } else setPage(e.page); }} />
        )}
      </div>

      <Dialog visible={showModal} onHide={handleClose} closable={!submitting} closeOnEscape={!submitting} dismissableMask={!submitting}
        style={{ width: "min(760px, 95vw)" }} modal
        header={<div><div>{formTitle}</div><div className="inv-modal-subtitle">{formSubtitle}</div></div>}>
        <form onSubmit={handleSubmit} className="inv-form" noValidate>
          {mode.kind === "resend" && mode.request.status === "RETURNED" && mode.request.note && (
            <div className="inv-request-note inv-request-note-box">
              <strong>Returned by {mode.request.reviewedByName || "accounts"}:</strong> {mode.request.note}
            </div>
          )}
          <div className="inv-form-group">
            <label htmlFor="inv-caseId">Associated Case</label>
            {/* A raised invoice stays on its case; only a new one picks a case. */}
            <Dropdown inputId="inv-caseId" value={newInvoice.caseId} options={caseOptions} filter autoFocus
              disabled={mode.kind !== "new"}
              placeholder={mode.kind !== "new" ? `${mode.request.caseNumber || ""} — ${mode.request.caseTitle || ""}` : "Select a case..."}
              onChange={(e) => selectCase(e.value)} />
          </div>

          <div className="inv-form-row">
            {input("invoiceDate", "Invoice Date", "", { type: "date", required: true })}
            {input("dueDate", "Due Date", "", { type: "date", required: true })}
          </div>

          <div className="inv-particulars">
            <div className="flex justify-content-between align-items-center">
              <label>Particulars</label>
              <Button type="button" text size="small" icon="pi pi-plus" label="Add Particulars" onClick={addParticular} />
            </div>
            {newInvoice.particulars.map((p: any, i: number) => (
              <div className="inv-particular-row" key={i}>
                <InputText
                  className="inv-particular-desc"
                  placeholder="Particulars"
                  value={p.description}
                  onChange={(e) => setParticular(i, "description", e.target.value)}
                />
                <InputText
                  className="inv-particular-amt"
                  type="number" step="0.01" min="0" placeholder="₹ Amount"
                  value={p.amount}
                  onChange={(e) => setParticular(i, "amount", e.target.value)}
                />
                <Button type="button" text rounded severity="danger" icon="pi pi-times" tooltip="Remove line" tooltipOptions={{ position: "top" }} aria-label="Remove line"
                  onClick={() => removeParticular(i)} disabled={newInvoice.particulars.length === 1} />
              </div>
            ))}
            <div className="inv-particulars-total">
              <span>{isForward ? "Taxable value" : "Total"}</span>
              <span>₹ {inr(invoiceTotal)}</span>
            </div>
            {isForward && (
              <>
                <div className="inv-particulars-total inv-tax-line">
                  <span>GST @ {gstRateNum || 0}% (CGST+SGST / IGST)</span>
                  <span>₹ {inr(gstAmount)}</span>
                </div>
                <div className="inv-particulars-total inv-grand-total">
                  <span>Grand total</span>
                  <span>₹ {inr(grandTotal)}</span>
                </div>
              </>
            )}
          </div>

          <div className="inv-tax-details">
            <label className="inv-tax-heading">Recipient / GST details <span>(for the tax invoice)</span></label>
            <div className="inv-form-row">
              <div className="inv-form-group">
                <label htmlFor="inv-taxMode">GST treatment</label>
                <Dropdown inputId="inv-taxMode" value={newInvoice.taxMode} options={TAX_MODES}
                  onChange={(e) => setNewInvoice({ ...newInvoice, taxMode: e.value })} />
              </div>
              {isForward && input("gstRate", "GST rate (%)", "18", { type: "number", step: "0.01", min: "0" })}
            </div>
            {input("kindAttn", "Kind Attn (contact person)", "e.g. Ms S V Archana")}
            <div className="inv-form-row">
              <div className="inv-form-group">
                <label htmlFor="inv-recipientGstin">Recipient GSTIN</label>
                <InputText id="inv-recipientGstin" name="recipientGstin" value={newInvoice.recipientGstin}
                  onChange={handleChange} onBlur={() => setGstinTouched(true)} maxLength={15}
                  placeholder="e.g. 33ABCDE1234F1Z7 (blank if the client has none)"
                  className={gstinTouched && recipientGstinError ? "p-invalid" : undefined} />
                <FieldError error={gstinTouched ? recipientGstinError : ""}
                  warning={gstinStateMismatch(newInvoice.recipientGstin, newInvoice.recipientState)} />
              </div>
              {input("recipientState", "State", "e.g. TAMIL NADU")}
              {input("recipientStateCode", "State Code", "e.g. 33")}
            </div>
            <div className="inv-form-group">
              <label htmlFor="inv-recipientAddress">Billing address</label>
              <InputTextarea id="inv-recipientAddress" name="recipientAddress" rows={2} value={newInvoice.recipientAddress}
                onChange={handleChange} placeholder="Full billing address (one line per row)" />
            </div>
            {input("placeOfSupply", "Place of Supply", "Defaults to State (e.g. TAMIL NADU - 33)")}
          </div>

          {selectedCase && (
            <div className="inv-selected-case">
              <div className="inv-case-detail-row">
                <span className="inv-case-detail-label">Case Number</span>
                <span className="inv-case-detail-value">{selectedCase.caseNumber}</span>
              </div>
              <div className="inv-case-detail-row">
                <span className="inv-case-detail-label">Case Title</span>
                <span className="inv-case-detail-value">{selectedCase.caseTitle}</span>
              </div>
              <div className="inv-case-detail-row">
                <span className="inv-case-detail-label">Client Name</span>
                <span className="inv-case-detail-value">{selectedCase.clientName || "—"}</span>
              </div>
            </div>
          )}

          <div className="flex justify-content-end gap-2 mt-2">
            <Button type="button" outlined label="Cancel" onClick={handleClose} disabled={submitting} />
            {mode.kind === "review" && (
              <Button type="button" outlined severity="warning" icon="pi pi-reply" label="Return to Advocate"
                disabled={submitting} onClick={() => { setReturning(mode.request); setReturnNote(""); }} />
            )}
            <Button type="submit" label={submitting ? "Saving..." : submitLabel} loading={submitting}
              disabled={submitting || !newInvoice.caseId || invoiceTotal <= 0} />
          </div>
        </form>
      </Dialog>

      <Dialog visible={!!returning} onHide={() => setReturning(null)} modal style={{ width: "min(480px, 95vw)" }}
        header="Return to Advocate">
        <div className="inv-form">
          <div className="inv-form-group">
            <label htmlFor="inv-return-note">What should {returning?.requestedByName || "the advocate"} change?</label>
            <InputTextarea id="inv-return-note" rows={4} autoFocus value={returnNote}
              onChange={(e) => setReturnNote(e.target.value)} placeholder="What to change" />
          </div>
          <div className="flex justify-content-end gap-2">
            <Button type="button" outlined label="Cancel" onClick={() => setReturning(null)} />
            <Button type="button" severity="warning" label="Return" disabled={!returnNote.trim()} onClick={sendBack} />
          </div>
        </div>
      </Dialog>

      <Dialog visible={!!paying} onHide={() => setPaying(null)} modal style={{ width: "min(480px, 95vw)" }}
        header={<div><div>Record Payment</div><div className="inv-modal-subtitle">
          {paying ? `${paying.invoiceNumber} · ${paying.clientName || ""} · due ${formatCurrency(due(paying))}` : ""}
        </div></div>}>
        <div className="inv-form">
          <div className="inv-form-row">
            <div className="inv-form-group">
              <label htmlFor="pay-amount">Amount received</label>
              <InputText id="pay-amount" type="number" step="0.01" min="0" autoFocus value={payment.amount}
                onChange={(e) => setPayment({ ...payment, amount: e.target.value })} />
            </div>
            <div className="inv-form-group">
              <label htmlFor="pay-date">Date</label>
              <InputText id="pay-date" type="date" value={payment.paymentDate}
                onChange={(e) => setPayment({ ...payment, paymentDate: e.target.value })} />
            </div>
          </div>
          <div className="inv-form-row">
            <div className="inv-form-group">
              <label htmlFor="pay-mode">Mode</label>
              <Dropdown inputId="pay-mode" value={payment.paymentMode} options={PAYMENT_MODES} placeholder="Payment mode"
                onChange={(e) => setPayment({ ...payment, paymentMode: e.value })} />
            </div>
            <div className="inv-form-group">
              <label htmlFor="pay-ref">Reference</label>
              <InputText id="pay-ref" value={payment.referenceNumber} placeholder="Transaction / cheque no."
                onChange={(e) => setPayment({ ...payment, referenceNumber: e.target.value })} />
            </div>
          </div>
          {paying && payAmount > 0 && payAmount < due(paying) - 0.005 && (
            <p className="subtle m-0">Part-payment: {formatCurrency(due(paying) - payAmount)} will still be due.</p>
          )}
          <div className="flex justify-content-end gap-2">
            <Button type="button" outlined label="Cancel" onClick={() => setPaying(null)} />
            <Button type="button" severity="success" label="Record Payment" disabled={payAmount <= 0} onClick={savePayment} />
          </div>
        </div>
      </Dialog>

      <Dialog visible={!!cancelling} onHide={() => setCancelling(null)} modal style={{ width: "min(480px, 95vw)" }}
        header="Cancel Invoice">
        <div className="inv-form">
          <p className="m-0">
            {cancelling?.invoiceNumber} stays on record with its number but is no longer owed. Raise a new invoice if one is still needed.
          </p>
          <div className="inv-form-group">
            <label htmlFor="inv-cancel-reason">Reason</label>
            <InputTextarea id="inv-cancel-reason" rows={3} autoFocus value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason" />
          </div>
          <div className="flex justify-content-end gap-2">
            <Button type="button" outlined label="Keep Invoice" onClick={() => setCancelling(null)} />
            <Button type="button" severity="danger" label="Cancel Invoice" disabled={!cancelReason.trim()} onClick={confirmCancel} />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
