import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppUpdate } from '../../hooks/useAppUpdate';
import { themes, getTheme, applyTheme, getSavedTheme, type ThemeId } from '../../utils/themes';
import { Icon } from '../Icon';
import { useSelfUpdate } from '../../hooks/useSelfUpdate';

// Theme selector component
export function ThemeSelector() {
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() => getSavedTheme());

  const handleThemeChange = (themeId: ThemeId) => {
    setCurrentTheme(themeId);
    const theme = getTheme(themeId);
    applyTheme(theme);
  };

  return (
    <div className="theme-selector">
      <div className="theme-selector-grid">
        {themes.map((theme) => (
          <button
            key={theme.id}
            className={`theme-option ${currentTheme === theme.id ? 'active' : ''}`}
            onClick={() => handleThemeChange(theme.id)}
            title={theme.description}
          >
            <div className="theme-preview">
              <div
                className="theme-preview-bg"
                style={{ backgroundColor: theme.colors.bgPrimary }}
              >
                <div
                  className="theme-preview-accent"
                  style={{ backgroundColor: theme.colors.accentBlue }}
                />
                <div
                  className="theme-preview-claude"
                  style={{ backgroundColor: theme.colors.accentClaude }}
                />
              </div>
            </div>
            <span className="theme-name">{theme.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function AutoUpdatePanel() {
  const { t } = useTranslation(['config']);
  const {
    installInfo,
    phase,
    output,
    error,
    newVersion,
    autoRestart,
    refreshInstallInfo,
    runUpdate,
    reset,
  } = useSelfUpdate();
  const [confirming, setConfirming] = useState(false);
  const outputRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    void refreshInstallInfo();
  }, [refreshInstallInfo]);

  // Auto-scroll the install log
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleStart = useCallback(() => {
    setConfirming(true);
  }, []);

  const handleCancel = useCallback(() => {
    setConfirming(false);
  }, []);

  const handleConfirm = useCallback(() => {
    setConfirming(false);
    runUpdate();
  }, [runUpdate]);

  const handleClose = useCallback(() => {
    reset();
    setConfirming(false);
    void refreshInstallInfo();
  }, [reset, refreshInstallInfo]);

  // Decide what to render
  if (!installInfo) {
    return null;
  }

  // Dev mode — show a small informational note instead of the button
  if (!installInfo.isGlobalInstall) {
    return (
      <div className="about-autoupdate">
        <div className="about-autoupdate-title">{t('config:about.autoUpdateTitle')}</div>
        <div className="about-autoupdate-devnote">{t('config:about.autoUpdateDevMode')}</div>
      </div>
    );
  }

  // Global install but not npm — show manual command
  if (!installInfo.autoUpdateSupported) {
    return (
      <div className="about-autoupdate">
        <div className="about-autoupdate-title">{t('config:about.autoUpdateTitle')}</div>
        <div className="about-autoupdate-devnote">
          {t('config:about.autoUpdatePackageManagerNotice', { pm: installInfo.packageManager })}
        </div>
        {installInfo.suggestedManualCommand && (
          <>
            <div className="about-autoupdate-manualhint">{t('config:about.autoUpdateManualCommand')}</div>
            <pre className="about-autoupdate-manualcmd">{installInfo.suggestedManualCommand}</pre>
          </>
        )}
      </div>
    );
  }

  // npm global install — full update flow
  if (!installInfo.updateAvailable && phase === 'idle') {
    // Up to date: nothing extra to render here (the existing About update widget handles it)
    return null;
  }

  return (
    <div className="about-autoupdate">
      <div className="about-autoupdate-title">{t('config:about.autoUpdateTitle')}</div>

      {phase === 'idle' && !confirming && installInfo.updateAvailable && (
        <div className="about-autoupdate-row">
          <span className="about-autoupdate-versions">
            <span className="about-autoupdate-current">{installInfo.currentVersion}</span>
            <span className="about-autoupdate-arrow">→</span>
            <span className="about-autoupdate-latest">{installInfo.latestVersion}</span>
          </span>
          <button className="about-update-btn download" onClick={handleStart}>
            {t('config:about.autoUpdateButton')}
          </button>
        </div>
      )}

      {phase === 'idle' && confirming && (
        <div className="about-autoupdate-confirm">
          <div className="about-autoupdate-confirm-title">{t('config:about.autoUpdateConfirmTitle')}</div>
          <div className="about-autoupdate-confirm-body">{t('config:about.autoUpdateConfirmBody')}</div>
          <div className="about-autoupdate-confirm-actions">
            <button className="about-update-btn changelog" onClick={handleCancel}>
              {t('config:about.autoUpdateCancel')}
            </button>
            <button className="about-update-btn download" onClick={handleConfirm}>
              {t('config:about.autoUpdateConfirm')}
            </button>
          </div>
        </div>
      )}

      {(phase === 'running' || phase === 'success' || phase === 'failed') && (
        <div className="about-autoupdate-stream">
          <div className="about-autoupdate-stream-title">
            {phase === 'running' && t('config:about.autoUpdateRunning')}
            {phase === 'success' && t('config:about.autoUpdateSuccess')}
            {phase === 'failed' && t('config:about.autoUpdateFailed')}
          </div>
          <pre ref={outputRef} className="about-autoupdate-output">{output || '...'}</pre>
          {phase === 'success' && (
            <div className="about-autoupdate-success-hint">
              {newVersion && (
                <div className="about-autoupdate-newversion">v{newVersion}</div>
              )}
              <div>
                {autoRestart
                  ? t('config:about.autoUpdateReconnectHint')
                  : t('config:about.autoUpdateRestartHint')}
              </div>
            </div>
          )}
          {phase === 'failed' && error && (
            <div className="about-update-error">{error}</div>
          )}
          {(phase === 'success' || phase === 'failed') && (
            <div className="about-autoupdate-stream-actions">
              <button className="about-update-btn changelog" onClick={handleClose}>
                {t('config:about.autoUpdateClose')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AboutSection() {
  const { t } = useTranslation(['config']);
  const {
    updateAvailable,
    updateInfo,
    recentReleases,
    isChecking,
    error,
    currentVersion,
    isAndroid,
    checkForUpdate,
    downloadAndInstall,
    openReleasePage,
  } = useAppUpdate();

  const formatSize = (bytes: number | null): string => {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="about-section">
      <div className="about-logo">
        <span className="about-logo-icon"><Icon name="waves" size={24} /></span>
        <span className="about-logo-text">Tide Commander</span>
      </div>

      <div className="about-version">
        <span className="about-version-label">{t('config:about.version')}</span>
        <div className="about-version-info">
          <span className="about-version-value">{currentVersion}</span>
          {updateAvailable && updateInfo ? (
            <span
              className="about-version-update-badge"
              onClick={openReleasePage}
              title={`Update available: ${updateInfo.version}`}
            >
              {updateInfo.version}
            </span>
          ) : (
            <a
              href="https://github.com/deivid11/tide-commander/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="about-version-status"
            >
              ({t('config:about.updated')})
            </a>
          )}
        </div>
      </div>

      {/* Self-update from npm global (desktop/CLI). Renders only when relevant. */}
      <AutoUpdatePanel />

      {/* Update Section */}
      <div className="about-update">
        {updateAvailable && updateInfo ? (
          <div className="about-update-available">
            <div className="about-update-header">
              <span className="about-update-badge">{t('config:about.updateAvailable')}</span>
              <span className="about-update-version">{updateInfo.version}</span>
            </div>
            {updateInfo.apkSize && (
              <div className="about-update-size">{t('config:about.sizeLabel')}: {formatSize(updateInfo.apkSize)}</div>
            )}
            {error && <div className="about-update-error">{error}</div>}
            <div className="about-update-actions">
              <button className="about-update-btn changelog" onClick={openReleasePage}>
                {t('config:about.changelog')}
              </button>
              {isAndroid && updateInfo.apkUrl ? (
                <button className="about-update-btn download" onClick={downloadAndInstall}>
                  {t('config:about.downloadAPK')}
                </button>
              ) : (
                <button className="about-update-btn download" onClick={openReleasePage}>
                  {t('config:about.viewRelease')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="about-update-check">
            <span className="about-update-status">
              {isChecking ? t('config:about.checkingUpdates') : t('config:about.upToDate')}
            </span>
            <button
              className="about-update-btn check"
              onClick={() => checkForUpdate(true)}
              disabled={isChecking}
            >
              {isChecking ? '...' : t('config:about.check')}
            </button>
          </div>
        )}

        {/* Recent Releases */}
        {recentReleases.length > 0 && (
          <div className="about-releases">
            <div className="about-releases-title">{t('config:about.recentReleases')}</div>
            <div className="about-releases-list">
              {recentReleases.map((release) => (
                <a
                  key={release.version}
                  href={release.releaseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`about-release-item ${release.version === `v${currentVersion}` || release.version === currentVersion ? 'current' : ''}`}
                >
                  <span className="about-release-version">{release.version}</span>
                  <span className="about-release-date">{formatDate(release.publishedAt)}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="about-description">
        {t('config:about.tagline')}
      </div>

      <div className="about-principles">
        <div className="about-principles-title">{t('config:about.corePrinciples')}</div>
        <ul className="about-principles-list">
          <li>{t('config:about.principle1')}</li>
          <li>{t('config:about.principle2')}</li>
          <li>{t('config:about.principle3')}</li>
          <li>{t('config:about.principle4')}</li>
        </ul>
      </div>

      <div className="about-links">
        <a
          href="https://github.com/deivid11/tide-commander"
          target="_blank"
          rel="noopener noreferrer"
          className="about-link"
        >
          <span className="about-link-icon"><Icon name="package" size={14} /></span>
          <span>{t('config:about.repository')}</span>
        </a>
      </div>

      <div className="about-credits">
        <div className="about-credits-title">{t('config:about.specialThanks')}</div>
        <div className="about-credit-item">
          <a
            href="https://kenney.nl"
            target="_blank"
            rel="noopener noreferrer"
            className="about-credit-link"
          >
            Kenney.nl
          </a>
          <span className="about-credit-desc">{t('config:about.kenneyCredit')}</span>
        </div>
        <div className="about-credit-item">
          <a
            href="https://claude.ai/code"
            target="_blank"
            rel="noopener noreferrer"
            className="about-credit-link"
          >
            Claude Code
          </a>
          <span className="about-credit-desc">{t('config:about.claudeCodeCredit')}</span>
        </div>
      </div>
    </div>
  );
}
