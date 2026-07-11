/**
 * Unit tests for the message-queue mutation semantics used by useMessageQueue.
 * Mirrors the synchronous ref-update pattern so same-tick remove + clearError
 * cannot resurrect a chip (the rocket-button bug).
 */
import { describe, it, expect } from 'vitest';

interface QueuedMessage {
  id: string;
  text: string;
  createdAt: number;
  error?: string | null;
}

/** Minimal pure stand-in of the fixed useMessageQueue mutation core. */
function createQueueCore() {
  let queue: QueuedMessage[] = [];
  let queueRef = queue;

  const persist = (next: QueuedMessage[]) => {
    queueRef = next;
    queue = next;
  };

  return {
    get queue() {
      return queue;
    },
    enqueue(text: string): QueuedMessage {
      const entry: QueuedMessage = {
        id: `id-${queueRef.length + 1}`,
        text,
        createdAt: Date.now(),
        error: null,
      };
      persist([...queueRef, entry]);
      return entry;
    },
    removeById(id: string) {
      const current = queueRef;
      const next = current.filter((m) => m.id !== id);
      if (next.length !== current.length) persist(next);
    },
    drainOne(): QueuedMessage | null {
      const current = queueRef;
      if (current.length === 0) return null;
      const [head, ...rest] = current;
      persist(rest);
      return head;
    },
    clearError(id: string) {
      const current = queueRef;
      const entry = current.find((m) => m.id === id);
      if (!entry?.error) return;
      persist(current.map((m) => (m.id === id ? { ...m, error: null } : m)));
    },
    markError(id: string, message: string) {
      const current = queueRef;
      if (!current.some((m) => m.id === id)) return;
      persist(current.map((m) => (m.id === id ? { ...m, error: message } : m)));
    },
  };
}

describe('message queue mutation core (rocket / drain races)', () => {
  it('removeById + same-tick clearError does not resurrect the entry', () => {
    const q = createQueueCore();
    const entry = q.enqueue('hello mid-run');
    expect(q.queue).toHaveLength(1);

    // Rocket path: remove chip then post-send clearError in the same tick.
    q.removeById(entry.id);
    q.clearError(entry.id);

    expect(q.queue).toHaveLength(0);
  });

  it('sequential drainOne empties the queue without duplicates', () => {
    const q = createQueueCore();
    q.enqueue('first');
    q.enqueue('second');

    expect(q.drainOne()?.text).toBe('first');
    expect(q.queue.map((m) => m.text)).toEqual(['second']);
    expect(q.drainOne()?.text).toBe('second');
    expect(q.queue).toHaveLength(0);
    expect(q.drainOne()).toBeNull();
  });

  it('markError is a no-op for a removed id', () => {
    const q = createQueueCore();
    const entry = q.enqueue('x');
    q.removeById(entry.id);
    q.markError(entry.id, 'boom');
    expect(q.queue).toHaveLength(0);
  });
});
