import { lazy, Suspense, useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import { useNavigate, NavLink, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { Button } from 'primereact/button';
import { Menu } from 'primereact/menu';
import { Avatar } from 'primereact/avatar';
import { Tag } from 'primereact/tag';
import { Checkbox } from 'primereact/checkbox';
import { Skeleton } from 'primereact/skeleton';
import { ProgressSpinner } from 'primereact/progressspinner';
import {
  PieChart, Pie, Cell, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useLoading } from '../contexts/LoadingContext';
import ReportService from '../services/ReportService';
import { formatCurrency } from '../utils/formatCurrency';

import '../assets/styles/Dashboard.css';
import '../assets/styles/Assistant.css';
import '../assets/styles/RealTime.css';
import LOGO_RE from '../assets/images/LOGO_RE.png';
import { DashboardFilterProvider, useDashboardFilter } from '../contexts/DashboardFilterContext';
import { AssistantProvider } from '../contexts/AssistantContext';
import { WebSocketProvider, useWebSocketContext } from '../contexts/realtime/WebSocketProvider';
import { SidebarProvider, useSidebar } from '../contexts/SidebarContext';
import { PermissionProvider, usePermission } from '../contexts/PermissionContext';
import dashboardService from '../services/DashboardService';
import AssistantPanel from '../components/AssistantPanel';
import PermissionRoute from '../components/PermissionRoute';
import NotificationBell from '../components/NotificationBell';
import ActivityFeed from '../components/ActivityFeed';
import HearingAlertPopup from '../components/HearingAlertPopup';
import GlobalSearchModal from '../components/GlobalSearchModal';
import QuickActionsModal from '../components/QuickActionsModal';
import { SearchProvider } from '../contexts/SearchContext';

// Nested sub-pages (lazy-loaded)
const Cases = lazy(() => import('./Cases'));
const AddCase = lazy(() => import('./AddCase'));
const DisplayBoard = lazy(() => import('./DisplayBoard'));
const DailyCauselist = lazy(() => import('./DailyCauselist'));
const Clients = lazy(() => import('./Clients'));
const Expenses = lazy(() => import('./Expenses'));
const HearingsPage = lazy(() => import('./HearingsPage'));
const DocumentsPanel = lazy(() => import('./DocumentsPanel'));
const InvoicesPanel = lazy(() => import('./InvoicesPanel'));
const ProfilePage = lazy(() => import('./ProfilePage'));
const ReportsCenter = lazy(() => import('./ReportsCenter'));
const TasksPage = lazy(() => import('./TasksPage'));
const NotificationsCenter = lazy(() => import('./NotificationsCenter'));
const SystemActivity = lazy(() => import('./SystemActivity'));
const BackupPage = lazy(() => import('./BackupPage'));
const UserManagement = lazy(() => import('./UserManagement'));
const RoleManagement = lazy(() => import('./RoleManagement'));
const CommunicationDashboard = lazy(() => import('./CommunicationDashboard'));
const CommunicationSettings = lazy(() => import('./CommunicationSettings'));
const CommunicationHistory = lazy(() => import('./CommunicationHistory'));
const AppealAlert = lazy(() => import('./AppealAlert'));
const Acts = lazy(() => import('./Acts'));
const LegalDictionary = lazy(() => import('./LegalDictionary'));
const LawCodes = lazy(() => import('./LawCodes'));
const ActDetail = lazy(() => import('./ActDetail'));
const CaseDetail = lazy(() => import('./CaseDetail'));
const DraftingRoutes = lazy(() => import('./Drafting/DraftingRoutes'));

// --- Active bar shape for hover growth animation ---
function ActiveBarShape({ x, y, width, height, fill, stroke, strokeWidth }: any) {
  const newH = height * 1.04;
  const newY = y - (newH - height);
  return (
    <rect x={x} y={newY} width={width} height={Math.max(newH, 0)}
      fill={fill} stroke={stroke || fill} strokeWidth={strokeWidth || 1.5}
      rx={3} ry={3} style={{ transition: 'all 0.2s ease' }} />
  );
}

// --- Count-up animation ---
function CountUp({ value, duration = 1000 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const prevRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    const start = prevRef.current;
    prevRef.current = value;
    const diff = value - start;
    if (diff === 0) { setDisplay(Number(value)); return; }
    const startTime = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + diff * eased));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, duration]);
  return <>{display.toLocaleString()}</>;
}

function EmptyState({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon"><i className={`pi ${icon}`} /></div>
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-desc">{desc}</div>
    </div>
  );
}

const PIE_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ef4444'];

