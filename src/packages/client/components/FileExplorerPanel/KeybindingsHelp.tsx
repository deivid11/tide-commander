/**
 * KeybindingsHelp - Help overlay for less-style navigation keybindings
 *
 * Displays a comprehensive list of available keybindings for file viewer navigation
 * Toggled with the ? key when file viewer is active
 */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export interface KeybindingsHelpProps {
  onClose: () => void;
}

interface KeyBinding {
  keys: string[];
  description: string;
  category: 'Navigation' | 'Word Motion' | 'Visual Mode' | 'Search' | 'Help';
}

const KEYBINDINGS: KeyBinding[] = [
  // Navigation - Vertical
  { keys: ['j', '↓'], description: 'Move cursor down one line', category: 'Navigation' },
  { keys: ['k', '↑'], description: 'Move cursor up one line', category: 'Navigation' },
  { keys: ['h', '←'], description: 'Move cursor left', category: 'Navigation' },
  { keys: ['l', '→'], description: 'Move cursor right', category: 'Navigation' },
  { keys: ['0'], description: 'Jump to start of line', category: 'Navigation' },
  { keys: ['$'], description: 'Jump to end of line', category: 'Navigation' },
  { keys: ['^'], description: 'First non-whitespace char', category: 'Navigation' },
  { keys: ['d', 'Ctrl+D'], description: 'Half page down', category: 'Navigation' },
  { keys: ['u', 'Ctrl+U'], description: 'Half page up', category: 'Navigation' },
  { keys: ['f', 'Space'], description: 'Full page down', category: 'Navigation' },
  { keys: ['b', 'Page Up'], description: 'Full page up', category: 'Navigation' },
  { keys: ['g', 'Home'], description: 'Jump to top of file', category: 'Navigation' },
  { keys: ['G', 'End'], description: 'Jump to bottom of file', category: 'Navigation' },

  // Word motions
  { keys: ['w'], description: 'Next word start', category: 'Word Motion' },
  { keys: ['e'], description: 'Next word end', category: 'Word Motion' },
  { keys: ['b'], description: 'Previous word start', category: 'Word Motion' },

  // Visual mode
  { keys: ['v'], description: 'Character visual mode', category: 'Visual Mode' },
  { keys: ['V'], description: 'Line visual mode', category: 'Visual Mode' },
  { keys: ['y'], description: 'Yank (copy) selection', category: 'Visual Mode' },
  { keys: ['Escape'], description: 'Exit visual mode', category: 'Visual Mode' },

  // Search
  { keys: ['/'], description: 'Open search bar', category: 'Search' },
  { keys: ['n'], description: 'Next match', category: 'Search' },
  { keys: ['N'], description: 'Previous match', category: 'Search' },

  // Help
  { keys: ['?'], description: 'Toggle this help overlay', category: 'Help' },
  { keys: ['Escape'], description: 'Exit cursor mode (or visual/search)', category: 'Help' },
  { keys: ['Alt+E'], description: 'Close file viewer', category: 'Help' },
  { keys: ['q'], description: 'Close file viewer', category: 'Help' },
];

export const KeybindingsHelp: React.FC<KeybindingsHelpProps> = ({ onClose }) => {
  const { t } = useTranslation(['terminal']);

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      // Close only if clicking the overlay itself, not the content
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    },
    [onClose]
  );

  const categorized = KEYBINDINGS.reduce(
    (acc, binding) => {
      if (!acc[binding.category]) {
        acc[binding.category] = [];
      }
      acc[binding.category].push(binding);
      return acc;
    },
    {} as Record<string, KeyBinding[]>
  );

  return (
    <div className="keybindings-help-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown} tabIndex={0} role="dialog" aria-label={t('terminal:fileExplorer.keybindingsHelp')}>
      <div className="keybindings-help-content">
        <button className="keybindings-help-close" onClick={onClose} aria-label={t('terminal:fileExplorer.closeHelp')} title={t('terminal:fileExplorer.pressEscapeToClose')}>
          ✕
        </button>

        <h2 className="keybindings-help-title">{t('terminal:fileExplorer.keybindingsHelp')}</h2>
        <p className="keybindings-help-subtitle">{t('terminal:fileExplorer.keybindingsSubtitle')}</p>

        <div className="keybindings-help-categories">
          {Object.entries(categorized).map(([category, bindings]) => (
            <div key={category} className="keybindings-help-category">
              <h3 className="keybindings-help-category-title">{category}</h3>
              <div className="keybindings-help-list">
                {bindings.map((binding, idx) => (
                  <div key={idx} className="keybindings-help-item">
                    <div className="keybindings-help-keys">
                      {binding.keys.map((key, keyIdx) => (
                        <kbd key={keyIdx} className="keybindings-help-key">
                          {key}
                        </kbd>
                      ))}
                    </div>
                    <div className="keybindings-help-description">{binding.description}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <p className="keybindings-help-footer">{t('terminal:fileExplorer.keybindingsFooter')}</p>
      </div>
    </div>
  );
};

KeybindingsHelp.displayName = 'KeybindingsHelp';
