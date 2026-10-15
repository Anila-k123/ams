import '../ui/pages/auth.css';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useId, useState, type ReactNode, type InputHTMLAttributes } from 'react';
import api, { apiUrl } from '../api/client';
import { useTheme } from '../contexts/ThemeContext';
import { useLoading } from '../contexts/LoadingContext';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../ui/kit';
import BrandLogo from '../ui/BrandLogo';

/* Shared by the sign-in flow pages (forgot, verify, reset, set-password). */

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button type="button" className="icon-btn" onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}

// Two-column frame: ink art panel with the red tape strand, form on paper.
// `brand` (the client portal) puts the firm's own name and logo in place of PactPro's.
export function AuthFrame({ children, brand }: { children: ReactNode; brand?: { name: string; logoUrl: string | null } | null }) {
  const mark = brand?.logoUrl
    ? <img className="pp-brand-logo" src={apiUrl(brand.logoUrl)} alt="" />
    : <span className="seal" aria-hidden="true">{brand ? brand.name.trim()[0]?.toUpperCase() : 'P'}</span>;
  return (
    <div className="auth">
      <aside className="auth-art">
        <span className="tape-strand" aria-hidden="true" />
        <div className="pp-art-brand">
          {/* The client portal shows the firm's own name and logo; everywhere else PactPro's logo. */}
          {brand ? <>{mark}<div><b>{brand.name}</b><small>Client portal</small></div></> : <BrandLogo />}
        </div>
        <div className="pp-art-mid">
          <div className="rule" aria-hidden="true" />
          <blockquote>The Smarter Way to Manage Your Legal Practice.</blockquote>
        </div>
        <div className="pp-art-foot"><span>{brand ? 'Client portal, powered by PactPro' : 'Advocate Management System'}</span><span>Madras High Court and subordinate courts</span></div>
      </aside>
      <main className="auth-form">
        <div className="pp-auth-tools"><ThemeToggle /></div>
        <div className="auth-card">
          <div className="pp-mobile-brand">{brand ? <>{mark}<b>{brand.name}</b></> : <BrandLogo />}</div>
          {children}
        </div>
      </main>
    </div>
  );
}

// Password input with a show/hide toggle.
export function PasswordField({ label, error, ...rest }: { label: ReactNode; error?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      <label htmlFor={id}>{label}{rest.required && <span className="req" aria-hidden="true"> *</span>}</label>
      <div className="pp-pw">
        <input id={id} className="input" type={show ? 'text' : 'password'} aria-invalid={!!error || undefined} {...rest} />
        <button type="button" className="btn ghost sm icon" aria-pressed={show}
          aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((s) => !s)}>
          <Icon name="eye" size="sm" />
        </button>
      </div>
      {error && <span className="err" role="alert"><Icon name="warn" size="sm" />{error}</span>}
    </div>
  );
}

export function AuthAlert({ children }: { children: ReactNode }) {
  return <div className="callout bad" role="alert"><Icon name="warn" /><div>{children}</div></div>;
}

function LoginModule() {
  const { setTheme: applyTheme } = useTheme();
  const { withLoading } = useLoading() as any;
  const { success, error } = useToast() as any;
  const { login } = useAuth();
  const navigate = useNavigate();
  // Arriving from an accepted invitation: say so and pre-fill the email.
  const arrived = (useLocation().state || {}) as { notice?: string; email?: string };
  const [formData, setFormData] = useState({ email: arrived.email || '', password: '' });
  const [buttonLoading, setButtonLoading] = useState(false);

  function handleChange(e: any) {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e: any) {
    e.preventDefault();
    setButtonLoading(true);
    try {
      const response: any = await withLoading(api.post('/api/advocates/login', formData), 'Logging in...');
      if (response.data.token) {
        login(response.data, formData.email);
        applyTheme(response.data.theme || 'light');
        success('Login successful!');
        // A client who used the staff page still lands in their portal.
        navigate(response.data.role === 'CLIENT' ? '/client' : '/dashboard');
      } else {
        error(response.data.error || 'Login failed!');
      }
    } catch (err: any) {
      // The server's own sentence when it sent one: "Invalid email or password!",
      // "This account is no longer active." or the lockout's "Try again in N minutes."
      error(err?.response?.data?.error || 'Login failed! Please check your credentials or try again.');
    } finally {
      setButtonLoading(false);
    }
  }

  return (
    <AuthFrame>
      <div className="pp-kicker">Advocate Management System</div>
      <h1>Sign in</h1>
      <p className="muted auth-lead">Use the email your firm admin created for you.</p>
      <form onSubmit={handleSubmit} className="stack">
        {arrived.notice && <div className="callout info" role="status"><div>{arrived.notice}</div></div>}
        <div className="field">
          <label htmlFor="l-email">Email <span className="req" aria-hidden="true">*</span></label>
          <input id="l-email" className="input" type="email" name="email" autoComplete="username"
            value={formData.email} onChange={handleChange} required />
        </div>
        <PasswordField label="Password" name="password" autoComplete="current-password"
          value={formData.password} onChange={handleChange} required />
        <div className="row between wrap">
          <span />
          <Link className="link small" to="/forgot-password">Forgot password?</Link>
        </div>
        <button type="submit" className={`btn primary pp-full${buttonLoading ? ' loading' : ''}`} disabled={buttonLoading}>
          {buttonLoading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="small muted auth-foot">Client? <Link className="link" to="/client/login">Sign in to the client portal</Link>. <Link className="link" to="/">Back to home</Link></p>
    </AuthFrame>
  );
}

export default LoginModule;
