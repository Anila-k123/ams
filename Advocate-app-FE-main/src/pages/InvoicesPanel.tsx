import { useState, useEffect, useCallback } from "react";
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
import { formatCurrency } from "../utils/formatCurrency";
import usePagination from "../hooks/usePagination";
import "../assets/styles/InvoicesPanel.css";

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

const STATUS_SEVERITY: Record<string, any> = { PAID: "success", UNPAID: "warning", OVERDUE: "danger" };

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

  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail === "create-invoice") {
        setShowModal(true);
      }
    };
    window.addEventListener("assistant-open-modal", handler);
    return () => window.removeEventListener("assistant-open-modal", handler);
  }, []);

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
    setNewInvoice({ ...newInvoice, [e.target.name]: e.target.value });
  };

  const handleClose = () => {
    if (submitting) return;
    setShowModal(false);
    setNewInvoice(EMPTY_INVOICE);
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
    setSubmitting(true);
    try {
      const particulars = newInvoice.particulars
        .map((p: any) => ({ description: (p.description || "").trim(), amount: parseFloat(p.amount) || 0 }))
        .filter((p: any) => p.description || p.amount);
      await withLoading(
        api.post("/api/invoices/create", {
          // No invoiceNumber — the server assigns the next one.
          particulars,
          invoiceDate: newInvoice.invoiceDate ? newInvoice.invoiceDate : null,
          dueDate: newInvoice.dueDate ? newInvoice.dueDate : null,
          caseEntity: { id: Number(newInvoice.caseId) },
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
        }),
        "Generating Invoice..."
      );

      setSubmitting(false);
      setShowModal(false);
      setNewInvoice(EMPTY_INVOICE);
      fetchInvoices();
      fetchSummary();
      success("Invoice created.");
    } catch (err: any) {
      setSubmitting(false);
      console.error("Error creating invoice:", err);
      error(err.response?.data || "Failed to create invoice.");
    }
  };

  const doPay = async (id: any) => {
    try {
      await withLoading(api.put(`/api/invoices/pay/${id}`, {}), "Sending Invoice...");
      fetchInvoices();
      fetchSummary();
      success("Invoice marked as Paid!");
    } catch (err) {
      console.error("Error paying invoice:", err);
      error("Failed to pay invoice.");
    }
  };

  const handlePay = (id: any) => {
    confirmDialog({
      message: "Mark this invoice as Paid?",
      header: "Mark paid",
      icon: "pi pi-check-circle",
      accept: () => doPay(id),
    });
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

      <div className="invoices-table-card">
        {invoices.length === 0 ? (
          <p className="no-data">No invoices generated yet.</p>
        ) : (
          <DataTable value={invoices} dataKey="id" size="small" scrollable
            rowClassName={(inv: any) => (highlightedId === inv.id ? "highlight-row" : "")}>
            <Column header="Invoice Number" body={(inv) => <strong>{inv.invoiceNumber}</strong>} />
            <Column header="Client" field="clientName" />
            <Column header="Case Number" body={(inv) => inv.caseEntity?.caseNumber} />
            <Column header="Amount" body={(inv) => formatCurrency(inv.amount)} />
            <Column header="Due Date" body={(inv) => new Date(inv.dueDate).toLocaleDateString()} />
            <Column header="Status" body={(inv) => <Tag value={inv.status} severity={STATUS_SEVERITY[inv.status] || "info"} rounded />} />
            <Column header="Actions" body={(inv) => (
              <div className="flex gap-2 white-space-nowrap">
                {inv.status !== "PAID" && hasPermission("INVOICE_EDIT") && (
                  <Button size="small" outlined severity="success" icon="pi pi-check-circle" label="Mark Paid" onClick={() => handlePay(inv.id)} />
                )}
                <Button size="small" outlined icon="pi pi-download" label="Export" tooltip="Download PDF"
                  onClick={() => handleDownloadPDF(inv.id, inv.invoiceNumber)} />
              </div>
            )} />
          </DataTable>
        )}
        {totalElements > 0 && (
          <Paginator first={page * size} rows={size} totalRecords={totalElements} rowsPerPageOptions={[10, 20, 50, 100]}
            onPageChange={(e) => { if (e.rows !== size) { setSize(e.rows); setPage(0); } else setPage(e.page); }} />
        )}
      </div>

      <Dialog visible={showModal} onHide={handleClose} closable={!submitting} closeOnEscape={!submitting} dismissableMask={!submitting}
        style={{ width: "min(760px, 95vw)" }} modal
        header={<div><div>Generate Invoice</div><div className="inv-modal-subtitle">Create an invoice for the selected client.</div></div>}>
        <form onSubmit={handleSubmit} className="inv-form" noValidate>
          <div className="inv-form-group">
            <label htmlFor="inv-caseId">Associated Case</label>
            <Dropdown inputId="inv-caseId" value={newInvoice.caseId} options={caseOptions} filter autoFocus
              placeholder="Select a case..." onChange={(e) => setNewInvoice({ ...newInvoice, caseId: e.value })} />
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
                  placeholder="Enter particulars (e.g. Appearance for hearing on 03 Sep)"
                  value={p.description}
                  onChange={(e) => setParticular(i, "description", e.target.value)}
                />
                <InputText
                  className="inv-particular-amt"
                  type="number" step="0.01" min="0" placeholder="₹ Amount"
                  value={p.amount}
                  onChange={(e) => setParticular(i, "amount", e.target.value)}
                />
                <Button type="button" text rounded severity="danger" icon="pi pi-times" tooltip="Remove line" aria-label="Remove line"
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
              {input("recipientGstin", "Recipient GSTIN/UIN", "e.g. 33AACCI3508E2Z3")}
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
            <Button type="submit" label={submitting ? "Generating..." : "Raise Invoice"} loading={submitting}
              disabled={submitting || !newInvoice.caseId || invoiceTotal <= 0} />
          </div>
        </form>
      </Dialog>
    </div>
  );
}
