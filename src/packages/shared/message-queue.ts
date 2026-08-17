/** Separator used when several pending prompts are delivered as one turn. */
export const QUEUED_MESSAGE_SEPARATOR = '\n\n';

/**
 * Append a prompt while keeping the queue capped at one combined entry.
 *
 * The queue is mutated in place because runner state exposes snapshots of the
 * same array. Any pre-existing multi-entry queue is normalized as part of the
 * append, which also makes this safe during a rolling upgrade.
 */
export function appendQueuedMessage(queue: string[], message: string): string {
  const combined = [...queue, message].join(QUEUED_MESSAGE_SEPARATOR);
  queue.splice(0, queue.length, combined);
  return combined;
}

/**
 * Restore a failed in-flight prompt ahead of content queued after it, while
 * retaining the one-entry queue invariant.
 */
export function prependQueuedMessage(queue: string[], message: string): string {
  const combined = [message, ...queue].join(QUEUED_MESSAGE_SEPARATOR);
  queue.splice(0, queue.length, combined);
  return combined;
}
