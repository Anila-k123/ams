import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/client';
import { useToast } from '../contexts/ToastContext';
import { Icon } from '../ui/kit';
import { AuthFrame } from './Login';

function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { error } = useToast() as any;

  async function handleSubmit(e: any) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/auth/forgot-password', { email });
      setSent(true);
    } catch {
      error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthFrame>
        <div role="status">
          <div className="pp-success-ic"><Icon name="mail" size="lg" /></div>
          <h1>Check your email</h1>
          <p className="muted auth-lead">If an account exists with <b className="mono">{email}</b>, a 6-digit verification code has been sent. Check spam if it isn't in your inbox.</p>
          <button type="button" className="btn primary pp-full" onClick={() => navigate('/verify-otp', { state: { email } })}>Enter the code</button>
          <p className="small muted auth-foot">Wrong email? <button type="button" className="link auth-linkbtn" onClick={() => setSent(false)}>Use a different one</button></p>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <Link className="link small" to="/login">Back to sign in</Link>
      <h1 className="auth-h-gap">Reset your password</h1>
      <p className="muted auth-lead">Enter the email you sign in with. We'll send a 6-digit verification code to it.</p>
      <form onSubmit={handleSubmit} className="stack">
        <div className="field">
          <label htmlFor="f-email">Email <span className="req" aria-hidden="true">*</span></label>
          <input id="f-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <button type="submit" className={`btn primary pp-full${loading ? ' loading' : ''}`} disabled={loading}>
          {loading ? 'Sending…' : 'Send verification code'}
        </button>
      </form>
    </AuthFrame>
  );
}

export default ForgotPassword;