const TOOLTIP_PROPS = {
  contentStyle: { backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 12, boxShadow: 'var(--shadow-md)', color: 'var(--text-primary)', fontSize: 12 },
  labelStyle: { color: 'var(--text-primary)', fontWeight: 600 },
  itemStyle: { color: 'var(--text-primary)' },
};

function severityFor(status?: string): any {
  switch ((status || '').toUpperCase()) {
    case 'PAID': case 'ACTIVE': case 'LOW': return 'success';
    case 'PENDING': case 'UNPAID': case 'PARTIAL': case 'MEDIUM': return 'warning';
    case 'OVERDUE': case 'HIGH': case 'URGENT': case 'CANCELLED': return 'danger';
    default: return 'info';
  }
}

// ====== MAIN EXPORT ======
export default function Dashboard() {
  const navigate = useNavigate();
  const { token } = useAuth();

  useEffect(() => {
    if (!token) navigate('/login');
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
function IfPermitted({ perm, children }: { perm: string; children: ReactNode }) {
  const { hasPermission, loading } = usePermission() as any;
  if (loading) return null;
  return hasPermission(perm) ? <>{children}</> : null;
}

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/dashboard/cases': 'Cases',
  '/dashboard/display-board': 'Display Board',
  '/dashboard/daily-causelist': 'Daily Causelist',
  '/dashboard/clients': 'Clients',
  '/dashboard/hearings': 'Hearings & Events',
  '/dashboard/invoices': 'Invoices',
  '/dashboard/expenses': 'Expenses',
  '/dashboard/documents': 'Documents',
  '/dashboard/tasks': 'Tasks',
  '/dashboard/reports': 'Reports',
  '/dashboard/notifications': 'Notifications',
  '/dashboard/appeal-alert': 'Appeal Alert',
  '/dashboard/acts': 'Acts',
  '/dashboard/legal-dictionary': 'Legal Dictionary',
  '/dashboard/law-codes': 'Law Codes',
  '/dashboard/activity': 'System Activity',
  '/dashboard/backup': 'Backup',
  '/dashboard/users': 'User Management',
  '/dashboard/roles': 'Role Management',
  '/dashboard/settings': 'Settings',
  '/dashboard/communication': 'Communication Overview',
  '/dashboard/communication/settings': 'Communication Settings',
  '/dashboard/communication/history': 'Communication History',
};

function titleFor(path: string) {
  if (PAGE_TITLES[path]) return PAGE_TITLES[path];
  if (path.startsWith('/dashboard/drafting')) return 'Drafting';
  return 'Dashboard';
}

function SideLink({ to, icon, text, title, end, sub }: { to: string; icon: string; text: string; title?: string; end?: boolean; sub?: boolean }) {
  return (
    <li>
      <NavLink to={to} end={end} title={title || text}
        className={({ isActive }) => `nav-link${sub ? ' sub' : ''}${isActive ? ' active' : ''}`}>
        <span className={`nav-icon${sub ? ' sub-nav-icon' : ''}`}><i className={`pi ${icon}`} /></span>
        <span className="nav-text">{text}</span>
      </NavLink>
    </li>
  );
}

// ====== INNER SHELL (has access to context) ======
function DashboardShell() {
  const navigate = useNavigate();
  const auth = useAuth();
  const { theme, toggleTheme } = useTheme() as any;
  const { withLoading } = useLoading() as any;
  const fullName = auth.fullName || 'Advocate Y';
  const email = auth.email || 'advocate@example.com';
  const [branding, setBranding] = useState({ officeLogoUrl: '', profilePhotoUrl: '', officeName: '' });

  const [dash, setDash] = useState<any>({
    totalCases: 0, activeCases: 0, totalClients: 0,
    upcomingHearingsCount: 0, overdueInvoices: 0,
    caseStatusData: [], courtStatsData: [], monthlyData: [], incomeExpenseData: [],
    hearings: [], recentInvoices: [], invoiceStats: { paid: 0, unpaid: 0, overdue: 0 },
    activities: [], tasks: [], recentClients: [], recentCases: [],
  });
  const [docStats, setDocStats] = useState<any>({ totalDocuments: 0, totalStorageBytes: 0, categoryCounts: {} });
  const [recentDocs, setRecentDocs] = useState<any[]>([]);

  const accountMenuRef = useRef<Menu>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [casesOpen, setCasesOpen] = useState(true);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);

  const { isCollapsed, isMobile, toggleSidebar, closeSidebar, mobileOpen } = useSidebar() as any;
  const location = useLocation();

  const currentPath = location.pathname.replace(/\/$/, '') || '/dashboard';
  const pageTitle = titleFor(currentPath);
  const isDashboardHome = currentPath === '/dashboard';

  // ESC closes sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') closeSidebar(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeSidebar]);

  const filter = useDashboardFilter() as any;
  const { data, loading } = filter;

  // Live dashboard updates
  const { subscribe: wsSubscribe } = useWebSocketContext() as any;
  useEffect(() => {
    if (!wsSubscribe) return;
    const unsub = wsSubscribe('dashboard', () => {
      filter.invalidateCache();
      filter.forceRefreshDashboard();
    });
    return unsub;
  }, [wsSubscribe, filter]);

  // Profile sync: full profile so the sidebar can show firm logo + photo.
  const { updateProfile } = auth;
  useEffect(() => {
    api.get('/api/profile')
      .then((res) => {
        const d = res.data || {};
        const patch: { fullName?: string; email?: string } = {};
        if (d.fullName) patch.fullName = d.fullName;
        if (d.email) patch.email = d.email;
        if (patch.fullName || patch.email) updateProfile(patch);
        setBranding({
          officeLogoUrl: d.officeLogoUrl || '',
          profilePhotoUrl: d.profilePhotoUrl || '',
          officeName: d.officeName || '',
        });
      })
      .catch(() => {});
  }, [auth.token, updateProfile]);

  // Sync context data into local state when data changes
  useEffect(() => {
    if (!data) return;
    const grid = document.querySelector('.dashboard-grid-container');
    if (grid) {
      grid.classList.remove('period-enter');
      grid.classList.add('period-exit');
      requestAnimationFrame(() => {
        grid.classList.remove('period-exit');
        grid.classList.add('period-enter');
      });
    }
    setDash({
      totalCases: data.summary?.totalCases ?? 0,
      activeCases: data.summary?.activeCases ?? 0,
      totalClients: data.summary?.clients ?? 0,
      upcomingHearingsCount: data.summary?.upcomingHearings ?? 0,
      overdueInvoices: data.summary?.pendingInvoices ?? 0,
      caseStatusData: data.caseStatus?.items ? data.caseStatus.items.map((i: any) => ({ name: i.status, value: i.count })) : [],
      courtStatsData: data.courtStats?.items ?? [],
      monthlyData: data.monthlyCases?.items
        ? data.monthlyCases.items.map((m: any) => ({ month: m.month, created: m.created ?? 0, closed: m.closed ?? 0 }))
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

  // Document stats (kept live by the polling effect below)
  const fetchDocData = useCallback(async () => {
    if (!auth.token) return;
    const [statsRes, listRes] = await Promise.allSettled([
      api.get('/api/documents/stats'),
      api.get('/api/documents/list'),
    ]);
    if (statsRes.status === 'fulfilled') setDocStats(statsRes.value.data);
    if (listRes.status === 'fulfilled' && Array.isArray(listRes.value.data)) setRecentDocs(listRes.value.data.slice(0, 5));
    if (statsRes.status === 'rejected' && listRes.status === 'rejected') console.error('Error fetching doc stats:', statsRes.reason);
  }, [auth.token]);

  useEffect(() => { fetchDocData(); }, [fetchDocData]);

  // Poll (30s + refresh-on-focus) only while the home view is mounted.
  useEffect(() => {
    if (!isDashboardHome) return;
    filter.setPollingEnabled(true);
    const id = setInterval(() => { fetchDocData(); }, 30000);
    const onFocusOrVisible = () => { if (document.visibilityState === 'visible') fetchDocData(); };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);
    return () => {
      filter.setPollingEnabled(false);
      clearInterval(id);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDashboardHome, fetchDocData]);

  const handleToggleTask = async (id: any) => {
    try {
      await withLoading(api.put(`/api/workspace/tasks/${id}/toggle`, {}), 'Toggling task...');
      const res: any = await withLoading(api.get('/api/workspace/tasks/all'), 'Refreshing tasks...');
      const rows = Array.isArray(res.data) ? res.data : (res.data?.content || []);
      setDash((prev: any) => ({ ...prev, tasks: rows.filter((t: any) => !t.completed).slice(0, 5) }));
    } catch (err) {
      console.error('Error toggling task:', err);
    }
  };

  const handleToggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    toggleTheme();
    withLoading(api.put('/api/advocates/settings', { theme: newTheme, fullName, phone: '' }), 'Updating theme...').catch(() => {});
  };

  const handleLogout = async () => {
    try {
      await api.post('/api/advocates/logout', {});
    } catch { /* ignore */ }
    dashboardService.clearAllCache();
    localStorage.clear();
    auth.logout();
  };

  // Ctrl+K global search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleSearchNavigate = (type: string, item: any) => {
    setSearchOpen(false);
    const search = item.name || item.caseTitle || item.caseNumber || item.documentName || item.originalName || item.invoiceNumber || item.title;
    const id = item.id;
    const routes: Record<string, string> = {
      clients: '/dashboard/clients', cases: '/dashboard/cases', documents: '/dashboard/documents',
      invoices: '/dashboard/invoices', expenses: '/dashboard/expenses', tasks: '/dashboard/tasks',
      events: '/dashboard/hearings', hearings: '/dashboard/hearings', payments: '/dashboard/cases',
    };
    if (routes[type]) navigate(routes[type], { state: { search, id } });
  };

  // Quick Actions: navigate, then open the target page's "add" form once it has mounted.
  const handleQuickAction = (route: string, modalToOpen?: string) => {
    setQuickActionsOpen(false);
    navigate(route);
    if (modalToOpen) {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('assistant-open-modal', { detail: modalToOpen }));
      }, 450);
    }
  };

  const avatar = (size?: 'large') => branding.profilePhotoUrl
    ? <Avatar image={branding.profilePhotoUrl} shape="circle" size={size} className="profile-avatar-img" />
    : <Avatar label={fullName.charAt(0).toUpperCase()} shape="circle" size={size} className="profile-avatar-img" />;

  const accountItems = [
    { template: () => (
      <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border-color)' }}>
        <div className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{fullName}</div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{email}</div>
      </div>
    ) },
    { label: 'Profile & Settings', icon: 'pi pi-cog', command: () => navigate('/dashboard/settings') },
    { label: 'Logout', icon: 'pi pi-sign-out', className: 'account-menu-logout', command: () => { handleLogout(); } },
  ];

  const home = (
    <div className="dashboard-grid-container period-enter">
      {/* Row 1: Statistics Cards */}
      <div className="stats-row">
        {loading ? (
          [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height="100px" borderRadius="var(--radius)" />)
        ) : (
          <>
            <Link to="/dashboard/cases" className="stat-card-main blue">
              <div className="card-left">
                <span className="card-title">Total Cases</span>
                <h3 className="card-val"><CountUp value={dash.totalCases} /></h3>
                <span className="card-subtext">All time</span>
              </div>
              <div className="card-icon-box"><i className="pi pi-briefcase" /></div>
            </Link>
            <Link to="/dashboard/cases" className="stat-card-main orange">
              <div className="card-left">
                <span className="card-title">Active Cases</span>
                <h3 className="card-val"><CountUp value={dash.activeCases} /></h3>
                <span className="card-subtext">Needs attention</span>
              </div>
              <div className="card-icon-box"><i className="pi pi-folder-open" /></div>
            </Link>
            <Link to="/dashboard/clients" className="stat-card-main green">
              <div className="card-left">
                <span className="card-title">Clients</span>
                <h3 className="card-val"><CountUp value={dash.totalClients} /></h3>
                <span className="card-subtext">All time</span>
              </div>
              <div className="card-icon-box"><i className="pi pi-users" /></div>
            </Link>
            <Link to="/dashboard/hearings" className="stat-card-main purple">
              <div className="card-left">
                <span className="card-title">Upcoming Hearings</span>
                <h3 className="card-val"><CountUp value={dash.upcomingHearingsCount} /></h3>
                <span className="card-subtext">Next 30 days</span>
              </div>
              <div className="card-icon-box"><i className="pi pi-calendar" /></div>
            </Link>
            <Link to="/dashboard/invoices" className="stat-card-main red">
              <div className="card-left">
                <span className="card-title">Pending Invoices</span>
                <h3 className="card-val"><CountUp value={dash.recentInvoices.filter((i: any) => i.status !== 'PAID').length} /></h3>
                <span className="card-subtext">{formatCurrency(dash.invoiceStats?.unpaid ?? 0)}</span>
              </div>
              <div className="card-icon-box"><i className="pi pi-file" /></div>
            </Link>
          </>
        )}
      </div>

      {/* Row 2 */}
      <div className="dashboard-row-two">
        <div className="row-two-card">
          <h4>Case Status Overview</h4>
          {loading ? (
            <Skeleton height="180px" />
          ) : (
            <div className="donut-chart-container">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={dash.caseStatusData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value">
                    {dash.caseStatusData.map((entry: any, idx: number) => (
                      <Cell key={entry.name} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip cursor={false} {...TOOLTIP_PROPS} />
                </PieChart>
              </ResponsiveContainer>
              <div className="donut-legends">
                {dash.caseStatusData.length === 0 ? (
                  <EmptyState icon="pi-chart-pie" title="No Status Data" desc="Case status distribution will appear once cases are created." />
                ) : (
                  dash.caseStatusData.map((d: any, i: number) => (
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

        <div className="row-two-card">
          <h4>Court Statistics</h4>
          {loading ? (
            <Skeleton height="180px" />
          ) : dash.courtStatsData.length === 0 ? (
            <p className="no-data">No court data available.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dash.courtStatsData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-color)" />
                <XAxis dataKey="court" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip cursor={{ fill: 'rgba(59,130,246,0.08)' }} {...TOOLTIP_PROPS} />
                <Bar dataKey="active" name="Active" fill="#3b82f6" radius={[3, 3, 0, 0]} activeBar={<ActiveBarShape />} />
                <Bar dataKey="pending" name="Pending" fill="#f59e0b" radius={[3, 3, 0, 0]} activeBar={<ActiveBarShape />} />
                <Bar dataKey="closed" name="Closed" fill="#10b981" radius={[3, 3, 0, 0]} activeBar={<ActiveBarShape />} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="row-two-card">
          <h4>Income vs Expense</h4>
          {loading ? (
            <Skeleton height="180px" />
          ) : dash.incomeExpenseData.length === 0 ? (
            <EmptyState icon="pi-chart-bar" title="No Financial Data" desc="Income and expense trends will appear here once you add invoices and expenses." />
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
                <Tooltip cursor={{ fill: 'rgba(59,130,246,0.08)' }} {...TOOLTIP_PROPS} />
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
        <div className="row-three-card">
          <h4>Monthly Case Overview</h4>
          {loading ? (
            <Skeleton height="200px" />
          ) : dash.monthlyData.length === 0 ? (
            <EmptyState icon="pi-chart-line" title="No Monthly Data" desc="Monthly case trends will appear here once cases are created and closed over time." />
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
                <Tooltip cursor={{ fill: 'rgba(59,130,246,0.08)' }} {...TOOLTIP_PROPS} />
                <Area type="monotone" dataKey="created" stroke="#3b82f6" fill="url(#colorCreated)" strokeWidth={2} name="Created" />
                <Area type="monotone" dataKey="closed" stroke="#10b981" fill="url(#colorClosed)" strokeWidth={2} name="Closed" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="row-three-card hearings-card">
          <div className="card-header-row">
            <h4>Upcoming Hearings</h4>
            <Link to="/dashboard/hearings" className="view-all-link">View Calendar</Link>
          </div>
          {loading ? (
            <div className="flex flex-column gap-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} height="3.5rem" />)}
            </div>
          ) : (
            <div className="hearings-list-box">
              {dash.hearings.length === 0 ? (
                <EmptyState icon="pi-calendar" title="No Hearings Scheduled" desc="Hearings will appear here once you schedule them from the Hearings module." />
              ) : (
                dash.hearings.map((h: any, idx: number) => {
                  const dateObj = new Date(h.date);
                  return (
                    <div key={h.id || idx} className="hearing-list-item">
                      <div className="date-badge-box">
                        <span className="lbl-month">{dateObj.toLocaleString('en-US', { month: 'short' }).toUpperCase()}</span>
                        <span className="lbl-day">{dateObj.getDate()}</span>
                      </div>
                      <div className="hearing-info">
                        <h5>{h.title}</h5>
                        <p>Case: {h.caseEntity?.caseNumber || 'N/A'}</p>
                        <span className="client-lbl">Client: {h.caseEntity?.client?.name || 'N/A'}</span>
                      </div>
                      <div className="hearing-time">{h.time || 'N/A'}</div>
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

        <div className="row-three-card recent-clients-card">
          <div className="card-header-row">
            <h4>Recent Clients</h4>
            <Link to="/dashboard/clients" className="view-all-link">View All</Link>
          </div>
          {loading ? (
            <div className="flex flex-column gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex align-items-center gap-2">
                  <Skeleton shape="circle" size="2.5rem" />
                  <div className="flex-1"><Skeleton width="60%" className="mb-2" /><Skeleton width="40%" /></div>
                </div>
              ))}
            </div>
          ) : (
            <div className="recent-clients-list">
              {dash.recentClients.length === 0 ? (
                <p className="no-data">No client records.</p>
              ) : (
                dash.recentClients.map((c: any, i: number) => (
                  <div key={c.id || i} className="client-list-row">
                    <div className={`client-bubble-avatar color-${i % 4}`}>{(c.name || 'Client').split(' ').map((w: string) => w[0] || '').join('').toUpperCase()}</div>
                    <div className="client-meta">
                      <h5>{c.name}</h5>
                      <p>{c.phone}</p>
                    </div>
                    <Tag value={c.deleted ? 'Inactive' : 'Active'} severity={c.deleted ? 'secondary' as any : 'success'} rounded />
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Row 4 */}
      <div className="dashboard-row-four">
        <div className="row-four-card invoices-summary-widget">
          <div className="card-header-row">
            <h4>Invoices Summary</h4>
            <Link to="/dashboard/invoices" className="view-all-link">View All</Link>
          </div>
          {loading ? (
            <div className="flex flex-column gap-3">
              <div className="grid">
                {[1, 2, 3].map((i) => <div key={i} className="col-4"><Skeleton height="50px" /></div>)}
              </div>
              {[1, 2, 3].map((i) => <Skeleton key={i} height="1.75rem" />)}
            </div>
          ) : (
            <>
              <div className="invoices-grid-stats">
                <div className="grid-stat-box paid"><span>Paid</span><strong>{formatCurrency(dash.invoiceStats?.paid ?? 0)}</strong></div>
                <div className="grid-stat-box unpaid"><span>Unpaid</span><strong>{formatCurrency(dash.invoiceStats?.unpaid ?? 0)}</strong></div>
                <div className="grid-stat-box overdue"><span>Overdue</span><strong>{formatCurrency(dash.invoiceStats?.overdue ?? 0)}</strong></div>
              </div>
              <div className="recent-invoices-mini-list">
                <h5>Recent Invoices</h5>
                {dash.recentInvoices.map((inv: any) => (
                  <div key={inv.id} className="mini-invoice-row">
                    <span className="inv-num">{inv.invoiceNumber}</span>
                    <span className="inv-client">{inv.client?.name}</span>
                    <span className="inv-amt">{formatCurrency(inv.amount)}</span>
                    {inv.status && <Tag value={inv.status} severity={severityFor(inv.status)} />}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="row-four-card">
          <ActivityFeed maxItems={8} />
        </div>

        <div className="row-four-card tasks-card">
          <div className="card-header-row">
            <h4>Tasks</h4>
            <Link to="/dashboard/tasks" className="view-all-link">View All</Link>
          </div>
          {loading ? (
            <div className="flex flex-column gap-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} height="1.75rem" />)}
            </div>
          ) : (
            <div className="dashboard-tasks-checklist">
              {dash.tasks.length === 0 ? (
                <p className="no-data">No active tasks reminders.</p>
              ) : (
                dash.tasks.map((task: any) => (
                  <div key={task.id} className="dashboard-task-item flex align-items-center gap-2">
                    <Checkbox inputId={`dash-task-${task.id}`} checked={!!task.completed} onChange={() => handleToggleTask(task.id)} />
                    <label htmlFor={`dash-task-${task.id}`} className={`task-text-dash flex-1 ${task.completed ? 'crossed' : ''}`}>{task.title}</label>
                    {task.priority && <Tag value={task.priority} severity={severityFor(task.priority)} />}
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
                  <span className="recent-doc-icon"><i className="pi pi-file" /></span>
                  <div className="recent-doc-info">
                    <span className="recent-doc-name">{d.documentName}</span>
                    <span className="recent-doc-case">{d.caseEntity?.caseNumber || d.category || 'General'}</span>
                  </div>
                  <span className="recent-doc-date">{new Date(d.uploadDate).toLocaleDateString()}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <footer className="dashboard-footer-main">
        <span>© 2026 AMS. All rights reserved.</span>
        <span>Version 1.0.0</span>
      </footer>
    </div>
  );

  return (
    <div className={`dashboard-root ${!isMobile && isCollapsed ? 'sidebar-collapsed' : ''} ${isMobile && mobileOpen ? 'sidebar-mobile-open' : ''}`}>
      {isMobile && mobileOpen && <div className="sidebar-overlay" onClick={closeSidebar} />}

      {/* ===== SIDEBAR ===== */}
      <aside className="left-sidebar">
        <div className="brand">
          <div className="brand-logo"><img src={LOGO_RE} alt="logo" /></div>
          <div><div className="brand-name">AMS</div></div>
        </div>

        <div className="sidebar-search-btn" role="button" tabIndex={0} onClick={() => setSearchOpen(true)}>
          <i className="pi pi-search sidebar-search-icon" />
          <span className="sidebar-search-txt">Search</span>
          <span className="sidebar-search-shortcut">Ctrl+K</span>
        </div>
        <div className="sidebar-search-btn" role="button" tabIndex={0} onClick={() => setQuickActionsOpen(true)}>
          <i className="pi pi-bolt sidebar-search-icon" />
          <span className="sidebar-search-txt">Quick Actions</span>
        </div>

        <nav className="nav">
          <ul>
            <SideLink to="/dashboard" end icon="pi-th-large" text="Dashboard" />
            <li className="nav-group">
              <button type="button" className="nav-link nav-group-toggle" onClick={() => setCasesOpen((o) => !o)} title="Cases" aria-expanded={casesOpen}>
                <span className="nav-icon"><i className="pi pi-briefcase" /></span>
                <span className="nav-text">Cases</span>
                <i className={`pi pi-chevron-down nav-group-chevron ${casesOpen ? 'open' : ''}`} />
              </button>
              {casesOpen && (
                <ul className="nav-submenu">
                  <SideLink to="/dashboard/cases" end sub icon="pi-inbox" text="Workspace" />
                  <SideLink to="/dashboard/daily-causelist" sub icon="pi-calendar" text="Daily Causelist" />
                  <SideLink to="/dashboard/display-board" sub icon="pi-desktop" text="Display Board" />
                </ul>
              )}
            </li>
            <SideLink to="/dashboard/clients" icon="pi-users" text="Clients" />
            <SideLink to="/dashboard/hearings" icon="pi-calendar" text="Hearings & Events" />
            <SideLink to="/dashboard/invoices" icon="pi-indian-rupee" text="Invoices" />
            <SideLink to="/dashboard/expenses" icon="pi-wallet" text="Expenses" />
            <SideLink to="/dashboard/documents" icon="pi-folder" text="Documents" />
            <SideLink to="/dashboard/tasks" icon="pi-check-square" text="Tasks" />
            <IfPermitted perm="DRAFT_VIEW">
              <SideLink to="/dashboard/drafting" icon="pi-pencil" text="Drafting" />
            </IfPermitted>
            <SideLink to="/dashboard/reports" icon="pi-chart-line" text="Reports" />
            <SideLink to="/dashboard/notifications" icon="pi-envelope" text="Notifications" />
            <SideLink to="/dashboard/appeal-alert" icon="pi-bell" text="Appeal Alert" />
            <SideLink to="/dashboard/acts" icon="pi-book" text="Acts" />
            <SideLink to="/dashboard/legal-dictionary" icon="pi-bookmark" text="Legal Dictionary" />
            <SideLink to="/dashboard/law-codes" icon="pi-sitemap" text="Law Codes" title="Law Codes (IPC → BNS)" />
            <li>
              <Link to="#" className="nav-link" title="AI Assistant"
                onClick={(e) => { e.preventDefault(); window.dispatchEvent(new CustomEvent('assistant-toggle-open')); }}>
                <span className="nav-icon"><i className="pi pi-comments" /></span>
                <span className="nav-text">AI Assistant</span>
              </Link>
            </li>
            <SideLink to="/dashboard/settings" icon="pi-cog" text="Settings" />
            <IfPermitted perm="BACKUP_MANAGE">
              <SideLink to="/dashboard/backup" icon="pi-lock" text="Backup" />
            </IfPermitted>
            <li className="nav-section-label">Administration</li>
            <IfPermitted perm="AUDIT_VIEW">
              <SideLink to="/dashboard/activity" icon="pi-history" text="System Activity" />
            </IfPermitted>
            <IfPermitted perm="USER_MANAGE">
              <SideLink to="/dashboard/users" icon="pi-user" text="Users" title="User Management" />
            </IfPermitted>
            <IfPermitted perm="ROLE_MANAGE">
              <SideLink to="/dashboard/roles" icon="pi-shield" text="Roles" title="Role Management" />
            </IfPermitted>
            <li className="nav-section-label">Communication</li>
            {/* "Overview", not "Dashboard": the sidebar already has one. */}
            <SideLink to="/dashboard/communication" end icon="pi-send" text="Overview" title="Communication Overview" />
            <SideLink to="/dashboard/communication/settings" icon="pi-sliders-h" text="Settings" title="Communication Settings" />
            <SideLink to="/dashboard/communication/history" icon="pi-list" text="History" title="Communication History" />
          </ul>
        </nav>

        <div className="sidebar-profile-card">
          <div className="profile-avatar">{avatar()}</div>
          <div className="profile-details">
            <span className="profile-name">{fullName}</span>
            <span className="profile-email">{email}</span>
          </div>
          <Button text rounded icon="pi pi-sign-out" className="sidebar-logout-btn" aria-label="Logout" tooltip="Logout" onClick={handleLogout} />
        </div>
      </aside>

      {/* ===== MAIN AREA ===== */}
      <main className="main-area">
        <HearingAlertPopup onView={() => navigate('/dashboard/hearings')} />
        <header className="topbar">
          <div className="top-left">
            <Button text rounded icon="pi pi-bars" className="hamburger-btn" onClick={toggleSidebar} aria-label="Toggle sidebar"
              tooltip={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} tooltipOptions={{ position: 'bottom' }} />
            <div>
              <h2>{pageTitle}</h2>
              {isDashboardHome && <div className="subtle">Welcome back, {fullName}</div>}
            </div>
          </div>

          {/* Period filters are hidden (the backend ignores those params); only the live indicator remains. */}
          {isDashboardHome && (
            <div className="topbar-filter-area">
              <span className="dashboard-live-indicator" title="Live — auto-refreshes every 30 seconds">
                <span className="live-dot" />
                Live{filter.lastUpdated ? ` · ${filter.lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
              </span>
            </div>
          )}

          <div className="top-right flex align-items-center gap-1">
            {/* Exports the dashboard as a PDF, so it only belongs on the dashboard. */}
            {isDashboardHome && (
              <Button text rounded icon="pi pi-download" className="icon-btn" aria-label="Export Dashboard PDF"
                tooltip="Export Dashboard PDF" tooltipOptions={{ position: 'bottom' }} onClick={() => ReportService.downloadDashboard()} />
            )}
            <NotificationBell onOpen={(route) => navigate(route)} />
            <Button text rounded icon={theme === 'dark' ? 'pi pi-sun' : 'pi pi-moon'} className="icon-btn" aria-label="Toggle theme"
              tooltip={theme === 'dark' ? 'Light mode' : 'Dark mode'} tooltipOptions={{ position: 'bottom' }} onClick={handleToggleTheme} />
            <div className="user-dropdown-top">
              <Menu model={accountItems as any} popup ref={accountMenuRef} popupAlignment="right" />
              <button type="button" className="user-dropdown-trigger flex align-items-center gap-2"
                onClick={(e) => accountMenuRef.current?.toggle(e)} aria-haspopup="menu">
                <span className="top-avatar">{avatar()}</span>
                <span className="user-email">{fullName} <i className="pi pi-chevron-down text-xs" /></span>
              </button>
            </div>
          </div>
        </header>

        <section className="dashboard-content-body">
          <Suspense fallback={
            <div className="page-loading flex align-items-center justify-content-center" style={{ minHeight: 200 }}>
              <ProgressSpinner style={{ width: 36, height: 36 }} strokeWidth="4" />
            </div>
          }>
            <Routes>
              <Route path="/" element={home} />
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
              <Route path="/legal-dictionary" element={<LegalDictionary />} />
              <Route path="/law-codes" element={<LawCodes />} />
              <Route path="/activity" element={<PermissionRoute permissions="AUDIT_VIEW"><SystemActivity /></PermissionRoute>} />
              <Route path="/backup" element={<PermissionRoute permissions="BACKUP_MANAGE"><BackupPage /></PermissionRoute>} />
              {/* Admin routes are permission-gated, not just hidden from the sidebar (codes match rbac/views.py). */}
              <Route path="/users" element={<PermissionRoute permissions="USER_MANAGE"><UserManagement /></PermissionRoute>} />
              <Route path="/roles" element={<PermissionRoute permissions="ROLE_MANAGE"><RoleManagement /></PermissionRoute>} />
              {/* Drafting (merged from InstaDraft, merge phase 04). */}
              <Route path="/drafting/*" element={<PermissionRoute permissions="DRAFT_VIEW"><DraftingRoutes /></PermissionRoute>} />
              <Route path="/communication" element={<CommunicationDashboard />} />
              <Route path="/communication/settings" element={<CommunicationSettings />} />
              <Route path="/communication/history" element={<CommunicationHistory />} />
            </Routes>
          </Suspense>
        </section>
      </main>

      <AssistantPanel />
      <SearchProvider>
        <GlobalSearchModal isOpen={searchOpen} onClose={() => setSearchOpen(false)} onNavigate={handleSearchNavigate} />
      </SearchProvider>
      <QuickActionsModal isOpen={quickActionsOpen} onClose={() => setQuickActionsOpen(false)} onAction={handleQuickAction} />
    </div>
  );
}
