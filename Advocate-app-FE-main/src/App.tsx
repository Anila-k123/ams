import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ProgressSpinner } from 'primereact/progressspinner';
import ErrorBoundary from './components/ErrorBoundary';
import { isTokenExpired, logoutAndRedirect } from './utils/auth';
import { useAuth } from './context/AuthContext';

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

// Client-role users get the client-only view (the backend enforces this too).
function DashboardForRole() {
  const { isClient } = useAuth();
  return isClient ? <ClientApp /> : <Dashboard />;
}
function CasesForRole() {
  const { isClient } = useAuth();
  return isClient ? <Navigate to="/dashboard" replace /> : <Cases />;
}
function NotForClient({ children }: { children: ReactNode }) {
  const { isClient } = useAuth();
  return isClient ? <Navigate to="/dashboard" replace /> : <>{children}</>;
}

function PageFallback() {
  return (
    <div className="page-loading flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
      <ProgressSpinner style={{ width: 40, height: 40 }} strokeWidth="4" />
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
            <Route path="/set-password" element={<SetPassword />} />

            <Route path="/dashboard/*" element={<ProtectedRoute><DashboardForRole /></ProtectedRoute>} />
            <Route path="/cases" element={<ProtectedRoute><CasesForRole /></ProtectedRoute>} />

            {/* Drafting, full-screen. Clients are refused by the backend gate; send them home. */}
            <Route path="/samples/:id/*" element={<ProtectedRoute><NotForClient><DraftingSampleTool /></NotForClient></ProtectedRoute>} />
            <Route path="/draft/:sessionId" element={<ProtectedRoute><NotForClient><DraftingEditor /></NotForClient></ProtectedRoute>} />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Router>
  );
}

export default App;
