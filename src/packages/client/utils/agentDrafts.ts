/**
 * Tracks per-agent "has unsent draft" state so UI outside the composer
 * (e.g. Agent Overview cards) can reflect it in real time.
 *
 * Drafts are authored in TerminalInputArea via useTerminalInput and persisted
 * to localStorage under STORAGE_KEYS.INPUT_TEXT_PREFIX. This module is a thin
 * reactive layer on top of that persistence: it seeds from localStorage at
 * load time and is updated whenever setCommand runs.
 */

import { useSyncExternalStore } from 'react';
import { STORAGE_KEYS } from './storage';

type Listener = () => void;

const draftAgents = new Set<string>();
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function seedFromStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_KEYS.INPUT_TEXT_PREFIX)) continue;
      const agentId = key.slice(STORAGE_KEYS.INPUT_TEXT_PREFIX.length);
      const value = localStorage.getItem(key);
      if (value && value.trim().length > 0) {
        draftAgents.add(agentId);
      }
    }
  } catch {
    // Ignore storage access failures (private mode, quota, etc.)
  }
}

seedFromStorage();

export function setAgentDraft(agentId: string, hasDraft: boolean): void {
  const had = draftAgents.has(agentId);
  if (hasDraft === had) return;
  if (hasDraft) {
    draftAgents.add(agentId);
  } else {
    draftAgents.delete(agentId);
  }
  emit();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHasDraft(agentId: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => (agentId ? draftAgents.has(agentId) : false),
    () => false
  );
}
