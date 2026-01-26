import { useEffect, useState } from 'react';
import { closeTopModal } from './useModalStack';

// Window extensions for back navigation
declare global {
  interface Window {
    __tideSetBackNavModal?: (show: boolean) => void;
    __tideBackNavSetup?: boolean;
    __tideHistoryDepth?: number;
  }
}

/**
 * Hook to handle browser back navigation confirmation on mobile devices.
 * Returns state and handlers for the back navigation modal.
 */
export function useBackNavigation(): {
  showBackNavModal: boolean;
  setShowBackNavModal: (show: boolean) => void;
  handleLeave: () => void;
} {
  const [showBackNavModal, setShowBackNavModal] = useState(false);

  // Always keep the current setState on window
  window.__tideSetBackNavModal = setShowBackNavModal;

  useEffect(() => {
    // Only enable exit prevention on mobile devices
    const isMobile = window.innerWidth <= 768;
    if (!isMobile) {
      return;
    }

    // Only setup the listener once globally (survives HMR)
    if (window.__tideBackNavSetup) {
      if (!window.location.hash.includes('app')) {
        window.location.hash = '#app';
      }
      return;
    }

    window.__tideBackNavSetup = true;

    // Set initial hash if not present
    if (!window.location.hash.includes('app')) {
      window.location.hash = '#app';
    }

    const handleHashChange = () => {
      if (window.innerWidth > 768) return;

      if (!window.location.hash.includes('app')) {
        window.location.hash = '#app';

        if (!closeTopModal()) {
          window.__tideSetBackNavModal?.(true);
        }
      }
    };

    const handlePopState = () => {
      if (window.innerWidth > 768) return;

      if (!window.location.hash.includes('app')) {
        window.location.hash = '#app';
      }

      if (window.location.hash === '#app') {
        setTimeout(() => {
          if (window.location.hash === '#app' && !window.location.hash.includes('app2')) {
            window.history.pushState(null, '', '#app2');
            window.history.pushState(null, '', '#app');
          }
        }, 50);
      }

      if (!closeTopModal()) {
        window.__tideSetBackNavModal?.(true);
      }
    };

    // Push multiple hash entries to create a buffer
    window.history.pushState(null, '', '#app1');
    window.history.pushState(null, '', '#app2');
    window.history.pushState(null, '', '#app');

    window.addEventListener('hashchange', handleHashChange);
    window.addEventListener('popstate', handlePopState);
    // Never remove - persists for page lifetime
  }, []);

  const handleLeave = () => {
    setShowBackNavModal(false);
    const depth = window.__tideHistoryDepth ?? 2;
    window.history.go(-(depth + 1));
  };

  return {
    showBackNavModal,
    setShowBackNavModal,
    handleLeave,
  };
}
