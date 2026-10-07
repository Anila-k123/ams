// Audit Log: every change made in AMS, who made it and from where. Server-paged
// from /api/audit; exports fetch the whole filtered set.
import { useState, useEffect, useCallback, useMemo } from "react";
import api from "../api/client";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { useDownload } from "../hooks/useDownload";
import DownloadLoader from "../components/DownloadLoader";
import { PageHead, Button, Chip, Avatar, PopMenu, type Tone } from "../ui/kit";
import { SearchInput } from "../ui/forms";
import { Drawer } from "../ui/overlays";
import { DataTable, type Column } from "../ui/DataTable";
import "../ui/pages/firm.css";

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
  { value: "INVOICE_SUBMITTED", label: "Invoice To Issue" },
  { value: "INVOICE_RETURNED", label: "Invoice Returned" },
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

// Action words keep their colour family (create/update/delete/export) as a chip tone.
function actionTone(type: any): Tone {
  if (!type) return "";
  if (type.includes("CREATED") || type.includes("SENT") || type.includes("RECEIVED") || type.includes("GENERATED") || type.includes("PAID") || type === "LOGIN") return "ok";
  if (type.includes("UPDATED") || type.includes("CHANGED") || type.includes("RESET") || type.includes("RESCHEDULED")) return "info";
  if (type.includes("DELETED") || type === "FAILED_LOGIN") return "bad";
  if (type.includes("EXPORT") || type.includes("DOWNLOAD")) return "";
  return "warn";
}

// Render one audit value for display. null/"" are meaningful in a diff - a
// field being cleared is a change worth seeing - so they get a visible marker
// rather than rendering as nothing.
function fmtVal(v: any) {
  if (v === null || v === undefined) return <em className="faint">empty</em>;
  if (typeof v === "boolean") return v ? "yes" : "no";
  const s = String(v);
  if (s === "") return <em className="faint">empty</em>;
  if (s === "***") return <em className="faint">hidden</em>;
  return s;
}

function ActionBadge({ type }: { type: any }) {
  return <Chip tone={actionTone(type)}><span className="mono xs">{type || "—"}</span></Chip>;
}

