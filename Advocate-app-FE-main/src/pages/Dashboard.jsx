import React, { lazy, Suspense, useEffect, useState, useRef } from "react";
import { useNavigate, NavLink, Routes, Route, Link, useLocation, Navigate } from "react-router-dom";
import axios from "axios";
import { useTheme } from "../contexts/ThemeContext.jsx";
import { useLoading } from "../contexts/LoadingContext";
import {
  FiBriefcase, FiFolder, FiUsers, FiCalendar, FiFileText,
  FiTrendingUp, FiSettings, FiLogOut, FiSearch,
  FiCheckCircle, FiCheckSquare, FiAlertCircle, FiMessageSquare,
  FiActivity, FiChevronDown, FiDownload
} from "react-icons/fi";
import ReportService from "../services/ReportService";
import { formatCurrency } from "../utils/formatCurrency";
import {
  PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";

import "../assets/styles/Dashboard.css";
import "../assets/styles/Assistant.css";
import "../assets/styles/RealTime.css";
import "../assets/styles/ReportsCenter.css";
import { DashboardFilterProvider, useDashboardFilter } from "../contexts/DashboardFilterContext";
import { AssistantProvider } from "../contexts/AssistantContext";
import { WebSocketProvider, useWebSocketContext } from "../contexts/realtime/WebSocketProvider";
import { SidebarProvider, useSidebar } from "../contexts/SidebarContext";
import { PermissionProvider, usePermission } from "../contexts/PermissionContext";
import dashboardService from "../services/DashboardService";
import DashboardTimeNavigator from "../components/DashboardTimeNavigator";
import TimeSwitcher from "../components/TimeSwitcher";
import AssistantPanel from "../components/AssistantPanel";
import PermissionRoute from "../components/PermissionRoute";
import NotificationBell from "../components/NotificationBell";
import ActivityFeed from "../components/ActivityFeed";
import HearingAlertPopup from "../components/HearingAlertPopup";
import SearchModal from "../components/SearchModal";
import GlobalSearchModal from "../components/GlobalSearchModal";
import { SearchProvider } from "../contexts/SearchContext";
import {
  Skeleton, SkeletonCard, SkeletonChart, SkeletonHearingItem,
  SkeletonList, SkeletonTaskItem, SkeletonInvoiceRow
} from "../components/Skeleton";

// Nested sub-pages (lazy-loaded)
const Cases = lazy(() => import("./Cases.jsx"));
const AddCase = lazy(() => import("./AddCase.jsx"));
const DisplayBoard = lazy(() => import("./DisplayBoard.jsx"));
const DailyCauselist = lazy(() => import("./DailyCauselist.jsx"));
const Clients = lazy(() => import("./Clients.jsx"));
const Expenses = lazy(() => import("./Expenses.jsx"));
const HearingsPage = lazy(() => import("./HearingsPage.jsx"));
const DocumentsPanel = lazy(() => import("./DocumentsPanel.jsx"));
const InvoicesPanel = lazy(() => import("./InvoicesPanel.jsx"));
const ProfilePage = lazy(() => import("./ProfilePage.jsx"));
const ReportsCenter = lazy(() => import("./ReportsCenter.jsx"));
const TasksPage = lazy(() => import("./TasksPage.jsx"));
const NotificationsCenter = lazy(() => import("./NotificationsCenter.jsx"));
const SystemActivity = lazy(() => import("./SystemActivity.jsx"));
const BackupPage = lazy(() => import("./BackupPage.jsx"));
const UserManagement = lazy(() => import("./UserManagement.jsx"));
const RoleManagement = lazy(() => import("./RoleManagement.jsx"));
const CommunicationDashboard = lazy(() => import("./CommunicationDashboard.jsx"));
const CommunicationSettings = lazy(() => import("./CommunicationSettings.jsx"));
const CommunicationHistory = lazy(() => import("./CommunicationHistory.jsx"));
const AppealAlert = lazy(() => import("./AppealAlert.jsx"));
const Acts = lazy(() => import("./Acts.jsx"));
const ActDetail = lazy(() => import("./ActDetail.jsx"));
const CaseDetail = lazy(() => import("./CaseDetail.jsx"));

// --- Active bar shape for hover growth animation ---
function ActiveBarShape({ x, y, width, height, fill, stroke, strokeWidth, ...rest }) {
  const scale = 1.04;
  const newH = height * scale;
  const newY = y - (newH - height);
  return (
    <rect
      x={x} y={newY} width={width} height={Math.max(newH, 0)}
      fill={fill} stroke={stroke || fill} strokeWidth={strokeWidth || 1.5}
      rx={3} ry={3}
      style={{ transition: "all 0.2s ease" }}
    />
  );
}

// --- Count-up animation ---
function CountUp({ value, duration = 1000 }) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);
  const rafRef = useRef(null);
  useEffect(() => {
    const start = prevRef.current;
    prevRef.current = value;
    const diff = value - start;
    if (diff === 0) {
      setDisplay(Number(value));
      return;
    }
    const startTime = performance.now();
    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + diff * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);
  return <>{display.toLocaleString()}</>;
}

// --- Empty State Component ---
function EmptyState({ icon, title, desc }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-desc">{desc}</div>
    </div>
  );
}

// --- Pie chart colors ---
const STATUS_COLORS = { ACTIVE: "#3b82f6", PENDING: "#f59e0b", CLOSED: "#10b981", DISMISSED: "#ef4444" };
const PIE_COLORS = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444"];

