import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchInstallInfo,
  startSelfUpdate,
  waitForServerBack,
  type InstallInfo,
  type SelfUpdateEvent,
} from '../api/system-update';

export type SelfUpdatePhase = 'idle' | 'running' | 'success' | 'failed';

/** localStorage key: the version we just installed, read after the post-update reload. */
export const POST_UPDATE_VERSION_KEY = 'post_update_version';

// How long to keep asking the server for the real outcome after the SSE stream
// died without a 'done' event. Must ride out the auto-restart window (npm
// finishing + old server shutdown + new server boot).
const VERIFY_TIMEOUT_MS = 120_000;
const VERIFY_POLL_MS = 2_000;

/**
 * Shared engine for the npm global self-update flow. Drives both the
 * Settings → About panel and the global UpdateBanner so they never diverge.
 *
 * The update is ALWAYS user-initiated (call `runUpdate` after your own
 * confirmation UI). On a successful auto-restart it waits for the new server
 * via /api/health and reloads the page so the UI reconnects to the new build.
 */
export function useSelfUpdate() {
  const [installInfo, setInstallInfo] = useState<InstallInfo | null>(null);
  const [phase, setPhase] = useState<SelfUpdatePhase>('idle');
  const [output, setOutput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [autoRestart, setAutoRestart] = useState<boolean>(false);
  const abortRef = useRef<(() => void) | null>(null);
  // Track the latest error synchronously so the stream-close handler doesn't
  // read a stale closure of `error`.
  const errorRef = useRef<string | null>(null);
  // Mirror of `phase` for the async stream callbacks (stale-closure safe).
  const phaseRef = useRef<SelfUpdatePhase>('idle');
  // Bumped on every runUpdate/reset so an in-flight verification loop from a
  // previous attempt knows to bail out.
  const runIdRef = useRef(0);

  const setPhaseTracked = useCallback((next: SelfUpdatePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const refreshInstallInfo = useCallback(async (): Promise<InstallInfo | null> => {
    try {
      const info = await fetchInstallInfo();
      setInstallInfo(info);
      return info;
    } catch {
      setInstallInfo(null);
      return null;
    }
  }, []);

  /**
   * The SSE stream died while the update was still 'running' — the 'done'
   * event never arrived. That does NOT mean the update failed: the restart
   * kills the stream, and sleep/network blips can drop it silently. Instead of
   * guessing, ask the server what actually happened until it can answer:
   * if it now runs the latest version, the update succeeded.
   */
  const verifyOutcomeAfterStreamLoss = useCallback(async (streamError: string | null) => {
    const runId = runIdRef.current;
    const deadline = Date.now() + VERIFY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      if (runIdRef.current !== runId) return; // superseded by reset/re-run
      try {
        const info = await fetchInstallInfo();
        if (runIdRef.current !== runId) return;
        if (!info.updateInProgress) {
          if (!info.updateAvailable) {
            // The server is up and already reports the new version — success,
            // even though we never saw the 'done' frame.
            setNewVersion(info.currentVersion);
            setAutoRestart(true);
            setPhaseTracked('success');
          } else {
            errorRef.current = streamError ?? 'Update stream was lost and the new version is not installed';
            setError(errorRef.current);
            setPhaseTracked('failed');
          }
          return;
        }
        // Install still running server-side — our stream died, the update didn't.
      } catch {
        // Server unreachable (probably restarting) — keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, VERIFY_POLL_MS));
    }

    if (runIdRef.current !== runId) return;
    errorRef.current = streamError ?? 'Could not confirm the update result — check Settings → About';
    setError(errorRef.current);
    setPhaseTracked('failed');
  }, [setPhaseTracked]);

  const runUpdate = useCallback(() => {
    runIdRef.current += 1;
    setPhaseTracked('running');
    setOutput('');
    setError(null);
    errorRef.current = null;
    setNewVersion(null);
    setAutoRestart(false);

    const stop = startSelfUpdate(
      (event: SelfUpdateEvent) => {
        switch (event.type) {
          case 'start':
            setOutput((prev) => prev + `${event.message}\n`);
            break;
          case 'stdout':
          case 'stderr':
            setOutput((prev) => prev + event.chunk);
            break;
          case 'error':
            errorRef.current = event.message;
            setError(event.message);
            if (event.suggestedManualCommand) {
              setOutput((prev) => prev + `\n\nSuggested manual command: ${event.suggestedManualCommand}\n`);
            }
            break;
          case 'done':
            if (event.success) {
              setNewVersion(event.newVersion);
              setAutoRestart(Boolean(event.autoRestart));
              setPhaseTracked('success');
            } else {
              setPhaseTracked('failed');
            }
            break;
        }
      },
      (err) => {
        // Stream closed. If we already reached success/failed via 'done', keep it.
        if (phaseRef.current !== 'running') return;
        if (errorRef.current) {
          // The server explicitly reported an error event before the close.
          setPhaseTracked('failed');
          return;
        }
        // No 'done', no explicit error: the stream was lost (restart, stall,
        // network). Verify the real outcome instead of guessing from silence.
        void verifyOutcomeAfterStreamLoss(err?.message ?? null);
      },
    );

    abortRef.current = stop;
  }, [setPhaseTracked, verifyOutcomeAfterStreamLoss]);

  const reset = useCallback(() => {
    runIdRef.current += 1; // cancels any in-flight verification loop
    // Flip phase BEFORE aborting so the stream-close callback sees non-running
    // and doesn't start a verification for a user-cancelled update.
    setPhaseTracked('idle');
    abortRef.current?.();
    abortRef.current = null;
    setOutput('');
    setError(null);
    errorRef.current = null;
    setNewVersion(null);
    setAutoRestart(false);
  }, [setPhaseTracked]);

  // After a successful auto-restart, wait for the new server to come back up
  // (poll /api/health) then reload so the UI reconnects and picks up the new
  // frontend.
  useEffect(() => {
    if (phase !== 'success' || !autoRestart) return;
    let cancelled = false;
    // Remember what we just installed so a post-reload notice can offer its changelog.
    if (newVersion) {
      try {
        localStorage.setItem(POST_UPDATE_VERSION_KEY, newVersion);
      } catch {
        /* storage unavailable — skip the post-update notice */
      }
    }
    void waitForServerBack().then(() => {
      if (!cancelled) window.location.reload();
    });
    return () => {
      cancelled = true;
    };
  }, [phase, autoRestart, newVersion]);

  return {
    installInfo,
    phase,
    output,
    error,
    newVersion,
    autoRestart,
    refreshInstallInfo,
    runUpdate,
    reset,
  };
}
