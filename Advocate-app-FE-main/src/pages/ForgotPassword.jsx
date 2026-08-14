import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../assets/styles/ForgotPassword.css";
import axios from "axios";
import { useToast } from '../contexts/ToastContext.jsx';
import { ButtonSpinner } from "../components/Loader";

function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { success, error, warning, info } = useToast();

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post(
        "/api/auth/forgot-password",
        { email },
        { headers: { "Content-Type": "application/json" } }
      );
      setSent(true);
    } catch (err) {
      error("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleProceed() {
    navigate("/verify-otp", { state: { email } });
  }

  if (sent) {
    return (
      <div className="forgot-container">
        <div className="forgot-box">
          <button className="forgot-back" onClick={() => navigate("/login")}>&larr; Back to Login</button>
          <h2>Check Your Email</h2>
          <p className="forgot-info">If an account exists with <strong>{email}</strong>, a verification code has been sent.</p>
          <button className="forgot-submit" onClick={handleProceed}>Enter Verification Code</button>
        </div>
      </div>
    );
  }

  return (
    <div className="forgot-container">
      <div className="forgot-box">
        <button className="forgot-back" onClick={() => navigate("/login")}>&larr; Back to Login</button>
        <h2>Forgot Password</h2>
        <p className="forgot-info">Enter your registered email address and we will send you a verification code.</p>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button type="submit" className="forgot-submit" disabled={loading}>
            {loading && <ButtonSpinner />}
            {loading ? "Sending..." : "Send Verification Code"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default ForgotPassword;
