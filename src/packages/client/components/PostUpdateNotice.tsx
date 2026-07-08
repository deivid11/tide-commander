import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { POST_UPDATE_VERSION_KEY } from '../hooks/useSelfUpdate';
import { ChangelogModal } from './ChangelogModal';

/**
 * After a self-update reloads the page, show a one-time "✓ Updated to vX —
 * View changelog" strip. The just-installed version is stashed in localStorage
 * before the reload (see useSelfUpdate); we only show it if it matches the
 * running build, then clear it once dismissed / viewed.
 */
export function PostUpdateNotice() {
  const { t } = useTranslation(['config']);
  const [version, setVersion] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem(POST_UPDATE_VERSION_KEY);
      if (stored && stored === __APP_VERSION__) return stored;
      // Stale (didn't actually land on this build) → clear.
      if (stored) localStorage.removeItem(POST_UPDATE_VERSION_KEY);
    } catch {
      /* storage unavailable */
    }
    return null;
  });
  const [showChangelog, setShowChangelog] = useState(false);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(POST_UPDATE_VERSION_KEY);
    } catch {
      /* ignore */
    }
    setVersion(null);
  }, []);

  if (!version) return null;

  return (
    <>
      <div className="update-banner update-banner-updated" role="status">
        <span className="update-banner-msg">
          <span className="update-banner-check">✓</span>
          {t('config:updateBanner.updated', { version })}
        </span>
        <span className="update-banner-actions">
          <button
            className="update-banner-btn primary"
            onClick={() => setShowChangelog(true)}
          >
            {t('config:updateBanner.viewChangelog')}
          </button>
          <button className="update-banner-btn ghost" onClick={clear}>
            {t('config:updateBanner.dismiss')}
          </button>
        </span>
      </div>

      {showChangelog && (
        <ChangelogModal version={version} onClose={() => setShowChangelog(false)} />
      )}
    </>
  );
}
