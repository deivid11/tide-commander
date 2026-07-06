/**
 * Collapse-Context Service
 *
 * Owns the small queue of pending `/compact` requests that need to fire as
 * soon as their agent transitions back to idle. Callers: the REST endpoint
 * `POST /api/agents/:id/collapse-context`, the WS `collapse_context` handler,
 * and the auto-collapse cron (which may also pass an `afterPrompt` — a command
 * dispatched to the agent once its compact turn finishes).
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
  /**
   * Optional prompt sent to the agent as a regular command once the `/compact`
   * completes (detected as the agent's next transition back to idle after the
   * compact was dispatched). Lets scheduled collapses re-seed an unattended
   * agent with instructions right after its context is wiped. When multiple
   * queued collapses coalesce, the latest call's prompt wins.
   */
  afterPrompt?: string;
}

export interface CollapseContextService {
  collapse(agentId: string, opts?: CollapseContextOptions): Promise<CollapseContextResult>;
  /** Test/diagnostic accessor — true when an agent has a pending queued `/compact`. */
  hasPending(agentId: string): boolean;
  /** Number of queued collapses currently waiting for an idle transition. */
  pendingCount(): number;
  /** Test/diagnostic accessor — true when a post-collapse prompt is armed for the agent. */
  hasPendingPrompt(agentId: string): boolean;
}

export function createCollapseContextService(deps: CollapseContextDeps): CollapseContextService {
  const pending = new Map<string, { afterPrompt?: string }>();
  // Prompts armed AFTER their `/compact` was dispatched — sent on the agent's
  // next idle transition (i.e. when the compact turn finishes).
  const afterPrompts = new Map<string, string>();
  let unsubscribe: SubscribeUnsubscribe | null = null;

  // Lazy subscription — we only attach the listener once a real queue exists.
  // Stays attached for the process lifetime; the pending/afterPrompts maps are
  // the gate that decides whether the listener does anything on each event.
  function ensureSubscribed(): void {
    if (unsubscribe) return;
    unsubscribe = deps.subscribe((event, data) => {
      if (event === 'deleted' && typeof data === 'string') {
        pending.delete(data);
        afterPrompts.delete(data);
        return;
      }
      if (event !== 'updated' || !data || typeof data === 'string') return;
      const agent = data;
      if (agent.status !== 'idle') return;
      const queued = pending.get(agent.id);
      if (queued) {
        pending.delete(agent.id);
        void drain(agent.id, queued.afterPrompt);
        return;
      }
      const prompt = afterPrompts.get(agent.id);
      if (prompt !== undefined) {
        afterPrompts.delete(agent.id);
        void sendAfterPrompt(agent.id, prompt);
      }
    });
  }

  // Register the post-collapse prompt only after `/compact` was actually sent:
  // sendCommand flips the agent to 'working' synchronously, so the idle event
  // this arms against is the one that ends the compact turn.
  function armAfterPrompt(agentId: string, prompt: string): void {
    ensureSubscribed();
    afterPrompts.set(agentId, prompt);
  }

  async function drain(agentId: string, afterPrompt?: string): Promise<void> {
    try {
      await deps.sendCommand(agentId, '/compact');
      deps.log?.info?.(`Drained queued collapse for ${agentId} after idle transition`);
      if (afterPrompt) armAfterPrompt(agentId, afterPrompt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.log?.error?.(`Failed to drain queued collapse for ${agentId}: ${msg}`);
    }
  }

  async function sendAfterPrompt(agentId: string, prompt: string): Promise<void> {
    try {
      await deps.sendCommand(agentId, prompt);
      deps.log?.info?.(`Sent post-collapse prompt to ${agentId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      deps.log?.error?.(`Failed to send post-collapse prompt to ${agentId}: ${msg}`);
    }
  }

  async function collapse(
    agentId: string,
    opts: CollapseContextOptions = {},
  ): Promise<CollapseContextResult> {
    const agent = deps.getAgent(agentId);
    if (!agent) return { status: 'not-found' };
    const afterPrompt = opts.afterPrompt?.trim() || undefined;
    if (agent.status === 'idle') {
      try {
        await deps.sendCommand(agentId, '/compact');
        if (afterPrompt) armAfterPrompt(agentId, afterPrompt);
        return { status: 'collapse-initiated' };
      } catch (err) {
        return { status: 'error', error: err instanceof Error ? err.message : String(err) };
      }
    }
    if (opts.waitForIdle) {
      ensureSubscribed();
      // Map.set is idempotent per agent — multiple `waitForIdle` calls coalesce
      // into one drain; the latest call's afterPrompt wins.
      pending.set(agentId, { afterPrompt });
      return { status: 'queued' };
    }
    return { status: 'busy', currentStatus: agent.status };
  }

  return {
    collapse,
    hasPending: (id) => pending.has(id),
    pendingCount: () => pending.size,
    hasPendingPrompt: (id) => afterPrompts.has(id),
  };
}
