import type { Agent, ClientMessage } from '../../shared/types';

const INTENT_TTL_MS = 30_000;
const CREATION_MESSAGE_TYPES = new Set<ClientMessage['type']>([
  'spawn_agent',
  'clone_agent',
  'fork_agent',
  'restore_session_new_agent',
  'spawn_boss_agent',
  'create_directory',
]);

interface AgentCreationIntent {
  createdAt: number;
  name?: string;
  cwd?: string;
  agentClass?: string;
}

const pendingIntents: AgentCreationIntent[] = [];

/** Record a creation requested by this browser tab. */
export function recordLocalAgentCreationIntent(message: ClientMessage, now = Date.now()): void {
  if (!CREATION_MESSAGE_TYPES.has(message.type)) return;
  const payload = message.payload as unknown as Record<string, unknown>;
  pendingIntents.push({
    createdAt: now,
    name: typeof payload.name === 'string' && payload.name ? payload.name : undefined,
    cwd: typeof payload.cwd === 'string' && payload.cwd ? payload.cwd : undefined,
    agentClass: typeof payload.class === 'string' && payload.class ? payload.class : undefined,
  });
}

/**
 * Consume the matching local request for an agent_created broadcast.
 * Broadcasts from other tabs/devices have no local intent and must not steal
 * this tab's active conversation.
 */
export function consumeLocalAgentCreationIntent(agent: Agent, now = Date.now()): boolean {
  for (let i = pendingIntents.length - 1; i >= 0; i--) {
    if (now - pendingIntents[i].createdAt > INTENT_TTL_MS) pendingIntents.splice(i, 1);
  }

  const index = pendingIntents.findIndex((intent) => {
    if (intent.name && intent.name !== agent.name) return false;
    if (intent.cwd && intent.cwd !== agent.cwd) return false;
    if (intent.agentClass && intent.agentClass !== agent.class) return false;
    return true;
  });
  if (index < 0) return false;
  pendingIntents.splice(index, 1);
  return true;
}

/** Test/HMR cleanup. */
export function clearLocalAgentCreationIntents(): void {
  pendingIntents.length = 0;
}