// ====== MAIN EXPORT ======
export default function Dashboard() {
  const navigate = useNavigate();
  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!token) {
      navigate("/login");
      return;
    }
  }, [token, navigate]);

  if (!token) return null;

  return (
    <DashboardFilterProvider token={token}>
      <AssistantProvider token={token}>
        <WebSocketProvider>
          <SidebarProvider>
            <PermissionProvider>
        <DashboardShell />
            </PermissionProvider>
      </SidebarProvider>
        </WebSocketProvider>
      </AssistantProvider>
    </DashboardFilterProvider>
  );
}

// ====== Permission-gated wrapper ======
function IfPermitted({ perm, children }) {
  const { hasPermission, loading } = usePermission();
  if (loading) return null;
  return hasPermission(perm) ? children : null;
}

// ====== INNER SHELL (has access to context) ======
function DashboardShell() {
  const navigate = useNavigate();
  const token = localStorage.getItem("token");
  const { theme, toggleTheme } = useTheme();
  const { withLoading } = useLoading();
  const [fullName, setFullName] = useState(localStorage.getItem("fullName") || "Advocate Y");
  const [email, setEmail] = useState(localStorage.getItem("email") || "advocate@example.com");
  const [role, setRole] = useState(localStorage.getItem("role") || "ADVOCATE");

  // Dashboard widgets state (atomic — updated by single setState call)
  const [dash, setDash] = useState({
    totalCases: 0, activeCases: 0, totalClients: 0,
    upcomingHearingsCount: 0, overdueInvoices: 0,
    caseStatusData: [], courtStatsData: [], monthlyData: [], incomeExpenseData: [],
    hearings: [], recentInvoices: [], invoiceStats: { paid: 0, unpaid: 0, overdue: 0 },
    activities: [], tasks: [], recentClients: [], recentCases: [],
  });
  const [docStats, setDocStats] = useState({ totalDocuments: 0, totalStorageBytes: 0, categoryCounts: {} });
  const [recentDocs, setRecentDocs] = useState([]);

  // Notifications
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  // Global Search
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [casesOpen, setCasesOpen] = useState(true);

  // Audio Alerts

  const { isCollapsed, isMobile, toggleSidebar, closeSidebar, mobileOpen } = useSidebar();
  const location = useLocation();

  const PAGE_TITLES = {
    "/dashboard": "Dashboard",
    "/dashboard/cases": "Cases",
    "/dashboard/display-board": "Display Board",
    "/dashboard/daily-causelist": "Daily Causelist",
    "/dashboard/clients": "Clients",
    "/dashboard/hearings": "Hearings",
    "/dashboard/invoices": "Invoices",
    "/dashboard/expenses": "Expenses",
    "/dashboard/documents": "Documents",
    "/dashboard/tasks": "Tasks",
    "/dashboard/reports": "Reports",
    "/dashboard/notifications": "Notifications",
    "/dashboard/appeal-alert": "Appeal Alert",
    "/dashboard/acts": "Acts",
    "/dashboard/activity": "System Activity",
    "/dashboard/backup": "Backup",
    "/dashboard/users": "User Management",
    "/dashboard/roles": "Role Management",
    "/dashboard/settings": "Settings",
    "/dashboard/communication": "Communication Overview",
    "/dashboard/communication/settings": "Communication Settings",
    "/dashboard/communication/history": "Communication History",
  };

  const currentPath = location.pathname.replace(/\/$/, "") || "/dashboard";
  const pageTitle = PAGE_TITLES[currentPath] || "Dashboard";
  const isDashboardHome = currentPath === "/dashboard";

  // ESC closes sidebar
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        closeSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeSidebar]);

  // Context: filtered dashboard data
  const filter = useDashboardFilter();
  const { data, loading, view } = filter;

  // Live dashboard updates
  const { subscribe: wsSubscribe } = useWebSocketContext();

  useEffect(() => {
    if (!wsSubscribe) return;
    const unsub = wsSubscribe("dashboard", () => {
      filter.invalidateCache();
      filter.forceRefreshDashboard();
    });
    return unsub;
  }, [wsSubscribe, filter]);

  // Profile sync
  useEffect(() => {
    axios.get("/api/advocates/profile", {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => {
        if (res.data && res.data.fullName) {
          setFullName(res.data.fullName);
          localStorage.setItem("fullName", res.data.fullName);
          if (res.data.email) {
            setEmail(res.data.email);
            localStorage.setItem("email", res.data.email);
          }
        }
      })
      .catch(() => {});
  }, [token]);

  // Sync context data into local state when data changes
  useEffect(() => {
    if (!data) return;
    // Animate transition: use animation class
    const grid = document.querySelector(".dashboard-grid-container");
    if (grid) {
      grid.classList.remove("period-enter");
      grid.classList.add("period-exit");
      requestAnimationFrame(() => {
        grid.classList.remove("period-exit");
        grid.classList.add("period-enter");
      });
    }

    setDash({
      totalCases: data.summary?.totalCases ?? 0,
      activeCases: data.summary?.activeCases ?? 0,
      totalClients: data.summary?.clients ?? 0,
      upcomingHearingsCount: data.summary?.upcomingHearings ?? 0,
      overdueInvoices: data.summary?.pendingInvoices ?? 0,
      caseStatusData: data.caseStatus?.items
        ? data.caseStatus.items.map(i => ({ name: i.status, value: i.count }))
        : [],
      courtStatsData: data.courtStats?.items ?? [],
      monthlyData: data.monthlyCases?.items
        ? data.monthlyCases.items.map(m => ({ month: m.month, created: m.created ?? 0, closed: m.closed ?? 0 }))
        : [],
      incomeExpenseData: data.incomeExpense?.items ?? [],
      hearings: data.hearings ?? [],
      invoiceStats: data.invoiceSummary ?? { paid: 0, unpaid: 0, overdue: 0 },
      recentInvoices: data.invoices ? data.invoices.slice(0, 3) : [],
      activities: data.activities ?? [],
      tasks: data.tasks ?? [],
      recentClients: data.recentClients ?? [],
      recentCases: data.recentCases ?? [],
    });
  }, [data]);

  // Fetch document stats separately
  useEffect(() => {
    if (!token) return;
    const fetchDocData = async () => {
      try {
        const [statsRes, listRes] = await Promise.all([
          fetch(`${window.API_BASE}/api/documents/stats`, {
            headers: { Authorization: `Bearer ${token}` }
          }),
          fetch(`${window.API_BASE}/api/documents/list`, {
            headers: { Authorization: `Bearer ${token}` }
          })
        ]);
        if (statsRes.ok) {
          const stats = await statsRes.json();
          setDocStats(stats);
        }
        if (listRes.ok) {
          const docs = await listRes.json();
          setRecentDocs(docs.slice(0, 5));
        }
      } catch (err) {
        console.error("Error fetching doc stats:", err);
      }
    };
    fetchDocData();
  }, [token]);

  // Chatbot events
  useEffect(() => {
    const h1 = () => {};
    const h2 = () => {};
    window.addEventListener("chatbot-filter-cases", h1);
    window.addEventListener("chatbot-show-today-hearings", h2);
    return () => {
      window.removeEventListener("chatbot-filter-cases", h1);
      window.removeEventListener("chatbot-show-today-hearings", h2);
    };
  }, []);


  const handleToggleTask = async (id) => {
    try {
      await withLoading(
        axios.put(`/api/workspace/tasks/${id}/toggle`, {}, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        "Toggling task..."
      );
      // Was GET /api/dashboard/tasks, which does not exist - a 404 on every
      // toggle, so the checkbox never reflected the change. Uses the
      // workspace task API, the one the Tasks page and CaseDetail use;
      // /api/tasks is a legacy table nothing writes to.
      const res = await withLoading(
        axios.get("/api/workspace/tasks/all", { headers: { Authorization: `Bearer ${token}` } }),
        "Refreshing tasks..."
      );
      const rows = Array.isArray(res.data) ? res.data : (res.data?.content || []);
      setDash(prev => ({ ...prev, tasks: rows.filter(t => !t.completed).slice(0, 5) }));
    } catch (err) {
      console.error("Error toggling task:", err);
    }
  };

  const handleSearchChange = async (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    if (query.trim().length < 2) {
      setSearchResults(null);
      setShowSuggestions(false);
      return;
    }
    try {
      const res = await withLoading(
        axios.get(`/api/search?keyword=${encodeURIComponent(query)}`, {
          headers: { Authorization: `Bearer ${token}` }
        }),
        "Searching..."
      );
      setSearchResults(res.data);
      setShowSuggestions(true);
    } catch (err) {
      console.error("Error in global search:", err);
    }
  };

  const handleToggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    toggleTheme();
    withLoading(
      axios.put(
        "/api/advocates/settings",
        { theme: newTheme, fullName, phone: "" },
        { headers: { Authorization: `Bearer ${token}` } }
      ),
      "Updating theme..."
    ).catch(() => {});
  };

  const handleLogout = async () => {
    try {
      await axios.post("/api/advocates/logout", {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (e) { /* ignore */ }
    dashboardService.clearAllCache();
    localStorage.clear();
    navigate("/login");
  };

  // Ctrl+K global search
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleSearchNavigate = (type, item) => {
    setSearchOpen(false);
    const search = item.name || item.caseTitle || item.caseNumber || item.documentName || item.originalName || item.invoiceNumber || item.title;
    const id = item.id;
    switch (type) {
      case "clients": navigate("/dashboard/clients", { state: { search, id } }); break;
      case "cases": navigate("/dashboard/cases", { state: { search, id } }); break;
      case "documents": navigate("/dashboard/documents", { state: { search, id } }); break;
      case "invoices": navigate("/dashboard/invoices", { state: { search, id } }); break;
      case "expenses": navigate("/dashboard/expenses", { state: { search, id } }); break;
      case "tasks": navigate("/dashboard/tasks", { state: { search, id } }); break;
      case "events": navigate("/dashboard/hearings", { state: { search, id } }); break;
      case "hearings": navigate("/dashboard/hearings", { state: { search, id } }); break;
      case "payments": navigate("/dashboard/cases", { state: { search, id } }); break;
      default: break;
    }
  };

  const handleQuickAction = (action) => {
    navigate(`/dashboard/${action}`);
  };

  return (
    <div className={`dashboard-root ${!isMobile && isCollapsed ? "sidebar-collapsed" : ""} ${isMobile && mobileOpen ? "sidebar-mobile-open" : ""}`}>

      {/* Mobile overlay backdrop */}
      {isMobile && mobileOpen && <div className="sidebar-overlay" onClick={closeSidebar} />}

      {/* ===== SIDEBAR ===== */}
      <aside className="left-sidebar">
        <div className="brand">
          <div className="brand-logo">⚖️</div>
          <div>
            <div className="brand-name">AdvocateApp</div>
            <div className="brand-sub">Practice Manager</div>
          </div>
        </div>

        {/* Global Search Toggle */}
        <div className="sidebar-search-btn" onClick={() => setSearchOpen(true)}>
          <FiSearch className="sidebar-search-icon" />
          <span className="sidebar-search-txt">Search</span>
          <span className="sidebar-search-shortcut">Ctrl+K</span>
        </div>

        <nav className="nav">
          <ul>
            <li>
                <NavLink to="/dashboard" end className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Dashboard">
                  <span className="nav-icon">📊</span>
                  <span className="nav-text">Dashboard</span>
                </NavLink>
            </li>
            <li className="nav-group">
                <button
                  type="button"
                  className="nav-link nav-group-toggle"
                  onClick={() => setCasesOpen((o) => !o)}
                  title="Cases"
                  aria-expanded={casesOpen}
                >
                  <span className="nav-icon">💼</span>
                  <span className="nav-text">Cases</span>
                  <FiChevronDown className={`nav-group-chevron ${casesOpen ? "open" : ""}`} />
                </button>
                {casesOpen && (
                  <ul className="nav-submenu">
                    <li>
                      <NavLink to="/dashboard/cases" end className={({ isActive }) => isActive ? "nav-link sub active" : "nav-link sub"} title="Workspace">
                        <span className="nav-icon sub-nav-icon">🗂️</span>
                        <span className="nav-text">Workspace</span>
                      </NavLink>
                    </li>
                    <li>
                      <NavLink to="/dashboard/daily-causelist" className={({ isActive }) => isActive ? "nav-link sub active" : "nav-link sub"} title="Daily Causelist">
                        <span className="nav-icon sub-nav-icon">📅</span>
                        <span className="nav-text">Daily Causelist</span>
                      </NavLink>
                    </li>
                    <li>
                      <NavLink to="/dashboard/display-board" className={({ isActive }) => isActive ? "nav-link sub active" : "nav-link sub"} title="Display Board">
                        <span className="nav-icon sub-nav-icon">📋</span>
                        <span className="nav-text">Display Board</span>
                      </NavLink>
                    </li>
                  </ul>
                )}
            </li>
            <li>
                <NavLink to="/dashboard/clients" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Clients">
                  <span className="nav-icon">👥</span>
                  <span className="nav-text">Clients</span>
                </NavLink>
            </li>
            <li>
                <NavLink to="/dashboard/hearings" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Hearings">
                  <span className="nav-icon">📅</span>
                  <span className="nav-text">Hearings</span>
                </NavLink>
            </li>
            <li>
                <NavLink to="/dashboard/invoices" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Invoices">
                  <span className="nav-icon">💵</span>
                  <span className="nav-text">Invoices</span>
                </NavLink>
            </li>
            <li>
                <NavLink to="/dashboard/expenses" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Expenses">
                  <span className="nav-icon">💸</span>
                  <span className="nav-text">Expenses</span>
                </NavLink>
            </li>
            <li>
                <NavLink to="/dashboard/documents" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Documents">
                  <span className="nav-icon">📂</span>
                  <span className="nav-text">Documents</span>
                </NavLink>
            </li>
            <li>
                <NavLink to="/dashboard/tasks" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Tasks">
                  <span className="nav-icon">📋</span>
                  <span className="nav-text">Tasks</span>
                </NavLink>
            </li>
            <li>
                <NavLink to="/dashboard/reports" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Reports">
                  <span className="nav-icon">📈</span>
                  <span className="nav-text">Reports</span>
                </NavLink>
            </li>
            <li>
                <NavLink to="/dashboard/notifications" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Notifications">
                  <span className="nav-icon">📨</span>
                  <span className="nav-text">Notifications</span>
                </NavLink>
            </li>
            <li>
                <NavLink to="/dashboard/appeal-alert" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Appeal Alert">
                  <span className="nav-icon">🔔</span>
                  <span className="nav-text">Appeal Alert</span>
                </NavLink>
            </li>
            <li>
                <NavLink to="/dashboard/acts" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Acts">
                  <span className="nav-icon">📜</span>
                  <span className="nav-text">Acts</span>
                </NavLink>
            </li>
            <li>
              <Link to="#" className="nav-link" onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent("assistant-toggle-open")); }} title="AI Assistant">
                <span className="nav-icon">💬</span>
                <span className="nav-text">AI Assistant</span>
              </Link>
            </li>
            <li>
                <NavLink to="/dashboard/settings" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Settings">
                  <span className="nav-icon">⚙️</span>
                  <span className="nav-text">Settings</span>
                </NavLink>
            </li>
            <IfPermitted perm="BACKUP_MANAGE">
              <li>
                <NavLink to="/dashboard/backup" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Backup">
                  <span className="nav-icon">🔐</span>
                  <span className="nav-text">Backup</span>
                </NavLink>
              </li>
            </IfPermitted>
            <li className="nav-section-label">Administration</li>
            <IfPermitted perm="AUDIT_VIEW">
              <li>
                <NavLink to="/dashboard/activity" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="System Activity">
                  <span className="nav-icon">📋</span>
                  <span className="nav-text">System Activity</span>
                </NavLink>
              </li>
            </IfPermitted>
            <IfPermitted perm="USER_MANAGE">
              <li>
                <NavLink to="/dashboard/users" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="User Management">
                  <span className="nav-icon">👤</span>
                  <span className="nav-text">Users</span>
                </NavLink>
              </li>
            </IfPermitted>
            <IfPermitted perm="ROLE_MANAGE">
              <li>
                <NavLink to="/dashboard/roles" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Role Management">
                  <span className="nav-icon">🛡️</span>
                  <span className="nav-text">Roles</span>
                </NavLink>
              </li>
            </IfPermitted>
            <li className="nav-section-label">Communication</li>
            <li>
                <NavLink to="/dashboard/communication" end className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Communication Overview">
                  <span className="nav-icon">📨</span>
                  {/* Not "Dashboard": the sidebar already has one, and two
                      entries with the same word is a coin toss for the user. */}
                  <span className="nav-text">Overview</span>
                </NavLink>
            </li>
            <li>
                <NavLink to="/dashboard/communication/settings" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Communication Settings">
                  <span className="nav-icon sub-nav-icon">⚙️</span>
                  <span className="nav-text">Settings</span>
                </NavLink>
            </li>
            <li>
                <NavLink to="/dashboard/communication/history" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"} title="Communication History">
                  <span className="nav-icon sub-nav-icon">📋</span>
                  <span className="nav-text">History</span>
                </NavLink>
            </li>
          </ul>
        </nav>

        <div className="sidebar-profile-card">
          <div className="profile-avatar">{fullName.charAt(0).toUpperCase()}</div>
          <div className="profile-details">
            <span className="profile-name">{fullName}</span>
            <span className="profile-email">{email}</span>
          </div>
          <button className="sidebar-logout-btn" onClick={handleLogout} title="Logout">
            <FiLogOut />
          </button>
        </div>
      </aside>

      {/* ===== MAIN AREA ===== */}
      <main className="main-area">
        <HearingAlertPopup onView={(alert) => navigate("/dashboard/hearings")} />
        {/* TOPBAR */}
        <header className="topbar">
          <div className="top-left">
            <button className="hamburger-btn" onClick={toggleSidebar} aria-label="Toggle sidebar" title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
              <div className={`hamburger-icon ${(!isMobile && isCollapsed) || (isMobile && mobileOpen) ? "active" : ""}`}>
                <span></span>
                <span></span>
                <span></span>
              </div>
            </button>
            <div>
              <h2>{pageTitle}</h2>
              {isDashboardHome && <div className="subtle">Welcome back, {fullName}</div>}
            </div>
          </div>

          {/* Search */}
          <div className="search-bar-container">
            <div className="search-input-box">
              <FiSearch className="search-icon" />
              <input
                type="text"
                placeholder="Search cases, clients, hearings..."
                value={searchQuery}
                onChange={handleSearchChange}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              />
            </div>
            {showSuggestions && searchResults && (
              <div className="autocomplete-suggestions">
                {searchResults.cases?.length > 0 && (
                  <div className="suggestion-section">
                    <h5>Cases</h5>
                    {searchResults.cases.map(c => (
                      <Link key={c.id} to="/dashboard/cases" className="suggestion-item">{c.caseNumber} — {c.caseTitle}</Link>
                    ))}
                  </div>
                )}
                {searchResults.clients?.length > 0 && (
                  <div className="suggestion-section">
                    <h5>Clients</h5>
                    {searchResults.clients.map(c => (
                      <Link key={c.id} to="/dashboard/clients" className="suggestion-item">{c.name} ({c.phone})</Link>
                    ))}
                  </div>
                )}
                {searchResults.documents?.length > 0 && (
                  <div className="suggestion-section">
                    <h5>Documents</h5>
                    {searchResults.documents.map(d => (
                      <Link key={d.id} to="/dashboard/documents" className="suggestion-item">{d.fileName}</Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Time Navigator + Time Switcher — only on dashboard home */}
          {isDashboardHome && (
            <div className="topbar-filter-area">
              <DashboardTimeNavigator />
              <TimeSwitcher />
            </div>
          )}

          {/* Right area */}
          <div className="top-right">
            {/* Exports the DASHBOARD as a PDF, so it only belongs on the
                dashboard. On Invoices or Cases it looked like it would export
                that page and did not. Those pages have their own exports. */}
            {isDashboardHome && (
              <button className="icon-btn" onClick={() => ReportService.downloadDashboard()} title="Export Dashboard PDF">
                <FiDownload />
              </button>
            )}
            <NotificationBell onOpen={(route) => navigate(route)} />
            <button className="icon-btn" onClick={handleToggleTheme}>
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
            <div className="user-dropdown-top" style={{ position: "relative" }}>
              <div
                className="user-dropdown-trigger"
                onClick={() => setAccountMenuOpen((v) => !v)}
                style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
              >
                <div className="top-avatar">{fullName.charAt(0).toUpperCase()}</div>
                <span className="user-email">{fullName} <FiChevronDown /></span>
              </div>
              {accountMenuOpen && (
                <>
                  <div
                    className="account-menu-backdrop"
                    onClick={() => setAccountMenuOpen(false)}
                    style={{ position: "fixed", inset: 0, zIndex: 40 }}
                  />
                  <div
                    className="account-menu"
                    style={{
                      position: "absolute", top: "calc(100% + 8px)", right: 0, minWidth: 200,
                      background: "var(--card-bg, #fff)", border: "1px solid var(--border, #e2e8f0)",
                      borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 41,
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border, #eef2f7)" }}>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{fullName}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted, #64748b)" }}>{email}</div>
                    </div>
                    <button
                      className="account-menu-item"
                      onClick={() => { setAccountMenuOpen(false); navigate("/dashboard/settings"); }}
                      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "inherit", textAlign: "left" }}
                    >
                      <FiSettings /> Profile &amp; Settings
                    </button>
                    <button
                      className="account-menu-item"
                      onClick={() => { setAccountMenuOpen(false); handleLogout(); }}
                      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", background: "none", border: "none", cursor: "pointer", fontSize: 14, color: "#dc2626", textAlign: "left" }}
                    >
                      <FiLogOut /> Logout
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        {/* ===== ROUTING ===== */}
        <section className="dashboard-content-body">
          <Suspense fallback={<div className="page-loading" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 200, color: "var(--text-muted)", fontSize: 14 }}>Loading...</div>}>
          <Routes>
            <Route
              path="/"
              element={
                <div className="dashboard-grid-container period-enter">
                  {/* Row 1: Statistics Cards */}
                  <div className="stats-row">
                    {loading ? (
                      <>
                        <SkeletonCard height={100} />
                        <SkeletonCard height={100} />
                        <SkeletonCard height={100} />
                        <SkeletonCard height={100} />
                        <SkeletonCard height={100} />
                      </>
                    ) : (
                      <>
                        <Link to="/dashboard/cases" className="stat-card-main blue">
                          <div className="card-left">
                            <span className="card-title">Total Cases</span>
                            <h3 className="card-val"><CountUp value={dash.totalCases} /></h3>
                            <span className="card-subtext">All time</span>
                          </div>
                          <div className="card-icon-box"><FiBriefcase /></div>
                        </Link>
                        <Link to="/dashboard/cases" className="stat-card-main orange">
                          <div className="card-left">
                            <span className="card-title">Active Cases</span>
                            <h3 className="card-val"><CountUp value={dash.activeCases} /></h3>
                            <span className="card-subtext">Needs attention</span>
                          </div>
                          <div className="card-icon-box"><FiFolder /></div>
                        </Link>
                        <Link to="/dashboard/clients" className="stat-card-main green">
                          <div className="card-left">
                            <span className="card-title">Clients</span>
                            <h3 className="card-val"><CountUp value={dash.totalClients} /></h3>
                            <span className="card-subtext">{
                              view === 'day' ? 'Added Today' :
                              view === 'week' ? 'Added This Week' :
                              view === 'month' ? 'Added This Month' :
                              'Added This Year'
                            }</span>
                          </div>
                          <div className="card-icon-box"><FiUsers /></div>
                        </Link>
                        <Link to="/dashboard/hearings" className="stat-card-main purple">
                          <div className="card-left">
                            <span className="card-title">Upcoming Hearings</span>
                            <h3 className="card-val"><CountUp value={dash.upcomingHearingsCount} /></h3>
                            <span className="card-subtext">Next 30 days</span>
                          </div>
                          <div className="card-icon-box"><FiCalendar /></div>
                        </Link>
                        <Link to="/dashboard/invoices" className="stat-card-main red">
                          <div className="card-left">
                            <span className="card-title">Pending Invoices</span>
                            <h3 className="card-val"><CountUp value={dash.recentInvoices.filter(i => i.status !== "PAID").length} /></h3>
                            <span className="card-subtext">{formatCurrency(dash.invoiceStats?.unpaid ?? 0)}</span>
                          </div>
                          <div className="card-icon-box"><FiFileText /></div>
                        </Link>
                      </>
                    )}
                  </div>

                  {/* Row 2 */}
                  <div className="dashboard-row-two">
                    {/* Case Status PieChart */}
                    <div className="row-two-card">
                      <h4>Case Status Overview</h4>
                      {loading ? (
                        <SkeletonChart height={180} bars={6} />
                      ) : (
                        <div className="donut-chart-container">
                          <ResponsiveContainer width="100%" height={180}>
                            <PieChart>
                              <Pie data={dash.caseStatusData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value">
                                {dash.caseStatusData.map((entry, idx) => (
                                  <Cell key={entry.name} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip cursor={false} contentStyle={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.25)", color: "var(--text-primary)", fontSize: 12 }} labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }} itemStyle={{ color: "var(--text-primary)" }} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="donut-legends">
                            {dash.caseStatusData.length === 0 ? (
                              <EmptyState icon="📊" title="No Status Data" desc="Case status distribution will appear once cases are created." />
                            ) : (
                              dash.caseStatusData.map((d, i) => (
                                <div key={d.name} className="legend-row">
                                  <span className="legend-dot" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                                  <span className="legend-lbl">{d.name.charAt(0) + d.name.slice(1).toLowerCase()}</span>
                                  <span className="legend-val">{d.value}</span>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Court Stats BarChart */}
                    <div className="row-two-card">
                      <h4>Court Statistics</h4>
                      {loading ? (
                        <SkeletonChart height={180} bars={6} />
                      ) : dash.courtStatsData.length === 0 ? (
                        <p className="no-data">No court data available.</p>
                      ) : (
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={dash.courtStatsData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                            <XAxis dataKey="court" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip cursor={{ fill: "rgba(59,130,246,0.08)", radius: 10 }} contentStyle={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.25)", color: "var(--text-primary)", fontSize: 12 }} labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }} itemStyle={{ color: "var(--text-primary)" }} />
                            <Bar dataKey="active" name="Active" fill="#3b82f6" radius={[3, 3, 0, 0]} activeBar={<ActiveBarShape />} />
                            <Bar dataKey="pending" name="Pending" fill="#f59e0b" radius={[3, 3, 0, 0]} activeBar={<ActiveBarShape />} />
                            <Bar dataKey="closed" name="Closed" fill="#10b981" radius={[3, 3, 0, 0]} activeBar={<ActiveBarShape />} />
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>

                    {/* Income vs Expense */}
                    <div className="row-two-card">
                      <h4>Income vs Expense</h4>
                      {loading ? (
                        <SkeletonChart height={180} bars={8} />
                      ) : dash.incomeExpenseData.length === 0 ? (
                        <EmptyState icon="📊" title="No Financial Data" desc="Income and expense trends will appear here once you add invoices and expenses." />
                      ) : (
                        <ResponsiveContainer width="100%" height={220}>
                          <AreaChart data={dash.incomeExpenseData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                            <defs>
                              <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip cursor={{ fill: "rgba(59,130,246,0.08)", radius: 10 }} contentStyle={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.25)", color: "var(--text-primary)", fontSize: 12 }} labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }} itemStyle={{ color: "var(--text-primary)" }} />
                            <Area type="monotone" dataKey="income" stroke="#10b981" fill="url(#colorIncome)" strokeWidth={2} name="Income" />
                            <Area type="monotone" dataKey="expense" stroke="#ef4444" fill="url(#colorExpense)" strokeWidth={2} name="Expense" />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                      <div className="chart-legends-mini">
                        <span className="legend-item"><span className="legend-dot green" /> Income</span>
                        <span className="legend-item"><span className="legend-dot red" /> Expense</span>
                      </div>
                    </div>
                  </div>

                  {/* Row 3 */}
                  <div className="dashboard-row-three">
                    {/* Monthly Case Overview */}
                    <div className="row-three-card">
                      <h4>Monthly Case Overview</h4>
                      {loading ? (
                        <SkeletonChart height={200} bars={12} />
                      ) : dash.monthlyData.length === 0 ? (
                        <EmptyState icon="📈" title="No Monthly Data" desc="Monthly case trends will appear here once cases are created and closed over time." />
                      ) : (
                        <ResponsiveContainer width="100%" height={220}>
                          <AreaChart data={dash.monthlyData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                            <defs>
                              <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="colorClosed" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                            <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip cursor={{ fill: "rgba(59,130,246,0.08)", radius: 10 }} contentStyle={{ backgroundColor: "var(--card-bg)", border: "1px solid var(--border-color)", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,.25)", color: "var(--text-primary)", fontSize: 12 }} labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }} itemStyle={{ color: "var(--text-primary)" }} />
                            <Area type="monotone" dataKey="created" stroke="#3b82f6" fill="url(#colorCreated)" strokeWidth={2} name="Created" />
                            <Area type="monotone" dataKey="closed" stroke="#10b981" fill="url(#colorClosed)" strokeWidth={2} name="Closed" />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </div>

                    {/* Upcoming Hearings */}
                    <div className="row-three-card hearings-card">
                      <div className="card-header-row">
                        <h4>Upcoming Hearings</h4>
                        <Link to="/dashboard/hearings" className="view-all-link">View Calendar</Link>
                      </div>
                      {loading ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {[1, 2, 3, 4].map(i => <SkeletonHearingItem key={i} />)}
                        </div>
                      ) : (
                        <div className="hearings-list-box">
                          {dash.hearings.length === 0 ? (
                            <EmptyState icon="📅" title="No Hearings Scheduled" desc="Hearings will appear here once you schedule them from the Hearings module." />
                          ) : (
                            dash.hearings.map((h, idx) => {
                              const dateObj = new Date(h.date);
                              const day = dateObj.getDate();
                              const month = dateObj.toLocaleString("en-US", { month: "short" }).toUpperCase();
                              return (
                                <div key={h.id || idx} className="hearing-list-item">
                                  <div className="date-badge-box">
                                    <span className="lbl-month">{month}</span>
                                    <span className="lbl-day">{day}</span>
                                  </div>
                                  <div className="hearing-info">
                                    <h5>{h.title}</h5>
                                    <p>Case: {h.caseEntity?.caseNumber || "N/A"}</p>
                                    <span className="client-lbl">Client: {h.caseEntity?.client?.name || "N/A"}</span>
                                  </div>
                                  <div className="hearing-time">{h.time || "N/A"}</div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                      <div className="card-footer-center">
                        <Link to="/dashboard/hearings" className="view-all-btn">View All Hearings</Link>
                      </div>
                    </div>

                    {/* Recent Clients */}
                    <div className="row-three-card recent-clients-card">
                      <div className="card-header-row">
                        <h4>Recent Clients</h4>
                        <Link to="/dashboard/clients" className="view-all-link">View All</Link>
                      </div>
                      {loading ? (
                        <SkeletonList items={3} avatar={true} />
                      ) : (
                        <div className="recent-clients-list">
                          {dash.recentClients.length === 0 ? (
                            <p className="no-data">No client records.</p>
                          ) : (
                            dash.recentClients.map((c, i) => (
                              <div key={c.id || i} className="client-list-row">
                                <div className={`client-bubble-avatar color-${i % 4}`}>{(c.name || "Client").split(" ").map(w => w[0] || "").join("").toUpperCase()}</div>
                                <div className="client-meta">
                                  <h5>{c.name}</h5>
                                  <p>{c.phone}</p>
                                </div>
                                <span className={`status-pill ${c.deleted ? "inactive" : "active"}`}>
                                  {c.deleted ? "Inactive" : "Active"}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Row 4 */}
                  <div className="dashboard-row-four">
                    {/* Invoices Summary */}
                    <div className="row-four-card invoices-summary-widget">
                      <div className="card-header-row">
                        <h4>Invoices Summary</h4>
                        <Link to="/dashboard/invoices" className="view-all-link">View All</Link>
                      </div>
                      {loading ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
                            {[1, 2, 3].map(i => <Skeleton key={i} height={50} borderRadius={8} />)}
                          </div>
                          {[1, 2, 3].map(i => <SkeletonInvoiceRow key={i} />)}
                        </div>
                      ) : (
                        <>
                          <div className="invoices-grid-stats">
                            <div className="grid-stat-box paid">
                              <span>Paid</span>
                              <strong>{formatCurrency(dash.invoiceStats?.paid ?? 0)}</strong>
                            </div>
                            <div className="grid-stat-box unpaid">
                              <span>Unpaid</span>
                              <strong>{formatCurrency(dash.invoiceStats?.unpaid ?? 0)}</strong>
                            </div>
                            <div className="grid-stat-box overdue">
                              <span>Overdue</span>
                              <strong>{formatCurrency(dash.invoiceStats?.overdue ?? 0)}</strong>
                            </div>
                          </div>
                          <div className="recent-invoices-mini-list">
                            <h5>Recent Invoices</h5>
                            {dash.recentInvoices.map((inv) => (
                              <div key={inv.id} className="mini-invoice-row">
                                <span className="inv-num">{inv.invoiceNumber}</span>
                                <span className="inv-client">{inv.client?.name}</span>
                                <span className="inv-amt">{formatCurrency(inv.amount)}</span>
                                <span className={`status-pill-mini ${inv.status?.toLowerCase()}`}>{inv.status}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="row-four-card">
                      <ActivityFeed maxItems={8} />
                    </div>

                    {/* Tasks */}
                    <div className="row-four-card tasks-card">
                      <div className="card-header-row">
                        <h4>Tasks</h4>
                        <Link to="/dashboard/tasks" className="view-all-link">View All</Link>
                      </div>
                      {loading ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {[1, 2, 3].map(i => <SkeletonTaskItem key={i} />)}
                        </div>
                      ) : (
                        <div className="dashboard-tasks-checklist">
                          {dash.tasks.length === 0 ? (
                            <p className="no-data">No active tasks reminders.</p>
                          ) : (
                            dash.tasks.map((task) => (
                              <div key={task.id} className="dashboard-task-item">
                                <button className="task-checkbox-btn" onClick={() => handleToggleTask(task.id)}>
                                  {task.completed ? <span className="chk-icon green">☑️</span> : <span className="chk-icon">⬜</span>}
                                </button>
                                <span className={`task-text-dash ${task.completed ? "crossed" : ""}`}>{task.title}</span>
                                <span className={`priority-badge-dash ${task.priority?.toLowerCase()}`}>{task.priority}</span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Row 5 - Document Stats */}
                  <div className="dashboard-row-five">
                    <div className="row-five-card doc-stats-card">
                      <div className="card-header-row">
                        <h4>Documents</h4>
                        <Link to="/dashboard/documents">View All</Link>
                      </div>
                      <div className="doc-stats-grid">
                        <div className="doc-stat-box">
                          <span className="doc-stat-value">{docStats.totalDocuments || 0}</span>
                          <span className="doc-stat-label">Total Files</span>
                        </div>
                        <div className="doc-stat-box">
                          <span className="doc-stat-value">{((docStats.totalStorageBytes || 0) / (1024 * 1024)).toFixed(1)} MB</span>
                          <span className="doc-stat-label">Storage Used</span>
                        </div>
                        <div className="doc-stat-box">
                          <span className="doc-stat-value">{Object.keys(docStats.categoryCounts || {}).length}</span>
                          <span className="doc-stat-label">Categories</span>
                        </div>
                      </div>
                    </div>
                    <div className="row-five-card recent-docs-card">
                      <div className="card-header-row">
                        <h4>Recent Documents</h4>
                        <Link to="/dashboard/documents">View All</Link>
                      </div>
                      {recentDocs.length === 0 ? (
                        <p className="no-data">No documents uploaded yet.</p>
                      ) : (
                        <div className="recent-docs-list">
                          {recentDocs.map((d) => (
                            <Link key={d.id} to="/dashboard/documents" className="recent-doc-item">
                              <span className="recent-doc-icon">📄</span>
                              <div className="recent-doc-info">
                                <span className="recent-doc-name">{d.documentName}</span>
                                <span className="recent-doc-case">{d.caseEntity?.caseNumber || d.category || "General"}</span>
                              </div>
                              <span className="recent-doc-date">{new Date(d.uploadDate).toLocaleDateString()}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <footer className="dashboard-footer-main">
                    <span>© 2025 AdvocateApp. All rights reserved.</span>
                    <span>Version 1.0.0</span>
                  </footer>
                </div>
              }
            />

            <Route path="/cases" element={<Cases />} />
            <Route path="/cases/new" element={<AddCase />} />
            <Route path="/display-board" element={<DisplayBoard />} />
            <Route path="/daily-causelist" element={<DailyCauselist />} />
            <Route path="/cases/:id" element={<CaseDetail />} />
            <Route path="/clients" element={<Clients />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/calendar" element={<Navigate to="/dashboard/hearings" replace />} />
            <Route path="/hearings" element={<HearingsPage />} />
            <Route path="/documents" element={<DocumentsPanel />} />
            <Route path="/invoices" element={<InvoicesPanel />} />
            <Route path="/settings" element={<ProfilePage />} />
            <Route path="/reports" element={<ReportsCenter />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/notifications" element={<NotificationsCenter />} />
            <Route path="/appeal-alert" element={<AppealAlert />} />
            <Route path="/acts" element={<Acts />} />
            <Route path="/acts/:id" element={<ActDetail />} />
            <Route path="/activity" element={
              <PermissionRoute permissions="AUDIT_VIEW"><SystemActivity /></PermissionRoute>
            } />
            <Route path="/backup" element={
              <PermissionRoute permissions="BACKUP_MANAGE"><BackupPage /></PermissionRoute>
            } />
            {/* Admin routes are permission-gated, not just hidden from the
                sidebar - otherwise they stay reachable by typing the URL. The
                codes match what the backend enforces (rbac/views.py). */}
            <Route path="/users" element={
              <PermissionRoute permissions="USER_MANAGE"><UserManagement /></PermissionRoute>
            } />
            <Route path="/roles" element={
              <PermissionRoute permissions="ROLE_MANAGE"><RoleManagement /></PermissionRoute>
            } />
            <Route path="/communication" element={<CommunicationDashboard />} />
            <Route path="/communication/settings" element={<CommunicationSettings />} />
            <Route path="/communication/history" element={<CommunicationHistory />} />
          </Routes>
          </Suspense>
        </section>
      </main>

      <AssistantPanel />
      <SearchProvider>
        <GlobalSearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={handleSearchNavigate} onQuickAction={handleQuickAction} />
      </SearchProvider>

    </div>
  );
}
