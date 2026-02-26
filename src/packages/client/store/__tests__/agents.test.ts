import { describe, expect, it, vi } from 'vitest';
import { createAgentActions } from '../agents';
import type { StoreState } from '../types';

vi.mock('../../utils/profiling', () => ({
  perf: { start: vi.fn(), end: vi.fn() },
}));

vi.mock('../persistence', () => ({
  saveSnapshot: vi.fn(),
  loadSnapshot: vi.fn(),
}));

vi.mock('../outputMerge', () => ({
  mergeOutputsWithHistory: vi.fn(),
}));

vi.mock('../../utils/storage', () => ({
  apiUrl: vi.fn(() => ''),
  authFetch: vi.fn(),
}));

vi.mock('../history', () => ({
  recordHistoryPoint: vi.fn(),
}));

vi.mock('../../components/ClaudeOutputPanel/useHistoryLoader', () => ({
  evictHistoryCache: vi.fn(),
}));

function createMockStore() {
  const state = {
    agents: new Map([
      ['agent-1', {
        id: 'agent-1',
        name: 'Agent One',
        class: 'default',
        status: 'working',
        currentTask: 'Task',
        taskLabel: 'Do thing',
        lastAssignedTask: 'Assigned',
        lastAssignedTaskTime: Date.now(),
        sessionId: 'session-1',
        tokensUsed: 123,
        contextUsed: 456,
      }],
    ]),
    agentOutputs: new Map([
      ['agent-1', [{ text: 'out', isStreaming: false, timestamp: Date.now() }]],
    ]),
    lastPrompts: new Map([
      ['agent-1', { text: 'last input', timestamp: Date.now() }],
    ]),
  } as unknown as StoreState;

  const notify = vi.fn();
  const sendMessage = vi.fn();

  const actions = createAgentActions(
    () => state,
    (updater) => updater(state),
    notify,
    () => sendMessage
  );

  return { state, actions, notify, sendMessage };
}

describe('Agent Store Actions', () => {
  it('clearContext clears outputs and last prompt for agent', () => {
    const { state, actions, sendMessage } = createMockStore();

    actions.clearContext('agent-1');

    const updated = state.agents.get('agent-1');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'clear_context',
      payload: { agentId: 'agent-1' },
    });
    expect(updated?.taskLabel).toBeUndefined();
    expect(updated?.currentTask).toBeUndefined();
    expect(updated?.lastAssignedTask).toBeUndefined();
    expect(updated?.contextUsed).toBe(0);
    expect(state.agentOutputs.get('agent-1')).toBeUndefined();
    expect(state.lastPrompts.get('agent-1')).toBeUndefined();
  });
});
