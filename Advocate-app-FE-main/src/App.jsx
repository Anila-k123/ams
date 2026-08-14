import { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";

import { isTokenExpired, logoutAndRedirect } from "./utils/auth.jsx"; // ✅ token helper

// Lazy-loaded route-level pages
const Homepage = lazy(() => import("./pages/Homepage.jsx"));
const Login = lazy(() => import("./pages/Login.jsx"));
const Signup = lazy(() => import("./pages/Signup.jsx"));
const Dashboard = lazy(() => import("./pages/Dashboard.jsx"));
const Cases = lazy(() => import("./pages/Cases.jsx"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword.jsx"));
const VerifyOtp = lazy(() => import("./pages/VerifyOtp.jsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.jsx"));

// ---------------- Protected Route Component ----------------
function ProtectedRoute({ children }) {
  const token = localStorage.getItem("token");

  // If no token or expired → auto logout & redirect
  if (!token || isTokenExpired(token)) {
    logoutAndRedirect();
    return null; // stop rendering this route
  }

  // Otherwise allow access
  return children;
}

// ---------------- App Component ----------------
function PageFallback() {
  return <div className="page-loading" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", color: "var(--text-muted, #6b7280)", fontSize: 14 }}><span>Loading...</span></div>;
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
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/verify-otp" element={<VerifyOtp />} />
        <Route path="/reset-password" element={<ResetPassword />} />

        {/* ✅ Protected: Dashboard */}
        <Route
          path="/dashboard/*"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        {/* ✅ Protected: Case Management */}
        <Route
          path="/cases"
          element={
            <ProtectedRoute>
              <Cases />
            </ProtectedRoute>
          }
        />

        {/* ✅ Fallback: Redirect unknown paths */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </ErrorBoundary>
    </Router>
  );
}

export default App;
