/**
 * SpotlightInput - Search input component for the Spotlight modal
 * Enhanced with better UX and visual feedback
 */

import React, { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';

interface SpotlightInputProps {
  query: string;
  onQueryChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onResetSelection: () => void;
  commandMode?: boolean;
  executingCommand?: boolean;
}

export const SpotlightInput = forwardRef<HTMLInputElement, SpotlightInputProps>(function SpotlightInput(
  { query, onQueryChange, onKeyDown, onResetSelection, commandMode = false, executingCommand = false },
  ref
) {
  const { t } = useTranslation(['common']);
  return (
    <div className={`spotlight-input-wrapper${commandMode ? ' is-command-mode' : ''}`}>
      <span className="spotlight-search-icon">{commandMode ? '›_' : '⌘'}</span>
      <input
        ref={ref}
        type="text"
        className="spotlight-input"
        placeholder={t('common:search.spotlightPlaceholder')}
        value={query}
        onChange={(e) => {
          onQueryChange(e.target.value);
          onResetSelection();
        }}
        onKeyDown={onKeyDown}
        autoFocus
        spellCheck={false}
        disabled={executingCommand}
        aria-label={commandMode ? 'Plugin command' : undefined}
      />
      <div className="spotlight-input-hints">
        <span className="spotlight-shortcut-hint">↑↓</span>
        <span className="spotlight-shortcut-hint">Enter</span>
        <span className="spotlight-shortcut-hint">Esc</span>
      </div>
    </div>
  );
});
