import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Spinner } from './ui/kit';
import ErrorBoundary from './components/ErrorBoundary';
import { isTokenExpired, logoutAndRedirect } from './utils/auth';
import { useAuth } from './context/AuthContext';
import { PermissionProvider } from './contexts/PermissionContext';
import PermissionRoute from './components/PermissionRoute';
import DesktopEditsBar from './components/DesktopEditsBar';

// Lazy-loaded route-level pages
const Homepage = lazy(() => import('./pages/Homepage'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Cases = lazy(() => import('./pages/Cases'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const VerifyOtp = lazy(() => import('./pages/VerifyOtp'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
// Client role: the client-only view shown at /dashboard for CLIENT users, and the
// public page that sets a password from an invite link.
const ClientApp = lazy(() => import('./client/ClientApp'));
const SetPassword = lazy(() => import('./client/SetPassword'));
const ClientLogin = lazy(() => import('./client/ClientLogin'));
const AcceptInvite = lazy(() => import('./pages/AcceptInvite'));
const PlatformApp = lazy(() => import('./platform/PlatformApp'));
// Full-screen drafting pages (outside the sidebar shell).
const DraftingSampleTool = lazy(() => import('./pages/Drafting/Standalone').then((m: any) => ({ default: m.SampleTool })));
const DraftingEditor = lazy(() => import('./pages/Drafting/Standalone').then((m: any) => ({ default: m.DraftEditor })));

// No token or an expired one: sign out and go to /login.
function ProtectedRoute({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  if (!token || isTokenExpired(token)) {
    logoutAndRedirect();
    return null;
  }
  return <>{children}</>;
}

// Clients live under /client, staff everywhere else (the backend enforces the
// split too: clientaccess/gate.py). Each side is sent to its own home.
function DashboardForRole() {
  const { isClient } = useAuth();
  return isClient ? <Navigate to="/client" replace /> : <Dashboard />;
}
function CasesForRole() {
  const { isClient } = useAuth();
  return isClient ? <Navigate to="/client" replace /> : <Cases />;
}
function NotForClient({ children }: { children: ReactNode }) {
  const { isClient } = useAuth();
  return isClient ? <Navigate to="/client" replace /> : <>{children}</>;
}
function ClientRoute() {
  const { token, isClient } = useAuth();
  if (!token || isTokenExpired(token)) return <Navigate to={`/client/login${window.location.search}`} replace />;
  return isClient ? <ClientApp /> : <Navigate to="/dashboard" replace />;
}
// Invite links sent before the portal moved to /client.
function OldSetPassword() {
  return <Navigate to={`/client/set-password${window.location.search}`} replace />;
}

function PageFallback() {
  return (
    <div className="row" style={{ minHeight: '100vh', justifyContent: 'center' }}>
      <Spinner />
    </div>
  );
}

function App() {
  return (
    <Router>
      <ErrorBoundary>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            {/* Public Routes */}
            <Route path="/" element={<Homepage />} />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/verify-otp" element={<VerifyOtp />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/set-password" element={<OldSetPassword />} />
            {/* Client portal: its own sign-in and pages */}
            <Route path="/client/login" element={<ClientLogin />} />
            <Route path="/client/set-password" element={<SetPassword />} />
            <Route path="/client/forgot-password" element={<ForgotPassword />} />
            <Route path="/client/verify-otp" element={<VerifyOtp />} />
            <Route path="/client/reset-password" element={<ResetPassword />} />
            <Route path="/client/*" element={<ClientRoute />} />
            <Route path="/accept-invite" element={<AcceptInvite />} />
            {/* Platform operators: separate session, never the firm token */}
            <Route path="/platform/*" element={<PlatformApp />} />

            <Route path="/dashboard/*" element={<ProtectedRoute><DashboardForRole /></ProtectedRoute>} />
            <Route path="/cases" element={<ProtectedRoute><CasesForRole /></ProtectedRoute>} />

            {/* Drafting, full-screen. Clients are refused by the backend gate; send them home. */}
            <Route path="/samples/:id/*" element={<ProtectedRoute><NotForClient><PermissionProvider><PermissionRoute permissions="DRAFT_VIEW"><DraftingSampleTool /></PermissionRoute></PermissionProvider></NotForClient></ProtectedRoute>} />
            <Route path="/draft/:sessionId" element={<ProtectedRoute><NotForClient><PermissionProvider><PermissionRoute permissions="DRAFT_VIEW"><DraftingEditor /></PermissionRoute></PermissionProvider></NotForClient></ProtectedRoute>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        {/* Desktop edits waiting for "Save to PactPro", on every page (docs/DESKTOP_EDITING.md). */}
        <DesktopEditsBar />
      </ErrorBoundary>
    </Router>
  );
}

export default App;
