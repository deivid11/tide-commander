/**
 * Native push notifications (Firebase Cloud Messaging) for the Android APK.
 *
 * Why this exists: background agent alerts used to require the app to hold its
 * own WebSocket open forever via a foreground service, which pinged every 30s
 * and drained the battery. FCM delivers over the single socket Android already
 * keeps for the whole system, so the app can stay fully asleep. When push is
 * live we tell the native side to stop that foreground service
 * (setPushActive) — see
 * android/app/src/main/java/com/tidecommander/app/ServerConfigPlugin.java.
 *
 * Everything degrades quietly: no service account on the server, no Firebase
 * config in the APK, or a denied OS permission all leave the old WebSocket
 * path untouched.
 */

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import type { PluginListenerHandle } from '@capacitor/core';
import { apiUrl, authFetch } from './storage';
import { isNativeApp, openAgentTerminalFromNotification, ServerConfig } from './notifications';

declare const __APP_VERSION__: string;

/** Stable per-install id so token rotation replaces the row instead of piling up. */
const DEVICE_ID_KEY = 'tide-commander-push-device-id';

export interface PushStatusResponse {
  configured: boolean;
  projectId?: string;
  devices?: Array<{ deviceName?: string; tokenPreview: string; lastSuccessAt?: number }>;
  lastError?: string;
  lastSentAt?: number;
}

let initialized = false;
let currentToken: string | null = null;

function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const generated = `dev-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_ID_KEY, generated);
    return generated;
  } catch {
    // Private mode / storage disabled: a per-session id still beats none.
    return `dev-${Math.random().toString(36).slice(2)}`;
  }
}

function getDeviceName(): string {
  const platform = Capacitor.getPlatform();
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const model = ua.match(/;\s*([^;)]+)\s+Build\//)?.[1];
  return model ? `${model} (${platform})` : platform;
}

/** Ask the server whether pushing is even possible before touching the OS APIs. */
export async function fetchPushStatus(): Promise<PushStatusResponse | null> {
  try {
    const response = await authFetch(apiUrl('/api/push/status'));
    if (!response.ok) return null;
    return (await response.json()) as PushStatusResponse;
  } catch {
    return null;
  }
}

async function registerTokenWithServer(token: string): Promise<boolean> {
  try {
    const response = await authFetch(apiUrl('/api/push/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        platform: Capacitor.getPlatform(),
        deviceId: getDeviceId(),
        deviceName: getDeviceName(),
        appVersion: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : undefined,
      }),
    });
    return response.ok;
  } catch (err) {
    console.warn('[Push] Failed to register token with server:', err);
    return false;
  }
}

/**
 * Hand the battery-draining foreground service its retirement notice — or
 * bring it back if push stopped working. Old APKs don't expose the method;
 * they simply keep the WebSocket path.
 */
async function setNativePushActive(active: boolean): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await ServerConfig.setPushActive({ active });
  } catch {
    // Method missing on an older APK — nothing to do.
  }
}

/**
 * Initialize FCM: permission → token → server registration → tap handling.
 * Safe to call on every platform; returns a cleanup for the listeners.
 */
export async function initPushNotifications(): Promise<(() => void) | undefined> {
  if (!isNativeApp() || initialized) return undefined;

  const status = await fetchPushStatus();
  if (!status?.configured) {
    // Server has no Firebase credentials: stay on the WebSocket service.
    await setNativePushActive(false);
    return undefined;
  }

  initialized = true;
  const handles: PluginListenerHandle[] = [];

  try {
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions();
    }
    if (permission.receive !== 'granted') {
      console.warn('[Push] Notification permission denied — keeping WebSocket fallback');
      initialized = false;
      await setNativePushActive(false);
      return undefined;
    }

    handles.push(
      await PushNotifications.addListener('registration', (token) => {
        currentToken = token.value;
        void registerTokenWithServer(token.value).then((ok) => {
          // Only stand the foreground service down once the server actually
          // holds a token for us — otherwise we'd trade battery for silence.
          void setNativePushActive(ok);
          if (!ok) console.warn('[Push] Server rejected the token — WebSocket fallback stays on');
        });
      })
    );

    handles.push(
      await PushNotifications.addListener('registrationError', (err) => {
        console.warn('[Push] Registration error:', err);
        initialized = false;
        void setNativePushActive(false);
      })
    );

    // Tap on a system notification → open that agent's chat. Mirrors the
    // intent-extra path used by the foreground service (MainActivity).
    handles.push(
      await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        const agentId = action.notification?.data?.agentId;
        if (typeof agentId === 'string' && agentId) {
          openAgentTerminalFromNotification(agentId);
        }
      })
    );

    // Foreground deliveries are intentionally ignored: the app's own WebSocket
    // is live in that case and already renders the in-app toast, so acting
    // here would double every alert.

    await PushNotifications.register();
  } catch (err) {
    console.error('[Push] Initialization failed:', err);
    initialized = false;
    await setNativePushActive(false);
  }

  return () => {
    handles.forEach((handle) => void handle.remove());
    initialized = false;
  };
}

/** Drop this device from the server registry (used when disabling push). */
export async function unregisterPushToken(): Promise<void> {
  if (!currentToken) return;
  try {
    await authFetch(apiUrl('/api/push/unregister'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentToken }),
    });
  } catch {
    // Best effort — the server prunes dead tokens on its own.
  }
  currentToken = null;
  await setNativePushActive(false);
}

export async function sendTestPush(): Promise<{ sent: number; failed: number } | null> {
  try {
    const response = await authFetch(apiUrl('/api/push/test'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (!response.ok) return null;
    return (await response.json()) as { sent: number; failed: number };
  } catch {
    return null;
  }
}
