import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import Select from "react-select";
import { useToast } from "../contexts/ToastContext.jsx";
import { useLoading } from "../contexts/LoadingContext.jsx";
import "../assets/styles/AppealAlert.css";

// --- Static dropdown data (per requirement, hardcoded for now) ---
const COURT_OPTIONS = [
  "Supreme Court of India",
  "High Court",
  "District Court",
  "Sessions Court",
  "Civil Court",
  "Family Court",
  "Consumer Court",
  "Tribunal",
].map((c) => ({ value: c, label: c }));

const STATE_OPTIONS = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Puducherry", "Chandigarh",
].map((s) => ({ value: s, label: s }));

const CURRENT_YEAR = 2026;
const YEAR_OPTIONS = Array.from({ length: CURRENT_YEAR - 1949 }, (_, i) => {
  const y = String(CURRENT_YEAR - i);
  return { value: y, label: y };
});

const selectStyles = {
  control: (base, state) => ({
    ...base,
    minHeight: "46px",
    borderRadius: "8px",
    borderColor: state.isFocused ? "#10b981" : "#d6dae2",
    boxShadow: "none",
    "&:hover": { borderColor: "#10b981" },
  }),
  placeholder: (base) => ({ ...base, color: "#9ca3af" }),
};

const EMPTY_FORM = {
  court: null,
  state: null,
  caseNumber: "",
  caseYear: null,
  dateOfJudgement: "",
};

function AppealAlert() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [alerts, setAlerts] = useState([]);
  const [saving, setSaving] = useState(false);

  const token = localStorage.getItem("token");
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };
  const { withLoading } = useLoading();
  const { success, error } = useToast();

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await axios.get("/api/appeal-alerts", authHeaders);
      setAlerts(res.data || []);
    } catch (err) {
      console.error("Error fetching appeal alerts:", err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.court) {
      error("Please select a Court.");
      return;
    }
    setSaving(true);
    try {
      await withLoading(
        axios.post(
          "/api/appeal-alerts/create",
          {
            forum: "Supreme Court",
            court: form.court?.value || null,
            state: form.state?.value || null,
            caseNumber: form.caseNumber || null,
            caseYear: form.caseYear?.value || null,
            dateOfJudgement: form.dateOfJudgement || null,
          },
          authHeaders
        ),
        "Adding appeal alert..."
      );
      success("Appeal alert added successfully.");
      setForm(EMPTY_FORM);
      fetchAlerts();
    } catch (err) {
      console.error("Error adding appeal alert:", err);
      error("Failed to add appeal alert.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await withLoading(
        axios.delete(`/api/appeal-alerts/delete/${id}`, authHeaders),
        "Deleting..."
      );
      success("Appeal alert deleted.");
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error("Error deleting appeal alert:", err);
      error("Failed to delete appeal alert.");
    }
  };

  return (
    <div className="appeal-alert-page">
      <div className="appeal-alert-card">
        <h2 className="appeal-alert-title">Add Alert for Appeal</h2>

        <form onSubmit={handleSubmit}>
          <div className="appeal-form-grid">
            <div className="appeal-field full-width">
              <label>Forum</label>
              <input
                type="text"
                className="forum-readonly"
                value="Supreme Court"
                readOnly
              />
            </div>

            <div className="appeal-field">
              <label>Court</label>
              <Select
                options={COURT_OPTIONS}
                value={form.court}
                onChange={(opt) => setForm((p) => ({ ...p, court: opt }))}
                placeholder="Select option"
                styles={selectStyles}
                isClearable
              />
            </div>

            <div className="appeal-field">
              <label>State</label>
              <Select
                options={STATE_OPTIONS}
                value={form.state}
                onChange={(opt) => setForm((p) => ({ ...p, state: opt }))}
                placeholder="Select option"
                styles={selectStyles}
                isClearable
              />
            </div>

            <div className="appeal-field">
              <label>Case Number</label>
              <input
                type="text"
                name="caseNumber"
                value={form.caseNumber}
                onChange={handleChange}
                placeholder="Enter case number"
              />
            </div>

            <div className="appeal-field">
              <label>Case Year</label>
              <Select
                options={YEAR_OPTIONS}
                value={form.caseYear}
                onChange={(opt) => setForm((p) => ({ ...p, caseYear: opt }))}
                placeholder="Select year"
                styles={selectStyles}
                isClearable
              />
            </div>

            <div className="appeal-field">
              <label>Date of Judgement</label>
              <input
                type="date"
                name="dateOfJudgement"
                value={form.dateOfJudgement}
                onChange={handleChange}
              />
            </div>
          </div>

          <div className="appeal-form-actions">
            <button type="submit" className="appeal-submit-btn" disabled={saving}>
              {saving ? "Adding..." : "Add Appeal Alert"}
            </button>
          </div>
        </form>
      </div>

      <div className="appeal-list-section">
        <h3>Appeal Alerts</h3>
        <div className="appeal-table-wrap">
          {alerts.length === 0 ? (
            <div className="appeal-empty">No appeal alerts yet.</div>
          ) : (
            <table className="appeal-table">
              <thead>
                <tr>
                  <th>Forum</th>
                  <th>Court</th>
                  <th>State</th>
                  <th>Case Number</th>
                  <th>Case Year</th>
                  <th>Date of Judgement</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.forum || "-"}</td>
                    <td>{a.court || "-"}</td>
                    <td>{a.state || "-"}</td>
                    <td>{a.caseNumber || "-"}</td>
                    <td>{a.caseYear || "-"}</td>
                    <td>{a.dateOfJudgement || "-"}</td>
                    <td>
                      <button
                        className="appeal-delete-btn"
                        onClick={() => handleDelete(a.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default AppealAlert;
