import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import ReportService from "../services/ReportService";
import { formatCurrency } from "../utils/formatCurrency";
import { InlineLoader } from "../components/Loader";
import "../assets/styles/Expenses.css";

function Expenses() {
  const [cases, setCases] = useState([]);
  const [filteredCases, setFilteredCases] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [payments, setPayments] = useState([]);
  const [selectedCase, setSelectedCase] = useState(null);

  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showTodayModal, setShowTodayModal] = useState(false);
  const [showMonthlyModal, setShowMonthlyModal] = useState(false);

  const [todaySummary, setTodaySummary] = useState(null);
  const [monthlyReport, setMonthlyReport] = useState(null);

  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [editExpenseId, setEditExpenseId] = useState(null);

  const [searchText, setSearchText] = useState("");
  const [highlightedId, setHighlightedId] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);
  const location = useLocation();

  const token = localStorage.getItem("token");
  const { withLoading } = useLoading();
  const { error } = useToast();

  // ----------------- FORMS -----------------
  const [newExpense, setNewExpense] = useState({
    title: "",
    amount: "",
    category: "",
    description: "",
    paymentMode: "",
    paymentStatus: "",
    referenceNumber: "",
    paymentDate: new Date().toISOString().split("T")[0],
    caseId: "",
    expenseType: "CLIENT_CASE",
  });

  const [newPayment, setNewPayment] = useState({
    amount: "",
    paymentMode: "",
    referenceNumber: "",
    paymentDate: new Date().toISOString().split("T")[0],
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

  // AI Assistant: open modals
  useEffect(() => {
    const handler = (e) => {
      if (e.detail === "create-expense") {
        handleAddExpense(null);
      }
    };
    window.addEventListener("assistant-open-modal", handler);
    return () => window.removeEventListener("assistant-open-modal", handler);
  }, []);

  // Global Search navigation — read incoming state
  useEffect(() => {
    if (location.state?.search) {
      setSearchText(location.state.search);
      setHighlightedId(location.state.id || null);
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

  const fetchCases = async () => {
    setPageLoading(true);
    try {
      const res = await axios.get("/api/cases/my-cases", {
        headers: { Authorization: `Bearer ${token}` },
      });
      // Sort: Pending -> Active -> Closed
      const sorted = (res.data || []).sort((a, b) => {
        const order = { Pending: 1, Active: 2, Closed: 3 };
        return (order[a.status] || 99) - (order[b.status] || 99);
      });
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
  const fetchExpensesAndPayments = async (caseId) => {
    try {
      const [expRes, payRes] = await Promise.all([
        axios.get(`/api/expenses/case/${caseId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`/api/payments/case/${caseId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
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
  const handleAddExpense = (caseId) => {
    setNewExpense({
      title: "",
      amount: "",
      category: "",
      description: "",
      paymentMode: "",
      paymentStatus: "",
      referenceNumber: "",
      paymentDate: new Date().toISOString().split("T")[0],
      caseId,
      expenseType: "CLIENT_CASE",
    });
    setEditExpenseId(null);
    setShowAddModal(true);
  };

  const handleChange = (e) => {
    setNewExpense({ ...newExpense, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
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
        await withLoading(
          axios.put(
            `/api/expenses/update/${editExpenseId}`,
            expenseToSend,
            { headers: { Authorization: `Bearer ${token}` } }
          ),
          "Updating Expense..."
        );
        setSuccessMessage("Expense updated.");
      } else {
        await withLoading(
          axios.post("/api/expenses/create", expenseToSend, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          "Saving Expense..."
        );
        setSuccessMessage("Expense created.");
      }
      setShowAddModal(false);
      // refresh case view and totals
      if (newExpense.caseId) fetchExpensesAndPayments(newExpense.caseId);
      fetchCases();
    } catch (err) {
      console.error("Error saving expense:", err);
      const errData = err.response?.data;
      setErrorMessage(typeof errData === "string" ? errData : (errData?.message || "Failed to save expense."));
    }
  };

  const handleEdit = (expense) => {
    setEditExpenseId(expense.id);
    setNewExpense({
      title: expense.title || "",
      amount: expense.amount || "",
      category: expense.category || "",
      description: expense.description || "",
      paymentMode: expense.paymentMode || "",
      paymentStatus: expense.paymentStatus || "",
      referenceNumber: expense.referenceNumber || "",
      paymentDate: expense.paymentDate ? expense.paymentDate.split("T")[0] : new Date().toISOString().split("T")[0],
      caseId: expense.caseEntity?.id || "",
      expenseType: expense.expenseType || "CLIENT_CASE",
    });
    setShowAddModal(true);
  };

  const handleDeleteExpense = async (id, caseId) => {
    if (!window.confirm("Are you sure you want to delete this expense?")) return;
    try {
      await withLoading(
        axios.delete(`/api/expenses/delete/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        "Deleting Expense..."
      );
      fetchExpensesAndPayments(caseId);
      fetchCases();
    } catch (err) {
      console.error("Error deleting expense:", err);
      setErrorMessage("Failed to delete expense.");
    }
  };

  // ------------------ Add Payment ------------------
  const handleAddPayment = (caseId) => {
    setNewPayment({
      amount: "",
      paymentMode: "",
      referenceNumber: "",
      paymentDate: new Date().toISOString().split("T")[0],
      description: "",
      caseId,
    });
    setShowPaymentModal(true);
  };

  const handlePaymentChange = (e) => {
    setNewPayment({ ...newPayment, [e.target.name]: e.target.value });
  };

  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    if (!newPayment.amount) {
      setErrorMessage("Amount is required for payment.");
      return;
    }
    try {
      await withLoading(
        axios.post(
          "/api/payments/create",
          {
            ...newPayment,
            amount: parseFloat(newPayment.amount),
            caseEntity: { id: newPayment.caseId },
          },
          { headers: { Authorization: `Bearer ${token}` } }
        ),
        "Saving Payment..."
      );
      setSuccessMessage("Payment recorded successfully!");
      setShowPaymentModal(false);
      // refresh
      fetchExpensesAndPayments(newPayment.caseId);
      fetchCases();
    } catch (err) {
      console.error("Error saving payment:", err);
      setErrorMessage("Failed to record payment.");
    }
  };

  // ------------------ REPORTS ------------------
  const fetchTodayReport = async () => {
    setErrorMessage("");
    try {
      const [expRes, payRes] = await Promise.all([
        axios.get("/api/expenses/today", {
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get("/api/payments/today", {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      setTodaySummary({
        expenses: expRes.data.expenses || expRes.data || [],
        totalExpenses: expRes.data.totalAmount ?? expRes.data.totalExpenses ?? 0,
        payments: payRes.data.payments || payRes.data || [],
        totalPayments: payRes.data.totalAmount ?? 0,
        date: expRes.data.date || new Date().toISOString().split("T")[0],
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
      axios.get(`/api/expenses/monthly?year=${year}&month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      axios.get(`/api/payments/monthly?year=${year}&month=${month}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    console.log("DEBUG MONTHLY: raw expRes.data =", JSON.parse(JSON.stringify(expRes.data)));
    console.log("DEBUG MONTHLY: raw payRes.data.payments length =", payRes.data?.payments?.length);

    let expenseList = expRes.data.expenses || [];
    let totalExpenses = expRes.data.totalExpenses || 0;
    let categoryBreakdown = expRes.data.categoryBreakdown || {};

    console.log("DEBUG MONTHLY: expenseList after extract =", expenseList.length, "totalExpenses =", totalExpenses, "breakdown keys =", Object.keys(categoryBreakdown));

    // ✅ Fallback: if /expenses/monthly is empty, extract from payments
    if ((!expenseList || expenseList.length === 0) && payRes.data?.payments?.length) {
      console.log("DEBUG MONTHLY: FALLBACK TRIGGERED — building from payments");
      const paymentCases = payRes.data.payments
        .map((p) => p.caseEntity)
        .filter((c) => c && c.totalExpensesSoFar > 0);

      // Build artificial expense list
      expenseList = paymentCases.map((c) => ({
        title: c.caseTitle || "Unnamed Case",
        amount: c.totalExpensesSoFar || 0,
        category: c.caseType || "Uncategorized",
      }));
      console.log("DEBUG MONTHLY: paymentCases with totalExpensesSoFar > 0 =", paymentCases.length);
      console.log("DEBUG MONTHLY: artificial expenseList after fallback =", expenseList.length, "totalExpenses =", totalExpenses);

      totalExpenses = expenseList.reduce((sum, e) => sum + (e.amount || 0), 0);
      categoryBreakdown = {};
      expenseList.forEach(e => {
        const cat = e.category || "Uncategorized";
        categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + (e.amount || 0);
      });
      console.log("DEBUG MONTHLY: AFTER FALLBACK totalExpenses =", totalExpenses, "expenseList =", JSON.parse(JSON.stringify(expenseList)));
    }

    console.log("DEBUG MONTHLY: VALUES PASSED TO setMonthlyReport — list length =", expenseList.length, "total =", totalExpenses);
    console.log("DEBUG MONTHLY: expenseList items =", JSON.parse(JSON.stringify(expenseList)));
    console.log("DEBUG MONTHLY: categoryBreakdown =", JSON.parse(JSON.stringify(categoryBreakdown)));

    setMonthlyReport({
      expenses: {
        list: expenseList,
        totalExpenses,
        categoryBreakdown,
        month,
        year,
      },
      payments: {
        list: payRes.data.payments || [],
        totalAmount: payRes.data.totalAmount || 0,
        month,
        year,
      },
    });

    setShowMonthlyModal(true);
  } catch (err) {
    console.error("Error fetching monthly report:", err);
  }
};


  const handlePrint = () => window.print();
  const handleDownloadPDF = () => {
    ReportService.downloadFilteredExpenses({
      caseId: selectedCase?.id || undefined,
      startDate: undefined,
      endDate: undefined,
    }).catch((err) => {
      console.error("Error downloading expense report:", err);
      error("Failed to download expense PDF.");
    });
  };

  // Helpers
  const sumAmounts = (arr) => (arr || []).reduce((s, x) => s + (x?.amount || 0), 0);

  // Render
  return (
    <div className="expenses-container">
      <h2>Case-wise Expense & Payment Management</h2>

      {errorMessage && <p className="error-message">{errorMessage}</p>}
      {successMessage && <p className="success-message">{successMessage}</p>}

      <div className="expenses-header">
        <div className="header-actions">
          <input
            type="text"
            placeholder="Search cases or clients..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="search-bar"
          />
        </div>

        <div className="expense-actions">
          <button className="today-report-btn" onClick={fetchTodayReport}>📅 Today’s Report</button>
          <button className="monthly-report-btn" onClick={fetchMonthlyReport}>📊 Monthly Report</button>
        </div>
      </div>

      <div className="cases-table-wrapper">
        {pageLoading ? (
          <InlineLoader type="table" rows={10} cols={6} />
        ) : (
        <table className="case-list-table">
          <thead>
            <tr>
              <th>Case Title</th>
              <th>Client</th>
              <th>Status</th>
              <th>Total Expense</th>
              <th>Balance</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCases.length === 0 ? (
              <tr>
                <td colSpan="6">No cases found.</td>
              </tr>
            ) : (
              filteredCases.map((c) => {
                // handle multiple possible property names returned by backend
                const totalExpenses =
                  c.totalExpensesSoFar ?? c.totalExpenses ?? c.totalExpense ?? 0;
                const balance =
                  c.balanceInAccount ??
                  c.balance ??
                  (c.totalPaidByClient != null ? c.totalPaidByClient - (totalExpenses || 0) : c.balanceInAccount);
                return (
                  <tr key={c.id} className={highlightedId === c.id ? "highlight-row" : ""} ref={(el) => { if (highlightedId === c.id && el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
                    <td>{c.caseTitle}</td>
                    <td>{c.clientName || c.client?.name || "N/A"}</td>
                    <td>
                      <span className={`status ${String(c.status || "").toLowerCase()}`}>
                        {c.status || "N/A"}
                      </span>
                    </td>
                    <td>{formatCurrency(totalExpenses)}</td>
                    <td>{formatCurrency(balance)}</td>
                    <td className="case-actions">
                      <button onClick={() => fetchExpensesAndPayments(c.id)}>🔍 View</button>
                      <button onClick={() => handleAddExpense(c.id)}>➕ Add</button>
                      <button onClick={() => handleAddPayment(c.id)}>💰 Payment</button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        )}
      </div>

      {/* ------------------ ADD EXPENSE MODAL (small) ------------------ */}
      {showAddModal && (
        <div className="expense-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="expense-modal small" onClick={(e) => e.stopPropagation()}>
            <button className="close-icon" onClick={() => setShowAddModal(false)}>×</button>
            <h3>{editExpenseId ? "Edit Expense" : "Add Expense"}</h3>
            <form onSubmit={handleSubmit} className="expense-form">
              <input name="title" placeholder="Title" value={newExpense.title} onChange={handleChange} required />
              <input name="amount" type="number" placeholder="Amount" value={newExpense.amount} onChange={handleChange} required />
              <select name="category" value={newExpense.category} onChange={handleChange} required>
                <option value="">Select Category</option>
                <option value="Travel">Travel</option>
                <option value="Court Fees">Court Fees</option>
                <option value="Documents">Documents</option>
                <option value="Stationery">Stationery</option>
                <option value="Miscellaneous">Miscellaneous</option>
              </select>
              <input name="paymentDate" type="date" value={newExpense.paymentDate} onChange={handleChange} />
              <textarea name="description" placeholder="Description" value={newExpense.description} onChange={handleChange}></textarea>
              <div className="modal-buttons">
                <button type="submit">💾 {editExpenseId ? "Update" : "Save"}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------ ADD PAYMENT MODAL (small) ------------------ */}
      {showPaymentModal && (
        <div className="expense-modal-overlay" onClick={() => setShowPaymentModal(false)}>
          <div className="expense-modal small" onClick={(e) => e.stopPropagation()}>
            <button className="close-icon" onClick={() => setShowPaymentModal(false)}>×</button>
            <h3>Add Client Payment</h3>
            <form onSubmit={handlePaymentSubmit} className="expense-form">
              <input name="amount" type="number" placeholder="Amount" value={newPayment.amount} onChange={handlePaymentChange} required />
              <input name="paymentMode" placeholder="Payment Mode (UPI/Bank/Cash)" value={newPayment.paymentMode} onChange={handlePaymentChange} />
              <input name="referenceNumber" placeholder="Reference / Transaction No." value={newPayment.referenceNumber} onChange={handlePaymentChange} />
              <input name="paymentDate" type="date" value={newPayment.paymentDate} onChange={handlePaymentChange} />
              <textarea name="description" placeholder="Description" value={newPayment.description} onChange={handlePaymentChange}></textarea>
              <div className="modal-buttons">
                <button type="submit">💾 Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------ VIEW CASE MODAL (big) ------------------ */}
      {showExpenseModal && (
        <div className="expense-modal-overlay" onClick={() => setShowExpenseModal(false)}>
          <div className="expense-modal big" onClick={(e) => e.stopPropagation()}>
            <button className="close-icon" onClick={() => setShowExpenseModal(false)}>×</button>
            <h3>Case Financial Overview</h3>

            <div className="report-section">
              <div className="half">
                <h4>💸 Expenses</h4>
                <table className="expenses-inner-table">
                  <thead>
                    <tr><th>Title</th><th>Amount</th><th>Category</th><th>Date</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {expenses.length > 0 ? (
                      expenses.map((exp) => (
                        <tr key={exp.id}>
                          <td>{exp.title}</td>
                          <td className="amount-out">{formatCurrency(-exp.amount)}</td>
                          <td>{exp.category}</td>
                          <td>{exp.paymentDate?.split?.("T")[0] ?? exp.paymentDate}</td>
                          <td>
                            <button onClick={() => handleEdit(exp)}>Edit</button>
                            <button onClick={() => handleDeleteExpense(exp.id, selectedCase)}>Delete</button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan="5">No expenses yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="half">
                <h4>💰 Payments Received</h4>
                <table className="expenses-inner-table">
                  <thead>
                    <tr><th>Mode</th><th>Amount</th><th>Ref No.</th><th>Date</th></tr>
                  </thead>
                  <tbody>
                    {payments.length > 0 ? (
                      payments.map((p, idx) => (
                        <tr key={idx}>
                          <td>{p.paymentMode}</td>
                          <td className="amount-in">{formatCurrency(p.amount)}</td>
                          <td>{p.referenceNumber}</td>
                          <td>{p.paymentDate?.split?.("T")[0] ?? p.paymentDate}</td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan="4">No payments yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="totals-summary">
              <div className="summary-box">
                <span className="summary-lbl">Total Given</span>
                <strong className="summary-val text-green">{formatCurrency(sumAmounts(payments))}</strong>
              </div>
              <div className="summary-box">
                <span className="summary-lbl">Total Spent</span>
                <strong className="summary-val text-red">{formatCurrency(sumAmounts(expenses))}</strong>
              </div>
              <div className="summary-box">
                <span className="summary-lbl">Balance</span>
                <strong className={`summary-val ${sumAmounts(payments) - sumAmounts(expenses) >= 0 ? "text-green" : "text-red"}`}>
                  {formatCurrency(sumAmounts(payments) - sumAmounts(expenses))}
                </strong>
              </div>
            </div>

            <div className="report-buttons">
              <button className="print-btn" onClick={handlePrint}>🖨️ Print View</button>
              <button className="download-btn" onClick={handleDownloadPDF}>⬇️ Download View</button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------ TODAY REPORT (big) ------------------ */}
      {showTodayModal && todaySummary && (
        <div className="expense-modal-overlay" onClick={() => setShowTodayModal(false)}>
          <div className="expense-modal big" onClick={(e) => e.stopPropagation()}>
            <button className="close-icon" onClick={() => setShowTodayModal(false)}>×</button>
            <h3>📅 Today’s Financial Summary — {todaySummary.date}</h3>

            <div className="report-section">
              <div className="half">
                <h4>💸 Expenses</h4>
                <p><b>Total:</b> {formatCurrency(todaySummary.totalExpenses)}</p>
                <table className="expenses-inner-table">
                  <thead><tr><th>Title</th><th>Amount</th><th>Category</th><th>Date</th></tr></thead>
                  <tbody>
                    {todaySummary.expenses.length > 0 ? (
                      todaySummary.expenses.map((exp) => (
                        <tr key={exp.id}><td>{exp.title}</td><td className="amount-out">{formatCurrency(-exp.amount)}</td><td>{exp.category}</td><td>{exp.paymentDate?.split?.("T")[0] ?? exp.paymentDate}</td></tr>
                      ))
                    ) : (<tr><td colSpan="4">No expenses today.</td></tr>)}
                  </tbody>
                </table>
              </div>

              <div className="half">
                <h4>💰 Payments</h4>
                <p><b>Total:</b> {formatCurrency(todaySummary.totalPayments)}</p>
                <table className="expenses-inner-table">
                  <thead><tr><th>Mode</th><th>Amount</th><th>Ref No</th><th>Date</th></tr></thead>
                  <tbody>
                    {todaySummary.payments.length > 0 ? (
                      todaySummary.payments.map((p, i) => (
                        <tr key={i}><td>{p.paymentMode}</td><td className="amount-in">{formatCurrency(p.amount)}</td><td>{p.referenceNumber}</td><td>{p.paymentDate?.split?.("T")[0] ?? p.paymentDate}</td></tr>
                      ))
                    ) : (<tr><td colSpan="4">No payments today.</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="report-buttons">
              <button onClick={handlePrint}>🖨️ Print</button>
              <button onClick={handleDownloadPDF}>⬇️ Download</button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------ MONTHLY REPORT (big) ------------------ */}
      {showMonthlyModal && monthlyReport && (
        <div className="expense-modal-overlay" onClick={() => setShowMonthlyModal(false)}>
          <div className="expense-modal big" onClick={(e) => e.stopPropagation()}>
            <button className="close-icon" onClick={() => setShowMonthlyModal(false)}>×</button>
            <h3>📊 Monthly Report — {monthlyReport.expenses.month}/{monthlyReport.expenses.year}</h3>

            <div className="report-section">
              <div className="half">
                <h4>💸 Expenses — {formatCurrency(monthlyReport.expenses.totalExpenses)}</h4>
                <table className="expenses-inner-table">
                  <thead><tr><th>Title</th><th>Amount</th><th>Category</th></tr></thead>
                  <tbody>
                    {monthlyReport.expenses.list.length > 0 ? (
                     monthlyReport.expenses.list.map((exp, index) => (
   <tr key={exp.id || index}>
    <td>{exp.title}</td>
    <td className="amount-out">{formatCurrency(-exp.amount)}</td>
    <td>{exp.category}</td>
  </tr>
))

                    ) : (<tr><td colSpan="3">No expenses this month.</td></tr>)}
                  </tbody>
                </table>

                <h4 className="breakdown-title">Category Breakdown</h4>
                <ul>
                  {Object.entries(monthlyReport.expenses.categoryBreakdown || {}).length > 0 ? (
                    Object.entries(monthlyReport.expenses.categoryBreakdown).map(([cat, amt], idx) => (
                      <li key={cat || `cat-${idx}`}>{cat}: {formatCurrency(amt)}</li>
                    ))
                  ) : (
                    <li>No breakdown available.</li>
                  )}
                </ul>
              </div>

              <div className="half">
                <h4>💰 Payments — {formatCurrency(monthlyReport.payments.totalAmount)}</h4>
                <table className="expenses-inner-table">
                  <thead><tr><th>Mode</th><th>Amount</th><th>Ref No</th></tr></thead>
                  <tbody>
                    {monthlyReport.payments.list.length > 0 ? (
                      monthlyReport.payments.list.map((p, index) => (
  <tr key={p.id || `pay-${index}`}>
    <td>{p.paymentMode}</td>
    <td className="amount-in">{formatCurrency(p.amount)}</td>
    <td>{p.referenceNumber}</td>
  </tr>
))

                    ) : (<tr><td colSpan="3">No payments this month.</td></tr>)}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="report-buttons">
              <button onClick={handlePrint}>🖨️ Print</button>
              <button onClick={handleDownloadPDF}>⬇️ Download</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Expenses;
