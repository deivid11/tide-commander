/**
 * Output Store Actions
 *
 * Handles Claude output management for agents.
 */

import type { ClientMessage } from '../../shared/types';
import type { StoreState, ClaudeOutput, LastPrompt } from './types';
import { perf } from '../utils/profiling';

export interface OutputActions {
  addOutput(agentId: string, output: ClaudeOutput): void;
  clearOutputs(agentId: string): void;
  getOutputs(agentId: string): ClaudeOutput[];
  addUserPromptToOutput(agentId: string, command: string): void;
  getLastPrompt(agentId: string): LastPrompt | undefined;
  setLastPrompt(agentId: string, text: string): void;
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
      console.log(
        `[STORE] addOutput called for agent ${agentId}, isStreaming=${output.isStreaming}, textLen=${output.text.length}`
      );

      const state = getState();
      const currentOutputs = state.agentOutputs.get(agentId) || [];

      // Deduplicate delegation messages
      if (output.isDelegation) {
        const isDuplicate = currentOutputs.some(
          (existing) => existing.isDelegation && existing.text === output.text
        );
        if (isDuplicate) {
          console.log(`[STORE] Skipping duplicate delegation message for agent ${agentId}`);
          perf.end('store:addOutput');
          return;
        }
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

      const beforeNotify = performance.now();
      console.log(
        `[STORE] About to notify ${getListenerCount()} listeners, outputs count now: ${newOutputs.length}`
      );
      notify();
      const afterNotify = performance.now();
      console.log(
        `[STORE] notify() took ${(afterNotify - beforeNotify).toFixed(2)}ms, total addOutput took ${(afterNotify - startTime).toFixed(2)}ms`
      );
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
  };
}
