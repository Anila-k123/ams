import { useState, useEffect, useRef } from "react";
import axios from "axios";
import { FiUser, FiHome, FiImage, FiLock, FiSliders, FiUpload, FiSave, FiCamera, FiX, FiEye, FiEyeOff, FiCheck, FiDatabase, FiTrash2, FiRefreshCw } from "react-icons/fi";
import { useTheme } from "../contexts/ThemeContext.jsx";
import { useLoading } from "../contexts/LoadingContext.jsx";
import { useToast } from "../contexts/ToastContext.jsx";
import { useDashboardFilter } from "../contexts/DashboardFilterContext.jsx";
import "../assets/styles/SettingsPage.css";
import "../assets/styles/ProfilePage.css";
import "../assets/styles/DemoWorkspaceDialog.css";

const API_BASE = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api`;
const PWD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&*!?_+=-])[A-Za-z\d@#$%^&*!?_+=-]{8,32}$/;

const TABS = [
  { id: "general", label: "General", icon: FiUser },
  { id: "office", label: "Office", icon: FiHome },
  { id: "branding", label: "Branding", icon: FiImage },
  { id: "security", label: "Security", icon: FiLock },
  { id: "preferences", label: "Preferences", icon: FiSliders },
  { id: "demo", label: "Demo", icon: FiDatabase },
];

export default function ProfilePage() {
  const { theme: currentTheme, setTheme: applyTheme } = useTheme();
  const { withLoading } = useLoading();
  const toast = useToast();
  const token = localStorage.getItem("token");
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };
  const dashboardFilter = useDashboardFilter();

  const [activeTab, setActiveTab] = useState("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [general, setGeneral] = useState({
    fullName: "", phone: "", specialization: "", experience: 0,
    address: "", dateOfBirth: "", gender: "", enrollmentDate: "", bio: "", practiceAreas: "",
  });
  const [office, setOffice] = useState({
    officeName: "", officeAddress: "", city: "", state: "", country: "",
    pinCode: "", officePhone: "", officeEmail: "", website: "", gstNumber: "", panNumber: "",
  });
  const [branding, setBranding] = useState({
    profilePhotoUrl: "", officeLogoUrl: "", signatureUrl: "", officeSealUrl: "",
    primaryBrandColor: "#4F7CFF", secondaryBrandColor: "#3B82F6",
  });
  const [security, setSecurity] = useState({
    currentPassword: "", newPassword: "", confirmNewPassword: "",
  });
  const [preferences, setPreferences] = useState({
    theme: "light", language: "en", timeZone: "Asia/Kolkata", currency: "INR",
    dateFormat: "DD/MM/YYYY", autoLogoutDuration: 30, defaultDashboardFilter: "this_month",
  });
  const [notifications, setNotifications] = useState({
    whatsappEnabled: false, emailNotificationsEnabled: false, browserNotificationsEnabled: true,
  });

  const [showPwd, setShowPwd] = useState({ current: false, new: false, confirm: false });
  const [pwdErrors, setPwdErrors] = useState({});
  const [uploading, setUploading] = useState({ photo: false, logo: false, signature: false, seal: false });
  const [demoStatus, setDemoStatus] = useState(null);
  const [demoLoading, setDemoLoading] = useState(false);
  const [demoError, setDemoError] = useState(null);
  const [demoSuccess, setDemoSuccess] = useState(null);

  const fileInputRef = useRef(null);
  const [uploadTarget, setUploadTarget] = useState(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await axios.get(`${API_BASE}/profile`, authHeaders);
      const d = res.data;

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
    } catch (err) {
      toast.error("Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const handleGeneralChange = (e) => {
    const { name, value } = e.target;
    setGeneral((prev) => ({ ...prev, [name]: value }));
  };

  const handleOfficeChange = (e) => {
    const { name, value } = e.target;
    setOffice((prev) => ({ ...prev, [name]: value }));
  };

  const handlePreferencesChange = (e) => {
    const { name, value, type, checked } = e.target;
    setPreferences((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleSecurityChange = (e) => {
    const { name, value } = e.target;
    setSecurity((prev) => ({ ...prev, [name]: value }));
    if (name === "newPassword") {
      validatePassword(value);
    }
  };

  const validatePassword = (pwd) => {
    const errors = {};
    if (pwd.length > 0) {
      if (pwd.length < 8 || pwd.length > 32) errors.length = "8-32 characters";
      if (!/[a-z]/.test(pwd)) errors.lowercase = "Requires lowercase";
      if (!/[A-Z]/.test(pwd)) errors.uppercase = "Requires uppercase";
      if (!/\d/.test(pwd)) errors.digit = "Requires digit";
      if (!/[@#$%^&*!?_+=-]/.test(pwd)) errors.special = "Requires special char";
    }
    setPwdErrors(errors);
  };

  const handleSaveGeneral = async () => {
    setSaving(true);
    try {
      const payload = { ...general, ...notifications };
      const res = await withLoading(
        axios.put(`${API_BASE}/profile`, payload, authHeaders),
        "Saving profile..."
      );
      localStorage.setItem("fullName", res.data.fullName);
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
      await withLoading(
        axios.put(`${API_BASE}/profile`, office, authHeaders),
        "Saving office info..."
      );
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
      const res = await withLoading(
        axios.put(`${API_BASE}/profile/preferences`, preferences, authHeaders),
        "Saving preferences..."
      );
      if (res.data.theme) {
        applyTheme(res.data.theme);
      }
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
      await withLoading(
        axios.put(`${API_BASE}/profile/change-password`, security, authHeaders),
        "Changing password..."
      );
      toast.success("Password changed successfully");
      setSecurity({ currentPassword: "", newPassword: "", confirmNewPassword: "" });
      setPwdErrors({});
    } catch (err) {
      const msg = err.response?.data?.error || "Failed to change password";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const triggerUpload = (type) => {
    setUploadTarget(type);
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !uploadTarget) return;

    setUploading((prev) => ({ ...prev, [uploadTarget]: true }));
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await withLoading(
        axios.post(`${API_BASE}/profile/branding/${uploadTarget}`, formData, {
          ...authHeaders,
          headers: { ...authHeaders.headers, "Content-Type": "multipart/form-data" },
        }),
        "Uploading..."
      );
      const urlKey = `${uploadTarget}Url`;
      if (uploadTarget === "photo") setBranding((prev) => ({ ...prev, profilePhotoUrl: res.data.profilePhotoUrl }));
      else if (uploadTarget === "logo") setBranding((prev) => ({ ...prev, officeLogoUrl: res.data.officeLogoUrl }));
      else if (uploadTarget === "signature") setBranding((prev) => ({ ...prev, signatureUrl: res.data.signatureUrl }));
      else if (uploadTarget === "seal") setBranding((prev) => ({ ...prev, officeSealUrl: res.data.officeSealUrl }));
      toast.success(`${uploadTarget} uploaded`);
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading((prev) => ({ ...prev, [uploadTarget]: false }));
      setUploadTarget(null);
      e.target.value = "";
    }
  };

  const handleBrandColorChange = (field, value) => {
    setBranding((prev) => ({ ...prev, [field]: value }));
  };

  const saveBrandColors = async () => {
    setSaving(true);
    try {
      await withLoading(
        axios.put(`${API_BASE}/profile`, {
          primaryBrandColor: branding.primaryBrandColor,
          secondaryBrandColor: branding.secondaryBrandColor,
        }, authHeaders),
        "Saving brand colors..."
      );
      toast.success("Brand colors saved");
    } catch {
      toast.error("Failed to save brand colors");
    } finally {
      setSaving(false);
    }
  };

  const handleNotificationChange = async (e) => {
    const { name, checked } = e.target;
    setNotifications((prev) => ({ ...prev, [name]: checked }));
    try {
      await axios.patch(`${API_BASE}/advocates/notification-settings`,
        { [name]: checked }, authHeaders
      );
    } catch {
      toast.error("Failed to update notification setting");
    }
  };

  const fetchDemoStatus = async () => {
    try {
      const res = await fetch(`${API_BASE.replace("/api", "")}/api/demo/status`, authHeaders);
      if (res.ok) {
        setDemoStatus(await res.json());
      }
    } catch (e) {
      // ignore
    }
  };

  const handleLoadDemo = async () => {
    setDemoLoading(true);
    setDemoError(null);
    setDemoSuccess(null);
    try {
      const res = await fetch(`${API_BASE.replace("/api", "")}/api/demo/load`, {
        method: "POST", ...authHeaders,
        headers: { ...authHeaders.headers, "Content-Type": "application/json" }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to load demo data");
      }
      setDemoSuccess("Demo workspace loaded successfully!");
      await fetchDemoStatus();
      dashboardFilter.forceRefreshDashboard();
    } catch (err) {
      setDemoError(err.message);
    } finally {
      setDemoLoading(false);
    }
  };

  const handleClearDemo = async () => {
    setDemoLoading(true);
    setDemoError(null);
    setDemoSuccess(null);
    try {
      const res = await fetch(`${API_BASE.replace("/api", "")}/api/demo/clear`, {
        method: "DELETE", ...authHeaders,
        headers: { ...authHeaders.headers, "Content-Type": "application/json" }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to clear demo data");
      }
      setDemoSuccess("Demo workspace cleared!");
      await fetchDemoStatus();
      dashboardFilter.forceRefreshDashboard();
    } catch (err) {
      setDemoError(err.message);
    } finally {
      setDemoLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "demo") {
      fetchDemoStatus();
    }
  }, [activeTab]);

  if (loading) {
    return (
      <div className="settings-container">
        <div className="profile-loading">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="settings-container">
      <h2>Profile & Office Management</h2>
      <p className="subtle">Manage your identity, office, branding, security, and preferences.</p>

      <div className="settings-wrapper-box">
        <aside className="settings-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`tab-link ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </aside>

        <main className="settings-form-panel">
          {activeTab === "general" && renderGeneral()}
          {activeTab === "office" && renderOffice()}
          {activeTab === "branding" && renderBranding()}
          {activeTab === "security" && renderSecurity()}
          {activeTab === "preferences" && renderPreferences()}
          {activeTab === "demo" && renderDemoWorkspace()}
        </main>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleFileUpload}
      />
    </div>
  );

  function renderGeneral() {
    return (
      <div className="settings-section">
        <h3>General Profile</h3>

        <div className="profile-photo-section">
          <div className="profile-avatar-wrapper">
            {branding.profilePhotoUrl ? (
              <img src={branding.profilePhotoUrl} alt="Profile" className="profile-avatar-img" />
            ) : (
              <div className="profile-avatar-placeholder">
                {general.fullName?.charAt(0)?.toUpperCase() || "A"}
              </div>
            )}
            <button
              type="button"
              className="profile-photo-upload-btn"
              onClick={() => triggerUpload("photo")}
              disabled={uploading.photo}
            >
              <FiCamera size={16} />
            </button>
          </div>
          <div className="profile-photo-info">
            <strong>{general.fullName || "Your Name"}</strong>
            <span>Click the camera icon to update your profile photo</span>
          </div>
        </div>

        <div className="input-grid">
          <div className="input-group">
            <label>Full Name</label>
            <input name="fullName" value={general.fullName} onChange={handleGeneralChange} />
          </div>
          <div className="input-group">
            <label>Phone Number</label>
            <input name="phone" value={general.phone} onChange={handleGeneralChange} />
          </div>
          <div className="input-group">
            <label>Date of Birth</label>
            <input name="dateOfBirth" type="date" value={general.dateOfBirth} onChange={handleGeneralChange} />
          </div>
          <div className="input-group">
            <label>Gender</label>
            <select name="gender" value={general.gender} onChange={handleGeneralChange} className="profile-select">
              <option value="">Select</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="input-group">
            <label>Bar Council Number</label>
            <input name="barCouncilId" value={general.barCouncilId} disabled className="profile-disabled-input" />
          </div>
          <div className="input-group">
            <label>Enrollment Date</label>
            <input name="enrollmentDate" type="date" value={general.enrollmentDate} onChange={handleGeneralChange} />
          </div>
          <div className="input-group">
            <label>Experience (Years)</label>
            <input name="experience" type="number" min="0" value={general.experience} onChange={handleGeneralChange} />
          </div>
          <div className="input-group">
            <label>Practice Areas</label>
            <input name="practiceAreas" value={general.practiceAreas} onChange={handleGeneralChange} placeholder="e.g. Criminal, Civil, Corporate" />
          </div>
        </div>

        <div className="input-group">
          <label>Address</label>
          <textarea name="address" value={general.address} onChange={handleGeneralChange} rows="2" />
        </div>

        <div className="input-group">
          <label>Bio</label>
          <textarea name="bio" value={general.bio} onChange={handleGeneralChange} rows="3" placeholder="Brief professional bio..." />
        </div>

        <div className="input-grid">
          <div className="input-group">
            <label>Browser Notifications</label>
            <label className="profile-toggle">
              <input type="checkbox" name="browserNotificationsEnabled" checked={notifications.browserNotificationsEnabled} onChange={handleNotificationChange} />
              <span className="profile-toggle-slider"></span>
            </label>
          </div>
          <div className="input-group">
            <label>Email Notifications</label>
            <label className="profile-toggle">
              <input type="checkbox" name="emailNotificationsEnabled" checked={notifications.emailNotificationsEnabled} onChange={handleNotificationChange} />
              <span className="profile-toggle-slider"></span>
            </label>
          </div>
          <div className="input-group">
            <label>WhatsApp Notifications</label>
            <label className="profile-toggle">
              <input type="checkbox" name="whatsappEnabled" checked={notifications.whatsappEnabled} onChange={handleNotificationChange} />
              <span className="profile-toggle-slider"></span>
            </label>
          </div>
        </div>

        <button className="save-settings-btn" onClick={handleSaveGeneral} disabled={saving}>
          <FiSave size={15} /> {saving ? "Saving..." : "Save Profile"}
        </button>
      </div>
    );
  }

  function renderOffice() {
    return (
      <div className="settings-section">
        <h3>Office Information</h3>
        <div className="input-grid">
          <div className="input-group">
            <label>Office Name</label>
            <input name="officeName" value={office.officeName} onChange={handleOfficeChange} placeholder="Your Law Firm / Office" />
          </div>
          <div className="input-group">
            <label>Office Phone</label>
            <input name="officePhone" value={office.officePhone} onChange={handleOfficeChange} />
          </div>
          <div className="input-group">
            <label>Office Email</label>
            <input name="officeEmail" type="email" value={office.officeEmail} onChange={handleOfficeChange} />
          </div>
          <div className="input-group">
            <label>Website</label>
            <input name="website" value={office.website} onChange={handleOfficeChange} placeholder="https://" />
          </div>
        </div>

        <div className="input-group">
          <label>Office Address</label>
          <textarea name="officeAddress" value={office.officeAddress} onChange={handleOfficeChange} rows="2" />
        </div>

        <div className="input-grid">
          <div className="input-group">
            <label>City</label>
            <input name="city" value={office.city} onChange={handleOfficeChange} />
          </div>
          <div className="input-group">
            <label>State</label>
            <input name="state" value={office.state} onChange={handleOfficeChange} />
          </div>
          <div className="input-group">
            <label>Country</label>
            <input name="country" value={office.country} onChange={handleOfficeChange} />
          </div>
          <div className="input-group">
            <label>PIN Code</label>
            <input name="pinCode" value={office.pinCode} onChange={handleOfficeChange} />
          </div>
        </div>

        <div className="input-grid">
          <div className="input-group">
            <label>GST Number (Optional)</label>
            <input name="gstNumber" value={office.gstNumber} onChange={handleOfficeChange} />
          </div>
          <div className="input-group">
            <label>PAN Number (Optional)</label>
            <input name="panNumber" value={office.panNumber} onChange={handleOfficeChange} />
          </div>
        </div>

        <button className="save-settings-btn" onClick={handleSaveOffice} disabled={saving}>
          <FiSave size={15} /> {saving ? "Saving..." : "Save Office Info"}
        </button>
      </div>
    );
  }

  function renderBranding() {
    const brandItems = [
      { key: "logo", label: "Office Logo", url: branding.officeLogoUrl, uploading: uploading.logo },
      { key: "signature", label: "Advocate Signature", url: branding.signatureUrl, uploading: uploading.signature },
      { key: "seal", label: "Office Seal (Optional)", url: branding.officeSealUrl, uploading: uploading.seal },
    ];

    return (
      <div className="settings-section">
        <h3>Branding Assets</h3>
        <p className="section-desc">Upload logos, signature, and seal used in emails, PDFs, invoices, and reports.</p>

        <div className="branding-grid">
          {brandItems.map((item) => (
            <div key={item.key} className="branding-card" onClick={() => triggerUpload(item.key)}>
              <div className="branding-preview">
                {item.url ? (
                  <img src={item.url} alt={item.label} className="branding-preview-img" />
                ) : (
                  <div className="branding-placeholder">
                    <FiUpload size={24} />
                    <span>Click to upload</span>
                  </div>
                )}
              </div>
              <span className="branding-label">{item.label}</span>
              {item.uploading && <div className="branding-uploading">Uploading...</div>}
            </div>
          ))}
        </div>

        <h3 style={{ marginTop: "28px" }}>Brand Colors</h3>
        <div className="brand-colors-row">
          <div className="input-group">
            <label>Primary Color</label>
            <div className="color-picker-wrapper">
              <input
                type="color"
                value={branding.primaryBrandColor}
                onChange={(e) => handleBrandColorChange("primaryBrandColor", e.target.value)}
                className="color-picker"
              />
              <input
                type="text"
                value={branding.primaryBrandColor}
                onChange={(e) => handleBrandColorChange("primaryBrandColor", e.target.value)}
                className="color-hex-input"
              />
            </div>
          </div>
          <div className="input-group">
            <label>Secondary Color</label>
            <div className="color-picker-wrapper">
              <input
                type="color"
                value={branding.secondaryBrandColor}
                onChange={(e) => handleBrandColorChange("secondaryBrandColor", e.target.value)}
                className="color-picker"
              />
              <input
                type="text"
                value={branding.secondaryBrandColor}
                onChange={(e) => handleBrandColorChange("secondaryBrandColor", e.target.value)}
                className="color-hex-input"
              />
            </div>
          </div>
        </div>

        <button className="save-settings-btn" onClick={saveBrandColors} disabled={saving}>
          <FiSave size={15} /> {saving ? "Saving..." : "Save Branding"}
        </button>
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
      <div className="settings-section">
        <h3>Change Password</h3>
        <p className="section-desc">Use at least 8 characters with a mix of letters, numbers, and symbols.</p>

        <div className="input-grid" style={{ maxWidth: "500px" }}>
          <div className="input-group">
            <label>Current Password</label>
            <div className="pwd-input-wrapper">
              <input
                name="currentPassword"
                type={showPwd.current ? "text" : "password"}
                value={security.currentPassword}
                onChange={handleSecurityChange}
                placeholder="Enter current password"
              />
              <button type="button" className="pwd-toggle-btn" onClick={() => setShowPwd((p) => ({ ...p, current: !p.current }))}>
                {showPwd.current ? <FiEyeOff size={16} /> : <FiEye size={16} />}
              </button>
            </div>
          </div>
          <div className="input-group">
            <label>New Password</label>
            <div className="pwd-input-wrapper">
              <input
                name="newPassword"
                type={showPwd.new ? "text" : "password"}
                value={security.newPassword}
                onChange={handleSecurityChange}
                placeholder="Enter new password"
              />
              <button type="button" className="pwd-toggle-btn" onClick={() => setShowPwd((p) => ({ ...p, new: !p.new }))}>
                {showPwd.new ? <FiEyeOff size={16} /> : <FiEye size={16} />}
              </button>
            </div>
          </div>
          <div className="input-group">
            <label>Confirm New Password</label>
            <div className="pwd-input-wrapper">
              <input
                name="confirmNewPassword"
                type={showPwd.confirm ? "text" : "password"}
                value={security.confirmNewPassword}
                onChange={handleSecurityChange}
                placeholder="Confirm new password"
              />
              <button type="button" className="pwd-toggle-btn" onClick={() => setShowPwd((p) => ({ ...p, confirm: !p.confirm }))}>
                {showPwd.confirm ? <FiEyeOff size={16} /> : <FiEye size={16} />}
              </button>
            </div>
          </div>
        </div>

        {security.newPassword && (
          <div className="pwd-checklist">
            {pwdChecks.map((check) => (
              <div key={check.key} className={`pwd-check-item ${!pwdErrors[check.key] && security.newPassword.length > 0 ? "valid" : ""}`}>
                <FiCheck size={14} />
                <span>{check.label}</span>
              </div>
            ))}
          </div>
        )}

        <button className="save-settings-btn" onClick={handleSaveSecurity} disabled={saving || !security.currentPassword || !security.newPassword}>
          <FiLock size={15} /> {saving ? "Updating..." : "Update Password"}
        </button>
      </div>
    );
  }

  function renderPreferences() {
    return (
      <div className="settings-section">
        <h3>Preferences</h3>

        <h4 style={{ margin: "16px 0 8px", fontSize: "13px", color: "var(--text-muted)" }}>Theme</h4>
        <div className="theme-toggle-row">
          <label className="theme-option-card">
            <input type="radio" name="theme" value="light" checked={preferences.theme === "light"} onChange={handlePreferencesChange} />
            <span className="theme-box light">
              <span className="theme-icon">☀️</span>
              Light Theme
            </span>
          </label>
          <label className="theme-option-card">
            <input type="radio" name="theme" value="dark" checked={preferences.theme === "dark"} onChange={handlePreferencesChange} />
            <span className="theme-box dark">
              <span className="theme-icon">🌙</span>
              Dark Theme
            </span>
          </label>
        </div>

        <div className="input-grid">
          <div className="input-group">
            <label>Language</label>
            <select name="language" value={preferences.language} onChange={handlePreferencesChange} className="profile-select">
              <option value="en">English</option>
              <option value="hi">Hindi</option>
              <option value="gu">Gujarati</option>
              <option value="mr">Marathi</option>
            </select>
          </div>
          <div className="input-group">
            <label>Time Zone</label>
            <select name="timeZone" value={preferences.timeZone} onChange={handlePreferencesChange} className="profile-select">
              <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              <option value="Asia/Dubai">Asia/Dubai (GST)</option>
              <option value="America/New_York">America/New_York (EST)</option>
              <option value="Europe/London">Europe/London (GMT)</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
          <div className="input-group">
            <label>Currency</label>
            <select name="currency" value={preferences.currency} onChange={handlePreferencesChange} className="profile-select">
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
              <option value="AED">AED (د.إ)</option>
            </select>
          </div>
          <div className="input-group">
            <label>Date Format</label>
            <select name="dateFormat" value={preferences.dateFormat} onChange={handlePreferencesChange} className="profile-select">
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </select>
          </div>
          <div className="input-group">
            <label>Auto Logout (minutes)</label>
            <input name="autoLogoutDuration" type="number" min="5" max="480" value={preferences.autoLogoutDuration} onChange={handlePreferencesChange} />
          </div>
          <div className="input-group">
            <label>Default Dashboard Filter</label>
            <select name="defaultDashboardFilter" value={preferences.defaultDashboardFilter} onChange={handlePreferencesChange} className="profile-select">
              <option value="today">Today</option>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
              <option value="this_quarter">This Quarter</option>
              <option value="this_year">This Year</option>
            </select>
          </div>
        </div>

        <button className="save-settings-btn" onClick={handleSavePreferences} disabled={saving}>
          <FiSave size={15} /> {saving ? "Saving..." : "Save Preferences"}
        </button>
      </div>
    );
  }

  function renderDemoWorkspace() {
    const counts = demoStatus?.recordCounts || {};

    return (
      <div className="settings-section">
        <h3>Demo Workspace</h3>
        <p className="section-desc">
          Load sample data to explore the system, or clear all demo data from your workspace.
        </p>

        {demoError && (
          <div className="demo-alert demo-alert-error" style={{ marginBottom: 16 }}>
            <FiX size={16} />
            <span>{demoError}</span>
          </div>
        )}
        {demoSuccess && (
          <div className="demo-alert demo-alert-success" style={{ marginBottom: 16 }}>
            <FiCheck size={16} />
            <span>{demoSuccess}</span>
          </div>
        )}

        {demoStatus && (
          <div className="demo-stats-grid" style={{ marginBottom: 20 }}>
            {Object.entries(counts).map(([key, count]) => (
              <div key={key} className="demo-stat-card" style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
                <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--text-muted)" }}>{key}</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)" }}>{count}</span>
              </div>
            ))}
          </div>
        )}

        {demoStatus?.hasDemoWorkspace && (
          <div style={{ marginBottom: 16, padding: "10px 14px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 13, color: "#16a34a", display: "flex", alignItems: "center", gap: 8 }}>
            <FiCheck size={16} />
            <span>Demo workspace loaded on {new Date(demoStatus.generatedAt).toLocaleDateString()}</span>
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
          {!demoStatus?.hasDemoWorkspace ? (
            <button className="save-settings-btn" onClick={handleLoadDemo} disabled={demoLoading} style={{ background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#fff" }}>
              <FiDatabase size={15} /> {demoLoading ? "Loading..." : "Load Demo Workspace"}
            </button>
          ) : (
            <>
              <button className="save-settings-btn" onClick={handleLoadDemo} disabled={demoLoading} style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
                <FiRefreshCw size={15} /> {demoLoading ? "Reloading..." : "Reload Demo Data"}
              </button>
              <button className="save-settings-btn" onClick={handleClearDemo} disabled={demoLoading} style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
                <FiTrash2 size={15} /> {demoLoading ? "Clearing..." : "Clear Demo Data"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }
}
