import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initializeTheme } from './utils/themes';
import './styles/main.scss';

// Initialize theme from localStorage before React renders
initializeTheme();

const container = document.getElementById('app');
if (!container) {
  throw new Error('Could not find #app container');
}

const root = createRoot(container);
root.render(
  <React.StrictMode>
    <Suspense fallback={<div style={{ background: '#0a0a0a', height: '100vh' }} />}>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </Suspense>
  </React.StrictMode>
);

console.log('[Tide] Tide Commander initialized');
