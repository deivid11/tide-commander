import React from 'react';
import { createRoot } from 'react-dom/client';
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
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

console.log('[Tide] Tide Commander initialized');
