/**
 * Output Store Actions
 *
 * Handles agent output management.
 */

import type { StoreState, AgentOutput, LastPrompt } from './types';
import { perf } from '../utils/profiling';
import { debugLog } from '../services/agentDebugger';

export interface OutputActions {
  addOutput(agentId: string, output: AgentOutput): void;
  clearOutputs(agentId: string): void;
  getOutputs(agentId: string): AgentOutput[];
  addUserPromptToOutput(agentId: string, command: string): void;
  getLastPrompt(agentId: string): LastPrompt | undefined;
  setLastPrompt(agentId: string, text: string): void;
  /** Preserve current outputs before reconnect - returns snapshot to restore later */
  preserveOutputs(): Map<string, AgentOutput[]>;
  /** Merge preserved outputs with history */
  mergeOutputsWithHistory(
    agentId: string,
    historyMessages: AgentOutput[],
    preservedOutputs: AgentOutput[]
  ): AgentOutput[];
}

export function createOutputActions(
  getState: () => StoreState,
  setState: (updater: (state: StoreState) => void) => void,
  notify: () => void,
  getListenerCount: () => number
): OutputActions {
  return {
    addOutput(agentId: string, output: AgentOutput): void {
      perf.start('store:addOutput');
      const listenerCount = getListenerCount();

      // IMPORTANT: All state reads and mutations must happen inside setState
      // to avoid race conditions when multiple outputs arrive rapidly
      setState((s) => {
        const currentOutputs = s.agentOutputs.get(agentId) || [];

          // DEDUPLICATION: Use message UUID if available, otherwise skip dedup
        // This ensures reliable message delivery without false positives
        if (output.uuid) {
          // Check if we already have this exact message UUID (indicates a resend)
          const isDuplicate = currentOutputs.some(existing =>
            existing.uuid === output.uuid
          );
          if (isDuplicate) {
            // Message already delivered - skip
            return;
          }
        }

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

    getOutputs(agentId: string): AgentOutput[] {
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

    preserveOutputs(): Map<string, AgentOutput[]> {
      const state = getState();
      const snapshot = new Map<string, AgentOutput[]>();
      for (const [agentId, outputs] of state.agentOutputs) {
        snapshot.set(agentId, outputs.map(o => ({ ...o })));
      }
      return snapshot;
    },

    mergeOutputsWithHistory(
      agentId: string,
      historyMessages: AgentOutput[],
      preservedOutputs: AgentOutput[]
    ): AgentOutput[] {
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
