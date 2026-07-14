/**
 * System Update API Client
 * Talks to /api/system/install-info and /api/system/self-update.
 */

import { authFetch, authUrl, getApiBaseUrl } from '../utils/storage';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';

export interface InstallInfo {
  isGlobalInstall: boolean;
  packageManager: PackageManager;
  installRoot: string | null;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  autoUpdateSupported: boolean;
  /** Dev checkout (.git present) — the server can update itself via git pull. */
  gitPullSupported?: boolean;
  writable?: boolean;
  suggestedManualCommand: string | null;
  reason: string;
  updateInProgress: boolean;
}

/**
 * Poll the lightweight /api/health endpoint until the (restarting) server
 * responds again, or the timeout elapses. Used after an auto-restart to reload
 * only once the new server is actually up. Resolves true if it came back.
 */
export async function waitForServerBack(
  { initialDelayMs = 2500, intervalMs = 1500, timeoutMs = 60000 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  await new Promise((r) => setTimeout(r, initialDelayMs));
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${getApiBaseUrl()}/api/health`, { cache: 'no-store' });
      if (res.ok) return true;
    } catch {
      // server still down — keep polling
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Fetch the changelog markdown. Prefers the locally-served bundled CHANGELOG.md
 * (no rate limits, offline, matches the installed version); falls back to the
 * raw file on GitHub's CDN (raw.githubusercontent, NOT the rate-limited API).
 */
export async function fetchChangelog(): Promise<string> {
  try {
    const res = await authFetch(`${getApiBaseUrl()}/api/system/changelog`);
    if (res.ok) return await res.text();
  } catch {
    /* fall through to CDN */
  }
  const cdn = await fetch(
    'https://raw.githubusercontent.com/deivid11/tide-commander/master/CHANGELOG.md',
    { cache: 'no-store' },
  );
  if (!cdn.ok) throw new Error(`Changelog unavailable (${cdn.status})`);
  return await cdn.text();
}

/** APK release metadata served by our own server (see /api/system/app-update). */
export interface AppUpdateInfo {
  latestVersion: string;
  name: string | null;
  changelog: string | null;
  releaseUrl: string;
  apkUrl: string | null;
  apkSize: number | null;
  publishedAt: string | null;
  recentReleases: Array<{
    version: string;
    name: string | null;
    publishedAt: string;
    releaseUrl: string;
  }>;
}

export async function fetchAppUpdateInfo(): Promise<AppUpdateInfo> {
  const response = await authFetch(`${getApiBaseUrl()}/api/system/app-update`);
  if (!response.ok) {
    throw new Error(`Failed to fetch app update info: ${response.status}`);
  }
  return response.json();
}

/** Identity of the web bundle (client dist) this server serves — for OTA UI sync. */
export interface WebBundleInfo {
  version: string;
  hash: string;
  fileCount: number;
  totalBytes: number;
  /**
   * True when the server is a dev checkout that auto-rebuilds its bundle. Lets
   * the client pull a same-version bundle whose hash moved even onto APK assets
   * (see useWebBundle). Absent/false on released installs → conservative pull.
   */
  dev?: boolean;
}

export async function fetchWebBundleInfo(): Promise<WebBundleInfo> {
  const response = await authFetch(`${getApiBaseUrl()}/api/system/web-bundle-info`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error || `Failed to fetch web bundle info: ${response.status}`,
    );
  }
  return response.json();
}

/** Result of the dev-checkout git pull update (see /api/system/git-pull). */
export interface GitPullUpdateResult {
  success: boolean;
  upToDate?: boolean;
  /** True when the pull failed because of a conflict / diverged branch. */
  conflict?: boolean;
  newVersion?: string | null;
  output?: string;
  error?: string;
}

/**
 * Dev checkouts: update by running `git pull --ff-only` server-side. A pull
 * that fails on a conflict resolves normally with { success: false, conflict };
 * only transport/guard errors throw.
 */
export async function runGitPullUpdate(): Promise<GitPullUpdateResult> {
  const response = await authFetch(`${getApiBaseUrl()}/api/system/git-pull`, { method: 'POST' });
  const body = (await response.json().catch(() => ({}))) as GitPullUpdateResult & { error?: string };
  if (!response.ok) {
    throw new Error(body.error || `git pull failed: ${response.status} ${response.statusText}`);
  }
  return body;
}

export async function fetchInstallInfo(): Promise<InstallInfo> {
  const response = await authFetch(`${getApiBaseUrl()}/api/system/install-info`);
  if (!response.ok) {
    throw new Error(`Failed to fetch install info: ${response.statusText}`);
  }
  return response.json();
}

/** Status of the opt-in unattended-update scheduler (see server auto-update-service). */
export interface AutoUpdateStatus {
  enabled: boolean;
  supported: boolean;
  checkIntervalMinutes: number;
  lastCheckAt: string | null;
  lastResult: string | null;
  lastError: string | null;
  pendingRestartVersion: string | null;
  busyAgents: number;
  updateInProgress: boolean;
}

export async function fetchAutoUpdateStatus(): Promise<AutoUpdateStatus> {
  const response = await authFetch(`${getApiBaseUrl()}/api/system/auto-update`);
  if (!response.ok) {
    throw new Error(`Failed to fetch auto-update status: ${response.statusText}`);
  }
  return response.json();
}

export async function setAutoUpdateEnabled(enabled: boolean): Promise<AutoUpdateStatus> {
  const response = await authFetch(`${getApiBaseUrl()}/api/system/auto-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Failed to update auto-update setting: ${response.statusText}`);
  }
  return response.json();
}

export type SelfUpdateEvent =
  | { type: 'start'; message: string }
  | { type: 'stdout'; chunk: string }
  | { type: 'stderr'; chunk: string }
  | {
      type: 'error';
      message: string;
      permissionDenied?: boolean;
      suggestedManualCommand?: string | null;
      exitCode?: number | null;
    }
  | {
      type: 'done';
      success: boolean;
      exitCode: number | null;
      newVersion: string | null;
      requiresRestart: boolean;
      autoRestart?: boolean;
      message?: string;
    };

/**
 * Start a self-update and stream the SSE events from /api/system/self-update.
 *
 * Returns a function that aborts the connection (the server-side install
 * itself can't be cancelled cleanly, but this stops listening).
 */
// Abort the SSE stream if nothing arrives for this long. The server writes a
// keepalive comment every 15s while npm runs, so 45s of silence = the stream
// died without the browser noticing (sleep, network switch, server killed).
// Without this, reader.read() stays pending forever and the UI never leaves
// "Installing update…" even though the install finished.
const STREAM_STALL_MS = 45_000;

export function startSelfUpdate(
  onEvent: (event: SelfUpdateEvent) => void,
  onClose: (err?: Error) => void,
): () => void {
  const controller = new AbortController();
  let lastActivity = Date.now();
  let stalled = false;
  const stallTimer = setInterval(() => {
    if (Date.now() - lastActivity > STREAM_STALL_MS) {
      stalled = true;
      clearInterval(stallTimer);
      controller.abort();
    }
  }, 5_000);

  void (async () => {
    try {
      const response = await fetch(authUrl(`${getApiBaseUrl()}/api/system/self-update`), {
        method: 'POST',
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });

      if (!response.ok || !response.body) {
        const text = await response.text().catch(() => '');
        let parsed: unknown = null;
        try { parsed = JSON.parse(text); } catch { /* not JSON */ }
        const errorMessage =
          (parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string')
            ? (parsed as { error: string }).error
            : `Self-update failed: ${response.status} ${response.statusText}`;
        onEvent({ type: 'error', message: errorMessage });
        onClose(new Error(errorMessage));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        lastActivity = Date.now(); // any bytes count, keepalive comments included
        buffer += decoder.decode(value, { stream: true });

        // SSE frames separated by blank lines (\n\n)
        let sep = buffer.indexOf('\n\n');
        while (sep !== -1) {
          const rawFrame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          const lines = rawFrame.split('\n');
          let event = 'message';
          let data = '';
          for (const line of lines) {
            if (line.startsWith(':')) continue; // comment / keepalive
            if (line.startsWith('event:')) {
              event = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              data += (data ? '\n' : '') + line.slice(5).trim();
            }
          }

          if (data) {
            try {
              const payload = JSON.parse(data);
              onEvent({ type: event as SelfUpdateEvent['type'], ...payload });
            } catch {
              // Ignore malformed frames
            }
          }

          sep = buffer.indexOf('\n\n');
        }
      }

      onClose();
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        onClose(stalled ? new Error('Update stream stalled — no data from the server for 45s') : undefined);
        return;
      }
      onClose(err as Error);
    } finally {
      clearInterval(stallTimer);
    }
  })();

  return () => {
    clearInterval(stallTimer);
    controller.abort();
  };
}
