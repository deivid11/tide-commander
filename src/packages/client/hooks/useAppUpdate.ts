/**
 * Hook for checking and downloading app updates from GitHub releases
 * Works on Android (via Capacitor) by downloading APK and triggering install intent
 */

import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

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
  isDownloading: boolean;
  downloadProgress: number;
  error: string | null;
  currentVersion: string;
}

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState>({
    isChecking: false,
    updateAvailable: false,
    updateInfo: null,
    recentReleases: [],
    isDownloading: false,
    downloadProgress: 0,
    error: null,
    currentVersion: CURRENT_VERSION,
  });

  const isAndroid = Capacitor.getPlatform() === 'android';

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
   * Check for updates from GitHub releases
   */
  const checkForUpdate = useCallback(async (force = false): Promise<UpdateInfo | null> => {
    setState(s => ({ ...s, isChecking: true, error: null }));

    try {
      // Fetch both latest release and recent releases list in parallel
      const [latestResponse, listResponse] = await Promise.all([
        fetch(GITHUB_RELEASES_URL, {
          headers: { 'Accept': 'application/vnd.github.v3+json' },
        }),
        fetch(GITHUB_RELEASES_LIST_URL, {
          headers: { 'Accept': 'application/vnd.github.v3+json' },
        }),
      ]);

      if (!latestResponse.ok) {
        throw new Error(`GitHub API error: ${latestResponse.status}`);
      }

      const release: GitHubRelease = await latestResponse.json();
      const latestVersion = release.tag_name;

      // Parse recent releases for history
      let recentReleases: ReleaseHistoryItem[] = [];
      if (listResponse.ok) {
        const releases: GitHubRelease[] = await listResponse.json();
        recentReleases = releases.map(r => ({
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
   */
  const downloadAndInstall = useCallback(async () => {
    if (!state.updateInfo?.apkUrl || !isAndroid) {
      // On non-Android, open release page
      if (state.updateInfo?.releaseUrl) {
        window.open(state.updateInfo.releaseUrl, '_blank');
      }
      return;
    }

    setState(s => ({ ...s, isDownloading: true, downloadProgress: 0, error: null }));

    try {
      // Download the APK using fetch with progress tracking
      const response = await fetch(state.updateInfo.apkUrl);

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : state.updateInfo.apkSize || 0;

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to start download');
      }

      const chunks: ArrayBuffer[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Convert Uint8Array to ArrayBuffer for Blob compatibility
        chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
        received += value.length;

        if (total > 0) {
          const progress = Math.round((received / total) * 100);
          setState(s => ({ ...s, downloadProgress: progress }));
        }
      }

      // Combine chunks into a single blob
      const blob = new Blob(chunks, { type: 'application/vnd.android.package-archive' });

      // Create download URL and trigger install
      const url = URL.createObjectURL(blob);
      const filename = `tide-commander-${state.updateInfo.version}.apk`;

      // On Android with Capacitor, we need to use the native file system
      // For now, trigger a download which will prompt the user
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setState(s => ({ ...s, isDownloading: false, downloadProgress: 100 }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Download failed';
      setState(s => ({ ...s, isDownloading: false, error: message }));
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
