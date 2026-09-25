import { useState, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Password } from 'primereact/password';
import { Button } from 'primereact/button';
import '../assets/styles/ForgotPassword.css';
import api from '../api/client';
import { useToast } from '../contexts/ToastContext';

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

  const strength = useMemo(() => {
    const c = rules.filter(Boolean).length;
    if (c <= 2) return { label: 'Weak', cls: 'weak' };
    if (c <= 4) return { label: 'Medium', cls: 'medium' };
    return { label: 'Strong', cls: 'strong' };
  }, [rules]);

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
    <div className="forgot-container">
      <div className="forgot-box">
        <Button link icon="pi pi-arrow-left" label="Back" className="forgot-back p-0" onClick={() => navigate('/verify-otp', { state: { email } })} />
        <h2>Reset Password</h2>
        <p className="forgot-info">Create a new password for <strong>{email}</strong>.</p>
        <form onSubmit={handleSubmit} className="flex flex-column gap-3">
          <Password placeholder="New Password" value={password} onChange={(e) => setPassword(e.target.value)}
            required feedback={false} toggleMask className="w-full" inputClassName="w-full" />

          {password.length > 0 && (
            <div className="pwd-checklist">
              {labels.map((label, i) => (
                <span key={i} className={rules[i] ? 'rule ok' : 'rule fail'}>
                  <i className={`pi ${rules[i] ? 'pi-check' : 'pi-circle-fill'}`} /> {label}
                </span>
              ))}
            </div>
          )}

          {password.length > 0 && (
            <div className="pwd-strength">
              <div className="strength-bar">
                <div className={`strength-fill ${strength.cls}`} style={{ width: `${(rules.filter(Boolean).length / 5) * 100}%` }} />
              </div>
              <span className={`strength-label ${strength.cls}`}>{strength.label}</span>
            </div>
          )}

          <Password placeholder="Confirm New Password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
            required feedback={false} toggleMask className="w-full" inputClassName="w-full" />

          {confirm.length > 0 && (
            <span className={`rule ${match ? 'ok' : 'fail'}`}>
              <i className={`pi ${match ? 'pi-check' : 'pi-circle-fill'}`} /> Passwords match
            </span>
          )}

          {pwdError && <small className="otp-error">{pwdError}</small>}
          <Button type="submit" className="w-full" loading={loading} disabled={loading || !valid || !match} label={loading ? 'Resetting...' : 'Reset Password'} />
        </form>
      </div>
    </div>
  );
}

export default ResetPassword;
