import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import '../assets/styles/ForgotPassword.css';
import api from '../api/client';
import { useToast } from '../contexts/ToastContext';

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

  const back = <Button link icon="pi pi-arrow-left" label="Back to Login" className="forgot-back p-0" onClick={() => navigate('/login')} />;

  if (sent) {
    return (
      <div className="forgot-container">
        <div className="forgot-box">
          {back}
          <h2>Check Your Email</h2>
          <p className="forgot-info">If an account exists with <strong>{email}</strong>, a verification code has been sent.</p>
          <Button className="w-full" label="Enter Verification Code" onClick={() => navigate('/verify-otp', { state: { email } })} />
        </div>
      </div>
    );
  }

  return (
    <div className="forgot-container">
      <div className="forgot-box">
        {back}
        <h2>Forgot Password</h2>
        <p className="forgot-info">Enter your registered email address and we will send you a verification code.</p>
        <form onSubmit={handleSubmit} className="flex flex-column gap-3">
          <InputText type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full" />
          <Button type="submit" className="w-full" loading={loading} disabled={loading} label={loading ? 'Sending...' : 'Send Verification Code'} />
        </form>
      </div>
    </div>
  );
}

export default ForgotPassword;
