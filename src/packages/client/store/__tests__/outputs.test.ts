/**
 * Tests for Output Store Actions
 *
 * Covers: addOutput (UUID dedup, max limit, streaming), clearOutputs,
 * getOutputs, addUserPromptToOutput, lastPrompt, preserveOutputs, mergeOutputsWithHistory
 */

import { describe, it, expect, vi } from 'vitest';
import { createOutputActions } from '../outputs';
import type { StoreState, AgentOutput } from '../types';

// Mock profiling and debug utilities
vi.mock('../../utils/profiling', () => ({
  perf: { start: vi.fn(), end: vi.fn() },
}));

vi.mock('../../services/agentDebugger', () => ({
  debugLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function createMockStore() {
  // Only the fields used by output actions - cast via unknown for test isolation
  const state = {
    agentOutputs: new Map(),
    lastPrompts: new Map(),
  } as unknown as StoreState;

  const notify = vi.fn();
  const getListenerCount = vi.fn(() => 1);

  const actions = createOutputActions(
    () => state,
    (updater) => updater(state),
    notify,
    getListenerCount
  );

  return { state, actions, notify };
}

function makeOutput(overrides: Partial<AgentOutput> = {}): AgentOutput {
  return {
    text: 'test output',
    isStreaming: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('Output Store Actions', () => {
  describe('addOutput', () => {
    it('adds output to agent', () => {
      const { state, actions } = createMockStore();
      const output = makeOutput({ text: 'Hello' });

      actions.addOutput('agent-1', output);

      const outputs = state.agentOutputs.get('agent-1');
      expect(outputs).toHaveLength(1);
      expect(outputs![0].text).toBe('Hello');
    });

    it('appends multiple outputs in order', () => {
      const { state, actions } = createMockStore();

      actions.addOutput('agent-1', makeOutput({ text: 'First' }));
      actions.addOutput('agent-1', makeOutput({ text: 'Second' }));
      actions.addOutput('agent-1', makeOutput({ text: 'Third' }));

      const outputs = state.agentOutputs.get('agent-1');
      expect(outputs).toHaveLength(3);
      expect(outputs!.map(o => o.text)).toEqual(['First', 'Second', 'Third']);
    });

    it('keeps outputs for different agents separate', () => {
      const { state, actions } = createMockStore();

      actions.addOutput('agent-1', makeOutput({ text: 'A1' }));
      actions.addOutput('agent-2', makeOutput({ text: 'A2' }));

      expect(state.agentOutputs.get('agent-1')).toHaveLength(1);
      expect(state.agentOutputs.get('agent-2')).toHaveLength(1);
      expect(state.agentOutputs.get('agent-1')![0].text).toBe('A1');
      expect(state.agentOutputs.get('agent-2')![0].text).toBe('A2');
    });

    it('notifies listeners after adding', () => {
      const { actions, notify } = createMockStore();
      actions.addOutput('agent-1', makeOutput());
      expect(notify).toHaveBeenCalled();
    });
  });

  describe('UUID deduplication', () => {
    it('skips duplicate messages with same UUID', () => {
      const { state, actions } = createMockStore();

      actions.addOutput('agent-1', makeOutput({ text: 'Hello', uuid: 'uuid-1' }));
      actions.addOutput('agent-1', makeOutput({ text: 'Hello', uuid: 'uuid-1' }));

      expect(state.agentOutputs.get('agent-1')).toHaveLength(1);
    });

    it('allows different UUIDs with same text', () => {
      const { state, actions } = createMockStore();

      actions.addOutput('agent-1', makeOutput({ text: 'Hello', uuid: 'uuid-1' }));
      actions.addOutput('agent-1', makeOutput({ text: 'Hello', uuid: 'uuid-2' }));

      expect(state.agentOutputs.get('agent-1')).toHaveLength(2);
    });

    it('allows messages without UUID (no dedup)', () => {
      const { state, actions } = createMockStore();

      actions.addOutput('agent-1', makeOutput({ text: 'Hello' }));
      actions.addOutput('agent-1', makeOutput({ text: 'Hello' }));

      expect(state.agentOutputs.get('agent-1')).toHaveLength(2);
    });

    it('does not cross-deduplicate between agents', () => {
      const { state, actions } = createMockStore();

      actions.addOutput('agent-1', makeOutput({ text: 'Hello', uuid: 'uuid-shared' }));
      actions.addOutput('agent-2', makeOutput({ text: 'Hello', uuid: 'uuid-shared' }));

      expect(state.agentOutputs.get('agent-1')).toHaveLength(1);
      expect(state.agentOutputs.get('agent-2')).toHaveLength(1);
    });
  });

  describe('output limit', () => {
    it('keeps max 200 outputs per agent', () => {
      const { state, actions } = createMockStore();

      for (let i = 0; i < 210; i++) {
        actions.addOutput('agent-1', makeOutput({ text: `msg-${i}` }));
      }

      const outputs = state.agentOutputs.get('agent-1')!;
      expect(outputs.length).toBe(200);
      // Should keep the last 200 (msg-10 through msg-209)
      expect(outputs[0].text).toBe('msg-10');
      expect(outputs[199].text).toBe('msg-209');
    });
  });

  describe('clearOutputs', () => {
    it('removes all outputs for an agent', () => {
      const { state, actions } = createMockStore();

      actions.addOutput('agent-1', makeOutput({ text: 'A' }));
      actions.addOutput('agent-1', makeOutput({ text: 'B' }));
      actions.clearOutputs('agent-1');

      expect(state.agentOutputs.get('agent-1')).toBeUndefined();
    });

    it('does not affect other agents', () => {
      const { state, actions } = createMockStore();

      actions.addOutput('agent-1', makeOutput({ text: 'A1' }));
      actions.addOutput('agent-2', makeOutput({ text: 'A2' }));
      actions.clearOutputs('agent-1');

      expect(state.agentOutputs.get('agent-1')).toBeUndefined();
      expect(state.agentOutputs.get('agent-2')).toHaveLength(1);
    });
  });

  describe('getOutputs', () => {
    it('returns outputs for agent', () => {
      const { actions } = createMockStore();

      actions.addOutput('agent-1', makeOutput({ text: 'Hello' }));
      const outputs = actions.getOutputs('agent-1');

      expect(outputs).toHaveLength(1);
      expect(outputs[0].text).toBe('Hello');
    });

    it('returns empty array for unknown agent', () => {
      const { actions } = createMockStore();
      expect(actions.getOutputs('nonexistent')).toEqual([]);
    });
  });

  describe('addUserPromptToOutput', () => {
    it('adds output with isUserPrompt flag', () => {
      const { state, actions } = createMockStore();

      actions.addUserPromptToOutput('agent-1', '/context');
      const outputs = state.agentOutputs.get('agent-1')!;

      expect(outputs).toHaveLength(1);
      expect(outputs[0].text).toBe('/context');
      expect(outputs[0].isUserPrompt).toBe(true);
      expect(outputs[0].isStreaming).toBe(false);
    });
  });

  describe('lastPrompt', () => {
    it('stores and retrieves last prompt', () => {
      const { actions } = createMockStore();

      actions.setLastPrompt('agent-1', 'fix the bug');
      const prompt = actions.getLastPrompt('agent-1');

      expect(prompt).toBeDefined();
      expect(prompt!.text).toBe('fix the bug');
      expect(prompt!.timestamp).toBeGreaterThan(0);
    });

    it('returns undefined for unknown agent', () => {
      const { actions } = createMockStore();
      expect(actions.getLastPrompt('nonexistent')).toBeUndefined();
    });

    it('overwrites previous prompt', () => {
      const { actions } = createMockStore();

      actions.setLastPrompt('agent-1', 'first');
      actions.setLastPrompt('agent-1', 'second');

      expect(actions.getLastPrompt('agent-1')!.text).toBe('second');
    });
  });

  describe('preserveOutputs', () => {
    it('creates a deep copy snapshot of all outputs', () => {
      const { state, actions } = createMockStore();

      actions.addOutput('agent-1', makeOutput({ text: 'A1' }));
      actions.addOutput('agent-2', makeOutput({ text: 'A2' }));

      const snapshot = actions.preserveOutputs();

      // Snapshot should match current state
      expect(snapshot.get('agent-1')).toHaveLength(1);
      expect(snapshot.get('agent-2')).toHaveLength(1);

      // Modifying original should not affect snapshot
      actions.addOutput('agent-1', makeOutput({ text: 'A1-extra' }));
      expect(snapshot.get('agent-1')).toHaveLength(1);
      expect(state.agentOutputs.get('agent-1')).toHaveLength(2);
    });

    it('returns empty map when no outputs exist', () => {
      const { actions } = createMockStore();
      const snapshot = actions.preserveOutputs();
      expect(snapshot.size).toBe(0);
    });
  });

  describe('mergeOutputsWithHistory', () => {
    it('merges and sorts by timestamp', () => {
      const { state, actions } = createMockStore();

      const history: AgentOutput[] = [
        makeOutput({ text: 'old', timestamp: 1000 }),
        makeOutput({ text: 'older', timestamp: 500 }),
      ];
      const preserved: AgentOutput[] = [
        makeOutput({ text: 'recent', timestamp: 2000 }),
      ];

      const merged = actions.mergeOutputsWithHistory('agent-1', history, preserved);

      expect(merged).toHaveLength(3);
      expect(merged[0].text).toBe('older');
      expect(merged[1].text).toBe('old');
      expect(merged[2].text).toBe('recent');

      // Should be stored in state
      expect(state.agentOutputs.get('agent-1')).toEqual(merged);
    });
  });
});
