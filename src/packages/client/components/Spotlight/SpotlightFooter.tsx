/**
 * SpotlightFooter - Footer with keyboard shortcuts for the Spotlight modal
 * Provides visual hints about available keyboard commands
 */

import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

export const SpotlightFooter = memo(function SpotlightFooter() {
  const { t } = useTranslation(['terminal']);

  return (
    <div className="spotlight-footer">
      <div className="spotlight-footer-left">
        <span className="spotlight-footer-hint">
          <kbd>↑</kbd><kbd>↓</kbd> <kbd>Alt+N</kbd><kbd>Alt+P</kbd> {t('terminal:spotlight.navigate')}
        </span>
        <span className="spotlight-footer-hint">
          <kbd>Enter</kbd> {t('terminal:spotlight.select')}
        </span>
      </div>
      <div className="spotlight-footer-right">
        <span className="spotlight-footer-hint">
          <kbd>Esc</kbd> {t('common:buttons.close')}
        </span>
      </div>
    </div>
  );
});
