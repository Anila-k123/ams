import { useState, useEffect, useCallback } from "react";
import api from "../api/client";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { PageHead, Chip, StatusChip, Skel, Button, Icon, titleCase, type Tone } from "../ui/kit";
import { SelectField, TextField, Switch } from "../ui/forms";
import { DataTable, type Column } from "../ui/DataTable";
import { Modal } from "../ui/overlays";
import "../ui/pages/research.css";

const PAGE_SIZE = 15;

const CHANNEL_TONE: Record<string, Tone> = { EMAIL: "info", WHATSAPP: "", IN_APP: "tape" };
const CHANNEL_LABEL: Record<string, string> = { EMAIL: "Email", WHATSAPP: "WhatsApp", IN_APP: "In-app" };

const EVENT_LABELS: Record<string, string> = {
  CLIENT_REGISTERED: "Client Registered",
  CASE_CREATED: "Case Created",
  CASE_STATUS_UPDATED: "Case Status Updated",
  CASE_CLOSED: "Case Closed",
  HEARING_SCHEDULED: "Hearing Scheduled",
  HEARING_REMINDER: "Hearing Reminder",
  HEARING_RESCHEDULED: "Hearing Rescheduled",
  INVOICE_GENERATED: "Invoice Generated",
  INVOICE_SUBMITTED: "Invoice To Issue",
  INVOICE_RETURNED: "Invoice Returned",
  PAYMENT_RECEIVED: "Payment Received",
  EXPENSE_UPDATED: "Expense Updated",
  OVERDUE_PAYMENT_REMINDER: "Overdue Payment",
  TASK_DEADLINE_REMINDER: "Task Deadline",
  TASK_ASSIGNED: "Task Assigned",
  TASK_SUBMITTED: "Submitted for Review",
  TASK_APPROVED: "Task Approved",
  TASK_CHANGES_REQUESTED: "Changes Requested",
  DRAFT_REVIEW_REQUESTED: "Draft Review Requested",
  DRAFT_REVIEW_DONE: "Draft Review Done",
  DRAFT_COMMENT: "Draft Comment",
  PASSWORD_RESET: "Password Reset",
};

const CHANNEL_OPTIONS = [
  { value: "EMAIL", label: "Email" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "IN_APP", label: "In-app" },
];
const STATUS_OPTIONS = [
  { value: "SENT", label: "Sent" },
  { value: "FAILED", label: "Failed" },
  { value: "PENDING", label: "Pending" },
];
const EVENT_OPTIONS = Object.entries(EVENT_LABELS).map(([value, label]) => ({ value, label }));

