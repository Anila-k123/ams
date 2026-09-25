import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { InputText } from "primereact/inputtext";
import { Checkbox } from "primereact/checkbox";
import { Button } from "primereact/button";
import { Message } from "primereact/message";
import { apiUrl } from "../api/client";
import { useAuth } from "../context/AuthContext";
import "./client.css";

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
    <div className="cl-auth">
      <div className="cl-auth-card">
        <div className="cl-auth-brand">Welcome</div>
        <h1>Set your password</h1>
        <p className="cl-muted">Your advocate has created a login for you to follow your cases.</p>
        <form className="flex flex-column gap-2" onSubmit={submit}>
          {!token && <Message severity="error" text="This link is incomplete. Open it from your email again." />}
          {error && <Message severity="error" text={error} />}
          <label htmlFor="cl-new-password">New password (at least 8 characters)</label>
          <InputText id="cl-new-password" type={show ? "text" : "password"} autoComplete="new-password" minLength={8}
            required value={password} onChange={(e) => setPassword(e.target.value)} />
          <label htmlFor="cl-confirm-password">Confirm password</label>
          <InputText id="cl-confirm-password" type={show ? "text" : "password"} autoComplete="new-password" minLength={8}
            required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <div className="flex align-items-center gap-2">
            <Checkbox inputId="cl-show" checked={show} onChange={(e) => setShow(!!e.checked)} />
            <label htmlFor="cl-show">Show password</label>
          </div>
          <Button type="submit" label={busy ? "Saving…" : "Save and sign in"} loading={busy} disabled={busy || !token} />
        </form>
      </div>
    </div>
  );
}
