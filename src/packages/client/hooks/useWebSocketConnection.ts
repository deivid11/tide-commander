/**
 * useWebSocketConnection - Hook for initializing WebSocket connection
 *
 * This hook handles the WebSocket connection and callbacks independently of
 * whether 2D or 3D view is active. This ensures agents are synced on page load
 * regardless of the active view mode.
 */

import { useEffect, useRef } from 'react';
import { store } from '../store';
import { connect, setCallbacks } from '../websocket';
import {
  getWsConnected,
  setWsConnected,
} from '../app/sceneLifecycle';
import { requestNotificationPermission, initNotificationListeners } from '../utils/notifications';
import type { ToastType } from '../components/Toast';

interface UseWebSocketConnectionOptions {
  showToast: (type: ToastType, title: string, message: string, duration?: number) => void;
  showAgentNotification: (notification: any) => void;
}

/**
 * Hook for initializing the WebSocket connection and agent syncing.
 * This runs regardless of 2D/3D view mode to ensure agents are loaded on page refresh.
 */
export function useWebSocketConnection({
  showToast,
  showAgentNotification,
}: UseWebSocketConnectionOptions): void {
  const initializedRef = useRef(false);

  useEffect(() => {
    // Only initialize once
    if (initializedRef.current || getWsConnected()) {
      return;
    }
    initializedRef.current = true;

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
    });

    connect();
    setWsConnected(true);

    // Request notification permissions
    requestNotificationPermission();
    initNotificationListeners((data) => {
      if (data.agentId && typeof data.agentId === 'string') {
        store.selectAgent(data.agentId);
      }
    });

    // Handle app resume from background (Android)
    const handleAppResume = () => {
      console.log('[Tide] App resumed from background, reconnecting...');
      setTimeout(() => connect(), 100);
    };
    window.addEventListener('tideAppResume', handleAppResume);

    return () => {
      window.removeEventListener('tideAppResume', handleAppResume);
    };
  }, [showToast, showAgentNotification]);
}
