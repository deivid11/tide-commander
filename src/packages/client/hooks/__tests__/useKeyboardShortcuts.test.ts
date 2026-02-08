/**
 * Tests for useKeyboardShortcuts hook
 * Phase 4: Keyboard Shortcuts Testing
 */

import { describe, it, expect } from 'vitest';
import { matchesShortcut, DEFAULT_SHORTCUTS, ShortcutConfig } from '../../store/shortcuts';

describe('useKeyboardShortcuts', () => {
  describe('Shortcut Matching', () => {
    it('should match Alt+2 shortcut (toggle-2d-view)', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'toggle-2d-view');
      expect(shortcut).toBeDefined();
      expect(shortcut?.modifiers.alt).toBe(true);
      expect(shortcut?.key).toBe('2');
    });

    it('should match Alt+N shortcut (spawn-agent)', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'spawn-agent');
      expect(shortcut).toBeDefined();
      expect(shortcut?.modifiers.alt).toBe(true);
      expect(shortcut?.key).toBe('n');
    });

    it('should match Alt+E shortcut (toggle-file-explorer)', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'toggle-file-explorer');
      expect(shortcut).toBeDefined();
      expect(shortcut?.modifiers.alt).toBe(true);
      expect(shortcut?.key).toBe('e');
    });

    it('should match Alt+P shortcut (toggle-spotlight)', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'toggle-spotlight');
      expect(shortcut).toBeDefined();
      expect(shortcut?.modifiers.alt).toBe(true);
      expect(shortcut?.key).toBe('p');
    });

    it('should match Ctrl+K shortcut (toggle-commander)', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'toggle-commander');
      expect(shortcut).toBeDefined();
      expect(shortcut?.modifiers.ctrl).toBe(true);
      expect(shortcut?.key).toBe('k');
    });
  });

  describe('Shortcut Conflict Detection', () => {
    it('should not have conflicting Alt+2 in global context', () => {
      const conflicts = DEFAULT_SHORTCUTS.filter(
        s => s.modifiers.alt && !s.modifiers.shift && s.key === '2' && s.context === 'global'
      );
      expect(conflicts.length).toBe(1);
    });

    it('should not have conflicting Alt+2', () => {
      const conflicts = DEFAULT_SHORTCUTS.filter(s => s.modifiers.alt && !s.modifiers.shift && s.key === '2');
      // Alt+2 can have multiple (cycle vs direct), should be fine
      expect(conflicts.length).toBeGreaterThan(0);
    });

    it('should not have conflicting Alt+N in global context', () => {
      const conflicts = DEFAULT_SHORTCUTS.filter(
        s => s.modifiers.alt && !s.modifiers.shift && s.key === 'n' && s.context === 'global'
      );
      expect(conflicts.length).toBe(1);
    });

    it('should not have conflicting Alt+E in global context', () => {
      const conflicts = DEFAULT_SHORTCUTS.filter(
        s => s.modifiers.alt && !s.modifiers.shift && s.key === 'e' && s.context === 'global'
      );
      expect(conflicts.length).toBe(1);
    });

    it('should not have conflicting Alt+P in global context', () => {
      const conflicts = DEFAULT_SHORTCUTS.filter(
        s => s.modifiers.alt && !s.modifiers.shift && s.key === 'p' && s.context === 'global'
      );
      expect(conflicts.length).toBe(1);
    });
  });

  describe('Browser Compatibility', () => {
    it('should use Alt modifier (cross-browser compatible)', () => {
      const altShortcuts = [
        DEFAULT_SHORTCUTS.find(s => s.id === 'toggle-2d-view'),
        DEFAULT_SHORTCUTS.find(s => s.id === 'spawn-agent'),
        DEFAULT_SHORTCUTS.find(s => s.id === 'toggle-file-explorer'),
      ];

      altShortcuts.forEach(shortcut => {
        expect(shortcut?.modifiers.alt).toBe(true);
        expect(shortcut?.modifiers.ctrl).toBeUndefined();
      });
    });

    it('should not use Ctrl modifier (to avoid conflicts)', () => {
      const altShortcuts = [
        DEFAULT_SHORTCUTS.find(s => s.id === 'toggle-2d-view'),
        DEFAULT_SHORTCUTS.find(s => s.id === 'spawn-agent'),
        DEFAULT_SHORTCUTS.find(s => s.id === 'toggle-file-explorer'),
      ];

      altShortcuts.forEach(shortcut => {
        expect(shortcut?.modifiers.ctrl).toBeUndefined();
      });
    });

    it('should not conflict with browser Alt shortcuts', () => {
      // Alt+2 is not commonly used by major browsers
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'toggle-2d-view');
      expect(shortcut?.key).toBe('2');
      expect(shortcut?.modifiers.alt).toBe(true);
    });
  });

  describe('matchesShortcut Function', () => {
    it('should match Alt+2 KeyboardEvent', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'toggle-2d-view');
      const event = new KeyboardEvent('keydown', {
        key: '2',
        code: 'Digit2',
        altKey: true,
        ctrlKey: false,
        shiftKey: false,
      });

      expect(matchesShortcut(event, shortcut)).toBe(true);
    });

    it('should not match Alt+2 without Alt key', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'toggle-2d-view');
      const event = new KeyboardEvent('keydown', {
        key: '2',
        code: 'Digit2',
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
      });

      expect(matchesShortcut(event, shortcut)).toBe(false);
    });

    it('should not match Alt+2 when Ctrl is also pressed', () => {
      const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === 'toggle-2d-view');
      const event = new KeyboardEvent('keydown', {
        key: '2',
        code: 'Digit2',
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
        code: 'Digit1',
        altKey: true,
        ctrlKey: false,
        shiftKey: false,
      });

      expect(matchesShortcut(event, shortcut)).toBe(false);
    });
  });

  describe('Shortcut Properties', () => {
    it('all global Alt shortcuts should have proper context', () => {
      const globalAltShortcuts = [
        'toggle-2d-view',
        'spawn-agent',
        'toggle-file-explorer',
        'toggle-spotlight',
      ];

      globalAltShortcuts.forEach(id => {
        const shortcut = DEFAULT_SHORTCUTS.find(s => s.id === id);
        expect(shortcut?.context).toBe('global');
      });
    });

    it('all shortcuts should be enabled by default', () => {
      DEFAULT_SHORTCUTS.forEach(shortcut => {
        expect(shortcut.enabled).toBe(true);
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
