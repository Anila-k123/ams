import { useState, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "../assets/styles/ForgotPassword.css";
import axios from "axios";
import { ButtonSpinner } from "../components/Loader";

function VerifyOtp() {
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email || "";

  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRefs = useRef([]);

  function handleChange(index, value) {
    if (!/^\d?$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    setError("");

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index, e) {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const code = otp.join("");
    if (code.length !== 6) {
      setError("Please enter the complete 6-digit code.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await axios.post(
        "/api/auth/verify-otp",
        { email, otp: code },
        { headers: { "Content-Type": "application/json" } }
      );
      if (res.data.success) {
        navigate("/reset-password", { state: { email, otp: code } });
      } else {
        setError(res.data.error || "Invalid code.");
      }
    } catch (err) {
      setError(err.response?.data?.error || "Invalid or expired OTP.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="forgot-container">
      <div className="forgot-box">
        <button className="forgot-back" onClick={() => navigate("/forgot-password")}>&larr; Back</button>
        <h2>Verify Code</h2>
        <p className="forgot-info">Enter the 6-digit code sent to <strong>{email}</strong>.</p>
        <form onSubmit={handleSubmit}>
          <div className="otp-inputs">
            {otp.map((digit, i) => (
              <input
                key={i}
                ref={(el) => (inputRefs.current[i] = el)}
                type="text"
                maxLength={1}
                value={digit}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className="otp-digit"
                autoFocus={i === 0}
              />
            ))}
          </div>
          {error && <p className="otp-error">{error}</p>}
          <button type="submit" className="forgot-submit" disabled={loading}>
            {loading && <ButtonSpinner />}
            {loading ? "Verifying..." : "Verify Code"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default VerifyOtp;
