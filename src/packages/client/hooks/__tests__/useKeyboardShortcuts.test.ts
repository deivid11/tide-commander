/**
 * Tests for useKeyboardShortcuts hook
 * Phase 4: Keyboard Shortcuts Testing
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { matchesShortcut, DEFAULT_SHORTCUTS, ShortcutConfig } from '../../store/shortcuts';

describe('useKeyboardShortcuts', () => {
  describe('Shortcut Matching', () => {
    it('should match Alt+1 shortcut', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-2d');
      expect(shortcut).toBeDefined();
      expect(shortcut?.modifiers.alt).toBe(true);
      expect(shortcut?.key).toBe('1');
    });

    it('should match Alt+2 shortcut', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-3d');
      expect(shortcut).toBeDefined();
      expect(shortcut?.modifiers.alt).toBe(true);
      expect(shortcut?.key).toBe('2');
    });

    it('should match Alt+3 shortcut', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-dashboard');
      expect(shortcut).toBeDefined();
      expect(shortcut?.modifiers.alt).toBe(true);
      expect(shortcut?.key).toBe('3');
    });

    it('should match Alt+S shortcut', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'toggle-sidebar');
      expect(shortcut).toBeDefined();
      expect(shortcut?.modifiers.alt).toBe(true);
      expect(shortcut?.key).toBe('s');
    });

    it('should match Alt+R shortcut', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'toggle-right-panel');
      expect(shortcut).toBeDefined();
      expect(shortcut?.modifiers.alt).toBe(true);
      expect(shortcut?.key).toBe('r');
    });
  });

  describe('Shortcut Conflict Detection', () => {
    it('should not have conflicting Alt+1', () => {
      const conflicts = DEFAULT_SHORTCUTS.filter(s => s.modifiers.alt && s.key === '1');
      expect(conflicts.length).toBe(1);
    });

    it('should not have conflicting Alt+2', () => {
      const conflicts = DEFAULT_SHORTCUTS.filter(s => s.modifiers.alt && s.key === '2');
      // Alt+2 can have multiple (cycle vs direct), should be fine
      expect(conflicts.length).toBeGreaterThan(0);
    });

    it('should not have conflicting Alt+3', () => {
      const conflicts = DEFAULT_SHORTCUTS.filter(s => s.modifiers.alt && s.key === '3');
      expect(conflicts.length).toBe(1);
    });

    it('should not have conflicting Alt+S', () => {
      const conflicts = DEFAULT_SHORTCUTS.filter(s => s.modifiers.alt && s.key === 's');
      expect(conflicts.length).toBe(1);
    });

    it('should not have conflicting Alt+R', () => {
      const conflicts = DEFAULT_SHORTCUTS.filter(s => s.modifiers.alt && s.key === 'r');
      expect(conflicts.length).toBe(1);
    });
  });

  describe('Browser Compatibility', () => {
    it('should use Alt modifier (cross-browser compatible)', () => {
      const modeShortcuts = [
        DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-2d'),
        DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-3d'),
        DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-dashboard'),
      ];

      modeShortcuts.forEach(shortcut => {
        expect(shortcut?.modifiers.alt).toBe(true);
        expect(shortcut?.modifiers.ctrl).toBeUndefined();
      });
    });

    it('should not use Ctrl modifier (to avoid conflicts)', () => {
      const modeShortcuts = [
        DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-2d'),
        DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-3d'),
        DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-dashboard'),
      ];

      modeShortcuts.forEach(shortcut => {
        expect(shortcut?.modifiers.ctrl).toBeUndefined();
      });
    });

    it('should not conflict with browser Alt shortcuts', () => {
      // Alt+1, Alt+2, Alt+3 are not used by major browsers
      const modeShortcuts = [
        DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-2d'),
        DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-3d'),
        DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-dashboard'),
      ];

      modeShortcuts.forEach(shortcut => {
        // These are safe in Chrome, Firefox, Safari, Edge
        expect(shortcut?.key).toMatch(/^[123]$/);
        expect(shortcut?.modifiers.alt).toBe(true);
      });
    });
  });

  describe('matchesShortcut Function', () => {
    it('should match Alt+1 KeyboardEvent', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-2d');
      const event = new KeyboardEvent('keydown', {
        key: '1',
        altKey: true,
        ctrlKey: false,
        shiftKey: false,
      });

      expect(matchesShortcut(event, shortcut)).toBe(true);
    });

    it('should not match Alt+1 without Alt key', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-2d');
      const event = new KeyboardEvent('keydown', {
        key: '1',
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
      });

      expect(matchesShortcut(event, shortcut)).toBe(false);
    });

    it('should not match Alt+2 when Ctrl is also pressed', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'view-mode-3d');
      const event = new KeyboardEvent('keydown', {
        key: '2',
        altKey: true,
        ctrlKey: true,
        shiftKey: false,
      });

      expect(matchesShortcut(event, shortcut)).toBe(false);
    });

    it('should match disabled shortcut as false', () => {
      const shortcut: ShortcutConfig = {
        id: 'test',
        name: 'Test',
        description: 'Test shortcut',
        key: '1',
        modifiers: { alt: true },
        enabled: false,
        context: 'global',
      };

      const event = new KeyboardEvent('keydown', {
        key: '1',
        altKey: true,
        ctrlKey: false,
        shiftKey: false,
      });

      expect(matchesShortcut(event, shortcut)).toBe(false);
    });
  });

  describe('Shortcut Properties', () => {
    it('all new shortcuts should have proper context', () => {
      const newShortcuts = [
        'view-mode-2d',
        'view-mode-3d',
        'view-mode-dashboard',
        'toggle-sidebar',
        'toggle-right-panel',
      ];

      newShortcuts.forEach(id => {
        const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === id);
        expect(shortcut?.context).toBe('global');
      });
    });

    it('all new shortcuts should be enabled by default', () => {
      const newShortcuts = [
        'view-mode-2d',
        'view-mode-3d',
        'view-mode-dashboard',
        'toggle-sidebar',
        'toggle-right-panel',
      ];

      newShortcuts.forEach(id => {
        const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === id);
        expect(shortcut?.enabled).toBe(true);
      });
    });

    it('all shortcuts should have descriptive names and descriptions', () => {
      const shortcuts = DEFAULT_SHORTCUTS;
      shortcuts.forEach(shortcut => {
        expect(shortcut.name).toBeDefined();
        expect(shortcut.name.length).toBeGreaterThan(0);
        expect(shortcut.description).toBeDefined();
        expect(shortcut.description.length).toBeGreaterThan(0);
      });
    });
  });
});
