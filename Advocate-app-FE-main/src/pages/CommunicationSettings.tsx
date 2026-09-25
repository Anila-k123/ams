import { useEffect, useState } from "react";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { InputTextarea } from "primereact/inputtextarea";
import { InputSwitch } from "primereact/inputswitch";
import { Password } from "primereact/password";
import { Button } from "primereact/button";
import { Message } from "primereact/message";
import { Card } from "primereact/card";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../contexts/LoadingContext";
import "../assets/styles/Communication.css";

const API = `/api/communication`;

export default function CommunicationSettings() {
  const { withLoading } = useLoading() as any;
  const { token } = useAuth();
  const [settings, setSettings] = useState<any>({
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
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<any>(null);
  const [testEmail, setTestEmail] = useState({ recipient: "", subject: "Test Email", message: "This is a test email from AMS." });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

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
  }, [token]);

  const handleChange = (field: string, value: any) => setSettings((prev: any) => ({ ...prev, [field]: value }));

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await withLoading(api.put(`${API}/settings`, settings), "Saving Settings...");
      setMessage({ type: "success", text: "Settings saved successfully" });
    } catch {
      setMessage({ type: "error", text: "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
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

  const text = (field: string, label: string, placeholder: string, disabled: boolean, type = "text") => (
    <div className="col-12 md:col-6 flex flex-column gap-1">
      <label className="comm-label">{label}</label>
      {type === "password" ? (
        <Password value={settings[field]} onChange={(e) => handleChange(field, e.target.value)} placeholder={placeholder}
          disabled={disabled} feedback={false} toggleMask className="w-full" inputClassName="w-full" />
      ) : (
        <InputText type={type} value={settings[field]} onChange={(e) => handleChange(field, e.target.value)}
          placeholder={placeholder} disabled={disabled} />
      )}
    </div>
  );

  const saveBtn = (
    <Button icon="pi pi-save" label={saving ? "Saving..." : "Save Settings"} onClick={handleSave} disabled={saving} className="mb-3" />
  );

  return (
    <div className="comm-page">
      {message && (
        <div className="flex align-items-center gap-2 mb-3">
          <Message className="flex-1 justify-content-start" severity={message.type === "success" ? "success" : "error"} text={message.text} />
          <Button icon="pi pi-times" text rounded severity="secondary" aria-label="Dismiss" onClick={() => setMessage(null)} />
        </div>
      )}

      <Card className="mb-3" title={<span className="flex align-items-center gap-2"><i className="pi pi-envelope" /> Email Configuration</span>}>
        <div className="grid">
          <div className="col-12 flex align-items-center gap-2">
            <InputSwitch inputId="emailEnabled" checked={settings.emailEnabled} onChange={(e) => handleChange("emailEnabled", !!e.value)} />
            <label htmlFor="emailEnabled" className="comm-label">Enable Email</label>
          </div>
          {text("smtpHost", "SMTP Host", "smtp.gmail.com", !settings.emailEnabled)}
          <div className="col-12 md:col-6 flex flex-column gap-1">
            <label className="comm-label">SMTP Port</label>
            <InputNumber value={settings.smtpPort} useGrouping={false} placeholder="587" disabled={!settings.emailEnabled}
              onChange={(e) => handleChange("smtpPort", e.value || 587)} />
          </div>
          {text("senderEmail", "Sender Email", "you@example.com", !settings.emailEnabled, "email")}
          {text("senderName", "Sender Name", "Your Name", !settings.emailEnabled)}
          {text("encryptedPassword", "SMTP Password", "App password", !settings.emailEnabled, "password")}
        </div>
      </Card>

      {saveBtn}

      <Card className="mb-3" title={<span className="flex align-items-center gap-2"><i className="pi pi-send" /> Test Email</span>}
        subTitle="Send a test email to verify your SMTP configuration.">
        <div className="grid">
          <div className="col-12 md:col-6 flex flex-column gap-1">
            <label className="comm-label">Recipient Email</label>
            <InputText type="email" value={testEmail.recipient} placeholder="recipient@example.com"
              onChange={(e) => setTestEmail({ ...testEmail, recipient: e.target.value })} />
          </div>
          <div className="col-12 md:col-6 flex flex-column gap-1">
            <label className="comm-label">Subject</label>
            <InputText value={testEmail.subject} onChange={(e) => setTestEmail({ ...testEmail, subject: e.target.value })} />
          </div>
          <div className="col-12 flex flex-column gap-1">
            <label className="comm-label">Message</label>
            <InputTextarea rows={3} value={testEmail.message} onChange={(e) => setTestEmail({ ...testEmail, message: e.target.value })} />
          </div>
        </div>

        <Button severity="success" icon="pi pi-send" loading={testing} label={testing ? "Sending..." : "Send Test Email"}
          onClick={handleTestEmail} disabled={testing} />

        {testResult && (
          <div className={`comm-test-result mt-3 ${testResult.success ? "success" : "error"}`}>
            <i className={`pi ${testResult.success ? "pi-check-circle" : "pi-times-circle"}`} />
            <div>
              <strong>{testResult.success ? "Email sent successfully" : "Email failed"}</strong>
              {testResult.providerResponse && <p>{testResult.providerResponse}</p>}
              {testResult.errorMessage && <p>{testResult.errorMessage}</p>}
            </div>
          </div>
        )}
      </Card>

      <Card className="mb-3" title={<span className="flex align-items-center gap-2"><i className="pi pi-whatsapp" /> WhatsApp Configuration</span>}>
        <div className="grid">
          <div className="col-12 flex align-items-center gap-2">
            <InputSwitch inputId="waEnabled" checked={settings.whatsappEnabled} onChange={(e) => handleChange("whatsappEnabled", !!e.value)} />
            <label htmlFor="waEnabled" className="comm-label">Enable WhatsApp</label>
          </div>
          {text("whatsappPhoneNumberId", "Phone Number ID", "123456789012345", !settings.whatsappEnabled)}
          {text("whatsappBusinessAccountId", "Business Account ID", "123456789012345", !settings.whatsappEnabled)}
          {text("whatsappAccessToken", "WhatsApp Access Token", "EAAx...", !settings.whatsappEnabled, "password")}
        </div>
      </Card>

      {saveBtn}
    </div>
  );
}
