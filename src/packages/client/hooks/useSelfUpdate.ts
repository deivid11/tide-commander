import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchInstallInfo,
  startSelfUpdate,
  waitForServerBack,
  type InstallInfo,
  type SelfUpdateEvent,
} from '../api/system-update';

export type SelfUpdatePhase = 'idle' | 'running' | 'success' | 'failed';

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

  const runUpdate = useCallback(() => {
    setPhase('running');
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
              setPhase('success');
            } else {
              setPhase('failed');
            }
            break;
        }
      },
      (err) => {
        // Stream closed. If we already reached success/failed, don't override.
        if (err) {
          errorRef.current = errorRef.current ?? err.message;
          setError((prev) => prev ?? err.message);
        }
        setPhase((prev) =>
          prev === 'running' ? (errorRef.current ? 'failed' : 'success') : prev,
        );
      },
    );

    abortRef.current = stop;
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setPhase('idle');
    setOutput('');
    setError(null);
    errorRef.current = null;
    setNewVersion(null);
    setAutoRestart(false);
  }, []);

  // After a successful auto-restart, wait for the new server to come back up
  // (poll /api/health) then reload so the UI reconnects and picks up the new
  // frontend.
  useEffect(() => {
    if (phase !== 'success' || !autoRestart) return;
    let cancelled = false;
    void waitForServerBack().then(() => {
      if (!cancelled) window.location.reload();
    });
    return () => {
      cancelled = true;
    };
  }, [phase, autoRestart]);

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
