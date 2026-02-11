/**
 * SpotlightFooter - Footer with keyboard shortcuts for the Spotlight modal
 * Provides visual hints about available keyboard commands
 */

import React, { memo } from 'react';

export const SpotlightFooter = memo(function SpotlightFooter() {
  return (
    <div className="spotlight-footer">
      <div className="spotlight-footer-left">
        <span className="spotlight-footer-hint">
          <kbd>↑</kbd><kbd>↓</kbd> Navigate
        </span>
        <span className="spotlight-footer-hint">
          <kbd>Enter</kbd> Select
        </span>
      </div>
      <div className="spotlight-footer-right">
        <span className="spotlight-footer-hint">
          <kbd>Esc</kbd> Close
        </span>
      </div>
    </div>
  );
});
