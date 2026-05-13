/**
 * Output Store Actions
 *
 * Handles agent output management.
 */

import type { StoreState, AgentOutput, LastPrompt } from './types';
import { perf } from '../utils/profiling';
import { debugLog } from '../services/agentDebugger';

const MAX_OUTPUTS_PER_AGENT = 200;

function enforceOutputBufferLimits(outputs: AgentOutput[]): AgentOutput[] {
  if (outputs.length <= MAX_OUTPUTS_PER_AGENT) {
    return outputs;
  }

  return outputs.slice(-MAX_OUTPUTS_PER_AGENT);
}

function isSameOutputEvent(a: AgentOutput, b: AgentOutput): boolean {
  return a.uuid === b.uuid
    && a.text === b.text
    && a.isStreaming === b.isStreaming
    && a.isUserPrompt === b.isUserPrompt
    && a.isDelegation === b.isDelegation
    && a.subagentName === b.subagentName
    && a.toolName === b.toolName
    && a.toolOutput === b.toolOutput
    && a.isError === b.isError;
}

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

        // DEDUPLICATION: UUIDs identify a message/tool block, not always a
        // single WebSocket output. Claude text deltas reuse the same UUID, so
        // streaming chunks must be merged instead of dropped.
        if (output.uuid) {
          const existingIndex = currentOutputs.findIndex(existing => existing.uuid === output.uuid);
          if (existingIndex >= 0) {
            const existing = currentOutputs[existingIndex];

            if (existing.isStreaming || output.isStreaming) {
              const updatedOutputs = [...currentOutputs];
              updatedOutputs[existingIndex] = output.isStreaming
                ? {
                    ...existing,
                    text: existing.text + output.text,
                    isStreaming: true,
                    skillUpdate: output.skillUpdate ?? existing.skillUpdate,
                    subagentName: output.subagentName ?? existing.subagentName,
                    toolName: output.toolName ?? existing.toolName,
                    toolInput: output.toolInput ?? existing.toolInput,
                    toolOutput: output.toolOutput ?? existing.toolOutput,
                    isError: output.isError ?? existing.isError,
                  }
                : {
                    ...existing,
                    ...output,
                    // Keep the original timestamp so the in-progress row does
                    // not jump to the end again when the final message arrives.
                    timestamp: existing.timestamp,
                  };

              const limitedOutputs = enforceOutputBufferLimits(updatedOutputs);
              const newAgentOutputs = new Map(s.agentOutputs);
              newAgentOutputs.set(agentId, limitedOutputs);
              s.agentOutputs = newAgentOutputs;
              return;
            }

            if (isSameOutputEvent(existing, output)) {
              // Exact resend - skip.
              return;
            }
            // Same UUID with different non-streaming text is valid for tool
            // blocks such as "Using tool:" followed by "Tool input:".
            // Fall through and append it as a distinct output row.
          }
        }

        // Create NEW array with the new output appended (immutable update for React reactivity)
        const newOutputs = enforceOutputBufferLimits([...currentOutputs, output]);

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
      let merged = [...historyMessages, ...preservedOutputs];
      merged.sort((a, b) => a.timestamp - b.timestamp);
      merged = enforceOutputBufferLimits(merged);

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
