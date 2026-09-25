import { useState, useEffect, useCallback } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Button } from "primereact/button";
import { InputSwitch } from "primereact/inputswitch";
import { Dialog } from "primereact/dialog";
import { Tag } from "primereact/tag";
import { Card } from "primereact/card";
import { Skeleton } from "primereact/skeleton";
import api from "../api/client";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";

const PAGE_SIZE = 15;

const CHANNEL_SEVERITY: Record<string, any> = { EMAIL: "info", WHATSAPP: "success", IN_APP: "warning" };
const STATUS_SEVERITY: Record<string, any> = { SENT: "success", FAILED: "danger", PENDING: "warning" };

const EVENT_LABELS: Record<string, string> = {
  CLIENT_REGISTERED: "Client Registered",
  CASE_CREATED: "Case Created",
  CASE_STATUS_UPDATED: "Case Status Updated",
  CASE_CLOSED: "Case Closed",
  HEARING_SCHEDULED: "Hearing Scheduled",
  HEARING_REMINDER: "Hearing Reminder",
  HEARING_RESCHEDULED: "Hearing Rescheduled",
  INVOICE_GENERATED: "Invoice Generated",
  PAYMENT_RECEIVED: "Payment Received",
  EXPENSE_UPDATED: "Expense Updated",
  OVERDUE_PAYMENT_REMINDER: "Overdue Payment",
  TASK_DEADLINE_REMINDER: "Task Deadline",
  TASK_ASSIGNED: "Task Assigned",
  TASK_SUBMITTED: "Submitted for Review",
  TASK_APPROVED: "Task Approved",
  TASK_CHANGES_REQUESTED: "Changes Requested",
  PASSWORD_RESET: "Password Reset",
};

const CHANNEL_OPTIONS = [
  { value: "", label: "All Channels" },
  { value: "EMAIL", label: "Email" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "IN_APP", label: "In-App" },
];
const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "SENT", label: "Sent" },
  { value: "FAILED", label: "Failed" },
  { value: "PENDING", label: "Pending" },
];
const EVENT_OPTIONS = [{ value: "", label: "All Events" }, ...Object.entries(EVENT_LABELS).map(([value, label]) => ({ value, label }))];

// Calendar gives a Date; the API wants the same YYYY-MM-DD the old <input type="date"> produced.
const toYmd = (d: any) => {
  if (!d) return "";
  const dt = d as Date;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};
const fromYmd = (s: string) => (s ? new Date(`${s}T00:00:00`) : null);

function StatCard({ icon, label, value, color, subtitle }: any) {
  return (
    <Card className="flex-1" style={{ minWidth: 170 }}>
      <div className="flex align-items-center gap-3">
        <i className={`pi ${icon}`} style={{ fontSize: 26, color }} />
        <div>
          <div style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6, fontWeight: 600 }}>{label}</div>
          {subtitle && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
    </Card>
  );
}

const labelStyle: any = { fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 };

