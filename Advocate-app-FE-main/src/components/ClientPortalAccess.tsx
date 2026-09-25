import { useEffect, useState } from "react";
import { Dialog } from "primereact/dialog";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import api from "../api/client";
import "../assets/styles/ClientPortalAccess.css";

const STATUS: Record<string, [string, any]> = {
  ACTIVE: ["Active", "success"],
  INVITED: ["Invite sent", "warning"],
  INVITE_EXPIRED: ["Invite expired", "secondary"],
  DISABLED: ["Access off", "secondary"],
};

const fmt = (d: any) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

/** Firm-side: this client's logins (Client role) — create one, resend the set-password link, switch off. */
export default function ClientPortalAccess({ client, isOpen, onClose, toast }: { client: any; isOpen: boolean; onClose: () => void; toast?: any }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState<any>(null);   // {url, emailSent, email}

  const load = () => api.get(`/api/clients/${client.id}/logins`)
    .then((r) => setAccounts(r.data)).catch(() => toast?.error("Could not load the client logins."));

  useEffect(() => {
    if (!isOpen || !client) return;
    setEmail(client.email || ""); setName(""); setLastLink(null);
    load();
  }, [isOpen, client?.id]);  // eslint-disable-line react-hooks/exhaustive-deps

  const invite = async (toEmail: string, fullName: string) => {
    setBusy(true);
    try {
      const r = await api.post(`/api/clients/${client.id}/logins`, { email: toEmail, fullName });
      setLastLink({ url: r.data.inviteUrl, emailSent: r.data.emailSent, email: r.data.email });
      if (r.data.emailSent) toast?.success(`Set-password link emailed to ${r.data.email}.`);
      else toast?.warning("Email could not be sent — copy the link below and share it with the client.");
      load();
    } catch (err: any) {
      toast?.error(err.response?.data?.error || "Could not send the invite.");
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (a: any, isActive: boolean) => {
    try {
      await api.patch(`/api/clients/${client.id}/logins/${a.id}`, { isActive });
      toast?.success(isActive ? "Login switched on." : "Login switched off.");
      load();
    } catch (err: any) {
      toast?.error(err.response?.data?.error || "Could not update access.");
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(lastLink.url); toast?.success("Link copied."); }
    catch { toast?.error("Could not copy — select the link and copy it."); }
  };

  if (!client) return null;
  return (
    <Dialog visible={isOpen} onHide={onClose} header={`Client logins — ${client.name}`} style={{ width: "min(680px, 95vw)" }} modal>
      <div className="cpa flex flex-column gap-3">
        <p className="cpa-muted">
          People you add sign in at the normal AMS login and see only this client's cases, hearings,
          invoices, payments and the documents you choose to share. Notes, tasks, other clients and every
          firm screen stay closed to them.
        </p>

        {accounts.length > 0 && (
          <DataTable value={accounts} dataKey="id" size="small">
            <Column header="Person" body={(a) => (<><div className="cpa-strong">{a.fullName || a.email}</div>{a.fullName && <div className="cpa-muted">{a.email}</div>}</>)} />
            <Column header="Status" body={(a) => { const [label, sev] = STATUS[a.status] || [a.status, "info"]; return <Tag value={label} severity={sev} rounded />; }} />
            <Column header="Last sign-in" body={(a) => <span className="cpa-muted">{fmt(a.lastLoginAt)}</span>} />
            <Column body={(a) => (
              <div className="flex gap-2 justify-content-end">
                {a.status !== "ACTIVE" && a.isActive && (
                  <Button size="small" outlined label="Resend link" disabled={busy} onClick={() => invite(a.email, a.fullName)} />
                )}
                {a.isActive
                  ? <Button size="small" outlined severity="danger" label="Switch off" onClick={() => setActive(a, false)} />
                  : <Button size="small" outlined label="Switch on" onClick={() => setActive(a, true)} />}
              </div>
            )} />
          </DataTable>
        )}

        <form className="flex flex-column gap-2" onSubmit={(e) => { e.preventDefault(); invite(email.trim(), name.trim()); }}>
          <div className="cpa-strong">Add a login</div>
          <div className="flex gap-2 flex-wrap">
            <InputText className="flex-1" style={{ minWidth: 160 }} type="email" required placeholder="Email" value={email}
              onChange={(e) => setEmail(e.target.value)} aria-label="Email to invite" />
            <InputText className="flex-1" style={{ minWidth: 160 }} placeholder="Name (optional)" value={name}
              onChange={(e) => setName(e.target.value)} aria-label="Name of the person" />
            <Button type="submit" label={busy ? "Sending…" : "Create & send link"} disabled={busy || !email.trim()} />
          </div>
        </form>

        {lastLink && (
          <div className="flex flex-column gap-2">
            <div className="cpa-muted">
              {lastLink.emailSent ? `Emailed to ${lastLink.email}. ` : "Email could not be sent. "}
              You can also share this one-time set-password link (valid 72 hours):
            </div>
            <div className="flex gap-2 flex-wrap">
              <InputText className="flex-1" readOnly value={lastLink.url} onFocus={(e) => e.target.select()} aria-label="Invite link" />
              <Button type="button" outlined icon="pi pi-copy" label="Copy" onClick={copy} />
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
