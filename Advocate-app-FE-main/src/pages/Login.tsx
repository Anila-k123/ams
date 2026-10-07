import '../ui/pages/auth.css';
import { useNavigate, Link } from 'react-router-dom';
import { useId, useState, type ReactNode, type InputHTMLAttributes } from 'react';
import api from '../api/client';
import { useTheme } from '../contexts/ThemeContext';
import { useLoading } from '../contexts/LoadingContext';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../ui/kit';

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
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-art">
        <span className="tape-strand" aria-hidden="true" />
        <div className="pp-art-brand">
          <span className="seal" aria-hidden="true">P</span>
          <div><b>PactPro</b><small>Practice management for advocates</small></div>
        </div>
        <div className="pp-art-mid">
          <div className="rule" aria-hidden="true" />
          <blockquote>Justice delayed is justice denied.</blockquote>
          <cite>Legal maxim</cite>
        </div>
        <div className="pp-art-foot"><span>Advocate Management System</span><span>Madras High Court and subordinate courts</span></div>
      </aside>
      <main className="auth-form">
        <div className="pp-auth-tools"><ThemeToggle /></div>
        <div className="auth-card">
          <div className="pp-mobile-brand"><span className="seal" aria-hidden="true">P</span><b>PactPro</b></div>
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
  const [formData, setFormData] = useState({ email: '', password: '' });
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
      console.error('Error during login:', err.response || err.message);
      error('Login failed! Please check your credentials or try again.');
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
      <p className="small muted auth-foot">Client? Use the link in your invitation email. <Link className="link" to="/">Back to home</Link></p>
    </AuthFrame>
  );
}

export default LoginModule;
