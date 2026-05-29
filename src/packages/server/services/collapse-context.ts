/**
 * Collapse-Context Service
 *
 * Owns the small queue of pending `/compact` requests that need to fire as
 * soon as their agent transitions back to idle. Two callers use it: the REST
 * endpoint `POST /api/agents/:id/collapse-context` and the WS
 * `collapse_context` handler.
 *
 * Why a separate module: the queue + idle-drain logic is the only piece of
 * state we want to unit-test in isolation, and `runtime-service` is heavy with
 * unrelated deps. We expose a factory so tests can wire fake `getAgent` /
 * `sendCommand` / `subscribe` deps and exercise every branch without spinning
 * up the real agent service.
 */

export interface CollapseAgentSnapshot {
  id: string;
  status: string;
}

export type SubscribeUnsubscribe = () => void;

export interface CollapseContextDeps {
  /** Lookup the current snapshot for an agent id. */
  getAgent: (id: string) => CollapseAgentSnapshot | undefined;
  /** Send a raw command (used for `/compact`). */
  sendCommand: (agentId: string, command: string) => Promise<void>;
  /**
   * Subscribe to agent change events. The collapse service only cares about
   * status transitions into `'idle'` — when one fires for an agent in the
   * pending set, that agent's queued `/compact` is drained.
   */
  subscribe: (
    listener: (event: string, data: CollapseAgentSnapshot | string | undefined) => void,
  ) => SubscribeUnsubscribe;
  /** Optional: logger sink for drain errors. Tests pass a no-op. */
  log?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
  };
}

export type CollapseContextResult =
  | { status: 'collapse-initiated' }
  | { status: 'queued' }
  | { status: 'not-found' }
  | { status: 'busy'; currentStatus: string }
  | { status: 'error'; error: string };

export interface CollapseContextOptions {
  /**
   * When the target agent isn't idle right now, enqueue the `/compact` and
   * dispatch it automatically the first time the agent transitions back to
   * idle. Default `false` — the call returns `busy` (existing behavior).
   */
  waitForIdle?: boolean;
}

export interface CollapseContextService {
  collapse(agentId: string, opts?: CollapseContextOptions): Promise<CollapseContextResult>;
  /** Test/diagnostic accessor — true when an agent has a pending queued `/compact`. */
  hasPending(agentId: string): boolean;
  /** Number of queued collapses currently waiting for an idle transition. */
  pendingCount(): number;
}

export function createCollapseContextService(deps: CollapseContextDeps): CollapseContextService {
  const pending = new Set<string>();
  let unsubscribe: SubscribeUnsubscribe | null = null;

  // Lazy subscription — we only attach the listener once a real queue exists.
  // Stays attached for the process lifetime; the pending set is the gate that
  // decides whether the listener does anything on each event.
  function ensureSubscribed(): void {
    if (unsubscribe) return;
    unsubscribe = deps.subscribe((event, data) => {
      if (event !== 'updated' || !data || typeof data === 'string') return;
      const agent = data;
      if (agent.status !== 'idle') return;
      if (!pending.has(agent.id)) return;
      pending.delete(agent.id);
      void drain(agent.id);
    });
  }

  async function drain(agentId: string): Promise<void> {
    try {
      await deps.sendCommand(agentId, '/compact');
      deps.log?.info?.(`Drained queued collapse for ${agentId} after idle transition`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.log?.error?.(`Failed to drain queued collapse for ${agentId}: ${msg}`);
    }
  }

  async function collapse(
    agentId: string,
    opts: CollapseContextOptions = {},
  ): Promise<CollapseContextResult> {
    const agent = deps.getAgent(agentId);
    if (!agent) return { status: 'not-found' };
    if (agent.status === 'idle') {
      try {
        await deps.sendCommand(agentId, '/compact');
        return { status: 'collapse-initiated' };
      } catch (err) {
        return { status: 'error', error: err instanceof Error ? err.message : String(err) };
      }
    }
    if (opts.waitForIdle) {
      ensureSubscribed();
      // Set.add is idempotent — multiple `waitForIdle` calls coalesce into one drain.
      pending.add(agentId);
      return { status: 'queued' };
    }
    return { status: 'busy', currentStatus: agent.status };
  }

  return {
    collapse,
    hasPending: (id) => pending.has(id),
    pendingCount: () => pending.size,
  };
}
