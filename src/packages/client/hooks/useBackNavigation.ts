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
 * Hook to handle browser back navigation.
 *
 * On all platforms a history buffer is pushed so that accidental trackpad
 * swipes (two-finger left on macOS/Linux) are silently absorbed instead of
 * navigating away from the app.
 *
 * On mobile devices an additional confirmation modal is shown when the user
 * exhausts the buffer, giving them the option to stay or leave.
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

    const isMobile = () => window.innerWidth <= 768;

    // Prevent both popstate and hashchange from firing on the same back gesture
    let backHandledAt = 0;

    const handleHashChange = () => {
      // Skip if popstate already handled this back gesture
      if (Date.now() - backHandledAt < 200) return;

      if (!window.location.hash.includes('app')) {
        window.location.hash = '#app';

        if (isMobile()) {
          if (!closeTopModal()) {
            window.__tideSetBackNavModal?.(true);
          }
        }
        // On desktop: silently absorbed — hash is restored, nothing else happens
      }
    };

    const handlePopState = (event: PopStateEvent) => {
      // Panels (FlatView, GuakeOutputPanel) maintain their own browser-history
      // stack of selected agents — they tag each entry with __flatAgentNav /
      // __guakeAgentNav. Re-pushing the hash buffer here would destroy the
      // forward stack those panels rely on for prev/next, so skip the re-push
      // when the popped state is owned by a panel.
      const ownedByPanel = !!(
        event.state &&
        typeof event.state === 'object' &&
        ((event.state as { __flatAgentNav?: unknown }).__flatAgentNav ||
          (event.state as { __guakeAgentNav?: unknown }).__guakeAgentNav)
      );

      if (!window.location.hash.includes('app')) {
        window.location.hash = '#app';
      }

      // Re-push the buffer entry so the next gesture is also absorbed
      if (!ownedByPanel && window.location.hash === '#app') {
        setTimeout(() => {
          if (window.location.hash === '#app' && !window.location.hash.includes('app2')) {
            window.history.pushState(null, '', '#app2');
            window.history.pushState(null, '', '#app');
          }
        }, 50);
      }

      if (isMobile()) {
        if (closeTopModal()) {
          backHandledAt = Date.now();
        } else if (!ownedByPanel) {
          window.__tideSetBackNavModal?.(true);
        }
      } else {
        // On desktop: try to close a modal if one is open, otherwise silently absorb
        closeTopModal();
        backHandledAt = Date.now();
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
