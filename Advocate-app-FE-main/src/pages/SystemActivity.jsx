import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { FiSearch, FiX, FiDownload, FiClock, FiUser, FiGlobe, FiMonitor, FiSmartphone, FiServer, FiCalendar, FiActivity } from "react-icons/fi";
import Pagination from "../components/Pagination";
import { useDownload } from "../hooks/useDownload";
import DownloadLoader from "../components/DownloadLoader";
import "../assets/styles/SystemActivity.css";

const API = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api/audit`;

const ACTION_TYPES = [
  { value: "LOGIN", label: "Login" },
  { value: "LOGOUT", label: "Logout" },
  { value: "FAILED_LOGIN", label: "Failed Login" },
  { value: "PASSWORD_CHANGED", label: "Password Changed" },
  { value: "PASSWORD_RESET", label: "Password Reset" },
  { value: "PROFILE_UPDATED", label: "Profile Updated" },
  { value: "SETTINGS_UPDATED", label: "Settings Updated" },
  { value: "CLIENT_CREATED", label: "Client Created" },
  { value: "CLIENT_UPDATED", label: "Client Updated" },
  { value: "CLIENT_DELETED", label: "Client Archived" },
  { value: "CLIENT_RESTORED", label: "Client Restored" },
  { value: "CASE_CREATED", label: "Case Created" },
  { value: "CASE_UPDATED", label: "Case Updated" },
  { value: "CASE_STATUS_CHANGED", label: "Case Status Changed" },
  { value: "CASE_DELETED", label: "Case Deleted" },
  { value: "HEARING_CREATED", label: "Hearing Created" },
  { value: "HEARING_UPDATED", label: "Hearing Updated" },
  { value: "HEARING_RESCHEDULED", label: "Hearing Rescheduled" },
  { value: "HEARING_DELETED", label: "Hearing Deleted" },
  { value: "DOCUMENT_UPLOADED", label: "Document Uploaded" },
  { value: "DOCUMENT_DELETED", label: "Document Deleted" },
  { value: "EXPENSE_CREATED", label: "Expense Created" },
  { value: "EXPENSE_UPDATED", label: "Expense Updated" },
  { value: "EXPENSE_DELETED", label: "Expense Deleted" },
  { value: "PAYMENT_RECEIVED", label: "Payment Received" },
  { value: "PAYMENT_UPDATED", label: "Payment Updated" },
  { value: "PAYMENT_DELETED", label: "Payment Deleted" },
  { value: "INVOICE_GENERATED", label: "Invoice Generated" },
  { value: "INVOICE_PAID", label: "Invoice Paid" },
  { value: "EMAIL_SENT", label: "Email Sent" },
  { value: "WHATSAPP_SENT", label: "WhatsApp Sent" },
  { value: "EXPORT_CSV", label: "CSV Export" },
  { value: "EXPORT_EXCEL", label: "Excel Export" },
  { value: "EXPORT_PDF", label: "PDF Export" },
];

const MODULES = [
  { value: "Authentication", label: "Authentication" },
  { value: "Profile", label: "Profile" },
  { value: "Clients", label: "Clients" },
  { value: "Cases", label: "Cases" },
  { value: "Hearings", label: "Hearings" },
  { value: "Documents", label: "Documents" },
  { value: "Expenses", label: "Expenses" },
  { value: "Payments", label: "Payments" },
  { value: "Invoices", label: "Invoices" },
  { value: "Communication", label: "Communication" },
  { value: "Exports", label: "Exports" },
  { value: "Settings", label: "Settings" },
];

const STATUSES = [
  { value: "SUCCESS", label: "Success" },
  { value: "FAILED", label: "Failed" },
];

const DATE_PRESETS = [
  { value: "", label: "All Time" },
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 Days" },
  { value: "30d", label: "Last 30 Days" },
  { value: "custom", label: "Custom Range" },
];

function getToken() {
  return localStorage.getItem("token");
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(iso) {
  if (!iso) return "";
  return formatDate(iso) + " " + formatTime(iso);
}

function getDateRange(preset) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  let start;
  switch (preset) {
    case "today":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case "yesterday":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      end.setDate(end.getDate() - 1);
      break;
    case "7d":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      break;
    case "30d":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
      break;
    default:
      return { dateFrom: null, dateTo: null };
  }
  start.setHours(0, 0, 0, 0);
  return { dateFrom: start.toISOString(), dateTo: end.toISOString() };
}

function getActionColor(type) {
  if (!type) return "var(--text-muted)";
  if (type.includes("CREATED") || type.includes("SENT") || type.includes("RECEIVED") || type.includes("GENERATED") || type.includes("PAID") || type === "LOGIN") return "#10b981";
  if (type.includes("UPDATED") || type.includes("CHANGED") || type.includes("RESET") || type.includes("RESCHEDULED")) return "#3b82f6";
  if (type.includes("DELETED") || type === "FAILED_LOGIN") return "#ef4444";
  if (type.includes("EXPORT") || type.includes("DOWNLOAD")) return "#8b5cf6";
  return "#f59e0b";
}

export default function SystemActivity() {
  const { withLoading } = useLoading();
  const toast = useToast();

  const [data, setData] = useState({ content: [], totalElements: 0, totalPages: 0, page: 0 });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [module, setModule] = useState("");
  const [actionType, setActionType] = useState("");
  const [status, setStatus] = useState("");
  const [datePreset, setDatePreset] = useState("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [page, setPage] = useState(0);
  const [size] = useState(25);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [exporting, setExporting] = useState(false);
  const { isDownloading, withDownload } = useDownload();

  const fetchData = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const params = { page: p, size };
      if (search) params.search = search;
      if (module) params.module = module;
      if (actionType) params.actionType = actionType;
      if (status) params.status = status;
      if (datePreset && datePreset !== "custom") {
        const range = getDateRange(datePreset);
        if (range.dateFrom) params.dateFrom = range.dateFrom;
        if (range.dateTo) params.dateTo = range.dateTo;
      } else if (datePreset === "custom" && customFrom && customTo) {
        params.dateFrom = new Date(customFrom).toISOString();
        params.dateTo = new Date(customTo + "T23:59:59").toISOString();
      }
      const res = await withLoading(
        axios.get(API, { headers: { Authorization: `Bearer ${getToken()}` }, params }),
        "Loading activity log..."
      );
      setData(res.data);
    } catch (err) {
      toast.error("Failed to load activity log");
    } finally {
      setLoading(false);
    }
  }, [page, size, search, module, actionType, status, datePreset, customFrom, customTo, withLoading, toast]);

  useEffect(() => {
    fetchData(0);
  }, [module, actionType, status, datePreset]);

  useEffect(() => {
    fetchData();
  }, [page]);

  const handleSearch = () => {
    setSearch(searchInput);
    setPage(0);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSearch();
  };

  const handleClearFilters = () => {
    setSearchInput("");
    setSearch("");
    setModule("");
    setActionType("");
    setStatus("");
    setDatePreset("");
    setCustomFrom("");
    setCustomTo("");
    setPage(0);
  };

  const hasFilters = search || module || actionType || status || datePreset;

  const fetchAllForExport = async () => {
    const params = { page: 0, size: 10000 };
    if (search) params.search = search;
    if (module) params.module = module;
    if (actionType) params.actionType = actionType;
    if (status) params.status = status;
    if (datePreset && datePreset !== "custom") {
      const range = getDateRange(datePreset);
      if (range.dateFrom) params.dateFrom = range.dateFrom;
      if (range.dateTo) params.dateTo = range.dateTo;
    } else if (datePreset === "custom" && customFrom && customTo) {
      params.dateFrom = new Date(customFrom).toISOString();
      params.dateTo = new Date(customTo + "T23:59:59").toISOString();
    }
    const res = await axios.get(API, { headers: { Authorization: `Bearer ${getToken()}` }, params });
    return res.data.content || [];
  };

  const exportCSV = async () => {
    await withDownload(async () => {
      setExporting(true);
      try {
        const items = await fetchAllForExport();
        const headers = ["Timestamp", "User", "Action Type", "Module", "Title", "Description", "Status", "IP Address", "Browser", "OS", "Method", "URI"];
        const rows = items.map(i => [
          formatDateTime(i.createdAt),
          i.userName || "",
          i.actionType || "",
          i.module || "",
          (i.title || "").replace(/,/g, ";"),
          (i.description || "").replace(/,/g, ";"),
          i.status || "",
          i.ipAddress || "",
          i.browser || "",
          i.operatingSystem || "",
          i.requestMethod || "",
          i.requestUri || "",
        ]);
        const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "SystemActivity.csv";
        a.click();
        URL.revokeObjectURL(url);
        toast.success("CSV exported successfully");
      } catch (err) {
        toast.error("Failed to export CSV");
      } finally {
        setExporting(false);
      }
    }, "Exporting CSV...");
  };

  const exportExcel = async () => {
    await withDownload(async () => {
      setExporting(true);
      try {
        const items = await fetchAllForExport();
        let html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="UTF-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Sheet1</x:Name></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table>';
        html += "<tr><th>Timestamp</th><th>User</th><th>Action Type</th><th>Module</th><th>Title</th><th>Description</th><th>Status</th><th>IP</th><th>Browser</th><th>OS</th><th>Method</th><th>URI</th></tr>";
        items.forEach(i => {
          html += `<tr><td>${formatDateTime(i.createdAt)}</td><td>${i.userName || ""}</td><td>${i.actionType || ""}</td><td>${i.module || ""}</td><td>${(i.title || "").replace(/</g, "&lt;")}</td><td>${(i.description || "").replace(/</g, "&lt;")}</td><td>${i.status || ""}</td><td>${i.ipAddress || ""}</td><td>${i.browser || ""}</td><td>${i.operatingSystem || ""}</td><td>${i.requestMethod || ""}</td><td>${i.requestUri || ""}</td></tr>`;
        });
        html += "</table></body></html>";
        const blob = new Blob([html], { type: "application/vnd.ms-excel" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "SystemActivity.xls";
        a.click();
        URL.revokeObjectURL(url);
        toast.success("Excel exported successfully");
      } catch (err) {
        toast.error("Failed to export Excel");
      } finally {
        setExporting(false);
      }
    }, "Exporting Excel...");
  };

  const exportPDF = async () => {
    await withDownload(async () => {
      setExporting(true);
      try {
        const items = await fetchAllForExport();
        const { jsPDF } = await import("jspdf");
        const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
        const pageWidth = doc.internal.pageSize.getWidth();
        let y = 15;

        doc.setFontSize(16);
        doc.text("System Activity Report", pageWidth / 2, y, { align: "center" });
        y += 10;

        doc.setFontSize(9);
        doc.text(`Generated: ${new Date().toLocaleString()} | Records: ${items.length}`, pageWidth / 2, y, { align: "center" });
        y += 8;

        if (search) { doc.text(`Search: ${search}`, 14, y); y += 6; }
        if (module) { doc.text(`Module: ${module}`, 14, y); y += 6; }
        if (actionType) { doc.text(`Action: ${actionType}`, 14, y); y += 6; }
        if (status) { doc.text(`Status: ${status}`, 14, y); y += 6; }
        y += 4;

        const cols = ["Timestamp", "User", "Action", "Module", "Title", "Status"];
        const colWidths = [35, 30, 35, 30, 60, 20];
        const startX = 14;

        const drawRow = (cells, isHeader) => {
          let x = startX;
          doc.setFontSize(isHeader ? 8 : 7);
          doc.setFont(undefined, isHeader ? "bold" : "normal");
          cells.forEach((cell, i) => {
            doc.text(String(cell).substring(0, Math.floor(colWidths[i] / 1.5)), x + 1, y + 4);
            doc.rect(x, y, colWidths[i], 7);
            x += colWidths[i];
          });
          y += 7;
        };

        doc.setFillColor(240, 240, 240);
        drawRow(cols, true);

        items.forEach((item, idx) => {
          if (y > 185) {
            doc.addPage();
            y = 15;
            doc.setFillColor(240, 240, 240);
            drawRow(cols, true);
          }
          drawRow([
            formatDateTime(item.createdAt),
            item.userName || "",
            item.actionType || "",
            item.module || "",
            item.title || "",
            item.status || "",
          ], false);
        });

        doc.save("SystemActivity.pdf");
        toast.success("PDF exported successfully");
      } catch (err) {
        toast.error("Failed to export PDF");
      } finally {
        setExporting(false);
      }
    }, "Exporting PDF...");
  };

  return (
    <div className="system-activity-container">
      {isDownloading && <DownloadLoader message="Exporting..." />}
      <div className="sa-header">
        <h2><FiActivity /> System Activity</h2>
        <span className="sa-total">{data.totalElements} records</span>
      </div>

      <div className="sa-filters">
        <div className="sa-filter-row">
          <div className="sa-search-box">
            <FiSearch />
            <input
              type="text"
              placeholder="Search title, description..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            {searchInput && <FiX className="sa-clear-search" onClick={() => { setSearchInput(""); setSearch(""); }} />}
          </div>
          <button className="sa-search-btn" onClick={handleSearch}>Search</button>
          <select value={module} onChange={(e) => { setModule(e.target.value); setPage(0); }}>
            <option value="">All Modules</option>
            {MODULES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <select value={actionType} onChange={(e) => { setActionType(e.target.value); setPage(0); }}>
            <option value="">All Actions</option>
            {ACTION_TYPES.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
            <option value="">All Statuses</option>
            {STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={datePreset} onChange={(e) => { setDatePreset(e.target.value); setPage(0); }}>
            {DATE_PRESETS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          {hasFilters && (
            <button className="sa-clear-filters" onClick={handleClearFilters}>
              <FiX /> Clear
            </button>
          )}
        </div>
        {datePreset === "custom" && (
          <div className="sa-custom-date-row">
            <label>From:</label>
            <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <label>To:</label>
            <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            <button className="sa-apply-btn" onClick={() => { setPage(0); fetchData(0); }}>Apply</button>
          </div>
        )}
      </div>

      <div className="sa-export-bar">
        <button className="sa-export-btn csv" onClick={exportCSV} disabled={exporting}>
          <FiDownload /> CSV
        </button>
        <button className="sa-export-btn excel" onClick={exportExcel} disabled={exporting}>
          <FiDownload /> Excel
        </button>
        <button className="sa-export-btn pdf" onClick={exportPDF} disabled={exporting}>
          <FiDownload /> PDF
        </button>
      </div>

      <div className="sa-table-wrapper">
        <table className="sa-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User</th>
              <th>Action</th>
              <th>Module</th>
              <th>Title</th>
              <th>Status</th>
              <th className="sa-col-details">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="sa-loading-row">Loading...</td></tr>
            ) : data.content.length === 0 ? (
              <tr><td colSpan={7} className="sa-empty-row">No activity records found</td></tr>
            ) : (
              data.content.map((item) => (
                <tr
                  key={item.id}
                  className={`sa-row ${selectedEvent?.id === item.id ? "selected" : ""}`}
                  onClick={() => setSelectedEvent(item)}
                >
                  <td className="sa-cell-time">
                    <span className="sa-date">{formatDate(item.createdAt)}</span>
                    <span className="sa-time">{formatTime(item.createdAt)}</span>
                  </td>
                  <td className="sa-cell-user">{item.userName || "-"}</td>
                  <td>
                    <span className="sa-action-badge" style={{ backgroundColor: getActionColor(item.actionType) + "20", color: getActionColor(item.actionType), borderColor: getActionColor(item.actionType) + "40" }}>
                      {item.actionType}
                    </span>
                  </td>
                  <td className="sa-cell-module">{item.module || "-"}</td>
                  <td className="sa-cell-title">{item.title || "-"}</td>
                  <td>
                    <span className={`sa-status-badge ${(item.status || "").toLowerCase()}`}>
                      {item.status || "-"}
                    </span>
                  </td>
                  <td className="sa-cell-details">
                    <button className="sa-view-btn" onClick={(e) => { e.stopPropagation(); setSelectedEvent(item); }}>
                      View
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        totalPages={data.totalPages || 0}
        totalElements={data.totalElements || 0}
        size={size}
        onPageChange={setPage}
        onSizeChange={() => {}}
      />

      {selectedEvent && (
        <div className="sa-drawer-overlay" onClick={() => setSelectedEvent(null)}>
          <div className="sa-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="sa-drawer-header">
              <h3><FiActivity /> Event Details</h3>
              <button className="sa-drawer-close" onClick={() => setSelectedEvent(null)}><FiX /></button>
            </div>
            <div className="sa-drawer-body">
              <div className="sa-detail-grid">
                <div className="sa-detail-section">
                  <h4>Basic Info</h4>
                  <div className="sa-detail-row"><span className="sa-detail-label">ID</span><span className="sa-detail-value">#{selectedEvent.id}</span></div>
                  <div className="sa-detail-row"><span className="sa-detail-label">Action Type</span><span className="sa-detail-value"><span className="sa-action-badge" style={{ backgroundColor: getActionColor(selectedEvent.actionType) + "20", color: getActionColor(selectedEvent.actionType), borderColor: getActionColor(selectedEvent.actionType) + "40" }}>{selectedEvent.actionType}</span></span></div>
                  <div className="sa-detail-row"><span className="sa-detail-label">Module</span><span className="sa-detail-value">{selectedEvent.module || "-"}</span></div>
                  <div className="sa-detail-row"><span className="sa-detail-label">Status</span><span className="sa-detail-value"><span className={`sa-status-badge ${(selectedEvent.status || "").toLowerCase()}`}>{selectedEvent.status || "-"}</span></span></div>
                  <div className="sa-detail-row"><span className="sa-detail-label">Title</span><span className="sa-detail-value">{selectedEvent.title || "-"}</span></div>
                  <div className="sa-detail-row"><span className="sa-detail-label">Description</span><span className="sa-detail-value sa-desc-value">{selectedEvent.description || "-"}</span></div>
                </div>
                <div className="sa-detail-section">
                  <h4>Entity</h4>
                  <div className="sa-detail-row"><span className="sa-detail-label">Entity Type</span><span className="sa-detail-value">{selectedEvent.entityType || "-"}</span></div>
                  <div className="sa-detail-row"><span className="sa-detail-label">Entity ID</span><span className="sa-detail-value">{selectedEvent.entityId != null ? `#${selectedEvent.entityId}` : "-"}</span></div>
                </div>
                <div className="sa-detail-section">
                  <h4><FiUser /> User</h4>
                  <div className="sa-detail-row"><span className="sa-detail-label">Name</span><span className="sa-detail-value">{selectedEvent.userName || "-"}</span></div>
                  <div className="sa-detail-row"><span className="sa-detail-label">Advocate ID</span><span className="sa-detail-value">#{selectedEvent.advocateId}</span></div>
                </div>
                <div className="sa-detail-section">
                  <h4><FiServer /> Request</h4>
                  <div className="sa-detail-row"><span className="sa-detail-label">Method</span><span className="sa-detail-value"><code>{selectedEvent.requestMethod || "-"}</code></span></div>
                  <div className="sa-detail-row"><span className="sa-detail-label">URI</span><span className="sa-detail-value"><code>{selectedEvent.requestUri || "-"}</code></span></div>
                </div>
                <div className="sa-detail-section">
                  <h4><FiMonitor /> Device</h4>
                  <div className="sa-detail-row"><span className="sa-detail-label"><FiGlobe /> IP Address</span><span className="sa-detail-value"><code>{selectedEvent.ipAddress || "-"}</code></span></div>
                  <div className="sa-detail-row"><span className="sa-detail-label"><FiMonitor /> Browser</span><span className="sa-detail-value">{selectedEvent.browser || "-"}</span></div>
                  <div className="sa-detail-row"><span className="sa-detail-label"><FiSmartphone /> OS</span><span className="sa-detail-value">{selectedEvent.operatingSystem || "-"}</span></div>
                  <div className="sa-detail-row"><span className="sa-detail-label">Device</span><span className="sa-detail-value">{selectedEvent.device || "-"}</span></div>
                </div>
                <div className="sa-detail-section">
                  <h4><FiCalendar /> Timestamp</h4>
                  <div className="sa-detail-row"><span className="sa-detail-label">Date</span><span className="sa-detail-value">{formatDate(selectedEvent.createdAt)}</span></div>
                  <div className="sa-detail-row"><span className="sa-detail-label">Time</span><span className="sa-detail-value">{formatTime(selectedEvent.createdAt)}</span></div>
                  <div className="sa-detail-row"><span className="sa-detail-label">Full</span><span className="sa-detail-value">{formatDateTime(selectedEvent.createdAt)}</span></div>
                </div>
                {selectedEvent.metadata && (
                  <div className="sa-detail-section sa-detail-fullwidth">
                    <h4>Metadata</h4>
                    <pre className="sa-metadata">{selectedEvent.metadata}</pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
