import '../ui/pages/auth.css';
import '../ui/pages/login.css';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useId, useState, type ReactNode, type InputHTMLAttributes } from 'react';
import api from '../api/client';
import { useTheme } from '../contexts/ThemeContext';
import { useLoading } from '../contexts/LoadingContext';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../ui/kit';
import logo from '../assets/images/pactpro-logo.webp';

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

// What PactPro does, on the hero. Icons are drawn here (two-tone: white
// outline, red detail) so they match the approved design.
const FEATURES: { title: string; text: string; icon: ReactNode }[] = [
  { title: 'Case Management', text: 'Organize and track your cases with ease.',
    icon: <><path className="r" d="M3 7h6l2 2h10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path className="w" d="M3 7V5a1 1 0 0 1 1-1h5l2 3" /></> },
  { title: 'Hearings & Schedule', text: 'Never miss a hearing or important date.',
    icon: <><rect className="w" x="3" y="5" width="18" height="16" rx="2" /><path className="w" d="M7 3v4M17 3v4M3 10h18" /><path className="r" d="M8 14h2M14 14h2M8 17h2M14 17h2" /></> },
  { title: 'AI Legal Drafting', text: 'Create professional legal drafts in seconds.',
    icon: <><path className="w" d="M5 4h10l4 4v12H5z" /><path className="r" d="m9 16 7-7 2 2-7 7-3 1z" /></> },
  { title: 'AI Document Summarization', text: 'Get concise insights from long documents.',
    icon: <><path className="w" d="M6 3h9l4 4v14H6zM15 3v4h4" /><path className="r" d="M9 11h7M9 14h7M9 17h5" /></> },
  { title: 'Client Management', text: 'Manage your clients and communications.',
    icon: <><circle className="w" cx="12" cy="8" r="3.2" /><path className="r" d="M5 20a7 7 0 0 1 14 0" /><path className="w" d="M4 11a2.4 2.4 0 1 1 1-4.6M20 11a2.4 2.4 0 1 0-1-4.6" /></> },
  { title: 'AI Assistant', text: 'Get instant answers to your legal queries.',
    icon: <><rect className="w" x="4" y="7" width="16" height="12" rx="4" /><path className="r" d="M12 3v4M9 12h.01M15 12h.01M9.5 15.5c1.6 1 3.4 1 5 0" /></> },
  { title: 'Invoices & Payments', text: 'Generate invoices and track payments.',
    icon: <><path className="w" d="M6 3h9l4 4v14H6zM15 3v4h4" /><path className="r" d="M10 10h5M10 12.5h5M13 10c1.5 0 1.5 2.5 0 2.5h-2.5l3.5 4" /></> },
  { title: 'Reports & Analytics', text: 'Gain insights and grow your practice.',
    icon: <><path className="w" d="M3 21h18" /><path className="r" d="M6 17v-4M11 17V9M16 17V5" /><path className="w" d="M4 17h3v-4H4zM9 17h3V9H9zM14 17h3V5h-3z" /></> },
];

// Sign-in frame: navy hero (what PactPro does) beside the sign-in card.
// login.css draws the diagonal, the red band and the photo.
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="lg-auth">
      <span className="lg-hero-bg" aria-hidden="true" />
      <span className="lg-band" aria-hidden="true" />
      <span className="lg-glow" aria-hidden="true" />
      <aside className="lg-hero" aria-label="About PactPro">
        <div className="lg-dash" aria-hidden="true" />
        <h2>The Smarter Way to Manage Your <em>Legal Practice.</em></h2>
        <p className="lg-lead">
          A complete advocate and law firm management system with AI-powered features to streamline your cases,
          clients, documents, hearings and more.
        </p>
        <ul className="lg-feats">
          {FEATURES.map((f) => (
            <li key={f.title} className="lg-feat">
              <span className="lg-ic" aria-hidden="true"><svg viewBox="0 0 24 24">{f.icon}</svg></span>
              <strong>{f.title}</strong>
              <span className="lg-txt">{f.text}</span>
            </li>
          ))}
        </ul>
        <div className="lg-foot">
          <span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" /></svg>
            Advocate Management System
          </span>
          <i aria-hidden="true" />
          <span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 4.5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 6" /></svg>
            Built for Law Firms, Advocates &amp; Legal Professionals
          </span>
        </div>
      </aside>
      <main className="lg-side">
        <div className="lg-tools"><ThemeToggle /></div>
        <div className="lg-card auth-card">
          <div className="lg-brand">
            <img src={logo} alt="PactPro" width={720} height={294} />
            <div className="lg-tagline">Smarter Practice. Stronger Outcomes.</div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

// A field's leading icon (email envelope, padlock).
const MAIL_ICON = <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>;
const LOCK_ICON = <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="1.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;

// Password input with a show/hide toggle.
export function PasswordField({ label, error, lockIcon, ...rest }: { label: ReactNode; error?: ReactNode; lockIcon?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div className={`field${error ? ' invalid' : ''}`}>
      <label htmlFor={id}>{label}{rest.required && <span className="req" aria-hidden="true"> *</span>}</label>
      <div className={`pp-pw${lockIcon ? ' lg-iconfield' : ''}`}>
        {lockIcon && LOCK_ICON}
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
        // /dashboard renders the client view for CLIENT users (DashboardForRole).
        navigate('/dashboard');
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
      <h1>Sign in</h1>
      <p className="muted auth-lead">Use the email your firm admin created for you.</p>
      <form onSubmit={handleSubmit} className="stack">
        {arrived.notice && <div className="callout info" role="status"><div>{arrived.notice}</div></div>}
        <div className="field">
          <label htmlFor="l-email">Email <span className="req" aria-hidden="true">*</span></label>
          <div className="lg-iconfield">
            {MAIL_ICON}
            <input id="l-email" className="input" type="email" name="email" autoComplete="username"
              placeholder="name@yourfirm.com" value={formData.email} onChange={handleChange} required />
          </div>
        </div>
        <PasswordField label="Password" name="password" autoComplete="current-password" lockIcon
          placeholder="Enter your password" value={formData.password} onChange={handleChange} required />
        <div className="row between wrap">
          <span />
          <Link className="link small" to="/forgot-password">Forgot password?</Link>
        </div>
        <button type="submit" className={`btn primary pp-full${buttonLoading ? ' loading' : ''}`} disabled={buttonLoading}>
          {buttonLoading ? 'Signing in…' : <>Sign in <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></>}
        </button>
      </form>
      <div className="lg-or" aria-hidden="true">OR</div>
      <p className="auth-foot">Client? Use the link in your invitation email. <Link className="link" to="/">Back to home</Link></p>
    </AuthFrame>
  );
}

export default LoginModule;
