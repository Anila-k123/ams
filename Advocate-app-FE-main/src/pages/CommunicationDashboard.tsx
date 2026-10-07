import { useEffect, useState } from "react";
import { usePermission } from "../contexts/PermissionContext";
import { useNavigate, Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { PageHead, Chip, Icon, Skel, Button, type Tone } from "../ui/kit";
import "../ui/pages/research.css";

export default function CommunicationDashboard() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission() as any;
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
  const canEdit = hasPermission("SETTINGS_EDIT");

  // Three states, not two. "Enabled but not configured" and "configured but
  // every attempt today failed" are both real.
  const emailState: { tone: Tone; label: string; detail: string } = (() => {
    if (!settings?.emailEnabled) {
      return { tone: "", label: "Off", detail: "Email notifications are switched off." };
    }
    if (!stats?.emailConfigured) {
      return {
        tone: "warn",
        label: "Not configured",
        detail: settings?.smtpHost ? "No sender address set." : "No SMTP server set, so nothing can be sent.",
      };
    }
    if (stats?.recentEmailFailures > 0) {
      return {
        tone: "bad",
        label: "Failing",
        detail: `${stats.recentEmailFailures} attempt(s) failed today. Check the password.`,
      };
    }
    return { tone: "ok", label: "Working", detail: `Sending as ${settings?.senderEmail || "the configured sender"}.` };
  })();

  return (
    <div>
      <PageHead title="Client Messages"
        sub="Reminders, updates and documents PactPro sends to your clients, and how each channel is doing."
        actions={<>
          <Link className="btn" to="/dashboard/communication/history"><Icon name="history" size="sm" />Message history</Link>
          {canEdit && <Link className="btn primary" to="/dashboard/communication/settings"><Icon name="cog" size="sm" />Channel settings</Link>}
        </>} />

      {loading ? (
        <div className="figures" style={{ marginBottom: 20 }}>
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="figure"><Skel h={12} w="60%" /><Skel h={28} w="40%" style={{ marginTop: 8 }} /></div>)}
        </div>
      ) : (
        <div className="figures" style={{ marginBottom: 20 }}>
          <div className="figure"><div className="lbl">Total sent</div><div className="val">{val(stats?.totalSent)}</div></div>
          <div className="figure"><div className="lbl">Emails today</div><div className="val">{val(stats?.emailsToday)}</div><div className="meta">Attempted since midnight</div></div>
          <div className="figure"><div className="lbl">WhatsApp today</div><div className="val">{val(stats?.whatsappToday)}</div><div className="meta">Channel unavailable</div></div>
          <div className="figure"><div className="lbl">Failed today</div><div className="val" style={stats?.failedToday ? { color: "var(--bad)" } : undefined}>{val(stats?.failedToday)}</div></div>
          <div className="figure"><div className="lbl">Failed in total</div><div className="val">{val(stats?.failedTotal)}</div></div>
        </div>
      )}

      {statsError && (
        <div className="callout warn" style={{ marginBottom: 20 }}><Icon name="warn" size="sm" /><div>Couldn't load message statistics. The figures above may be out of date.</div></div>
      )}

      <div className="cols g-3" style={{ alignItems: "start" }}>
        <section className="panel">
          <div className="panel-head"><div className="row"><Icon name="mail" /><h3>Email</h3></div>{!loading && <Chip tone={emailState.tone}>{emailState.label}</Chip>}</div>
          <div className="panel-body stack">
            {loading ? <Skel h={14} /> : <p className="small muted">{emailState.detail}</p>}
            {canEdit && <div><Button size="sm" icon="cog" onClick={() => navigate("/dashboard/communication/settings")}>Email settings</Button></div>}
          </div>
        </section>

        <section className="panel rs-disabled">
          <div className="panel-head"><div className="row"><Icon name="chat" /><h3>WhatsApp</h3></div><Chip>Not available</Chip></div>
          <div className="panel-body">
            {/* WhatsApp delivery is not wired to Meta credentials in this product. */}
            <p className="small muted">WhatsApp Business isn't connected for this practice. Reminders go by email and in-app only.</p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><div className="row"><Icon name="history" /><h3>History</h3></div>
            <span className="faint small">{statsError ? "--" : (stats?.totalSent ?? 0) + (stats?.failedTotal ?? 0)} entries</span></div>
          <div className="panel-body stack">
            <div className="row wrap small" style={{ gap: 12 }}>
              <span className="row" style={{ gap: 6 }}><Chip tone="ok">Sent</Chip>{val(stats?.sentToday ?? stats?.totalSent)}</span>
              <span className="row" style={{ gap: 6 }}><Chip tone="bad">Failed</Chip>{val(stats?.failedTotal)}</span>
            </div>
            <div><Button size="sm" icon="history" onClick={() => navigate("/dashboard/communication/history")}>View history</Button></div>
          </div>
        </section>
      </div>
    </div>
  );
}
