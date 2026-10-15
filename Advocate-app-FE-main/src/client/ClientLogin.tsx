import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../contexts/ThemeContext";
import { AuthAlert, AuthFrame, PasswordField } from "../pages/Login";
import { usePortalBrand } from "./portalBrand";

/** /client/login: the client portal's own sign-in, with the firm's name and logo.
 *  Same login API as staff; a staff account is not signed in here but pointed to /login. */
export default function ClientLogin() {
  const brand = usePortalBrand();
  const { login } = useAuth();
  const { setTheme } = useTheme();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [staff, setStaff] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(""); setStaff(false);
    try {
      const { data }: any = await api.post("/api/advocates/login", { email, password });
      if (data.role !== "CLIENT") { setStaff(true); return; }
      login(data, email);
      setTheme(data.theme || "light");
      navigate("/client", { replace: true });
    } catch (err: any) {
      setError(err?.response?.data?.error || "Sign-in failed. Check your email and password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthFrame brand={brand}>
      <div className="pp-kicker">Client portal</div>
      <h1>Sign in</h1>
      <p className="muted auth-lead">
        Follow your cases with {brand?.name || "your advocate"}: hearing dates, documents and invoices.
      </p>
      <form onSubmit={submit} className="stack">
        {error && <AuthAlert>{error}</AuthAlert>}
        {staff && (
          <div className="callout info" role="status"><div>
            This page is for clients. Firm staff sign in at the <Link className="link" to="/login">staff sign-in page</Link>.
          </div></div>
        )}
        <div className="field">
          <label htmlFor="cp-email">Email <span className="req" aria-hidden="true">*</span></label>
          <input id="cp-email" className="input" type="email" autoComplete="username" required
            value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <PasswordField label="Password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="row between wrap">
          <span />
          <Link className="link small" to="/forgot-password">Forgot password?</Link>
        </div>
        <button type="submit" className={`btn primary pp-full${busy ? " loading" : ""}`} disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="small muted auth-foot">First time? Use the link in your invitation email to set your password.</p>
    </AuthFrame>
  );
}
