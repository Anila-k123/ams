import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { PageHead, Chip, Icon, Button, type Tone } from "../ui/kit";
import { TextField, TextArea, Switch, Field } from "../ui/forms";
import { Modal } from "../ui/overlays";
import "../ui/pages/research.css";

const API = `/api/communication`;

const EMPTY = {
  emailEnabled: false,
  whatsappEnabled: false,
  smtpHost: "",
  smtpPort: 587,
  senderEmail: "",
  senderName: "",
  encryptedPassword: "",
  whatsappPhoneNumberId: "",
  whatsappBusinessAccountId: "",
  whatsappAccessToken: "",
};

export default function CommunicationSettings() {
  const { withLoading } = useLoading() as any;
  const { success, error: toastError } = useToast() as any;
  const { token } = useAuth();
  const [settings, setSettings] = useState<any>(EMPTY);
  const [draft, setDraft] = useState<any>(EMPTY);
  const [editOpen, setEditOpen] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [testEmail, setTestEmail] = useState({ recipient: "", subject: "Test Email", message: "This is a test email from PactPro." });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  // "Automatic client emails" lives on the advocate profile, not the SMTP settings.
  const [autoEmail, setAutoEmail] = useState<boolean | null>(null);

  useEffect(() => {
    if (!token) return;
    api
      .get(`${API}/settings`)
      .then((res) => {
        const s = res.data;
        setSettings({
          emailEnabled: s.emailEnabled || false,
          whatsappEnabled: s.whatsappEnabled || false,
          smtpHost: s.smtpHost || "",
          smtpPort: s.smtpPort || 587,
          senderEmail: s.senderEmail || "",
          senderName: s.senderName || "",
          encryptedPassword: s.encryptedPassword || "",
          whatsappPhoneNumberId: s.whatsappPhoneNumberId || "",
          whatsappBusinessAccountId: s.whatsappBusinessAccountId || "",
          whatsappAccessToken: s.whatsappAccessToken || "",
        });
        if (s.senderEmail) setTestEmail((prev) => ({ ...prev, recipient: s.senderEmail }));
      })
      .catch(() => {});
    api.get(`/api/advocates/profile`)
      .then((res) => setAutoEmail(!!res.data.emailNotificationsEnabled))
      .catch(() => {});
  }, [token]);

  const set = (field: string, value: any) => setDraft((prev: any) => ({ ...prev, [field]: value }));

  const openEdit = () => { setDraft(settings); setSaveError(""); setShowPw(false); setEditOpen(true); };

  const handleSave = async () => {
    const port = Number(draft.smtpPort);
    if (draft.emailEnabled && !(port > 0 && port < 65536)) { setSaveError("Enter a port between 1 and 65535, usually 587 or 465."); return; }
    setSaving(true);
    setSaveError("");
    try {
      await withLoading(api.put(`${API}/settings`, { ...draft, smtpPort: port || 587 }), "Saving Settings...");
      setSettings({ ...draft, smtpPort: port || 587 });
      setEditOpen(false);
      success("Email settings saved. Send a test to check them.");
    } catch {
      setSaveError("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const toggleAuto = async () => {
    const next = !autoEmail;
    setAutoEmail(next); // optimistic
    try {
      await withLoading(api.patch(`/api/advocates/notification-settings`, { emailNotificationsEnabled: next }), "Updating...");
      success(next ? "Automatic client emails are on." : "Automatic client emails are off. Hearing reminders will not be emailed.");
    } catch {
      setAutoEmail(!next);
      toastError("Couldn't change automatic client emails.");
    }
  };

  const handleTestEmail = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!testEmail.recipient) {
      setTestResult({ success: false, errorMessage: "Recipient email is required" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post(`${API}/test`, {
        recipientEmail: testEmail.recipient,
        subject: testEmail.subject,
        message: testEmail.message,
        channel: "EMAIL",
        type: "CUSTOM",
      });
      setTestResult(res.data);
    } catch {
      setTestResult({ success: false, errorMessage: "Failed to send test email" });
    } finally {
      setTesting(false);
    }
  };

  const emailChip: { tone: Tone; label: string } = !settings.emailEnabled
    ? { tone: "", label: "Off" }
    : !settings.smtpHost || !settings.senderEmail ? { tone: "warn", label: "Not configured" } : { tone: "ok", label: "On" };

  return (
    <div>
      <PageHead title="Communication Channels" sub="How PactPro sends reminders, updates and documents to your team and clients."
        actions={<Link className="btn" to="/dashboard/notifications"><Icon name="list" size="sm" />Delivery log</Link>} />

      <div className="cols g-2" style={{ alignItems: "start" }}>
        <section className="panel">
          <div className="panel-head"><div className="row"><Icon name="mail" /><h3>Email</h3></div><Chip tone={emailChip.tone}>{emailChip.label}</Chip></div>
          <div className="panel-body">
            <dl className="kv">
              <dt>SMTP host</dt><dd className="mono">{settings.smtpHost || "—"}</dd>
              <dt>Port</dt><dd className="mono">{settings.smtpPort || "—"}</dd>
              <dt>Sender email</dt><dd style={{ overflowWrap: "anywhere" }}>{settings.senderEmail || "—"}</dd>
              <dt>Sender name</dt><dd>{settings.senderName || "—"}</dd>
              <dt>Password</dt><dd className="mono">{settings.encryptedPassword ? "••••••••••••" : "Not set"}</dd>
            </dl>
            <div className="row wrap between" style={{ marginTop: 16 }}>
              <Button size="sm" icon="edit" onClick={openEdit}>Edit settings</Button>
              {autoEmail !== null && <Switch checked={autoEmail} onChange={toggleAuto} label="Automatic client emails" />}
            </div>

            <form className="stack" noValidate onSubmit={handleTestEmail}
              style={{ borderTop: "1px solid var(--line)", marginTop: 18, paddingTop: 16 }}>
              <h4>Send a test email</h4>
              <div className="form-grid">
                <TextField label="Send test to" type="email" value={testEmail.recipient} placeholder="recipient@example.com"
                  onChange={(e) => setTestEmail({ ...testEmail, recipient: e.target.value })} />
                <TextField label="Subject" value={testEmail.subject} onChange={(e) => setTestEmail({ ...testEmail, subject: e.target.value })} />
                <TextArea full label="Message" rows={3} value={testEmail.message} onChange={(e) => setTestEmail({ ...testEmail, message: e.target.value })} />
              </div>
              <div><Button type="submit" icon="send" loading={testing} disabled={testing}>{testing ? "Sending…" : "Send test"}</Button></div>
              <div aria-live="polite">
                {testResult && (
                  <div className={`callout ${testResult.success ? "ok" : "bad"}`}>
                    <Icon name={testResult.success ? "ok" : "warn"} size="sm" />
                    <div>
                      <b>{testResult.success ? `Test email sent to ${testEmail.recipient}.` : "The test email failed."}</b>
                      {testResult.providerResponse && <div className="small">{testResult.providerResponse}</div>}
                      {testResult.errorMessage && <div className="small">{testResult.errorMessage}</div>}
                    </div>
                  </div>
                )}
              </div>
            </form>
          </div>
        </section>

        <div className="stack" style={{ gap: 16 }}>
          <section className="panel rs-disabled">
            <div className="panel-head"><div className="row"><Icon name="chat" /><h3>WhatsApp</h3></div><Chip>Not available</Chip></div>
            <div className="panel-body stack">
              {/* WhatsApp is not wired to Meta in this product; the fields are shown read-only. */}
              <p className="small muted">WhatsApp needs a verified WhatsApp Business account linked through Meta, which this edition of PactPro doesn't include. Reminders go by email and in-app only.</p>
              <div className="form-grid">
                <TextField label="Phone number ID" value={settings.whatsappPhoneNumberId} placeholder="From Meta Business" disabled readOnly />
                <TextField label="Business account ID" value={settings.whatsappBusinessAccountId} placeholder="From Meta Business" disabled readOnly />
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><div className="row"><Icon name="bell" /><h3>In-app</h3></div><Chip tone="ok">Always on</Chip></div>
            <div className="panel-body"><p className="small muted">Everyone sees alerts in the bell menu while signed in. This channel can't be turned off.</p></div>
          </section>
        </div>
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Email settings" sub="Use an app password if your provider requires one."
        footer={<>
          <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={saving} onClick={handleSave}>{saving ? "Saving…" : "Save settings"}</Button>
        </>}>
        <div className="stack">
          <Switch checked={!!draft.emailEnabled} onChange={(e) => set("emailEnabled", e.target.checked)} label="Send email from PactPro" />
          <div className="form-grid">
            <TextField label="SMTP host" value={draft.smtpHost} placeholder="smtp.gmail.com" disabled={!draft.emailEnabled}
              onChange={(e) => set("smtpHost", e.target.value)} />
            <TextField label="Port" type="number" inputMode="numeric" value={draft.smtpPort} placeholder="587" disabled={!draft.emailEnabled}
              onChange={(e) => set("smtpPort", e.target.value)} />
            <TextField label="Sender email" type="email" value={draft.senderEmail} placeholder="you@example.com" disabled={!draft.emailEnabled}
              onChange={(e) => set("senderEmail", e.target.value)} />
            <TextField label="Sender name" value={draft.senderName} placeholder="Your name" disabled={!draft.emailEnabled}
              onChange={(e) => set("senderName", e.target.value)} />
            <Field label="Password" full hint="Your mail provider's password or app password.">
              {(id, d) => (
                <div className="row" style={{ gap: 8 }}>
                  <input id={id} aria-describedby={d} className="input grow" type={showPw ? "text" : "password"} autoComplete="new-password"
                    value={draft.encryptedPassword} placeholder="App password" disabled={!draft.emailEnabled}
                    onChange={(e) => set("encryptedPassword", e.target.value)} />
                  <Button variant="ghost" iconOnly icon="eye" aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={showPw}
                    disabled={!draft.emailEnabled} onClick={() => setShowPw((v) => !v)} />
                </div>
              )}
            </Field>
          </div>
          {saveError && <div className="callout bad" role="alert"><Icon name="warn" size="sm" /><div>{saveError}</div></div>}
        </div>
      </Modal>
    </div>
  );
}
