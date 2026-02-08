/**
 * Hook for checking and downloading app updates from GitHub releases
 * Works on Android (via Capacitor) by downloading APK and triggering install intent
 *
 * Uses CapacitorHttp for native HTTP requests on mobile to avoid CORS issues
 */

import { useState, useEffect, useCallback } from 'react';

// Conditionally import Capacitor (only available on Android builds)
let Capacitor: any;
let CapacitorHttp: any;

try {
  Capacitor = require('@capacitor/core').Capacitor;
  CapacitorHttp = require('@capacitor/core').CapacitorHttp;
} catch {
  // Capacitor not available (web build)
}

const GITHUB_REPO = 'deivid11/tide-commander';
const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const GITHUB_RELEASES_LIST_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=3`;
const CHECK_INTERVAL = 60 * 60 * 1000; // Check every hour
const STORAGE_KEY = 'app_update_dismissed_version';

// Get current app version from package.json (injected at build time via Vite)
const CURRENT_VERSION = __APP_VERSION__;

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
  assets: Array<{
    name: string;
    size: number;
    browser_download_url: string;
    content_type: string;
  }>;
}

interface UpdateInfo {
  version: string;
  name: string;
  changelog: string;
  releaseUrl: string;
  apkUrl: string | null;
  apkSize: number | null;
  publishedAt: string;
}

interface ReleaseHistoryItem {
  version: string;
  name: string;
  publishedAt: string;
  releaseUrl: string;
}

interface AppUpdateState {
  isChecking: boolean;
  updateAvailable: boolean;
  updateInfo: UpdateInfo | null;
  recentReleases: ReleaseHistoryItem[];
  error: string | null;
  currentVersion: string;
}

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>({
    isChecking: false,
    updateAvailable: false,
    updateInfo: null,
    recentReleases: [],
    error: null,
    currentVersion: CURRENT_VERSION,
  });

  const isAndroid = Capacitor?.getPlatform?.() === 'android' || false;

  /**
   * Parse version string to comparable number
   * Handles formats like "v0.17.2" or "0.17.2"
   */
  const parseVersion = (version: string): number[] => {
    const clean = version.replace(/^v/, '');
    return clean.split('.').map(n => parseInt(n, 10) || 0);
  };

  /**
   * Compare two versions: returns 1 if a > b, -1 if a < b, 0 if equal
   */
  const compareVersions = (a: string, b: string): number => {
    const aParts = parseVersion(a);
    const bParts = parseVersion(b);
    const maxLen = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < maxLen; i++) {
      const aPart = aParts[i] || 0;
      const bPart = bParts[i] || 0;
      if (aPart > bPart) return 1;
      if (aPart < bPart) return -1;
    }
    return 0;
  };

  /**
   * Helper to fetch JSON using native HTTP on mobile (bypasses CORS)
   * Falls back to regular fetch on web
   */
  const fetchJson = async <T>(url: string): Promise<{ data: T; status: number }> => {
    const isNative = Capacitor && CapacitorHttp && Capacitor.isNativePlatform?.() === true;
    if (isNative) {
      // Use native HTTP to bypass CORS restrictions on mobile
      const response = await CapacitorHttp.get({
        url,
        headers: { 'Accept': 'application/vnd.github.v3+json' },
      });
      return { data: response.data as T, status: response.status };
    } else {
      // Use regular fetch on web
      const response = await fetch(url, {
        headers: { 'Accept': 'application/vnd.github.v3+json' },
      });
      if (!response.ok) {
        return { data: null as T, status: response.status };
      }
      return { data: await response.json() as T, status: response.status };
    }
  };

  /**
   * Check for updates from GitHub releases
   */
  const checkForUpdate = useCallback(async (force = false): Promise<UpdateInfo | null> => {
    setState(s => ({ ...s, isChecking: true, error: null }));

    try {
      // Fetch both latest release and recent releases list in parallel
      const [latestResult, listResult] = await Promise.all([
        fetchJson<GitHubRelease>(GITHUB_RELEASES_URL),
        fetchJson<GitHubRelease[]>(GITHUB_RELEASES_LIST_URL),
      ]);

      if (latestResult.status !== 200) {
        throw new Error(`GitHub API error: ${latestResult.status}`);
      }

      const release = latestResult.data;
      const latestVersion = release.tag_name;

      // Parse recent releases for history
      let recentReleases: ReleaseHistoryItem[] = [];
      if (listResult.status === 200 && listResult.data) {
        recentReleases = listResult.data.map(r => ({
          version: r.tag_name,
          name: r.name,
          publishedAt: r.published_at,
          releaseUrl: r.html_url,
        }));
      }

      // Check if this version was dismissed
      const dismissedVersion = localStorage.getItem(STORAGE_KEY);
      if (!force && dismissedVersion === latestVersion) {
        setState(s => ({ ...s, isChecking: false, updateAvailable: false, recentReleases }));
        return null;
      }

      // Compare versions
      const hasUpdate = compareVersions(latestVersion, CURRENT_VERSION) > 0;

      if (!hasUpdate) {
        setState(s => ({ ...s, isChecking: false, updateAvailable: false, recentReleases }));
        return null;
      }

      // Find APK asset
      const apkAsset = release.assets.find(
        asset => asset.name.endsWith('.apk') && asset.content_type === 'application/vnd.android.package-archive'
      );

      const updateInfo: UpdateInfo = {
        version: latestVersion,
        name: release.name,
        changelog: release.body,
        releaseUrl: release.html_url,
        apkUrl: apkAsset?.browser_download_url || null,
        apkSize: apkAsset?.size || null,
        publishedAt: release.published_at,
      };

      setState(s => ({
        ...s,
        isChecking: false,
        updateAvailable: true,
        updateInfo,
        recentReleases,
      }));

      return updateInfo;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check for updates';
      setState(s => ({ ...s, isChecking: false, error: message }));
      return null;
    }
  }, []);

  /**
   * Download and install APK update (Android only)
   *
   * On mobile, we can't use fetch() to download the APK due to CORS restrictions
   * on GitHub's CDN. Instead, we open the URL directly which triggers the native
   * download manager and bypasses CORS entirely.
   */
  const downloadAndInstall = useCallback(async () => {
    if (!state.updateInfo?.apkUrl) {
      // No APK URL available, open release page
      if (state.updateInfo?.releaseUrl) {
        window.open(state.updateInfo.releaseUrl, '_blank');
      }
      return;
    }

    if (!isAndroid) {
      // On non-Android, open release page
      if (state.updateInfo?.releaseUrl) {
        window.open(state.updateInfo.releaseUrl, '_blank');
      }
      return;
    }

    // On Android, open the APK URL directly in the browser
    // This triggers the native download manager which:
    // 1. Bypasses CORS restrictions (not a JavaScript fetch)
    // 2. Shows download progress in system UI
    // 3. Prompts user to install when complete
    // 4. Handles large files better than in-memory blob
    try {
      // Use window.open to open the APK URL
      // The browser will handle the download natively
      window.open(state.updateInfo.apkUrl, '_system');

      // Update state to indicate download was initiated
      // We can't track progress since it's handled by the system
      setState(s => ({ ...s, error: null }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to open download';
      setState(s => ({ ...s, error: message }));
    }
  }, [state.updateInfo, isAndroid]);

  /**
   * Dismiss the update notification for this version
   */
  const dismissUpdate = useCallback(() => {
    if (state.updateInfo) {
      localStorage.setItem(STORAGE_KEY, state.updateInfo.version);
    }
    setState(s => ({ ...s, updateAvailable: false, updateInfo: null }));
  }, [state.updateInfo]);

  /**
   * Open the GitHub releases page
   */
  const openReleasePage = useCallback(() => {
    if (state.updateInfo?.releaseUrl) {
      window.open(state.updateInfo.releaseUrl, '_blank');
    } else {
      window.open(`https://github.com/${GITHUB_REPO}/releases`, '_blank');
    }
  }, [state.updateInfo]);

  // Check for updates on mount and periodically
  useEffect(() => {
    // Only auto-check on Android
    if (!isAndroid) return;

    // Initial check after a short delay
    const initialTimeout = setTimeout(() => {
      checkForUpdate();
    }, 5000);

    // Periodic check
    const interval = setInterval(() => {
      checkForUpdate();
    }, CHECK_INTERVAL);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [isAndroid, checkForUpdate]);

  return {
    ...state,
    isAndroid,
    checkForUpdate,
    downloadAndInstall,
    dismissUpdate,
    openReleasePage,
  };
}

// Declare the global for TypeScript
declare const __APP_VERSION__: string;
