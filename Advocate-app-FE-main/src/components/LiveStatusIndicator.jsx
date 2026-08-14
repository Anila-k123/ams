import React from "react";
import { useWebSocketContext } from "../contexts/realtime/WebSocketProvider";

const STATUS_MAP = {
  connected: { color: "#10b981", label: "Connected", dot: "\uD83D\uDFE2" },
  reconnecting: { color: "#f59e0b", label: "Reconnecting", dot: "\uD83D\uDFE1" },
  disconnected: { color: "#ef4444", label: "Disconnected", dot: "\uD83D\uDD34" },
};

export default function LiveStatusIndicator() {
  const { status } = useWebSocketContext();
  const s = STATUS_MAP[status] || STATUS_MAP.disconnected;

  return (
    <span className="live-status-indicator" title={s.label}>
      <span className="live-status-dot" style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: s.color,
        marginRight: 4,
        animation: status === "connected" ? "pulse-dot 2s infinite" : "none",
        boxShadow: status === "connected" ? `0 0 4px ${s.color}` : "none",
      }} />
      <span className="live-status-label" style={{ fontSize: 11, color: "var(--text-muted)" }}>
        {s.dot} {s.label}
      </span>
    </span>
  );
}
