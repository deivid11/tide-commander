import { useTranslation } from 'react-i18next';

export type ThreeViewDirection = 'x' | 'y' | 'z' | 'iso';

export function ThreeViewShortcuts({ onView }: { onView: (view: ThreeViewDirection) => void }) {
  const { t } = useTranslation('terminal');
  return (
    <span className="three-view-shortcuts" role="group" aria-label={t('fileViewerModal.standardViews')}>
      {(['x', 'y', 'z'] as const).map((axis) => (
        <button
          key={axis}
          type="button"
          onClick={() => onView(axis)}
          title={t('fileViewerModal.axisViewShortcut', { axis: axis.toUpperCase(), key: axis.toUpperCase() })}
          aria-label={t('fileViewerModal.axisView', { axis: axis.toUpperCase() })}
        >
          {axis.toUpperCase()}
        </button>
      ))}
      <button
        type="button"
        onClick={() => onView('iso')}
        title={t('fileViewerModal.isoViewShortcut')}
        aria-label={t('fileViewerModal.isoView')}
      >
        ISO
      </button>
    </span>
  );
}

export function ThreeAxisLegend() {
  const { t } = useTranslation('terminal');
  return (
    <div className="three-axis-legend" aria-label={t('fileViewerModal.axisLegend')}>
      <span className="axis-x">X</span>
      <span className="axis-y">Y</span>
      <span className="axis-z">Z</span>
    </div>
  );
}
