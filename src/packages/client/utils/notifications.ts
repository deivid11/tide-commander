/**
 * Native notification utilities for Android (via Capacitor)
 * Falls back to browser notifications on web
 *
 * On Android, notifications are configured to:
 * - Use high-priority channel for heads-up display
 * - Show on lock screen
 * - Wake the device when received
 * - Play sound and vibrate
 */

import { store } from '../store';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

// Register custom Capacitor plugin for syncing config to native foreground service
const ServerConfig = registerPlugin<{
  syncConfig(options: { url: string; token: string }): Promise<void>;
}>('ServerConfig');

// Start at 100 to avoid collision with foreground service notification (ID 1)
let notificationId = 100;

// Must match the channel ID created in MainActivity.java
const AGENT_NOTIFICATION_CHANNEL_ID = 'agent_alerts';
const TIDE_NOTIFICATION_TAP_EVENT = 'tide-notification-tap';

function isMobileDevice(): boolean {
  return typeof window !== 'undefined' && window.innerWidth <= 768 && 'ontouchstart' in window;
}

/**
 * Focus an agent and force-open the Guake terminal.
 * Used by all notification click/tap handlers for consistent behavior.
 */
export function openAgentTerminalFromNotification(agentId: string): void {
  if (isMobileDevice()) {
    store.openTerminalOnMobile(agentId);
    // FlatView keeps its agents drawer / inspector open in component-local
    // state that the store can't reach. Without dismissing them here, a
    // notification tap on FlatView would correctly select the agent but
    // leave the drawer covering the chat the user is trying to land on.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tide-close-flat-side-views'));
    }
    return;
  }

  // If the commander view is open, expand this agent there instead of opening the terminal
  if (document.querySelector('.commander-overlay')) {
    store.requestCommanderExpand(agentId);
    return;
  }

  store.selectAgent(agentId);
  // Flat view has its own inline chat column driven by the shared selection,
  // so the fixed-position Guake overlay would just cover it (z-index 200) and
  // hide the chat the user is trying to land on. Skip opening it there.
  if (store.getState().viewMode !== 'flat') {
    store.setTerminalOpen(true);
  }
}

/**
 * Check if we're running in a native Capacitor app
 */
export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Request notification permissions
 * Call this early in your app lifecycle
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (isNativeApp()) {
    try {
      const result = await LocalNotifications.requestPermissions();
      console.log('[Notifications] Permission result:', result.display);
      return result.display === 'granted';
    } catch (err) {
      console.error('[Notifications] Failed to request permissions:', err);
      return false;
    }
  } else {
    // Browser fallback
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
    return false;
  }
}

/**
 * Check if notifications are enabled
 */
export async function areNotificationsEnabled(): Promise<boolean> {
  if (isNativeApp()) {
    try {
      const result = await LocalNotifications.checkPermissions();
      return result.display === 'granted';
    } catch {
      return false;
    }
  } else {
    if ('Notification' in window) {
      return Notification.permission === 'granted';
    }
    return false;
  }
}

/**
 * Show a notification
 * On Android, uses high-priority channel to ensure delivery on lock screen
 */
export async function showNotification(options: {
  title: string;
  body: string;
  icon?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const { title, body, icon, data } = options;

  if (isNativeApp()) {
    try {
      const id = notificationId++;
      console.log('[Notifications] Scheduling native notification id=' + id, title);
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title,
            body,
            extra: data,
            // Android-specific: use high-priority channel
            channelId: AGENT_NOTIFICATION_CHANNEL_ID,
            smallIcon: 'ic_launcher',
            autoCancel: true,
          },
        ],
      });
      console.log('[Notifications] Notification scheduled successfully');
    } catch (err) {
      console.error('[Notifications] Failed to schedule notification:', err);
    }
  } else {
    // Browser fallback
    if ('Notification' in window && Notification.permission === 'granted') {
      const browserNotification = new Notification(title, { body, icon, data });
      browserNotification.onclick = () => {
        window.focus();
        if (data) {
          window.dispatchEvent(new CustomEvent(TIDE_NOTIFICATION_TAP_EVENT, { detail: data }));
        }
      };
    }
  }
}


/**
 * Initialize notification listeners (for handling taps).
 * Returns a cleanup function to remove listeners.
 * Guards against duplicate registration.
 */
let notificationListenersInitialized = false;

export async function initNotificationListeners(
  onTap?: (data: Record<string, unknown>) => void
): Promise<() => void> {
  const cleanups: Array<() => void> = [];

  if (notificationListenersInitialized) {
    return () => {};
  }
  notificationListenersInitialized = true;

  if (onTap) {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<Record<string, unknown>>;
      if (customEvent.detail) {
        onTap(customEvent.detail);
      }
    };
    window.addEventListener(TIDE_NOTIFICATION_TAP_EVENT, handler);
    cleanups.push(() => window.removeEventListener(TIDE_NOTIFICATION_TAP_EVENT, handler));

    // Cold-start race: the native side dispatches the CustomEvent in
    // MainActivity.onResume(), which on a fresh launch can run before this
    // listener has been registered (the JS bundle is still booting). The
    // Android side also stashes the payload on `window.__tidePendingNotificationTap`
    // so we can pick it up here.
    const pending = (window as { __tidePendingNotificationTap?: Record<string, unknown> })
      .__tidePendingNotificationTap;
    if (pending) {
      delete (window as { __tidePendingNotificationTap?: Record<string, unknown> })
        .__tidePendingNotificationTap;
      onTap(pending);
    }
  }

  if (isNativeApp()) {
    try {
      const handle = await LocalNotifications.addListener('localNotificationActionPerformed', (notification: any) => {
        if (onTap && notification.notification.extra) {
          onTap(notification.notification.extra);
        }
      });
      cleanups.push(() => handle.remove());
    } catch (err) {
      console.error('[Notifications] Failed to add tap listener:', err);
    }
  }

  return () => {
    cleanups.forEach((fn) => fn());
    notificationListenersInitialized = false;
  };
}

/**
 * Sync the server connection URL to the native Android foreground service
 * so it can maintain its own WebSocket for background notification delivery.
 * No-op on non-native platforms.
 */
export function syncConnectionToNative(serverUrl: string, authToken: string): void {
  if (!isNativeApp()) return;

  ServerConfig.syncConfig({
    url: serverUrl,
    token: authToken,
  }).catch((err: any) => {
    console.warn('[Notifications] Failed to sync config to native service:', err);
  });
}
