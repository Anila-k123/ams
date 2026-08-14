import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "../assets/styles/Signup.css";
import axios from "axios";
import { useLoading } from "../contexts/LoadingContext";
import { useToast } from "../contexts/ToastContext";
import { ButtonSpinner } from "../components/Loader";

const PWD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&*!?_+=-])[A-Za-z\d@#$%^&*!?_+=-]{8,32}$/;

function getStrength(rules) {
  const count = rules.filter(Boolean).length;
  if (count <= 2) return { label: "Weak", cls: "weak" };
  if (count <= 4) return { label: "Medium", cls: "medium" };
  return { label: "Strong", cls: "strong" };
}

function Signup() {
  const { withLoading } = useLoading();
  const { success, error, warning, info } = useToast();
  const navigate = useNavigate();
  const [showPwd, setShowPwd] = useState(false);
  const [buttonLoading, setButtonLoading] = useState(false);
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
    phone: "",
    barCouncilId: "",
    specialization: "",
    experience: "",
    address: ""
  });

  function handleChange(e) {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  }

  const pwd = formData.password;

  const rules = useMemo(() => [
    pwd.length >= 8,
    /[A-Z]/.test(pwd),
    /[a-z]/.test(pwd),
    /\d/.test(pwd),
    /[@#$%^&*!?_+=-]/.test(pwd),
  ], [pwd]);

  const valid = PWD_REGEX.test(pwd);
  const strength = useMemo(() => getStrength(rules), [rules]);

  const labels = [
    "Minimum 8 characters",
    "Uppercase letter",
    "Lowercase letter",
    "Number",
    "Special character (@ # $ % ^ & * ! ? _ + -)"
  ];

  async function handleSubmit(e) {
    e.preventDefault();
    setButtonLoading(true);

    const submitData = {
      ...formData,
      experience: formData.experience ? Number(formData.experience) : 0
    };

    try {
      const response = await withLoading(
        axios.post("/api/advocates/signup", submitData, {
          headers: { "Content-Type": "application/json" }
        }),
        "Creating account..."
      );
      success(response.data.message || "Signup successful!");
      navigate("/login");
    } catch (err) {
      if (err.response) {
        error(err.response.data.error || "Signup failed");
        if (err.response.status !== 400) {
          error("This Email is already registered");
        }
      } else {
        error("Signup failed! Please try again.");
      }
    } finally {
      setButtonLoading(false);
    }
  }

  return (
    <div className="signup-container">
      <div className="signup-box">
        <button className="signup-back" onClick={() => navigate(-1)}>&larr; Back</button>
        <h2>Advocate Signup</h2>
        <form onSubmit={handleSubmit}>
          <input type="text" name="fullName" placeholder="Full Name" value={formData.fullName} onChange={handleChange} required />
          <input type="email" name="email" placeholder="Email" value={formData.email} onChange={handleChange} required />

          <div className="pwd-field">
            <input
              type={showPwd ? "text" : "password"}
              name="password"
              placeholder="Password"
              value={formData.password}
              onChange={handleChange}
              required
            />
            <button type="button" className="pwd-toggle" onClick={() => setShowPwd((s) => !s)} tabIndex={-1}>
              {showPwd ? "Hide" : "Show"}
            </button>
          </div>

          {pwd.length > 0 && (
            <div className="pwd-checklist">
              {labels.map((label, i) => (
                <span key={i} className={rules[i] ? "rule ok" : "rule fail"}>
                  {rules[i] ? "\u2713" : "\u2022"} {label}
                </span>
              ))}
            </div>
          )}

          {pwd.length > 0 && (
            <div className="pwd-strength">
              <div className="strength-bar">
                <div className={`strength-fill ${strength.cls}`} style={{ width: `${(rules.filter(Boolean).length / 5) * 100}%` }} />
              </div>
              <span className={`strength-label ${strength.cls}`}>{strength.label}</span>
            </div>
          )}

          <input type="text" name="phone" placeholder="Phone Number (optional)" value={formData.phone} onChange={handleChange} />
          <input type="text" name="barCouncilId" placeholder="Bar Council ID" value={formData.barCouncilId} onChange={handleChange} required />
          <input type="text" name="specialization" placeholder="Specialization (e.g., Civil, Criminal)" value={formData.specialization} onChange={handleChange} />
          <input type="number" name="experience" placeholder="Experience (Years)" value={formData.experience} onChange={handleChange} />
          <textarea name="address" placeholder="Address / Location" value={formData.address} onChange={handleChange} />
          <button type="submit" disabled={!valid || buttonLoading}>
            {buttonLoading && <ButtonSpinner />}
            {buttonLoading ? "Creating account..." : "Sign Up"}
          </button>
        </form>
        <p>
          Already have an account?{" "}
          <span className="link" onClick={() => navigate("/login")}>
            Login
          </span>
        </p>
      </div>
    </div>
  );
}

export default Signup;
