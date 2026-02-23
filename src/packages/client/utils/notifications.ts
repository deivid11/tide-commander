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

// Conditionally import Capacitor (only available on Android builds)
// Separate try/catch blocks so one failing doesn't block the other
let LocalNotifications: any;
let Capacitor: any;

try {
  Capacitor = require('@capacitor/core').Capacitor;
} catch {
  // Capacitor core not available (web build)
}

try {
  LocalNotifications = require('@capacitor/local-notifications').LocalNotifications;
} catch {
  // Local notifications plugin not available
}

let notificationId = 1;

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
    return;
  }

  store.selectAgent(agentId);
  store.setTerminalOpen(true);
}

/**
 * Check if we're running in a native Capacitor app
 */
export function isNativeApp(): boolean {
  return Capacitor?.isNativePlatform?.() ?? false;
}

/**
 * Request notification permissions
 * Call this early in your app lifecycle
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (isNativeApp()) {
    const result = await LocalNotifications.requestPermissions();
    return result.display === 'granted';
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
    const result = await LocalNotifications.checkPermissions();
    return result.display === 'granted';
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
    await LocalNotifications.schedule({
      notifications: [
        {
          id: notificationId++,
          title,
          body,
          schedule: { at: new Date(Date.now() + 100) }, // Immediate
          extra: data,
          // Android-specific: use high-priority channel
          channelId: AGENT_NOTIFICATION_CHANNEL_ID,
          // Ensure notification is shown even when app is in foreground
          smallIcon: 'ic_launcher',
          // Additional Android settings for lock screen visibility
          autoCancel: true,
        },
      ],
    });
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
 * Initialize notification listeners (for handling taps)
 */
export async function initNotificationListeners(
  onTap?: (data: Record<string, unknown>) => void
): Promise<void> {
  if (onTap) {
    window.addEventListener(TIDE_NOTIFICATION_TAP_EVENT, (event: Event) => {
      const customEvent = event as CustomEvent<Record<string, unknown>>;
      if (customEvent.detail) {
        onTap(customEvent.detail);
      }
    });
  }

  if (isNativeApp() && LocalNotifications) {
    await LocalNotifications.addListener('localNotificationActionPerformed', (notification: any) => {
      if (onTap && notification.notification.extra) {
        onTap(notification.notification.extra);
      }
    });
  }
}

/**
 * Sync the server connection URL to the native Android foreground service
 * so it can maintain its own WebSocket for background notification delivery.
 * No-op on non-native platforms.
 */
export function syncConnectionToNative(serverUrl: string, authToken: string): void {
  if (!isNativeApp() || !Capacitor?.Plugins?.ServerConfig) return;

  Capacitor.Plugins.ServerConfig.syncConfig({
    url: serverUrl,
    token: authToken,
  }).catch(() => {
    // Plugin not available or call failed — non-critical
  });
}
