import { useState, useEffect } from "react";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { InputNumber } from "primereact/inputnumber";
import { Password } from "primereact/password";
import { RadioButton } from "primereact/radiobutton";
import { Checkbox } from "primereact/checkbox";
import { Message } from "primereact/message";
import { Card } from "primereact/card";
import api from "../api/client";
import { useTheme } from "../contexts/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { useLoading } from "../contexts/LoadingContext";
import "../assets/styles/SettingsPage.css";

const TABS = [
  { key: "profile", icon: "pi pi-user", label: "Profile details" },
  { key: "password", icon: "pi pi-lock", label: "Credentials" },
  { key: "preferences", icon: "pi pi-cog", label: "Layout theme" },
  { key: "notifications", icon: "pi pi-bell", label: "Alerts settings" },
  { key: "whatsapp", icon: "pi pi-whatsapp", label: "WhatsApp setup" },
  { key: "email", icon: "pi pi-envelope", label: "Mail server" },
  { key: "billing", icon: "pi pi-credit-card", label: "Invoice billing" },
];

const BILLING_FIELDS: [string, string, string][] = [
  ["payInFavourOf", "Pay in favour of", "e.g. RAJESH & ASSOCIATES"],
  ["remittanceEmail", "Remittance email", "accounts@firm.in"],
  ["bankName", "Bank name", "HDFC BANK LTD."],
  ["bankBranchAddress", "Bank branch address", "Anna Salai, Chennai - 600002"],
  ["accountNumber", "Account number", "Current A/C No."],
  ["ifscCode", "IFSC code", "HDFC0000032"],
  ["micrCode", "MICR code", "600240004"],
  ["hsnCode", "HSN code", "998212"],
  ["serviceCategory", "Service category", "LEGAL SERVICES"],
];

