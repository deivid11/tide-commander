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
import { initPushNotifications } from '../utils/push-notifications';
import { apiUrl, authFetch } from '../utils/storage';
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

    // Native push (Android): when the server has Firebase credentials this
    // takes over background delivery and the battery-hungry WebSocket
    // foreground service is stood down. No-op everywhere else.
    let cleanupPushListeners: (() => void) | undefined;
    void initPushNotifications().then((cleanup) => {
      cleanupPushListeners = cleanup;
    });

    // Handle app resume from background (Android)
    const handleAppResume = () => {
      console.log('[Tide] App resumed from background, reconnecting...');
      sendLifecycleBeacon('resume');
      setTimeout(() => {
        resumeFromBackground();
        recoverForegroundView();
      }, 100);
      // Second recovery pass: some devices restore the compositor/GL context
      // late — a nudge fired only in the first 100ms can land too early.
      setTimeout(() => recoverForegroundView(), 900);
    };
    window.addEventListener('tideAppResume', handleAppResume);

    return () => {
      window.removeEventListener('tideAppResume', handleAppResume);
      cleanupNotificationListeners?.();
      cleanupPushListeners?.();
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
        sendLifecycleBeacon('visible');
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
    sendLifecycleBeacon('boot');
    const timer = setTimeout(() => recoverForegroundView(), 600);
    const lateTimer = setTimeout(() => recoverForegroundView(), 2500);
    return () => {
      clearTimeout(timer);
      clearTimeout(lateTimer);
    };
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
  // Revert on the next frame — with a timer fallback: right after a resume
  // the WebView's rAF can stall for a while, and a nudge that never reverts
  // is a nudge that never re-composites.
  let reverted = false;
  const revert = () => {
    if (reverted) return;
    reverted = true;
    body.style.opacity = prev;
  };
  requestAnimationFrame(revert);
  setTimeout(revert, 80);
}

/** Beacon for remote black-screen diagnosis: tells the server this JS context
 * is alive at boot/resume. Absence of beacons around a black screen means the
 * renderer/JS died (native-side problem); presence means a compositor/paint
 * problem. Fire-and-forget — never let diagnostics break the app. */
function sendLifecycleBeacon(event: string): void {
  if (!isNativeApp()) return;
  try {
    void authFetch(apiUrl('/api/system/client-beacon'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event,
        detail: {
          version: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined,
          visibility: document.visibilityState,
          hasScene: Boolean(getPersistedScene()),
        },
      }),
    }).catch(() => { /* offline/unreachable — irrelevant for diagnostics */ });
  } catch { /* never break the app for a beacon */ }
}

// How long the app must stay backgrounded before the socket is parked.
// Long enough to survive quick app switches, short enough that a phone left
// in a pocket stops processing the firehose within half a minute.
const BACKGROUND_SUSPEND_GRACE_MS = 20_000;

// Vite compile-time constant (baked by the build).
declare const __APP_VERSION__: string;
