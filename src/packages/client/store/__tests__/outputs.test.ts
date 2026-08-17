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
  describe('attachToolResult', () => {
    it('enriches the matching live tool card without adding a result row', () => {
      const { state, actions } = createMockStore();
      actions.addOutput('agent-1', makeOutput({
        text: 'Using tool: Grep',
        uuid: 'toolu-1',
        toolName: 'Grep',
        toolInput: { pattern: 'needle', path: 'src' },
      }));
      actions.addOutput('agent-1', makeOutput({
        text: 'Tool input: {"pattern":"needle","path":"src"}',
        uuid: 'toolu-1',
      }));

      actions.attachToolResult('agent-1', 'toolu-1', 'src/a.ts:4:needle');

      const outputs = state.agentOutputs.get('agent-1')!;
      expect(outputs).toHaveLength(2);
      expect(outputs[0].toolOutput).toBe('src/a.ts:4:needle');
      expect(outputs[1].toolOutput).toBeUndefined();
    });

    it('attaches Pi result-time unified diff enrichment to the edit card', () => {
      const { state, actions } = createMockStore();
      actions.addOutput('agent-1', makeOutput({
        text: 'Using tool: Edit',
        uuid: 'pi-edit-1',
        toolName: 'Edit',
        toolInput: { path: 'src/a.ts', file_path: 'src/a.ts', operation: 'pi-edit' },
      }));

      actions.attachToolResult('agent-1', 'pi-edit-1', 'Successfully replaced 2 blocks.', {
        path: 'src/a.ts',
        file_path: 'src/a.ts',
        operation: 'pi-edit',
        unified_diff: '@@ -1 +1 @@\n-old\n+new',
      });

      const outputs = state.agentOutputs.get('agent-1')!;
      expect(outputs).toHaveLength(1);
      expect(outputs[0].toolInput).toMatchObject({
        operation: 'pi-edit',
        unified_diff: '@@ -1 +1 @@\n-old\n+new',
      });
    });
  });

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

    it('merges streaming chunks with the same UUID', () => {
      const { state, actions } = createMockStore();

      actions.addOutput('agent-1', makeOutput({
        text: 'Hello',
        isStreaming: true,
        timestamp: 100,
        uuid: 'stream-uuid',
      }));
      actions.addOutput('agent-1', makeOutput({
        text: ' world',
        isStreaming: true,
        timestamp: 200,
        uuid: 'stream-uuid',
      }));

      const outputs = state.agentOutputs.get('agent-1')!;
      expect(outputs).toHaveLength(1);
      expect(outputs[0].text).toBe('Hello world');
      expect(outputs[0].isStreaming).toBe(true);
      expect(outputs[0].timestamp).toBe(100);
    });

    it('replaces an accumulated streaming message with its final same-UUID text', () => {
      const { state, actions } = createMockStore();

      actions.addOutput('agent-1', makeOutput({
        text: 'Hel',
        isStreaming: true,
        timestamp: 100,
        uuid: 'stream-uuid',
      }));
      actions.addOutput('agent-1', makeOutput({
        text: 'lo',
        isStreaming: true,
        timestamp: 200,
        uuid: 'stream-uuid',
      }));
      actions.addOutput('agent-1', makeOutput({
        text: 'Hello.',
        isStreaming: false,
        timestamp: 300,
        uuid: 'stream-uuid',
      }));

      const outputs = state.agentOutputs.get('agent-1')!;
      expect(outputs).toHaveLength(1);
      expect(outputs[0].text).toBe('Hello.');
      expect(outputs[0].isStreaming).toBe(false);
      expect(outputs[0].timestamp).toBe(100);
    });

    it('settles stuck thinking streams when a tool card arrives', () => {
      const { state, actions } = createMockStore();

      actions.addOutput('agent-1', makeOutput({
        text: '[thinking] plan',
        isStreaming: true,
        timestamp: 100,
        uuid: 'think-1',
      }));
      actions.addOutput('agent-1', makeOutput({
        text: 'Using tool: Bash',
        isStreaming: false,
        timestamp: 200,
        uuid: 'tool-1',
        toolName: 'Bash',
      }));

      const outputs = state.agentOutputs.get('agent-1')!;
      expect(outputs).toHaveLength(2);
      expect(outputs[0].uuid).toBe('think-1');
      expect(outputs[0].isStreaming).toBe(false);
      expect(outputs[1].toolName).toBe('Bash');
    });

    it('settleOpenStreams closes all open streams for an agent', () => {
      const { state, actions } = createMockStore();
      actions.addOutput('agent-1', makeOutput({
        text: '[thinking] a',
        isStreaming: true,
        uuid: 't1',
      }));
      actions.settleOpenStreams('agent-1');
      expect(state.agentOutputs.get('agent-1')![0].isStreaming).toBe(false);
    });

    it('allows different non-streaming tool rows with the same UUID', () => {
      const { state, actions } = createMockStore();

      actions.addOutput('agent-1', makeOutput({
        text: 'Using tool: Bash',
        uuid: 'toolu-1',
      }));
      actions.addOutput('agent-1', makeOutput({
        text: 'Tool input: {"command":"npm test"}',
        uuid: 'toolu-1',
      }));

      expect(state.agentOutputs.get('agent-1')).toHaveLength(2);
    });

    it('merges Grok early empty toolInput into full args on same Using-tool UUID', () => {
      const { state, actions } = createMockStore();
      const uuid = 'grok-early-search_replace-1';

      actions.addOutput('agent-1', makeOutput({
        text: 'Using tool: Edit',
        uuid,
        toolName: 'Edit',
        toolInput: {},
        timestamp: 100,
      }));
      // Same text + uuid, fuller toolInput — must NOT be dropped as a resend.
      actions.addOutput('agent-1', makeOutput({
        text: 'Using tool: Edit',
        uuid,
        toolName: 'Edit',
        toolInput: {
          file_path: '/tmp/a.ts',
          old_string: 'a',
          new_string: 'b',
        },
        timestamp: 200,
      }));

      const outputs = state.agentOutputs.get('agent-1')!;
      expect(outputs).toHaveLength(1);
      expect(outputs[0].text).toBe('Using tool: Edit');
      expect(outputs[0].timestamp).toBe(100);
      expect(outputs[0].toolInput).toEqual({
        file_path: '/tmp/a.ts',
        old_string: 'a',
        new_string: 'b',
      });
    });

    it('merges empty toolInput when args arrive only on the Using-tool upgrade', () => {
      const { state, actions } = createMockStore();
      const uuid = 'grok-early-read_file-1';

      actions.addOutput('agent-1', makeOutput({
        text: 'Using tool: Read',
        uuid,
        toolName: 'Read',
        toolInput: {},
      }));
      actions.addOutput('agent-1', makeOutput({
        text: 'Using tool: Read',
        uuid,
        toolName: 'Read',
        toolInput: { target_file: '/home/riven/d/tide-commander/README.md' },
      }));

      const outputs = state.agentOutputs.get('agent-1')!;
      expect(outputs).toHaveLength(1);
      expect(outputs[0].toolInput).toEqual({
        target_file: '/home/riven/d/tide-commander/README.md',
      });
    });

    it('folds full Tool input args onto an empty early Using-tool chip', () => {
      const { state, actions } = createMockStore();
      const uuid = 'grok-early-write-1';

      actions.addOutput('agent-1', makeOutput({
        text: 'Using tool: Write',
        uuid,
        toolName: 'Write',
        toolInput: {},
      }));
      actions.addOutput('agent-1', makeOutput({
        text: 'Tool input: {"target_file":"/tmp/x.ts","content":"hi"}',
        uuid,
        toolInput: { target_file: '/tmp/x.ts', content: 'hi' },
      }));

      const outputs = state.agentOutputs.get('agent-1')!;
      expect(outputs).toHaveLength(2);
      expect(outputs[0].text).toBe('Using tool: Write');
      expect(outputs[0].toolInput).toEqual({ target_file: '/tmp/x.ts', content: 'hi' });
      expect(outputs[1].text.startsWith('Tool input:')).toBe(true);
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

    it('preserves full content of large single output entries', () => {
      const { state, actions } = createMockStore();
      const hugeText = 'a'.repeat(40000); // ~80KB in UTF-16

      actions.addOutput('agent-1', makeOutput({ text: hugeText }));

      const outputs = state.agentOutputs.get('agent-1')!;
      expect(outputs).toHaveLength(1);
      expect(outputs[0].text).toBe(hugeText);
    });

    it('preserves all large outputs until the count limit is reached', () => {
      const { state, actions } = createMockStore();
      const bigChunk = 'x'.repeat(20000); // ~40KB each

      for (let i = 0; i < 40; i++) {
        actions.addOutput('agent-1', makeOutput({ text: `${i}:${bigChunk}` }));
      }

      const outputs = state.agentOutputs.get('agent-1')!;
      expect(outputs).toHaveLength(40);
      expect(outputs[0].text.startsWith('0:')).toBe(true);
      expect(outputs[outputs.length - 1].text.startsWith('39:')).toBe(true);
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

    it('marks the entry pendingEcho when requested', () => {
      const { state, actions } = createMockStore();

      actions.addUserPromptToOutput('agent-1', 'hola', { pendingEcho: true });
      const outputs = state.agentOutputs.get('agent-1')!;

      expect(outputs).toHaveLength(1);
      expect(outputs[0].pendingEcho).toBe(true);
      expect(outputs[0].isUserPrompt).toBe(true);
    });
  });

  describe('confirmUserPromptEcho', () => {
    it('confirms an exact-text pending prompt and clears the flag', () => {
      const { state, actions } = createMockStore();
      actions.addUserPromptToOutput('agent-1', 'arregla el bug', { pendingEcho: true });

      const confirmed = actions.confirmUserPromptEcho('agent-1', 'arregla el bug');

      expect(confirmed).toBe(true);
      const outputs = state.agentOutputs.get('agent-1')!;
      expect(outputs).toHaveLength(1);
      expect(outputs[0].pendingEcho).toBeUndefined();
      expect(outputs[0].text).toBe('arregla el bug');
    });

    it('adopts the server-expanded text when it wraps the raw prompt', () => {
      const { state, actions } = createMockStore();
      actions.addUserPromptToOutput('agent-1', 'revisa esto', { pendingEcho: true });

      const expanded = '<archivos_contexto>...</archivos_contexto>\n\nPetición: revisa esto';
      const confirmed = actions.confirmUserPromptEcho('agent-1', expanded);

      expect(confirmed).toBe(true);
      const outputs = state.agentOutputs.get('agent-1')!;
      expect(outputs[0].text).toBe(expanded);
      expect(outputs[0].pendingEcho).toBeUndefined();
    });

    it('resolves multiple in-flight prompts FIFO by exact text', () => {
      const { state, actions } = createMockStore();
      actions.addUserPromptToOutput('agent-1', 'primero', { pendingEcho: true });
      actions.addUserPromptToOutput('agent-1', 'segundo', { pendingEcho: true });

      expect(actions.confirmUserPromptEcho('agent-1', 'segundo')).toBe(true);

      const outputs = state.agentOutputs.get('agent-1')!;
      expect(outputs[0].pendingEcho).toBe(true); // 'primero' still pending
      expect(outputs[1].pendingEcho).toBeUndefined();
    });

    it('returns false when nothing is pending (echo from another client)', () => {
      const { state, actions } = createMockStore();
      actions.addUserPromptToOutput('agent-1', 'ya confirmado');

      expect(actions.confirmUserPromptEcho('agent-1', 'comando ajeno')).toBe(false);
      expect(state.agentOutputs.get('agent-1')).toHaveLength(1);
    });

    it('ignores pending prompts of other agents', () => {
      const { state, actions } = createMockStore();
      actions.addUserPromptToOutput('agent-1', 'mensaje', { pendingEcho: true });

      expect(actions.confirmUserPromptEcho('agent-2', 'mensaje')).toBe(false);
      expect(state.agentOutputs.get('agent-1')![0].pendingEcho).toBe(true);
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
