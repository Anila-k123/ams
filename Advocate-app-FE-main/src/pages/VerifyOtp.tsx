import { useState, useRef } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import api from '../api/client';
import { AuthAlert, AuthFrame } from './Login';

function VerifyOtp() {
  const navigate = useNavigate();
  const location = useLocation();
  const email = (location.state as any)?.email || '';

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function handleChange(index: number, value: string) {
    // A pasted or autofilled code arrives in one box: spread it across the rest.
    const digits = value.replace(/\D/g, '');
    if (digits.length > 1) {
      const newOtp = [...otp];
      digits.slice(0, 6 - index).split('').forEach((d, k) => { newOtp[index + k] = d; });
      setOtp(newOtp);
      setError('');
      inputRefs.current[Math.min(index + digits.length, 5)]?.focus();
      return;
    }
    if (!/^\d?$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    setError('');
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) inputRefs.current[index - 1]?.focus();
    if (e.key === 'ArrowLeft' && index > 0) inputRefs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < 5) inputRefs.current[index + 1]?.focus();
  }

  async function handleSubmit(e: any) {
    e.preventDefault();
    const code = otp.join('');
    if (code.length !== 6) {
      setError('Please enter the complete 6-digit code.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/api/auth/verify-otp', { email, otp: code });
      if (res.data.success) {
        navigate('/reset-password', { state: { email, otp: code } });
      } else {
        setError(res.data.error || 'Invalid code.');
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'Invalid or expired OTP.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthFrame>
      <Link className="link small" to="/forgot-password">Back</Link>
      <h1 className="auth-h-gap">Enter verification code</h1>
      <p className="muted auth-lead">Type the 6-digit code we sent to <b className="mono">{email || 'your email'}</b>.</p>
      <form onSubmit={handleSubmit} className="stack">
        <fieldset className="auth-fieldset">
          <legend className="label">Verification code</legend>
          <div className="otp">
            {otp.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                className="input"
                inputMode="numeric"
                autoComplete={i ? 'off' : 'one-time-code'}
                aria-label={`Digit ${i + 1} of 6`}
                aria-invalid={!!error || undefined}
                value={digit}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onFocus={(e) => e.target.select()}
                autoFocus={i === 0}
              />
            ))}
          </div>
        </fieldset>
        {error && <AuthAlert>{error}</AuthAlert>}
        <button type="submit" className={`btn primary pp-full${loading ? ' loading' : ''}`} disabled={loading}>
          {loading ? 'Verifying…' : 'Verify code'}
        </button>
      </form>
    </AuthFrame>
  );
}

export default VerifyOtp;
