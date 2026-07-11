import { useTranslation } from 'react-i18next';
import { useWebBundle } from '../hooks/useWebBundle';

/**
 * Owns the OTA web-bundle lifecycle (boot confirm + hourly auto-sync) and
 * surfaces it only while something is happening: a brief "Updating UI… N%"
 * strip during a sync (the WebView reloads itself right after), or a
 * dismissible error if a sync failed. Silent the rest of the time — OTA
 * updates are meant to be invisible, unlike the APK banner.
 */
export function WebBundleSyncBanner() {
  const { t } = useTranslation(['config']);
  const { isAndroid, phase, progress, error, clearError } = useWebBundle({ manageLifecycle: true });

  if (!isAndroid) return null;

  if (phase === 'syncing') {
    return (
      <div className="update-banner update-banner-ota" role="status">
        <span className="update-banner-msg">
          <span className="update-banner-spinner" />
          {progress !== null
            ? t('config:webBundle.bannerSyncingPct', { percent: progress })
            : t('config:webBundle.bannerSyncing')}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="update-banner update-banner-ota" role="status">
        <span className="update-banner-msg warn">
          {t('config:webBundle.bannerFailed')}: {error}
        </span>
        <span className="update-banner-actions">
          <button className="update-banner-btn ghost" onClick={clearError}>
            {t('config:webBundle.close')}
          </button>
        </span>
      </div>
    );
  }

  return null;
}
