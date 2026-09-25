import { createContext, useContext, useState, useRef, useCallback } from "react";

const LoadingContext = createContext(null);

export function LoadingProvider({ children }) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("Please wait...");
  const countRef = useRef(0);
  const timerRef = useRef(null);

  const showLoader = useCallback((msg) => {
    countRef.current += 1;
    const text = msg || "Please wait...";
    setMessage(text);

    if (countRef.current === 1) {
      timerRef.current = setTimeout(() => {
        setVisible(true);
      }, 200);
    }
  }, []);

  const hideLoader = useCallback(() => {
    countRef.current -= 1;
    if (countRef.current <= 0) {
      countRef.current = 0;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setVisible(false);
      setMessage("Please wait...");
    }
  }, []);

  const withLoading = useCallback(async (promise, msg) => {
    showLoader(msg);
    try {
      return await promise;
    } finally {
      hideLoader();
    }
  }, [showLoader, hideLoader]);

  return (
    <LoadingContext.Provider value={{ visible, message, withLoading, showLoader, hideLoader }}>
      {children}
    </LoadingContext.Provider>
  );
}

export function useLoading() {
  const ctx = useContext(LoadingContext);
  if (!ctx) throw new Error("useLoading must be used within LoadingProvider");
  return ctx;
}
