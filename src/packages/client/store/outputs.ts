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

        // Deduplicate: if this non-streaming output is identical to a recent non-streaming output,
        // skip it to avoid duplicates. This handles the case where text is streamed in deltas
        // and then sent again as a final consolidated message from the assistant event.
        // IMPORTANT: Only deduplicate if the existing output is ALSO non-streaming. If the
        // existing output is streaming, allow the final consolidated message through, as the
        // streaming chunks may be incomplete.
        // NOTE: Do NOT deduplicate tool outputs ("Using tool:", "Tool input:", "Bash output:", etc.)
        // as they need to appear every time a tool is used, even if identical to previous use.
        const isToolOutput = output.text && (
          output.text.startsWith('Using tool:') ||
          output.text.startsWith('Tool input:') ||
          output.text.startsWith('Tool result:') ||
          output.text.startsWith('Bash output:') ||
          output.text.startsWith('Tokens:') ||
          output.text.startsWith('Cost:')
        );

        if (!output.isStreaming && !output.isUserPrompt && !isToolOutput && currentOutputs.length > 0) {
          // Check if this exact text already exists in recent non-streaming outputs (last 20)
          const recentOutputs = currentOutputs.slice(-20);
          const isDuplicate = recentOutputs.some(existing =>
            !existing.isUserPrompt &&
            !existing.isStreaming &&
            existing.text === output.text
          );
          if (isDuplicate) {
            debugLog.info(`Store: Skipping duplicate output`, {
              agentId,
              text: output.text.slice(0, 60),
            }, 'store:addOutput:dedupe');
            return; // Skip this duplicate
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
