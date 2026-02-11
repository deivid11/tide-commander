/**
 * SpotlightInput - Search input component for the Spotlight modal
 * Enhanced with better UX and visual feedback
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
      <span className="spotlight-search-icon">⌘</span>
      <input
        ref={ref}
        type="text"
        className="spotlight-input"
        placeholder="Agent, command, file, task..."
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
          onResetSelection();
        }}
        onKeyDown={onKeyDown}
        autoFocus
        spellCheck={false}
      />
      <div className="spotlight-input-hints">
        <span className="spotlight-shortcut-hint">↑↓</span>
        <span className="spotlight-shortcut-hint">Enter</span>
        <span className="spotlight-shortcut-hint">Esc</span>
      </div>
    </div>
  );
});
