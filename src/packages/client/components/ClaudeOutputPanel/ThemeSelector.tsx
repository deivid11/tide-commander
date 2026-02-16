/**
 * ThemeSelector - Compact theme switcher for the terminal status bar
 */

import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { themes, getTheme, applyTheme, getSavedTheme, type ThemeId } from '../../utils/themes';

export function ThemeSelector() {
  const { t } = useTranslation(['terminal']);
  const [isOpen, setIsOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() => getSavedTheme());
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Get current theme index
  const currentIndex = themes.findIndex(t => t.id === currentTheme);

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

  // Reset highlighted index when opening dropdown
  useEffect(() => {
    if (isOpen) {
      setHighlightedIndex(currentIndex);
    }
  }, [isOpen, currentIndex]);

  const cycleTheme = (direction: 'next' | 'prev') => {
    const newIndex = direction === 'next'
      ? (currentIndex + 1) % themes.length
      : (currentIndex - 1 + themes.length) % themes.length;
    const newTheme = themes[newIndex];
    const theme = getTheme(newTheme.id);
    applyTheme(theme);
    setCurrentTheme(newTheme.id);
  };

  // Handle keyboard navigation on trigger (when focused but dropdown closed)
  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (isOpen) return; // Let dropdown handler take over

    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      cycleTheme('prev');
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      cycleTheme('next');
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsOpen(true);
    }
  };

  // Handle keyboard navigation in dropdown
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex(prev => (prev + 1) % themes.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex(prev => (prev - 1 + themes.length) % themes.length);
      } else if (e.key === 'Enter' && highlightedIndex >= 0) {
        e.preventDefault();
        handleThemeSelect(themes[highlightedIndex].id);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, highlightedIndex]);

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
        ref={triggerRef}
        className="theme-selector-trigger"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
        title={t('terminal:themeSelector.themeTitle', { name: currentThemeData.name })}
      >
        <span className="theme-selector-icon">🎨</span>
        <span className="theme-selector-name">{currentThemeData.name}</span>
        <span className="theme-selector-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div
          className="theme-selector-dropdown"
          onMouseDown={(e) => e.stopPropagation()} // Prevent terminal close-on-click-outside
          onClick={(e) => e.stopPropagation()}
        >
          <div className="theme-selector-header">{t('terminal:themeSelector.selectTheme')}</div>
          <div className="theme-selector-list">
            {themes.map((theme, index) => (
              <button
                key={theme.id}
                className={`theme-selector-option ${theme.id === currentTheme ? 'active' : ''} ${index === highlightedIndex ? 'highlighted' : ''}`}
                onClick={(e) => {
                  e.stopPropagation(); // Prevent click-outside handler from closing terminal
                  handleThemeSelect(theme.id);
                }}
                onMouseDown={(e) => e.stopPropagation()} // Prevent mousedown tracking
                onMouseEnter={() => setHighlightedIndex(index)}
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
