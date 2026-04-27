/**
 * useWebSocketConnection - Hook for initializing WebSocket connection
 *
 * This hook handles the WebSocket connection and callbacks independently of
 * whether 2D or 3D view is active. This ensures agents are synced on page load
 * regardless of the active view mode.
 */

import { useEffect } from 'react';
import { store } from '../store';
import { connect, setCallbacks } from '../websocket';
import {
  getWsConnected,
  setWsConnected,
} from '../app/sceneLifecycle';
import {
  requestNotificationPermission,
  initNotificationListeners,
  openAgentTerminalFromNotification,
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
      setTimeout(() => connect(), 100);
    };
    window.addEventListener('tideAppResume', handleAppResume);

    return () => {
      window.removeEventListener('tideAppResume', handleAppResume);
      cleanupNotificationListeners?.();
    };
  }, [showToast, showAgentNotification, showWhatsAppMessage]);
}
