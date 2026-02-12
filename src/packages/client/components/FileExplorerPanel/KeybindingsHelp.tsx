/**
 * KeybindingsHelp - Help overlay for less-style navigation keybindings
 *
 * Displays a comprehensive list of available keybindings for file viewer navigation
 * Toggled with the ? key when file viewer is active
 */

import React, { useCallback } from 'react';

export interface KeybindingsHelpProps {
  onClose: () => void;
}

interface KeyBinding {
  keys: string[];
  description: string;
  category: 'Navigation' | 'Search' | 'Help';
}

const KEYBINDINGS: KeyBinding[] = [
  // Navigation - Vertical
  { keys: ['j', '↓'], description: 'Scroll down one line', category: 'Navigation' },
  { keys: ['k', '↑'], description: 'Scroll up one line', category: 'Navigation' },
  { keys: ['d', 'Ctrl+D'], description: 'Scroll down half page', category: 'Navigation' },
  { keys: ['u', 'Ctrl+U'], description: 'Scroll up half page', category: 'Navigation' },
  { keys: ['f', 'Space', 'Page Down'], description: 'Scroll down full page', category: 'Navigation' },
  { keys: ['b', 'Page Up'], description: 'Scroll up full page', category: 'Navigation' },
  { keys: ['g', 'Home'], description: 'Jump to top of file', category: 'Navigation' },
  { keys: ['G', 'End'], description: 'Jump to bottom of file', category: 'Navigation' },

  // Navigation - Horizontal
  { keys: ['h', '←'], description: 'Scroll left (wide code)', category: 'Navigation' },
  { keys: ['l', '→'], description: 'Scroll right (wide code)', category: 'Navigation' },

  // Search
  { keys: ['/'], description: 'Open search bar', category: 'Search' },
  { keys: ['n'], description: 'Next match', category: 'Search' },
  { keys: ['N', 'Shift+N'], description: 'Previous match', category: 'Search' },
  { keys: ['Escape'], description: 'Close search bar', category: 'Search' },

  // Help
  { keys: ['?'], description: 'Toggle this help overlay', category: 'Help' },
  { keys: ['q'], description: 'Close file viewer', category: 'Help' },
];

export const KeybindingsHelp: React.FC<KeybindingsHelpProps> = ({ onClose }) => {
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
    <div className="keybindings-help-overlay" onClick={handleOverlayClick} onKeyDown={handleKeyDown} tabIndex={0} role="dialog" aria-label="Keybindings help">
      <div className="keybindings-help-content">
        <button className="keybindings-help-close" onClick={onClose} aria-label="Close help" title="Press Escape to close">
          ✕
        </button>

        <h2 className="keybindings-help-title">Keybindings Help</h2>
        <p className="keybindings-help-subtitle">Less-style navigation for file viewer</p>

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

        <p className="keybindings-help-footer">Press ? or Escape to close this help overlay</p>
      </div>
    </div>
  );
};

KeybindingsHelp.displayName = 'KeybindingsHelp';