export default function SettingsPage() {
  const { setTheme: applyTheme } = useTheme() as any;
  const { updateProfile } = useAuth();
  const [activeTab, setActiveTab] = useState("profile");
  const [formData, setFormData] = useState<any>({
    fullName: "", phone: "", barCouncilId: "", specialization: "", experience: 0, address: "",
    password: "", theme: "light", whatsappEnabled: false, emailNotificationsEnabled: false,
    browserNotificationsEnabled: true,
  });
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Firm billing profile (Settings -> Billing) — used to build the GST tax invoice.
  const [billing, setBilling] = useState<any>({
    payInFavourOf: "", bankName: "", bankBranchAddress: "", accountNumber: "",
    ifscCode: "", micrCode: "", remittanceEmail: "", hsnCode: "", serviceCategory: "",
    gstNote: "", isoNote: "",
  });
  const [savingBilling, setSavingBilling] = useState(false);
  const { withLoading } = useLoading() as any;

  useEffect(() => {
    fetchProfile();
    fetchBilling();
  }, []);

  const fetchBilling = async () => {
    try {
      const res = await api.get("/api/invoices/billing-profile");
      setBilling((b: any) => ({ ...b, ...res.data }));
    } catch (err) {
      console.error("Error fetching billing profile:", err);
    }
  };

  const setBill = (name: string, value: any) => setBilling((b: any) => ({ ...b, [name]: value }));

  const saveBilling = async () => {
    setSavingBilling(true);
    setMessage("");
    setErrorMsg("");
    try {
      const res = await withLoading(api.put("/api/invoices/billing-profile", billing), "Saving Billing Details...");
      setBilling((b: any) => ({ ...b, ...res.data }));
      setMessage("Billing details updated successfully!");
    } catch (err: any) {
      console.error("Error saving billing profile:", err);
      setErrorMsg(err.response?.data?.error || "Failed to save billing details.");
    } finally {
      setSavingBilling(false);
    }
  };

  const fetchProfile = async () => {
    try {
      const { data } = await api.get("/api/advocates/profile");
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
        browserNotificationsEnabled: data.browserNotificationsEnabled !== false,
      });
    } catch (err) {
      console.error("Error fetching profile:", err);
    }
  };

  const set = (name: string, value: any) => setFormData((f: any) => ({ ...f, [name]: value }));

  const handleSave = async (e: any) => {
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
      const res = await withLoading(api.put("/api/advocates/settings", formData), "Saving Settings...");
      updateProfile({ fullName: res.data.fullName });
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

  const text = (name: string, label: string, props: any = {}) => (
    <div className="col-12 md:col-6 flex flex-column gap-1">
      <label htmlFor={`st-${name}`}>{label}</label>
      <InputText id={`st-${name}`} value={formData[name]} onChange={(e) => set(name, e.target.value)} {...props} />
    </div>
  );

  const checkRow = (name: string, title: string, desc: string) => (
    <div className="flex align-items-start gap-3 settings-check-row">
      <Checkbox inputId={`st-${name}`} checked={!!formData[name]} onChange={(e) => set(name, !!e.checked)} />
      <label htmlFor={`st-${name}`}>
        <strong>{title}</strong>
        <p className="m-0 mt-1 settings-muted">{desc}</p>
      </label>
    </div>
  );

  return (
    <div className="settings-container">
      <h2 className="mt-0 mb-1"><i className="pi pi-cog mr-2" />System Settings</h2>
      <p className="settings-muted mt-0">Configure user profiles, layouts, notifications, and integration logs.</p>

      {message && <Message severity="success" text={message} className="w-full justify-content-start mb-3" />}
      {errorMsg && <Message severity="error" text={errorMsg} className="w-full justify-content-start mb-3" />}

      <div className="grid">
        <aside className="col-12 md:col-3">
          <Card className="settings-tabs">
            <div className="flex flex-column gap-1">
              {TABS.map((t) => (
                <Button
                  key={t.key}
                  type="button"
                  icon={t.icon}
                  label={t.label}
                  text={activeTab !== t.key}
                  className="justify-content-start"
                  onClick={() => setActiveTab(t.key)}
                />
              ))}
            </div>
          </Card>
        </aside>

        <main className="col-12 md:col-9">
          <Card>
            <form onSubmit={handleSave}>
              {activeTab === "profile" && (
                <div>
                  <h3 className="mt-0">Profile details</h3>
                  <div className="grid">
                    {text("fullName", "Full Name", { required: true })}
                    {text("phone", "Phone Number")}
                    {text("barCouncilId", "Bar Council ID", { disabled: true })}
                    {text("specialization", "Specialization")}
                    <div className="col-12 md:col-6 flex flex-column gap-1">
                      <label htmlFor="st-experience">Experience (Years)</label>
                      <InputNumber inputId="st-experience" value={formData.experience} useGrouping={false} onValueChange={(e) => set("experience", e.value ?? 0)} />
                    </div>
                    <div className="col-12 flex flex-column gap-1">
                      <label htmlFor="st-address">Office Address</label>
                      <InputTextarea id="st-address" rows={3} value={formData.address} onChange={(e) => set("address", e.target.value)} />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "password" && (
                <div>
                  <h3 className="mt-0">Change Password</h3>
                  <div className="grid">
                    <div className="col-12 md:col-6 flex flex-column gap-1">
                      <label htmlFor="st-password">New Password</label>
                      <Password inputId="st-password" feedback={false} toggleMask placeholder="Enter new password" value={formData.password} onChange={(e) => set("password", e.target.value)} className="w-full" inputClassName="w-full" />
                    </div>
                    <div className="col-12 md:col-6 flex flex-column gap-1">
                      <label htmlFor="st-confirm">Confirm Password</label>
                      <Password inputId="st-confirm" feedback={false} toggleMask placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className="w-full" inputClassName="w-full" />
                    </div>
                  </div>
                </div>
              )}

              {activeTab === "preferences" && (
                <div>
                  <h3 className="mt-0">Layout theme preferences</h3>
                  <p className="settings-muted">Select your default layout look and feel theme.</p>
                  <div className="flex gap-3 flex-wrap">
                    {[["light", "pi pi-sun", "Light Theme"], ["dark", "pi pi-moon", "Dark Theme"]].map(([v, icon, label]) => (
                      <label key={v} className={`settings-theme-card ${formData.theme === v ? "active" : ""}`}>
                        <RadioButton name="theme" value={v} checked={formData.theme === v} onChange={(e) => set("theme", e.value)} />
                        <i className={icon} /> {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === "notifications" && (
                <div className="flex flex-column gap-3">
                  <h3 className="mt-0 mb-0">System Alert Settings</h3>
                  {checkRow("browserNotificationsEnabled", "Enable Browser Alerts", "Show toast notifications and triggers on upcoming hearings in the browser window.")}
                  {checkRow("emailNotificationsEnabled", "Enable Email Alerts", "Send daily scheduled summaries of upcoming case events to your registered email address.")}
                </div>
              )}

              {activeTab === "whatsapp" && (
                <div className="flex flex-column gap-3">
                  <h3 className="mt-0 mb-0">WhatsApp Business Integration</h3>
                  <p className="settings-muted m-0">Configure WhatsApp alert triggers sent automatically to clients on cases changes.</p>
                  {checkRow("whatsappEnabled", "Activate Mock WhatsApp triggers", "When cases are created, hearings rescheduled, or invoices paid, print formatted WhatsApp logs to the system console logs.")}
                  <div className="flex flex-column gap-1">
                    <label>WhatsApp API Token (Future API mapping)</label>
                    <InputText type="password" placeholder="Verify token to connect Business account" disabled />
                  </div>
                </div>
              )}

              {activeTab === "email" && (
                <div>
                  <h3 className="mt-0">Mail Server Configuration</h3>
                  <p className="settings-muted">Configure your SMTP settings to dispatch client invoice statements and hearing notifications.</p>
                  <div className="grid">
                    <div className="col-12 md:col-6 flex flex-column gap-1"><label>SMTP Host</label><InputText placeholder="smtp.mailtrap.io" disabled /></div>
                    <div className="col-12 md:col-6 flex flex-column gap-1"><label>SMTP Port</label><InputText placeholder="587" disabled /></div>
                  </div>
                </div>
              )}

              {activeTab === "billing" && (
                <div>
                  <h3 className="mt-0">Invoice Billing Profile</h3>
                  <p className="settings-muted">
                    These details appear on every GST tax invoice your firm generates — bank remittance
                    block, HSN/category and the standard GST notes. Supplier GSTIN &amp; PAN come from your
                    firm profile (branding). Editable by the firm owner.
                  </p>
                  <div className="grid">
                    {BILLING_FIELDS.map(([name, label, ph]) => (
                      <div key={name} className="col-12 md:col-6 flex flex-column gap-1">
                        <label htmlFor={`bl-${name}`}>{label}</label>
                        <InputText id={`bl-${name}`} value={billing[name] ?? ""} placeholder={ph} onChange={(e) => setBill(name, e.target.value)} />
                      </div>
                    ))}
                    <div className="col-12 flex flex-column gap-1">
                      <label htmlFor="bl-gstNote">GST note (reverse-charge text)</label>
                      <InputTextarea id="bl-gstNote" rows={4} value={billing.gstNote ?? ""} onChange={(e) => setBill("gstNote", e.target.value)} />
                    </div>
                    <div className="col-12 flex flex-column gap-1">
                      <label htmlFor="bl-isoNote">Footer note (e.g. ISO certification)</label>
                      <InputText id="bl-isoNote" value={billing.isoNote ?? ""} placeholder="An ISO 27001 : 2013 Certified Law Firm" onChange={(e) => setBill("isoNote", e.target.value)} />
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3">
                {activeTab === "billing" ? (
                  <Button type="button" icon="pi pi-save" loading={savingBilling} label={savingBilling ? "Saving..." : "Save Billing Details"} onClick={saveBilling} />
                ) : (
                  <Button type="submit" icon="pi pi-save" loading={saving} label={saving ? "Saving..." : "Save Configuration"} />
                )}
              </div>
            </form>
          </Card>
        </main>
      </div>
    </div>
  );
}
