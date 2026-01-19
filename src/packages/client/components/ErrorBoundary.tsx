import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[Tide] React Error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleDismiss = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      const { error, errorInfo } = this.state;

      return (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: '#1a1a2e',
          color: '#fff',
          fontFamily: 'monospace',
          padding: '32px',
          overflow: 'auto',
          zIndex: 99999,
        }}>
          <div style={{
            maxWidth: '900px',
            margin: '0 auto',
          }}>
            <h1 style={{
              color: '#ff4a4a',
              fontSize: '24px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            }}>
              <span style={{ fontSize: '32px' }}>💥</span>
              Tide Commander Crashed
            </h1>

            <div style={{
              background: '#2a2a3e',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '16px',
            }}>
              <div style={{ color: '#ff6b6b', fontSize: '18px', marginBottom: '8px' }}>
                {error?.name}: {error?.message}
              </div>
            </div>

            <div style={{
              background: '#2a2a3e',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '16px',
            }}>
              <div style={{ color: '#888', marginBottom: '8px', fontSize: '12px' }}>
                STACK TRACE
              </div>
              <pre style={{
                color: '#ccc',
                fontSize: '12px',
                lineHeight: '1.5',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: 0,
              }}>
                {error?.stack}
              </pre>
            </div>

            {errorInfo?.componentStack && (
              <div style={{
                background: '#2a2a3e',
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '16px',
              }}>
                <div style={{ color: '#888', marginBottom: '8px', fontSize: '12px' }}>
                  COMPONENT STACK
                </div>
                <pre style={{
                  color: '#ccc',
                  fontSize: '12px',
                  lineHeight: '1.5',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  margin: 0,
                }}>
                  {errorInfo.componentStack}
                </pre>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={this.handleReload}
                style={{
                  background: '#4a9eff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '12px 24px',
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                Reload Page
              </button>
              <button
                onClick={this.handleDismiss}
                style={{
                  background: '#444',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '12px 24px',
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                Try to Continue
              </button>
            </div>

            <div style={{
              marginTop: '24px',
              color: '#666',
              fontSize: '12px',
            }}>
              Check the browser console for more details.
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
