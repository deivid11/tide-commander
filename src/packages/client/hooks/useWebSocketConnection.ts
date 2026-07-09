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
      setTimeout(() => resumeFromBackground(), 100);
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

// How long the app must stay backgrounded before the socket is parked.
// Long enough to survive quick app switches, short enough that a phone left
// in a pocket stops processing the firehose within half a minute.
const BACKGROUND_SUSPEND_GRACE_MS = 20_000;
