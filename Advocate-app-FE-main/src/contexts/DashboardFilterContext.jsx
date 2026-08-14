import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { jwtDecode } from "jwt-decode";
import dashboardService from "../services/DashboardService";

const DashboardFilterContext = createContext(null);

export function DashboardFilterProvider({ children, token }) {
  const [view, setViewRaw] = useState("month"); // day | week | month | year
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const lastKeyRef = useRef("");

  // Decode advocate email from token for cache scoping
  const advocateEmail = useMemo(() => {
    if (!token) return "";
    try { return jwtDecode(token).sub; } catch { return ""; }
  }, [token]);

  // Allow external override of loading state
  const [externalLoading, setExternalLoading] = useState(false);
  const isLoading = loading || externalLoading;

  // Format the current period label
  const periodLabel = useCallback(() => {
    const d = currentDate;
    switch (view) {
      case "day":
        return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
      case "week": {
        const startOfYear = new Date(d.getFullYear(), 0, 1);
        const week = Math.ceil((((d - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7);
        return `Week ${week}`;
      }
      case "month":
        return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      case "year":
        return `${d.getFullYear()}`;
      default:
        return "";
    }
  }, [view, currentDate]);

  // Check if navigation forward is disabled (future)
  const isNextDisabled = useCallback(() => {
    const now = new Date();
    switch (view) {
      case "day":
        return currentDate.toDateString() === now.toDateString();
      case "week": {
        const next = new Date(currentDate);
        next.setDate(next.getDate() + 7);
        return next > now;
      }
      case "month": {
        const next = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
        return next > now;
      }
      case "year":
        return currentDate.getFullYear() >= now.getFullYear();
      default:
        return false;
    }
  }, [view, currentDate]);

  const navigatePrev = useCallback(() => {
    const d = new Date(currentDate);
    switch (view) {
      case "day":
        d.setDate(d.getDate() - 1);
        break;
      case "week":
        d.setDate(d.getDate() - 7);
        break;
      case "month":
        d.setMonth(d.getMonth() - 1);
        break;
      case "year":
        d.setFullYear(d.getFullYear() - 1);
        break;
    }
    setCurrentDate(d);
  }, [view, currentDate]);

  const navigateNext = useCallback(() => {
    if (isNextDisabled()) return;
    const d = new Date(currentDate);
    switch (view) {
      case "day":
        d.setDate(d.getDate() + 1);
        break;
      case "week":
        d.setDate(d.getDate() + 7);
        break;
      case "month":
        d.setMonth(d.getMonth() + 1);
        break;
      case "year":
        d.setFullYear(d.getFullYear() + 1);
        break;
    }
    setCurrentDate(d);
  }, [view, currentDate, isNextDisabled]);

  const setView = useCallback((newView) => {
    setViewRaw(newView);
  }, []);

  const formatApiParams = useCallback(() => {
    const d = currentDate;
    switch (view) {
      case "day": {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return { view: "day", date: `${y}-${m}-${day}` };
      }
      case "week": {
        const startOfYear = new Date(d.getFullYear(), 0, 1);
        const week = Math.ceil((((d - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7);
        return { view: "week", week, year: d.getFullYear() };
      }
      case "month":
        return { view: "month", month: d.getMonth() + 1, year: d.getFullYear() };
      case "year":
        return { view: "year", year: d.getFullYear() };
      default:
        return { view: "month", month: d.getMonth() + 1, year: d.getFullYear() };
    }
  }, [view, currentDate]);

  // Fetch data when view or currentDate changes
  useEffect(() => {
    if (!token || !advocateEmail) return;

    const params = formatApiParams();
    const key = `${advocateEmail}|${params.view}|${params.date || ""}|${params.week || ""}|${params.month || ""}|${params.year || ""}`;
    if (key === lastKeyRef.current && data) return;
    lastKeyRef.current = key;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await dashboardService.fetchDashboard(token, params, advocateEmail);
        if (!cancelled && result) {
          setData(result);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Dashboard fetch error:", err);
          setError(err.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [token, view, currentDate, formatApiParams, advocateEmail, refreshKey]);

  const value = useMemo(() => ({
    view,
    setView,
    currentDate,
    setCurrentDate,
    periodLabel,
    navigatePrev,
    navigateNext,
    isNextDisabled: isNextDisabled(),
    data,
    loading: isLoading,
    error,
    setExternalLoading,
    invalidateCache: () => {
      const params = formatApiParams();
      dashboardService.invalidateCache(advocateEmail, params.view, params.date, params.week, params.month, params.year);
    },
    forceRefreshDashboard: () => {
      const params = formatApiParams();
      dashboardService.invalidateCache(advocateEmail, params.view, params.date, params.week, params.month, params.year);
      lastKeyRef.current = "";
      setRefreshKey(k => k + 1);
    },
  }), [view, currentDate, periodLabel, navigatePrev, navigateNext, isNextDisabled, data, isLoading, error, setExternalLoading, formatApiParams, advocateEmail, refreshKey]);

  return (
    <DashboardFilterContext.Provider value={value}>
      {children}
    </DashboardFilterContext.Provider>
  );
}

export function useDashboardFilter() {
  const ctx = useContext(DashboardFilterContext);
  if (!ctx) throw new Error("useDashboardFilter must be used within DashboardFilterProvider");
  return ctx;
}

export default DashboardFilterContext;
