import { useState, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import "../assets/styles/ForgotPassword.css";
import axios from "axios";
import { useToast } from '../contexts/ToastContext.jsx';
import { ButtonSpinner } from "../components/Loader";

const PWD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&*!?_+=-])[A-Za-z\d@#$%^&*!?_+=-]{8,32}$/;

function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const email = location.state?.email || "";
  const otp = location.state?.otp || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pwdError, setPwdError] = useState("");
  const { success } = useToast();

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
    if (c <= 2) return { label: "Weak", cls: "weak" };
    if (c <= 4) return { label: "Medium", cls: "medium" };
    return { label: "Strong", cls: "strong" };
  }, [rules]);

  const labels = [
    "Minimum 8 characters",
    "Uppercase letter",
    "Lowercase letter",
    "Number",
    "Special character (@ # $ % ^ & * ! ? _ + -)"
  ];

  async function handleSubmit(e) {
    e.preventDefault();
    if (!valid) {
      setPwdError("Password does not meet requirements.");
      return;
    }
    if (!match) {
      setPwdError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setPwdError("");
    try {
      const res = await axios.post(
        "/api/auth/reset-password",
        { email, otp, newPassword: password },
        { headers: { "Content-Type": "application/json" } }
      );
      if (res.data.success) {
        success("Password reset successful! Please log in with your new password.");
        navigate("/login");
      } else {
        setPwdError(res.data.error || "Failed to reset password.");
      }
    } catch (err) {
      setPwdError(err.response?.data?.error || "Failed to reset password. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="forgot-container">
      <div className="forgot-box">
        <button className="forgot-back" onClick={() => navigate("/verify-otp", { state: { email } })}>&larr; Back</button>
        <h2>Reset Password</h2>
        <p className="forgot-info">Create a new password for <strong>{email}</strong>.</p>
        <form onSubmit={handleSubmit}>
          <div className="pwd-field">
            <input
              type={showPwd ? "text" : "password"}
              placeholder="New Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="button" className="pwd-toggle" onClick={() => setShowPwd((s) => !s)} tabIndex={-1}>
              {showPwd ? "Hide" : "Show"}
            </button>
          </div>

          {password.length > 0 && (
            <div className="pwd-checklist">
              {labels.map((label, i) => (
                <span key={i} className={rules[i] ? "rule ok" : "rule fail"}>
                  {rules[i] ? "\u2713" : "\u2022"} {label}
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

          <div className="pwd-field">
            <input
              type={showPwd ? "text" : "password"}
              placeholder="Confirm New Password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>

          {confirm.length > 0 && (
            <span className={`rule ${match ? "ok" : "fail"}`} style={{ fontSize: "12px" }}>
              {match ? "\u2713" : "\u2022"} Passwords match
            </span>
          )}

          {pwdError && <p className="otp-error">{pwdError}</p>}
          <button type="submit" className="forgot-submit" disabled={loading || !valid || !match}>
            {loading && <ButtonSpinner />}
            {loading ? "Resetting..." : "Reset Password"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default ResetPassword;
