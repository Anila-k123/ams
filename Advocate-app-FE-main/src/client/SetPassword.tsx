import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiUrl } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { Check } from "../ui/forms";
import { AuthAlert, AuthFrame } from "../pages/Login";

/** /set-password?token= — a client sets their password from the emailed one-time link,
 *  then is signed in exactly as by the normal login. */
export default function SetPassword() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError("The two passwords don't match."); return; }
    setBusy(true); setError("");
    try {
      const res = await fetch(apiUrl("/api/client-auth/set-password"), {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not set the password.");
      login({ ...data, role: data.role || "CLIENT", fullName: data.fullName || "" }, data.email);
      navigate("/dashboard", { replace: true });   // also drops the one-time token from history
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame>
      <div className="pp-kicker">Client portal invitation</div>
      <h1>Set your password</h1>
      <p className="muted auth-lead">Your advocate has created a login for you to follow your cases: hearing dates, documents and invoices.</p>
      <form className="stack" onSubmit={submit}>
        {!token && <AuthAlert>This link is incomplete. Open it from your email again.</AuthAlert>}
        {error && <AuthAlert>{error}</AuthAlert>}
        <div className="field">
          <label htmlFor="cl-new-password">New password <span className="req" aria-hidden="true">*</span></label>
          <input id="cl-new-password" className="input" type={show ? "text" : "password"} autoComplete="new-password" minLength={8}
            required value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby="cl-new-hint" />
          <span className="hint" id="cl-new-hint">At least 8 characters.</span>
        </div>
        <div className="field">
          <label htmlFor="cl-confirm-password">Confirm password <span className="req" aria-hidden="true">*</span></label>
          <input id="cl-confirm-password" className="input" type={show ? "text" : "password"} autoComplete="new-password" minLength={8}
            required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <Check label="Show password" checked={show} onChange={(e) => setShow(e.target.checked)} />
        <button type="submit" className={`btn primary pp-full${busy ? " loading" : ""}`} disabled={busy || !token}>
          {busy ? "Saving…" : "Set password and open portal"}
        </button>
      </form>
    </AuthFrame>
  );
}
