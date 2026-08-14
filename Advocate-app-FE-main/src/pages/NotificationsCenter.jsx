import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { SkeletonList } from "../components/Skeleton";
import Pagination from "../components/Pagination";

const API_BASE = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api`;

// ──────────────────────────── Helpers ────────────────────────────
const getToken = () => localStorage.getItem("token");
const authHeaders = () => ({ Authorization: `Bearer ${getToken()}` });

const CHANNEL_COLORS = { EMAIL: "#4f46e5", WHATSAPP: "#22c55e", IN_APP: "#f59e0b" };
const STATUS_COLORS  = { SENT: "#22c55e",  FAILED: "#ef4444",   PENDING: "#f59e0b"  };
const s = (v) => ({ ...(typeof v === 'string' ? {} : {}), ...v });

const EVENT_LABELS = {
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
  PASSWORD_RESET: "Password Reset",
};

function Badge({ label, color }) {
  return (
    <span style={{
      background: color + "22",
      color,
      border: `1px solid ${color}44`,
      borderRadius: 20,
      padding: "2px 10px",
      fontSize: 12,
      fontWeight: 700,
      letterSpacing: 0.5,
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
    }}>
      {label}
    </span>
  );
}

function StatCard({ icon, label, value, color, subtitle }) {
  return (
    <div style={{
      background: "var(--card-bg)",
      border: `1px solid ${color}33`,
      borderRadius: "var(--radius)",
      padding: "24px 28px",
      position: "relative",
      overflow: "hidden",
      flex: "1 1 180px",
      minWidth: 160,
    }}>
      <div style={{
        position: "absolute", top: -16, right: -16, fontSize: 80,
        opacity: 0.06, userSelect: "none", pointerEvents: "none",
      }}>{icon}</div>
      <div style={{ fontSize: 30, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 36, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6, fontWeight: 600 }}>{label}</div>
      {subtitle && <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

// ──────────────────────────── Main Component ────────────────────────────
export default function NotificationsCenter() {
  const { withLoading } = useLoading();
  const { success, error, warning } = useToast();
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [triggeringCheck, setTriggeringCheck] = useState(false);

  // Settings
  const [settings, setSettings] = useState({ whatsappEnabled: false, emailNotificationsEnabled: false });

  // Modals
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualPhone, setManualPhone] = useState("");
  const [manualMessage, setManualMessage] = useState("");
  const [manualSending, setManualSending] = useState(false);

  // Filters
  const [page, setPage] = useState(0);
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");
  const [eventType, setEventType] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Selected record for detail view
  const [selected, setSelected] = useState(null);

  const fetchStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const res = await axios.get(`${API_BASE}/notifications/history/stats`, { headers: authHeaders() });
      setStats(res.data);
    } catch (e) {
      console.error("Failed to load stats", e);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/advocates/profile`, { headers: authHeaders() });
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
      const params = new URLSearchParams({ page, size: 15 });
      if (channel) params.append("channel", channel);
      if (status) params.append("status", status);
      if (eventType) params.append("eventType", eventType);
      if (fromDate) params.append("from", fromDate + "T00:00:00");
      if (toDate) params.append("to", toDate + "T23:59:59");

      const endpoint = (channel || status || eventType || fromDate || toDate)
        ? `/notifications/history/filter`
        : `/notifications/history`;

      const res = await axios.get(`${API_BASE}${endpoint}?${params}`, { headers: authHeaders() });
      setHistory(res.data.content || []);
      setTotalPages(res.data.totalPages || 0);
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

  const toggleSetting = async (key) => {
    const newSettings = { ...settings, [key]: !settings[key] };
    setSettings(newSettings); // optimistic update
    try {
      await withLoading(axios.patch(`${API_BASE}/advocates/notification-settings`,
        { [key]: newSettings[key] },
        { headers: authHeaders() }
      ), "Updating...");
    } catch (e) {
      console.error("Failed to update settings", e);
      setSettings(settings); // revert on failure
    }
  };

  const handleResend = async (id) => {
    try {
      await withLoading(axios.post(`${API_BASE}/whatsapp/resend/${id}`, {}, { headers: authHeaders() }), "Updating...");
      fetchHistory();
      fetchStats();
      success("Message resent successfully!");
    } catch (e) {
      error("Failed to resend: " + (e.response?.data?.error || e.message));
    }
  };

  const handleSendManual = async () => {
    if (!manualPhone || !manualMessage) { warning("Please fill all fields"); return; }
    setManualSending(true);
    try {
      await axios.post(`${API_BASE}/whatsapp/send-manual`, {
        phone: manualPhone,
        message: manualMessage,
        clientName: "Client"
      }, { headers: authHeaders() });
      success("Manual message dispatched!");
      setShowManualModal(false);
      setManualPhone("");
      setManualMessage("");
      fetchHistory();
      fetchStats();
    } catch (e) {
      error("Failed to send message: " + (e.response?.data?.error || e.message));
    } finally {
      setManualSending(false);
    }
  };

  const handleTriggerCheck = async () => {
    setTriggeringCheck(true);
    try {
      await axios.post(`${API_BASE}/notifications/trigger-check`, {}, { headers: authHeaders() });
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

  const formatDate = (dt) => {
    if (!dt) return "—";
    return new Date(dt).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  // ──────── Render ────────
  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--bg-gradient)",
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      color: "var(--text-primary)",
      padding: "32px 24px",
    }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32, flexWrap: "wrap", gap: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, background: "linear-gradient(135deg,#818cf8,#4f46e5)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            📨 Notification Center
          </h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 14 }}>
            Monitor emails, WhatsApp messages and notification history
          </p>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, background: "var(--card-bg)", padding: "8px 16px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-color)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
              <input type="checkbox" checked={settings.whatsappEnabled} onChange={() => toggleSetting('whatsappEnabled')} />
              Auto WhatsApp Notifications
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", fontWeight: 600 }}>
              <input type="checkbox" checked={settings.emailNotificationsEnabled} onChange={() => toggleSetting('emailNotificationsEnabled')} />
              Auto Email Notifications
            </label>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              onClick={() => setShowManualModal(true)}
              style={{
                background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "#fff", border: "none", borderRadius: 10,
                padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: "pointer",
              }}>
              💬 Send Custom Message
            </button>
            <button
              onClick={handleTriggerCheck}
              disabled={triggeringCheck}
              style={{
                background: "linear-gradient(135deg,#4f46e5,#7c3aed)", color: "#fff", border: "none", borderRadius: 10,
                padding: "8px 16px", fontWeight: 700, fontSize: 13, cursor: triggeringCheck ? "not-allowed" : "pointer", opacity: triggeringCheck ? 0.7 : 1,
              }}>
              {triggeringCheck ? "⏳ Syncing..." : "🔄 Sync Now"}
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats Cards ── */}
      {statsLoading ? (
        <div style={{ color: "var(--text-muted)", marginBottom: 32 }}>Loading stats...</div>
      ) : (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 36 }}>
          <StatCard icon="✅" label="Total Sent"        value={stats?.totalSent ?? 0}          color="#22c55e" />
          <StatCard icon="📧" label="Emails Today"      value={stats?.emailsSentToday ?? 0}    color="#4f46e5" subtitle="Since midnight" />
          <StatCard icon="💬" label="WhatsApp Today"    value={stats?.whatsappSentToday ?? 0}  color="#22c55e" subtitle="Since midnight" />
          <StatCard icon="❌" label="Failed Total"      value={stats?.totalFailed ?? 0}        color="#ef4444" />
          <StatCard icon="⚠️" label="Failed Today"      value={stats?.failedToday ?? 0}        color="#f59e0b" subtitle="Since midnight" />
        </div>
      )}

      {/* ── Filters ── */}
      <div style={{
        background: "var(--card-bg)",
        border: "1px solid var(--border-color)",
        borderRadius: 14,
        padding: "20px 24px",
        marginBottom: 24,
        display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Channel</label>
          <select value={channel} onChange={e => { setChannel(e.target.value); setPage(0); }} style={selectStyle}>
            <option value="">All Channels</option>
            <option value="EMAIL">📧 Email</option>
            <option value="WHATSAPP">💬 WhatsApp</option>
            <option value="IN_APP">🔔 In-App</option>
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Status</label>
          <select value={status} onChange={e => { setStatus(e.target.value); setPage(0); }} style={selectStyle}>
            <option value="">All Statuses</option>
            <option value="SENT">✅ Sent</option>
            <option value="FAILED">❌ Failed</option>
            <option value="PENDING">⏳ Pending</option>
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>Event Type</label>
          <select value={eventType} onChange={e => { setEventType(e.target.value); setPage(0); }} style={selectStyle}>
            <option value="">All Events</option>
            {Object.entries(EVENT_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>From Date</label>
          <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(0); }} style={inputStyle} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>To Date</label>
          <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(0); }} style={inputStyle} />
        </div>

        <button onClick={handleReset} style={{
          background: "transparent", border: "1px solid var(--border-color)", color: "var(--text-muted)",
          borderRadius: 8, padding: "8px 16px", cursor: "pointer", fontWeight: 600, fontSize: 13,
          alignSelf: "flex-end",
        }}>
          ↺ Reset
        </button>
      </div>

      {/* ── History Table ── */}
      <div style={{ background: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #2d2d4e", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>
            📋 Notification History
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
            {history.length} record{history.length !== 1 ? "s" : ""} shown
          </span>
        </div>

        {loading ? (
          <div style={{ padding: 24 }}>
            <SkeletonList items={5} />
          </div>
        ) : history.length === 0 ? (
          <div style={{ padding: 64, textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>No notifications yet</div>
            <div style={{ fontSize: 13 }}>Notifications will appear here after client events like case creation, invoices, and hearing reminders.</div>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--card-bg)", borderBottom: "1px solid #2d2d4e" }}>
                  {["Event", "Channel", "Status", "Recipient", "Subject", "Sent At", ""].map(h => (
                    <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((row, i) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row)}
                    style={{
                      borderBottom: "1px solid #1a1a2e",
                      cursor: "pointer",
                      background: i % 2 === 0 ? "transparent" : "#16213e18",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = "#4f46e511"}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "#16213e18"}
                  >
                    <td style={{ padding: "12px 16px", fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{EVENT_LABELS[row.eventType] || row.eventType}</span>
                      {row.caseNumber && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>Case: {row.caseNumber}</div>}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <Badge label={row.channel} color={CHANNEL_COLORS[row.channel] || "var(--text-muted)"} />
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <Badge label={row.status} color={STATUS_COLORS[row.status] || "var(--text-muted)"} />
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 13 }}>
                      <div style={{ fontWeight: 600 }}>{row.recipientName || "—"}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{row.recipientEmail || row.recipientPhone || ""}</div>
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-muted)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {row.subject || "—"}
                    </td>
                    <td style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                      {formatDate(row.sentAt)}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button style={{ background: "#4f46e511", border: "1px solid #4f46e533", color: "#818cf8", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                          onClick={e => { e.stopPropagation(); setSelected(row); }}>
                          View
                        </button>
                        {row.status === "FAILED" && (
                          <button style={{ background: "#ef444411", border: "1px solid #ef444433", color: "#ef4444", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                            onClick={e => { e.stopPropagation(); handleResend(row.id); }}>
                            Resend
                          </button>
                        )}
                      </div>
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
          size={15}
          onPageChange={setPage}
          onSizeChange={() => {}}
        />
      </div>

      {/* ── Detail Modal ── */}
      {selected && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 24,
        }} onClick={() => setSelected(null)}>
          <div style={{
            background: "var(--card-bg)", border: "1px solid #4f46e555", borderRadius: 16, padding: 32,
            maxWidth: 580, width: "100%", maxHeight: "80vh", overflowY: "auto",
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>
                  {EVENT_LABELS[selected.eventType] || selected.eventType}
                </h2>
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <Badge label={selected.channel} color={CHANNEL_COLORS[selected.channel] || "var(--text-muted)"} />
                  <Badge label={selected.status} color={STATUS_COLORS[selected.status] || "var(--text-muted)"} />
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {[
                ["Recipient", selected.recipientName],
                ["Email", selected.recipientEmail],
                ["Phone", selected.recipientPhone],
                ["Case", selected.caseNumber],
                ["Client", selected.clientName],
                ["Subject", selected.subject],
                ["Sent At", formatDate(selected.sentAt)],
                ["Error", selected.errorMessage],
              ].filter(([,v]) => v).map(([label, value]) => (
                <div key={label} style={{ display: "flex", gap: 12 }}>
                  <span style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 700, minWidth: 80, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
                  <span style={{ fontSize: 13, color: label === "Error" ? "var(--danger)" : "var(--text-primary)" }}>{value}</span>
                </div>
              ))}
              {selected.body && (
                <div style={{ marginTop: 12, borderTop: "1px solid #2d2d4e", paddingTop: 12 }}>
                  <div style={{ color: "var(--text-muted)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Message Body</div>
                  <div style={{ background: "var(--card-bg)", borderRadius: 8, padding: 12, fontSize: 12, color: "var(--text-muted)", maxHeight: 200, overflowY: "auto", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                    {selected.channel === "EMAIL"
                      ? selected.body.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
                      : selected.body}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Manual Message Modal ── */}
      {showManualModal && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 24,
        }} onClick={() => setShowManualModal(false)}>
          <div style={{
            background: "var(--card-bg)", border: "1px solid #22c55e55", borderRadius: 16, padding: 32,
            maxWidth: 480, width: "100%",
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#22c55e" }}>💬 Send Custom WhatsApp</h2>
              <button onClick={() => setShowManualModal(false)} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", fontWeight: 700, marginBottom: 6 }}>Phone Number (with Country Code)</label>
                <input type="text" placeholder="+919876543210" style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} 
                  value={manualPhone} onChange={e => setManualPhone(e.target.value)} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", fontWeight: 700, marginBottom: 6 }}>Message</label>
                <textarea rows="4" placeholder="Type your message here..." style={{ ...inputStyle, width: "100%", boxSizing: "border-box", resize: "vertical" }}
                  value={manualMessage} onChange={e => setManualMessage(e.target.value)} />
              </div>
              
              <button 
                onClick={handleSendManual} 
                disabled={manualSending}
                style={{
                  background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "#fff", border: "none", borderRadius: 8,
                  padding: "12px", fontWeight: 700, fontSize: 14, cursor: manualSending ? "not-allowed" : "pointer", opacity: manualSending ? 0.7 : 1,
                  marginTop: 8
                }}>
                {manualSending ? "Sending..." : "Send Message"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared styles ──
const selectStyle = {
  background: "var(--card-bg)", border: "1px solid var(--border-color)", color: "var(--text-primary)",
  borderRadius: 8, padding: "8px 12px", fontSize: 13, minWidth: 140, cursor: "pointer",
};
const inputStyle = {
  background: "var(--card-bg)", border: "1px solid var(--border-color)", color: "var(--text-primary)",
  borderRadius: 8, padding: "8px 12px", fontSize: 13,
};
const paginationBtnStyle = {
  background: "var(--card-bg)", border: "1px solid var(--border-color)", color: "var(--text-muted)",
  borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600,
};
