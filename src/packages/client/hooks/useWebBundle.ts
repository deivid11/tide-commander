/**
 * OTA web-bundle sync (Expo-updates style, Android only).
 *
 * The native AppUpdate plugin can pull the client build the connected server
 * serves (zip of its dist/) and swap the WebView onto it via Capacitor's
 * setServerBasePath — same http://localhost origin, all plugins keep working,
 * no APK install. Safety: the bundle stays "pendingConfirm" until the freshly
 * booted JS calls confirmWebBundle(); a cold start with the flag still set
 * rolls back to the APK's bundled assets (MainActivity), and Capacitor itself
 * ignores a persisted bundle after a new APK binary is installed.
 *
 * One instance (WebBundleSyncBanner) runs with manageLifecycle=true and owns
 * the boot confirm + periodic auto-sync; other consumers (Settings → About)
 * use manageLifecycle=false and just read state / trigger manual actions.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { AppUpdateNative, type WebBundleNativeState } from '../utils/app-update-plugin';
import { fetchWebBundleInfo, type WebBundleInfo } from '../api/system-update';
import { getApiBaseUrl, getAuthToken } from '../utils/storage';
import { getVersionRelation } from '../../shared/version';

const AUTO_SYNC_KEY = 'web_bundle_auto_sync';
const CHECK_INTERVAL = 60 * 60 * 1000; // hourly, matches the other update checks
const INITIAL_CHECK_DELAY = 8000; // let boot/WS settle before pulling a bundle

const CURRENT_VERSION = __APP_VERSION__;

export type WebBundlePhase = 'idle' | 'checking' | 'syncing';

export function useWebBundle({ manageLifecycle = false }: { manageLifecycle?: boolean } = {}) {
  const isAndroid = Capacitor?.getPlatform?.() === 'android' || false;

  // null = still probing; false = web, or an APK that predates the plugin/methods
  const [supported, setSupported] = useState<boolean | null>(isAndroid ? null : false);
  const [bundleState, setBundleState] = useState<WebBundleNativeState | null>(null);
  const [serverInfo, setServerInfo] = useState<WebBundleInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [phase, setPhase] = useState<WebBundlePhase>('idle');
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoSync, setAutoSyncState] = useState(() => localStorage.getItem(AUTO_SYNC_KEY) !== '0');

  const syncingRef = useRef(false);
  const autoSyncRef = useRef(autoSync);
  autoSyncRef.current = autoSync;

  const refreshState = useCallback(async (): Promise<WebBundleNativeState | null> => {
    if (!isAndroid) return null;
    try {
      const state = await AppUpdateNative.getWebBundleState();
      setSupported(true);
      setBundleState(state);
      return state;
    } catch {
      // Plugin missing or method not implemented (older APK)
      setSupported(false);
      return null;
    }
  }, [isAndroid]);

  /** True when the WebView currently serves an OTA bundle instead of APK assets. */
  const otaActive = Boolean(bundleState?.bridgePath && bundleState.bridgePath.includes('web-bundles'));

  const syncNow = useCallback(async (target?: WebBundleInfo) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setPhase('syncing');
    setProgress(0);
    setError(null);
    let listener: PluginListenerHandle | null = null;
    try {
      const info = target ?? (await fetchWebBundleInfo());
      setServerInfo(info);
      listener = await AppUpdateNative.addListener('bundleProgress', (p) => {
        setProgress(p.percent >= 0 ? p.percent : null);
      });
      const token = getAuthToken();
      await AppUpdateNative.applyWebBundle({
        url: `${getApiBaseUrl()}/api/system/web-bundle`,
        hash: info.hash,
        version: info.version,
        headers: token ? { 'X-Auth-Token': token } : {},
      });
      // Applied: the WebView is reloading onto the new bundle and this JS
      // context is about to die — deliberately stay in 'syncing'.
      setProgress(100);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('idle');
      setProgress(null);
      syncingRef.current = false;
    } finally {
      void listener?.remove();
    }
  }, []);

  /**
   * Compare the server's bundle with what we're running; optionally auto-sync.
   * "Behind" by version always syncs; same version re-syncs only when an OTA
   * bundle is active and its hash moved (dev rebuilds) — for bundled APK
   * assets at the same version we assume they match the release.
   */
  const checkNow = useCallback(
    async (triggerAuto: boolean) => {
      const state = await refreshState();
      if (!state) return;
      setPhase((p) => (p === 'idle' ? 'checking' : p));
      try {
        const info = await fetchWebBundleInfo();
        setServerInfo(info);
        setInfoError(null);
        const active = Boolean(state.bridgePath && state.bridgePath.includes('web-bundles'));
        const relation = getVersionRelation(CURRENT_VERSION, info.version);
        const needsSync =
          relation === 'behind' || (relation === 'equal' && active && state.hash !== info.hash);
        setUpdateAvailable(needsSync);
        if (needsSync && triggerAuto && autoSyncRef.current) {
          await syncNow(info);
          return;
        }
      } catch (err) {
        // Typical in dev: the server has no built dist to serve (404)
        setServerInfo(null);
        setInfoError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!syncingRef.current) setPhase('idle');
      }
    },
    [refreshState, syncNow],
  );

  const resetToBundled = useCallback(async () => {
    try {
      // Reloads the WebView onto the APK's bundled assets — context ends here.
      await AppUpdateNative.resetWebBundle();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const setAutoSync = useCallback((enabled: boolean) => {
    localStorage.setItem(AUTO_SYNC_KEY, enabled ? '1' : '0');
    setAutoSyncState(enabled);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // Lifecycle owner: confirm a healthy boot (disarms the native rollback),
  // then check/auto-sync on a delay + hourly.
  useEffect(() => {
    if (!manageLifecycle || !isAndroid) return;
    AppUpdateNative.confirmWebBundle().catch(() => {
      /* plugin missing on old APKs — nothing to confirm */
    });
    const initial = setTimeout(() => void checkNow(true), INITIAL_CHECK_DELAY);
    const interval = setInterval(() => void checkNow(true), CHECK_INTERVAL);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [manageLifecycle, isAndroid, checkNow]);

  return {
    isAndroid,
    supported,
    bundleState,
    otaActive,
    serverInfo,
    infoError,
    updateAvailable,
    phase,
    progress,
    error,
    autoSync,
    checkNow,
    syncNow,
    resetToBundled,
    setAutoSync,
    clearError,
    currentVersion: CURRENT_VERSION,
  };
}

// Declare the global for TypeScript
declare const __APP_VERSION__: string;
