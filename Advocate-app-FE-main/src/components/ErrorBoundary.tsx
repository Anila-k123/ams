import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from 'primereact/button';

interface State { hasError: boolean; error: any }

export default class ErrorBoundary extends Component<{ children?: ReactNode }, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: any): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/dashboard';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex align-items-center justify-content-center p-4"
          style={{ minHeight: '100vh', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
          <div className="text-center" style={{ maxWidth: 420 }}>
            <i className="pi pi-exclamation-triangle mb-4" style={{ fontSize: 32, color: 'var(--danger)' }} />
            <h1 className="text-xl font-bold mt-0 mb-2" style={{ color: 'var(--text-primary)' }}>Something went wrong</h1>
            <p className="text-sm line-height-3 mt-0 mb-5" style={{ color: 'var(--text-secondary)' }}>
              An unexpected error occurred. Please try reloading or return to the dashboard.
            </p>
            <div className="flex gap-3 justify-content-center">
              <Button icon="pi pi-refresh" label="Reload" onClick={this.handleReload} />
              <Button icon="pi pi-home" label="Dashboard" outlined onClick={this.handleGoHome} />
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