function StatusTag({ status }: { status: any }) {
  const s = (status || "").toUpperCase();
  return <Chip tone={s === "SUCCESS" ? "ok" : s === "FAILED" ? "bad" : ""}>{status ? status.charAt(0) + status.slice(1).toLowerCase() : "—"}</Chip>;
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
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildParams reads only the state listed here
  }, [page, size, search, module, actionType, status, datePreset, customFrom, customTo, withLoading, toast]);

  // A filter or the search changing reloads from page 0; paging loads that
  // page. fetchData itself isn't a dependency: these lists say exactly what
  // should trigger a fetch.
  useEffect(() => {
    fetchData(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trigger on filter / search changes only
  }, [module, actionType, status, datePreset, search, customFrom, customTo]);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- trigger on page changes only
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

  const columns: Column<any>[] = [
    {
      key: "createdAt", label: "Time", render: (i) => (
        <div className="nowrap small">{formatDate(i.createdAt)}<div className="cell-sub">{formatTime(i.createdAt)}</div></div>
      ),
    },
    {
      key: "userName", label: "User", render: (i) => i.userName
        ? <div className="row" style={{ gap: 8 }}><Avatar name={i.userName} size="sm" /><span className="nowrap">{i.userName}</span></div>
        : <span className="faint">Unknown</span>,
    },
    { key: "actionType", label: "Action", render: (i) => <ActionBadge type={i.actionType} /> },
    { key: "module", label: "Module", hideSm: true, render: (i) => i.module || <span className="faint">—</span> },
    { key: "title", label: "Detail", hideSm: true, render: (i) => <span className="small">{i.title || "—"}</span> },
    { key: "status", label: "Status", render: (i) => <StatusTag status={i.status} /> },
  ];

  const sel = (label: string, value: string, set: (v: string) => void, options: { value: string; label: string }[], all: string) => (
    <select className="input fm-sel" aria-label={label} value={value} onChange={(e) => { set(e.target.value); setPage(0); }}>
      <option value="">{all}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  return (
    <div>
      {isDownloading && <DownloadLoader />}
      <PageHead
        title="Audit Log"
        sub="Every change made in AMS, who made it and from where."
        actions={<span className="faint small num">{data.totalElements ?? 0} records</span>}
      />

      <div className="toolbar">
        <form className="row fm-search" role="search" onSubmit={(e) => { e.preventDefault(); handleSearch(); }}>
          <SearchInput value={searchInput} placeholder="Search title or description"
            onChange={(v) => { setSearchInput(v); if (!v && search) setSearch(""); }} />
          <Button type="submit" size="sm">Search</Button>
        </form>
        {sel("Module", module, setModule, MODULES, "All modules")}
        {sel("Action", actionType, setActionType, ACTION_TYPES, "All actions")}
        {sel("Status", status, setStatus, STATUSES, "Any status")}
        <select className="input fm-sel" aria-label="Date range" value={datePreset} onChange={(e) => { setDatePreset(e.target.value); setPage(0); }}>
          {DATE_PRESETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {hasFilters && <Button size="sm" variant="ghost" icon="x" onClick={handleClearFilters}>Clear</Button>}
        <span className="grow" />
        <Button size="sm" icon="download" aria-haspopup="menu" disabled={exporting}
          onClick={(e) => setExportAnchor(exportAnchor ? null : e.currentTarget)}>Export</Button>
      </div>
      {datePreset === "custom" && (
        <div className="toolbar">
          <label className="row small" style={{ gap: 6 }}>From
            <input type="date" className="input fm-sel" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          </label>
          <label className="row small" style={{ gap: 6 }}>To
            <input type="date" className="input fm-sel" value={customTo} min={customFrom || undefined} onChange={(e) => setCustomTo(e.target.value)} />
          </label>
          <Button size="sm" onClick={() => { setPage(0); fetchData(0); }}>Apply</Button>
        </div>
      )}
      {exportAnchor && (
        <PopMenu anchor={exportAnchor} align="right" width={190} onClose={() => setExportAnchor(null)} items={[
          { label: "CSV", icon: "file", onClick: exportCSV },
          { label: "Excel", icon: "file", onClick: exportExcel },
          { label: "PDF", icon: "file", onClick: exportPDF },
        ]} />
      )}

      <DataTable
        rows={data.content || []}
        columns={columns}
        rowKey={(i) => i.id}
        loading={loading}
        onRow={setSelectedEvent}
        pageSize={size}
        page={page}
        total={data.totalElements || 0}
        onPage={setPage}
        caption="Audit log"
        empty={{ icon: "history", title: "No activity records found", text: hasFilters ? "Try clearing the filters." : undefined }}
      />

      <Drawer
        open={!!ev}
        onClose={() => setSelectedEvent(null)}
        wide
        title="Event details"
        sub={ev ? <span className="faint small"><span className="mono">#{ev.id}</span>, {formatDateTime(ev.createdAt)}</span> : null}
        footer={<Button variant="primary" onClick={() => setSelectedEvent(null)}>Done</Button>}
      >
        {ev && (
          <div className="stack" style={{ gap: 22 }}>
            <section>
              <h4 className="fm-h4">Basic info</h4>
              <dl className="kv">
                <dt>Action</dt><dd><ActionBadge type={ev.actionType} /></dd>
                <dt>Module</dt><dd>{ev.module || "—"}</dd>
                <dt>Status</dt><dd><StatusTag status={ev.status} /></dd>
                <dt>Title</dt><dd>{ev.title || "—"}</dd>
                <dt>Description</dt><dd>{ev.description || "—"}</dd>
              </dl>
            </section>
            <section>
              <h4 className="fm-h4">Entity</h4>
              <dl className="kv">
                <dt>Entity type</dt><dd>{ev.entityType || "—"}</dd>
                <dt>Entity ID</dt><dd className="mono">{ev.entityId != null ? `#${ev.entityId}` : "—"}</dd>
              </dl>
            </section>
            <section>
              <h4 className="fm-h4">User</h4>
              <dl className="kv">
                <dt>Name</dt><dd>{ev.userName || "Not signed in"}</dd>
                <dt>Advocate ID</dt><dd className="mono">#{ev.advocateId}</dd>
              </dl>
            </section>
            <section>
              <h4 className="fm-h4">Request</h4>
              <dl className="kv">
                <dt>Method</dt><dd className="mono">{ev.requestMethod || "—"}</dd>
                <dt>URI</dt><dd className="mono" style={{ wordBreak: "break-all" }}>{ev.requestUri || "—"}</dd>
              </dl>
            </section>
            <section>
              <h4 className="fm-h4">Device</h4>
              <dl className="kv">
                <dt>IP address</dt><dd className="mono">{ev.ipAddress || "—"}</dd>
                <dt>Browser</dt><dd>{ev.browser || "—"}</dd>
                <dt>Operating system</dt><dd>{ev.operatingSystem || "—"}</dd>
                <dt>Device</dt><dd>{ev.device || "—"}</dd>
              </dl>
            </section>

            {parsedChanges.length > 0 && (
              <section>
                <h4 className="fm-h4">What changed</h4>
                <div className="stack" style={{ gap: 14 }}>
                  {parsedChanges.map((rec: any, i: number) => (
                    <div key={i} className="stack" style={{ gap: 8 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <Chip tone={rec.action === "created" ? "ok" : rec.action === "deleted" ? "bad" : "info"}>{rec.action}</Chip>
                        <span className="small">
                          {(rec.table || "record").replace(/_/g, " ")}
                          {rec.id != null && <span className="mono"> #{rec.id}</span>}
                        </span>
                      </div>

                      {rec.action === "updated" && rec.changes && Object.keys(rec.changes).length > 0 && (
                        <div className="table-wrap">
                          <table className="t">
                            <thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
                            <tbody>
                              {Object.entries(rec.changes).map(([field, d]: [string, any]) => (
                                <tr key={field}>
                                  <td>{field.replace(/_/g, " ")}</td>
                                  <td className="fm-before">{fmtVal(d.from)}</td>
                                  <td className="fm-after">{fmtVal(d.to)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Create/delete carry the whole row; on delete it is the only surviving copy. */}
                      {(rec.action === "created" || rec.action === "deleted") && rec.values && (
                        <div className="table-wrap">
                          <table className="t">
                            <thead><tr><th scope="col">Field</th><th scope="col">{rec.action === "deleted" ? "Deleted value" : "Value"}</th></tr></thead>
                            <tbody>
                              {Object.entries(rec.values).map(([field, v]) => (
                                <tr key={field}>
                                  <td>{field.replace(/_/g, " ")}</td>
                                  <td>{fmtVal(v)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {rec.note && <p className="faint small">{rec.note}</p>}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {parsedChanges.length === 0 && ev.metadata && (
              <section>
                <h4 className="fm-h4">Metadata</h4>
                <pre className="fm-pre mono">{ev.metadata}</pre>
              </section>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
