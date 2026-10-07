import { useState, useMemo } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../contexts/ToastContext';
import { Icon } from '../ui/kit';
import { AuthAlert, AuthFrame, PasswordField } from './Login';

const PWD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&*!?_+=-])[A-Za-z\d@#$%^&*!?_+=-]{8,32}$/;

const labels = [
  'Minimum 8 characters',
  'Uppercase letter',
  'Lowercase letter',
  'Number',
  'Special character (@ # $ % ^ & * ! ? _ + -)',
];

function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const email = (location.state as any)?.email || '';
  const otp = (location.state as any)?.otp || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [pwdError, setPwdError] = useState('');
  const { success } = useToast() as any;

  const rules = useMemo(() => [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
    /[@#$%^&*!?_+=-]/.test(password),
  ], [password]);

  const valid = PWD_REGEX.test(password);
  const match = password === confirm && confirm.length > 0;

  const score = rules.filter(Boolean).length;
  const strength = !password ? { label: 'Too short', color: 'var(--ink-3)' }
    : score <= 2 ? { label: 'Weak', color: 'var(--bad)' }
    : score <= 4 ? { label: 'Medium', color: 'var(--warn)' }
    : { label: 'Strong', color: 'var(--ok)' };

  async function handleSubmit(e: any) {
    e.preventDefault();
    if (!valid) { setPwdError('Password does not meet requirements.'); return; }
    if (!match) { setPwdError('Passwords do not match.'); return; }
    setLoading(true);
    setPwdError('');
    try {
      const res = await api.post('/api/auth/reset-password', { email, otp, newPassword: password });
      if (res.data.success) {
        success('Password reset successful! Please log in with your new password.');
        navigate('/login');
      } else {
        setPwdError(res.data.error || 'Failed to reset password.');
      }
    } catch (err: any) {
      setPwdError(err.response?.data?.error || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame>
      <Link className="link small" to="/verify-otp" state={{ email }}>Back</Link>
      <h1 className="auth-h-gap">Choose a new password</h1>
      {email && <p className="muted auth-lead">For <b className="mono">{email}</b>.</p>}
      <form onSubmit={handleSubmit} className="stack">
        <PasswordField label="New password" autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)} required />

        <div className="stack auth-tight">
          <div className="meter" aria-hidden="true"><i style={{ width: `${(score / 5) * 100}%`, background: strength.color }} /></div>
          <div className="row between xs"><span className="faint">Strength</span><b className="xs" style={{ color: strength.color }} aria-live="polite">{strength.label}</b></div>
          <ul className="pw-rules auth-rules" aria-label="Password rules">
            {labels.map((label, i) => (
              <li key={label} className={`row${rules[i] ? ' ok' : ''}`}>
                <Icon name={rules[i] ? 'check' : 'minus'} size="sm" /><span>{label}</span>
              </li>
            ))}
          </ul>
        </div>

        <PasswordField label="Confirm new password" autoComplete="new-password" value={confirm}
          onChange={(e) => setConfirm(e.target.value)} required />
        <div className="xs auth-match" aria-live="polite">
          {confirm.length > 0 && (match
            ? <span className="row auth-ok"><Icon name="ok" size="sm" />Passwords match</span>
            : <span className="row auth-bad"><Icon name="warn" size="sm" />Passwords don't match yet</span>)}
        </div>

        {pwdError && <AuthAlert>{pwdError}</AuthAlert>}
        <button type="submit" className={`btn primary pp-full${loading ? ' loading' : ''}`} disabled={loading || !valid || !match}>
          {loading ? 'Saving…' : 'Save new password'}
        </button>
      </form>
    </AuthFrame>
  );
}

export default ResetPassword;
