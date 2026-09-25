import { useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import '../assets/styles/ForgotPassword.css';
import api from '../api/client';

function VerifyOtp() {
  const navigate = useNavigate();
  const location = useLocation();
  const email = (location.state as any)?.email || '';

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef<any[]>([]);

  function handleChange(index: number, value: string) {
    if (!/^\d?$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    setError('');
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, e: any) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) inputRefs.current[index - 1]?.focus();
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
    <div className="forgot-container">
      <div className="forgot-box">
        <Button link icon="pi pi-arrow-left" label="Back" className="forgot-back p-0" onClick={() => navigate('/forgot-password')} />
        <h2>Verify Code</h2>
        <p className="forgot-info">Enter the 6-digit code sent to <strong>{email}</strong>.</p>
        <form onSubmit={handleSubmit} className="flex flex-column gap-3">
          <div className="otp-inputs">
            {otp.map((digit, i) => (
              <InputText
                key={i}
                ref={(el) => { inputRefs.current[i] = el; }}
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className="otp-digit"
                autoFocus={i === 0}
              />
            ))}
          </div>
          {error && <small className="otp-error">{error}</small>}
          <Button type="submit" className="w-full" loading={loading} disabled={loading} label={loading ? 'Verifying...' : 'Verify Code'} />
        </form>
      </div>
    </div>
  );
}

export default VerifyOtp;
