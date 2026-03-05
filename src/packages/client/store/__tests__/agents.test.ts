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

  it('preserves fresher context data when a stale agent snapshot arrives later', () => {
    const { state, actions } = createMockStore();
    state.agents.set('agent-1', {
      ...state.agents.get('agent-1'),
      contextUsed: 174000,
      contextLimit: 258400,
      contextStats: {
        model: 'gpt-5.4',
        contextWindow: 258400,
        totalTokens: 174000,
        usedPercent: 67.3,
        categories: {
          systemPrompt: { tokens: 0, percent: 0 },
          systemTools: { tokens: 0, percent: 0 },
          messages: { tokens: 174000, percent: 67.3 },
          freeSpace: { tokens: 84400, percent: 32.7 },
          autocompactBuffer: { tokens: 0, percent: 0 },
        },
        lastUpdated: 200,
      },
    } as any);

    actions.updateAgent({
      ...state.agents.get('agent-1'),
      status: 'idle',
      contextUsed: 33649,
      contextLimit: 258400,
      contextStats: {
        model: 'gpt-5.4',
        contextWindow: 258400,
        totalTokens: 33649,
        usedPercent: 13,
        categories: {
          systemPrompt: { tokens: 0, percent: 0 },
          systemTools: { tokens: 0, percent: 0 },
          messages: { tokens: 33649, percent: 13 },
          freeSpace: { tokens: 224751, percent: 87 },
          autocompactBuffer: { tokens: 0, percent: 0 },
        },
        lastUpdated: 100,
      },
    } as any);

    const updated = state.agents.get('agent-1');
    expect(updated?.status).toBe('idle');
    expect(updated?.contextUsed).toBe(174000);
    expect(updated?.contextStats?.totalTokens).toBe(174000);
    expect(updated?.contextStats?.lastUpdated).toBe(200);
  });
});
