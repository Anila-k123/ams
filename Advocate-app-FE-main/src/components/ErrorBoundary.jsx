import { Component } from "react";
import { FiAlertTriangle, FiRefreshCw, FiHome } from "react-icons/fi";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = "/dashboard";
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
          background: "var(--bg-primary, #0f172a)",
          color: "var(--text-primary, #e2e8f0)",
          fontFamily: "'Inter', -apple-system, sans-serif",
          padding: 24,
        }}>
          <div style={{
            textAlign: "center",
            maxWidth: 420,
          }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "rgba(239,68,68,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 24px",
            }}>
              <FiAlertTriangle size={28} color="#ef4444" />
            </div>
            <h1 style={{
              fontSize: 20,
              fontWeight: 700,
              margin: "0 0 8px",
              color: "var(--text-primary, #e2e8f0)",
            }}>Something went wrong</h1>
            <p style={{
              fontSize: 14,
              color: "var(--text-secondary, #94a3b8)",
              lineHeight: 1.6,
              margin: "0 0 32px",
            }}>
              An unexpected error occurred. Please try reloading or return to the dashboard.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                onClick={this.handleReload}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 20px",
                  borderRadius: 10,
                  border: "none",
                  background: "var(--accent-blue, #6366f1)",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "opacity 0.15s",
                }}
                onMouseOver={e => e.currentTarget.style.opacity = "0.9"}
                onMouseOut={e => e.currentTarget.style.opacity = "1"}
              >
                <FiRefreshCw size={16} /> Reload
              </button>
              <button
                onClick={this.handleGoHome}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 20px",
                  borderRadius: 10,
                  border: "1px solid var(--border-color, #334155)",
                  background: "transparent",
                  color: "var(--text-primary, #e2e8f0)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseOver={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                onMouseOut={e => e.currentTarget.style.background = "transparent"}
              >
                <FiHome size={16} /> Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
