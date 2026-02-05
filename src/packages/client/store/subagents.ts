/**
 * Subagent Store Actions
 *
 * Manages virtual subagents spawned by Claude Code's Task tool.
 * These are not real TC agents - they're visual representations of
 * ephemeral Task tool subprocesses running inside a Claude Code process.
 */

import type { Subagent } from '../../shared/types';
import type { StoreState } from './types';

export interface SubagentActions {
  addSubagent(subagent: Subagent): void;
  completeSubagent(subagentId: string, parentAgentId: string, success: boolean): void;
  getSubagentsForAgent(parentAgentId: string): Subagent[];
  getSubagent(subagentId: string): Subagent | undefined;
  removeSubagent(subagentId: string): void;
  /** Find subagent by toolUseId (used for correlating completion events) */
  getSubagentByToolUseId(toolUseId: string): Subagent | undefined;
}

export function createSubagentActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void
): SubagentActions {
  return {
    addSubagent(subagent: Subagent): void {
      setState((s) => {
        const newSubagents = new Map(s.subagents);
        newSubagents.set(subagent.id, subagent);
        s.subagents = newSubagents;
      });
      notify();
      console.log(`[Subagent] Added: ${subagent.name} (${subagent.id}) for agent ${subagent.parentAgentId}`);
    },

    completeSubagent(subagentId: string, parentAgentId: string, success: boolean): void {
      setState((s) => {
        // Try finding by ID first, then by toolUseId
        let sub = s.subagents.get(subagentId);
        if (!sub) {
          // subagentId might actually be a toolUseId from the completion event
          for (const [, candidate] of s.subagents) {
            if (candidate.toolUseId === subagentId && candidate.parentAgentId === parentAgentId) {
              sub = candidate;
              break;
            }
          }
        }
        if (sub) {
          const newSubagents = new Map(s.subagents);
          newSubagents.set(sub.id, {
            ...sub,
            status: success ? 'completed' : 'failed',
            completedAt: Date.now(),
          });
          s.subagents = newSubagents;
          console.log(`[Subagent] Completed: ${sub.name} (${sub.id}) success=${success}`);

          // Auto-remove completed subagents after 30 seconds
          setTimeout(() => {
            setState((s2) => {
              const current = s2.subagents.get(sub!.id);
              if (current && (current.status === 'completed' || current.status === 'failed')) {
                const cleaned = new Map(s2.subagents);
                cleaned.delete(sub!.id);
                s2.subagents = cleaned;
              }
            });
            notify();
          }, 30000);
        }
      });
      notify();
    },

    getSubagentsForAgent(parentAgentId: string): Subagent[] {
      const state = getState();
      return Array.from(state.subagents.values()).filter(
        (s) => s.parentAgentId === parentAgentId
      );
    },

    getSubagent(subagentId: string): Subagent | undefined {
      return getState().subagents.get(subagentId);
    },

    removeSubagent(subagentId: string): void {
      setState((s) => {
        const newSubagents = new Map(s.subagents);
        newSubagents.delete(subagentId);
        s.subagents = newSubagents;
      });
      notify();
    },

    getSubagentByToolUseId(toolUseId: string): Subagent | undefined {
      const state = getState();
      for (const [, sub] of state.subagents) {
        if (sub.toolUseId === toolUseId) return sub;
      }
      return undefined;
    },
  };
}
