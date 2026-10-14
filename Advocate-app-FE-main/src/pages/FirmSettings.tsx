// Firm Settings: the firm's name, contact, tax ids, branding and logo
// (firms.FirmSettings via /api/firm/settings). Needs SETTINGS_EDIT.
import { useEffect, useRef, useState } from "react";
import api, { apiUrl, errorMessage } from "../api/client";
import { useToast } from "../contexts/ToastContext";
import { Button, PageHead, Panel, Skel } from "../ui/kit";
import { SelectField, TextArea, TextField } from "../ui/forms";
import { confirm } from "../ui/overlays";
import { emailError, gstinError, panError, pincodeError } from "../utils/validators";

type Settings = Record<string, any>;

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LOGO_MAX = 2 * 1024 * 1024;

/** Tell the shell (Dashboard) to re-read the firm name and logo. */
const announce = () => window.dispatchEvent(new Event("firm-settings-changed"));

export default function FirmSettings() {
  const { success, error } = useToast() as any;
  const [s, setS] = useState<Settings | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.get("/api/firm/settings").then((r) => setS(r.data)).catch((e) => error(errorMessage(e, "Couldn't load firm settings.")));
  }, [error]);

  if (!s) return <div className="stack"><Skel h={28} w="40%" /><Skel h={200} /></div>;

  const set = (k: string, v: any) => setS({ ...s, [k]: v });
  const field = (k: string, label: string, extra: Record<string, any> = {}) => (
    <TextField label={label} value={s[k] ?? ""} onChange={(e) => set(k, e.target.value)} error={errors[k] || null} {...extra} />
  );

  const validate = () => {
    const e: Record<string, string> = {};
    if (!String(s.displayName || "").trim()) e.displayName = "Give the firm a display name.";
    const pairs: [string, (v: string) => string][] = [["officeEmail", emailError], ["gstNumber", gstinError], ["panNumber", panError], ["pinCode", pincodeError]];
    for (const [k, fn] of pairs) { const m = fn(s[k] || ""); if (m) e[k] = m; }
    setErrors(e);
    return !Object.keys(e).length;
  };

  const save = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const r = await api.put("/api/firm/settings", s);
      setS(r.data); setErrors({});
      success("Firm settings saved.");
      announce();
    } catch (e: any) {
      setErrors(e?.response?.data?.errors || {});
      error(errorMessage(e, "Couldn't save the settings."));
    } finally {
      setSaving(false);
    }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type) || file.size > LOGO_MAX) { error("Use a PNG, JPEG or WebP image of at most 2 MB."); return; }
    const fd = new FormData();
    fd.append("file", file);
    setUploading(true);
    try {
      const r = await api.post("/api/firm/settings/logo", fd);
      setS(r.data); success("Logo updated."); announce();
    } catch (e) {
      error(errorMessage(e, "Couldn't upload the logo."));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeLogo = () => confirm({
    title: "Remove the logo?", message: "The sidebar goes back to the AMS mark.", confirmLabel: "Remove logo", danger: true,
    accept: async () => {
      try { const r = await api.delete("/api/firm/settings/logo"); setS(r.data); success("Logo removed."); announce(); }
      catch (e) { error(errorMessage(e, "Couldn't remove the logo.")); }
    },
  });

  return (
    <div>
      <PageHead title="Firm Settings" sub={<>How {s.name} appears in AMS, on invoices and to clients.</>} />
      <form className="stack" onSubmit={save} noValidate style={{ maxWidth: 860 }}>
        <Panel title="Identity">
          <div className="form-grid">
            {field("displayName", "Display name", { required: true })}
            <TextField label="Registered name" value={s.name} disabled hint="Set by the AMS operator." />
          </div>
        </Panel>
        <Panel title="Logo" sub="PNG, JPEG or WebP, at most 2 MB. Shown in the sidebar and the client portal.">
          <div className="row" style={{ gap: 16, alignItems: "center" }}>
            {s.logoUrl
              ? <img src={apiUrl(s.logoUrl)} alt={`${s.displayName} logo`} style={{ height: 56, maxWidth: 200, objectFit: "contain", background: "#fff", borderRadius: 8, padding: 4, border: "1px solid var(--line)" }} />
              : <span className="muted small">No logo yet.</span>}
            <input ref={fileRef} type="file" accept={LOGO_TYPES.join(",")} hidden aria-label="Logo file" onChange={(e) => upload(e.target.files?.[0])} />
            <Button loading={uploading} onClick={() => fileRef.current?.click()}>{s.logoUrl ? "Replace logo" : "Upload logo"}</Button>
            {s.logoUrl && <Button variant="ghost" className="danger" onClick={removeLogo}>Remove</Button>}
          </div>
        </Panel>
        <Panel title="Office and contact">
          <div className="form-grid">
            <TextArea label="Office address" value={s.officeAddress ?? ""} onChange={(e) => set("officeAddress", e.target.value)} full rows={2} />
            {field("city", "City")}
            {field("state", "State")}
            {field("country", "Country")}
            {field("pinCode", "PIN code", { inputMode: "numeric", maxLength: 6 })}
            {field("officePhone", "Office phone")}
            {field("officeEmail", "Office email", { type: "email" })}
            {field("website", "Website")}
          </div>
        </Panel>
        <Panel title="Tax and invoicing">
          <div className="form-grid">
            {field("gstNumber", "GSTIN", { maxLength: 15 })}
            {field("panNumber", "PAN", { maxLength: 10 })}
            {field("invoicePrefix", "Invoice number prefix", { maxLength: 20 })}
            <SelectField label="Invoice numbering" value={s.invoiceFyReset ? "1" : "0"} onChange={(e) => set("invoiceFyReset", e.target.value === "1")}
              options={[{ value: "1", label: "Restart each financial year" }, { value: "0", label: "Continuous" }]} />
          </div>
        </Panel>
        <Panel title="Regional">
          <div className="form-grid">
            {field("timeZone", "Time zone")}
            {field("currency", "Currency", { maxLength: 3 })}
            {field("dateFormat", "Date format")}
            {field("primaryBrandColor", "Brand colour", { type: "color", style: { height: 40, padding: 4 } })}
          </div>
        </Panel>
        <div><Button type="submit" variant="primary" loading={saving}>Save settings</Button></div>
      </form>
    </div>
  );
}
