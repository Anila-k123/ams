import { useState, useEffect, useRef } from "react";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { InputNumber } from "primereact/inputnumber";
import { Password } from "primereact/password";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { InputSwitch } from "primereact/inputswitch";
import { RadioButton } from "primereact/radiobutton";
import { Card } from "primereact/card";
import { ProgressSpinner } from "primereact/progressspinner";
import api from "../api/client";
import { useTheme } from "../contexts/ThemeContext";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../context/AuthContext";
import "../assets/styles/SettingsPage.css";
import "../assets/styles/ProfilePage.css";

const PWD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&*!?_+=-])[A-Za-z\d@#$%^&*!?_+=-]{8,32}$/;

const TABS = [
  { id: "general", label: "General", icon: "pi pi-user" },
  { id: "office", label: "Office", icon: "pi pi-building" },
  { id: "branding", label: "Branding", icon: "pi pi-image" },
  { id: "security", label: "Security", icon: "pi pi-lock" },
  { id: "preferences", label: "Preferences", icon: "pi pi-sliders-h" },
];

const opts = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
const GENDERS = opts([["", "Select"], ["male", "Male"], ["female", "Female"], ["other", "Other"]]);
const LANGUAGES = opts([["en", "English"], ["hi", "Hindi"], ["gu", "Gujarati"], ["mr", "Marathi"]]);
const TIMEZONES = opts([
  ["Asia/Kolkata", "Asia/Kolkata (IST)"], ["Asia/Dubai", "Asia/Dubai (GST)"],
  ["America/New_York", "America/New_York (EST)"], ["Europe/London", "Europe/London (GMT)"], ["UTC", "UTC"],
]);
const CURRENCIES = opts([["INR", "INR (₹)"], ["USD", "USD ($)"], ["EUR", "EUR (€)"], ["GBP", "GBP (£)"], ["AED", "AED (د.إ)"]]);
const DATE_FORMATS = opts([["DD/MM/YYYY", "DD/MM/YYYY"], ["MM/DD/YYYY", "MM/DD/YYYY"], ["YYYY-MM-DD", "YYYY-MM-DD"]]);
const DASH_FILTERS = opts([
  ["today", "Today"], ["this_week", "This Week"], ["this_month", "This Month"],
  ["this_quarter", "This Quarter"], ["this_year", "This Year"],
]);

// The API speaks "YYYY-MM-DD" strings; Calendar speaks Date.
const toDate = (s: string) => {
  if (!s) return null;
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return y ? new Date(y, m - 1, d) : null;
};
const fromDate = (d: any) => {
  if (!(d instanceof Date)) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function ProfilePage() {
  const { setTheme: applyTheme } = useTheme() as any;
  const { withLoading } = useLoading() as any;
  const toast = useToast() as any;
  const { updateProfile } = useAuth();

  const [activeTab, setActiveTab] = useState("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [general, setGeneral] = useState<any>({
    fullName: "", phone: "", specialization: "", experience: 0,
    address: "", dateOfBirth: "", gender: "", enrollmentDate: "", bio: "", practiceAreas: "",
  });
  const [office, setOffice] = useState<any>({
    officeName: "", officeAddress: "", city: "", state: "", country: "",
    pinCode: "", officePhone: "", officeEmail: "", website: "", gstNumber: "", panNumber: "",
  });
  const [branding, setBranding] = useState<any>({
    profilePhotoUrl: "", officeLogoUrl: "", signatureUrl: "", officeSealUrl: "",
    primaryBrandColor: "#4F7CFF", secondaryBrandColor: "#3B82F6",
  });
  const [security, setSecurity] = useState<any>({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
  const [preferences, setPreferences] = useState<any>({
    theme: "light", language: "en", timeZone: "Asia/Kolkata", currency: "INR",
    dateFormat: "DD/MM/YYYY", autoLogoutDuration: 30, defaultDashboardFilter: "this_month",
  });
  const [notifications, setNotifications] = useState<any>({
    whatsappEnabled: false, emailNotificationsEnabled: false, browserNotificationsEnabled: true,
  });

  const [pwdErrors, setPwdErrors] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<any>({ photo: false, logo: false, signature: false, seal: false });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<string | null>(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const { data: d } = await api.get("/api/profile");
      setGeneral({
        fullName: d.fullName || "", phone: d.phone || "", specialization: d.specialization || "",
        experience: d.experience || 0, address: d.address || "",
        dateOfBirth: d.dateOfBirth || "", gender: d.gender || "",
        enrollmentDate: d.enrollmentDate || "", bio: d.bio || "", practiceAreas: d.practiceAreas || "",
      });
      setOffice({
        officeName: d.officeName || "", officeAddress: d.officeAddress || "",
        city: d.city || "", state: d.state || "", country: d.country || "",
        pinCode: d.pinCode || "", officePhone: d.officePhone || "",
        officeEmail: d.officeEmail || "", website: d.website || "",
        gstNumber: d.gstNumber || "", panNumber: d.panNumber || "",
      });
      setBranding({
        profilePhotoUrl: d.profilePhotoUrl || "", officeLogoUrl: d.officeLogoUrl || "",
        signatureUrl: d.signatureUrl || "", officeSealUrl: d.officeSealUrl || "",
        primaryBrandColor: d.primaryBrandColor || "#4F7CFF",
        secondaryBrandColor: d.secondaryBrandColor || "#3B82F6",
      });
      setPreferences({
        theme: d.theme || "light", language: d.language || "en",
        timeZone: d.timeZone || "Asia/Kolkata", currency: d.currency || "INR",
        dateFormat: d.dateFormat || "DD/MM/YYYY",
        autoLogoutDuration: d.autoLogoutDuration || 30,
        defaultDashboardFilter: d.defaultDashboardFilter || "this_month",
      });
      setNotifications({
        whatsappEnabled: d.whatsappEnabled || false,
        emailNotificationsEnabled: d.emailNotificationsEnabled || false,
        browserNotificationsEnabled: d.browserNotificationsEnabled !== false,
      });
    } catch {
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const setGen = (name: string, value: any) => setGeneral((p: any) => ({ ...p, [name]: value }));
  const setOff = (name: string, value: any) => setOffice((p: any) => ({ ...p, [name]: value }));
  const setPref = (name: string, value: any) => setPreferences((p: any) => ({ ...p, [name]: value }));

  const validatePassword = (pwd: string) => {
    const errors: Record<string, string> = {};
    if (pwd.length > 0) {
      if (pwd.length < 8 || pwd.length > 32) errors.length = "8-32 characters";
      if (!/[a-z]/.test(pwd)) errors.lowercase = "Requires lowercase";
      if (!/[A-Z]/.test(pwd)) errors.uppercase = "Requires uppercase";
      if (!/\d/.test(pwd)) errors.digit = "Requires digit";
      if (!/[@#$%^&*!?_+=-]/.test(pwd)) errors.special = "Requires special char";
    }
    setPwdErrors(errors);
  };

  const setSec = (name: string, value: string) => {
    setSecurity((p: any) => ({ ...p, [name]: value }));
    if (name === "newPassword") validatePassword(value);
  };

  const handleSaveGeneral = async () => {
    setSaving(true);
    try {
      const payload = { ...general, ...notifications };
      const res = await withLoading(api.put("/api/profile", payload), "Saving profile...");
      updateProfile({ fullName: res.data.fullName });
      toast.success("Profile updated");
    } catch {
      toast.error("Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOffice = async () => {
    setSaving(true);
    try {
      await withLoading(api.put("/api/profile", office), "Saving office info...");
      toast.success("Office information saved");
    } catch {
      toast.error("Failed to save office info");
    } finally {
      setSaving(false);
    }
  };

  const handleSavePreferences = async () => {
    setSaving(true);
    try {
      const res = await withLoading(api.put("/api/profile/preferences", preferences), "Saving preferences...");
      if (res.data.theme) applyTheme(res.data.theme);
      toast.success("Preferences saved");
    } catch {
      toast.error("Failed to save preferences");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSecurity = async () => {
    setSaving(true);
    try {
      if (security.newPassword !== security.confirmNewPassword) {
        toast.error("Passwords do not match");
        setSaving(false);
        return;
      }
      if (!PWD_REGEX.test(security.newPassword)) {
        toast.error("Password does not meet requirements");
        setSaving(false);
        return;
      }
      await withLoading(api.put("/api/profile/change-password", security), "Changing password...");
      toast.success("Password changed successfully");
      setSecurity({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
      setPwdErrors({});
    } catch (err: any) {
      toast.error(err.response?.data?.error || "Failed to change password");
    } finally {
      setSaving(false);
    }
  };

  const triggerUpload = (type: string) => {
    setUploadTarget(type);
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e: any) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTarget) return;
    const target = uploadTarget;
    setUploading((p: any) => ({ ...p, [target]: true }));
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await withLoading(
        api.post(`/api/profile/branding/${target}`, formData, { headers: { "Content-Type": "multipart/form-data" } }),
        "Uploading..."
      );
      if (target === "photo") setBranding((p: any) => ({ ...p, profilePhotoUrl: res.data.profilePhotoUrl }));
      else if (target === "logo") setBranding((p: any) => ({ ...p, officeLogoUrl: res.data.officeLogoUrl }));
      else if (target === "signature") setBranding((p: any) => ({ ...p, signatureUrl: res.data.signatureUrl }));
      else if (target === "seal") setBranding((p: any) => ({ ...p, officeSealUrl: res.data.officeSealUrl }));
      toast.success(`${target} uploaded`);
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading((p: any) => ({ ...p, [target]: false }));
      setUploadTarget(null);
      e.target.value = "";
    }
  };

  const setColor = (field: string, value: string) => setBranding((p: any) => ({ ...p, [field]: value }));

  const saveBrandColors = async () => {
    setSaving(true);
    try {
      await withLoading(
        api.put("/api/profile", {
          primaryBrandColor: branding.primaryBrandColor,
          secondaryBrandColor: branding.secondaryBrandColor,
        }),
        "Saving brand colors..."
      );
      toast.success("Brand colors saved");
    } catch {
      toast.error("Failed to save brand colors");
    } finally {
      setSaving(false);
    }
  };

  const handleNotificationChange = async (name: string, checked: boolean) => {
    setNotifications((p: any) => ({ ...p, [name]: checked }));
    try {
      await api.patch("/api/advocates/notification-settings", { [name]: checked });
    } catch {
      toast.error("Failed to update notification setting");
    }
  };

  if (loading) {
    return (
      <div className="settings-container flex justify-content-center p-6">
        <ProgressSpinner style={{ width: 40, height: 40 }} />
      </div>
    );
  }

  const col = (label: string, input: any, id?: string, wide = false) => (
    <div className={`${wide ? "col-12" : "col-12 md:col-6"} flex flex-column gap-1`}>
      <label htmlFor={id}>{label}</label>
      {input}
    </div>
  );
  const genText = (name: string, label: string, placeholder?: string) =>
    col(label, <InputText id={`pf-${name}`} value={general[name] ?? ""} placeholder={placeholder} onChange={(e) => setGen(name, e.target.value)} />, `pf-${name}`);
  const offText = (name: string, label: string, placeholder?: string, type = "text") =>
    col(label, <InputText id={`pf-${name}`} type={type} value={office[name] ?? ""} placeholder={placeholder} onChange={(e) => setOff(name, e.target.value)} />, `pf-${name}`);
  const genDate = (name: string, label: string) =>
    col(label, <Calendar inputId={`pf-${name}`} value={toDate(general[name])} onChange={(e) => setGen(name, fromDate(e.value))} dateFormat="dd/mm/yy" showIcon showButtonBar />, `pf-${name}`);
  const prefSelect = (name: string, label: string, options: any[]) =>
    col(label, <Dropdown inputId={`pf-${name}`} value={preferences[name]} options={options} onChange={(e) => setPref(name, e.value)} />, `pf-${name}`);
  const pwd = (name: string, label: string, placeholder: string) =>
    col(label, <Password inputId={`pf-${name}`} value={security[name]} feedback={false} toggleMask placeholder={placeholder} onChange={(e) => setSec(name, e.target.value)} className="w-full" inputClassName="w-full" />, `pf-${name}`, true);

  function renderGeneral() {
    return (
      <div>
        <h3 className="mt-0">General Profile</h3>
        <div className="flex align-items-center gap-3 mb-3">
          <div className="profile-avatar-wrapper">
            {branding.profilePhotoUrl ? (
              <img src={branding.profilePhotoUrl} alt="Profile" className="profile-avatar-img" />
            ) : (
              <div className="profile-avatar-placeholder">{general.fullName?.charAt(0)?.toUpperCase() || "A"}</div>
            )}
            <Button
              type="button" icon="pi pi-camera" rounded size="small" className="profile-photo-upload-btn"
              onClick={() => triggerUpload("photo")} disabled={uploading.photo} aria-label="Upload photo"
            />
          </div>
          <div className="flex flex-column">
            <strong>{general.fullName || "Your Name"}</strong>
            <span className="settings-muted text-sm">Click the camera icon to update your profile photo</span>
          </div>
        </div>

        <div className="grid">
          {genText("fullName", "Full Name")}
          {genText("phone", "Phone Number")}
          {genDate("dateOfBirth", "Date of Birth")}
          {col("Gender", <Dropdown inputId="pf-gender" value={general.gender} options={GENDERS} onChange={(e) => setGen("gender", e.value)} />, "pf-gender")}
          {col("Bar Council Number", <InputText id="pf-bar" value={general.barCouncilId ?? ""} disabled />, "pf-bar")}
          {genDate("enrollmentDate", "Enrollment Date")}
          {col("Experience (Years)", <InputNumber inputId="pf-exp" min={0} useGrouping={false} value={general.experience} onValueChange={(e) => setGen("experience", e.value ?? 0)} />, "pf-exp")}
          {genText("practiceAreas", "Practice Areas", "e.g. Criminal, Civil, Corporate")}
          {col("Address", <InputTextarea id="pf-address" rows={2} value={general.address} onChange={(e) => setGen("address", e.target.value)} />, "pf-address", true)}
          {col("Bio", <InputTextarea id="pf-bio" rows={3} value={general.bio} placeholder="Brief professional bio..." onChange={(e) => setGen("bio", e.target.value)} />, "pf-bio", true)}
        </div>

        <div className="grid">
          {[
            ["browserNotificationsEnabled", "Browser Notifications"],
            ["emailNotificationsEnabled", "Email Notifications"],
            ["whatsappEnabled", "WhatsApp Notifications"],
          ].map(([name, label]) => (
            <div key={name} className="col-12 md:col-4 flex flex-column gap-2">
              <label htmlFor={`pf-${name}`}>{label}</label>
              <InputSwitch inputId={`pf-${name}`} checked={!!notifications[name]} onChange={(e) => handleNotificationChange(name, !!e.value)} />
            </div>
          ))}
        </div>

        <Button className="mt-3" icon="pi pi-save" label={saving ? "Saving..." : "Save Profile"} onClick={handleSaveGeneral} disabled={saving} />
      </div>
    );
  }

  function renderOffice() {
    return (
      <div>
        <h3 className="mt-0">Office Information</h3>
        <div className="grid">
          {offText("officeName", "Office Name", "Your Law Firm / Office")}
          {offText("officePhone", "Office Phone")}
          {offText("officeEmail", "Office Email", undefined, "email")}
          {offText("website", "Website", "https://")}
          {col("Office Address", <InputTextarea id="pf-officeAddress" rows={2} value={office.officeAddress} onChange={(e) => setOff("officeAddress", e.target.value)} />, "pf-officeAddress", true)}
          {offText("city", "City")}
          {offText("state", "State")}
          {offText("country", "Country")}
          {offText("pinCode", "PIN Code")}
          {offText("gstNumber", "GST Number (Optional)")}
          {offText("panNumber", "PAN Number (Optional)")}
        </div>
        <Button className="mt-3" icon="pi pi-save" label={saving ? "Saving..." : "Save Office Info"} onClick={handleSaveOffice} disabled={saving} />
      </div>
    );
  }

  function renderBranding() {
    const brandItems = [
      { key: "logo", label: "Office Logo", url: branding.officeLogoUrl, uploading: uploading.logo },
      { key: "signature", label: "Advocate Signature", url: branding.signatureUrl, uploading: uploading.signature },
      { key: "seal", label: "Office Seal (Optional)", url: branding.officeSealUrl, uploading: uploading.seal },
    ];
    const colorRow = (field: string, label: string) =>
      col(label, (
        <div className="flex align-items-center gap-2">
          <input type="color" value={branding[field]} onChange={(e) => setColor(field, e.target.value)} className="profile-color-picker" />
          <InputText value={branding[field]} onChange={(e) => setColor(field, e.target.value)} className="w-8rem" />
        </div>
      ));

    return (
      <div>
        <h3 className="mt-0">Branding Assets</h3>
        <p className="settings-muted">Upload logos, signature, and seal used in emails, PDFs, invoices, and reports.</p>
        <div className="grid">
          {brandItems.map((item) => (
            <div key={item.key} className="col-12 md:col-4">
              <div className="branding-card" onClick={() => triggerUpload(item.key)}>
                <div className="branding-preview">
                  {item.url ? (
                    <img src={item.url} alt={item.label} className="branding-preview-img" />
                  ) : (
                    <div className="flex flex-column align-items-center gap-2 settings-muted">
                      <i className="pi pi-upload text-2xl" />
                      <span>Click to upload</span>
                    </div>
                  )}
                </div>
                <span className="font-semibold">{item.label}</span>
                {item.uploading && <div className="settings-muted text-sm">Uploading...</div>}
              </div>
            </div>
          ))}
        </div>

        <h3 className="mt-4">Brand Colors</h3>
        <div className="grid">
          {colorRow("primaryBrandColor", "Primary Color")}
          {colorRow("secondaryBrandColor", "Secondary Color")}
        </div>
        <Button className="mt-3" icon="pi pi-save" label={saving ? "Saving..." : "Save Branding"} onClick={saveBrandColors} disabled={saving} />
      </div>
    );
  }

  function renderSecurity() {
    const pwdChecks = [
      { key: "length", label: "8-32 characters" },
      { key: "lowercase", label: "One lowercase letter" },
      { key: "uppercase", label: "One uppercase letter" },
      { key: "digit", label: "One digit" },
      { key: "special", label: "One special character (@ # $ % ^ & * ! ? _ + -)" },
    ];
    return (
      <div>
        <h3 className="mt-0">Change Password</h3>
        <p className="settings-muted">Use at least 8 characters with a mix of letters, numbers, and symbols.</p>
        <div className="grid" style={{ maxWidth: 500 }}>
          {pwd("currentPassword", "Current Password", "Enter current password")}
          {pwd("newPassword", "New Password", "Enter new password")}
          {pwd("confirmNewPassword", "Confirm New Password", "Confirm new password")}
        </div>
        {security.newPassword && (
          <div className="flex flex-column gap-1 mt-2">
            {pwdChecks.map((check) => (
              <div key={check.key} className={`pwd-check-item ${!pwdErrors[check.key] && security.newPassword.length > 0 ? "valid" : ""}`}>
                <i className="pi pi-check" /> <span>{check.label}</span>
              </div>
            ))}
          </div>
        )}
        <Button
          className="mt-3" icon="pi pi-lock" label={saving ? "Updating..." : "Update Password"}
          onClick={handleSaveSecurity} disabled={saving || !security.currentPassword || !security.newPassword}
        />
      </div>
    );
  }

  function renderPreferences() {
    return (
      <div>
        <h3 className="mt-0">Preferences</h3>
        <h4 className="settings-muted mb-2">Theme</h4>
        <div className="flex gap-3 flex-wrap mb-3">
          {[["light", "pi pi-sun", "Light Theme"], ["dark", "pi pi-moon", "Dark Theme"]].map(([v, icon, label]) => (
            <label key={v} className={`settings-theme-card ${preferences.theme === v ? "active" : ""}`}>
              <RadioButton name="theme" value={v} checked={preferences.theme === v} onChange={(e) => setPref("theme", e.value)} />
              <i className={icon} /> {label}
            </label>
          ))}
        </div>
        <div className="grid">
          {prefSelect("language", "Language", LANGUAGES)}
          {prefSelect("timeZone", "Time Zone", TIMEZONES)}
          {prefSelect("currency", "Currency", CURRENCIES)}
          {prefSelect("dateFormat", "Date Format", DATE_FORMATS)}
          {col("Auto Logout (minutes)", <InputNumber inputId="pf-autologout" min={5} max={480} useGrouping={false} value={preferences.autoLogoutDuration} onValueChange={(e) => setPref("autoLogoutDuration", e.value ?? 30)} />, "pf-autologout")}
          {prefSelect("defaultDashboardFilter", "Default Dashboard Filter", DASH_FILTERS)}
        </div>
        <Button className="mt-3" icon="pi pi-save" label={saving ? "Saving..." : "Save Preferences"} onClick={handleSavePreferences} disabled={saving} />
      </div>
    );
  }

  return (
    <div className="settings-container">
      <p className="settings-muted mt-0">Manage your identity, office, branding, security, and preferences.</p>
      <div className="grid">
        <aside className="col-12 md:col-3">
          <Card className="settings-tabs">
            <div className="flex flex-column gap-1">
              {TABS.map((tab) => (
                <Button
                  key={tab.id} type="button" icon={tab.icon} label={tab.label}
                  text={activeTab !== tab.id} className="justify-content-start"
                  onClick={() => setActiveTab(tab.id)}
                />
              ))}
            </div>
          </Card>
        </aside>
        <main className="col-12 md:col-9">
          <Card>
            {activeTab === "general" && renderGeneral()}
            {activeTab === "office" && renderOffice()}
            {activeTab === "branding" && renderBranding()}
            {activeTab === "security" && renderSecurity()}
            {activeTab === "preferences" && renderPreferences()}
          </Card>
        </main>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileUpload} />
    </div>
  );
}
