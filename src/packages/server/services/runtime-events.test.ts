import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAgent = vi.hoisted(() => vi.fn());
const mockGetCodexContextSnapshotFromSession = vi.hoisted(() => vi.fn());
const mockUpdateAgent = vi.hoisted(() => vi.fn());
const mockGenerateNarrative = vi.hoisted(() => vi.fn());
const mockHandleTaskToolStart = vi.hoisted(() => vi.fn(() => true));
const mockHandleTaskToolResult = vi.hoisted(() => vi.fn());
const mockClearPendingSilentContextRefresh = vi.hoisted(() => vi.fn());
const mockConsumeStepCompleteReceived = vi.hoisted(() => vi.fn(() => false));
const mockMarkStepCompleteReceived = vi.hoisted(() => vi.fn());

vi.mock('./agent-service.js', () => ({
  getAgent: mockGetAgent,
  getCodexContextSnapshotFromSession: mockGetCodexContextSnapshotFromSession,
  updateAgent: mockUpdateAgent,
}));

vi.mock('./supervisor-service.js', () => ({
  generateNarrative: mockGenerateNarrative,
  updateGlobalUsage: vi.fn(),
}));

vi.mock('./runtime-subagents.js', () => ({
  handleTaskToolStart: mockHandleTaskToolStart,
  handleTaskToolResult: mockHandleTaskToolResult,
}));

vi.mock('./runtime-watchdog.js', () => ({
  clearPendingSilentContextRefresh: mockClearPendingSilentContextRefresh,
  consumeStepCompleteReceived: mockConsumeStepCompleteReceived,
  markStepCompleteReceived: mockMarkStepCompleteReceived,
  markPendingSilentContextRefresh: vi.fn(),
  hasPendingSilentContextRefresh: vi.fn(() => false),
}));

describe('createRuntimeEventHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCodexContextSnapshotFromSession.mockReturnValue(null);
  });

  it('uses authoritative Codex modelUsage input tokens without adding cached input tokens', async () => {
    mockGetAgent.mockReturnValue({
      id: 'agent-codex',
      name: 'Codex',
      provider: 'codex',
      codexModel: 'gpt-5-codex',
      tokensUsed: 100,
      contextUsed: 0,
      contextLimit: 200000,
      lastAssignedTask: 'Fix context tracking',
    });

    const { createRuntimeEventHandlers } = await import('./runtime-events.js');
    const handlers = createRuntimeEventHandlers({
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      emitEvent: vi.fn(),
      emitOutput: vi.fn(),
      emitComplete: vi.fn(),
      emitError: vi.fn(),
      parseUsageOutput: vi.fn(() => null),
      executeCommand: vi.fn(async () => {}),
    });

    handlers.handleEvent('agent-codex', {
      type: 'step_complete',
      tokens: { input: 1200, output: 80 },
      modelUsage: {
        contextWindow: 200000,
        inputTokens: 32000,
        outputTokens: 80,
        cacheReadInputTokens: 4000,
      },
    });

    expect(mockUpdateAgent).toHaveBeenCalledWith(
      'agent-codex',
      expect.objectContaining({
        tokensUsed: 1380,
        contextUsed: 32000,
        contextLimit: 200000,
        contextStats: expect.objectContaining({
          totalTokens: 32000,
          contextWindow: 200000,
        }),
      }),
    );
  });

  it('refreshes Codex context from session snapshot on completion', async () => {
    mockGetAgent.mockReturnValue({
      id: 'agent-codex',
      name: 'Codex',
      provider: 'codex',
      sessionId: 'session-123',
    });
    mockGetCodexContextSnapshotFromSession.mockReturnValue({
      contextUsed: 174000,
      contextLimit: 258400,
      contextStats: {
        totalTokens: 174000,
        contextWindow: 258400,
        lastUpdated: '2026-03-05T12:00:00.000Z',
        messages: 0,
        cache: 0,
        system: 0,
        tools: 0,
        files: 0,
        thinking: 0,
      },
    });

    const emitComplete = vi.fn();
    const { createRuntimeEventHandlers } = await import('./runtime-events.js');
    const handlers = createRuntimeEventHandlers({
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      emitEvent: vi.fn(),
      emitOutput: vi.fn(),
      emitComplete,
      emitError: vi.fn(),
      parseUsageOutput: vi.fn(() => null),
      executeCommand: vi.fn(async () => {}),
    });

    handlers.handleComplete('agent-codex', true);

    expect(mockGetCodexContextSnapshotFromSession).toHaveBeenCalledWith('session-123');
    expect(mockUpdateAgent).toHaveBeenCalledWith('agent-codex', {
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
      isDetached: false,
      contextUsed: 174000,
      contextLimit: 258400,
      contextStats: expect.objectContaining({
        totalTokens: 174000,
        contextWindow: 258400,
      }),
    });
    expect(emitComplete).toHaveBeenCalledWith('agent-codex', true);
  });
});
