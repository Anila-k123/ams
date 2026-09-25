import { useState, useEffect, useCallback, useMemo } from "react";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Paginator } from "primereact/paginator";
import { Sidebar } from "primereact/sidebar";
import { Tag } from "primereact/tag";
import { IconField } from "primereact/iconfield";
import { InputIcon } from "primereact/inputicon";
import api from "../api/client";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { useDownload } from "../hooks/useDownload";
import DownloadLoader from "../components/DownloadLoader";
import "../assets/styles/SystemActivity.css";

const API = "/api/audit";

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

function formatDate(iso: any) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatTime(iso: any) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(iso: any) {
  if (!iso) return "";
  return formatDate(iso) + " " + formatTime(iso);
}

function getDateRange(preset: string) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  let start: Date;
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

function getActionColor(type: any) {
  if (!type) return "var(--text-muted)";
  if (type.includes("CREATED") || type.includes("SENT") || type.includes("RECEIVED") || type.includes("GENERATED") || type.includes("PAID") || type === "LOGIN") return "#10b981";
  if (type.includes("UPDATED") || type.includes("CHANGED") || type.includes("RESET") || type.includes("RESCHEDULED")) return "#3b82f6";
  if (type.includes("DELETED") || type === "FAILED_LOGIN") return "#ef4444";
  if (type.includes("EXPORT") || type.includes("DOWNLOAD")) return "#8b5cf6";
  return "#f59e0b";
}

// Render one audit value for display. null/"" are meaningful in a diff - a
// field being cleared is a change worth seeing - so they get a visible marker
// rather than rendering as nothing.
function fmtVal(v: any) {
  if (v === null || v === undefined) return <em className="sa-change-empty">empty</em>;
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v);
  if (s === "") return <em className="sa-change-empty">empty</em>;
  if (s === "***") return <em className="sa-change-empty">hidden</em>;
  return s;
}

