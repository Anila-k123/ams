import React, { useEffect, useState } from "react";
import axios from "axios";
import { useLoading } from "../contexts/LoadingContext";
import { FiPlus, FiEdit2, FiTrash2, FiCheckCircle, FiXCircle } from "react-icons/fi";
import "../assets/styles/Communication.css";

const API = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api/communication`;

const CHANNELS = ["EMAIL", "WHATSAPP", "SMS", "PUSH"];
const TYPES = [
  "HEARING_REMINDER", "CASE_CREATED", "CASE_UPDATED", "CASE_CLOSED",
  "PAYMENT_RECEIVED", "PAYMENT_DUE", "INVOICE_CREATED", "DOCUMENT_UPLOADED",
  "WELCOME", "CUSTOM",
];

export default function NotificationTemplates() {
  const { withLoading } = useLoading();
  const token = localStorage.getItem("token");
  const [templates, setTemplates] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState({
    name: "", channel: "EMAIL", type: "CUSTOM",
    subjectTemplate: "", bodyTemplate: "", active: true,
  });

  const loadTemplates = () => {
    axios
      .get(`${API}/templates`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setTemplates(res.data))
      .catch(() => setMessage({ type: "error", text: "Failed to load templates" }));
  };

  useEffect(() => { loadTemplates(); }, [token]);

  const resetForm = () => {
    setForm({ name: "", channel: "EMAIL", type: "CUSTOM", subjectTemplate: "", bodyTemplate: "", active: true });
    setEditing(null);
    setShowForm(false);
  };

  const handleEdit = (t) => {
    setForm({
      name: t.name, channel: t.channel, type: t.type,
      subjectTemplate: t.subjectTemplate || "", bodyTemplate: t.bodyTemplate,
      active: t.active,
    });
    setEditing(t.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        await withLoading(axios.put(`${API}/templates/${editing}`, form, {
          headers: { Authorization: `Bearer ${token}` },
        }), "Saving Template...");
        setMessage({ type: "success", text: "Template updated" });
      } else {
        await withLoading(axios.post(`${API}/templates`, form, {
          headers: { Authorization: `Bearer ${token}` },
        }), "Saving Template...");
        setMessage({ type: "success", text: "Template created" });
      }
      resetForm();
      loadTemplates();
    } catch {
      setMessage({ type: "error", text: "Failed to save template" });
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this template?")) return;
    try {
      await withLoading(axios.delete(`${API}/templates/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      }), "Deleting Template...");
      setMessage({ type: "success", text: "Template deleted" });
      loadTemplates();
    } catch {
      setMessage({ type: "error", text: "Failed to delete template" });
    }
  };

  return (
    <div className="comm-page">
      <h2>Notification Templates</h2>

      {message && (
        <div className={`comm-status ${message.type}`}>
          {message.type === "success" ? <FiCheckCircle /> : <FiXCircle />}
          <span>{message.text}</span>
          <button className="comm-close-msg" onClick={() => setMessage(null)}>x</button>
        </div>
      )}

      <button className="comm-action-btn" onClick={() => { resetForm(); setShowForm(true); }}>
        <FiPlus /> New Template
      </button>

      {showForm && (
        <div className="comm-form-overlay">
          <div className="comm-form-panel">
            <h3>{editing ? "Edit Template" : "New Template"}</h3>
            <div className="comm-form-grid">
              <div className="comm-field">
                <label>Name</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="comm-field">
                <label>Channel</label>
                <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                  {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="comm-field">
                <label>Type</label>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="comm-field">
                <label>Subject Template</label>
                <input type="text" value={form.subjectTemplate} onChange={(e) => setForm({ ...form, subjectTemplate: e.target.value })} />
              </div>
              <div className="comm-field full-width">
                <label>Body Template</label>
                <textarea rows={4} value={form.bodyTemplate} onChange={(e) => setForm({ ...form, bodyTemplate: e.target.value })} />
              </div>
              <label className="comm-toggle">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                <span className="comm-toggle-label">Active</span>
              </label>
            </div>
            <div className="comm-form-actions">
              <button className="comm-save-btn" onClick={handleSave}>
                {editing ? "Update" : "Create"}
              </button>
              <button className="comm-cancel-btn" onClick={resetForm}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="comm-table-wrap">
        <table className="comm-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Channel</th>
              <th>Type</th>
              <th>Active</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 && (
              <tr><td colSpan={5} className="comm-empty">No templates yet</td></tr>
            )}
            {templates.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td><span className="comm-badge">{t.channel}</span></td>
                <td><span className="comm-badge comm-badge-type">{t.type}</span></td>
                <td>{t.active ? <FiCheckCircle style={{ color: "#22c55e" }} /> : <FiXCircle style={{ color: "#ef4444" }} />}</td>
                <td className="comm-actions">
                  <button onClick={() => handleEdit(t)} title="Edit"><FiEdit2 /></button>
                  <button onClick={() => handleDelete(t.id)} title="Delete"><FiTrash2 /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
