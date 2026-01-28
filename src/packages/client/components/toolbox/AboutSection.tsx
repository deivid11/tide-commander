import React, { useState } from 'react';
import { useAppUpdate } from '../../hooks/useAppUpdate';
import { themes, getTheme, applyTheme, getSavedTheme, type ThemeId } from '../../utils/themes';

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

export function AboutSection() {
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
        <span className="about-logo-icon">🌊</span>
        <span className="about-logo-text">Tide Commander</span>
      </div>

      <div className="about-version">
        <span className="about-version-label">Version</span>
        <span className="about-version-value">{currentVersion}</span>
      </div>

      {/* Update Section */}
      <div className="about-update">
        {updateAvailable && updateInfo ? (
          <div className="about-update-available">
            <div className="about-update-header">
              <span className="about-update-badge">Update Available</span>
              <span className="about-update-version">{updateInfo.version}</span>
            </div>
            {updateInfo.apkSize && (
              <div className="about-update-size">Size: {formatSize(updateInfo.apkSize)}</div>
            )}
            {error && <div className="about-update-error">{error}</div>}
            <div className="about-update-actions">
              <button className="about-update-btn changelog" onClick={openReleasePage}>
                Changelog
              </button>
              {isAndroid && updateInfo.apkUrl ? (
                <button className="about-update-btn download" onClick={downloadAndInstall}>
                  Download APK
                </button>
              ) : (
                <button className="about-update-btn download" onClick={openReleasePage}>
                  View Release
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="about-update-check">
            <span className="about-update-status">
              {isChecking ? 'Checking for updates...' : 'You are up to date'}
            </span>
            <button
              className="about-update-btn check"
              onClick={() => checkForUpdate(true)}
              disabled={isChecking}
            >
              {isChecking ? '...' : 'Check'}
            </button>
          </div>
        )}

        {/* Recent Releases */}
        {recentReleases.length > 0 && (
          <div className="about-releases">
            <div className="about-releases-title">Recent Releases</div>
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
        Visual multi-agent orchestration for Claude Code
      </div>

      <div className="about-principles">
        <div className="about-principles-title">Core Principles</div>
        <ul className="about-principles-list">
          <li>Visual-first agent management</li>
          <li>Real-time collaboration & delegation</li>
          <li>Spatial organization with areas & buildings</li>
          <li>Transparent agent communication</li>
        </ul>
      </div>

      <div className="about-links">
        <a
          href="https://github.com/deivid11/tide-commander"
          target="_blank"
          rel="noopener noreferrer"
          className="about-link"
        >
          <span className="about-link-icon">📦</span>
          <span>GitHub Repository</span>
        </a>
      </div>

      <div className="about-credits">
        <div className="about-credits-title">Special Thanks</div>
        <div className="about-credit-item">
          <a
            href="https://kenney.nl"
            target="_blank"
            rel="noopener noreferrer"
            className="about-credit-link"
          >
            Kenney.nl
          </a>
          <span className="about-credit-desc">for the agent character models</span>
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
          <span className="about-credit-desc">by Anthropic, the AI backbone</span>
        </div>
      </div>
    </div>
  );
}
