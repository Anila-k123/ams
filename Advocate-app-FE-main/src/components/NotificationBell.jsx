import React, { useState, useEffect, useRef, useCallback } from "react";
import { FiBell } from "react-icons/fi";
import { useWebSocketContext } from "../contexts/realtime/WebSocketProvider";

export default function NotificationBell({ onOpen }) {
  const [count, setCount] = useState(0);
  const [alerts, setAlerts] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const bellRef = useRef(null);
  const { subscribe } = useWebSocketContext();
  const dropdownRef = useRef(null);

  useEffect(() => {
    const unsub = subscribe("notification", (event) => {
      setAlerts((prev) => {
        const updated = [{ ...event, id: Date.now() + Math.random() }, ...prev];
        return updated.slice(0, 50);
      });
      setCount((c) => c + 1);
    });
    return unsub;
  }, [subscribe]);

  const handleClick = useCallback(() => {
    setShowDropdown((v) => !v);
    setCount(0);
  }, []);

  const handleNotificationClick = useCallback((alert) => {
    setShowDropdown(false);
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
            <h4>Live Notifications</h4>
            <button className="clear-btn" onClick={() => setShowDropdown(false)}>Close</button>
          </div>
          <div className="live-notif-list">
            {alerts.length === 0 ? (
              <p className="no-data">No live notifications yet.</p>
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
