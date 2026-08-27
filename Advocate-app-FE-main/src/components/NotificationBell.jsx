import React, { useState, useEffect, useRef, useCallback } from "react";
import { FiBell } from "react-icons/fi";
import axios from "axios";
import { useWebSocketContext } from "../contexts/realtime/WebSocketProvider";

export default function NotificationBell({ onOpen }) {
  const [count, setCount] = useState(0);
  const [alerts, setAlerts] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const bellRef = useRef(null);
  const { subscribe } = useWebSocketContext();
  const dropdownRef = useRef(null);

  // The bell was WebSocket-only, and there is no /ws backend - so it always
  // read "No live notifications yet." Unread notifications are now loaded over
  // REST; the WS subscription is kept below so it still upgrades to push if a
  // /ws backend ever lands.
  const load = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await axios.get("/api/notifications/unread", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rows = (Array.isArray(res.data) ? res.data : []).map((n) => ({
        id: n.id,
        message: n.message,
        timestamp: n.timestamp || n.createdAt,
      }));
      setAlerts(rows.slice(0, 50));
      setCount(rows.length);
    } catch {
      /* the dropdown's empty state covers it */
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll gently: notifications are produced by a scheduled job, not per
  // keystroke, so a minute of latency is fine and this costs one small query.
  useEffect(() => {
    const t = setInterval(load, 60000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [load]);

  useEffect(() => {
    const unsub = subscribe("notification", (event) => {
      setAlerts((prev) => {
        const updated = [{ ...event, id: `live-${Date.now()}-${Math.random()}` }, ...prev];
        return updated.slice(0, 50);
      });
      setCount((c) => c + 1);
    });
    return unsub;
  }, [subscribe]);

  const handleClick = useCallback(() => {
    setShowDropdown((v) => !v);
  }, []);

  const handleNotificationClick = useCallback(async (alert) => {
    setShowDropdown(false);
    // Actually mark it read server-side; previously opening the dropdown just
    // zeroed the badge locally and it came back on the next load.
    if (alert.id && !String(alert.id).startsWith("live-")) {
      try {
        const token = localStorage.getItem("token");
        await axios.put(`/api/notifications/${alert.id}/read`, {}, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
        setCount((c) => Math.max(0, c - 1));
      } catch { /* leave it unread rather than lying about it */ }
    }
    if (onOpen && alert.route) {
      onOpen(alert.route);
    }
  }, [onOpen]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          bellRef.current && !bellRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const formatTime = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="live-notif-bell-wrapper">
      <button ref={bellRef} className="icon-btn live-notif-bell" onClick={handleClick} title="Notifications">
        <FiBell />
        {count > 0 && <span className="notif-badge live-notif-badge pulse-badge">{count > 99 ? "99+" : count}</span>}
      </button>
      {showDropdown && (
        <div ref={dropdownRef} className="live-notif-dropdown">
          <div className="live-notif-header">
            <h4>Notifications</h4>
            <button className="clear-btn" onClick={() => setShowDropdown(false)}>Close</button>
          </div>
          <div className="live-notif-list">
            {alerts.length === 0 ? (
              <p className="no-data">Nothing unread.</p>
            ) : (
              alerts.map((a) => (
                <div key={a.id} className="live-notif-item clickable" onClick={() => handleNotificationClick(a)}>
                  <div className="live-notif-msg">{a.message}</div>
                  <div className="live-notif-time">{formatTime(a.timestamp)}</div>
                  <div className="live-notif-type-badge">{a.type?.replace(/_/g, " ").toLowerCase()}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
