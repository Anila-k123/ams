import { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";

const ToastContext = createContext(null);

let toastIdCounter = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const removeToast = useCallback((id) => {
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = "info", duration) => {
    const id = ++toastIdCounter;
    // Long enough to be read after the eye moves back from the form that was
    // just submitted; errors stay longest. Any toast can be dismissed early.
    const durations = { success: 7000, error: 14000, warning: 10000, info: 8000 };
    const ms = duration || durations[type] || 4000;

    setToasts((prev) => [...prev, { id, message, type }]);

    timersRef.current[id] = setTimeout(() => {
      removeToast(id);
    }, ms);

    return id;
  }, [removeToast]);

  const success = useCallback((msg, duration) => addToast(msg, "success", duration), [addToast]);
  const error = useCallback((msg, duration) => addToast(msg, "error", duration), [addToast]);
  const warning = useCallback((msg, duration) => addToast(msg, "warning", duration), [addToast]);
  const info = useCallback((msg, duration) => addToast(msg, "info", duration), [addToast]);
  const dismiss = useCallback((id) => removeToast(id), [removeToast]);

  // Dev-only escape hatch: lets a toast be fired straight from the browser
  // console (`__toast.success("hi")`), which separates "the toast system is
  // broken" from "the handler never ran" without guessing.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__toast = { success, error, warning, info };
    return () => { delete window.__toast; };
  }, [success, error, warning, info]);

  return (
    <ToastContext.Provider value={{ toasts, success, error, warning, info, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
