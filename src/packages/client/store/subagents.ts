/**
 * Subagent Store Actions
 *
 * Manages virtual subagents spawned by Claude Code's Task tool.
 * These are not real TC agents - they're visual representations of
 * ephemeral Task tool subprocesses running inside a Claude Code process.
 */

import type { Subagent, SubagentActivity, SubagentStreamEntry } from '../../shared/types';
import type { StoreState } from './types';

const MAX_ACTIVITIES = 50;
const MAX_STREAM_ENTRIES = 200;
const SUBAGENT_REMOVE_DELAY_MS = 30_000;

// Track auto-remove timers so stream entries can extend them
const removeTimers = new Map<string, ReturnType<typeof setTimeout>>();

export interface SubagentActions {
  addSubagent(subagent: Subagent): void;
  completeSubagent(subagentId: string, parentAgentId: string, success: boolean): void;
  addSubagentActivity(subagentId: string, parentAgentId: string, activity: SubagentActivity): void;
  updateSubagentStats(subagentId: string, parentAgentId: string, stats: { durationMs: number; tokensUsed: number; toolUseCount: number }): void;
  getSubagentsForAgent(parentAgentId: string): Subagent[];
  getSubagent(subagentId: string): Subagent | undefined;
  removeSubagent(subagentId: string): void;
  /** Append streaming entries from JSONL file watcher */
  addSubagentStreamEntries(toolUseId: string, parentAgentId: string, entries: SubagentStreamEntry[]): void;
  /** Find subagent by toolUseId (used for correlating completion events) */
  getSubagentByToolUseId(toolUseId: string): Subagent | undefined;
}

/** Find a subagent by ID or toolUseId within a given parent agent */
function findSubagent(subagents: Map<string, Subagent>, subagentId: string, parentAgentId: string): Subagent | undefined {
  let sub = subagents.get(subagentId);
  if (!sub) {
    for (const [, candidate] of subagents) {
      if (candidate.toolUseId === subagentId && candidate.parentAgentId === parentAgentId) {
        sub = candidate;
        break;
      }
    }
  }
  return sub;
}

function scheduleRemove(
  subId: string,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void
): void {
  // Clear any existing timer for this subagent
  const existing = removeTimers.get(subId);
  if (existing) clearTimeout(existing);

  removeTimers.set(subId, setTimeout(() => {
    removeTimers.delete(subId);
    setState((s) => {
      const current = s.subagents.get(subId);
      if (current && (current.status === 'completed' || current.status === 'failed')) {
        const cleaned = new Map(s.subagents);
        cleaned.delete(subId);
        s.subagents = cleaned;
      }
    });
    notify();
  }, SUBAGENT_REMOVE_DELAY_MS));
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
        const sub = findSubagent(s.subagents, subagentId, parentAgentId);
        if (sub) {
          const newSubagents = new Map(s.subagents);
          newSubagents.set(sub.id, {
            ...sub,
            status: success ? 'completed' : 'failed',
            completedAt: Date.now(),
          });
          s.subagents = newSubagents;
          console.log(`[Subagent] Completed: ${sub.name} (${sub.id}) success=${success}`);

          // Schedule auto-remove (can be extended by incoming stream entries)
          scheduleRemove(sub.id, setState, notify);
        }
      });
      notify();
    },

    addSubagentActivity(subagentId: string, parentAgentId: string, activity: SubagentActivity): void {
      setState((s) => {
        const sub = findSubagent(s.subagents, subagentId, parentAgentId);
        if (sub) {
          const activities = [...(sub.activities || []), activity].slice(-MAX_ACTIVITIES);
          const newSubagents = new Map(s.subagents);
          newSubagents.set(sub.id, { ...sub, activities });
          s.subagents = newSubagents;
        }
      });
      notify();
    },

    updateSubagentStats(subagentId: string, parentAgentId: string, stats: { durationMs: number; tokensUsed: number; toolUseCount: number }): void {
      setState((s) => {
        const sub = findSubagent(s.subagents, subagentId, parentAgentId);
        if (sub) {
          const newSubagents = new Map(s.subagents);
          newSubagents.set(sub.id, { ...sub, stats });
          s.subagents = newSubagents;
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

    addSubagentStreamEntries(toolUseId: string, parentAgentId: string, entries: SubagentStreamEntry[]): void {
      setState((s) => {
        const sub = findSubagent(s.subagents, toolUseId, parentAgentId);
        if (sub) {
          const existing = sub.streamEntries || [];
          const combined = [...existing, ...entries].slice(-MAX_STREAM_ENTRIES);
          const newSubagents = new Map(s.subagents);
          newSubagents.set(sub.id, { ...sub, streamEntries: combined });
          s.subagents = newSubagents;

          // Extend auto-remove timer if subagent is completed but still receiving entries
          if (sub.status === 'completed' || sub.status === 'failed') {
            scheduleRemove(sub.id, setState, notify);
          }
        }
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
