/**
 * Hook for checking and installing APK app updates (store-less Android).
 *
 * The update check goes through our own server (/api/system/app-update) —
 * phones behind carrier CGNAT hit GitHub's unauthenticated 60 req/hour/IP
 * limit, so the device never talks to api.github.com directly unless the
 * server predates the endpoint (older install) and we must fall back.
 *
 * Installing uses the native AppUpdate plugin when the APK ships it:
 * native download with progress events, then the system package installer.
 * Older APKs without the plugin fall back to opening the APK URL in the
 * system browser (manual download + install).
 */

import { useState, useEffect, useCallback } from 'react';
import { Capacitor, CapacitorHttp, type PluginListenerHandle } from '@capacitor/core';
import { fetchAppUpdateInfo } from '../api/system-update';
import { AppUpdateNative } from '../utils/app-update-plugin';

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

/** Unified shape produced by both the server check and the GitHub fallback. */
interface LatestReleaseData {
  updateInfo: UpdateInfo;
  recentReleases: ReleaseHistoryItem[];
}

export type ApkDownloadPhase = 'idle' | 'downloading' | 'installing';

interface AppUpdateState {
  isChecking: boolean;
  updateAvailable: boolean;
  updateInfo: UpdateInfo | null;
  recentReleases: ReleaseHistoryItem[];
  error: string | null;
  currentVersion: string;
  downloadPhase: ApkDownloadPhase;
  /** 0-100 while downloading natively; null when size is unknown. */
  downloadProgress: number | null;
}

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>({
    isChecking: false,
    updateAvailable: false,
    updateInfo: null,
    recentReleases: [],
    error: null,
    currentVersion: CURRENT_VERSION,
    downloadPhase: 'idle',
    downloadProgress: null,
  });

  const isAndroid = Capacitor?.getPlatform?.() === 'android' || false;
  const nativeInstallAvailable = isAndroid && Capacitor.isPluginAvailable('AppUpdate');

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

  /** Preferred path: our own server checks GitHub (cached, token-capable). */
  const checkViaServer = async (): Promise<LatestReleaseData> => {
    const info = await fetchAppUpdateInfo();
    return {
      updateInfo: {
        version: info.latestVersion,
        name: info.name ?? info.latestVersion,
        changelog: info.changelog ?? '',
        releaseUrl: info.releaseUrl,
        apkUrl: info.apkUrl,
        apkSize: info.apkSize,
        publishedAt: info.publishedAt ?? '',
      },
      recentReleases: info.recentReleases.map(r => ({
        version: r.version,
        name: r.name ?? r.version,
        publishedAt: r.publishedAt,
        releaseUrl: r.releaseUrl,
      })),
    };
  };

  /** Fallback for servers that predate /api/system/app-update. */
  const checkViaGitHub = async (): Promise<LatestReleaseData> => {
    const [latestResult, listResult] = await Promise.all([
      fetchJson<GitHubRelease>(GITHUB_RELEASES_URL),
      fetchJson<GitHubRelease[]>(GITHUB_RELEASES_LIST_URL),
    ]);

    if (latestResult.status !== 200) {
      throw new Error(`GitHub API error: ${latestResult.status}`);
    }

    const release = latestResult.data;
    const apkAsset = release.assets.find(
      asset => asset.name.endsWith('.apk') && asset.content_type === 'application/vnd.android.package-archive'
    );

    let recentReleases: ReleaseHistoryItem[] = [];
    if (listResult.status === 200 && listResult.data) {
      recentReleases = listResult.data.map(r => ({
        version: r.tag_name,
        name: r.name,
        publishedAt: r.published_at,
        releaseUrl: r.html_url,
      }));
    }

    return {
      updateInfo: {
        version: release.tag_name,
        name: release.name,
        changelog: release.body,
        releaseUrl: release.html_url,
        apkUrl: apkAsset?.browser_download_url || null,
        apkSize: apkAsset?.size || null,
        publishedAt: release.published_at,
      },
      recentReleases,
    };
  };

  /**
   * Check for updates (server-first, GitHub fallback)
   */
  const checkForUpdate = useCallback(async (force = false): Promise<UpdateInfo | null> => {
    setState(s => ({ ...s, isChecking: true, error: null }));

    try {
      let data: LatestReleaseData;
      try {
        data = await checkViaServer();
      } catch {
        data = await checkViaGitHub();
      }

      const { updateInfo, recentReleases } = data;
      const latestVersion = updateInfo.version;

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
   * Download and install the APK update (Android only).
   *
   * With the native AppUpdate plugin (new APKs): downloads in-process with
   * progress events, then launches the system package installer — one confirm
   * tap. Without it (old APKs): opens the APK URL so the system browser's
   * download manager takes over (manual flow).
   */
  const downloadAndInstall = useCallback(async () => {
    const info = state.updateInfo;
    if (!info) return;

    if (!isAndroid || !info.apkUrl) {
      // No APK to install here — open the release page instead
      if (info.releaseUrl) {
        window.open(info.releaseUrl, '_blank');
      }
      return;
    }

    if (!nativeInstallAvailable) {
      // Legacy APK without the plugin: hand the URL to the system browser
      try {
        window.open(info.apkUrl, '_system');
        setState(s => ({ ...s, error: null }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to open download';
        setState(s => ({ ...s, error: message }));
      }
      return;
    }

    let listener: PluginListenerHandle | null = null;
    try {
      setState(s => ({ ...s, error: null, downloadPhase: 'downloading', downloadProgress: 0 }));
      listener = await AppUpdateNative.addListener('downloadProgress', (progress) => {
        setState(s =>
          s.downloadPhase === 'downloading'
            ? { ...s, downloadProgress: progress.percent >= 0 ? progress.percent : null }
            : s
        );
      });
      await AppUpdateNative.downloadAndInstall({ url: info.apkUrl });
      // Download done; the system install dialog is now up. If the user
      // completes it the process is replaced — this state only lingers when
      // they cancel, so the UI offers a way back to 'idle' (resetDownload).
      setState(s => ({ ...s, downloadPhase: 'installing', downloadProgress: 100 }));
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      const message = raw.includes('install_permission_denied')
        ? 'Install permission was not granted — allow "install unknown apps" for Tide Commander and retry'
        : raw;
      setState(s => ({ ...s, downloadPhase: 'idle', downloadProgress: null, error: message }));
    } finally {
      void listener?.remove();
    }
  }, [state.updateInfo, isAndroid, nativeInstallAvailable]);

  /** Return the download UI to idle (e.g. the user cancelled the installer). */
  const resetDownload = useCallback(() => {
    setState(s => ({ ...s, downloadPhase: 'idle', downloadProgress: null, error: null }));
  }, []);

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
    nativeInstallAvailable,
    checkForUpdate,
    downloadAndInstall,
    resetDownload,
    dismissUpdate,
    openReleasePage,
  };
}

// Declare the global for TypeScript
declare const __APP_VERSION__: string;
