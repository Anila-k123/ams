import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { Skeleton } from "primereact/skeleton";
import { Tag } from "primereact/tag";
import { Message } from "primereact/message";
import { IconField } from "primereact/iconfield";
import { InputIcon } from "primereact/inputicon";
import { ConfirmDialog, confirmDialog } from "primereact/confirmdialog";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import ReportService from "../services/ReportService";
import { formatCurrency } from "../utils/formatCurrency";
import "../assets/styles/Expenses.css";

const CATEGORIES = ["Travel", "Court Fees", "Documents", "Stationery", "Miscellaneous"].map((c) => ({ label: c, value: c }));
const PAYMENT_MODES = [
  { label: "UPI", value: "UPI" },
  { label: "Bank Transfer", value: "Bank Transfer" },
  { label: "Cash", value: "Cash" },
  { label: "Cheque", value: "Cheque" },
  { label: "Card (Credit/Debit)", value: "Card" },
  { label: "Net Banking", value: "Net Banking" },
  { label: "Demand Draft", value: "Demand Draft" },
];
const STATUS_SEVERITY: Record<string, any> = { pending: "warning", active: "success", closed: "secondary" };

const today = () => new Date().toISOString().split("T")[0];
const dateOnly = (d: any) => d?.split?.("T")[0] ?? d;

