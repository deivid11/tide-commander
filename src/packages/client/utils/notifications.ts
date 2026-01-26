/**
 * Native notification utilities for Android (via Capacitor)
 * Falls back to browser notifications on web
 */

import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

let notificationId = 1;

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
 * Show notification for agent completion
 */
export async function notifyAgentComplete(agentName: string, message?: string): Promise<void> {
  await showNotification({
    title: `${agentName} completed`,
    body: message || 'Task finished successfully',
    data: { type: 'agent_complete', agentName },
  });
}

/**
 * Show notification for agent error
 */
export async function notifyAgentError(agentName: string, error: string): Promise<void> {
  await showNotification({
    title: `${agentName} error`,
    body: error,
    data: { type: 'agent_error', agentName },
  });
}

/**
 * Show notification for permission request
 */
export async function notifyPermissionRequest(agentName: string, tool: string): Promise<void> {
  await showNotification({
    title: `${agentName} needs permission`,
    body: `Requesting access to: ${tool}`,
    data: { type: 'permission_request', agentName, tool },
  });
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
