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

export async function fetchInstallInfo(): Promise<InstallInfo> {
  const response = await authFetch(`${getApiBaseUrl()}/api/system/install-info`);
  if (!response.ok) {
    throw new Error(`Failed to fetch install info: ${response.statusText}`);
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
export function startSelfUpdate(
  onEvent: (event: SelfUpdateEvent) => void,
  onClose: (err?: Error) => void,
): () => void {
  const controller = new AbortController();

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
        onClose();
        return;
      }
      onClose(err as Error);
    }
  })();

  return () => controller.abort();
}
