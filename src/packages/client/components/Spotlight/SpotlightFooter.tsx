/**
 * SpotlightFooter - Footer with keyboard shortcuts for the Spotlight modal
 */

import React, { memo } from 'react';

export const SpotlightFooter = memo(function SpotlightFooter() {
  return (
    <div className="spotlight-footer">
      <span className="spotlight-footer-hint">
        <kbd>↑↓</kbd> or <kbd>Alt</kbd>+<kbd>P/N</kbd> Navigate
      </span>
      <span className="spotlight-footer-hint">
        <kbd>Enter</kbd> Select
      </span>
      <span className="spotlight-footer-hint">
        <kbd>Esc</kbd> Close
      </span>
    </div>
  );
});
