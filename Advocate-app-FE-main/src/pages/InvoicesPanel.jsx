import React, { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { FiSearch, FiDownload, FiPlus, FiCheckCircle } from "react-icons/fi";
import { SkeletonPage } from "../components/Skeleton";
import { formatCurrency } from "../utils/formatCurrency";
import Pagination from "../components/Pagination";
import usePagination from "../hooks/usePagination";
import "../assets/styles/InvoicesPanel.css";

export default function InvoicesPanel() {
  const [invoices, setInvoices] = useState([]);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [cases, setCases] = useState([]);
  const [summary, setSummary] = useState({ paid: 0, unpaid: 0, overdue: 0, monthlyRevenue: 0 });
  const [showModal, setShowModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [newInvoice, setNewInvoice] = useState({
    invoiceNumber: "",
    amount: "",
    invoiceDate: "",
    dueDate: "",
    caseId: ""
  });
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState("");
  const [highlightedId, setHighlightedId] = useState(null);
  const location = useLocation();
  const { page, setPage, size, setSize } = usePagination({ defaultSize: 20, resetOn: [searchText] });

  const modalRef = useRef(null);
  const firstInputRef = useRef(null);
  const triggerRef = useRef(null);

  const token = localStorage.getItem("token");
  const { withLoading } = useLoading();
  const { success, error } = useToast();

  const fetchInvoices = useCallback(async () => {
    try {
      const res = await axios.get("/api/invoices", {
        headers: { Authorization: `Bearer ${token}` },
        params: { page, size, keyword: searchText || undefined }
      });
      setInvoices(res.data.content || []);
      setTotalPages(res.data.totalPages || 0);
      setTotalElements(res.data.totalElements || 0);
    } catch (err) {
      console.error("Error fetching invoices:", err);
    } finally {
      setLoading(false);
    }
  }, [token, page, size, searchText]);

  const fetchCases = async () => {
    try {
      const res = await axios.get("/api/cases/my-cases", {
        headers: { Authorization: `Bearer ${token}` }
      });
      setCases(res.data || []);
    } catch (err) {
      console.error("Error fetching cases:", err);
    }
  };

  const fetchSummary = async () => {
    try {
      const res = await axios.get("/api/invoices/summary", {
        headers: { Authorization: `Bearer ${token}` }
      });
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
    const handler = (e) => {
      if (e.detail === "create-invoice") {
        setShowModal(true);
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

  const handleChange = (e) => {
    setNewInvoice({ ...newInvoice, [e.target.name]: e.target.value });
  };

  const handleClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(() => {
      setShowModal(false);
      setClosing(false);
      setNewInvoice({ invoiceNumber: "", amount: "", invoiceDate: "", dueDate: "", caseId: "" });
      triggerRef.current?.focus();
    }, 200);
  }, [closing]);

  useEffect(() => {
    if (!showModal && !closing) return;
    const handleEsc = (e) => {
      if (e.key === "Escape" && !submitting) handleClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [showModal, closing, handleClose, submitting]);

  useEffect(() => {
    if (showModal && !closing) {
      document.body.style.overflow = "hidden";
      requestAnimationFrame(() => firstInputRef.current?.focus());
    } else if (!showModal && !closing) {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [showModal, closing]);

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget && !submitting) handleClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await withLoading(
        axios.post(
          "/api/invoices/create",
          {
            invoiceNumber: newInvoice.invoiceNumber,
            amount: Number(newInvoice.amount),
            invoiceDate: newInvoice.invoiceDate ? newInvoice.invoiceDate : null,
            dueDate: newInvoice.dueDate ? newInvoice.dueDate : null,
            caseEntity: { id: Number(newInvoice.caseId) }
          },
          { headers: { Authorization: `Bearer ${token}` } }
        ),
        "Generating Invoice..."
      );

      setSubmitting(false);
      handleClose();
      fetchInvoices();
      fetchSummary();
    } catch (err) {
      setSubmitting(false);
      console.error("Error creating invoice:", err);
      error(err.response?.data || "Failed to create invoice.");
    }
  };

  const handlePay = async (id) => {
    if (!window.confirm("Mark this invoice as Paid?")) return;
    try {
      await withLoading(
        axios.put(`/api/invoices/pay/${id}`, {}, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        "Sending Invoice..."
      );
      fetchInvoices();
      fetchSummary();
      success("Invoice marked as Paid!");
    } catch (err) {
      console.error("Error paying invoice:", err);
      error("Failed to pay invoice.");
    }
  };

  const handleDownloadPDF = async (id, invNum) => {
    try {
      const res = await axios.get(`/api/reports/invoice/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        responseType: "blob"
      });
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

  if (loading) {
    return <SkeletonPage />;
  }

  return (
    <div className="invoices-container">
      <div className="invoices-header">
        <div>
          <h2>💵 Invoices Ledger</h2>
          <p className="subtle">Track billing summaries, issue client invoices, and record payments.</p>
        </div>
        <button ref={triggerRef} className="add-invoice-btn" onClick={() => setShowModal(true)}>
          <FiPlus /> Generate Invoice
        </button>
      </div>

      <div className="inv-search-bar">
        <FiSearch className="inv-search-icon" />
        <input
          type="text"
          placeholder="Search by invoice number, client, or case..."
          value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setHighlightedId(null); }}
        />
      </div>

      <div className="inv-summary-cards">
        <div className="inv-card paid">
          <div className="inv-card-header">
            <span>Paid Invoices</span>
            <span className="card-icon">🟢</span>
          </div>
          <h3>{formatCurrency(summary.paid)}</h3>
          <p>Total cash collected</p>
        </div>

        <div className="inv-card unpaid">
          <div className="inv-card-header">
            <span>Unpaid Invoices</span>
            <span className="card-icon">⌛</span>
          </div>
          <h3>{formatCurrency(summary.unpaid)}</h3>
          <p>Outstanding client dues</p>
        </div>

        <div className="inv-card overdue">
          <div className="inv-card-header">
            <span>Overdue Dues</span>
            <span className="card-icon">🔴</span>
          </div>
          <h3>{formatCurrency(summary.overdue)}</h3>
          <p>Payment deadline passed</p>
        </div>
      </div>

      <div className="invoices-table-card">
        {invoices.length === 0 ? (
          <p className="no-data">No invoices generated yet.</p>
        ) : (
          <div className="table-responsive">
            <table>
              <thead>
                <tr>
                  <th>Invoice Number</th>
                  <th>Client</th>
                  <th>Case Number</th>
                  <th>Amount</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id} className={highlightedId === inv.id ? "highlight-row" : ""} ref={(el) => { if (highlightedId === inv.id && el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
                    <td><strong>{inv.invoiceNumber}</strong></td>
                    <td>{inv.clientName}</td>
                    <td>{inv.caseEntity?.caseNumber}</td>
                    <td>{formatCurrency(inv.amount)}</td>
                    <td>{new Date(inv.dueDate).toLocaleDateString()}</td>
                    <td>
                      <span className={`status-pill ${inv.status.toLowerCase()}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="actions-cell">
                      {inv.status !== "PAID" && (
                        <button className="pay-btn" onClick={() => handlePay(inv.id)} title="Mark Paid">
                          <FiCheckCircle /> Mark Paid
                        </button>
                      )}
                      <button className="download-btn" onClick={() => handleDownloadPDF(inv.id, inv.invoiceNumber)} title="Download PDF">
                        <FiDownload /> Export
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={page}
          totalPages={totalPages}
          totalElements={totalElements}
          size={size}
          onPageChange={setPage}
          onSizeChange={setSize}
        />
      </div>

      {(showModal || closing) && (
        <div className={`inv-modal-overlay ${closing ? "closing" : ""}`} onClick={handleOverlayClick}>
          <div className={`inv-modal ${closing ? "closing" : ""}`} ref={modalRef} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="inv-modal-title">
            <div className="inv-modal-header">
              <div>
                <h3 id="inv-modal-title">Generate Invoice</h3>
                <p className="inv-modal-subtitle">Create an invoice for the selected client.</p>
              </div>
              <button className="inv-modal-close" onClick={handleClose} disabled={submitting} aria-label="Close">&times;</button>
            </div>

            <form onSubmit={handleSubmit} className="inv-form" noValidate>
              <div className="inv-form-row">
                <div className="inv-form-group">
                  <label htmlFor="inv-invoiceNumber">Invoice Number</label>
                  <input id="inv-invoiceNumber" ref={firstInputRef} name="invoiceNumber" placeholder="e.g. INV-1002" value={newInvoice.invoiceNumber} onChange={handleChange} required />
                </div>
                <div className="inv-form-group">
                  <label htmlFor="inv-amount">Amount (₹)</label>
                  <input id="inv-amount" name="amount" type="number" step="0.01" min="0" placeholder="0.00" value={newInvoice.amount} onChange={handleChange} required />
                </div>
              </div>

              <div className="inv-form-row">
                <div className="inv-form-group">
                  <label htmlFor="inv-invoiceDate">Invoice Date</label>
                  <input id="inv-invoiceDate" name="invoiceDate" type="date" value={newInvoice.invoiceDate} onChange={handleChange} required />
                </div>
                <div className="inv-form-group">
                  <label htmlFor="inv-dueDate">Due Date</label>
                  <input id="inv-dueDate" name="dueDate" type="date" value={newInvoice.dueDate} onChange={handleChange} required />
                </div>
              </div>

              <div className="inv-form-group full-width">
                <label htmlFor="inv-caseId">Associated Case</label>
                <select id="inv-caseId" name="caseId" value={newInvoice.caseId} onChange={handleChange} required>
                  <option value="">Select a case...</option>
                  {cases.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.caseNumber} &mdash; {c.caseTitle} (Client: {c.clientName || "N/A"})
                    </option>
                  ))}
                </select>
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

              <div className="inv-modal-footer">
                <button type="button" className="inv-btn-cancel" onClick={handleClose} disabled={submitting}>Cancel</button>
                <button type="submit" className="inv-btn-submit" disabled={submitting}>
                  {submitting ? (
                    <><span className="inv-spinner" /> Generating...</>
                  ) : (
                    "Generate Invoice"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
