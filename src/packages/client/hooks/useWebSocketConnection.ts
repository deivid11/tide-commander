/**
 * useWebSocketConnection - Hook for initializing WebSocket connection
 *
 * This hook handles the WebSocket connection and callbacks independently of
 * whether 2D or 3D view is active. This ensures agents are synced on page load
 * regardless of the active view mode.
 */

import { useEffect } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { store } from '../store';
import { connect, setCallbacks, suspendForBackground, resumeFromBackground, verifyConnection } from '../websocket';
import { runPostReconnectResync } from '../services/postReconnectResync';
import {
  getWsConnected,
  setWsConnected,
  getPersistedScene,
} from '../app/sceneLifecycle';
import {
  requestNotificationPermission,
  initNotificationListeners,
  openAgentTerminalFromNotification,
  isNativeApp,
} from '../utils/notifications';
import type { ToastType } from '../components/Toast';
import type { WhatsAppMessagePayload } from '../websocket/callbacks';

interface UseWebSocketConnectionOptions {
  showToast: (type: ToastType, title: string, message: string, duration?: number) => void;
  showAgentNotification: (notification: any) => void;
  showWhatsAppMessage: (payload: WhatsAppMessagePayload) => void;
}

/**
 * Hook for initializing the WebSocket connection and agent syncing.
 * This runs regardless of 2D/3D view mode to ensure agents are loaded on page refresh.
 */
export function useWebSocketConnection({
  showToast,
  showAgentNotification,
  showWhatsAppMessage,
}: UseWebSocketConnectionOptions): void {
  useEffect(() => {
    // Set up websocket callbacks for store updates
    // Note: Scene-specific callbacks (like visual effects for onAgentCreated, onToolUse, etc.)
    // are set up separately in useSceneSetup/useScene2DSetup using setCallbacks which merges
    setCallbacks({
      onToast: showToast,
      onReconnect: () => {
        store.triggerReconnect();
        void runPostReconnectResync();
      },
      onAgentNotification: (notification) => {
        showAgentNotification(notification);
      },
      onWhatsAppMessage: (payload) => {
        showWhatsAppMessage(payload);
      },
    });

    // Keep callback wiring fresh across remounts (e.g. React StrictMode),
    // but only establish the socket once.
    if (!getWsConnected()) {
      connect();
      setWsConnected(true);
    }

    // Request notification permissions
    requestNotificationPermission();
    let cleanupNotificationListeners: (() => void) | undefined;
    initNotificationListeners((data) => {
      if (data.type === 'agent_notification' && typeof data.agentId === 'string') {
        openAgentTerminalFromNotification(data.agentId);
      }
    }).then((cleanup) => {
      cleanupNotificationListeners = cleanup;
    });

    // Handle app resume from background (Android)
    const handleAppResume = () => {
      console.log('[Tide] App resumed from background, reconnecting...');
      setTimeout(() => {
        resumeFromBackground();
        recoverForegroundView();
      }, 100);
    };
    window.addEventListener('tideAppResume', handleAppResume);

    return () => {
      window.removeEventListener('tideAppResume', handleAppResume);
      cleanupNotificationListeners?.();
    };
  }, [showToast, showAgentNotification, showWhatsAppMessage]);

  // Wake-up verification (all platforms): when the tab becomes visible again
  // or the network comes back, don't trust readyState — on mobile a socket
  // whose TCP died during doze/a network switch keeps reporting OPEN for
  // minutes while nothing flows. verifyConnection() proves the socket with a
  // ping deadline and replaces it (reconnect → resync → history refetch) if
  // it's a zombie. Browsers/PWA had NO wake-up hook at all before this.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        verifyConnection();
        // Also repaint/recover here: on some Android WebView builds
        // `visibilitychange` fires on resume but the native `tideAppResume`
        // event is delayed or missed. Idempotent — double firing is harmless.
        recoverForegroundView();
      }
    };
    const handleOnline = () => {
      verifyConnection();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  // Post-boot paint recovery (native only). An OTA bundle swap reloads the
  // WebView — often moments after a resume — and the freshly booted context
  // receives NO tideAppResume/visibilitychange, so a compositor that came back
  // black after that reload had nothing to kick it. One idempotent nudge after
  // first paint covers it (no-op when everything painted fine).
  useEffect(() => {
    if (!isNativeApp()) return;
    const timer = setTimeout(() => recoverForegroundView(), 600);
    return () => clearTimeout(timer);
  }, []);

  // Native app only: park the WebSocket while backgrounded. The Android
  // foreground service delivers notifications through its own native socket,
  // so keeping the JS socket open in the background just burns CPU/battery
  // processing the broadcast firehose with nothing on screen. The grace
  // period avoids reconnect churn on quick app switches. Browser/PWA keeps
  // the socket: there the JS socket IS the notification path.
  useEffect(() => {
    if (!isNativeApp()) return;

    let graceTimer: number | null = null;
    let listener: PluginListenerHandle | null = null;
    let cancelled = false;

    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        if (graceTimer !== null) {
          clearTimeout(graceTimer);
          graceTimer = null;
        }
        resumeFromBackground();
      } else {
        if (graceTimer !== null) clearTimeout(graceTimer);
        graceTimer = window.setTimeout(() => {
          graceTimer = null;
          suspendForBackground();
        }, BACKGROUND_SUSPEND_GRACE_MS);
      }
    }).then((h) => {
      if (cancelled) {
        void h.remove();
      } else {
        listener = h;
      }
    });

    return () => {
      cancelled = true;
      if (graceTimer !== null) clearTimeout(graceTimer);
      if (listener) void listener.remove();
    };
  }, []);
}

/**
 * Recover the visible view when the native app returns to the foreground.
 *
 * Android's WebView can leave the screen BLACK after a resume in two ways this
 * addresses:
 *  1. 3D view — the WebGL context is dropped in the background and
 *     `webglcontextrestored` often never fires on Android, so onContextLost's
 *     render-loop stop is permanent → black canvas. `recoverAfterResume()`
 *     force-restores the context + restarts the loop (no-op with no live scene,
 *     e.g. in flat view).
 *  2. Flat / DOM view — the WebView's GPU-composited layer can come back black
 *     even though the DOM is intact. Toggling `opacity` by an imperceptible
 *     amount invalidates the compositor layer and forces a re-composite/repaint.
 *     Opacity (unlike `transform`/`filter`) does NOT establish a containing
 *     block for `position: fixed` descendants, so this can't shift the layout —
 *     it's a safe, invisible nudge.
 *
 * No wake lock, no extra sockets — respects the background-heat constraints.
 */
function recoverForegroundView(): void {
  try {
    getPersistedScene()?.recoverAfterResume();
  } catch {
    // scene torn down / not present — the compositor nudge below still runs.
  }
  // The compositor-black issue is specific to the Android WebView (APK); on
  // desktop/PWA backgrounding never blacks the layer, so skip the nudge there.
  if (!isNativeApp()) return;
  const body = document.body;
  if (!body) return;
  const prev = body.style.opacity;
  body.style.opacity = '0.999999';
  requestAnimationFrame(() => {
    body.style.opacity = prev;
  });
}

// How long the app must stay backgrounded before the socket is parked.
// Long enough to survive quick app switches, short enough that a phone left
// in a pocket stops processing the firehose within half a minute.
const BACKGROUND_SUSPEND_GRACE_MS = 20_000;
