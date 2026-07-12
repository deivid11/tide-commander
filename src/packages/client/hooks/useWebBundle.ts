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
import { App } from '@capacitor/app';
import { AppUpdateNative, type WebBundleNativeState } from '../utils/app-update-plugin';
import { fetchWebBundleInfo, type WebBundleInfo } from '../api/system-update';
import { getApiBaseUrl, getAuthToken } from '../utils/storage';
import { getVersionRelation } from '../../shared/version';

const AUTO_SYNC_KEY = 'web_bundle_auto_sync';
const CHECK_INTERVAL = 60 * 60 * 1000; // hourly, matches the other update checks
const INITIAL_CHECK_DELAY = 8000; // let boot/WS settle before pulling a bundle
// If that first check can't reach the server (WS still connecting, dist not
// built yet, auth blip), retry with backoff instead of waiting a full hour —
// otherwise a phone that opened just before the server was ready sits on the
// old UI for up to CHECK_INTERVAL. Backoff caps once we assume it's genuinely
// offline; the hourly tick and foreground re-check take over from there.
const INITIAL_RETRY_BASE_DELAY = 15_000;
const INITIAL_RETRY_MAX_DELAY = 5 * 60 * 1000;
// Throttle foreground-triggered re-checks so rapid app switches don't hammer
// the endpoint; still far tighter than the hourly poll.
const MIN_RECHECK_MS = 2 * 60 * 1000;

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
  // Timestamp of the last check attempt — throttles foreground re-checks.
  const lastCheckAtRef = useRef(0);

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
    async (triggerAuto: boolean): Promise<boolean> => {
      const state = await refreshState();
      if (!state) return false;
      lastCheckAtRef.current = Date.now();
      setPhase((p) => (p === 'idle' ? 'checking' : p));
      try {
        const info = await fetchWebBundleInfo();
        setServerInfo(info);
        setInfoError(null);
        const active = Boolean(state.bridgePath && state.bridgePath.includes('web-bundles'));
        const relation = getVersionRelation(CURRENT_VERSION, info.version);
        // Loop-breaker: a bundle we already run is NEVER re-pulled, whatever
        // the version fields claim. Without this, a server advertising a
        // version its dist doesn't contain (stale build vs bumped
        // package.json) makes every pull land "still behind" → eternal
        // re-sync. With it, any server bundle is pulled at most once.
        const alreadyRunningServerBundle = active && state.hash === info.hash;
        const needsSync =
          !alreadyRunningServerBundle &&
          (relation === 'behind' || (relation === 'equal' && active && state.hash !== info.hash));
        setUpdateAvailable(needsSync);
        if (needsSync && triggerAuto && autoSyncRef.current) {
          await syncNow(info);
        }
        return true;
      } catch (err) {
        // Typical in dev: the server has no built dist to serve (404).
        // Also fires transiently right after boot before the server/WS are
        // reachable — the caller retries so this doesn't strand the phone on
        // the old UI until the next hourly tick.
        setServerInfo(null);
        setInfoError(err instanceof Error ? err.message : String(err));
        return false;
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
  // then check/auto-sync on a delay + hourly + on every foreground.
  useEffect(() => {
    if (!manageLifecycle || !isAndroid) return;
    AppUpdateNative.confirmWebBundle().catch(() => {
      /* plugin missing on old APKs — nothing to confirm */
    });

    let cancelled = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let appListener: PluginListenerHandle | null = null;

    // Initial check, retried with backoff until the server answers once. A
    // single fixed-delay probe loses the race when boot/WS/dist aren't ready
    // yet, then leaves the phone on the old UI until the hourly tick.
    const scheduleInitial = (delay: number, nextDelay: number) => {
      const timer = setTimeout(async () => {
        timers.delete(timer);
        if (cancelled) return;
        const ok = await checkNow(true);
        if (!ok && !cancelled && !syncingRef.current) {
          scheduleInitial(nextDelay, Math.min(nextDelay * 2, INITIAL_RETRY_MAX_DELAY));
        }
      }, delay);
      timers.add(timer);
    };
    scheduleInitial(INITIAL_CHECK_DELAY, INITIAL_RETRY_BASE_DELAY);

    const interval = setInterval(() => void checkNow(true), CHECK_INTERVAL);

    // Re-check whenever the app returns to the foreground (throttled). Mobile
    // spends most of its life backgrounded — and the JS socket is parked while
    // it is — so without this a release can sit unseen until the hourly tick
    // even though the user just reopened the app expecting the latest UI.
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive || cancelled || syncingRef.current) return;
      if (Date.now() - lastCheckAtRef.current < MIN_RECHECK_MS) return;
      void checkNow(true);
    }).then((h) => {
      if (cancelled) void h.remove();
      else appListener = h;
    });

    return () => {
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      clearInterval(interval);
      if (appListener) void appListener.remove();
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
