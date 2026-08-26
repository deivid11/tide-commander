import React, { Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initializeTheme } from './utils/themes';
import { installTooltipLeakFix } from './utils/tooltipLeakFix';
import { installExternalNavigation } from './utils/external-navigation';
import { initializePlugins } from './plugins';
import './styles/main.scss';

// Initialize theme and bundled/runtime plugin contributions before React renders.
initializeTheme();
initializePlugins();

// Keep Chromium from stranding a native tooltip above every other app when the
// window loses focus while one is showing (most visible in the installed app).
installTooltipLeakFix();

// In the APK, send external links straight to Android. Letting WebView process
// target=_blank can leave its original GPU surface black when the user returns.
installExternalNavigation();

// Recover from stale Vite chunk references after the server has been rebuilt
// while this tab was idle. Vite emits `vite:preloadError` when a hashed
// asset (e.g. a lazy-loaded CSS file) is no longer on disk; without a
// handler the rejection bubbles into Suspense and crashes the ErrorBoundary.
// The sessionStorage guard is cleared once App renders successfully, so a
// future genuine preload error will still trigger one reload.
const PRELOAD_RELOAD_KEY = 'tide:preload-reloaded';
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  if (!sessionStorage.getItem(PRELOAD_RELOAD_KEY)) {
    sessionStorage.setItem(PRELOAD_RELOAD_KEY, String(Date.now()));
    window.location.reload();
  }
});
window.addEventListener('load', () => {
  setTimeout(() => sessionStorage.removeItem(PRELOAD_RELOAD_KEY), 5000);
});

// Prevent horizontal trackpad overscroll from triggering browser back/forward navigation.
// CSS overscroll-behavior alone is insufficient on some platforms (e.g. Chrome on Linux).
// Only block horizontal swipes that land on the scene canvas — all other elements
// (scrollable divs, panels, etc.) should retain native horizontal scroll behavior.
document.addEventListener('wheel', (e: WheelEvent) => {
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 0) {
    const target = e.target as Element;
    // Only block horizontal overscroll for canvas elements (3D/2D scene)
    // and elements with no scrollable ancestor (bare app background).
    if (target.tagName === 'CANVAS') {
      e.preventDefault();
      return;
    }
    // For non-canvas targets, check if ANY ancestor can scroll horizontally.
    // If none can, block the gesture to prevent browser navigation.
    let el = target as HTMLElement | null;
    while (el && el !== document.documentElement) {
      if (el.scrollWidth > el.clientWidth) {
        return; // scrollable element found — let the browser handle it
      }
      el = el.parentElement;
    }
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
