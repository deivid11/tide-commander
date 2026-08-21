import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getPluginCommandShortcut,
  getPluginCommandShortcuts,
  pluginCommandShortcutKey,
  setPluginCommandShortcut,
} from './commandShortcuts';

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('plugin command shortcuts', () => {
  it('persists a normalized global chord for a slash command', () => {
    setPluginCommandShortcut('bolba-tasks', '/tasks', { key: 'i', modifiers: { ctrl: true } });
    expect(getPluginCommandShortcut('bolba-tasks', '/tasks')).toBe('ctrl+i');
    expect(getPluginCommandShortcuts()[pluginCommandShortcutKey('bolba-tasks', '/tasks')]).toBe('ctrl+i');
  });

  it('moves a chord when it is rebound to another plugin command', () => {
    setPluginCommandShortcut('one', '/first', { key: 'i', modifiers: { ctrl: true } });
    setPluginCommandShortcut('two', '/second', { key: 'i', modifiers: { ctrl: true } });
    expect(getPluginCommandShortcut('one', '/first')).toBe('');
    expect(getPluginCommandShortcut('two', '/second')).toBe('ctrl+i');
  });

  it('clears a command shortcut', () => {
    setPluginCommandShortcut('bolba-tasks', '/tasks', { key: 'i', modifiers: { ctrl: true } });
    setPluginCommandShortcut('bolba-tasks', '/tasks', { key: '', modifiers: {} });
    expect(getPluginCommandShortcut('bolba-tasks', '/tasks')).toBe('');
  });
});
