import React, { useState, useEffect, useRef, useCallback } from "react";
import { FiClock, FiX, FiEye, FiBell, FiBellOff } from "react-icons/fi";
import { useWebSocketContext } from "../contexts/realtime/WebSocketProvider";

const SNOOZE_MINUTES = 5;
const SOUND_ENABLED_KEY = "advocate-hearing-sound";

export default function HearingAlertPopup({ onView }) {
  const [alerts, setAlerts] = useState([]);
  const { subscribe } = useWebSocketContext();
  const audioRef = useRef(null);
  const [soundEnabled, setSoundEnabled] = useState(
    () => localStorage.getItem(SOUND_ENABLED_KEY) !== "false"
  );

  useEffect(() => {
    try {
      audioRef.current = new Audio("/notification.mp3");
    } catch {}
  }, []);

  useEffect(() => {
    const unsub = subscribe("hearing-alert", (event) => {
      setAlerts((prev) => {
        if (prev.some((a) => a.eventId === event.eventId)) return prev;
        return [...prev, { ...event, id: Date.now() + Math.random() }];
      });
      if (soundEnabled && audioRef.current) {
        audioRef.current.play().catch(() => {});
      }
    });
    return unsub;
  }, [subscribe, soundEnabled]);

  const dismiss = useCallback((id) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const snooze = useCallback((id) => {
    dismiss(id);
    setTimeout(() => {
      const alert = alerts.find((a) => a.id === id);
      if (alert) {
        setAlerts((prev) => [...prev, { ...alert, id: Date.now() + Math.random() }]);
      }
    }, SNOOZE_MINUTES * 60 * 1000);
  }, [alerts, dismiss]);

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
        <button className="hearing-sound-toggle" onClick={toggleSound} title={soundEnabled ? "Mute alerts" : "Enable sound"}>
          {soundEnabled ? <FiBell /> : <FiBellOff />}
        </button>
      </div>
      {alerts.map((alert) => (
        <div key={alert.id} className="hearing-alert-popup slide-in-down">
          <div className="hearing-alert-header">
            <FiClock className="hearing-alert-icon" />
            <span className="hearing-alert-title">Upcoming Hearing</span>
            <button className="hearing-alert-close" onClick={() => dismiss(alert.id)}><FiX /></button>
          </div>
          <div className="hearing-alert-body">
            <p className="hearing-alert-message">{alert.message}</p>
            <p className="hearing-alert-case">
              {alert.caseNumber && <><strong>Case:</strong> {alert.caseNumber} | </>}
              <strong>Time:</strong> {alert.time || "N/A"}
            </p>
          </div>
          <div className="hearing-alert-actions">
            <button className="hearing-alert-btn primary" onClick={() => { dismiss(alert.id); if (onView) onView(alert); }}>
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
