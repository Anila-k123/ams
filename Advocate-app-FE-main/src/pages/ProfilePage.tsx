// Settings: your profile, the office's details and branding (practice owner
// only), notifications, password and preferences. Sections sit on a left rail;
// ?tab=<id> opens one directly.
import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../api/client";
import { useTheme } from "../contexts/ThemeContext";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { useAuth } from "../context/AuthContext";
import FieldError from "../components/FieldError";
import { formatErrors, gstinError, gstinState, gstinStateMismatch, mobileInput, normaliseCode } from "../utils/validators";
import { PageHead, Button, Avatar, Icon, Skel, type IconName } from "../ui/kit";
import { Field, TextField, TextArea, SelectField, Switch } from "../ui/forms";
import "../ui/pages/firm.css";
import { confirm } from "../ui/overlays";

// Checked as you leave a field, and again on the server (core/validators.py).
const GEN_FORMATS = { phone: "phone" } as const;
const OFF_FORMATS = { officePhone: "landline", officeEmail: "email", pinCode: "pincode", gstNumber: "gstin", panNumber: "pan" } as const;

const PWD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&*!?_+=-])[A-Za-z\d@#$%^&*!?_+=-]{8,32}$/;

const TABS: { id: string; label: string; icon: IconName }[] = [
  { id: "general", label: "Profile", icon: "user" },
  { id: "office", label: "Office", icon: "home" },
  { id: "branding", label: "Branding", icon: "image" },
  { id: "notifications", label: "Notifications", icon: "bell" },
  { id: "security", label: "Security", icon: "lock" },
  { id: "preferences", label: "Preferences", icon: "cog" },
];

const opts = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
const GENDERS = opts([["male", "Male"], ["female", "Female"], ["other", "Other"]]);
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

const PWD_CHECKS = [
  { key: "length", label: "8–32 characters" },
  { key: "lowercase", label: "One lowercase letter" },
  { key: "uppercase", label: "One uppercase letter" },
  { key: "digit", label: "One digit" },
  { key: "special", label: "One symbol (@ # $ % ^ & * ! ? _ + -)" },
];

export default function ProfilePage() {
  const { setTheme: applyTheme } = useTheme() as any;
  const { withLoading } = useLoading() as any;
  const toast = useToast() as any;
  const { updateProfile } = useAuth();

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab") || "general";
  const setActiveTab = (id: string) => setSearchParams(id === "general" ? {} : { tab: id }, { replace: true });
  // Office details and branding feed the firm's invoices and letterheads, which
  // use the practice owner's profile - so only the owner is shown those tabs.
  const [isPracticeOwner, setIsPracticeOwner] = useState(false);
  const visibleTabs = TABS.filter((t) => isPracticeOwner || (t.id !== "office" && t.id !== "branding"));
  const activeTab = visibleTabs.some((t) => t.id === requestedTab) ? requestedTab : "general";
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const fetchProfile = async () => {
    try {
      const { data: d } = await api.get("/api/profile");
      setIsPracticeOwner(!!d.isPracticeOwner);
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
  const setOff = (name: string, value: any) => setOffice((p: any) => {
    // GST number and PAN are stored uppercase; a valid GST number also says
    // which state the office is registered in.
    if (name === "gstNumber" || name === "panNumber") value = normaliseCode(value);
    const next = { ...p, [name]: value };
    if (name === "gstNumber" && value && !gstinError(value)
        && (!p.state || p.state === gstinState(p.gstNumber))) next.state = gstinState(value);
    return next;
  });
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [triedSave, setTriedSave] = useState<Record<string, boolean>>({});
  const genErrs = formatErrors(general, GEN_FORMATS as any);
  const offErrs = formatErrors(office, OFF_FORMATS as any);
  const errFor = (section: "general" | "office", name: string) =>
    (touched[name] || triedSave[section] ? (section === "general" ? genErrs : offErrs)[name] : "") || "";
  // The server's own message (e.g. a format error it caught), else the fallback.
  const serverError = (err: any, fallback: string) => err?.response?.data?.error || fallback;
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
    if (Object.keys(genErrs).length) {
      setTriedSave((t) => ({ ...t, general: true }));
      toast.error("Fix the highlighted fields first.");
      return;
    }
    setSaving(true);
    try {
      const payload = { ...general, ...notifications };
      const res = await withLoading(api.put("/api/profile", payload), "Saving profile...");
      updateProfile({ fullName: res.data.fullName });
      toast.success("Profile updated");
    } catch (err: any) {
      toast.error(serverError(err, "Failed to save profile"));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveOffice = async () => {
    if (Object.keys(offErrs).length) {
      setTriedSave((t) => ({ ...t, office: true }));
      toast.error("Fix the highlighted fields first.");
      return;
    }
    setSaving(true);
    try {
      await withLoading(api.put("/api/profile", office), "Saving office info...");
      toast.success("Office information saved");
    } catch (err: any) {
      toast.error(serverError(err, "Failed to save office info"));
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
      // The top bar shows the photo too; tell the shell to refresh it now.
      window.dispatchEvent(new Event("profile-updated"));
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading((p: any) => ({ ...p, [target]: false }));
      setUploadTarget(null);
      e.target.value = "";
    }
  };

  // Remove an uploaded photo / logo / signature / seal (DELETE /api/profile/branding/{type}).
  const BRAND_URL: Record<string, string> = { photo: "profilePhotoUrl", logo: "officeLogoUrl", signature: "signatureUrl", seal: "officeSealUrl" };
  const BRAND_NAME: Record<string, string> = { photo: "your profile photo", logo: "the office logo", signature: "the advocate signature", seal: "the office seal" };
  const removeBranding = (target: string) => confirm({
    title: `Remove ${BRAND_NAME[target]}?`,
    message: target === "photo"
      ? "Your initials will show instead. You can upload a new photo at any time."
      : "It will no longer appear on new invoices, letters and reports. You can upload it again at any time.",
    confirmLabel: "Remove",
    danger: true,
    accept: async () => {
      try {
        await withLoading(api.delete(`/api/profile/branding/${target}`), "Removing...");
        setBranding((p: any) => ({ ...p, [BRAND_URL[target]]: "" }));
        window.dispatchEvent(new Event("profile-updated"));
        toast.success(target === "photo" ? "Profile photo removed." : "Removed.");
      } catch {
        toast.error("Could not remove it. Please try again.");
      }
    },
  });

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
      <div>
        <PageHead title="Settings" sub="Your profile, the firm's details and how AMS behaves for you." />
        <div className="split left-rail">
          <div className="panel" style={{ padding: 12 }}><Skel h={200} /></div>
          <div className="panel" style={{ padding: 20 }}><div className="stack"><Skel h={22} w="30%" /><Skel h={40} /><Skel h={40} /><Skel h={40} /></div></div>
        </div>
      </div>
    );
  }

  // The API speaks "YYYY-MM-DD"; a date input does too (slice drops any time part).
  const genText = (name: string, label: string, extra: Record<string, any> = {}) => (
    <Field label={label}>
      {(id) => (
        <>
          <input id={id} className="input" value={general[name] ?? ""} onChange={(e) => setGen(name, name === "phone" ? mobileInput(e.target.value) : e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, [name]: true }))} aria-invalid={!!errFor("general", name) || undefined} {...extra} />
          <FieldError error={errFor("general", name)} />
        </>
      )}
    </Field>
  );
  const offText = (name: string, label: string, extra: Record<string, any> = {}) => (
    <Field label={label} full={extra.full}>
      {(id) => (
        <>
          <input id={id} className={`input${extra.mono ? " mono" : ""}`} type={extra.type || "text"} placeholder={extra.placeholder}
            value={office[name] ?? ""} onChange={(e) => setOff(name, e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, [name]: true }))} aria-invalid={!!errFor("office", name) || undefined} />
          <FieldError error={errFor("office", name)}
            warning={name === "gstNumber" ? gstinStateMismatch(office.gstNumber, office.state) : undefined} />
        </>
      )}
    </Field>
  );
  const prefSelect = (name: string, label: string, options: any[]) => (
    <SelectField label={label} value={preferences[name]} options={options} onChange={(e) => setPref(name, e.target.value)} />
  );
  const saveRow = (label: string, onClick: () => void, extra: { disabled?: boolean; icon?: IconName } = {}) => (
    <div className="row full" style={{ justifyContent: "flex-end", marginTop: 4 }}>
      <Button variant="primary" icon={extra.icon} loading={saving} disabled={saving || extra.disabled} onClick={onClick}>{label}</Button>
    </div>
  );
  const head = (title: string, sub?: string) => (
    <div className="panel-head"><div><h3>{title}</h3>{sub && <div className="sub">{sub}</div>}</div></div>
  );

  function renderGeneral() {
    return (
      <section className="panel">
        {head("Profile", "Shown to colleagues and on documents you sign.")}
        <div className="panel-body">
          <div className="row" style={{ gap: 16, marginBottom: 20 }}>
            <Avatar name={general.fullName} src={branding.profilePhotoUrl || undefined} size="lg" />
            <div className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 6 }}>
                <Button size="sm" icon="upload" loading={uploading.photo} disabled={uploading.photo} onClick={() => triggerUpload("photo")}>
                  {branding.profilePhotoUrl ? "Change photo" : "Upload photo"}
                </Button>
                {branding.profilePhotoUrl && (
                  <Button size="sm" variant="danger" icon="trash" disabled={uploading.photo} onClick={() => removeBranding("photo")}>Remove photo</Button>
                )}
              </div>
              <span className="faint xs">Square JPG or PNG, at least 200 px.</span>
            </div>
          </div>
          <form className="form-grid" noValidate onSubmit={(e) => { e.preventDefault(); handleSaveGeneral(); }}>
            {genText("fullName", "Full name")}
            {genText("phone", "Mobile", { type: "tel", inputMode: "numeric", maxLength: 10, placeholder: "98765 43210", title: "10 digits, starting with 6, 7, 8 or 9." })}
            <TextField label="Date of birth" type="date" value={(general.dateOfBirth || "").slice(0, 10)} onChange={(e) => setGen("dateOfBirth", e.target.value)} />
            <SelectField label="Gender" value={general.gender} placeholder="Select" options={GENDERS} onChange={(e) => setGen("gender", e.target.value)} />
            <TextField label="Bar Council no." className="mono" value={general.barCouncilId ?? ""} disabled hint="Ask a Super Admin to change this." />
            <TextField label="Enrolment date" type="date" value={(general.enrollmentDate || "").slice(0, 10)} onChange={(e) => setGen("enrollmentDate", e.target.value)} />
            <TextField label="Experience (years)" type="number" min={0} value={general.experience} onChange={(e) => setGen("experience", Number(e.target.value) || 0)} />
            {genText("practiceAreas", "Practice areas", { placeholder: "e.g. Criminal, Civil, Corporate" })}
            <TextArea label="Address" full rows={2} value={general.address} onChange={(e) => setGen("address", e.target.value)} />
            <TextArea label="Short bio" full rows={3} value={general.bio} placeholder="Brief professional bio" onChange={(e) => setGen("bio", e.target.value)} />
            {saveRow("Save profile", handleSaveGeneral)}
          </form>
        </div>
      </section>
    );
  }

  function renderOffice() {
    return (
      <section className="panel">
        {head("Office", "Printed on invoices, letters and the client portal.")}
        <div className="panel-body">
          <form className="form-grid" noValidate onSubmit={(e) => { e.preventDefault(); handleSaveOffice(); }}>
            {offText("officeName", "Office name", { placeholder: "Your law firm / office", full: true })}
            {offText("officePhone", "Phone", { type: "tel" })}
            {offText("officeEmail", "Email", { type: "email" })}
            {offText("website", "Website", { placeholder: "https://" })}
            <TextArea label="Address" full rows={2} value={office.officeAddress} onChange={(e) => setOff("officeAddress", e.target.value)} />
            {offText("city", "City")}
            {offText("state", "State")}
            {offText("country", "Country")}
            {offText("pinCode", "PIN code", { placeholder: "6 digits" })}
            {offText("gstNumber", "GSTIN (optional)", { placeholder: "e.g. 33ABCDE1234F1Z7", mono: true })}
            {offText("panNumber", "PAN (optional)", { placeholder: "e.g. ABCDE1234F", mono: true })}
            {saveRow("Save office details", handleSaveOffice)}
          </form>
        </div>
      </section>
    );
  }

  function renderBranding() {
    const brandItems = [
      { key: "logo", label: "Office logo", hint: "PNG with a transparent background", url: branding.officeLogoUrl, uploading: uploading.logo },
      { key: "signature", label: "Advocate signature", hint: "Scan on white, 600 x 200 px", url: branding.signatureUrl, uploading: uploading.signature },
      { key: "seal", label: "Office seal (optional)", hint: "Round office seal", url: branding.officeSealUrl, uploading: uploading.seal },
    ];
    const swatch = (field: string, label: string) => (
      <label className="pp-swatch">
        <input type="color" value={branding[field]} onChange={(e) => setColor(field, e.target.value)} aria-label={`${label} colour`} />
        <span className="small">{label}<br />
          <input className="input mono xs fm-hex" value={branding[field]} onChange={(e) => setColor(field, e.target.value)} aria-label={`${label} colour code`} />
        </span>
      </label>
    );
    return (
      <section className="panel">
        {head("Branding", "Used in emails, PDFs, invoices and reports.")}
        <div className="panel-body stack" style={{ gap: 20 }}>
          <div className="pp-tiles">
            {brandItems.map((item) => (
              <div key={item.key} className="pp-tile">
                <div className="pv">
                  {item.url
                    ? <img src={item.url} alt={item.label} className="fm-tile-img" />
                    : <span><Icon name="image" size="lg" /><br />Nothing uploaded</span>}
                </div>
                <div className="bd">
                  <b className="small">{item.label}</b>
                  <span className="faint xs">{item.hint}</span>
                  <div className="row" style={{ gap: 6 }}>
                    <Button size="sm" icon="upload" loading={item.uploading} disabled={item.uploading} onClick={() => triggerUpload(item.key)}
                      aria-label={`${item.url ? "Replace" : "Upload"} ${item.label.toLowerCase()}`}>{item.url ? "Replace" : "Upload"}</Button>
                    {item.url && (
                      <Button size="sm" variant="ghost" icon="trash" disabled={item.uploading} onClick={() => removeBranding(item.key)}
                        aria-label={`Remove ${item.label.toLowerCase()}`}>Remove</Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div>
            <div className="label" style={{ marginBottom: 10 }}>Brand colours</div>
            <div className="row wrap" style={{ gap: 24 }}>
              {swatch("primaryBrandColor", "Primary")}
              {swatch("secondaryBrandColor", "Secondary")}
            </div>
          </div>
          {saveRow("Save branding", saveBrandColors)}
        </div>
      </section>
    );
  }

  function renderNotifications() {
    const items: [string, string, string][] = [
      ["browserNotificationsEnabled", "Browser notifications", "Hearing alerts and review requests while AMS is open."],
      ["emailNotificationsEnabled", "Email", "Hearing digests and anything needing your review."],
      ["whatsappEnabled", "WhatsApp", "Messages on WhatsApp, when the firm's channel is connected."],
    ];
    return (
      <section className="panel">
        {head("Notifications", "How AMS reaches you. Changes save as you switch them.")}
        <div className="panel-body flush">
          <div className="list">
            {items.map(([name, label, desc]) => (
              <div key={name} className="list-item">
                <div className="grow"><b className="small">{label}</b><div className="faint xs">{desc}</div></div>
                <Switch checked={!!notifications[name]} onChange={(e) => handleNotificationChange(name, e.target.checked)}
                  label={<span className="sr-only">{label}</span>} />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  function renderSecurity() {
    const mismatch = !!security.confirmNewPassword && security.confirmNewPassword !== security.newPassword;
    return (
      <section className="panel">
        {head("Change password", "Use 8 to 32 characters with a mix of letters, numbers and symbols.")}
        <div className="panel-body">
          <form className="stack" noValidate style={{ maxWidth: 440 }} onSubmit={(e) => { e.preventDefault(); handleSaveSecurity(); }}>
            <TextField label="Current password" type="password" autoComplete="current-password" value={security.currentPassword}
              onChange={(e) => setSec("currentPassword", e.target.value)} />
            <TextField label="New password" type="password" autoComplete="new-password" value={security.newPassword}
              onChange={(e) => setSec("newPassword", e.target.value)} />
            {security.newPassword && (
              <div className="pw-rules" aria-live="polite">
                {PWD_CHECKS.map((c) => {
                  const ok = !pwdErrors[c.key];
                  return <span key={c.key} className={ok ? "ok" : undefined}><Icon name={ok ? "ok" : "minus"} size="sm" /> {c.label}</span>;
                })}
              </div>
            )}
            <TextField label="Confirm new password" type="password" autoComplete="new-password" value={security.confirmNewPassword}
              onChange={(e) => setSec("confirmNewPassword", e.target.value)} error={mismatch ? "Passwords do not match." : null} />
            <div>
              <Button type="submit" variant="primary" icon="lock" loading={saving}
                disabled={saving || !security.currentPassword || !security.newPassword}>Change password</Button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  function renderPreferences() {
    const themes: [string, string, string, string][] = [
      ["light", "Light", "#F2F3F0", "#FFFFFF"],
      ["dark", "Dark", "#13161C", "#1A1E25"],
    ];
    return (
      <section className="panel">
        {head("Preferences")}
        <div className="panel-body">
          <form className="stack" noValidate style={{ gap: 20 }} onSubmit={(e) => { e.preventDefault(); handleSavePreferences(); }}>
            <fieldset className="fm-fieldset">
              <legend className="label" style={{ marginBottom: 10 }}>Theme</legend>
              <div className="pp-radio-cards fm-two">
                {themes.map(([v, label, a, b]) => (
                  <label key={v}>
                    {/* Theme previews show the actual palette, so these two colours are literal on purpose. */}
                    <span className="sw" aria-hidden="true"><span style={{ flex: 1, background: a }} /><span style={{ flex: 1, background: b }} /></span>
                    <span className="row"><input type="radio" name="theme" value={v} checked={preferences.theme === v}
                      onChange={() => { setPref("theme", v); applyTheme(v); }} />{label}</span>
                  </label>
                ))}
              </div>
              <div className="faint xs" style={{ marginTop: 6 }}>Applies straight away on this device; save to keep it on your account.</div>
            </fieldset>
            <div className="form-grid">
              {prefSelect("language", "Language", LANGUAGES)}
              {prefSelect("timeZone", "Time zone", TIMEZONES)}
              {prefSelect("currency", "Currency", CURRENCIES)}
              {prefSelect("dateFormat", "Date format", DATE_FORMATS)}
              <TextField label="Sign out after inactivity (minutes)" type="number" min={5} max={480} value={preferences.autoLogoutDuration}
                hint="Between 5 and 480 minutes." onChange={(e) => setPref("autoLogoutDuration", e.target.value === "" ? 30 : Number(e.target.value))} />
              {prefSelect("defaultDashboardFilter", "Default dashboard period", DASH_FILTERS)}
            </div>
            {saveRow("Save preferences", handleSavePreferences)}
          </form>
        </div>
      </section>
    );
  }

  return (
    <div>
      <PageHead title="Settings" sub="Your profile, the firm's details and how AMS behaves for you." />
      <div className="split left-rail">
        <div className="panel rail">
          <div className="pp-vtabs" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
            {visibleTabs.map((tab) => (
              <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
                <Icon name={tab.icon} size="sm" />{tab.label}
              </button>
            ))}
          </div>
        </div>
        <div role="tabpanel" style={{ minWidth: 0 }}>
          {activeTab === "general" && renderGeneral()}
          {activeTab === "office" && isPracticeOwner && renderOffice()}
          {activeTab === "branding" && isPracticeOwner && renderBranding()}
          {activeTab === "notifications" && renderNotifications()}
          {activeTab === "security" && renderSecurity()}
          {activeTab === "preferences" && renderPreferences()}
        </div>
      </div>
      <input ref={fileInputRef} type="file" accept="image/*" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={handleFileUpload} />
    </div>
  );
}
