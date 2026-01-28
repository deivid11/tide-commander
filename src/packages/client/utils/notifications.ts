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

import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

let notificationId = 1;

// Must match the channel ID created in MainActivity.java
const AGENT_NOTIFICATION_CHANNEL_ID = 'agent_alerts';

/**
 * Check if we're running in a native Capacitor app
 */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
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
      new Notification(title, { body, icon, data });
    }
  }
}


/**
 * Initialize notification listeners (for handling taps)
 */
export async function initNotificationListeners(
  onTap?: (data: Record<string, unknown>) => void
): Promise<void> {
  if (isNativeApp()) {
    await LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
      if (onTap && notification.notification.extra) {
        onTap(notification.notification.extra);
      }
    });
  }
}
