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
  // Chime when the unread count rises. This used to live in Dashboard.jsx,
  // which polled the same endpoint on its own 30s timer to drive a second
  // bell; that bell is gone, so the sound moved here rather than being lost.
  const audioRef = useRef(null);
  const prevCount = useRef(null);

  useEffect(() => {
    try {
      audioRef.current = new Audio("/notification.mp3");
    } catch { /* no audio available; the badge still updates */ }
  }, []);

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
        // Where this notification points. The server resolves it, so the bell
        // and the notifications page always agree. Null for rows written
        // before notifications recorded what they were about - those stay
        // read-only rather than guessing a destination.
        route: n.route || null,
        entityType: n.entityType || null,
      }));
      setAlerts(rows.slice(0, 50));
      setCount(rows.length);

      // null on the first load: arriving to 13 unread is not 13 new arrivals,
      // and chiming on page load would be wrong every time.
      if (prevCount.current !== null && rows.length > prevCount.current) {
        audioRef.current?.play().catch(() => {});
      }
      prevCount.current = rows.length;
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

  // Marking read and going somewhere are separate actions. They used to be
  // welded together, so the only way to clear a notification you had already
  // dealt with was to let it navigate you away from whatever you were doing.
  const markRead = useCallback(async (alert) => {
    // Live WebSocket items have no server row yet, so there is nothing to mark;
    // dropping them from the list is the whole of it.
    if (!alert.id || String(alert.id).startsWith("live-")) {
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
      setCount((c) => Math.max(0, c - 1));
      return true;
    }
    try {
      const token = localStorage.getItem("token");
      await axios.put(`/api/notifications/${alert.id}/read`, {}, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
      setCount((c) => Math.max(0, c - 1));
      // Keep the local count honest against the server rather than trusting
      // the optimistic decrement.
      prevCount.current = Math.max(0, (prevCount.current ?? 1) - 1);
      return true;
    } catch {
      return false;   // leave it unread rather than lying about it
    }
  }, []);

  // "Got it" - clear it and stay where you are. The dropdown stays open so a
  // run of notifications can be cleared in one pass.
  const handleDismiss = useCallback(async (e, alert) => {
    e.stopPropagation();
    await markRead(alert);
  }, [markRead]);

  // Open the record this notification is about.
  const handleNotificationClick = useCallback(async (alert) => {
    if (!alert.route) return;      // nothing to open; use Dismiss instead
    setShowDropdown(false);
    await markRead(alert);
    if (onOpen) onOpen(alert.route);
  }, [markRead, onOpen]);

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
                <div
                  key={a.id}
                  className={`live-notif-item${a.route ? " clickable" : ""}`}
                  role={a.route ? "button" : undefined}
                  tabIndex={a.route ? 0 : undefined}
                  title={a.route ? "Open" : undefined}
                  onClick={() => handleNotificationClick(a)}
                  onKeyDown={(e) => {
                    if (a.route && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      handleNotificationClick(a);
                    }
                  }}
                >
                  {/* Dismiss sits outside the row's click target and stops
                      propagation, so "I have dealt with this" never navigates
                      you away from what you were doing. */}
                  <button
                    type="button"
                    className="live-notif-dismiss"
                    title="Mark as read"
                    aria-label={`Mark as read: ${a.message}`}
                    onClick={(e) => handleDismiss(e, a)}
                  >
                    &times;
                  </button>
                  <div className="live-notif-msg">{a.message}</div>
                  <div className="live-notif-row">
                    <span className="live-notif-time">{formatTime(a.timestamp)}</span>
                    <span className="live-notif-actions">
                      <button
                        type="button"
                        className="live-notif-gotit"
                        onClick={(e) => handleDismiss(e, a)}
                      >
                        Got it
                      </button>
                      {a.route && <span className="live-notif-go">Open &rsaquo;</span>}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
