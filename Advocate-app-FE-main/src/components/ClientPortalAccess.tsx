import { useEffect, useState } from "react";
import api from "../api/client";
import FieldError from "../components/FieldError";
import { emailError } from "../utils/validators";
import { Modal } from "../ui/overlays";
import { Button, Chip, Icon, type Tone } from "../ui/kit";
import { Field } from "../ui/forms";
import "../ui/pages/clients.css";

const STATUS: Record<string, [string, Tone]> = {
  ACTIVE: ["Active", "ok"],
  INVITED: ["Invite sent", "warn"],
  INVITE_EXPIRED: ["Invite expired", ""],
  DISABLED: ["Access off", ""],
};

const fmt = (d: any) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Never");

/** Firm-side: this client's logins (Client role) — create one, resend the set-password link, switch off. */
export default function ClientPortalAccess({ client, isOpen, onClose, toast, onChanged }: {
  client: any; isOpen: boolean; onClose: () => void; toast?: any; onChanged?: (accounts: any[]) => void;
}) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [email, setEmail] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastLink, setLastLink] = useState<any>(null);   // {url, emailSent, email}

  const load = () => api.get(`/api/clients/${client.id}/logins`)
    .then((r) => { setAccounts(r.data); onChanged?.(r.data); })
    .catch(() => toast?.error("Could not load the client logins."));

  useEffect(() => {
    if (!isOpen || !client) return;
    setEmail(client.email || ""); setName(""); setLastLink(null); setEmailTouched(false);
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
  const emailErr = emailTouched ? emailError(email) : "";
  return (
    <Modal open={isOpen} onClose={onClose} title="Client portal access" sub={client.name}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <div className="stack" style={{ gap: 18 }}>
        <p className="muted small">
          People you add sign in at the normal AMS login and see only this client&apos;s cases, hearings,
          invoices, payments and the documents you choose to share. Notes, tasks, other clients and every
          firm screen stay closed to them.
        </p>

        {accounts.length > 0 && (
          <div className="table-wrap">
            <table className="t">
              <thead><tr>
                <th scope="col">Login</th><th scope="col">Status</th><th scope="col" className="hide-sm">Last sign-in</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr></thead>
              <tbody>
                {accounts.map((a) => {
                  const [label, tone] = STATUS[a.status] || [a.status, "info" as Tone];
                  return (
                    <tr key={a.id}>
                      <td><div className="cell-title">{a.fullName || a.email}</div>{a.fullName && <div className="cell-sub">{a.email}</div>}</td>
                      <td><Chip tone={tone}>{label}</Chip></td>
                      <td className="hide-sm small muted">{fmt(a.lastLoginAt)}</td>
                      <td>
                        <div className="row wrap" style={{ gap: 6, justifyContent: "flex-end" }}>
                          {a.status !== "ACTIVE" && a.isActive && (
                            <Button size="sm" disabled={busy} onClick={() => invite(a.email, a.fullName)}>Resend link</Button>
                          )}
                          {a.isActive
                            ? <Button size="sm" variant="danger" onClick={() => setActive(a, false)}>Switch off</Button>
                            : <Button size="sm" onClick={() => setActive(a, true)}>Switch on</Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <form noValidate onSubmit={(e) => {
          e.preventDefault();
          if (emailError(email)) { setEmailTouched(true); return; }
          invite(email.trim(), name.trim());
        }}>
          <h3 style={{ fontSize: "var(--t-md)", marginBottom: 8 }}>Add a login</h3>
          <div className="cpa-add">
            <Field label="Email" required>
              {(id) => (
                <>
                  <input id={id} className="input" type="email" required value={email} aria-invalid={!!emailErr || undefined}
                    onChange={(e) => setEmail(e.target.value)} onBlur={() => setEmailTouched(true)} />
                  <FieldError error={emailErr} />
                </>
              )}
            </Field>
            <Field label="Name">
              {(id) => <input id={id} className="input" placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            <Button type="submit" variant="primary" icon="send" disabled={busy || !email.trim()} loading={busy}>
              {busy ? "Sending…" : "Create & send link"}
            </Button>
          </div>
        </form>

        {lastLink && (
          <div className="callout info">
            <Icon name="link" size="sm" />
            <div className="stack grow" style={{ gap: 8, minWidth: 0 }}>
              <span>
                {lastLink.emailSent ? `Emailed to ${lastLink.email}. ` : "Email could not be sent. "}
                You can also share this one-time set-password link (valid 72 hours):
              </span>
              <div className="row" style={{ gap: 6 }}>
                <input className="input grow mono xs" readOnly value={lastLink.url} onFocus={(e) => e.target.select()} aria-label="Invite link" />
                <Button size="sm" icon="copy" onClick={copy}>Copy</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
