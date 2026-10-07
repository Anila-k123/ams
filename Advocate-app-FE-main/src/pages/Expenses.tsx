// Expenses: court fees, travel and out-of-pocket costs per case, set against
// what the client has paid. Per-case detail opens in a drawer; today's and the
// month's reports open in a modal and can be printed or downloaded.
import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import ReportService from "../services/ReportService";
import { formatCurrency } from "../utils/formatCurrency";
import { PAYMENT_MODES } from "../constants/payments";
import { usePageModal } from "../utils/pageModal";
import { Button, Icon, PageHead, StatusChip } from "../ui/kit";
import { SearchInput, SelectField, TextArea, TextField } from "../ui/forms";
import { Modal, Drawer, confirm } from "../ui/overlays";
import { DataTable, type Column } from "../ui/DataTable";
import "../ui/pages/finance.css";

const CATEGORIES = ["Travel", "Court Fees", "Documents", "Stationery", "Miscellaneous"];

const today = () => new Date().toISOString().split("T")[0];
// en-IN date (7 Oct 2026); plain ISO dates read as local dates.
const fdate = (v?: string | null) => {
  if (!v) return "—";
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) ? new Date(`${s.slice(0, 10)}T00:00:00`) : new Date(s);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// A small read-only table for the drawer and report modals.
function MiniTable({ head, rows, empty, total }: { head: { label: string; amt?: boolean }[]; rows: React.ReactNode[][]; empty: string; total?: React.ReactNode }) {
  if (!rows.length) return <p className="faint small">{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="t">
        <thead><tr>{head.map((h) => <th key={h.label} scope="col" className={h.amt ? "amt" : undefined}>{h.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={head[j]?.amt ? "amt mono" : undefined}>{c}</td>)}</tr>)}
          {total !== undefined && (
            <tr><td colSpan={head.length - 1}><b>Total</b></td><td className="amt mono"><b>{total}</b></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Expenses() {
  const [cases, setCases] = useState<any[]>([]);
  const [pickCase, setPickCase] = useState(false);
  const [filteredCases, setFilteredCases] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [selectedCase, setSelectedCase] = useState<any>(null);

  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showTodayModal, setShowTodayModal] = useState(false);
  const [showMonthlyModal, setShowMonthlyModal] = useState(false);

  const [todaySummary, setTodaySummary] = useState<any>(null);
  const [monthlyReport, setMonthlyReport] = useState<any>(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [editExpenseId, setEditExpenseId] = useState<any>(null);

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [highlightedId, setHighlightedId] = useState<any>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const location = useLocation();

  const { token } = useAuth();
  const { withLoading } = useLoading() as any;
  const { success, error } = useToast() as any;
  const { hasPermission, loading: permsLoading } = usePermission() as any;

  // ----------------- FORMS -----------------
  const [newExpense, setNewExpense] = useState<any>({
    title: "",
    amount: "",
    category: "",
    description: "",
    paymentMode: "",
    paymentStatus: "",
    referenceNumber: "",
    paymentDate: today(),
    caseId: "",
    expenseType: "CLIENT_CASE",
  });

  const [newPayment, setNewPayment] = useState<any>({
    amount: "",
    paymentMode: "",
    referenceNumber: "",
    paymentDate: today(),
    description: "",
    caseId: "",
    invoiceId: null,
  });
  // The case's invoices still owed on, for "against invoice" on a payment.
  const [openInvoices, setOpenInvoices] = useState<any[]>([]);

  // ------------------ FETCH CASES ------------------
  useEffect(() => {
    if (!token) {
      setErrorMessage("Please login first.");
      return;
    }
    if (permsLoading) return;   // wait for permissions, or the CASE_VIEW check misfires
    fetchCases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, permsLoading]);

  // AI Assistant / quick actions: open the Add Expense form. It opens without
  // a case, so the form shows a case picker (see pickCase).
  usePageModal(["create-expense"], () => handleAddExpense(null));

  // Global Search navigation — read incoming state
  useEffect(() => {
    const st: any = location.state;
    if (st?.search) {
      setSearchText(st.search);
      setHighlightedId(st.id || null);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    // apply search + status filter when cases, searchText or status change
    const key = searchText.toLowerCase();
    setFilteredCases(
      cases.filter((c) => {
        if (statusFilter && String(c.status || "").toLowerCase() !== statusFilter) return false;
        if (!key) return true;
        const caseTitle = (c.caseTitle || "").toLowerCase();
        const clientName = (c.clientName || c.client?.name || "").toLowerCase();
        const caseNumber = (c.caseNumber || "").toLowerCase();
        return caseTitle.includes(key) || clientName.includes(key) || caseNumber.includes(key);
      })
    );
  }, [cases, searchText, statusFilter]);

  // Scroll the highlighted row (from global search) into view.
  useEffect(() => {
    if (highlightedId == null) return;
    requestAnimationFrame(() => document.querySelector(".fin-expenses tr.hl")
      ?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [filteredCases, highlightedId]);

  const fetchCases = async () => {
    // Expenses are kept per case; a role without CASE_VIEW is refused the case list.
    if (!hasPermission("CASE_VIEW")) {
      setErrorMessage("Expenses are kept per case, and your role can't open cases. Ask an admin for case access.");
      setPageLoading(false);
      return;
    }
    setPageLoading(true);
    try {
      const res = await api.get("/api/cases/my-cases");
      // Sort: Pending -> Active -> Closed
      const order: Record<string, number> = { Pending: 1, Active: 2, Closed: 3 };
      const sorted = (res.data || []).sort((a: any, b: any) => (order[a.status] || 99) - (order[b.status] || 99));
      setCases(sorted);
    } catch (err) {
      console.error("Error fetching cases:", err);
      setErrorMessage("Failed to fetch cases.");
    } finally {
      setPageLoading(false);
    }
  };

  // ------------------ FETCH EXPENSES + PAYMENTS (for a case) ------------------
  const fetchExpensesAndPayments = async (caseId: any) => {
    try {
      const [expRes, payRes] = await Promise.all([
        api.get(`/api/expenses/case/${caseId}`),
        hasPermission("PAYMENT_VIEW") ? api.get(`/api/payments/case/${caseId}`) : Promise.resolve({ data: [] }),
      ]);
      setExpenses(expRes.data || []);
      setPayments(payRes.data || []);
      setSelectedCase(caseId);
      setShowExpenseModal(true);
    } catch (err) {
      console.error("Error fetching case expenses/payments:", err);
      setErrorMessage("Failed to fetch case details.");
    }
  };

  // ------------------ Add Expense ------------------
  const handleAddExpense = (caseId: any) => {
    setNewExpense({
      title: "",
      amount: "",
      category: "",
      description: "",
      paymentMode: "",
      paymentStatus: "",
      referenceNumber: "",
      paymentDate: today(),
      caseId,
      expenseType: "CLIENT_CASE",
    });
    // Opened from a case row the case is known; opened from Quick Actions or
    // Lisa it isn't, and without a pick the expense was saved on no case.
    setPickCase(!caseId);
    setEditExpenseId(null);
    setFormError("");
    setShowAddModal(true);
  };

  const handleChange = (e: any) => {
    setNewExpense({ ...newExpense, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!newExpense.title || !newExpense.amount) {
      setFormError("Title and amount are required.");
      return;
    }
    if (pickCase && !newExpense.caseId) {
      setFormError("Choose the case this expense belongs to.");
      return;
    }

    const expenseToSend = {
      ...newExpense,
      amount: parseFloat(newExpense.amount),
      caseEntity:
        newExpense.expenseType === "CLIENT_CASE" && newExpense.caseId
          ? { id: Number(newExpense.caseId) }
          : null,
    };

    try {
      if (editExpenseId) {
        await withLoading(api.put(`/api/expenses/update/${editExpenseId}`, expenseToSend), "Updating Expense...");
        success("Expense updated.");
      } else {
        await withLoading(api.post("/api/expenses/create", expenseToSend), "Saving Expense...");
        success("Expense created.");
      }
      setShowAddModal(false);
      // refresh case view and totals
      if (newExpense.caseId) fetchExpensesAndPayments(newExpense.caseId);
      fetchCases();
    } catch (err: any) {
      console.error("Error saving expense:", err);
      const errData = err.response?.data;
      const msg = typeof errData === "string" ? errData : (errData?.message || "Failed to save expense.");
      setFormError(msg);
      error(msg);
    }
  };

  const handleEdit = (expense: any) => {
    setEditExpenseId(expense.id);
    setNewExpense({
      title: expense.title || "",
      amount: expense.amount || "",
      category: expense.category || "",
      description: expense.description || "",
      paymentMode: expense.paymentMode || "",
      paymentStatus: expense.paymentStatus || "",
      referenceNumber: expense.referenceNumber || "",
      paymentDate: expense.paymentDate ? expense.paymentDate.split("T")[0] : today(),
      caseId: expense.caseEntity?.id || "",
      expenseType: expense.expenseType || "CLIENT_CASE",
    });
    setFormError("");
    setShowAddModal(true);
  };

  const doDeleteExpense = async (id: any, caseId: any) => {
    try {
      await withLoading(api.delete(`/api/expenses/delete/${id}`), "Deleting Expense...");
      fetchExpensesAndPayments(caseId);
      fetchCases();
    } catch (err) {
      console.error("Error deleting expense:", err);
      error("Failed to delete expense.");
    }
  };

  const handleDeleteExpense = (id: any, caseId: any) => {
    confirm({
      title: "Delete expense?",
      message: "Are you sure you want to delete this expense?",
      confirmLabel: "Delete",
      danger: true,
      accept: () => doDeleteExpense(id, caseId),
    });
  };

  // ------------------ Add Payment ------------------
  const handleAddPayment = (caseId: any) => {
    setNewPayment({
      amount: "",
      paymentMode: "",
      referenceNumber: "",
      paymentDate: today(),
      description: "",
      caseId,
      invoiceId: null,
    });
    setOpenInvoices([]);
    setFormError("");
    setShowPaymentModal(true);
    if (hasPermission("INVOICE_VIEW")) {
      api.get("/api/invoices/my-invoices")
        .then((res) => setOpenInvoices((res.data || []).filter(
          (inv: any) => String(inv.caseId) === String(caseId) && inv.balance > 0)))
        .catch(() => setOpenInvoices([]));
    }
  };

  // Paying an invoice fills in its balance; the amount can still be lowered
  // for a part-payment.
  const selectPaymentInvoice = (invoiceId: any) => {
    const inv = openInvoices.find((i) => i.id === invoiceId);
    setNewPayment((prev: any) => ({
      ...prev, invoiceId: invoiceId ?? null,
      amount: inv && !prev.amount ? String(inv.balance) : prev.amount,
    }));
  };

  const handlePaymentChange = (e: any) => {
    setNewPayment({ ...newPayment, [e.target.name]: e.target.value });
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!newPayment.amount) {
      setFormError("Amount is required for payment.");
      return;
    }
    try {
      await withLoading(
        api.post("/api/payments/create", {
          ...newPayment,
          amount: parseFloat(newPayment.amount),
          caseEntity: { id: newPayment.caseId },
          invoiceId: newPayment.invoiceId || undefined,
        }),
        "Saving Payment..."
      );
      success("Payment recorded.");
      setShowPaymentModal(false);
      // refresh
      fetchExpensesAndPayments(newPayment.caseId);
      fetchCases();
    } catch (err: any) {
      console.error("Error saving payment:", err);
      const msg = err.response?.data?.error || "Failed to record payment.";
      setFormError(msg);
      error(msg);
    }
  };

  // ------------------ REPORTS ------------------
  const fetchTodayReport = async () => {
    setErrorMessage("");
    try {
      const [expRes, payRes] = await Promise.all([
        api.get("/api/expenses/today"),
        api.get("/api/payments/today"),
      ]);

      setTodaySummary({
        expenses: expRes.data.expenses || expRes.data || [],
        totalExpenses: expRes.data.totalAmount ?? expRes.data.totalExpenses ?? 0,
        payments: payRes.data.payments || payRes.data || [],
        totalPayments: payRes.data.totalAmount ?? 0,
        date: expRes.data.date || today(),
      });
      setShowTodayModal(true);
    } catch (err) {
      console.error("Error fetching today's report:", err);
      setErrorMessage("Failed to fetch today's report.");
    }
  };

  const fetchMonthlyReport = async () => {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      const [expRes, payRes] = await Promise.all([
        api.get(`/api/expenses/monthly?year=${year}&month=${month}`),
        api.get(`/api/payments/monthly?year=${year}&month=${month}`),
      ]);

      let expenseList: any[] = expRes.data.expenses || [];
      let totalExpenses = expRes.data.totalExpenses || 0;
      let categoryBreakdown: Record<string, number> = expRes.data.categoryBreakdown || {};

      // Fallback: if /expenses/monthly is empty, extract from payments
      if ((!expenseList || expenseList.length === 0) && payRes.data?.payments?.length) {
        const paymentCases = payRes.data.payments
          .map((p: any) => p.caseEntity)
          .filter((c: any) => c && c.totalExpensesSoFar > 0);

        // Build artificial expense list
        expenseList = paymentCases.map((c: any) => ({
          title: c.caseTitle || "Unnamed Case",
          amount: c.totalExpensesSoFar || 0,
          category: c.caseType || "Uncategorized",
        }));

        totalExpenses = expenseList.reduce((sum, e) => sum + (e.amount || 0), 0);
        categoryBreakdown = {};
        expenseList.forEach((e) => {
          const cat = e.category || "Uncategorized";
          categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + (e.amount || 0);
        });
      }

      setMonthlyReport({
        expenses: { list: expenseList, totalExpenses, categoryBreakdown, month, year },
        payments: { list: payRes.data.payments || [], totalAmount: payRes.data.totalAmount || 0, month, year },
      });

      setShowMonthlyModal(true);
    } catch (err) {
      console.error("Error fetching monthly report:", err);
    }
  };

  const handlePrint = () => window.print();
  const handleDownloadPDF = () => {
    ReportService.downloadFilteredExpenses({
      caseId: selectedCase || undefined,   // selectedCase is the case id
      startDate: undefined,
      endDate: undefined,
    }).catch((err: any) => {
      console.error("Error downloading expense report:", err);
      error("Failed to download expense PDF.");
    });
  };

  // Helpers
  const sumAmounts = (arr: any[]) => (arr || []).reduce((s, x) => s + (x?.amount || 0), 0);

  const caseTotals = (c: any) => {
    // handle multiple possible property names returned by backend
    const totalExpenses = c.totalExpensesSoFar ?? c.totalExpenses ?? c.totalExpense ?? 0;
    const balance =
      c.balanceInAccount ??
      c.balance ??
      (c.totalPaidByClient != null ? c.totalPaidByClient - (totalExpenses || 0) : c.balanceInAccount);
    return { totalExpenses, balance };
  };

  const canExport = hasPermission("REPORT_EXPORT");
  const reportFoot = (close: () => void) => (
    <>
      <button type="button" className="btn ghost" onClick={close}>Close</button>
      {canExport && <Button icon="print" onClick={handlePrint}>Print</Button>}
      {canExport && <Button variant="primary" icon="download" onClick={handleDownloadPDF}>Download PDF</Button>}
    </>
  );

  const money = (n: any) => formatCurrency(n);
  const expenseHead = [{ label: "Date" }, { label: "Title" }, { label: "Category" }, { label: "Amount", amt: true }];
  const paymentHead = [{ label: "Date" }, { label: "Mode" }, { label: "Reference" }, { label: "Amount", amt: true }];
  const expenseRows = (list: any[]) => (list || []).map((x) => [<span className="nowrap">{fdate(x.paymentDate)}</span>, x.title || "—", x.category || "—", money(x.amount)]);
  const paymentRows = (list: any[]) => (list || []).map((p) => [<span className="nowrap">{fdate(p.paymentDate)}</span>, p.paymentMode || "—", <span className="mono xs">{p.referenceNumber || "—"}</span>, money(p.amount)]);

  const columns: Column<any>[] = [
    { key: "caseTitle", label: "Case", sort: (c) => c.caseTitle || "", render: (c) => (
      <div><div className="cell-title">{c.caseTitle || "—"}</div>{c.caseNumber && <div className="cell-sub mono">{c.caseNumber}</div>}</div>
    ) },
    { key: "client", label: "Client", hideSm: true, sort: (c) => c.clientName || c.client?.name || "", render: (c) => c.clientName || c.client?.name || "N/A" },
    { key: "status", label: "Status", hideSm: true, render: (c) => <StatusChip status={c.status || "N/A"} /> },
    { key: "exp", label: "Expenses", align: "right", sort: (c) => Number(caseTotals(c).totalExpenses) || 0,
      render: (c) => <span className="mono">{money(caseTotals(c).totalExpenses)}</span> },
    { key: "bal", label: "Balance", align: "right", sort: (c) => Number(caseTotals(c).balance) || 0, render: (c) => {
      const b = Number(caseTotals(c).balance) || 0;
      return <span className={`mono ${b < 0 ? "fin-bad" : "fin-ok"}`}>{money(b)}</span>;
    } },
    { key: "a", label: <span className="sr-only">Actions</span>, className: "actions", render: (c) => (
      <div className="row fin-actions">
        <Button size="sm" variant="ghost" onClick={() => fetchExpensesAndPayments(c.id)}>View</Button>
        {hasPermission("EXPENSE_CREATE") && (
          <Button size="sm" variant="ghost" icon="plus" onClick={() => handleAddExpense(c.id)} aria-label={`Add expense to ${c.caseTitle || "case"}`}>Expense</Button>
        )}
        {hasPermission("PAYMENT_CREATE") && (
          <Button size="sm" variant="ghost" icon="rupee" onClick={() => handleAddPayment(c.id)} aria-label={`Record payment on ${c.caseTitle || "case"}`}>Payment</Button>
        )}
      </div>
    ) },
  ];

  const viewCase = cases.find((c) => c.id === selectedCase);
  const totGiven = sumAmounts(payments);
  const totSpent = sumAmounts(expenses);
  const canReport = hasPermission("REPORT_VIEW") && hasPermission("PAYMENT_VIEW");

  return (
    <div className="fin-page">
      <PageHead title="Expenses" sub="Court fees, travel and out-of-pocket costs per matter, against fees received."
        actions={<>
          {canReport && <Button icon="file" onClick={fetchTodayReport}>Today’s report</Button>}
          {canReport && <Button icon="chart" onClick={fetchMonthlyReport}>Monthly report</Button>}
          {hasPermission("EXPENSE_CREATE") && <Button variant="primary" icon="plus" onClick={() => handleAddExpense(null)}>Add expense</Button>}
        </>} />

      {errorMessage && (
        <div className="callout bad fin-block" role="alert"><Icon name="warn" size="sm" /><div className="grow">{errorMessage}</div>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setErrorMessage("")}><Icon name="x" size="sm" /></button></div>
      )}

      <div className="toolbar">
        <SearchInput value={searchText} onChange={setSearchText} placeholder="Search case or client" />
        <label className="sr-only" htmlFor="exp-status">Case status</label>
        <select id="exp-status" className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="closed">Closed</option>
        </select>
      </div>

      <div className="fin-expenses">
        <DataTable rows={filteredCases} rowKey={(c) => c.id} columns={columns} loading={pageLoading} caption="Expenses by case"
          onRow={(c) => fetchExpensesAndPayments(c.id)}
          rowClass={(c) => (highlightedId === c.id ? "hl" : undefined)}
          empty={{ icon: "wallet", title: "No cases found", text: searchText ? "Try a different search." : "Expenses are recorded against your cases." }} />
      </div>

      {/* ------------------ ADD / EDIT EXPENSE ------------------ */}
      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} size="narrow" title={editExpenseId ? "Edit expense" : "Add expense"}
        footer={<>
          <button type="button" className="btn ghost" onClick={() => setShowAddModal(false)}>Cancel</button>
          <Button type="submit" form="exp-form" variant="primary">{editExpenseId ? "Update" : "Save expense"}</Button>
        </>}>
        <form id="exp-form" onSubmit={handleSubmit} className="stack">
          {formError && <div className="callout bad" role="alert"><Icon name="warn" size="sm" /><div>{formError}</div></div>}
          {pickCase && !editExpenseId && (
            <SelectField label="Case" required value={newExpense.caseId || ""} placeholder="Select case"
              options={cases.map((c: any) => ({ value: c.id, label: `${c.caseNumber} — ${c.caseTitle || ""}` }))}
              onChange={(e) => setNewExpense({ ...newExpense, caseId: e.target.value ? Number(e.target.value) : "" })} />
          )}
          <TextField label="Title" name="title" required value={newExpense.title} onChange={handleChange} />
          <div className="form-grid">
            <TextField label="Amount (₹)" name="amount" type="number" required className="mono" value={newExpense.amount} onChange={handleChange} />
            <TextField label="Date" name="paymentDate" type="date" value={newExpense.paymentDate} onChange={handleChange} />
          </div>
          <SelectField label="Category" required value={newExpense.category} options={CATEGORIES} placeholder="Select category"
            onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })} />
          <TextArea label="Description" name="description" rows={3} value={newExpense.description} onChange={handleChange} />
        </form>
      </Modal>

      {/* ------------------ ADD PAYMENT ------------------ */}
      <Modal open={showPaymentModal} onClose={() => setShowPaymentModal(false)} size="narrow" title="Record client payment"
        footer={<>
          <button type="button" className="btn ghost" onClick={() => setShowPaymentModal(false)}>Cancel</button>
          <Button type="submit" form="pay-form" variant="primary" icon="rupee">Save payment</Button>
        </>}>
        <form id="pay-form" onSubmit={handlePaymentSubmit} className="stack">
          {formError && <div className="callout bad" role="alert"><Icon name="warn" size="sm" /><div>{formError}</div></div>}
          {openInvoices.length > 0 && (
            <SelectField label="Against invoice" hint="Optional. Picking one fills in its balance." value={newPayment.invoiceId ?? ""} placeholder="No invoice (advance)"
              options={openInvoices.map((inv) => ({ value: inv.id, label: `${inv.invoiceNumber} · due ${formatCurrency(inv.balance)}` }))}
              onChange={(e) => selectPaymentInvoice(e.target.value ? Number(e.target.value) : null)} />
          )}
          <div className="form-grid">
            <TextField label="Amount (₹)" name="amount" type="number" required className="mono" value={newPayment.amount} onChange={handlePaymentChange} />
            <TextField label="Date" name="paymentDate" type="date" value={newPayment.paymentDate} onChange={handlePaymentChange} />
            <SelectField label="Mode" value={newPayment.paymentMode} options={PAYMENT_MODES} placeholder="Payment mode"
              onChange={(e) => setNewPayment({ ...newPayment, paymentMode: e.target.value })} />
            <TextField label="Reference" name="referenceNumber" placeholder="Transaction / cheque no." value={newPayment.referenceNumber} onChange={handlePaymentChange} />
          </div>
          <TextArea label="Description" name="description" rows={3} value={newPayment.description} onChange={handlePaymentChange} />
        </form>
      </Modal>

      {/* ------------------ CASE FINANCIAL OVERVIEW ------------------ */}
      <Drawer open={showExpenseModal} onClose={() => setShowExpenseModal(false)} wide title="Case financial overview"
        sub={viewCase && <><span className="mono">{viewCase.caseNumber}</span><span className="muted">{viewCase.clientName || viewCase.client?.name || ""}</span></>}
        footer={<>
          {canExport && <Button variant="ghost" icon="print" onClick={handlePrint}>Print</Button>}
          {canExport && <Button variant="ghost" icon="download" onClick={handleDownloadPDF}>Download PDF</Button>}
          <span className="grow" />
          {hasPermission("EXPENSE_CREATE") && <Button icon="wallet" onClick={() => handleAddExpense(selectedCase)}>Add expense</Button>}
          {hasPermission("PAYMENT_CREATE") && <Button variant="primary" icon="rupee" onClick={() => handleAddPayment(selectedCase)}>Record payment</Button>}
        </>}>
        <div className="figures fin-block">
          <div className="figure"><div className="lbl">Received</div><div className="val fin-val-sm">{money(totGiven)}</div></div>
          <div className="figure"><div className="lbl">Expenses</div><div className="val fin-val-sm">{money(totSpent)}</div></div>
          <div className="figure"><div className="lbl">Balance</div><div className={`val fin-val-sm${totGiven - totSpent < 0 ? " fin-bad" : ""}`}>{money(totGiven - totSpent)}</div></div>
        </div>
        <h4 className="fin-h4">Expenses</h4>
        {expenses.length ? (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th scope="col">Date</th><th scope="col">Title</th><th scope="col" className="hide-sm">Category</th><th scope="col" className="amt">Amount</th>
                {(hasPermission("EXPENSE_EDIT") || hasPermission("EXPENSE_DELETE")) && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>
                {expenses.map((x) => (
                  <tr key={x.id}>
                    <td className="nowrap">{fdate(x.paymentDate)}</td><td>{x.title}</td><td className="hide-sm">{x.category || "—"}</td>
                    <td className="amt mono">{money(x.amount)}</td>
                    {(hasPermission("EXPENSE_EDIT") || hasPermission("EXPENSE_DELETE")) && (
                      <td className="actions">
                        {hasPermission("EXPENSE_EDIT") && <Button size="sm" variant="ghost" iconOnly icon="edit" aria-label={`Edit ${x.title}`} title="Edit" onClick={() => handleEdit(x)} />}
                        {hasPermission("EXPENSE_DELETE") && <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={`Delete ${x.title}`} title="Delete" onClick={() => handleDeleteExpense(x.id, selectedCase)} />}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="faint small">No expenses yet.</p>}
        <h4 className="fin-h4 fin-block-top">Payments received</h4>
        <MiniTable head={[...paymentHead.slice(0, 3), { label: "Invoice" }, paymentHead[3]]}
          rows={payments.map((p) => [<span className="nowrap">{fdate(p.paymentDate)}</span>, p.paymentMode || "—", <span className="mono xs">{p.referenceNumber || "—"}</span>,
            <span className="mono xs">{p.invoiceNumber || "—"}</span>, money(p.amount)])}
          empty="No payments yet." />
      </Drawer>

      {/* ------------------ TODAY REPORT ------------------ */}
      <Modal open={showTodayModal && !!todaySummary} onClose={() => setShowTodayModal(false)} size="wide"
        title={`Today’s report, ${fdate(todaySummary?.date)}`} footer={reportFoot(() => setShowTodayModal(false))}>
        {todaySummary && (
          <>
            <div className="figures fin-block">
              <div className="figure"><div className="lbl">Spent</div><div className="val fin-val-sm">{money(todaySummary.totalExpenses)}</div></div>
              <div className="figure"><div className="lbl">Received</div><div className="val fin-val-sm">{money(todaySummary.totalPayments)}</div></div>
            </div>
            <div className="cols g-2 fin-cols">
              <div><h4 className="fin-h4">Expenses</h4>
                <MiniTable head={expenseHead} rows={expenseRows(todaySummary.expenses)} empty="No expenses today." /></div>
              <div><h4 className="fin-h4">Payments</h4>
                <MiniTable head={paymentHead} rows={paymentRows(todaySummary.payments)} empty="No payments today." /></div>
            </div>
          </>
        )}
      </Modal>

      {/* ------------------ MONTHLY REPORT ------------------ */}
      <Modal open={showMonthlyModal && !!monthlyReport} onClose={() => setShowMonthlyModal(false)} size="wide"
        title={monthlyReport ? `Monthly report, ${MONTHS[monthlyReport.expenses.month - 1]} ${monthlyReport.expenses.year}` : "Monthly report"}
        footer={reportFoot(() => setShowMonthlyModal(false))}>
        {monthlyReport && (() => {
          const cats = Object.entries(monthlyReport.expenses.categoryBreakdown || {}) as [string, number][];
          const max = Math.max(1, ...cats.map(([, a]) => Number(a) || 0));
          return (
            <>
              <div className="figures fin-block">
                <div className="figure"><div className="lbl">Spent</div><div className="val fin-val-sm">{money(monthlyReport.expenses.totalExpenses)}</div>
                  <div className="meta">{monthlyReport.expenses.list.length} entries</div></div>
                <div className="figure"><div className="lbl">Received</div><div className="val fin-val-sm">{money(monthlyReport.payments.totalAmount)}</div>
                  <div className="meta">{monthlyReport.payments.list.length} payments</div></div>
              </div>
              <h4 className="fin-h4">By category</h4>
              {cats.length ? cats.map(([cat, amt], idx) => (
                <div className="bar-row" key={cat || `cat-${idx}`}>
                  <span className="ellipsis">{cat || "Uncategorized"}</span>
                  <span className="bar-track"><i style={{ width: `${(Number(amt) / max) * 100}%`, background: "var(--ink)" }} /></span>
                  <span className="mono right">{money(amt)}</span>
                </div>
              )) : <p className="faint small">No breakdown available.</p>}
              <div className="cols g-2 fin-cols fin-block-top">
                <div><h4 className="fin-h4">Expenses</h4>
                  <MiniTable head={[{ label: "Title" }, { label: "Category" }, { label: "Amount", amt: true }]}
                    rows={monthlyReport.expenses.list.map((x: any) => [x.title || "—", x.category || "—", money(x.amount)])}
                    empty="No expenses this month." total={money(monthlyReport.expenses.totalExpenses)} /></div>
                <div><h4 className="fin-h4">Payments</h4>
                  <MiniTable head={[{ label: "Mode" }, { label: "Reference" }, { label: "Amount", amt: true }]}
                    rows={monthlyReport.payments.list.map((p: any) => [p.paymentMode || "—", <span className="mono xs">{p.referenceNumber || "—"}</span>, money(p.amount)])}
                    empty="No payments this month." total={money(monthlyReport.payments.totalAmount)} /></div>
              </div>
            </>
          );
        })()}
      </Modal>
    </div>
  );
}

export default Expenses;
