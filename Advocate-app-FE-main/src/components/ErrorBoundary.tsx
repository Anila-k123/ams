import { Component, type ErrorInfo, type ReactNode } from 'react';
import Icon from '../ui/Icon';

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
        <div className="row" style={{ minHeight: '100vh', justifyContent: 'center', padding: 'var(--s4)', background: 'var(--paper)', color: 'var(--ink)' }}>
          <div className="empty" style={{ maxWidth: 440 }}>
            <div className="art" style={{ background: 'var(--bad-soft)', color: 'var(--bad)' }}><Icon name="alert" size="lg" /></div>
            <h1 style={{ fontSize: 'var(--t-2xl)' }}>Something went wrong</h1>
            <p>An unexpected error stopped this page. Reload to try again, or go back to Today.</p>
            <div className="row" style={{ marginTop: 'var(--s3)' }}>
              <button type="button" className="btn primary" onClick={this.handleReload}><Icon name="refresh" size="sm" />Reload</button>
              <button type="button" className="btn" onClick={this.handleGoHome}><Icon name="home" size="sm" />Go to Today</button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
