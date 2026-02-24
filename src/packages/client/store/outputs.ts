/**
 * Output Store Actions
 *
 * Handles agent output management.
 */

import type { StoreState, AgentOutput, LastPrompt } from './types';
import { perf } from '../utils/profiling';
import { debugLog } from '../services/agentDebugger';

const MAX_OUTPUTS_PER_AGENT = 200;
const MAX_OUTPUT_BYTES_PER_AGENT = 1024 * 1024; // 1MB soft cap per agent output buffer
const MAX_SINGLE_OUTPUT_BYTES = 64 * 1024; // 64KB max per single output entry
const TRUNCATION_SUFFIX = '\n\n[output truncated]';

function estimateTextBytes(text: string): number {
  // JS strings are UTF-16, so 2 bytes per code unit is a good upper-bound estimate.
  return text.length * 2;
}

function truncateTextToBytes(text: string, maxBytes: number): string {
  if (estimateTextBytes(text) <= maxBytes) {
    return text;
  }

  const suffixBytes = estimateTextBytes(TRUNCATION_SUFFIX);
  const availableBytes = Math.max(0, maxBytes - suffixBytes);
  const maxChars = Math.floor(availableBytes / 2);
  return `${text.slice(0, maxChars)}${TRUNCATION_SUFFIX}`;
}

function normalizeOutputSize(output: AgentOutput): AgentOutput {
  if (estimateTextBytes(output.text) <= MAX_SINGLE_OUTPUT_BYTES) {
    return output;
  }

  return {
    ...output,
    text: truncateTextToBytes(output.text, MAX_SINGLE_OUTPUT_BYTES),
  };
}

function enforceOutputBufferLimits(outputs: AgentOutput[]): AgentOutput[] {
  let next = outputs;

  if (next.length > MAX_OUTPUTS_PER_AGENT) {
    next = next.slice(-MAX_OUTPUTS_PER_AGENT);
  }

  let totalBytes = next.reduce((sum, item) => sum + estimateTextBytes(item.text), 0);
  while (next.length > 1 && totalBytes > MAX_OUTPUT_BYTES_PER_AGENT) {
    totalBytes -= estimateTextBytes(next[0].text);
    next = next.slice(1);
  }

  return next;
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
        const normalizedOutput = normalizeOutputSize(output);

          // DEDUPLICATION: Use message UUID if available, otherwise skip dedup
        // This ensures reliable message delivery without false positives
        if (normalizedOutput.uuid) {
          // Check if we already have this exact message UUID (indicates a resend)
          const isDuplicate = currentOutputs.some(existing =>
            existing.uuid === normalizedOutput.uuid
          );
          if (isDuplicate) {
            // Message already delivered - skip
            return;
          }
        }

        // Create NEW array with the new output appended (immutable update for React reactivity)
        const newOutputs = enforceOutputBufferLimits([...currentOutputs, normalizedOutput]);

        debugLog.info(`Store: ${currentOutputs.length} -> ${newOutputs.length}`, {
          agentId,
          text: normalizedOutput.text.slice(0, 60),
          isStreaming: normalizedOutput.isStreaming,
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
      let merged = [...historyMessages, ...preservedOutputs].map(normalizeOutputSize);
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
