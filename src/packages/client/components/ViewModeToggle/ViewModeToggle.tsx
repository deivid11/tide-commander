/**
 * ViewModeToggle - Segmented button group for switching between view modes
 *
 * Displays 2D / 3D / Dashboard as a compact toggle group.
 * Active mode uses yellow accent highlight matching the dark theme aesthetic.
 */

import { memo, useCallback, useRef, useState, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useViewMode } from '../../hooks/useViewMode';
import { VIEW_MODES } from '../../types/viewModes';
import type { ViewMode } from '../../types/viewModes';
import './ViewModeToggle.scss';

interface ViewModeToggleProps {
  className?: string;
}

export const ViewModeToggle = memo(function ViewModeToggle({ className = '' }: ViewModeToggleProps) {
  const { t } = useTranslation(['common']);
  const [viewMode, setViewMode] = useViewMode();
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);

  // Measure active button position for the sliding indicator
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const activeBtn = container.querySelector('.view-mode-toggle__btn--active') as HTMLElement | null;
    if (!activeBtn) return;
    setIndicatorStyle({
      left: activeBtn.offsetLeft,
      width: activeBtn.offsetWidth,
    });
  }, [viewMode]);

  const handleModeChange = useCallback(
    (mode: ViewMode) => {
      if (mode !== viewMode) {
        setViewMode(mode);
      }
    },
    [viewMode, setViewMode]
  );

  return (
    <div className={`view-mode-toggle ${className}`} ref={containerRef}>
      {indicatorStyle && (
        <div
          className="view-mode-toggle__indicator"
          style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
        />
      )}
      {VIEW_MODES.map((mode) => (
        <button
          key={mode}
          className={`view-mode-toggle__btn ${viewMode === mode ? 'view-mode-toggle__btn--active' : ''}`}
          onClick={() => handleModeChange(mode)}
          title={t(`common:viewMode.descriptions.${mode}`)}
        >
          <span className="view-mode-toggle__icon">
            {mode === '2d' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="12" y1="3" x2="12" y2="21" />
              </svg>
            )}
            {mode === '3d' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            )}
            {mode === 'dashboard' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="9" rx="1" />
                <rect x="14" y="3" width="7" height="5" rx="1" />
                <rect x="14" y="12" width="7" height="9" rx="1" />
                <rect x="3" y="16" width="7" height="5" rx="1" />
              </svg>
            )}
          </span>
          <span className="view-mode-toggle__label">{t(`common:viewMode.labels.${mode}`)}</span>
        </button>
      ))}
    </div>
  );
});
