import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { FiCheckCircle, FiAlertCircle, FiInfo, FiAlertTriangle, FiX } from "react-icons/fi";
import { useToast } from "../contexts/ToastContext";

// Everything here is styled INLINE and rendered through a portal straight into
// <body>, deliberately. The previous version relied on Toast.css plus theme
// variables (--card-bg, --success-rgb, ...) and on being mounted inside the
// React tree - any one of a missing stylesheet, an undefined variable, an
// ancestor creating a containing block for position:fixed, or a modal winning a
// z-index tie made the message silently invisible. A confirmation the user
// never sees is worse than no confirmation, so this one depends on nothing.

const ICONS = {
  success: <FiCheckCircle size={18} />,
  error: <FiAlertCircle size={18} />,
  warning: <FiAlertTriangle size={18} />,
  info: <FiInfo size={18} />,
};

// Red Tape toast: the same ink slab in both themes, with the meaning carried
// by the icon colour (and the role), not by flooding the whole card in colour.
const ICON_COLORS = {
  success: "#7ED3AC",
  error: "#FF9C93",
  warning: "#F1C26A",
  info: "#8DB3DE",
};

const containerStyle = {
  position: "fixed",
  right: "20px",
  bottom: "20px",
  zIndex: 2147483647,          // above every overlay in the app
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-end",      // stack toasts flush to the right edge
  gap: "8px",
  pointerEvents: "none",
  maxWidth: "calc(100vw - 24px)",
};

const toastStyle = {
  display: "flex",
  alignItems: "flex-start",
  gap: "10px",
  minWidth: "280px",
  maxWidth: "420px",
  padding: "12px 14px",
  borderRadius: "8px",
  background: "#1B1E25",
  border: "1px solid #2E333D",
  color: "#F1F2F4",
  fontFamily: "'IBM Plex Sans', 'Segoe UI', system-ui, sans-serif",
  fontSize: "0.8125rem",
  fontWeight: 500,
  lineHeight: 1.45,
  boxShadow: "0 24px 60px -12px rgba(20,23,30,.38), 0 4px 12px rgba(20,23,30,.12)",
  pointerEvents: "auto",
  animation: "toastIn 360ms cubic-bezier(.2,.7,.2,1)",
};

function ToastItem({ toast, onDismiss }) {
  const urgent = toast.type === "error" || toast.type === "warning";
  return (
    <div style={toastStyle} role={urgent ? "alert" : "status"} aria-live={urgent ? "assertive" : "polite"}>
      <span style={{ display: "flex", flexShrink: 0, marginTop: 1, color: ICON_COLORS[toast.type] || ICON_COLORS.info }}>{ICONS[toast.type] || ICONS.info}</span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        style={{
          background: "transparent", border: "none", color: "#F1F2F4",
          cursor: "pointer", padding: 0, display: "flex", flexShrink: 0, opacity: 0.7,
        }}
      >
        <FiX size={16} />
      </button>
    </div>
  );
}

export default function GlobalToast() {
  const { toasts, dismiss } = useToast();
  const [host, setHost] = useState(null);

  // document.body is only available once mounted in the browser.
  useEffect(() => { setHost(document.body); }, []);

  if (!host || toasts.length === 0) return null;

  return createPortal(
    <div style={containerStyle}>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>,
    host
  );
}
