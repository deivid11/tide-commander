import { useSyncExternalStore } from 'react';
import type { ShortcutModifiers } from '../store/shortcuts';
import { shortcutValueToString } from '../store/shortcuts';

const STORAGE_KEY = 'tide-plugin-command-shortcuts';
type ShortcutMap = Record<string, string>;
type Listener = () => void;

const listeners = new Set<Listener>();
let revision = 0;

function commandKey(pluginId: string, commandName: string): string {
  const normalized = commandName.trim().toLowerCase();
  return `${pluginId}:${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
}

function readMap(): ShortcutMap {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1]));
  } catch {
    return {};
  }
}

function emit(): void {
  revision++;
  for (const listener of listeners) listener();
}

export function subscribePluginCommandShortcuts(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPluginCommandShortcutsRevision(): number {
  return revision;
}

export function getPluginCommandShortcuts(): ShortcutMap {
  return readMap();
}

export function getPluginCommandShortcut(pluginId: string, commandName: string): string {
  return readMap()[commandKey(pluginId, commandName)] || '';
}

export function setPluginCommandShortcut(
  pluginId: string,
  commandName: string,
  value: { key: string; modifiers: ShortcutModifiers },
): void {
  const map = readMap();
  const key = commandKey(pluginId, commandName);
  const shortcut = shortcutValueToString(value);

  // A global chord can launch only one plugin command. Rebinding it moves the
  // chord from the previous command rather than leaving an invisible conflict.
  if (shortcut) {
    for (const [existingKey, existingShortcut] of Object.entries(map)) {
      if (existingKey !== key && existingShortcut.toLowerCase() === shortcut.toLowerCase()) delete map[existingKey];
    }
    map[key] = shortcut;
  } else {
    delete map[key];
  }

  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* storage may be unavailable */ }
  emit();
}

export function usePluginCommandShortcuts(): ShortcutMap {
  useSyncExternalStore(
    subscribePluginCommandShortcuts,
    getPluginCommandShortcutsRevision,
    getPluginCommandShortcutsRevision,
  );
  return readMap();
}

export function pluginCommandShortcutKey(pluginId: string, commandName: string): string {
  return commandKey(pluginId, commandName);
}
