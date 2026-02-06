/**
 * Output Store Actions
 *
 * Handles Claude output management for agents.
 */

import type { StoreState, ClaudeOutput, LastPrompt } from './types';
import { perf } from '../utils/profiling';
import { debugLog } from '../services/agentDebugger';

export interface OutputActions {
  addOutput(agentId: string, output: ClaudeOutput): void;
  clearOutputs(agentId: string): void;
  getOutputs(agentId: string): ClaudeOutput[];
  addUserPromptToOutput(agentId: string, command: string): void;
  getLastPrompt(agentId: string): LastPrompt | undefined;
  setLastPrompt(agentId: string, text: string): void;
  /** Preserve current outputs before reconnect - returns snapshot to restore later */
  preserveOutputs(): Map<string, ClaudeOutput[]>;
  /** Merge preserved outputs with history */
  mergeOutputsWithHistory(
    agentId: string,
    historyMessages: ClaudeOutput[],
    preservedOutputs: ClaudeOutput[]
  ): ClaudeOutput[];
}

export function createOutputActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
  getListenerCount: () => number
): OutputActions {
  return {
    addOutput(agentId: string, output: ClaudeOutput): void {
      perf.start('store:addOutput');
      const listenerCount = getListenerCount();

      // IMPORTANT: All state reads and mutations must happen inside setState
      // to avoid race conditions when multiple outputs arrive rapidly
      setState((s) => {
        const currentOutputs = s.agentOutputs.get(agentId) || [];

        // DEDUPLICATION DISABLED: The previous text-matching deduplication was too aggressive
        // and was removing legitimate messages that happened to have identical text but arrived
        // at different times. For example, if an agent outputs "Perfect! Let me create..." twice
        // in the same session, the second one would be incorrectly filtered out.
        //
        // This is a streaming application where duplicate detection should be based on:
        // - Message IDs/timestamps (not available in current output format)
        // - Streaming state + content (streamed chunks are marked isStreaming=true, final is false)
        //
        // For now, we allow all non-duplicate messages through. The streaming deduplication
        // is already handled at the server level for streamed vs final consolidated messages.
        //
        // TODO: Implement proper deduplication using message IDs or sequence numbers
        // if duplicates become a problem in the future.

        // Create NEW array with the new output appended (immutable update for React reactivity)
        let newOutputs = [...currentOutputs, output];

        // Keep last 200 outputs per agent
        if (newOutputs.length > 200) {
          newOutputs = newOutputs.slice(-200);
        }

        debugLog.info(`Store: ${currentOutputs.length} -> ${newOutputs.length}`, {
          agentId,
          text: output.text.slice(0, 60),
          isStreaming: output.isStreaming,
          listeners: listenerCount,
        }, 'store:addOutput');

        const newAgentOutputs = new Map(s.agentOutputs);
        newAgentOutputs.set(agentId, newOutputs);
        s.agentOutputs = newAgentOutputs;
      });

      notify();
      perf.end('store:addOutput');
    },

    clearOutputs(agentId: string): void {
      setState((state) => {
        const newAgentOutputs = new Map(state.agentOutputs);
        newAgentOutputs.delete(agentId);
        state.agentOutputs = newAgentOutputs;
      });
      notify();
    },

    getOutputs(agentId: string): ClaudeOutput[] {
      return getState().agentOutputs.get(agentId) || [];
    },

    addUserPromptToOutput(agentId: string, command: string): void {
      this.addOutput(agentId, {
        text: command,
        isStreaming: false,
        timestamp: Date.now(),
        isUserPrompt: true,
      });
    },

    getLastPrompt(agentId: string): LastPrompt | undefined {
      return getState().lastPrompts.get(agentId);
    },

    setLastPrompt(agentId: string, text: string): void {
      setState((state) => {
        state.lastPrompts.set(agentId, {
          text,
          timestamp: Date.now(),
        });
      });
      notify();
    },

    preserveOutputs(): Map<string, ClaudeOutput[]> {
      const state = getState();
      const snapshot = new Map<string, ClaudeOutput[]>();
      for (const [agentId, outputs] of state.agentOutputs) {
        snapshot.set(agentId, outputs.map(o => ({ ...o })));
      }
      return snapshot;
    },

    mergeOutputsWithHistory(
      agentId: string,
      historyMessages: ClaudeOutput[],
      preservedOutputs: ClaudeOutput[]
    ): ClaudeOutput[] {
      // Just concatenate and sort by timestamp - no dedup
      const merged = [...historyMessages, ...preservedOutputs];
      merged.sort((a, b) => a.timestamp - b.timestamp);

      setState((s) => {
        const newAgentOutputs = new Map(s.agentOutputs);
        newAgentOutputs.set(agentId, merged);
        s.agentOutputs = newAgentOutputs;
      });
      notify();

      return merged;
    },
  };
}
