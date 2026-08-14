import React, { useEffect, useState } from "react";
import axios from "axios";
import { useLoading } from "../contexts/LoadingContext";
import { FiSave, FiMail, FiMessageSquare, FiCheckCircle, FiXCircle, FiSend, FiLoader } from "react-icons/fi";
import "../assets/styles/Communication.css";

const API = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api/communication`;

export default function CommunicationSettings() {
  const { withLoading } = useLoading();
  const token = localStorage.getItem("token");
  const [settings, setSettings] = useState({
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
  const [message, setMessage] = useState(null);
  const [testEmail, setTestEmail] = useState({ recipient: "", subject: "Test Email", message: "This is a test email from AdvocateApp." });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    if (!token) return;
    axios
      .get(`${API}/settings`, { headers: { Authorization: `Bearer ${token}` } })
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
        if (s.senderEmail) {
          setTestEmail((prev) => ({ ...prev, recipient: s.senderEmail }));
        }
      })
      .catch(() => {});
  }, [token]);

  const handleChange = (field, value) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await withLoading(axios.put(`${API}/settings`, settings, {
        headers: { Authorization: `Bearer ${token}` },
      }), "Saving Settings...");
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
      const res = await axios.post(
        `${API}/test`,
        {
          recipientEmail: testEmail.recipient,
          subject: testEmail.subject,
          message: testEmail.message,
          channel: "EMAIL",
          type: "CUSTOM",
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setTestResult(res.data);
    } catch {
      setTestResult({ success: false, errorMessage: "Failed to send test email" });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="comm-page">
      <h2>Communication Settings</h2>

      {message && (
        <div className={`comm-status ${message.type}`}>
          {message.type === "success" ? <FiCheckCircle /> : <FiXCircle />}
          <span>{message.text}</span>
          <button className="comm-close-msg" onClick={() => setMessage(null)}>x</button>
        </div>
      )}

      <div className="comm-section">
        <h3><FiMail /> Email Configuration</h3>
        <div className="comm-form-grid">
          <label className="comm-toggle">
            <input
              type="checkbox"
              checked={settings.emailEnabled}
              onChange={(e) => handleChange("emailEnabled", e.target.checked)}
            />
            <span className="comm-toggle-label">Enable Email</span>
          </label>

          <div className="comm-field">
            <label>SMTP Host</label>
            <input
              type="text"
              value={settings.smtpHost}
              onChange={(e) => handleChange("smtpHost", e.target.value)}
              placeholder="smtp.gmail.com"
              disabled={!settings.emailEnabled}
            />
          </div>

          <div className="comm-field">
            <label>SMTP Port</label>
            <input
              type="number"
              value={settings.smtpPort}
              onChange={(e) => handleChange("smtpPort", parseInt(e.target.value) || 587)}
              placeholder="587"
              disabled={!settings.emailEnabled}
            />
          </div>

          <div className="comm-field">
            <label>Sender Email</label>
            <input
              type="email"
              value={settings.senderEmail}
              onChange={(e) => handleChange("senderEmail", e.target.value)}
              placeholder="you@example.com"
              disabled={!settings.emailEnabled}
            />
          </div>

          <div className="comm-field">
            <label>Sender Name</label>
            <input
              type="text"
              value={settings.senderName}
              onChange={(e) => handleChange("senderName", e.target.value)}
              placeholder="Your Name"
              disabled={!settings.emailEnabled}
            />
          </div>

          <div className="comm-field">
            <label>SMTP Password</label>
            <input
              type="password"
              value={settings.encryptedPassword}
              onChange={(e) => handleChange("encryptedPassword", e.target.value)}
              placeholder="App password"
              disabled={!settings.emailEnabled}
            />
          </div>
        </div>
      </div>

      <button className="comm-save-btn" onClick={handleSave} disabled={saving}>
        <FiSave /> {saving ? "Saving..." : "Save Settings"}
      </button>

      <div className="comm-section" style={{ marginTop: 24 }}>
        <h3><FiSend /> Test Email</h3>
        <p className="comm-hint">Send a test email to verify your SMTP configuration.</p>
        <div className="comm-form-grid">
          <div className="comm-field">
            <label>Recipient Email</label>
            <input
              type="email"
              value={testEmail.recipient}
              onChange={(e) => setTestEmail({ ...testEmail, recipient: e.target.value })}
              placeholder="recipient@example.com"
            />
          </div>
          <div className="comm-field">
            <label>Subject</label>
            <input
              type="text"
              value={testEmail.subject}
              onChange={(e) => setTestEmail({ ...testEmail, subject: e.target.value })}
            />
          </div>
          <div className="comm-field full-width">
            <label>Message</label>
            <textarea
              rows={3}
              value={testEmail.message}
              onChange={(e) => setTestEmail({ ...testEmail, message: e.target.value })}
            />
          </div>
        </div>

        <button className="comm-save-btn" onClick={handleTestEmail} disabled={testing} style={{ background: "#22c55e" }}>
          {testing ? <><FiLoader className="comm-spin" /> Sending...</> : <><FiSend /> Send Test Email</>}
        </button>

        {testResult && (
          <div className={`comm-test-result ${testResult.success ? "success" : "error"}`}>
            {testResult.success ? <FiCheckCircle /> : <FiXCircle />}
            <div className="comm-test-result-body">
              <strong>{testResult.success ? "Email sent successfully" : "Email failed"}</strong>
              {testResult.providerResponse && <p>{testResult.providerResponse}</p>}
              {testResult.errorMessage && <p className="comm-error-detail">{testResult.errorMessage}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="comm-section">
        <h3><FiMessageSquare /> WhatsApp Configuration</h3>
        <div className="comm-form-grid">
          <label className="comm-toggle">
            <input
              type="checkbox"
              checked={settings.whatsappEnabled}
              onChange={(e) => handleChange("whatsappEnabled", e.target.checked)}
            />
            <span className="comm-toggle-label">Enable WhatsApp</span>
          </label>

          <div className="comm-field">
            <label>Phone Number ID</label>
            <input
              type="text"
              value={settings.whatsappPhoneNumberId}
              onChange={(e) => handleChange("whatsappPhoneNumberId", e.target.value)}
              placeholder="123456789012345"
              disabled={!settings.whatsappEnabled}
            />
          </div>

          <div className="comm-field">
            <label>Business Account ID</label>
            <input
              type="text"
              value={settings.whatsappBusinessAccountId}
              onChange={(e) => handleChange("whatsappBusinessAccountId", e.target.value)}
              placeholder="123456789012345"
              disabled={!settings.whatsappEnabled}
            />
          </div>

          <div className="comm-field">
            <label>WhatsApp Access Token</label>
            <input
              type="password"
              value={settings.whatsappAccessToken}
              onChange={(e) => handleChange("whatsappAccessToken", e.target.value)}
              placeholder="EAAx..."
              disabled={!settings.whatsappEnabled}
            />
          </div>
        </div>
      </div>

      <button className="comm-save-btn" onClick={handleSave} disabled={saving}>
        <FiSave /> {saving ? "Saving..." : "Save Settings"}
      </button>
    </div>
  );
}
