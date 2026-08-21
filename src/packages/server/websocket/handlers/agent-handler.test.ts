import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/index.js', () => ({
  agentService: {
    getAgent: vi.fn(),
    updateAgent: vi.fn(),
    archiveCurrentSession: vi.fn(),
    getAgentSessionHistory: vi.fn(() => []),
    sanitizeModelForProvider: vi.fn((_provider, model) => model),
    sanitizeCodexModel: vi.fn((model) => model),
    sanitizeOpencodeModel: vi.fn((model) => model),
    sanitizeGrokModel: vi.fn((model) => model),
    sanitizePiModel: vi.fn((model) => typeof model === 'string' && model.trim() ? model.trim() : undefined),
    resolvePiModelContextLimit: vi.fn(async () => 272000),
  },
  runtimeService: {
    stopAgent: vi.fn(),
    switchAgentModel: vi.fn(async () => false),
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

vi.mock('../../claude/session-loader.js', () => ({
  detectSessionProvider: vi.fn(() => 'claude'),
}));

import { agentService, runtimeService, skillService } from '../../services/index.js';
import { detectSessionProvider } from '../../claude/session-loader.js';
import { consumeInstructionsDirty } from '../../services/instruction-refresh.js';
import { handleClearContext, handleRestoreSession, handleUpdateAgentProperties } from './agent-handler.js';

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

  it('switches a Pi model provider in place without stopping its session', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'agent-pi',
      name: 'Portable',
      provider: 'pi',
      piModel: 'anthropic/claude-sonnet-4-5',
      effort: 'high',
      sessionId: 'pi-session',
      class: 'scout',
      permissionMode: 'bypass',
      cwd: '/tmp/project',
      contextLimit: 1_000_000,
      useChrome: false,
    } as any);
    vi.mocked(runtimeService.switchAgentModel).mockResolvedValue(true);

    const ctx = {
      sendActivity: vi.fn(),
      sendError: vi.fn(),
      broadcast: vi.fn(),
    } as any;

    await handleUpdateAgentProperties(ctx, {
      agentId: 'agent-pi',
      updates: { piModel: 'openai-codex/gpt-5.6-sol' },
    });

    expect(runtimeService.switchAgentModel).toHaveBeenCalledWith(
      'agent-pi',
      'openai-codex/gpt-5.6-sol',
      'high',
    );
    expect(runtimeService.stopAgent).not.toHaveBeenCalled();
    expect(agentService.updateAgent).toHaveBeenCalledWith(
      'agent-pi',
      expect.objectContaining({
        piModel: 'openai-codex/gpt-5.6-sol',
        piModelProvider: 'openai-codex',
        contextLimit: 272000,
      }),
      false,
    );
    expect(ctx.sendActivity).toHaveBeenCalledWith(
      'agent-pi',
      expect.stringContaining('context preserved'),
    );
  });

  it('keeps the previous Pi model when the live switch is rejected', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'agent-pi',
      name: 'Portable',
      provider: 'pi',
      piModel: 'anthropic/claude-sonnet-4-5',
      piModelProvider: 'anthropic',
      effort: 'high',
      sessionId: 'pi-session',
      class: 'scout',
      permissionMode: 'bypass',
      cwd: '/tmp/project',
      contextLimit: 1_000_000,
      contextStats: { contextWindow: 1_000_000 },
      useChrome: false,
    } as any);
    vi.mocked(runtimeService.switchAgentModel).mockRejectedValue(new Error('Model not found'));

    const ctx = {
      sendActivity: vi.fn(),
      sendError: vi.fn(),
      broadcast: vi.fn(),
    } as any;

    await handleUpdateAgentProperties(ctx, {
      agentId: 'agent-pi',
      updates: { piModel: 'openai-codex/not-available' },
    });

    expect(runtimeService.stopAgent).not.toHaveBeenCalled();
    expect(agentService.updateAgent).toHaveBeenLastCalledWith(
      'agent-pi',
      expect.objectContaining({
        piModel: 'anthropic/claude-sonnet-4-5',
        piModelProvider: 'anthropic',
        contextLimit: 1_000_000,
      }),
      false,
    );
    expect(ctx.sendActivity).toHaveBeenCalledWith(
      'agent-pi',
      expect.stringContaining('keeping anthropic/claude-sonnet-4-5'),
    );
  });

  it('refuses to reuse a native session id when changing directly to Pi', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'agent-native',
      name: 'Native',
      provider: 'claude',
      sessionId: 'claude-session',
      class: 'builder',
      permissionMode: 'bypass',
      cwd: '/workspace/project',
    } as any);
    const ctx = { sendActivity: vi.fn(), sendError: vi.fn(), broadcast: vi.fn() } as any;

    await handleUpdateAgentProperties(ctx, {
      agentId: 'agent-native',
      updates: { provider: 'pi', piModel: 'anthropic/claude-sonnet-5' },
    });

    expect(ctx.sendError).toHaveBeenCalledWith(expect.stringContaining('Convert to Pi'));
    expect(agentService.updateAgent).not.toHaveBeenCalled();
    expect(runtimeService.stopAgent).not.toHaveBeenCalled();
  });

  it('refuses any cross-runtime change that would resume a foreign session (Claude → Codex)', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'agent-native',
      name: 'Native',
      provider: 'claude',
      sessionId: 'claude-session',
      class: 'builder',
      permissionMode: 'bypass',
      cwd: '/workspace/project',
    } as any);
    const ctx = { sendActivity: vi.fn(), sendError: vi.fn(), broadcast: vi.fn() } as any;

    await handleUpdateAgentProperties(ctx, {
      agentId: 'agent-native',
      updates: { provider: 'codex', codexModel: 'gpt-5.6-luna' },
    });

    expect(ctx.sendError).toHaveBeenCalledWith(expect.stringContaining('Convert to Codex'));
    expect(agentService.updateAgent).not.toHaveBeenCalled();
    expect(runtimeService.stopAgent).not.toHaveBeenCalled();
  });

  it('allows a runtime change when the agent has no session to migrate', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'agent-fresh',
      name: 'Fresh',
      provider: 'pi',
      sessionId: undefined,
      class: 'builder',
      permissionMode: 'bypass',
      cwd: '/workspace/project',
    } as any);
    const ctx = { sendActivity: vi.fn(), sendError: vi.fn(), broadcast: vi.fn() } as any;

    await handleUpdateAgentProperties(ctx, {
      agentId: 'agent-fresh',
      updates: { provider: 'grok' },
    });

    expect(ctx.sendError).not.toHaveBeenCalled();
    expect(agentService.updateAgent).toHaveBeenCalledWith(
      'agent-fresh',
      expect.objectContaining({ provider: 'grok' }),
      false,
    );
  });

  it('restores the archived native provider when rolling back a Pi transfer', async () => {
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: 'agent-pi',
      name: 'Portable',
      provider: 'pi',
      sessionId: 'pi-session',
      cwd: '/workspace/project',
    } as any);
    vi.mocked(detectSessionProvider).mockReturnValue('grok');
    const ctx = { sendActivity: vi.fn(), sendError: vi.fn(), broadcast: vi.fn() } as any;

    await handleRestoreSession(ctx, {
      agentId: 'agent-pi',
      sessionId: 'grok-source-session',
    });

    expect(agentService.archiveCurrentSession).toHaveBeenCalledWith('agent-pi');
    expect(runtimeService.stopAgent).toHaveBeenCalledWith('agent-pi');
    expect(agentService.updateAgent).toHaveBeenCalledWith(
      'agent-pi',
      expect.objectContaining({
        provider: 'grok',
        sessionId: 'grok-source-session',
        piModelProvider: undefined,
      }),
    );
  });

  it('marks resumed Pi instructions dirty when direct skills are reassigned', async () => {
    const agentId = 'agent-pi-skill-refresh';
    // Ensure no flag leaked from another test before asserting the transition.
    expect(consumeInstructionsDirty(agentId)).toBe(false);
    vi.mocked(agentService.getAgent).mockReturnValue({
      id: agentId,
      name: 'Portable',
      provider: 'pi',
      sessionId: 'pi-session',
      class: 'scout',
      permissionMode: 'bypass',
      cwd: '/tmp/project',
      useChrome: false,
    } as any);
    vi.mocked(skillService.getSkillsForAgent).mockReturnValue([{
      id: 'old-skill',
      assignedAgentIds: [agentId],
    }] as any);
    const ctx = { sendActivity: vi.fn(), sendError: vi.fn(), broadcast: vi.fn() } as any;

    await handleUpdateAgentProperties(ctx, {
      agentId,
      updates: { skillIds: ['new-skill'] },
    });

    expect(skillService.unassignSkillFromAgent).toHaveBeenCalledWith('old-skill', agentId);
    expect(skillService.assignSkillToAgent).toHaveBeenCalledWith('new-skill', agentId);
    expect(runtimeService.stopAgent).toHaveBeenCalledWith(agentId);
    expect(consumeInstructionsDirty(agentId)).toBe(true);
    // The refresh is one-shot; later turns should not duplicate the skill block.
    expect(consumeInstructionsDirty(agentId)).toBe(false);
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
