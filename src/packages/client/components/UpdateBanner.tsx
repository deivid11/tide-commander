import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSelfUpdate } from '../hooks/useSelfUpdate';

// Per-version dismissal — reappears automatically when a newer version ships.
const DISMISS_KEY = 'npm_update_dismissed_version';
const RECHECK_INTERVAL_MS = 60 * 60 * 1000; // 1h

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
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(
    () => localStorage.getItem(DISMISS_KEY),
  );

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
  // running we keep the banner up to show progress regardless of dismissal.
  if (phase === 'idle' && (!canShow || dismissed)) {
    return null;
  }

  const latest = installInfo?.latestVersion ?? newVersion ?? '';
  // In dev (checkout) the server offers no command; fall back to git pull.
  const manualCommand =
    installInfo?.suggestedManualCommand ??
    (installInfo && !installInfo.isGlobalInstall ? 'git pull' : null);

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

      {phase === 'idle' && !confirming && !isAutoUpdatable && (
        <>
          <span className="update-banner-msg">
            <span className="update-banner-dot" />
            {t('config:updateBanner.newVersion', { version: latest })}
            {manualCommand && (
              <>
                <span className="update-banner-manualhint">
                  {t('config:updateBanner.manualHint')}
                </span>
                <code className="update-banner-cmd">{manualCommand}</code>
              </>
            )}
          </span>
          <span className="update-banner-actions">
            <button className="update-banner-btn ghost" onClick={handleDismiss}>
              {t('config:updateBanner.dismiss')}
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

      {phase === 'running' && (
        <span className="update-banner-msg">
          <span className="update-banner-spinner" />
          {t('config:updateBanner.installing')}
        </span>
      )}

      {phase === 'success' && (
        <span className="update-banner-msg">
          <span className="update-banner-spinner" />
          {t('config:updateBanner.reconnecting')}
        </span>
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
