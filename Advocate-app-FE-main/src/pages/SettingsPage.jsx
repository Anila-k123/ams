import React, { useState, useEffect } from "react";
import axios from "axios";
import { FiUser, FiLock, FiSettings, FiBell, FiSmartphone, FiMail, FiCreditCard } from "react-icons/fi";
import { useTheme } from "../contexts/ThemeContext.jsx";
import "../assets/styles/SettingsPage.css";
import { useLoading } from "../contexts/LoadingContext.jsx";

export default function SettingsPage() {
  const { theme: currentTheme, setTheme: applyTheme } = useTheme();
  const [activeTab, setActiveTab] = useState("profile");
  const [formData, setFormData] = useState({
    fullName: "",
    phone: "",
    barCouncilId: "",
    specialization: "",
    experience: 0,
    address: "",
    password: "",
    theme: "light",
    whatsappEnabled: false,
    emailNotificationsEnabled: false,
    browserNotificationsEnabled: true
  });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Firm billing profile (Settings -> Billing) — used to build the GST tax invoice.
  const [billing, setBilling] = useState({
    payInFavourOf: "", bankName: "", bankBranchAddress: "", accountNumber: "",
    ifscCode: "", micrCode: "", remittanceEmail: "", hsnCode: "", serviceCategory: "",
    gstNote: "", isoNote: "",
  });
  const [savingBilling, setSavingBilling] = useState(false);

  const token = localStorage.getItem("token");
  const { withLoading } = useLoading();

  useEffect(() => {
    fetchProfile();
    fetchBilling();
  }, []);

  const fetchBilling = async () => {
    try {
      const res = await axios.get("/api/invoices/billing-profile", {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBilling((b) => ({ ...b, ...res.data }));
    } catch (err) {
      console.error("Error fetching billing profile:", err);
    }
  };

  const handleBillingChange = (e) => {
    const { name, value } = e.target;
    setBilling((b) => ({ ...b, [name]: value }));
  };

  const saveBilling = async () => {
    setSavingBilling(true);
    setMessage("");
    setErrorMsg("");
    try {
      const res = await withLoading(
        axios.put("/api/invoices/billing-profile", billing,
          { headers: { Authorization: `Bearer ${token}` } }),
        "Saving Billing Details..."
      );
      setBilling((b) => ({ ...b, ...res.data }));
      setMessage("Billing details updated successfully!");
    } catch (err) {
      console.error("Error saving billing profile:", err);
      setErrorMsg(err.response?.data?.error || "Failed to save billing details.");
    } finally {
      setSavingBilling(false);
    }
  };

  const fetchProfile = async () => {
    try {
      const res = await axios.get("/api/advocates/profile", {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = res.data;
      setFormData({
        fullName: data.fullName || "",
        phone: data.phone || "",
        barCouncilId: data.barCouncilId || "",
        specialization: data.specialization || "",
        experience: data.experience || 0,
        address: data.address || "",
        password: "", // don't load password
        theme: data.theme || "light",
        whatsappEnabled: data.whatsappEnabled || false,
        emailNotificationsEnabled: data.emailNotificationsEnabled || false,
        browserNotificationsEnabled: data.browserNotificationsEnabled !== false
      });
    } catch (err) {
      console.error("Error fetching profile:", err);
    }
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({
      ...formData,
      [name]: type === "checkbox" ? checked : value
    });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setErrorMsg("");

    if (formData.password && formData.password !== confirmPassword) {
      setErrorMsg("Passwords do not match.");
      setSaving(false);
      return;
    }

    try {
      const res = await withLoading(
        axios.put(
          "/api/advocates/settings",
          formData,
          { headers: { Authorization: `Bearer ${token}` } }
        ),
        "Saving Settings..."
      );
      
      // Update local values
      localStorage.setItem("fullName", res.data.fullName);
      applyTheme(res.data.theme);

      setMessage("Settings updated successfully!");
      setConfirmPassword("");
      fetchProfile();
    } catch (err) {
      console.error("Error saving settings:", err);
      setErrorMsg("Failed to save settings. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-container">
      <h2>⚙️ System Settings</h2>
      <p className="subtle">Configure user profiles, layouts, notifications, and integration logs.</p>

      {message && <p className="success-banner">{message}</p>}
      {errorMsg && <p className="error-banner">{errorMsg}</p>}

      <div className="settings-wrapper-box">
        {/* Left tabs */}
        <aside className="settings-tabs">
          <button className={`tab-link ${activeTab === "profile" ? "active" : ""}`} onClick={() => setActiveTab("profile")}>
            <FiUser /> Profile details
          </button>
          <button className={`tab-link ${activeTab === "password" ? "active" : ""}`} onClick={() => setActiveTab("password")}>
            <FiLock /> Credentials
          </button>
          <button className={`tab-link ${activeTab === "preferences" ? "active" : ""}`} onClick={() => setActiveTab("preferences")}>
            <FiSettings /> Layout theme
          </button>
          <button className={`tab-link ${activeTab === "notifications" ? "active" : ""}`} onClick={() => setActiveTab("notifications")}>
            <FiBell /> Alerts settings
          </button>
          <button className={`tab-link ${activeTab === "whatsapp" ? "active" : ""}`} onClick={() => setActiveTab("whatsapp")}>
            <FiSmartphone /> WhatsApp setup
          </button>
          <button className={`tab-link ${activeTab === "email" ? "active" : ""}`} onClick={() => setActiveTab("email")}>
            <FiMail /> Mail server
          </button>
          <button className={`tab-link ${activeTab === "billing" ? "active" : ""}`} onClick={() => setActiveTab("billing")}>
            <FiCreditCard /> Invoice billing
          </button>
        </aside>

        {/* Right forms */}
        <main className="settings-form-panel">
          <form onSubmit={handleSave}>
            {activeTab === "profile" && (
              <div className="settings-section">
                <h3>Profile details</h3>
                <div className="input-grid">
                  <div className="input-group">
                    <label>Full Name</label>
                    <input name="fullName" value={formData.fullName} onChange={handleChange} required />
                  </div>
                  <div className="input-group">
                    <label>Phone Number</label>
                    <input name="phone" value={formData.phone} onChange={handleChange} />
                  </div>
                  <div className="input-group">
                    <label>Bar Council ID</label>
                    <input name="barCouncilId" value={formData.barCouncilId} disabled style={{ backgroundColor: "#f1f5f9", cursor: "not-allowed" }} />
                  </div>
                  <div className="input-group">
                    <label>Specialization</label>
                    <input name="specialization" value={formData.specialization} onChange={handleChange} />
                  </div>
                  <div className="input-group">
                    <label>Experience (Years)</label>
                    <input name="experience" type="number" value={formData.experience} onChange={handleChange} />
                  </div>
                </div>
                <div className="input-group" style={{ marginTop: "16px" }}>
                  <label>Office Address</label>
                  <textarea name="address" value={formData.address} onChange={handleChange} rows="3" />
                </div>
              </div>
            )}

            {activeTab === "password" && (
              <div className="settings-section">
                <h3>Change Password</h3>
                <div className="input-grid">
                  <div className="input-group">
                    <label>New Password</label>
                    <input name="password" type="password" placeholder="Enter new password" value={formData.password} onChange={handleChange} />
                  </div>
                  <div className="input-group">
                    <label>Confirm Password</label>
                    <input type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "preferences" && (
              <div className="settings-section">
                <h3>Layout theme preferences</h3>
                <p className="section-desc">Select your default layout look and feel theme.</p>
                <div className="theme-toggle-row">
                  <label className="theme-option-card">
                    <input type="radio" name="theme" value="light" checked={formData.theme === "light"} onChange={handleChange} />
                    <span className="theme-box light">🌞 Light Theme</span>
                  </label>
                  <label className="theme-option-card">
                    <input type="radio" name="theme" value="dark" checked={formData.theme === "dark"} onChange={handleChange} />
                    <span className="theme-box dark">🌙 Dark Theme</span>
                  </label>
                </div>
              </div>
            )}

            {activeTab === "notifications" && (
              <div className="settings-section">
                <h3>System Alert Settings</h3>
                <div className="checkbox-group">
                  <label className="checkbox-row">
                    <input type="checkbox" name="browserNotificationsEnabled" checked={formData.browserNotificationsEnabled} onChange={handleChange} />
                    <div>
                      <strong>Enable Browser Alerts</strong>
                      <p>Show toast notifications and triggers on upcoming hearings in the browser window.</p>
                    </div>
                  </label>

                  <label className="checkbox-row">
                    <input type="checkbox" name="emailNotificationsEnabled" checked={formData.emailNotificationsEnabled} onChange={handleChange} />
                    <div>
                      <strong>Enable Email Alerts</strong>
                      <p>Send daily scheduled summaries of upcoming case events to your registered email address.</p>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {activeTab === "whatsapp" && (
              <div className="settings-section">
                <h3>WhatsApp Business Integration</h3>
                <p className="section-desc">Configure WhatsApp alert triggers sent automatically to clients on cases changes.</p>
                
                <label className="checkbox-row" style={{ marginBottom: "20px" }}>
                  <input type="checkbox" name="whatsappEnabled" checked={formData.whatsappEnabled} onChange={handleChange} />
                  <div>
                    <strong>Activate Mock WhatsApp triggers</strong>
                    <p>When cases are created, hearings rescheduled, or invoices paid, print formatted WhatsApp logs to the system console logs.</p>
                  </div>
                </label>

                <div className="input-group">
                  <label>WhatsApp API Token (Future API mapping)</label>
                  <input type="password" placeholder="Verify token to connect Business account" disabled style={{ backgroundColor: "var(--bg-primary)", color: "var(--text-muted)" }} />
                </div>
              </div>
            )}

            {activeTab === "email" && (
              <div className="settings-section">
                <h3>Mail Server Configuration</h3>
                <p className="section-desc">Configure your SMTP settings to dispatch client invoice statements and hearing notifications.</p>
                
                <div className="input-grid">
                  <div className="input-group">
                    <label>SMTP Host</label>
                    <input placeholder="smtp.mailtrap.io" disabled style={{ backgroundColor: "var(--bg-primary)" }} />
                  </div>
                  <div className="input-group">
                    <label>SMTP Port</label>
                    <input placeholder="587" disabled style={{ backgroundColor: "var(--bg-primary)" }} />
                  </div>
                </div>
              </div>
            )}

            {activeTab === "billing" && (
              <div className="settings-section">
                <h3>Invoice Billing Profile</h3>
                <p className="section-desc">
                  These details appear on every GST tax invoice your firm generates — bank remittance
                  block, HSN/category and the standard GST notes. Supplier GSTIN &amp; PAN come from your
                  firm profile (branding). Editable by the firm owner.
                </p>

                <div className="input-grid">
                  <div className="input-group">
                    <label>Pay in favour of</label>
                    <input name="payInFavourOf" value={billing.payInFavourOf} onChange={handleBillingChange} placeholder="e.g. RAJESH & ASSOCIATES" />
                  </div>
                  <div className="input-group">
                    <label>Remittance email</label>
                    <input name="remittanceEmail" value={billing.remittanceEmail} onChange={handleBillingChange} placeholder="accounts@firm.in" />
                  </div>
                  <div className="input-group">
                    <label>Bank name</label>
                    <input name="bankName" value={billing.bankName} onChange={handleBillingChange} placeholder="HDFC BANK LTD." />
                  </div>
                  <div className="input-group">
                    <label>Bank branch address</label>
                    <input name="bankBranchAddress" value={billing.bankBranchAddress} onChange={handleBillingChange} placeholder="Anna Salai, Chennai - 600002" />
                  </div>
                  <div className="input-group">
                    <label>Account number</label>
                    <input name="accountNumber" value={billing.accountNumber} onChange={handleBillingChange} placeholder="Current A/C No." />
                  </div>
                  <div className="input-group">
                    <label>IFSC code</label>
                    <input name="ifscCode" value={billing.ifscCode} onChange={handleBillingChange} placeholder="HDFC0000032" />
                  </div>
                  <div className="input-group">
                    <label>MICR code</label>
                    <input name="micrCode" value={billing.micrCode} onChange={handleBillingChange} placeholder="600240004" />
                  </div>
                  <div className="input-group">
                    <label>HSN code</label>
                    <input name="hsnCode" value={billing.hsnCode} onChange={handleBillingChange} placeholder="998212" />
                  </div>
                  <div className="input-group">
                    <label>Service category</label>
                    <input name="serviceCategory" value={billing.serviceCategory} onChange={handleBillingChange} placeholder="LEGAL SERVICES" />
                  </div>
                </div>

                <div className="input-group">
                  <label>GST note (reverse-charge text)</label>
                  <textarea name="gstNote" rows={4} value={billing.gstNote} onChange={handleBillingChange} />
                </div>
                <div className="input-group">
                  <label>Footer note (e.g. ISO certification)</label>
                  <input name="isoNote" value={billing.isoNote} onChange={handleBillingChange} placeholder="An ISO 27001 : 2013 Certified Law Firm" />
                </div>
              </div>
            )}

            {activeTab === "billing" ? (
              <button type="button" className="save-settings-btn" disabled={savingBilling} onClick={saveBilling}>
                {savingBilling ? "Saving..." : "Save Billing Details"}
              </button>
            ) : (
              <button type="submit" className="save-settings-btn" disabled={saving}>
                {saving ? "Saving..." : "Save Configuration"}
              </button>
            )}
          </form>
        </main>
      </div>
    </div>
  );
}
