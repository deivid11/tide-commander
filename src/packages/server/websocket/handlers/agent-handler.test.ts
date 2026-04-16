import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/index.js', () => ({
  agentService: {
    getAgent: vi.fn(),
    updateAgent: vi.fn(),
    archiveCurrentSession: vi.fn(),
    getAgentSessionHistory: vi.fn(() => []),
  },
  runtimeService: {
    stopAgent: vi.fn(),
  },
  skillService: {},
  customClassService: {},
  bossService: {},
  permissionService: {
    cancelRequestsForAgent: vi.fn(() => []),
  },
}));

vi.mock('../../utils/index.js', () => ({
  createLogger: vi.fn(() => ({
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  })),
}));

vi.mock('../../claude/backend.js', () => ({
  ClaudeBackend: class MockClaudeBackend {},
  parseContextOutput: vi.fn(() => null),
}));

import { agentService, runtimeService } from '../../services/index.js';
import { handleClearContext } from './agent-handler.js';

describe('Agent Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clear_context resets taskLabel and session metadata', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({ id: 'agent-1', name: 'Worker' } as any);

    const ctx = {
      sendActivity: vi.fn(),
      broadcast: vi.fn(),
    } as any;

    await handleClearContext(ctx, { agentId: 'agent-1' });

    expect(runtimeService.stopAgent).toHaveBeenCalledWith('agent-1');
    expect(agentService.updateAgent).toHaveBeenCalledWith('agent-1', expect.objectContaining({
      status: 'idle',
      currentTask: undefined,
      taskLabel: undefined,
      currentTool: undefined,
      sessionId: undefined,
      tokensUsed: 0,
      contextUsed: 0,
      contextStats: undefined,
    }));
    expect(ctx.sendActivity).toHaveBeenCalledWith('agent-1', expect.stringContaining('Context cleared'));
  });
});
