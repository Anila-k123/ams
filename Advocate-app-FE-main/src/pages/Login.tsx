import '../assets/styles/Login.css';
import logpic from '../assets/images/login.png';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { InputText } from 'primereact/inputtext';
import { Password } from 'primereact/password';
import { Button } from 'primereact/button';
import api from '../api/client';
import { useTheme } from '../contexts/ThemeContext';
import { useLoading } from '../contexts/LoadingContext';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../context/AuthContext';

function LoginModule() {
  const { setTheme: applyTheme } = useTheme() as any;
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
    <div className="loginpage">
      <div className="login-box">
        <div className="left-box">
          <h1>WELCOME</h1>
          <h2>LOGIN</h2>
          <form onSubmit={handleSubmit} className="flex flex-column gap-3">
            <InputText type="email" name="email" placeholder="Email" value={formData.email} onChange={handleChange} required className="w-full" />
            <Password name="password" placeholder="Password" value={formData.password} onChange={handleChange}
              required feedback={false} toggleMask className="w-full" inputClassName="w-full" />
            <div className="forgot-link-row">
              <span className="forgot-link" onClick={() => navigate('/forgot-password')}>Forgot Password?</span>
            </div>
            <Button type="submit" label={buttonLoading ? 'Logging in...' : 'Submit'} loading={buttonLoading} disabled={buttonLoading} className="w-full" />
          </form>
        </div>
        <div className="right-box">
          <Button icon="pi pi-times" rounded text severity="danger" className="img-btn" aria-label="Close" onClick={() => navigate('/')} />
          <img src={logpic} alt="Login" />
        </div>
      </div>
    </div>
  );
}

export default LoginModule;
