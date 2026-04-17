/**
 * ThemeSelector - Compact theme switcher for the terminal status bar
 */

import React, { memo, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalPortal } from '../shared/ModalPortal';
import { themes, getTheme, applyTheme, getSavedTheme, type ThemeId } from '../../utils/themes';

export const ThemeSelector = memo(function ThemeSelector() {
  const { t } = useTranslation(['terminal']);
  const [isOpen, setIsOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() => getSavedTheme());
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState<{ left: number; bottom: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Get current theme index
  const currentIndex = themes.findIndex(t => t.id === currentTheme);

  // Compute dropdown position anchored to the trigger, since it is portaled to body
  // to escape ancestor overflow: hidden clipping on the terminal status bar.
  useLayoutEffect(() => {
    if (!isOpen) {
      setDropdownPosition(null);
      return;
    }
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDropdownPosition({
        left: rect.right,
        bottom: window.innerHeight - rect.top + 8,
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideTrigger = containerRef.current?.contains(target);
      const insideDropdown = dropdownRef.current?.contains(target);
      if (!insideTrigger && !insideDropdown) {
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
    // Return focus to trigger so ArrowUp/ArrowDown continue cycling themes.
    triggerRef.current?.focus();
  };

  const currentThemeData = getTheme(currentTheme);

  return (
    <div className="theme-selector" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="theme-selector-trigger"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
        title={t('terminal:themeSelector.themeTitle', { name: currentThemeData.name })}
      >
        <span className="theme-selector-icon">🎨</span>
        <span className="theme-selector-name">{currentThemeData.name}</span>
        <span className="theme-selector-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && dropdownPosition && (
        <ModalPortal>
          <div
            ref={dropdownRef}
            className="theme-selector-dropdown theme-selector-dropdown--portaled"
            style={{
              position: 'fixed',
              left: `${dropdownPosition.left}px`,
              bottom: `${dropdownPosition.bottom}px`,
              transform: 'translateX(-100%)',
            }}
            onMouseDown={(e) => e.stopPropagation()} // Prevent terminal close-on-click-outside
            onClick={(e) => e.stopPropagation()}
          >
            <div className="theme-selector-header">{t('terminal:themeSelector.selectTheme')}</div>
            <div className="theme-selector-list">
              {themes.map((theme, index) => (
                <button
                  key={theme.id}
                  type="button"
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
        </ModalPortal>
      )}
    </div>
  );
});