// Calendar <-> the "YYYY-MM-DD" strings the filter logic has always used.
const toDate = (s: string) => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fromDate = (d: any) => {
  if (!(d instanceof Date)) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function ActionBadge({ type }: { type: any }) {
  const c = getActionColor(type);
  return (
    <span className="sa-action-badge" style={{ backgroundColor: c + "20", color: c, borderColor: c + "40" }}>
      {type}
    </span>
  );
}

function StatusTag({ status }: { status: any }) {
  const s = (status || "").toUpperCase();
  return <Tag value={status || "-"} severity={s === "SUCCESS" ? "success" : s === "FAILED" ? "danger" : "secondary"} />;
}

function Row({ label, children }: { label: any; children: any }) {
  return (
    <div className="sa-detail-row">
      <span className="sa-detail-label">{label}</span>
      <span className="sa-detail-value">{children}</span>
    </div>
  );
}

export default function SystemActivity() {
  const { withLoading } = useLoading() as any;
  const toast = useToast() as any;

  const [data, setData] = useState<any>({ content: [], totalElements: 0, totalPages: 0, page: 0 });
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
  const [selectedEvent, setSelectedEvent] = useState<any>(null);

  // audit_log.metadata carries {"changes":[...]}; unparseable text falls
  // through to the raw view rather than blanking the panel.
  const parsedChanges = useMemo<any[]>(() => {
    if (!selectedEvent?.metadata) return [];
    try {
      const parsed = JSON.parse(selectedEvent.metadata);
      return Array.isArray(parsed?.changes) ? parsed.changes : [];
    } catch {
      return [];
    }
  }, [selectedEvent]);
  const [exporting, setExporting] = useState(false);
  const { isDownloading, withDownload } = useDownload() as any;

  const buildParams = (p: number, s: number) => {
    const params: any = { page: p, size: s };
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
    return params;
  };

  const fetchData = useCallback(async (p = page) => {
    setLoading(true);
    try {
      const res = await withLoading(api.get(API, { params: buildParams(p, size) }), "Loading activity log...");
      setData(res.data);
    } catch {
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
    const res = await api.get(API, { params: buildParams(0, 10000) });
    return res.data.content || [];
  };

  const saveBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = async () => {
    await withDownload(async () => {
      setExporting(true);
      try {
        const items = await fetchAllForExport();
        const headers = ["Timestamp", "User", "Action Type", "Module", "Title", "Description", "Status", "IP Address", "Browser", "OS", "Method", "URI"];
        const rows = items.map((i: any) => [
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
        const csv = [headers.join(","), ...rows.map((r: any[]) => r.join(","))].join("\n");
        saveBlob(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }), "SystemActivity.csv");
        toast.success("CSV exported successfully");
      } catch {
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
        items.forEach((i: any) => {
          html += `<tr><td>${formatDateTime(i.createdAt)}</td><td>${i.userName || ""}</td><td>${i.actionType || ""}</td><td>${i.module || ""}</td><td>${(i.title || "").replace(/</g, "&lt;")}</td><td>${(i.description || "").replace(/</g, "&lt;")}</td><td>${i.status || ""}</td><td>${i.ipAddress || ""}</td><td>${i.browser || ""}</td><td>${i.operatingSystem || ""}</td><td>${i.requestMethod || ""}</td><td>${i.requestUri || ""}</td></tr>`;
        });
        html += "</table></body></html>";
        saveBlob(new Blob([html], { type: "application/vnd.ms-excel" }), "SystemActivity.xls");
        toast.success("Excel exported successfully");
      } catch {
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
        const doc: any = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
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

        const drawRow = (cells: any[], isHeader: boolean) => {
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

        items.forEach((item: any) => {
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
      } catch {
        toast.error("Failed to export PDF");
      } finally {
        setExporting(false);
      }
    }, "Exporting PDF...");
  };

  const ev = selectedEvent;

  return (
    <div className="system-activity-container">
      {isDownloading && <DownloadLoader />}
      <div className="flex justify-content-end mb-2">
        <span className="sa-total">{data.totalElements} records</span>
      </div>

      <div className="flex flex-wrap align-items-center gap-2 mb-2">
        <IconField iconPosition="left">
          <InputIcon className="pi pi-search" />
          <InputText
            placeholder="Search title, description..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSearch(); }}
          />
        </IconField>
        {searchInput && (
          <Button icon="pi pi-times" rounded text severity="secondary" aria-label="Clear search" onClick={() => { setSearchInput(""); setSearch(""); }} />
        )}
        <Button label="Search" onClick={handleSearch} />
        <Dropdown placeholder="All Modules" value={module} options={[{ value: "", label: "All Modules" }, ...MODULES]} onChange={(e) => { setModule(e.value); setPage(0); }} />
        <Dropdown placeholder="All Actions" value={actionType} options={[{ value: "", label: "All Actions" }, ...ACTION_TYPES]} filter onChange={(e) => { setActionType(e.value); setPage(0); }} />
        <Dropdown placeholder="All Statuses" value={status} options={[{ value: "", label: "All Statuses" }, ...STATUSES]} onChange={(e) => { setStatus(e.value); setPage(0); }} />
        <Dropdown value={datePreset} options={DATE_PRESETS} onChange={(e) => { setDatePreset(e.value); setPage(0); }} />
        {hasFilters && <Button label="Clear" icon="pi pi-times" outlined severity="secondary" onClick={handleClearFilters} />}
      </div>
      {datePreset === "custom" && (
        <div className="flex flex-wrap align-items-center gap-2 mb-2">
          <label>From:</label>
          <Calendar value={toDate(customFrom)} onChange={(e) => setCustomFrom(fromDate(e.value))} dateFormat="dd/mm/yy" showIcon />
          <label>To:</label>
          <Calendar value={toDate(customTo)} onChange={(e) => setCustomTo(fromDate(e.value))} dateFormat="dd/mm/yy" showIcon />
          <Button label="Apply" onClick={() => { setPage(0); fetchData(0); }} />
        </div>
      )}

      <div className="flex gap-2 mb-3">
        <Button label="CSV" icon="pi pi-download" outlined severity="success" onClick={exportCSV} disabled={exporting} />
        <Button label="Excel" icon="pi pi-download" outlined severity="info" onClick={exportExcel} disabled={exporting} />
        <Button label="PDF" icon="pi pi-download" outlined severity="danger" onClick={exportPDF} disabled={exporting} />
      </div>

      <DataTable
        value={data.content || []}
        dataKey="id"
        loading={loading}
        size="small"
        stripedRows
        selectionMode="single"
        selection={selectedEvent}
        onSelectionChange={(e) => setSelectedEvent(e.value)}
        emptyMessage="No activity records found"
        className="sa-table"
      >
        <Column header="Timestamp" body={(i: any) => (
          <div className="flex flex-column">
            <span>{formatDate(i.createdAt)}</span>
            <span className="sa-time">{formatTime(i.createdAt)}</span>
          </div>
        )} />
        <Column header="User" body={(i: any) => i.userName || "-"} />
        <Column header="Action" body={(i: any) => <ActionBadge type={i.actionType} />} />
        <Column header="Module" body={(i: any) => i.module || "-"} />
        <Column header="Title" body={(i: any) => i.title || "-"} />
        <Column header="Status" body={(i: any) => <StatusTag status={i.status} />} />
        <Column header="Details" body={(i: any) => (
          <Button label="View" size="small" text onClick={(e) => { e.stopPropagation(); setSelectedEvent(i); }} />
        )} />
      </DataTable>

      <Paginator
        first={page * size}
        rows={size}
        totalRecords={data.totalElements || 0}
        onPageChange={(e) => setPage(e.page)}
        template="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink CurrentPageReport"
        currentPageReportTemplate="{first}-{last} of {totalRecords}"
      />

      <Sidebar
        visible={!!ev}
        position="right"
        onHide={() => setSelectedEvent(null)}
        style={{ width: "min(560px, 100vw)" }}
        header={<h3 className="m-0"><i className="pi pi-bolt mr-2" />Event Details</h3>}
      >
        {ev && (
          <div className="flex flex-column gap-3">
            <div className="sa-detail-section">
              <h4>Basic Info</h4>
              <Row label="ID">#{ev.id}</Row>
              <Row label="Action Type"><ActionBadge type={ev.actionType} /></Row>
              <Row label="Module">{ev.module || "-"}</Row>
              <Row label="Status"><StatusTag status={ev.status} /></Row>
              <Row label="Title">{ev.title || "-"}</Row>
              <Row label="Description">{ev.description || "-"}</Row>
            </div>
            <div className="sa-detail-section">
              <h4>Entity</h4>
              <Row label="Entity Type">{ev.entityType || "-"}</Row>
              <Row label="Entity ID">{ev.entityId != null ? `#${ev.entityId}` : "-"}</Row>
            </div>
            <div className="sa-detail-section">
              <h4><i className="pi pi-user mr-2" />User</h4>
              <Row label="Name">{ev.userName || "-"}</Row>
              <Row label="Advocate ID">#{ev.advocateId}</Row>
            </div>
            <div className="sa-detail-section">
              <h4><i className="pi pi-server mr-2" />Request</h4>
              <Row label="Method"><code>{ev.requestMethod || "-"}</code></Row>
              <Row label="URI"><code>{ev.requestUri || "-"}</code></Row>
            </div>
            <div className="sa-detail-section">
              <h4><i className="pi pi-desktop mr-2" />Device</h4>
              <Row label={<><i className="pi pi-globe mr-1" />IP Address</>}><code>{ev.ipAddress || "-"}</code></Row>
              <Row label={<><i className="pi pi-desktop mr-1" />Browser</>}>{ev.browser || "-"}</Row>
              <Row label={<><i className="pi pi-mobile mr-1" />OS</>}>{ev.operatingSystem || "-"}</Row>
              <Row label="Device">{ev.device || "-"}</Row>
            </div>
            <div className="sa-detail-section">
              <h4><i className="pi pi-calendar mr-2" />Timestamp</h4>
              <Row label="Date">{formatDate(ev.createdAt)}</Row>
              <Row label="Time">{formatTime(ev.createdAt)}</Row>
              <Row label="Full">{formatDateTime(ev.createdAt)}</Row>
            </div>

            {parsedChanges.length > 0 && (
              <div className="sa-detail-section">
                <h4>What changed</h4>
                {parsedChanges.map((rec: any, i: number) => (
                  <div key={i} className="sa-change-block">
                    <div className="flex align-items-center gap-2 mb-2">
                      <span className={`sa-change-action ${rec.action}`}>{rec.action}</span>
                      <span className="sa-change-target">
                        {(rec.table || "record").replace(/_/g, " ")}
                        {rec.id != null && <> #{rec.id}</>}
                      </span>
                    </div>

                    {rec.action === "updated" && rec.changes && Object.keys(rec.changes).length > 0 && (
                      <table className="sa-change-table">
                        <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
                        <tbody>
                          {Object.entries(rec.changes).map(([field, d]: [string, any]) => (
                            <tr key={field}>
                              <td className="sa-change-field">{field.replace(/_/g, " ")}</td>
                              <td className="sa-change-before">{fmtVal(d.from)}</td>
                              <td className="sa-change-after">{fmtVal(d.to)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* Create/delete carry the whole row; on delete it is the only surviving copy. */}
                    {(rec.action === "created" || rec.action === "deleted") && rec.values && (
                      <table className="sa-change-table">
                        <thead><tr><th>Field</th><th>{rec.action === "deleted" ? "Deleted value" : "Value"}</th></tr></thead>
                        <tbody>
                          {Object.entries(rec.values).map(([field, v]) => (
                            <tr key={field}>
                              <td className="sa-change-field">{field.replace(/_/g, " ")}</td>
                              <td className="sa-change-after">{fmtVal(v)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {rec.note && <p className="sa-change-note">{rec.note}</p>}
                  </div>
                ))}
              </div>
            )}

            {parsedChanges.length === 0 && ev.metadata && (
              <div className="sa-detail-section">
                <h4>Metadata</h4>
                <pre className="sa-metadata">{ev.metadata}</pre>
              </div>
            )}
          </div>
        )}
      </Sidebar>
    </div>
  );
}
