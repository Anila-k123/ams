import React, { useState, useEffect, useRef, useCallback } from "react";
import { FiClock, FiX, FiEye, FiBell, FiBellOff } from "react-icons/fi";
import axios from "axios";

const SNOOZE_MINUTES = 5;
const SOUND_ENABLED_KEY = "advocate-hearing-sound";
// Which hearings the user has already dismissed today, so a reload does not
// bring the same popup straight back.
const DISMISSED_KEY = "advocate-hearing-dismissed";
// How close a hearing has to be before it is worth interrupting someone.
const IMMINENT_HOURS = 4;
const POLL_MS = 5 * 60 * 1000;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadDismissed() {
  // Stored per day so yesterday's dismissals cannot hide today's hearings.
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) || "{}");
    return raw.day === todayKey() && Array.isArray(raw.ids) ? raw.ids : [];
  } catch {
    return [];
  }
}

function saveDismissed(ids) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify({ day: todayKey(), ids }));
  } catch { /* private mode - the popup just returns after a reload */ }
}

// "10:30:00" on today's date -> Date, or null when the court gave no time.
function hearingMoment(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${String(timeStr).slice(0, 8)}`);
  return isNaN(d.getTime()) ? null : d;
}

export default function HearingAlertPopup({ onView }) {
  const [alerts, setAlerts] = useState([]);
  const [dismissedIds, setDismissedIds] = useState(loadDismissed);
  const snoozedUntilRef = useRef({});
  const audioRef = useRef(null);
  const announcedRef = useRef(new Set());
  const [soundEnabled, setSoundEnabled] = useState(
    () => localStorage.getItem(SOUND_ENABLED_KEY) !== "false"
  );

  useEffect(() => {
    try {
      audioRef.current = new Audio("/notification.mp3");
    } catch { /* no sound available; the popup still shows */ }
  }, []);

  // This used to subscribe to a "hearing-alert" WebSocket topic. There is no
  // /ws backend, so it never fired once - the popup was dead UI. It now reads
  // today's hearings over REST, which is also what the scheduled
  // HEARING_REMINDER emails are built from; those cover the days beforehand,
  // this covers "it is starting soon and you are at your desk".
  const load = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await axios.get("/api/events/today", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const now = new Date();
      const cutoff = new Date(now.getTime() + IMMINENT_HOURS * 3600 * 1000);

      const due = (Array.isArray(res.data) ? res.data : []).filter((e) => {
        if ((e.eventType || "").toUpperCase() !== "HEARING") return false;
        const snoozedUntil = snoozedUntilRef.current[e.id];
        if (snoozedUntil && snoozedUntil > now.getTime()) return false;
        if (dismissedIds.includes(e.id)) return false;
        const at = hearingMoment(e.date, e.time);
        // No time listed: still worth flagging once, since "sometime today"
        // is exactly when someone needs reminding.
        if (!at) return true;
        return at >= now && at <= cutoff;
      });

      setAlerts(due.map((e) => ({
        id: e.id,
        caseNumber: e.caseEntity?.caseNumber || e.caseEntity?.case_number || null,
        time: e.time ? String(e.time).slice(0, 5) : null,
        message: e.title || "Hearing listed today",
      })));

      // Chime only for a hearing not already announced this session.
      const fresh = due.filter((e) => !announcedRef.current.has(e.id));
      if (fresh.length && soundEnabled && audioRef.current) {
        audioRef.current.play().catch(() => {});
      }
      fresh.forEach((e) => announcedRef.current.add(e.id));
    } catch {
      /* leave whatever is on screen; a failed poll should not clear alerts */
    }
  }, [dismissedIds, soundEnabled]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [load]);

  const dismiss = useCallback((id) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    setDismissedIds((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id];
      saveDismissed(next);
      return next;
    });
  }, []);

  const snooze = useCallback((id) => {
    // Snooze is not a dismissal: remember a deadline and let the next poll
    // bring it back, so it survives a page reload.
    snoozedUntilRef.current[id] = Date.now() + SNOOZE_MINUTES * 60 * 1000;
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled((v) => {
      const next = !v;
      localStorage.setItem(SOUND_ENABLED_KEY, String(next));
      return next;
    });
  }, []);

  if (alerts.length === 0) return null;

  return (
    <div className="hearing-alerts-container">
      <div className="hearing-alerts-toolbar">
        <button className="hearing-sound-toggle" onClick={toggleSound}
                title={soundEnabled ? "Mute alerts" : "Enable sound"}>
          {soundEnabled ? <FiBell /> : <FiBellOff />}
        </button>
      </div>
      {alerts.map((alert) => (
        <div key={alert.id} className="hearing-alert-popup slide-in-down">
          <div className="hearing-alert-header">
            <FiClock className="hearing-alert-icon" />
            <span className="hearing-alert-title">Hearing today</span>
            <button className="hearing-alert-close" onClick={() => dismiss(alert.id)}><FiX /></button>
          </div>
          <div className="hearing-alert-body">
            <p className="hearing-alert-message">{alert.message}</p>
            <p className="hearing-alert-case">
              {alert.caseNumber && <><strong>Case:</strong> {alert.caseNumber} | </>}
              <strong>Time:</strong> {alert.time || "not listed"}
            </p>
          </div>
          <div className="hearing-alert-actions">
            <button className="hearing-alert-btn primary"
                    onClick={() => { dismiss(alert.id); if (onView) onView(alert); }}>
              <FiEye /> View
            </button>
            <button className="hearing-alert-btn" onClick={() => snooze(alert.id)}>
              Snooze {SNOOZE_MINUTES}m
            </button>
            <button className="hearing-alert-btn" onClick={() => dismiss(alert.id)}>
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