export default function NotificationsCenter() {
  const { withLoading } = useLoading() as any;
  const { success, error } = useToast() as any;
  const [stats, setStats] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [totalElements, setTotalElements] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [triggeringCheck, setTriggeringCheck] = useState(false);

  const [settings, setSettings] = useState<any>({ whatsappEnabled: false, emailNotificationsEnabled: false });

  // Filters
  const [page, setPage] = useState(0);
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [eventType, setEventType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [selected, setSelected] = useState<any>(null);

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const res = await api.get(`/api/notifications/history/stats`);
      setStats(res.data);
    } catch (e) {
      console.error("Failed to load stats", e);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await api.get(`/api/advocates/profile`);
      setSettings({
        whatsappEnabled: res.data.whatsappEnabled,
        emailNotificationsEnabled: res.data.emailNotificationsEnabled,
      });
    } catch (e) {
      console.error("Failed to load settings", e);
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) });
      if (channel) params.append("channel", channel);
      if (status) params.append("status", status);
      if (eventType) params.append("eventType", eventType);
      if (fromDate) params.append("from", fromDate + "T00:00:00");
      if (toDate) params.append("to", toDate + "T23:59:59");

      const endpoint = (channel || status || eventType || fromDate || toDate)
        ? `/notifications/history/filter`
        : `/notifications/history`;

      const res = await api.get(`/api${endpoint}?${params}`);
      setHistory(res.data.content || []);
      setTotalElements(res.data.totalElements || 0);
    } catch (e) {
      console.error("Failed to load history", e);
    } finally {
      setLoading(false);
    }
  }, [page, channel, status, eventType, fromDate, toDate]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { fetchHistory(); }, [fetchHistory]);
  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const toggleSetting = async (key: string) => {
    const newSettings = { ...settings, [key]: !settings[key] };
    setSettings(newSettings); // optimistic update
    try {
      await withLoading(api.patch(`/api/advocates/notification-settings`, { [key]: newSettings[key] }), "Updating...");
    } catch (e) {
      console.error("Failed to update settings", e);
      setSettings(settings); // revert on failure
    }
  };

  const handleResend = async (id: any) => {
    try {
      await withLoading(api.post(`/api/whatsapp/resend/${id}`, {}), "Updating...");
      fetchHistory();
      fetchStats();
      success("Message resent successfully!");
    } catch (e: any) {
      error("Failed to resend: " + (e.response?.data?.error || e.message));
    }
  };

  const handleTriggerCheck = async () => {
    setTriggeringCheck(true);
    try {
      await api.post(`/api/notifications/trigger-check`, {});
      setTimeout(() => { fetchStats(); fetchHistory(); }, 1000);
    } catch (e) {
      console.error("Trigger failed", e);
    } finally {
      setTriggeringCheck(false);
    }
  };

  const handleReset = () => {
    setChannel(""); setStatus(""); setEventType(""); setFromDate(""); setToDate(""); setPage(0);
  };

  const formatDate = (dt: any) => {
    if (!dt) return "—";
    return new Date(dt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const channelTag = (c: string) => <Tag value={c} severity={CHANNEL_SEVERITY[c] || "secondary"} />;
  const statusTag = (s: string) => <Tag value={s} severity={STATUS_SEVERITY[s] || "secondary"} />;

  const filterField = (label: string, input: any) => (
    <div className="flex flex-column gap-1">
      <label style={labelStyle}>{label}</label>
      {input}
    </div>
  );

  return (
    <div className="p-4" style={{ color: "var(--text-primary)" }}>
      {/* Header */}
      <div className="flex align-items-center justify-content-between flex-wrap gap-3 mb-4">
        <p className="m-0" style={{ color: "var(--text-muted)", fontSize: 14 }}>
          Monitor email delivery and notification history
        </p>
        <div className="flex align-items-center gap-3">
          <label className="flex align-items-center gap-2 cursor-pointer" style={{ fontSize: 13, fontWeight: 600 }}>
            <InputSwitch checked={!!settings.emailNotificationsEnabled} onChange={() => toggleSetting("emailNotificationsEnabled")} />
            Auto Email Notifications
          </label>
          <Button icon="pi pi-sync" label={triggeringCheck ? "Syncing..." : "Sync Now"} loading={triggeringCheck}
            disabled={triggeringCheck} onClick={handleTriggerCheck} />
        </div>
      </div>

      {/* Stats */}
      {statsLoading ? (
        <div className="flex gap-3 flex-wrap mb-4">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height="96px" className="flex-1" style={{ minWidth: 170 }} />)}</div>
      ) : (
        <div className="flex gap-3 flex-wrap mb-4">
          <StatCard icon="pi-check-circle" label="Total Sent" value={stats?.totalSent ?? 0} color="var(--success)" />
          <StatCard icon="pi-envelope" label="Emails Today" value={stats?.emailsSentToday ?? 0} color="var(--primary)" subtitle="Since midnight" />
          <StatCard icon="pi-whatsapp" label="WhatsApp Today" value={stats?.whatsappSentToday ?? 0} color="var(--success)" subtitle="Since midnight" />
          <StatCard icon="pi-times-circle" label="Failed Total" value={stats?.totalFailed ?? 0} color="var(--danger)" />
          <StatCard icon="pi-exclamation-triangle" label="Failed Today" value={stats?.failedToday ?? 0} color="var(--warning)" subtitle="Since midnight" />
        </div>
      )}

      {/* Filters */}
      <Card className="mb-4">
        <div className="flex flex-wrap gap-3 align-items-end">
          {filterField("Channel", <Dropdown value={channel} options={CHANNEL_OPTIONS} onChange={(e) => { setChannel(e.value); setPage(0); }} style={{ minWidth: 150 }} />)}
          {filterField("Status", <Dropdown value={status} options={STATUS_OPTIONS} onChange={(e) => { setStatus(e.value); setPage(0); }} style={{ minWidth: 150 }} />)}
          {filterField("Event Type", <Dropdown value={eventType} options={EVENT_OPTIONS} onChange={(e) => { setEventType(e.value); setPage(0); }} filter style={{ minWidth: 190 }} />)}
          {filterField("From Date", <Calendar value={fromYmd(fromDate)} onChange={(e) => { setFromDate(toYmd(e.value)); setPage(0); }} dateFormat="dd/mm/yy" showIcon showButtonBar />)}
          {filterField("To Date", <Calendar value={fromYmd(toDate)} onChange={(e) => { setToDate(toYmd(e.value)); setPage(0); }} dateFormat="dd/mm/yy" showIcon showButtonBar />)}
          <Button outlined severity="secondary" icon="pi pi-refresh" label="Reset" onClick={handleReset} />
        </div>
      </Card>

      {/* History */}
      <DataTable
        value={history}
        dataKey="id"
        loading={loading}
        lazy
        paginator
        first={page * PAGE_SIZE}
        rows={PAGE_SIZE}
        totalRecords={totalElements}
        onPage={(e) => setPage(e.page ?? 0)}
        onRowClick={(e) => setSelected(e.data)}
        rowHover
        stripedRows
        className="cursor-pointer"
        header={
          <div className="flex justify-content-between align-items-center">
            <span className="font-bold"><i className="pi pi-list mr-2" />Notification History</span>
            <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
              {history.length} record{history.length !== 1 ? "s" : ""} shown
            </span>
          </div>
        }
        emptyMessage={
          <div className="text-center p-5" style={{ color: "var(--text-muted)" }}>
            <i className="pi pi-inbox" style={{ fontSize: 44 }} />
            <div className="font-semibold mt-2 mb-1" style={{ fontSize: 16 }}>No notifications yet</div>
            <div style={{ fontSize: 13 }}>Notifications will appear here after client events like case creation, invoices, and hearing reminders.</div>
          </div>
        }
      >
        <Column header="Event" body={(row) => (
          <>
            <span className="font-semibold">{EVENT_LABELS[row.eventType] || row.eventType}</span>
            {row.caseNumber && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Case: {row.caseNumber}</div>}
          </>
        )} />
        <Column header="Channel" body={(row) => channelTag(row.channel)} />
        <Column header="Status" body={(row) => statusTag(row.status)} />
        <Column header="Recipient" body={(row) => (
          <>
            <div className="font-semibold">{row.recipientName || "—"}</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{row.recipientEmail || row.recipientPhone || ""}</div>
          </>
        )} />
        <Column header="Subject" body={(row) => (
          <span className="block white-space-nowrap overflow-hidden text-overflow-ellipsis" style={{ maxWidth: 200, fontSize: 12, color: "var(--text-muted)" }}>{row.subject || "—"}</span>
        )} />
        <Column header="Sent At" body={(row) => <span className="white-space-nowrap" style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatDate(row.sentAt)}</span>} />
        <Column body={(row) => (
          <div className="flex gap-2">
            <Button size="small" outlined label="View" onClick={(e) => { e.stopPropagation(); setSelected(row); }} />
            {row.status === "FAILED" && (
              <Button size="small" outlined severity="danger" label="Resend" onClick={(e) => { e.stopPropagation(); handleResend(row.id); }} />
            )}
          </div>
        )} />
      </DataTable>

      {/* Detail dialog */}
      <Dialog
        visible={!!selected}
        onHide={() => setSelected(null)}
        style={{ width: "36rem" }}
        breakpoints={{ "640px": "95vw" }}
        header={selected && (
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{EVENT_LABELS[selected.eventType] || selected.eventType}</div>
            <div className="flex gap-2 mt-2">{channelTag(selected.channel)}{statusTag(selected.status)}</div>
          </div>
        )}
      >
        {selected && (
          <div className="grid" style={{ margin: 0 }}>
            {[
              ["Recipient", selected.recipientName],
              ["Email", selected.recipientEmail],
              ["Phone", selected.recipientPhone],
              ["Case", selected.caseNumber],
              ["Client", selected.clientName],
              ["Subject", selected.subject],
              ["Sent At", formatDate(selected.sentAt)],
              ["Error", selected.errorMessage],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label} className="col-12 flex gap-3 py-1">
                <span style={{ ...labelStyle, fontSize: 12, minWidth: 80 }}>{label}</span>
                <span style={{ fontSize: 13, color: label === "Error" ? "var(--danger)" : "var(--text-primary)" }}>{value}</span>
              </div>
            ))}
            {selected.body && (
              <div className="col-12 mt-2 pt-3" style={{ borderTop: "1px solid var(--border-color)" }}>
                <div style={{ ...labelStyle, fontSize: 12, marginBottom: 8 }}>Message Body</div>
                <div style={{ background: "var(--bg-primary)", borderRadius: 8, padding: 12, fontSize: 12, color: "var(--text-secondary)", maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                  {selected.channel === "EMAIL"
                    ? selected.body.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
                    : selected.body}
                </div>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
