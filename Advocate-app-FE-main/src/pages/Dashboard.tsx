import { lazy, Suspense, useEffect, useState, useCallback } from 'react';
import { useNavigate, Routes, Route, useLocation, Navigate } from 'react-router-dom';

import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useLoading } from '../contexts/LoadingContext';
import { DashboardFilterProvider, useDashboardFilter } from '../contexts/DashboardFilterContext';
import { AssistantProvider } from '../contexts/AssistantContext';
import { WebSocketProvider } from '../contexts/realtime/WebSocketProvider';
import { SidebarProvider, useSidebar } from '../contexts/SidebarContext';
import { PermissionProvider, usePermission } from '../contexts/PermissionContext';
import { SearchProvider } from '../contexts/SearchContext';
import dashboardService from '../services/DashboardService';
import AssistantPanel from '../components/AssistantPanel';
import PermissionRoute from '../components/PermissionRoute';
import NotificationBell from '../components/NotificationBell';
import HearingAlertPopup from '../components/HearingAlertPopup';
import { requestPageModal } from '../utils/pageModal';
import '../assets/styles/RealTime.css';

import Sidebar from '../layout/Sidebar';
import CommandPalette from '../layout/CommandPalette';
import { activeItem, groupOf, QUICK_CREATE, LEGAL_WORK_PERMS, COMMS_PERMS, type Perm, type CountKey } from '../layout/nav';
import Icon from '../ui/Icon';
import { Avatar, PopMenu, Spinner, type MenuItem } from '../ui/kit';

// Nested sub-pages (lazy-loaded)
const Today = lazy(() => import('./Today'));
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
      {/* Outermost, so the assistant can also tailor itself to the user's role. */}
      <PermissionProvider>
        <AssistantProvider token={token}>
          <WebSocketProvider>
            <SidebarProvider>
              <SearchProvider>
                <AppShell />
              </SearchProvider>
            </SidebarProvider>
          </WebSocketProvider>
        </AssistantProvider>
      </PermissionProvider>
    </DashboardFilterProvider>
  );
}

// Detail pages have no sidebar entry of their own; their crumb names the page type.
function detailCrumb(path: string): string | null {
  if (/\/cases\/new$/.test(path)) return 'New case';
  if (/\/cases\/\d+/.test(path)) return 'Case';
  if (/\/acts\/[^/]+$/.test(path)) return 'Act';
  if (/\/drafting\/new/.test(path)) return 'New draft';
  return null;
}

