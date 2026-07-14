import { useCallback, useEffect, useRef, useState } from 'react';
import { apiUrl, authFetch } from '../utils/storage';

/**
 * Server-side mid-run message queue (runner-owned, drains autonomously at turn
 * end — front open or not). This hook is a read/remove VIEW of that queue:
 * messages are enqueued by simply sending them (store.sendCommand) while the
 * agent is busy; the server queues and delivers them itself.
 */
export interface ServerQueuedMessage {
  /** Snapshot-scoped identity (position + text prefix); stable per refetch. */
  id: string;
  /** Position in the server snapshot — required for removal. */
  index: number;
  text: string;
  /** Kept for renderer compatibility; the server queue has no error state. */
  error?: string | null;
}

export interface UseServerMessageQueueResult {
  queue: ServerQueuedMessage[];
  refetch: () => Promise<void>;
  /** Remove a queued message on the server. False = queue changed (refetched). */
  remove: (entry: ServerQueuedMessage) => Promise<boolean>;
}

const REFRESH_WHILE_QUEUED_MS = 10000;

export function useServerMessageQueue(
  agentId: string | null | undefined,
  isWorking: boolean
): UseServerMessageQueueResult {
  const safeAgentId = agentId || '';
  const [queue, setQueue] = useState<ServerQueuedMessage[]>([]);
  // Guards stale responses across rapid agent switches.
  const fetchSeq = useRef(0);

  const refetch = useCallback(async () => {
    if (!safeAgentId) {
      setQueue([]);
      return;
    }
    const seq = ++fetchSeq.current;
    try {
      const res = await authFetch(apiUrl(`/api/agents/${safeAgentId}/queue`));
      if (!res.ok) return;
      const data = (await res.json()) as { messages?: Array<{ index: number; text: string }> };
      if (seq !== fetchSeq.current) return;
      setQueue(
        (data.messages ?? []).map((m) => ({
          id: `${m.index}:${m.text.slice(0, 24)}`,
          index: m.index,
          text: m.text,
          error: null,
        }))
      );
    } catch {
      // Offline / server restarting — keep the last snapshot.
    }
  }, [safeAgentId]);

  // Refetch on agent switch and whenever the work state flips: the queue
  // drains exactly around turn boundaries, which always move agent status.
  useEffect(() => {
    void refetch();
  }, [refetch, isWorking]);

  // command_started broadcasts (any device) signal enqueue/drain moments.
  useEffect(() => {
    if (!safeAgentId) return;
    const onMaybeChanged = (e: Event) => {
      const detail = (e as CustomEvent).detail as { agentId?: string } | undefined;
      if (!detail?.agentId || detail.agentId === safeAgentId) void refetch();
    };
    window.addEventListener('tide:agent-queue-maybe-changed', onMaybeChanged);
    return () => window.removeEventListener('tide:agent-queue-maybe-changed', onMaybeChanged);
  }, [safeAgentId, refetch]);

  // Safety net: while chips are showing, keep the snapshot honest even if a
  // drain slipped past the signals above.
  useEffect(() => {
    if (!safeAgentId || queue.length === 0) return;
    const timer = window.setInterval(() => void refetch(), REFRESH_WHILE_QUEUED_MS);
    return () => window.clearInterval(timer);
  }, [safeAgentId, queue.length, refetch]);

  const remove = useCallback(
    async (entry: ServerQueuedMessage): Promise<boolean> => {
      if (!safeAgentId) return false;
      try {
        const res = await authFetch(apiUrl(`/api/agents/${safeAgentId}/queue/${entry.index}`), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: entry.text }),
        });
        void refetch();
        return res.ok;
      } catch {
        return false;
      }
    },
    [safeAgentId, refetch]
  );

  return { queue, refetch, remove };
}
