import { useEffect, useState } from "react";
import { FiCheckCircle, FiAlertCircle, FiInfo, FiAlertTriangle, FiX } from "react-icons/fi";
import { useToast } from "../contexts/ToastContext";
import "../assets/styles/Toast.css";

const ICONS = {
  success: <FiCheckCircle size={20} />,
  error: <FiAlertCircle size={20} />,
  warning: <FiAlertTriangle size={20} />,
  info: <FiInfo size={20} />,
};

function ToastItem({ toast, onDismiss }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    setExiting(false);
  }, [toast.id]);

  const handleDismiss = () => {
    setExiting(true);
    setTimeout(() => onDismiss(toast.id), 250);
  };

  return (
    <div className={`toast toast-${toast.type} ${exiting ? "toast-exit" : "toast-enter"}`}>
      {ICONS[toast.type] || ICONS.info}
      <span className="toast-text">{toast.message}</span>
      <button className="toast-close" onClick={handleDismiss} aria-label="Dismiss">
        <FiX size={16} />
      </button>
    </div>
  );
}

export default function GlobalToast() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