// ====== SHELL: sidebar, top bar, routed page, Lisa ======
function AppShell() {
  const { hasPermission } = usePermission() as any;
  const navigate = useNavigate();
  const auth = useAuth() as any;
  const { theme, toggleTheme } = useTheme() as any;
  const { withLoading } = useLoading() as any;
  const fullName = auth.fullName || 'Advocate';
  const email = auth.email || '';
  const [branding, setBranding] = useState({ profilePhotoUrl: '', officeName: '' });
  const [searchOpen, setSearchOpen] = useState(false);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; items: MenuItem[]; align?: 'left' | 'right'; width?: number } | null>(null);

  const { isCollapsed, isMobile, toggleSidebar, closeSidebar, mobileOpen } = useSidebar() as any;
  const location = useLocation();
  const path = location.pathname.replace(/\/$/, '') || '/dashboard';

  // Tablet widths (769-1024px) show the icon rail unless the drawer is open.
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const on = () => setWidth(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const rail = (!isMobile && isCollapsed) || (width <= 1024 && width > 768 && !mobileOpen);

  // `perm` may be one permission or a list (any one is enough).
  const can = useCallback((perm?: Perm) => {
    if (!perm) return true;
    return (Array.isArray(perm) ? perm : [perm]).some((p) => hasPermission(p));
  }, [hasPermission]);

  const filter = useDashboardFilter() as any;
  const summary = filter.data?.summary ?? {};
  const counts: Partial<Record<CountKey, number>> = {
    activeCases: summary.activeCases,
    pendingInvoices: filter.data?.canViewFinance ? summary.pendingInvoices : 0,
  };

  // Page identity: sidebar item, its group, and a detail crumb.
  const item = activeItem(path);
  const group = groupOf(item);
  const detail = detailCrumb(path);
  useEffect(() => {
    document.title = `${detail || item?.label || 'PactPro'} · PactPro`;
  }, [detail, item]);

  // Escape closes the mobile drawer; a route change closes it too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && mobileOpen) closeSidebar(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeSidebar, mobileOpen]);

  // Profile sync: full profile so the sidebar can show the firm name and photo.
  const { updateProfile } = auth;
  useEffect(() => {
    api.get('/api/profile')
      .then((res) => {
        const d = res.data || {};
        const patch: { fullName?: string; email?: string } = {};
        if (d.fullName) patch.fullName = d.fullName;
        if (d.email) patch.email = d.email;
        if (patch.fullName || patch.email) updateProfile(patch);
        setBranding({ profilePhotoUrl: d.profilePhotoUrl || '', officeName: d.officeName || '' });
      })
      .catch(() => {});
  }, [auth.token, updateProfile]);

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

  // Ctrl+K: search and commands.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // A record picked in search opens its page, which highlights and scrolls to it.
  const openRecord = useCallback((type: string, rec: any) => {
    const search = rec.name || rec.caseTitle || rec.caseNumber || rec.documentName || rec.originalName || rec.invoiceNumber || rec.title;
    if (type === 'cases' && rec.id) { navigate(`/dashboard/cases/${rec.id}`); return; }
    const routes: Record<string, string> = {
      clients: '/dashboard/clients', cases: '/dashboard/cases', documents: '/dashboard/documents',
      invoices: '/dashboard/invoices', expenses: '/dashboard/expenses', tasks: '/dashboard/tasks',
      events: '/dashboard/hearings', hearings: '/dashboard/hearings', payments: '/dashboard/invoices',
    };
    if (routes[type]) navigate(routes[type], { state: { search, id: rec.id } });
  }, [navigate]);

  // Create actions navigate to the page and ask it to open its add form on arrival.
  const runCreate = useCallback((a: typeof QUICK_CREATE[number]) => {
    if (a.modal) requestPageModal(a.modal);
    navigate(a.route);
  }, [navigate]);

  const allowedCreate = QUICK_CREATE.filter((a) => hasPermission(a.perm));
  const openNewMenu = (anchor: HTMLElement) => {
    const items: MenuItem[] = [];
    (['matter', 'finance', 'work'] as const).forEach((g) => {
      const part = allowedCreate.filter((a) => a.group === g);
      if (!part.length) return;
      if (items.length) items.push('-');
      items.push(...part.map((a) => ({ label: a.label, icon: a.icon, onClick: () => runCreate(a) })));
    });
    setMenu({ anchor, items, width: 240 });
  };

  const openUserMenu = (anchor: HTMLElement, align: 'left' | 'right' = 'left') => setMenu({
    anchor, align, width: 240,
    items: [
      { label: 'Profile & settings', icon: 'cog', onClick: () => navigate('/dashboard/settings') },
      { label: theme === 'dark' ? 'Light theme' : 'Dark theme', icon: theme === 'dark' ? 'sun' : 'moon', onClick: handleToggleTheme },
      '-',
      { label: 'Sign out', icon: 'logout', danger: true, onClick: handleLogout },
    ],
  });

  const appClass = ['app', !isMobile && isCollapsed ? 'collapsed' : '', mobileOpen ? 'mobile-open' : ''].filter(Boolean).join(' ');

  return (
    <div className={appClass}>
      <Sidebar
        can={can}
        counts={counts}
        hot={['pendingInvoices']}
        rail={rail}
        firmName={branding.officeName}
        onNavigate={() => { if (mobileOpen) closeSidebar(); }}
      />
      <div className="scrim" onClick={closeSidebar} aria-hidden="true" />

      <div className="main">
        <header className="top">
          <button type="button" className="icon-btn hamb" onClick={toggleSidebar} aria-label="Open menu" title="Menu"><Icon name="menu" /></button>
          <button type="button" className="icon-btn hide-sm" onClick={toggleSidebar}
            aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar'} title={rail ? 'Expand sidebar' : 'Collapse sidebar'}>
            <Icon name="sidebar" />
          </button>
          <nav className="crumbs" aria-label="Breadcrumb">
            {group && <><span className="hide-sm">{group.label}</span><span className="sep hide-sm" aria-hidden="true">/</span></>}
            {detail && item ? (
              <><a href={item.path} onClick={(e) => { e.preventDefault(); navigate(item.path); }}>{item.label}</a><span className="sep" aria-hidden="true">/</span><b>{detail}</b></>
            ) : <b>{item?.label || 'Today'}</b>}
          </nav>
          <span className="spacer" />
          <button type="button" className="top-search" onClick={() => setSearchOpen(true)} aria-label="Search">
            <Icon name="search" size="sm" /><span>Search cases, clients, documents…</span>
          </button>
          {allowedCreate.length > 0 && (
            <button type="button" className="btn primary sm hide-sm" aria-haspopup="menu" onClick={(e) => openNewMenu(e.currentTarget)}>
              <Icon name="plus" size="sm" />New
            </button>
          )}
          <NotificationBell onOpen={(route) => navigate(route)}
            footer={can(COMMS_PERMS) ? { label: 'Open delivery log', route: '/dashboard/notifications' } : undefined} />
          <button type="button" className="icon-btn hide-sm" onClick={handleToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
          </button>
          <button type="button" className="user-btn" aria-haspopup="menu" onClick={(e) => openUserMenu(e.currentTarget, 'right')} title={email || fullName}>
            <Avatar name={fullName} src={branding.profilePhotoUrl} size="sm" />
            <span className="name small hide-sm">{fullName.split(' ')[0]}</span>
            <Icon name="chevronDown" size="sm" />
          </button>
        </header>

        {hasPermission('EVENT_VIEW') && <HearingAlertPopup onView={() => navigate('/dashboard/hearings')} />}

        <main className="content fade-in" key={group?.id === 'drafting' ? 'drafting' : path} id="main">
          <Suspense fallback={<div style={{ padding: 'var(--s8) 0' }}><Spinner /></div>}>
            <Routes>
              <Route path="/" element={<Today />} />
              <Route path="/cases" element={<PermissionRoute permissions="CASE_VIEW"><Cases /></PermissionRoute>} />
              <Route path="/cases/new" element={<PermissionRoute permissions="CASE_CREATE"><AddCase /></PermissionRoute>} />
              <Route path="/display-board" element={<DisplayBoard />} />
              <Route path="/daily-causelist" element={<DailyCauselist />} />
              <Route path="/cases/:id" element={<PermissionRoute permissions="CASE_VIEW"><CaseDetail /></PermissionRoute>} />
              <Route path="/clients" element={<PermissionRoute permissions="CLIENT_VIEW"><Clients /></PermissionRoute>} />
              <Route path="/expenses" element={<PermissionRoute permissions="EXPENSE_VIEW"><Expenses /></PermissionRoute>} />
              <Route path="/calendar" element={<Navigate to="/dashboard/hearings" replace />} />
              <Route path="/hearings" element={<PermissionRoute permissions="EVENT_VIEW"><HearingsPage /></PermissionRoute>} />
              <Route path="/documents" element={<PermissionRoute permissions="DOCUMENT_VIEW"><DocumentsPanel /></PermissionRoute>} />
              <Route path="/invoices" element={<PermissionRoute permissions="INVOICE_VIEW"><InvoicesPanel /></PermissionRoute>} />
              <Route path="/settings" element={<ProfilePage />} />
              <Route path="/reports" element={<PermissionRoute permissions="REPORT_VIEW"><ReportsCenter /></PermissionRoute>} />
              <Route path="/tasks" element={<PermissionRoute permissions="TASK_VIEW"><TasksPage /></PermissionRoute>} />
              <Route path="/notifications" element={<PermissionRoute permissions={COMMS_PERMS}><NotificationsCenter /></PermissionRoute>} />
              <Route path="/appeal-alert" element={<PermissionRoute permissions={LEGAL_WORK_PERMS}><AppealAlert /></PermissionRoute>} />
              <Route path="/acts" element={<PermissionRoute permissions={LEGAL_WORK_PERMS}><Acts /></PermissionRoute>} />
              <Route path="/acts/:id" element={<PermissionRoute permissions={LEGAL_WORK_PERMS}><ActDetail /></PermissionRoute>} />
              <Route path="/legal-dictionary" element={<PermissionRoute permissions={LEGAL_WORK_PERMS}><LegalDictionary /></PermissionRoute>} />
              <Route path="/law-codes" element={<PermissionRoute permissions={LEGAL_WORK_PERMS}><LawCodes /></PermissionRoute>} />
              <Route path="/activity" element={<PermissionRoute permissions="AUDIT_VIEW"><SystemActivity /></PermissionRoute>} />
              <Route path="/backup" element={<PermissionRoute permissions="BACKUP_MANAGE"><BackupPage /></PermissionRoute>} />
              {/* Admin routes are permission-gated, not just hidden from the sidebar (codes match rbac/views.py). */}
              <Route path="/users" element={<PermissionRoute permissions="USER_MANAGE"><UserManagement /></PermissionRoute>} />
              <Route path="/roles" element={<PermissionRoute permissions="ROLE_MANAGE"><RoleManagement /></PermissionRoute>} />
              {/* Drafting (merged from InstaDraft, merge phase 04). */}
              <Route path="/drafting/*" element={<PermissionRoute permissions="DRAFT_VIEW"><DraftingRoutes /></PermissionRoute>} />
              <Route path="/communication" element={<PermissionRoute permissions={COMMS_PERMS}><CommunicationDashboard /></PermissionRoute>} />
              <Route path="/communication/settings" element={<PermissionRoute permissions="SETTINGS_EDIT"><CommunicationSettings /></PermissionRoute>} />
              <Route path="/communication/history" element={<PermissionRoute permissions={COMMS_PERMS}><CommunicationHistory /></PermissionRoute>} />
            </Routes>
          </Suspense>
        </main>
      </div>

      <AssistantPanel />
      <CommandPalette isOpen={searchOpen} onClose={() => setSearchOpen(false)} can={can}
        onOpenRecord={openRecord} onGo={(p) => navigate(p)} onCreate={runCreate} />
      {menu && <PopMenu anchor={menu.anchor} items={menu.items} align={menu.align} width={menu.width} onClose={() => setMenu(null)} />}
    </div>
  );
}