const formatDate = (dt: any) => {
  if (!dt) return "—";
  return new Date(dt).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const channelChip = (c: string) => <Chip tone={CHANNEL_TONE[c] ?? ""}>{CHANNEL_LABEL[c] || titleCase(c)}</Chip>;

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

  const filtered = !!(channel || status || eventType || fromDate || toDate);
  const handleReset = () => {
    setChannel(""); setStatus(""); setEventType(""); setFromDate(""); setToDate(""); setPage(0);
  };

  const columns: Column<any>[] = [
    { key: "event", label: "Event", render: (row) => (
      <>
        <div className="cell-title nowrap">{EVENT_LABELS[row.eventType] || titleCase(row.eventType)}</div>
        {row.caseNumber && <div className="cell-sub mono">{row.caseNumber}</div>}
      </>
    ) },
    { key: "channel", label: "Channel", hideSm: true, render: (row) => channelChip(row.channel) },
    { key: "recipient", label: "Recipient", render: (row) => (
      <>
        <div className="cell-title">{row.recipientName || "—"}</div>
        <div className="cell-sub">{row.recipientEmail || row.recipientPhone || ""}</div>
      </>
    ) },
    { key: "subject", label: "Subject", hideSm: true, render: (row) => <span className="small ellipsis" style={{ display: "block", maxWidth: 260 }}>{row.subject || "—"}</span> },
    { key: "sentAt", label: "Sent", render: (row) => <span className="small nowrap">{formatDate(row.sentAt)}</span> },
    { key: "status", label: "Status", render: (row) => <StatusChip status={row.status} /> },
    { key: "actions", label: <span className="sr-only">Actions</span>, render: (row) => (
      <div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }}>
        <Button variant="ghost" size="sm" onClick={() => setSelected(row)}>View</Button>
        {row.status === "FAILED" && row.channel === "EMAIL" && (
          <Button size="sm" icon="refresh" onClick={() => handleResend(row.id)}>Resend</Button>
        )}
      </div>
    ) },
  ];

  const figure = (label: string, value: any, meta?: string, bad?: boolean) => (
    <div className="figure">
      <div className="lbl">{label}</div>
      <div className="val" style={bad && value ? { color: "var(--bad)" } : undefined}>{value}</div>
      {meta && <div className="meta">{meta}</div>}
    </div>
  );

  return (
    <div>
      <PageHead title="Delivery Log"
        sub="Every email, WhatsApp and in-app message PactPro sent for the practice, and whether it arrived."
        actions={<>
          <Switch checked={!!settings.emailNotificationsEnabled} onChange={() => toggleSetting("emailNotificationsEnabled")} label="Automatic client emails" />
          <Button icon="refresh" loading={triggeringCheck} disabled={triggeringCheck} onClick={handleTriggerCheck}>
            {triggeringCheck ? "Syncing…" : "Sync now"}
          </Button>
        </>} />

      {statsLoading ? (
        <div className="figures" style={{ marginBottom: 20 }}>
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="figure"><Skel h={12} w="60%" /><Skel h={28} w="40%" style={{ marginTop: 8 }} /></div>)}
        </div>
      ) : (
        <div className="figures" style={{ marginBottom: 20 }}>
          {figure("Total sent", stats?.totalSent ?? 0)}
          {figure("Emails today", stats?.emailsSentToday ?? 0, "Since midnight")}
          {figure("WhatsApp today", stats?.whatsappSentToday ?? 0, "Channel unavailable")}
          {figure("Failed today", stats?.failedToday ?? 0, "Since midnight", true)}
          {figure("Failed in total", stats?.totalFailed ?? 0)}
        </div>
      )}

      <div className="rs-filters" role="group" aria-label="Filters">
        <SelectField label="Channel" value={channel} placeholder="All channels" options={CHANNEL_OPTIONS}
          onChange={(e) => { setChannel(e.target.value); setPage(0); }} />
        <SelectField label="Status" value={status} placeholder="All statuses" options={STATUS_OPTIONS}
          onChange={(e) => { setStatus(e.target.value); setPage(0); }} />
        <SelectField label="Event type" value={eventType} placeholder="All events" options={EVENT_OPTIONS}
          onChange={(e) => { setEventType(e.target.value); setPage(0); }} />
        <TextField label="From" type="date" value={fromDate} max={toDate || undefined}
          onChange={(e) => { setFromDate(e.target.value); setPage(0); }} />
        <TextField label="To" type="date" value={toDate} min={fromDate || undefined}
          onChange={(e) => { setToDate(e.target.value); setPage(0); }} />
        {filtered && <Button variant="ghost" icon="x" onClick={handleReset}>Clear filters</Button>}
      </div>

      <DataTable rows={history} columns={columns} rowKey={(r) => r.id} loading={loading} caption="Delivery log"
        onRow={(r) => setSelected(r)}
        page={page} total={totalElements} onPage={setPage} pageSize={PAGE_SIZE}
        empty={filtered
          ? { icon: "filter", title: "No messages match these filters", action: <Button size="sm" onClick={handleReset}>Clear filters</Button> }
          : { icon: "send", title: "No notifications yet", text: "Notifications appear here after client events like case creation, invoices and hearing reminders." }} />

      <Modal open={!!selected} onClose={() => setSelected(null)}
        title={selected ? (selected.subject || EVENT_LABELS[selected.eventType] || titleCase(selected.eventType)) : ""}
        sub={selected ? `${EVENT_LABELS[selected.eventType] || titleCase(selected.eventType)} by ${CHANNEL_LABEL[selected.channel] || selected.channel}, ${formatDate(selected.sentAt)}` : undefined}
        footer={<Button variant="primary" onClick={() => setSelected(null)}>Close</Button>}>
        {selected && (
          <div className="stack">
            <div className="row wrap" style={{ gap: 8 }}>{channelChip(selected.channel)}<StatusChip status={selected.status} /></div>
            <dl className="kv">
              {[
                ["Recipient", selected.recipientName],
                ["Email", selected.recipientEmail],
                ["Phone", selected.recipientPhone],
                ["Case", selected.caseNumber],
                ["Client", selected.clientName],
                ["Subject", selected.subject],
                ["Sent", formatDate(selected.sentAt)],
              ].filter(([, v]) => v).map(([label, value]) => (
                <div key={label} style={{ display: "contents" }}><dt>{label}</dt><dd className={label === "Case" ? "mono" : undefined} style={{ overflowWrap: "anywhere" }}>{value}</dd></div>
              ))}
            </dl>
            {selected.errorMessage && (
              <div className="callout bad"><Icon name="warn" size="sm" /><div>{selected.errorMessage}</div></div>
            )}
            {selected.body && (
              <div className="panel tinted">
                <div className="panel-body rs-msg">
                  {selected.channel === "EMAIL"
                    ? selected.body.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
                    : selected.body}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
