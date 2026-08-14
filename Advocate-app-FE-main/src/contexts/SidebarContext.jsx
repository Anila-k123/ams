import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

const SidebarContext = createContext(null);

export function SidebarProvider({ children }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 1024);
  const [desktopCollapsed, setDesktopCollapsed] = useState(() => {
    return localStorage.getItem("sidebarCollapsed") === "true";
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 1024;
      setIsMobile(mobile);
      if (!mobile) {
        setMobileOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const toggleSidebar = useCallback(() => {
    if (isMobile) {
      setMobileOpen((prev) => !prev);
    } else {
      setDesktopCollapsed((prev) => {
        const next = !prev;
        localStorage.setItem("sidebarCollapsed", next);
        return next;
      });
    }
  }, [isMobile]);

  const closeSidebar = useCallback(() => {
    if (isMobile) {
      setMobileOpen(false);
    } else {
      setDesktopCollapsed(true);
      localStorage.setItem("sidebarCollapsed", "true");
    }
  }, [isMobile]);

  const isCollapsed = isMobile ? false : desktopCollapsed;

  return (
    <SidebarContext.Provider value={{ isCollapsed, isMobile, toggleSidebar, closeSidebar, mobileOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}
