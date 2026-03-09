import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initializeTheme } from './utils/themes';
import './styles/main.scss';

// Initialize theme from localStorage before React renders
initializeTheme();

// Prevent horizontal trackpad overscroll from triggering browser back/forward navigation.
// CSS overscroll-behavior alone is insufficient on some platforms (e.g. Chrome on Linux).
// We intercept wheel events at the document level and prevent default for horizontal scrolls
// that would otherwise bubble up to the browser's navigation gesture handler.
document.addEventListener('wheel', (e: WheelEvent) => {
  // Only block horizontal-dominant gestures (two-finger swipe left/right)
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 0) {
    e.preventDefault();
  }
}, { passive: false });

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