function Expenses() {
  const [cases, setCases] = useState<any[]>([]);
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
  const [successMessage, setSuccessMessage] = useState("");
  const [editExpenseId, setEditExpenseId] = useState<any>(null);

  const [searchText, setSearchText] = useState("");
  const [highlightedId, setHighlightedId] = useState<any>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const location = useLocation();

  const { token } = useAuth();
  const { withLoading } = useLoading() as any;
  const { success, error } = useToast() as any;
  const { hasPermission } = usePermission() as any;

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
  });

  // ------------------ FETCH CASES ------------------
  useEffect(() => {
    if (!token) {
      setErrorMessage("Please login first.");
      return;
    }
    fetchCases();
  }, [token]);

  // AI Assistant / quick actions: open modals
  useEffect(() => {
    const handler = (e: any) => {
      if (e.detail === "create-expense") {
        handleAddExpense(null);
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

  useEffect(() => {
    // apply search filter when cases or searchText change
    if (!searchText) {
      setFilteredCases(cases);
      return;
    }
    const key = searchText.toLowerCase();
    setFilteredCases(
      cases.filter((c) => {
        const caseTitle = (c.caseTitle || "").toLowerCase();
        const clientName = (c.clientName || c.client?.name || "").toLowerCase();
        return caseTitle.includes(key) || clientName.includes(key);
      })
    );
  }, [cases, searchText]);

  // Scroll the highlighted row (from global search) into view.
  useEffect(() => {
    if (highlightedId == null) return;
    requestAnimationFrame(() => document.querySelector(".cases-table-wrapper .highlight-row")
      ?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }, [filteredCases, highlightedId]);

  const fetchCases = async () => {
    setPageLoading(true);
    try {
      const res = await api.get("/api/cases/my-cases");
      // Sort: Pending -> Active -> Closed
      const order: Record<string, number> = { Pending: 1, Active: 2, Closed: 3 };
      const sorted = (res.data || []).sort((a: any, b: any) => (order[a.status] || 99) - (order[b.status] || 99));
      setCases(sorted);
      setFilteredCases(sorted);
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
        api.get(`/api/payments/case/${caseId}`),
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
    setEditExpenseId(null);
    setShowAddModal(true);
  };

  const handleChange = (e: any) => {
    setNewExpense({ ...newExpense, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    if (!newExpense.title || !newExpense.amount) {
      setErrorMessage("Title and amount are required.");
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
        setSuccessMessage("Expense updated.");
        success("Expense updated.");
      } else {
        await withLoading(api.post("/api/expenses/create", expenseToSend), "Saving Expense...");
        setSuccessMessage("Expense created.");
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
      setErrorMessage(msg);
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
    setShowAddModal(true);
  };

  const doDeleteExpense = async (id: any, caseId: any) => {
    try {
      await withLoading(api.delete(`/api/expenses/delete/${id}`), "Deleting Expense...");
      fetchExpensesAndPayments(caseId);
      fetchCases();
    } catch (err) {
      console.error("Error deleting expense:", err);
      setErrorMessage("Failed to delete expense.");
    }
  };

  const handleDeleteExpense = (id: any, caseId: any) => {
    confirmDialog({
      message: "Are you sure you want to delete this expense?",
      header: "Delete expense",
      icon: "pi pi-exclamation-triangle",
      acceptClassName: "p-button-danger",
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
    });
    setShowPaymentModal(true);
  };

  const handlePaymentChange = (e: any) => {
    setNewPayment({ ...newPayment, [e.target.name]: e.target.value });
  };

  const handlePaymentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    if (!newPayment.amount) {
      setErrorMessage("Amount is required for payment.");
      return;
    }
    try {
      await withLoading(
        api.post("/api/payments/create", {
          ...newPayment,
          amount: parseFloat(newPayment.amount),
          caseEntity: { id: newPayment.caseId },
        }),
        "Saving Payment..."
      );
      setSuccessMessage("Payment recorded successfully!");
      success("Payment recorded.");
      setShowPaymentModal(false);
      // refresh
      fetchExpensesAndPayments(newPayment.caseId);
      fetchCases();
    } catch (err) {
      console.error("Error saving payment:", err);
      setErrorMessage("Failed to record payment.");
      error("Failed to record payment.");
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

  const outAmount = (x: any) => <span className="amount-out">{formatCurrency(-x.amount)}</span>;
  const inAmount = (x: any) => <span className="amount-in">{formatCurrency(x.amount)}</span>;

  const reportButtons = (printLabel: string, downloadLabel: string) => (
    <div className="flex justify-content-end gap-2 mt-3 no-print">
      <Button outlined icon="pi pi-print" label={printLabel} onClick={handlePrint} />
      <Button icon="pi pi-download" label={downloadLabel} onClick={handleDownloadPDF} />
    </div>
  );

  const dialogProps = { modal: true, style: { width: "min(1000px, 96vw)" } };

  // Render
  return (
    <div className="expenses-container">
      <ConfirmDialog />

      {errorMessage && <Message severity="error" text={errorMessage} className="w-full justify-content-start mb-2" />}
      {successMessage && <Message severity="success" text={successMessage} className="w-full justify-content-start mb-2" />}

      <div className="flex flex-wrap gap-2 align-items-center justify-content-between mb-3">
        <IconField iconPosition="left" className="flex-1" style={{ minWidth: 220, maxWidth: 480 }}>
          <InputIcon className="pi pi-search" />
          <InputText className="w-full" placeholder="Search cases or clients..." value={searchText}
            onChange={(e) => setSearchText(e.target.value)} />
        </IconField>
        <div className="flex gap-2">
          <Button outlined icon="pi pi-calendar" label="Today’s Report" onClick={fetchTodayReport} />
          <Button outlined icon="pi pi-chart-bar" label="Monthly Report" onClick={fetchMonthlyReport} />
        </div>
      </div>

      <div className="cases-table-wrapper">
        {pageLoading ? (
          <div className="flex flex-column gap-2 p-2">
            {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} height="2rem" />)}
          </div>
        ) : (
          <DataTable value={filteredCases} dataKey="id" size="small" scrollable emptyMessage="No cases found."
            rowClassName={(c: any) => (highlightedId === c.id ? "highlight-row" : "")}>
            <Column header="Case Title" field="caseTitle" />
            <Column header="Client" body={(c) => c.clientName || c.client?.name || "N/A"} />
            <Column header="Status" body={(c) => (
              <Tag value={c.status || "N/A"} severity={STATUS_SEVERITY[String(c.status || "").toLowerCase()] || "info"} rounded />
            )} />
            <Column header="Total Expense" body={(c) => formatCurrency(caseTotals(c).totalExpenses)} />
            <Column header="Balance" body={(c) => formatCurrency(caseTotals(c).balance)} />
            <Column header="Actions" body={(c) => (
              <div className="flex gap-1 white-space-nowrap">
                <Button size="small" text icon="pi pi-search" label="View" onClick={() => fetchExpensesAndPayments(c.id)} />
                {hasPermission("EXPENSE_CREATE") && (
                  <Button size="small" text icon="pi pi-plus" label="Add" onClick={() => handleAddExpense(c.id)} />
                )}
                {hasPermission("PAYMENT_CREATE") && (
                  <Button size="small" text icon="pi pi-wallet" label="Payment" onClick={() => handleAddPayment(c.id)} />
                )}
              </div>
            )} />
          </DataTable>
        )}
      </div>

      {/* ------------------ ADD EXPENSE MODAL (small) ------------------ */}
      <Dialog visible={showAddModal} onHide={() => setShowAddModal(false)} header={editExpenseId ? "Edit Expense" : "Add Expense"}
        modal style={{ width: "min(460px, 95vw)" }}>
        <form onSubmit={handleSubmit} className="expense-form">
          <InputText name="title" placeholder="Title" value={newExpense.title} onChange={handleChange} required />
          <InputText name="amount" type="number" placeholder="Amount" value={newExpense.amount} onChange={handleChange} required />
          <Dropdown value={newExpense.category} options={CATEGORIES} placeholder="Select Category" required
            onChange={(e) => setNewExpense({ ...newExpense, category: e.value })} />
          <InputText name="paymentDate" type="date" value={newExpense.paymentDate} onChange={handleChange} />
          <InputTextarea name="description" placeholder="Description" value={newExpense.description} onChange={handleChange} rows={3} />
          <div className="flex justify-content-end">
            <Button type="submit" icon="pi pi-save" label={editExpenseId ? "Update" : "Save"} />
          </div>
        </form>
      </Dialog>

      {/* ------------------ ADD PAYMENT MODAL (small) ------------------ */}
      <Dialog visible={showPaymentModal} onHide={() => setShowPaymentModal(false)} header="Add Client Payment"
        modal style={{ width: "min(460px, 95vw)" }}>
        <form onSubmit={handlePaymentSubmit} className="expense-form">
          <InputText name="amount" type="number" placeholder="Amount" value={newPayment.amount} onChange={handlePaymentChange} required />
          <Dropdown value={newPayment.paymentMode} options={PAYMENT_MODES} placeholder="Payment Mode"
            onChange={(e) => setNewPayment({ ...newPayment, paymentMode: e.value })} />
          <InputText name="referenceNumber" placeholder="Reference / Transaction No." value={newPayment.referenceNumber} onChange={handlePaymentChange} />
          <InputText name="paymentDate" type="date" value={newPayment.paymentDate} onChange={handlePaymentChange} />
          <InputTextarea name="description" placeholder="Description" value={newPayment.description} onChange={handlePaymentChange} rows={3} />
          <div className="flex justify-content-end">
            <Button type="submit" icon="pi pi-save" label="Save" />
          </div>
        </form>
      </Dialog>

      {/* ------------------ VIEW CASE MODAL (big) ------------------ */}
      <Dialog visible={showExpenseModal} onHide={() => setShowExpenseModal(false)} header="Case Financial Overview" {...dialogProps}>
        <div className="grid">
          <div className="col-12 md:col-6">
            <h4 className="exp-section-title"><i className="pi pi-arrow-up-right" /> Expenses</h4>
            <DataTable value={expenses} dataKey="id" size="small" emptyMessage="No expenses yet.">
              <Column header="Title" field="title" />
              <Column header="Amount" body={outAmount} />
              <Column header="Category" field="category" />
              <Column header="Date" body={(x) => dateOnly(x.paymentDate)} />
              <Column header="Actions" body={(exp) => (
                <div className="flex gap-1">
                  {hasPermission("EXPENSE_EDIT") && (
                    <Button size="small" text label="Edit" onClick={() => handleEdit(exp)} />
                  )}
                  {hasPermission("EXPENSE_DELETE") && (
                    <Button size="small" text severity="danger" label="Delete" onClick={() => handleDeleteExpense(exp.id, selectedCase)} />
                  )}
                </div>
              )} />
            </DataTable>
          </div>

          <div className="col-12 md:col-6">
            <h4 className="exp-section-title"><i className="pi pi-arrow-down-left" /> Payments Received</h4>
            <DataTable value={payments} size="small" emptyMessage="No payments yet.">
              <Column header="Mode" field="paymentMode" />
              <Column header="Amount" body={inAmount} />
              <Column header="Ref No." field="referenceNumber" />
              <Column header="Date" body={(p) => dateOnly(p.paymentDate)} />
            </DataTable>
          </div>
        </div>

        <div className="grid mt-2">
          <div className="col-12 md:col-4"><div className="summary-box">
            <span className="summary-lbl">Total Given</span>
            <strong className="summary-val text-green">{formatCurrency(sumAmounts(payments))}</strong>
          </div></div>
          <div className="col-12 md:col-4"><div className="summary-box">
            <span className="summary-lbl">Total Spent</span>
            <strong className="summary-val text-red">{formatCurrency(sumAmounts(expenses))}</strong>
          </div></div>
          <div className="col-12 md:col-4"><div className="summary-box">
            <span className="summary-lbl">Balance</span>
            <strong className={`summary-val ${sumAmounts(payments) - sumAmounts(expenses) >= 0 ? "text-green" : "text-red"}`}>
              {formatCurrency(sumAmounts(payments) - sumAmounts(expenses))}
            </strong>
          </div></div>
        </div>

        {reportButtons("Print View", "Download View")}
      </Dialog>

      {/* ------------------ TODAY REPORT (big) ------------------ */}
      <Dialog visible={showTodayModal && !!todaySummary} onHide={() => setShowTodayModal(false)}
        header={`Today’s Financial Summary — ${todaySummary?.date || ""}`} {...dialogProps}>
        {todaySummary && (
          <>
            <div className="grid">
              <div className="col-12 md:col-6">
                <h4 className="exp-section-title"><i className="pi pi-arrow-up-right" /> Expenses</h4>
                <p><b>Total:</b> {formatCurrency(todaySummary.totalExpenses)}</p>
                <DataTable value={todaySummary.expenses} size="small" emptyMessage="No expenses today.">
                  <Column header="Title" field="title" />
                  <Column header="Amount" body={outAmount} />
                  <Column header="Category" field="category" />
                  <Column header="Date" body={(x) => dateOnly(x.paymentDate)} />
                </DataTable>
              </div>
              <div className="col-12 md:col-6">
                <h4 className="exp-section-title"><i className="pi pi-arrow-down-left" /> Payments</h4>
                <p><b>Total:</b> {formatCurrency(todaySummary.totalPayments)}</p>
                <DataTable value={todaySummary.payments} size="small" emptyMessage="No payments today.">
                  <Column header="Mode" field="paymentMode" />
                  <Column header="Amount" body={inAmount} />
                  <Column header="Ref No" field="referenceNumber" />
                  <Column header="Date" body={(p) => dateOnly(p.paymentDate)} />
                </DataTable>
              </div>
            </div>
            {reportButtons("Print", "Download")}
          </>
        )}
      </Dialog>

      {/* ------------------ MONTHLY REPORT (big) ------------------ */}
      <Dialog visible={showMonthlyModal && !!monthlyReport} onHide={() => setShowMonthlyModal(false)}
        header={monthlyReport ? `Monthly Report — ${monthlyReport.expenses.month}/${monthlyReport.expenses.year}` : "Monthly Report"} {...dialogProps}>
        {monthlyReport && (
          <>
            <div className="grid">
              <div className="col-12 md:col-6">
                <h4 className="exp-section-title"><i className="pi pi-arrow-up-right" /> Expenses — {formatCurrency(monthlyReport.expenses.totalExpenses)}</h4>
                <DataTable value={monthlyReport.expenses.list} size="small" emptyMessage="No expenses this month.">
                  <Column header="Title" field="title" />
                  <Column header="Amount" body={outAmount} />
                  <Column header="Category" field="category" />
                </DataTable>

                <h4 className="exp-section-title mt-3">Category Breakdown</h4>
                <ul className="exp-breakdown">
                  {Object.entries(monthlyReport.expenses.categoryBreakdown || {}).length > 0 ? (
                    Object.entries(monthlyReport.expenses.categoryBreakdown).map(([cat, amt], idx) => (
                      <li key={cat || `cat-${idx}`}>{cat}: {formatCurrency(amt)}</li>
                    ))
                  ) : (
                    <li>No breakdown available.</li>
                  )}
                </ul>
              </div>

              <div className="col-12 md:col-6">
                <h4 className="exp-section-title"><i className="pi pi-arrow-down-left" /> Payments — {formatCurrency(monthlyReport.payments.totalAmount)}</h4>
                <DataTable value={monthlyReport.payments.list} size="small" emptyMessage="No payments this month.">
                  <Column header="Mode" field="paymentMode" />
                  <Column header="Amount" body={inAmount} />
                  <Column header="Ref No" field="referenceNumber" />
                </DataTable>
              </div>
            </div>
            {reportButtons("Print", "Download")}
          </>
        )}
      </Dialog>
    </div>
  );
}

export default Expenses;
