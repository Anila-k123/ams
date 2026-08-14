import React, { useState, useEffect, useRef } from "react";
import { FiActivity } from "react-icons/fi";
import { useWebSocketContext } from "../contexts/realtime/WebSocketProvider";

export default function ActivityFeed({ maxItems = 10 }) {
  const [activities, setActivities] = useState([]);
  const listRef = useRef(null);
  const { subscribe } = useWebSocketContext();

  useEffect(() => {
    const unsub = subscribe("activity", (event) => {
      setActivities((prev) => {
        const updated = [{ ...event, id: Date.now() + Math.random() }, ...prev];
        return updated.slice(0, maxItems);
      });
    });
    return unsub;
  }, [subscribe, maxItems]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [activities]);

  const formatTime = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const typeIcon = (type) => {
    if (!type) return "\uD83D\uDCCB";
    if (type.startsWith("CLIENT")) return "\uD83D\uDC64";
    if (type.startsWith("CASE")) return "\uD83D\uDCC1";
    if (type.startsWith("EXPENSE")) return "\uD83D\uDCB5";
    if (type.startsWith("INVOICE")) return "\uD83D\uDCC4";
    if (type.startsWith("PAYMENT")) return "\uD83D\uDCB0";
    if (type.startsWith("HEARING")) return "\uD83D\uDD14";
    if (type.startsWith("DOCUMENT")) return "\uD83D\uDCC4";
    return "\uD83D\uDCCB";
  };

  return (
    <div className="live-activity-feed">
      <div className="card-header-row">
        <h4><FiActivity /> Recent Activity</h4>
      </div>
      <div ref={listRef} className="live-activity-list">
        {activities.length === 0 ? (
          <p className="no-data">No recent activity. Perform actions to see live updates.</p>
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
