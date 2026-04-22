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
  skillService: {
    assignSkillToAgent: vi.fn(),
    unassignSkillFromAgent: vi.fn(),
    removeAgentFromAllSkills: vi.fn(),
    getSkillsForAgent: vi.fn(() => []),
  },
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

import { agentService, runtimeService, skillService } from '../../services/index.js';
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

  it('clear_context preserves skill assignments (regression: skills must survive context clearing)', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({ id: 'agent-1', name: 'Worker' } as any);

    const ctx = {
      sendActivity: vi.fn(),
      broadcast: vi.fn(),
    } as any;

    await handleClearContext(ctx, { agentId: 'agent-1' });

    expect(skillService.assignSkillToAgent).not.toHaveBeenCalled();
    expect(skillService.unassignSkillFromAgent).not.toHaveBeenCalled();
    expect(skillService.removeAgentFromAllSkills).not.toHaveBeenCalled();

    const updateCall = vi.mocked(agentService.updateAgent).mock.calls[0];
    const updates = updateCall?.[1] as Record<string, unknown> | undefined;
    expect(updates).toBeDefined();
    expect(updates).not.toHaveProperty('skillIds');
    expect(updates).not.toHaveProperty('class');
  });
});
