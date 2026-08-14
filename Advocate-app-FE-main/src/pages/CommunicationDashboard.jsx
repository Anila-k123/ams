import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import {
  FiMail, FiMessageSquare, FiFileText, FiClock,
  FiCheckCircle, FiXCircle, FiSend, FiSettings,
  FiTrendingUp, FiAlertCircle
} from "react-icons/fi";
import "../assets/styles/Communication.css";

const API = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api/communication`;

export default function CommunicationDashboard() {
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const [settings, setSettings] = useState(null);
  const [stats, setStats] = useState(null);
  const [statsError, setStatsError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    Promise.all([
      axios.get(`${API}/settings`, { headers: { Authorization: `Bearer ${token}` } }),
      axios.get(`${API}/statistics`, { headers: { Authorization: `Bearer ${token}` } }),
    ])
      .then(([sRes, statsRes]) => {
        setSettings(sRes.data);
        setStats(statsRes.data);
        setStatsError(false);
      })
      .catch(() => setStatsError(true))
      .finally(() => setLoading(false));
  }, [token]);

  const val = (v) => (statsError ? "--" : v ?? "--");

  if (loading)
    return (
      <div className="comm-page">
        <div className="comm-stat-cards">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="comm-stat-card comm-skeleton" />
          ))}
        </div>
      </div>
    );

  return (
    <div className="comm-page">
      <h2>Communication Dashboard</h2>

      <div className="comm-stat-cards">
        <div className="comm-stat-card">
          <div className="comm-stat-icon sent"><FiSend /></div>
          <div className="comm-stat-body">
            <span className="comm-stat-label">Total Sent</span>
            <span className="comm-stat-value">{val(stats?.totalSent)}</span>
          </div>
        </div>

        <div className="comm-stat-card">
          <div className="comm-stat-icon email"><FiMail /></div>
          <div className="comm-stat-body">
            <span className="comm-stat-label">Emails Today</span>
            <span className="comm-stat-value">{val(stats?.emailsToday)}</span>
          </div>
        </div>

        <div className="comm-stat-card">
          <div className="comm-stat-icon whatsapp"><FiMessageSquare /></div>
          <div className="comm-stat-body">
            <span className="comm-stat-label">WhatsApp Today</span>
            <span className="comm-stat-value">{val(stats?.whatsappToday)}</span>
          </div>
        </div>

        <div className="comm-stat-card">
          <div className="comm-stat-icon failed"><FiXCircle /></div>
          <div className="comm-stat-body">
            <span className="comm-stat-label">Failed Total</span>
            <span className="comm-stat-value">{val(stats?.failedTotal)}</span>
          </div>
        </div>

        <div className="comm-stat-card">
          <div className="comm-stat-icon failed"><FiAlertCircle /></div>
          <div className="comm-stat-body">
            <span className="comm-stat-label">Failed Today</span>
            <span className="comm-stat-value">{val(stats?.failedToday)}</span>
          </div>
        </div>
      </div>

      <div className="comm-cards">
        <div className="comm-card" onClick={() => navigate("/dashboard/communication/settings")}>
          <div className="comm-card-icon email"><FiMail /></div>
          <div className="comm-card-body">
            <span className="comm-card-label">Email</span>
            <span className={`comm-card-value ${settings?.emailEnabled ? "connected" : "disabled"}`}>
              {settings?.emailEnabled ? "Connected" : "Not Connected"}
            </span>
            <span className="comm-card-sub">{settings?.senderEmail || "No email configured"}</span>
          </div>
        </div>

        <div className="comm-card" onClick={() => navigate("/dashboard/communication/settings")}>
          <div className="comm-card-icon whatsapp"><FiMessageSquare /></div>
          <div className="comm-card-body">
            <span className="comm-card-label">WhatsApp</span>
            <span className={`comm-card-value ${settings?.whatsappEnabled ? "connected" : "disabled"}`}>
              {settings?.whatsappEnabled ? "Connected" : "Not Connected"}
            </span>
            <span className="comm-card-sub">Business API</span>
          </div>
        </div>

        <div className="comm-card" onClick={() => navigate("/dashboard/communication/templates")}>
          <div className="comm-card-icon templates"><FiFileText /></div>
          <div className="comm-card-body">
            <span className="comm-card-label">Templates</span>
            <span className="comm-card-value">Manage</span>
            <span className="comm-card-sub">Notification templates</span>
          </div>
        </div>

        <div className="comm-card" onClick={() => navigate("/dashboard/communication/history")}>
          <div className="comm-card-icon history"><FiClock /></div>
          <div className="comm-card-body">
            <span className="comm-card-label">History</span>
            <span className="comm-card-value">{val(stats?.totalSent + stats?.failedTotal)} entries</span>
            <span className="comm-card-sub">
              <FiCheckCircle className="comm-sub-icon sent" /> {val(stats?.sentToday ?? stats?.totalSent)} sent
              <FiXCircle className="comm-sub-icon failed" /> {val(stats?.failedTotal)} failed
            </span>
          </div>
        </div>
      </div>

      <div className="comm-quick-actions">
        <h3>Quick Actions</h3>
        <div className="comm-actions-row">
          <button className="comm-action-btn" onClick={() => navigate("/dashboard/communication/settings")}>
            <FiSettings /> Configure Settings
          </button>
          <button className="comm-action-btn" onClick={() => navigate("/dashboard/communication/templates")}>
            <FiFileText /> Manage Templates
          </button>
          <button className="comm-action-btn" onClick={() => navigate("/dashboard/communication/history")}>
            <FiTrendingUp /> View History
          </button>
        </div>
      </div>
    </div>
  );
}
