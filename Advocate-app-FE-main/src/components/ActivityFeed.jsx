import React, { useState, useEffect, useRef, useCallback } from "react";
import { FiActivity } from "react-icons/fi";
import axios from "axios";
import { useWebSocketContext } from "../contexts/realtime/WebSocketProvider";

// Shape returned by /api/activities/my-activities -> the shape this feed renders.
function fromApi(a) {
  return { id: a.id, type: a.actionType, message: a.description, timestamp: a.timestamp };
}

export default function ActivityFeed({ maxItems = 10 }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const listRef = useRef(null);
  const { subscribe } = useWebSocketContext();

  // The feed used to be WebSocket-only, and there is no /ws backend - so it
  // showed "no recent activity" permanently. The audit middleware now writes
  // an `activities` row per state change, so read them over REST. Deliberately
  // uses my-activities (own activity, no permission needed) rather than the
  // AUDIT_VIEW-gated /api/activities.
  const load = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      const res = await axios.get("/api/activities/my-activities", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rows = Array.isArray(res.data) ? res.data : (res.data?.content || []);
      setActivities(rows.map(fromApi).slice(0, maxItems));
    } catch {
      /* leave the list empty; the empty state covers it */
    } finally {
      setLoading(false);
    }
  }, [maxItems]);

  useEffect(() => { load(); }, [load]);

  // Still honour live events when a WS backend exists, so this upgrades on its
  // own rather than needing a rewrite.
  useEffect(() => {
    const unsub = subscribe("activity", (event) => {
      setActivities((prev) =>
        [{ ...event, id: `live-${Date.now()}-${Math.random()}` }, ...prev].slice(0, maxItems));
    });
    return unsub;
  }, [subscribe, maxItems]);

  // Refresh when the user comes back to the tab, and after the assistant or a
  // page reports having changed something.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("assistant-refresh-dashboard", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("assistant-refresh-dashboard", onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [activities]);

  const formatTime = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { day: "2-digit", month: "short" });
  };

  const typeIcon = (type) => {
    if (!type) return "\uD83D\uDCCB";
    if (type.startsWith("CLIENT")) return "\uD83D\uDC64";
    if (type.startsWith("CASE")) return "\uD83D\uDCC1";
    if (type.startsWith("EXPENSE")) return "\uD83D\uDCB5";
    if (type.startsWith("INVOICE")) return "\uD83D\uDCC4";
    if (type.startsWith("PAYMENT")) return "\uD83D\uDCB0";
    if (type.startsWith("HEARING") || type.startsWith("EVENT")) return "\uD83D\uDD14";
    if (type.startsWith("DOCUMENT")) return "\uD83D\uDCC4";
    if (type.startsWith("TASK")) return "\u2705";
    if (type.startsWith("WORKSPACE")) return "\uD83D\uDDC2\uFE0F";
    return "\uD83D\uDCCB";
  };

  return (
    <div className="live-activity-feed">
      <div className="card-header-row">
        <h4><FiActivity /> Recent Activity</h4>
      </div>
      <div ref={listRef} className="live-activity-list">
        {loading ? (
          <p className="no-data">Loading activity…</p>
        ) : activities.length === 0 ? (
          <p className="no-data">No activity yet. Changes you make will appear here.</p>
        ) : (
          activities.map((a) => (
            <div key={a.id} className="live-activity-item slide-in">
              <span className="activity-icon">{typeIcon(a.type)}</span>
              <div className="activity-content">
                <span className="activity-message">{a.message}</span>
                <span className="activity-time">{formatTime(a.timestamp)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
