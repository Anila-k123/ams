import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Skeleton } from "primereact/skeleton";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import "../assets/styles/Communication.css";

export default function CommunicationDashboard() {
  const navigate = useNavigate();
  const { token } = useAuth();
  const [settings, setSettings] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [statsError, setStatsError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    Promise.all([api.get(`/api/communication/settings`), api.get(`/api/communication/statistics`)])
      .then(([sRes, statsRes]) => {
        setSettings(sRes.data);
        setStats(statsRes.data);
        setStatsError(false);
      })
      .catch(() => setStatsError(true))
      .finally(() => setLoading(false));
  }, [token]);

  const val = (v: any) => (statsError ? "--" : v ?? "--");

  // Three states, not two. "Enabled but not configured" and "configured but
  // every attempt today failed" are both real.
  const emailState = (() => {
    if (!settings?.emailEnabled) {
      return { tone: "disabled", label: "Off", detail: "Email notifications are switched off" };
    }
    if (!stats?.emailConfigured) {
      return {
        tone: "disabled",
        label: "Not configured",
        detail: settings?.smtpHost ? "No sender address set" : "No SMTP server set - nothing can be sent",
      };
    }
    if (stats?.recentEmailFailures > 0) {
      return {
        tone: "failing",
        label: "Failing",
        detail: `${stats.recentEmailFailures} attempt(s) failed today - check the password`,
      };
    }
    return { tone: "connected", label: "Working", detail: settings?.senderEmail || "Configured" };
  })();

  if (loading)
    return (
      <div className="comm-page">
        <div className="comm-stat-cards">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} height="76px" />)}
        </div>
      </div>
    );

  const statCard = (icon: string, tone: string, label: string, value: any) => (
    <div className="comm-stat-card">
      <div className={`comm-stat-icon ${tone}`}><i className={`pi ${icon}`} /></div>
      <div className="flex flex-column">
        <span className="comm-stat-label">{label}</span>
        <span className="comm-stat-value">{value}</span>
      </div>
    </div>
  );

  return (
    <div className="comm-page">
      <div className="comm-stat-cards">
        {statCard("pi-send", "sent", "Total Sent", val(stats?.totalSent))}
        {statCard("pi-envelope", "email", "Emails Attempted Today", val(stats?.emailsToday))}
        {statCard("pi-whatsapp", "whatsapp", "WhatsApp Today", val(stats?.whatsappToday))}
        {statCard("pi-times-circle", "failed", "Failed Total", val(stats?.failedTotal))}
        {statCard("pi-exclamation-circle", "failed", "Failed Today", val(stats?.failedToday))}
      </div>

      <div className="comm-cards">
        <div className="comm-card" onClick={() => navigate("/dashboard/communication/settings")}>
          <div className="comm-card-icon email"><i className="pi pi-envelope" /></div>
          <div className="flex flex-column gap-1">
            <span className="comm-card-label">Email</span>
            <span className={`comm-card-value ${emailState.tone}`}>{emailState.label}</span>
            <span className="comm-card-sub">{emailState.detail}</span>
          </div>
        </div>

        <div className="comm-card" onClick={() => navigate("/dashboard/communication/settings")}>
          <div className="comm-card-icon whatsapp"><i className="pi pi-whatsapp" /></div>
          <div className="flex flex-column gap-1">
            <span className="comm-card-label">WhatsApp</span>
            {/* WhatsApp delivery is not wired to Meta credentials yet. */}
            <span className="comm-card-value disabled">Not available</span>
            <span className="comm-card-sub">Business API not connected yet</span>
          </div>
        </div>

        <div className="comm-card" onClick={() => navigate("/dashboard/communication/history")}>
          <div className="comm-card-icon history"><i className="pi pi-clock" /></div>
          <div className="flex flex-column gap-1">
            <span className="comm-card-label">History</span>
            <span className="comm-card-value">{val(stats?.totalSent + stats?.failedTotal)} entries</span>
            <span className="comm-card-sub flex align-items-center gap-1">
              <i className="pi pi-check-circle" style={{ color: "var(--success)" }} /> {val(stats?.sentToday ?? stats?.totalSent)} sent
              <i className="pi pi-times-circle ml-2" style={{ color: "var(--danger)" }} /> {val(stats?.failedTotal)} failed
            </span>
          </div>
        </div>
      </div>

      <h3>Quick Actions</h3>
      <div className="flex gap-2 flex-wrap">
        <Button outlined icon="pi pi-cog" label="Configure Settings" onClick={() => navigate("/dashboard/communication/settings")} />
        <Button outlined icon="pi pi-chart-line" label="View History" onClick={() => navigate("/dashboard/communication/history")} />
      </div>
    </div>
  );
}
