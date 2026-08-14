import { useEffect, useRef, useState } from "react";
import { FiCheckCircle, FiAlertCircle, FiInfo, FiAlertTriangle, FiX } from "react-icons/fi";
import "../assets/styles/Toast.css";

const ICONS = {
  success: <FiCheckCircle size={20} />,
  error: <FiAlertCircle size={20} />,
  warning: <FiAlertTriangle size={20} />,
  info: <FiInfo size={20} />,
};

const DURATIONS = {
  success: 3500,
  warning: 5000,
  error: 7000,
  info: 4000,
};

export default function Toast({ message, type = "info", onClose }) {
  const [closing, setClosing] = useState(false);
  const timerRef = useRef(null);
  const toastRef = useRef(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const initiateClose = () => {
    clearTimer();
    setClosing(true);
  };

  useEffect(() => {
    if (!message) return;

    setClosing(false);

    const duration = DURATIONS[type] || 4000;
    timerRef.current = setTimeout(() => initiateClose(), duration);

    const handleClickOutside = (e) => {
      if (toastRef.current && !toastRef.current.contains(e.target)) {
        initiateClose();
      }
    };

    const handleRouteChange = () => {
      initiateClose();
    };

    const attachTimer = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
      window.addEventListener("popstate", handleRouteChange);
    }, 60);

    return () => {
      clearTimer();
      clearTimeout(attachTimer);
      document.removeEventListener("click", handleClickOutside);
      window.removeEventListener("popstate", handleRouteChange);
    };
  }, [message, type]);

  useEffect(() => {
    if (!closing) return;
    const timeout = setTimeout(() => onClose(), 250);
    return () => clearTimeout(timeout);
  }, [closing, onClose]);

  if (!message) return null;

  return (
    <div className={`toast-wrapper ${closing ? "toast-closing" : ""}`}>
      <div className={`toast toast-${type}`} ref={toastRef}>
        {ICONS[type] || ICONS.info}
        <span>{message}</span>
        <button className="toast-close" onClick={initiateClose} aria-label="Dismiss">
          <FiX size={16} />
        </button>
      </div>
    </div>
  );
}
