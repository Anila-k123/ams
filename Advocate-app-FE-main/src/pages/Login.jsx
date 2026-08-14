import '../assets/styles/Login.css';
import logpic from '../assets/images/login.jpeg';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import axios from 'axios';
import { logoutAndRedirect, isTokenExpired } from '../utils/auth.jsx';
import { useTheme } from '../contexts/ThemeContext.jsx';
import { useLoading } from '../contexts/LoadingContext';
import { useToast } from '../contexts/ToastContext.jsx';
import { ButtonSpinner } from '../components/Loader';

function LoginModule() {
  const { setTheme: applyTheme } = useTheme();
  const { withLoading } = useLoading();
  const { success, error, warning, info } = useToast();
  const navigate = useNavigate();
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [buttonLoading, setButtonLoading] = useState(false);

  // ✅ Setup global axios interceptor once
  useEffect(() => {
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response && error.response.status === 401) {
          console.warn("Session expired or unauthorized. Logging out...");
          logoutAndRedirect();
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, []);

  function handleChange(e) {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setButtonLoading(true);
    try {
      const response = await withLoading(
        axios.post(
          "/api/advocates/login",
          formData,
          { headers: { "Content-Type": "application/json" } }
        ),
        "Logging in..."
      );

      if (response.data.token) {
        localStorage.setItem("token", response.data.token);
        localStorage.setItem("email", formData.email);
        localStorage.setItem("role", response.data.role || "ADVOCATE");
        localStorage.setItem("fullName", response.data.fullName || "");
        applyTheme(response.data.theme || "light");

        success("Login successful!");
        navigate("/dashboard");
      } else {
        error(response.data.error || "Login failed!");
      }
    } catch (err) {
      console.error("❌ Error during login:", err.response || err.message);
      error("Login failed! Please check your credentials or try again.");
    } finally {
      setButtonLoading(false);
    }
  }

  return (
    <div className="loginpage">
      <div className="login-box justify-content-center d-flex m-5 border border-info">
        <div className="left-box">
          <h1>WELCOME</h1>
          <h2>LOGIN</h2>
          <form onSubmit={handleSubmit}>
            <input
              type="email"
              name="email"
              placeholder="EMAIL"
              value={formData.email}
              onChange={handleChange}
              required
            />
            <input
              type="password"
              name="password"
              placeholder="PASSWORD"
              value={formData.password}
              onChange={handleChange}
              required
            />
            <div className="forgot-link-row">
              <span className="forgot-link" onClick={() => navigate("/forgot-password")}>
                Forgot Password?
              </span>
            </div>
            <button type="submit" className="btn btn-outline-success" disabled={buttonLoading}>
              {buttonLoading && <ButtonSpinner />}
              {buttonLoading ? "Logging in..." : "Submit"}
            </button>
          </form>
        </div>
        <div className="right-box">
          <button className="img-btn button-danger rounded-circle" onClick={() => navigate("/")}>✖</button>
          <img src={logpic} alt="Login" />
        </div>
      </div>
    </div>
  );
}

export default LoginModule;
