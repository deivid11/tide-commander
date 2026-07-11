/**
 * Typed wrapper for the native AppUpdate plugin (Android only) — APK
 * self-update + OTA web-bundle sync. Registered once here; both
 * useAppUpdate (APK) and useWebBundle (OTA UI) import from this module.
 * Native source: android/app/src/main/java/com/tidecommander/app/AppUpdatePlugin.java
 */

import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';

export interface AppUpdateProgress {
  percent: number;
  downloadedBytes: number;
  totalBytes: number;
}

export interface WebBundleNativeState {
  /** Path the WebView is ACTUALLY serving from right now ('' / assets = bundled). */
  bridgePath: string;
  path: string | null;
  hash: string | null;
  version: string | null;
  pendingConfirm: boolean;
}

export interface AppUpdateNativePlugin {
  downloadAndInstall(options: { url: string }): Promise<{ installStarted: boolean }>;
  applyWebBundle(options: {
    url: string;
    hash: string;
    version: string;
    headers?: Record<string, string>;
  }): Promise<{ applied: boolean }>;
  confirmWebBundle(): Promise<void>;
  resetWebBundle(): Promise<void>;
  getWebBundleState(): Promise<WebBundleNativeState>;
  addListener(
    eventName: 'downloadProgress' | 'bundleProgress',
    listener: (progress: AppUpdateProgress) => void,
  ): Promise<PluginListenerHandle>;
}

export const AppUpdateNative = registerPlugin<AppUpdateNativePlugin>('AppUpdate');
