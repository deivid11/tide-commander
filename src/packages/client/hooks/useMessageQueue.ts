import { useCallback, useEffect, useRef, useState } from 'react';

export interface QueuedMessage {
  id: string;
  text: string;
  createdAt: number;
  error?: string | null;
}

export interface UseMessageQueueResult {
  queue: QueuedMessage[];
  enqueue: (text: string) => QueuedMessage | null;
  removeById: (id: string) => void;
  clear: () => void;
  drainOne: () => QueuedMessage | null;
  markError: (id: string, message: string) => void;
  clearError: (id: string) => void;
}

const STORAGE_PREFIX = 'tc-message-queue:';

function storageKey(agentId: string): string {
  return `${STORAGE_PREFIX}${agentId}`;
}

function loadQueue(agentId: string): QueuedMessage[] {
  if (!agentId) return [];
  try {
    const raw = localStorage.getItem(storageKey(agentId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is QueuedMessage =>
      entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.text === 'string' && typeof entry.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

function saveQueue(agentId: string, queue: QueuedMessage[]): void {
  if (!agentId) return;
  try {
    if (queue.length === 0) {
      localStorage.removeItem(storageKey(agentId));
    } else {
      localStorage.setItem(storageKey(agentId), JSON.stringify(queue));
    }
  } catch {
    // localStorage full / disabled — ignore, in-memory state still works
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useMessageQueue(agentId: string | null | undefined): UseMessageQueueResult {
  const safeAgentId = agentId || '';
  const [queue, setQueue] = useState<QueuedMessage[]>(() => loadQueue(safeAgentId));
  // Ref is the mutation source of truth. Do NOT assign queueRef.current = queue
  // on every render — a stale render after persist() would resurrect removed
  // entries (rocket chip reappearing / double-send).
  const queueRef = useRef<QueuedMessage[]>(queue);

  useEffect(() => {
    const loaded = loadQueue(safeAgentId);
    queueRef.current = loaded;
    setQueue(loaded);
  }, [safeAgentId]);

  useEffect(() => {
    if (!safeAgentId) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key !== storageKey(safeAgentId)) return;
      const loaded = loadQueue(safeAgentId);
      queueRef.current = loaded;
      setQueue(loaded);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [safeAgentId]);

  const persist = useCallback((next: QueuedMessage[]) => {
    // Synchronous ref update — critical for same-tick remove + send paths.
    queueRef.current = next;
    setQueue(next);
    saveQueue(safeAgentId, next);
  }, [safeAgentId]);

  const enqueue = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !safeAgentId) return null;
    const entry: QueuedMessage = {
      id: newId(),
      text: trimmed,
      createdAt: Date.now(),
      error: null,
    };
    const next = [...queueRef.current, entry];
    persist(next);
    return entry;
  }, [persist, safeAgentId]);

  const removeById = useCallback((id: string) => {
    const current = queueRef.current;
    const next = current.filter((m) => m.id !== id);
    if (next.length !== current.length) persist(next);
  }, [persist]);

  const clear = useCallback(() => {
    persist([]);
  }, [persist]);

  const drainOne = useCallback((): QueuedMessage | null => {
    const current = queueRef.current;
    if (current.length === 0) return null;
    const [head, ...rest] = current;
    persist(rest);
    return head;
  }, [persist]);

  const markError = useCallback((id: string, message: string) => {
    const current = queueRef.current;
    if (!current.some((m) => m.id === id)) return; // already removed
    const next = current.map((m) => (m.id === id ? { ...m, error: message } : m));
    persist(next);
  }, [persist]);

  const clearError = useCallback((id: string) => {
    const current = queueRef.current;
    const entry = current.find((m) => m.id === id);
    // No-op if missing or already clean — never re-hydrate a removed entry.
    if (!entry?.error) return;
    const next = current.map((m) => (m.id === id ? { ...m, error: null } : m));
    persist(next);
  }, [persist]);

  return { queue, enqueue, removeById, clear, drainOne, markError, clearError };
}
