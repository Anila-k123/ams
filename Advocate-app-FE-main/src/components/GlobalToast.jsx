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
  success: <FiCheckCircle size={22} />,
  error: <FiAlertCircle size={22} />,
  warning: <FiAlertTriangle size={22} />,
  info: <FiInfo size={22} />,
};

const COLORS = {
  success: "#15803d",
  error: "#b91c1c",
  warning: "#b45309",
  info: "#1d4ed8",
};

const containerStyle = {
  position: "fixed",
  top: "50%",
  left: "50%",
  transform: "translate(-50%, -50%)",
  zIndex: 2147483647,          // above every overlay in the app
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "12px",
  pointerEvents: "none",
  maxWidth: "92vw",
};

function toastStyle(type) {
  return {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    minWidth: "320px",
    maxWidth: "92vw",
    padding: "20px 26px",
    borderRadius: "12px",
    background: COLORS[type] || COLORS.info,
    color: "#ffffff",
    fontSize: "1.0625rem",
    fontWeight: 600,
    lineHeight: 1.4,
    boxShadow: "0 18px 50px rgba(0,0,0,0.35)",
    pointerEvents: "auto",
    opacity: 1,
  };
}

function ToastItem({ toast, onDismiss }) {
  return (
    <div style={toastStyle(toast.type)} role="status" aria-live="polite">
      <span style={{ display: "flex", flexShrink: 0 }}>{ICONS[toast.type] || ICONS.info}</span>
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        style={{
          background: "transparent", border: "none", color: "#ffffff",
          cursor: "pointer", padding: 4, display: "flex", flexShrink: 0, opacity: 0.85,
        }}
      >
        <FiX size={18} />
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
