import { useTranslation } from 'react-i18next';
import { useAppUpdate } from '../hooks/useAppUpdate';

/**
 * Global, dismissible banner for APK app updates (store-less Android).
 * Mounted app-wide so updates surface without opening Settings → About —
 * the counterpart of UpdateBanner, which covers the SERVER's npm self-update
 * and does nothing for the installed APK.
 *
 * With the native AppUpdate plugin the whole flow happens in-app (download
 * with progress → system install dialog). Legacy APKs without the plugin get
 * a "Download" that opens the system browser instead.
 */
export function AppUpdateBanner() {
  const { t } = useTranslation(['config']);
  const {
    isAndroid,
    updateAvailable,
    updateInfo,
    error,
    downloadPhase,
    downloadProgress,
    nativeInstallAvailable,
    downloadAndInstall,
    resetDownload,
    dismissUpdate,
  } = useAppUpdate();

  // APK updates only exist on Android; web/desktop clients update the server.
  if (!isAndroid) return null;
  if (!updateAvailable || !updateInfo) return null;

  return (
    <div className="update-banner update-banner-apk" role="status">
      {downloadPhase === 'idle' && (
        <>
          <span className={`update-banner-msg${error ? ' warn' : ''}`}>
            <span className="update-banner-dot" />
            {error
              ? `${t('config:appUpdateBanner.failed')}: ${error}`
              : t('config:appUpdateBanner.newVersion', { version: updateInfo.version })}
          </span>
          <span className="update-banner-actions">
            <button className="update-banner-btn primary" onClick={() => void downloadAndInstall()}>
              {error
                ? t('config:appUpdateBanner.retry')
                : nativeInstallAvailable
                  ? t('config:appUpdateBanner.update')
                  : t('config:appUpdateBanner.download')}
            </button>
            <button className="update-banner-btn ghost" onClick={dismissUpdate}>
              {t('config:appUpdateBanner.dismiss')}
            </button>
          </span>
        </>
      )}

      {downloadPhase === 'downloading' && (
        <span className="update-banner-msg">
          <span className="update-banner-spinner" />
          {downloadProgress !== null
            ? t('config:appUpdateBanner.downloadingPct', { percent: downloadProgress })
            : t('config:appUpdateBanner.downloading')}
        </span>
      )}

      {downloadPhase === 'installing' && (
        <>
          <span className="update-banner-msg">
            {t('config:appUpdateBanner.installHint')}
          </span>
          <span className="update-banner-actions">
            <button className="update-banner-btn ghost" onClick={resetDownload}>
              {t('config:appUpdateBanner.close')}
            </button>
          </span>
        </>
      )}
    </div>
  );
}
