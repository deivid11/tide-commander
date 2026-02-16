/**
 * Drawing Mode Indicator
 * Shows visual feedback when the user is in area drawing mode.
 * Displays instructions and provides a way to exit the mode.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import type { DrawingTool } from '../../shared/types';

interface DrawingModeIndicatorProps {
  activeTool: DrawingTool;
  onExit: () => void;
}

export function DrawingModeIndicator({ activeTool, onExit }: DrawingModeIndicatorProps) {
  const { t } = useTranslation(['notifications', 'terminal']);
  // Only show when in actual drawing mode (rectangle or circle)
  if (!activeTool || activeTool === 'select') return null;

  const toolLabel = activeTool === 'rectangle'
    ? t('notifications:drawing.rectangleTool')
    : t('notifications:drawing.circleTool');
  const toolIcon = activeTool === 'rectangle' ? '▭' : '○';

  return (
    <div className="drawing-mode-indicator">
      <div className="drawing-mode-content">
        <span className="drawing-mode-icon">{toolIcon}</span>
        <div className="drawing-mode-text">
          <span className="drawing-mode-title">{t('terminal:drawingMode.drawingArea')}: {toolLabel}</span>
          <span className="drawing-mode-hint">{t('terminal:drawingMode.clickAndDrag')} • {t('terminal:drawingMode.pressEscape')}</span>
        </div>
      </div>
      <button
        className="drawing-mode-exit"
        onClick={onExit}
        title={t('terminal:drawingMode.exitDrawingMode')}
      >
        ✕
      </button>
    </div>
  );
}
