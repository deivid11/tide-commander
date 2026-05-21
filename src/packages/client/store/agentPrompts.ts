/**
 * Agent Prompt Store Actions
 *
 * Handles AskUserQuestion / ExitPlanMode prompts forwarded from the MCP
 * permission-prompt server through Tide Commander's /api/agent-prompt route.
 * Pattern mirrors permissions.ts.
 */

import type { AgentPrompt } from '../../shared/types';
import type { StoreState } from './types';
import { apiUrl, authFetch } from '../utils/storage';

export interface AgentPromptActions {
  addAgentPrompt(prompt: AgentPrompt): void;
  resolveAgentPromptLocal(requestId: string, approved: boolean): void;
  respondToAgentPrompt(
    requestId: string,
    approved: boolean,
    opts?: { answers?: Record<string, string | string[]>; reason?: string }
  ): Promise<void>;
  getPendingAgentPromptsForAgent(agentId: string): AgentPrompt[];
}

export function createAgentPromptActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
): AgentPromptActions {
  return {
    addAgentPrompt(prompt) {
      setState((s) => {
        const next = new Map(s.agentPrompts);
        next.set(prompt.id, prompt);
        s.agentPrompts = next;
      });
      notify();
    },

    resolveAgentPromptLocal(requestId, approved) {
      const existing = getState().agentPrompts.get(requestId);
      if (!existing) return;
      setState((s) => {
        const next = new Map(s.agentPrompts);
        next.set(requestId, { ...existing, status: approved ? 'answered' : 'cancelled' });
        s.agentPrompts = next;
      });
      notify();
      // Drop it after a short delay so the user briefly sees the resolved state.
      setTimeout(() => {
        setState((s) => {
          const next = new Map(s.agentPrompts);
          next.delete(requestId);
          s.agentPrompts = next;
        });
        notify();
      }, 1500);
    },

    async respondToAgentPrompt(requestId, approved, opts) {
      try {
        // Use the project's API helpers so we hit the Tide Commander server
        // (port 5174 in dev) rather than the Vite dev server (5173). authFetch
        // also injects the X-Auth-Token header.
        const url = apiUrl(`/api/agent-prompt/${encodeURIComponent(requestId)}/respond`);
        const res = await authFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            approved,
            answers: opts?.answers,
            reason: opts?.reason,
          }),
        });
        if (!res.ok) {
          console.error('respondToAgentPrompt non-ok', res.status, await res.text().catch(() => ''));
        }
      } catch (err) {
        // Surfacing is up to the caller; the server-side timeout will resolve
        // the prompt eventually if this POST never lands.
        console.error('respondToAgentPrompt failed', err);
      }
    },

    getPendingAgentPromptsForAgent(agentId) {
      return Array.from(getState().agentPrompts.values()).filter(
        (p) => p.agentId === agentId && p.status === 'pending'
      );
    },
  };
}
