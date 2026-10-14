import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiUrl } from "../api/client";
import { Check } from "../ui/forms";
import { AuthAlert, AuthFrame } from "./Login";

type Preview = { firm: string; email: string; kind: string; newAccount: boolean };

// What a link that can't be used any more says (firms/invitations.py codes).
export const LINK_STATES: Record<string, { title: string; text: string }> = {
  EXPIRED: { title: "This invitation has expired", text: "Ask the firm's administrator to send you a new invitation." },
  REVOKED: { title: "This invitation was withdrawn", text: "The firm cancelled it. Contact the firm if you think this is a mistake." },
  ACCEPTED: { title: "This invitation was already used", text: "You have joined the firm. Sign in with your email and password." },
  INVALID: { title: "This link is not valid", text: "Open the link from your invitation email again, or ask the firm for a new invitation." },
  FIRM_UNAVAILABLE: { title: "This firm is not accepting members", text: "The firm's account is not active right now. Contact the firm." },
};

/** /accept-invite?token= — accept an invitation to a firm (its first administrator,
 *  or staff invited by the firm's administrator). A new account chooses its
 *  password here; an existing AMS login confirms with its current password
 *  (firms/invitations.py), so an invitation can't take over an account.
 *  Accepting does not sign in: the person goes to the normal login page. */
export default function AcceptInvite() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [linkState, setLinkState] = useState<string>(token ? "" : "INVALID");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    // POST, so the one-time token stays out of server access logs.
    fetch(apiUrl("/api/invitations/preview"), {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setLinkState(data.code in LINK_STATES ? data.code : "INVALID"); return; }
        setPreview(data);
      })
      .catch(() => setError("Couldn't reach AMS. Check your connection and reload the page."));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (preview?.newAccount && password.length < 8) { setError("Choose a password of at least 8 characters."); return; }
    if (preview?.newAccount && password !== confirm) { setError("The two passwords don't match."); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch(apiUrl("/api/invitations/accept"), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password, fullName }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code in LINK_STATES) { setLinkState(data.code); return; }
        throw new Error(data.error || "Could not accept the invitation.");
      }
      // replace: drops the one-time token from history
      navigate("/login", { replace: true, state: { notice: `You have joined ${preview?.firm}. Sign in to continue.`, email: preview?.email } });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (linkState) {
    const st = LINK_STATES[linkState];
    return (
      <AuthFrame>
        <div className="pp-kicker">Invitation</div>
        <h1>{st.title}</h1>
        <p className="muted auth-lead" role="alert">{st.text}</p>
        <Link className="btn primary pp-full" to="/login">Go to sign-in</Link>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <div className="pp-kicker">{preview?.kind === "FIRM_ADMIN" ? "Firm administrator invitation" : "Invitation"}</div>
      <h1>{preview ? `Join ${preview.firm}` : "Accept invitation"}</h1>
      {preview && (
        <p className="muted auth-lead">
          {preview.newAccount ? `Set up your AMS account for ${preview.email}.`
            : `${preview.email} already has an AMS account. Confirm with its current password to join.`}
        </p>
      )}
      <form className="stack" onSubmit={submit} noValidate>
        {error && <AuthAlert>{error}</AuthAlert>}
        {preview?.newAccount && (
          <div className="field">
            <label htmlFor="inv-name">Your name</label>
            <input id="inv-name" className="input" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
        )}
        <div className="field">
          <label htmlFor="inv-password">
            {preview?.newAccount ? "Choose a password" : "Your current AMS password"} <span className="req" aria-hidden="true">*</span>
          </label>
          <input id="inv-password" className="input" type={show ? "text" : "password"} required minLength={8}
            autoComplete={preview?.newAccount ? "new-password" : "current-password"}
            value={password} onChange={(e) => setPassword(e.target.value)} />
          {preview?.newAccount && <span className="hint">At least 8 characters.</span>}
        </div>
        {preview?.newAccount && (
          <div className="field">
            <label htmlFor="inv-confirm">Confirm password <span className="req" aria-hidden="true">*</span></label>
            <input id="inv-confirm" className="input" type={show ? "text" : "password"} required minLength={8}
              autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </div>
        )}
        <Check label="Show password" checked={show} onChange={(e) => setShow(e.target.checked)} />
        <button type="submit" className={`btn primary pp-full${busy ? " loading" : ""}`} disabled={busy || !preview || !password}>
          {busy ? "Joining…" : "Accept invitation"}
        </button>
      </form>
    </AuthFrame>
  );
}
