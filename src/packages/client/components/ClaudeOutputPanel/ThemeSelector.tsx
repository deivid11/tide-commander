/**
 * ThemeSelector - Compact theme switcher for the terminal status bar
 */

import React, { useState, useRef, useEffect } from 'react';
import { themes, getTheme, applyTheme, getSavedTheme, type ThemeId } from '../../utils/themes';

export function ThemeSelector() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() => getSavedTheme());
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on escape
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleThemeSelect = (themeId: ThemeId) => {
    const theme = getTheme(themeId);
    applyTheme(theme);
    setCurrentTheme(themeId);
    setIsOpen(false);
  };

  const currentThemeData = getTheme(currentTheme);

  return (
    <div className="theme-selector" ref={dropdownRef}>
      <button
        className="theme-selector-trigger"
        onClick={() => setIsOpen(!isOpen)}
        title={`Theme: ${currentThemeData.name}`}
      >
        <span className="theme-selector-icon">🎨</span>
        <span className="theme-selector-name">{currentThemeData.name}</span>
        <span className="theme-selector-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="theme-selector-dropdown">
          <div className="theme-selector-header">Select Theme</div>
          <div className="theme-selector-list">
            {themes.map((theme) => (
              <button
                key={theme.id}
                className={`theme-selector-option ${theme.id === currentTheme ? 'active' : ''}`}
                onClick={() => handleThemeSelect(theme.id)}
              >
                <span
                  className="theme-option-preview"
                  style={{
                    background: `linear-gradient(135deg, ${theme.colors.bgPrimary} 0%, ${theme.colors.bgSecondary} 50%, ${theme.colors.accentPurple} 100%)`,
                  }}
                />
                <span className="theme-option-info">
                  <span className="theme-option-name">{theme.name}</span>
                  <span className="theme-option-desc">{theme.description}</span>
                </span>
                {theme.id === currentTheme && <span className="theme-option-check">✓</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
