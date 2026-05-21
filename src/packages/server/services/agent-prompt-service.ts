/**
 * Agent Prompt Service
 *
 * Bridges the MCP permission-prompt-tool flow to the Tide Commander UI.
 * When a bypass-mode Claude agent invokes AskUserQuestion or ExitPlanMode the
 * MCP server (src/packages/server/claude/permission-prompt-server.mjs) POSTs
 * here; we hold the request, broadcast it to the UI, and resolve the waiting
 * promise once the user clicks Approve / picks an answer (or on timeout).
 *
 * Mirrors permission-service.ts intentionally — the data flow is the same.
 */

import type { AgentPrompt, AgentPromptResponse, AgentPromptTool } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AgentPrompt');

interface PendingPrompt {
  prompt: AgentPrompt;
  resolve: (response: AgentPromptResponse) => void;
  timeout: NodeJS.Timeout;
}

const pending = new Map<string, PendingPrompt>();

type Listener = (prompt: AgentPrompt) => void;
const listeners = new Set<Listener>();

type ResolvedListener = (requestId: string, approved: boolean) => void;
const resolvedListeners = new Set<ResolvedListener>();

// Plan/clarification prompts can sit for a while in interactive review — give
// the user 10 minutes before falling back to a deny.
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeResolved(listener: ResolvedListener): () => void {
  resolvedListeners.add(listener);
  return () => resolvedListeners.delete(listener);
}

function broadcast(prompt: AgentPrompt): void {
  listeners.forEach((l) => l(prompt));
}

function broadcastResolved(requestId: string, approved: boolean): void {
  resolvedListeners.forEach((l) => l(requestId, approved));
}

/**
 * Create a prompt and wait for the user's response (or timeout).
 * Called by the agent-prompt HTTP route on behalf of the MCP server.
 */
export async function createPrompt(args: {
  id: string;
  agentId: string;
  tool: AgentPromptTool;
  input: Record<string, unknown>;
}): Promise<AgentPromptResponse> {
  const prompt: AgentPrompt = {
    id: args.id,
    agentId: args.agentId,
    tool: args.tool,
    input: args.input,
    status: 'pending',
    timestamp: Date.now(),
  };

  log.log(`Prompt created: ${args.id} tool=${args.tool} agent=${args.agentId}`);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log.log(`Prompt ${args.id} timed out — denying`);
      pending.delete(args.id);
      broadcastResolved(args.id, false);
      resolve({ requestId: args.id, approved: false, reason: 'Prompt timed out' });
    }, DEFAULT_TIMEOUT_MS);

    pending.set(args.id, { prompt, resolve, timeout });
    broadcast(prompt);
  });
}

/**
 * Deliver a user response. Called by the UI via HTTP POST or WS message.
 */
export function respondToPrompt(response: AgentPromptResponse): boolean {
  const entry = pending.get(response.requestId);
  if (!entry) {
    log.log(`No pending prompt for ${response.requestId}`);
    return false;
  }
  clearTimeout(entry.timeout);
  pending.delete(response.requestId);
  entry.prompt.status = 'answered';

  log.log(`Prompt ${response.requestId} answered approved=${response.approved}`);
  broadcastResolved(response.requestId, response.approved);
  entry.resolve(response);
  return true;
}

export function getPendingPrompts(): AgentPrompt[] {
  return Array.from(pending.values()).map((p) => p.prompt);
}

export function getPendingPromptsForAgent(agentId: string): AgentPrompt[] {
  return Array.from(pending.values())
    .filter((p) => p.prompt.agentId === agentId)
    .map((p) => p.prompt);
}

/**
 * Cancel all pending prompts for an agent (used when an agent is stopped).
 */
export function cancelPromptsForAgent(agentId: string): string[] {
  const cancelled: string[] = [];
  for (const [id, entry] of pending) {
    if (entry.prompt.agentId === agentId) {
      log.log(`Cancelling prompt ${id} for stopped agent ${agentId}`);
      clearTimeout(entry.timeout);
      pending.delete(id);
      broadcastResolved(id, false);
      entry.resolve({ requestId: id, approved: false, reason: 'Agent was stopped' });
      cancelled.push(id);
    }
  }
  return cancelled;
}
