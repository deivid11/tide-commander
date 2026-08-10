import { useTranslation } from 'react-i18next';
import type { RecentThreeFile } from './useRecentThreeFiles';

interface ThreeViewerSettingsProps {
  modelColor: string;
  onModelColorChange: (color: string) => void;
  backgroundColor: string;
  onBackgroundColorChange: (color: string) => void;
  lightIntensity: number;
  onLightIntensityChange: (intensity: number) => void;
  modelOpacity: number;
  onModelOpacityChange: (opacity: number) => void;
  showEdges: boolean;
  onShowEdgesChange: (show: boolean) => void;
  preserveModelColors?: boolean;
  onPreserveModelColorsChange?: (preserve: boolean) => void;
  recentFiles?: RecentThreeFile[];
  currentFilePath?: string;
  onRecentFileSelect?: (path: string) => void;
}

export function ThreeViewerSettings({
  modelColor,
  onModelColorChange,
  backgroundColor,
  onBackgroundColorChange,
  lightIntensity,
  onLightIntensityChange,
  modelOpacity,
  onModelOpacityChange,
  showEdges,
  onShowEdgesChange,
  preserveModelColors,
  onPreserveModelColorsChange,
  recentFiles = [],
  currentFilePath,
  onRecentFileSelect,
}: ThreeViewerSettingsProps) {
  const { t } = useTranslation('terminal');

  return (
    <div className="three-viewer-settings" role="group" aria-label={t('fileViewerModal.viewerSettings')}>
      {onPreserveModelColorsChange && (
        <label className="three-viewer-setting three-viewer-setting-toggle">
          <span>{t('fileViewerModal.originalColors')}</span>
          <input
            type="checkbox"
            checked={preserveModelColors}
            onChange={(event) => onPreserveModelColorsChange(event.target.checked)}
          />
        </label>
      )}
      <label className="three-viewer-setting">
        <span>{t('fileViewerModal.modelColor')}</span>
        <input
          type="color"
          value={modelColor}
          disabled={preserveModelColors}
          onChange={(event) => onModelColorChange(event.target.value)}
        />
      </label>
      <label className="three-viewer-setting">
        <span>{t('fileViewerModal.backgroundColor')}</span>
        <input
          type="color"
          value={backgroundColor}
          onChange={(event) => onBackgroundColorChange(event.target.value)}
        />
      </label>
      <label className="three-viewer-setting three-viewer-setting-range">
        <span>{t('fileViewerModal.lightIntensity')}</span>
        <input
          type="range"
          min="0"
          max="200"
          step="5"
          value={lightIntensity}
          onChange={(event) => onLightIntensityChange(Number(event.target.value))}
        />
        <output>{lightIntensity}%</output>
      </label>
      <label className="three-viewer-setting three-viewer-setting-range">
        <span>{t('fileViewerModal.modelOpacity')}</span>
        <input
          type="range"
          min="0"
          max="100"
          step="5"
          value={modelOpacity}
          onChange={(event) => onModelOpacityChange(Number(event.target.value))}
        />
        <output>{modelOpacity}%</output>
      </label>
      <label className="three-viewer-setting three-viewer-setting-toggle">
        <span>{t('fileViewerModal.showEdges')}</span>
        <input
          type="checkbox"
          checked={showEdges}
          onChange={(event) => onShowEdgesChange(event.target.checked)}
        />
      </label>
      {recentFiles.length > 0 && onRecentFileSelect && (
        <div className="three-viewer-recents">
          <span className="three-viewer-recents-title">{t('fileViewerModal.recentFiles')}</span>
          <div className="three-viewer-recents-list">
            {recentFiles.map((file) => (
              <button
                key={file.path}
                type="button"
                className={file.path === currentFilePath ? 'active' : undefined}
                onClick={() => onRecentFileSelect(file.path)}
                title={file.path}
                disabled={file.path === currentFilePath}
              >
                <span>{file.filename}</span>
                <small>{file.kind === 'fcstd' ? 'FreeCAD' : 'STL'}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
