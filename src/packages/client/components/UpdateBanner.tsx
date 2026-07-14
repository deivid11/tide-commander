import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelfUpdate } from '../hooks/useSelfUpdate';
import { runGitPullUpdate, waitForServerBack } from '../api/system-update';

type GitPullPhase = 'idle' | 'running' | 'success' | 'failed';

// Per-version dismissal — reappears automatically when a newer version ships.
const DISMISS_KEY = 'npm_update_dismissed_version';
const RECHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h
// After this long in running/success we surface a manual escape (reload /
// recheck). A normal install can take ~3 min, so at 1 min this may appear
// mid-install — the actions are non-destructive (the install continues
// server-side), just an escape hatch if it truly hangs.
const STUCK_MS = 60 * 1000;

/**
 * Semi-global, dismissible update banner. When a newer npm version is available
 * for an auto-updatable global install, it offers a conscious "update & restart"
 * action (with an explicit warning that restarting interrupts running agents).
 * The server never restarts on its own — the restart only happens from here (or
 * the Settings → About panel).
 */
export function UpdateBanner() {
  const { t } = useTranslation(['config']);
  const {
    installInfo,
    phase,
    error,
    newVersion,
    refreshInstallInfo,
    runUpdate,
    reset,
  } = useSelfUpdate();
  const [confirming, setConfirming] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(
    () => localStorage.getItem(DISMISS_KEY),
  );
  // Dev-checkout update via server-side `git pull` — separate little state
  // machine from the npm SSE flow (`phase`), which stays 'idle' in dev.
  const [gitPhase, setGitPhase] = useState<GitPullPhase>('idle');
  const [gitError, setGitError] = useState<string | null>(null);
  const [gitConflict, setGitConflict] = useState(false);
  const [gitNewVersion, setGitNewVersion] = useState<string | null>(null);

  useEffect(() => {
    void refreshInstallInfo();
    const id = window.setInterval(() => {
      void refreshInstallInfo();
    }, RECHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refreshInstallInfo]);

  const handleDismiss = useCallback(() => {
    const version = installInfo?.latestVersion ?? null;
    if (version) localStorage.setItem(DISMISS_KEY, version);
    setDismissedVersion(version);
    setConfirming(false);
  }, [installInfo]);

  const handleConfirm = useCallback(() => {
    setConfirming(false);
    runUpdate();
  }, [runUpdate]);

  const handleCloseFailed = useCallback(() => {
    reset();
    setConfirming(false);
    void refreshInstallInfo();
  }, [reset, refreshInstallInfo]);

  // If an update sits in 'running'/'success' too long (no 'done', restart never
  // took over), flag it stuck so we can offer a manual escape.
  useEffect(() => {
    if (phase !== 'running' && phase !== 'success') {
      setStuck(false);
      return;
    }
    const id = window.setTimeout(() => setStuck(true), STUCK_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  // Force recheck: abort the (possibly hung) stream and re-fetch install info.
  // If the update actually applied, the banner hides; otherwise it returns to
  // idle so the user can retry or dismiss.
  const handleRecheck = useCallback(() => {
    reset();
    setConfirming(false);
    setStuck(false);
    void refreshInstallInfo();
  }, [reset, refreshInstallInfo]);

  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  // Run the server-side git pull for dev checkouts. A conflict comes back as a
  // normal { success:false, conflict:true } result — we just show it, never
  // try to resolve anything.
  const handleGitPull = useCallback(async () => {
    setGitPhase('running');
    setGitError(null);
    setGitConflict(false);
    setGitNewVersion(null);
    try {
      const result = await runGitPullUpdate();
      if (result.success) {
        setGitNewVersion(result.newVersion ?? null);
        setGitPhase('success');
        void refreshInstallInfo();
      } else {
        setGitConflict(Boolean(result.conflict));
        setGitError(result.error ?? null);
        setGitPhase('failed');
      }
    } catch (err) {
      // The pull may have restarted the dev server (tsx watch) before the
      // response flushed — check install-info before calling it a failure.
      await waitForServerBack({ initialDelayMs: 1500, timeoutMs: 20000 });
      const info = await refreshInstallInfo();
      if (info && !info.updateAvailable) {
        setGitNewVersion(info.currentVersion);
        setGitPhase('success');
        return;
      }
      setGitError((err as Error).message);
      setGitPhase('failed');
    }
  }, [refreshInstallInfo]);

  const handleGitClose = useCallback(() => {
    setGitPhase('idle');
    setGitError(null);
    setGitConflict(false);
    void refreshInstallInfo();
  }, [refreshInstallInfo]);

  // Auto-updatable = an npm global install: gets the full "update & restart" flow.
  const isAutoUpdatable = Boolean(
    installInfo?.isGlobalInstall && installInfo?.autoUpdateSupported,
  );
  // Show whenever a newer version exists. Dev checkouts / non-npm globals can't
  // self-update, so they get an informational variant (manual command) instead.
  const canShow = Boolean(installInfo?.updateAvailable);
  const dismissed = Boolean(
    installInfo && dismissedVersion === installInfo.latestVersion,
  );

  // Idle: only show for a newer, non-dismissed version. Once an update is
  // running (npm or git pull) we keep the banner up to show progress/outcome
  // regardless of dismissal — a successful pull flips updateAvailable off and
  // would otherwise unmount the banner mid-success-message.
  if (phase === 'idle' && gitPhase === 'idle' && (!canShow || dismissed)) {
    return null;
  }

  const latest = installInfo?.latestVersion ?? newVersion ?? '';
  // Dev checkout: the "git pull" recommendation is an actual action.
  const canGitPull = Boolean(installInfo?.gitPullSupported) && !isAutoUpdatable;
  // In dev (checkout) the server offers no command; fall back to git pull.
  const manualCommand =
    installInfo?.suggestedManualCommand ??
    (installInfo && !installInfo.isGlobalInstall ? 'git pull' : null);
  // git stderr can be long/multi-line — keep the banner readable.
  const compactGitError =
    gitError && gitError.length > 220 ? `${gitError.slice(0, 220)}…` : gitError;

  return (
    <div className="update-banner" role="status">
      {phase === 'idle' && !confirming && isAutoUpdatable && (
        <>
          <span className="update-banner-msg">
            <span className="update-banner-dot" />
            {t('config:updateBanner.newVersion', { version: latest })}
          </span>
          <span className="update-banner-actions">
            <button
              className="update-banner-btn primary"
              onClick={() => setConfirming(true)}
            >
              {t('config:updateBanner.updateBtn')}
            </button>
            <button className="update-banner-btn ghost" onClick={handleDismiss}>
              {t('config:updateBanner.dismiss')}
            </button>
          </span>
        </>
      )}

      {phase === 'idle' && gitPhase === 'idle' && !confirming && !isAutoUpdatable && (
        <>
          <span className="update-banner-msg">
            <span className="update-banner-dot" />
            {t('config:updateBanner.newVersion', { version: latest })}
            {!canGitPull && manualCommand && (
              <>
                <span className="update-banner-manualhint">
                  {t('config:updateBanner.manualHint')}
                </span>
                <code className="update-banner-cmd">{manualCommand}</code>
              </>
            )}
          </span>
          <span className="update-banner-actions">
            {canGitPull && (
              <button
                className="update-banner-btn primary"
                onClick={() => void handleGitPull()}
              >
                {t('config:updateBanner.gitPullBtn')}
              </button>
            )}
            <button className="update-banner-btn ghost" onClick={handleDismiss}>
              {t('config:updateBanner.dismiss')}
            </button>
          </span>
        </>
      )}

      {gitPhase === 'running' && (
        <span className="update-banner-msg">
          <span className="update-banner-spinner" />
          {t('config:updateBanner.gitPulling')}
        </span>
      )}

      {gitPhase === 'success' && (
        <>
          <span className="update-banner-msg">
            <span className="update-banner-dot" />
            {t('config:updateBanner.gitPullSuccess', {
              version: gitNewVersion ?? latest,
            })}
          </span>
          <span className="update-banner-actions">
            <button className="update-banner-btn primary" onClick={handleReload}>
              {t('config:updateBanner.reload')}
            </button>
            <button className="update-banner-btn ghost" onClick={handleGitClose}>
              {t('config:updateBanner.close')}
            </button>
          </span>
        </>
      )}

      {gitPhase === 'failed' && (
        <>
          <span className="update-banner-msg warn">
            {gitConflict
              ? t('config:updateBanner.gitPullConflict')
              : t('config:updateBanner.gitPullFailed')}
            {compactGitError ? `: ${compactGitError}` : ''}
          </span>
          <span className="update-banner-actions">
            <button className="update-banner-btn ghost" onClick={handleGitClose}>
              {t('config:updateBanner.close')}
            </button>
          </span>
        </>
      )}

      {phase === 'idle' && confirming && (
        <>
          <span className="update-banner-msg warn">
            {t('config:updateBanner.confirmWarning')}
          </span>
          <span className="update-banner-actions">
            <button className="update-banner-btn primary" onClick={handleConfirm}>
              {t('config:updateBanner.confirmYes')}
            </button>
            <button
              className="update-banner-btn ghost"
              onClick={() => setConfirming(false)}
            >
              {t('config:updateBanner.confirmCancel')}
            </button>
          </span>
        </>
      )}

      {(phase === 'running' || phase === 'success') && (
        <>
          <span className="update-banner-msg">
            <span className="update-banner-spinner" />
            {phase === 'running'
              ? t('config:updateBanner.installing')
              : t('config:updateBanner.reconnecting')}
          </span>
          {stuck && (
            <span className="update-banner-actions">
              <span className="update-banner-manualhint">
                {t('config:updateBanner.stuckHint')}
              </span>
              <button className="update-banner-btn ghost" onClick={handleReload}>
                {t('config:updateBanner.reload')}
              </button>
              <button className="update-banner-btn ghost" onClick={handleRecheck}>
                {t('config:updateBanner.recheck')}
              </button>
            </span>
          )}
        </>
      )}

      {phase === 'failed' && (
        <>
          <span className="update-banner-msg warn">
            {t('config:updateBanner.failed')}
            {error ? `: ${error}` : ''}
          </span>
          <span className="update-banner-actions">
            <button className="update-banner-btn ghost" onClick={handleCloseFailed}>
              {t('config:updateBanner.close')}
            </button>
          </span>
        </>
      )}
    </div>
  );
}
