/**
 * Output Store Actions
 *
 * Handles Claude output management for agents.
 * Includes deduplication to prevent duplicate messages during streaming.
 */

import type { ClientMessage } from '../../shared/types';
import type { StoreState, ClaudeOutput, LastPrompt } from './types';
import { perf } from '../utils/profiling';

/**
 * Generate a unique key for an output message for deduplication.
 * Uses text content (first 200 chars) + timestamp + type flags.
 */
function getOutputKey(output: ClaudeOutput): string {
  // Use first 200 chars of text to create key (handles streaming where text grows)
  const textKey = output.text.slice(0, 200);
  // Round timestamp to nearest 500ms to handle slight timing differences
  const timeKey = Math.floor(output.timestamp / 500);
  const typeKey = `${output.isUserPrompt ? 'u' : ''}${output.isDelegation ? 'd' : ''}`;
  return `${timeKey}:${typeKey}:${textKey}`;
}

/**
 * Check if an output is a duplicate of any recent outputs.
 * Checks the last 10 outputs for duplicates.
 */
function isDuplicateOutput(output: ClaudeOutput, existingOutputs: ClaudeOutput[]): boolean {
  // Only check last 10 outputs for performance
  const recentOutputs = existingOutputs.slice(-10);
  const newKey = getOutputKey(output);

  for (const existing of recentOutputs) {
    const existingKey = getOutputKey(existing);
    if (existingKey === newKey) {
      return true;
    }

    // Also check for exact text match within a 2-second window
    if (
      existing.text === output.text &&
      Math.abs(existing.timestamp - output.timestamp) < 2000 &&
      existing.isUserPrompt === output.isUserPrompt &&
      existing.isDelegation === output.isDelegation
    ) {
      return true;
    }
  }

  return false;
}

export interface OutputActions {
  addOutput(agentId: string, output: ClaudeOutput): void;
  clearOutputs(agentId: string): void;
  getOutputs(agentId: string): ClaudeOutput[];
  addUserPromptToOutput(agentId: string, command: string): void;
  getLastPrompt(agentId: string): LastPrompt | undefined;
  setLastPrompt(agentId: string, text: string): void;
  /** Preserve current outputs before reconnect - returns snapshot to restore later */
  preserveOutputs(): Map<string, ClaudeOutput[]>;
  /** Merge preserved outputs with history, deduplicating entries */
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
      const startTime = performance.now();
      perf.start('store:addOutput');

      const state = getState();
      const currentOutputs = state.agentOutputs.get(agentId) || [];

      // Universal deduplication - check all message types
      if (isDuplicateOutput(output, currentOutputs)) {
        console.log(`[STORE] Skipping duplicate message for agent ${agentId}, text preview: "${output.text.slice(0, 50)}..."`);
        perf.end('store:addOutput');
        return;
      }

      // Create NEW array with the new output appended (immutable update for React reactivity)
      let newOutputs = [...currentOutputs, output];

      // Keep last 200 outputs per agent
      if (newOutputs.length > 200) {
        newOutputs = newOutputs.slice(1);
      }

      setState((s) => {
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
      // Return a deep copy of current outputs for preservation
      const state = getState();
      const snapshot = new Map<string, ClaudeOutput[]>();
      for (const [agentId, outputs] of state.agentOutputs) {
        // Copy the array and each output object
        snapshot.set(agentId, outputs.map(o => ({ ...o })));
      }
      return snapshot;
    },

    mergeOutputsWithHistory(
      agentId: string,
      historyMessages: ClaudeOutput[],
      preservedOutputs: ClaudeOutput[]
    ): ClaudeOutput[] {
      // Combine history (from server/file) with preserved outputs (from memory)
      // History comes first (older), then preserved outputs (newer)
      // Deduplicate by checking for duplicates

      const merged: ClaudeOutput[] = [];
      const seenKeys = new Set<string>();

      // Helper to add output if not duplicate
      const addIfNotDuplicate = (output: ClaudeOutput) => {
        const key = getOutputKey(output);
        // Also check exact text match
        const exactKey = `exact:${output.text}:${output.isUserPrompt}:${output.isDelegation}`;

        if (!seenKeys.has(key) && !seenKeys.has(exactKey)) {
          seenKeys.add(key);
          seenKeys.add(exactKey);
          merged.push(output);
        }
      };

      // Add history messages first (they're older)
      for (const msg of historyMessages) {
        addIfNotDuplicate(msg);
      }

      // Add preserved outputs - they may contain messages not yet persisted to file
      for (const msg of preservedOutputs) {
        addIfNotDuplicate(msg);
      }

      // Sort by timestamp to ensure correct order
      merged.sort((a, b) => a.timestamp - b.timestamp);

      // Update store with merged outputs
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
