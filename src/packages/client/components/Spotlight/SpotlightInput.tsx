/**
 * SpotlightInput - Search input component for the Spotlight modal
 */

import React, { forwardRef } from 'react';

interface SpotlightInputProps {
  query: string;
  onQueryChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onResetSelection: () => void;
}

export const SpotlightInput = forwardRef<HTMLInputElement, SpotlightInputProps>(function SpotlightInput(
  { query, onQueryChange, onKeyDown, onResetSelection },
  ref
) {
  return (
    <div className="spotlight-input-wrapper">
      <span className="spotlight-search-icon">🔍</span>
      <input
        ref={ref}
        type="text"
        className="spotlight-input"
        placeholder="Search agents, commands, activity..."
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
          onResetSelection();
        }}
        onKeyDown={onKeyDown}
        autoFocus
      />
      <span className="spotlight-shortcut-hint">Alt+P</span>
    </div>
  );
});
