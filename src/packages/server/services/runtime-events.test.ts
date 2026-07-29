import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAgent = vi.hoisted(() => vi.fn());
const mockGetCodexContextSnapshotFromSession = vi.hoisted(() => vi.fn());
const mockUpdateAgent = vi.hoisted(() => vi.fn());
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

vi.mock('./runtime-subagents.js', () => ({
  handleTaskToolStart: mockHandleTaskToolStart,
  handleTaskToolResult: mockHandleTaskToolResult,
  addPendingBackgroundTask: vi.fn(),
  resolvePendingBackgroundTask: vi.fn(() => false),
  resolvePendingBackgroundTaskByTaskId: vi.fn(() => false),
  hasPendingBackgroundTasks: vi.fn(() => false),
  clearPendingBackgroundTasks: vi.fn(),
  getActiveSubagentByToolUseId: vi.fn(() => undefined),
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

  // A Claude usage_snapshot is one request's prompt size, never a cumulative
  // session total, so overflowing the tracked window means the window is stale
  // (it is only learned at end of turn, and a turn that also billed Haiku used
  // to report Haiku's 200k). Dropping the reading and zeroing contextUsed made
  // the meter collapse to 0k mid-conversation.
  it('widens a stale Claude context limit instead of zeroing the tracked tokens', async () => {
    mockGetAgent.mockReturnValue({
      id: 'agent-claude',
      name: 'Claude',
      provider: 'claude',
      model: 'claude-opus-5',
      tokensUsed: 0,
      contextUsed: 463_500,
      contextLimit: 200_000, // stale: learned from a turn that also billed Haiku
    });

    const { createRuntimeEventHandlers } = await import('./runtime-events.js');
    const handlers = createRuntimeEventHandlers({
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
      emitEvent: vi.fn(),
      emitOutput: vi.fn(),
      emitComplete: vi.fn(),
      emitError: vi.fn(),
      executeCommand: vi.fn(async () => {}),
    });

    handlers.handleEvent('agent-claude', {
      type: 'usage_snapshot',
      tokens: { input: 2, output: 40, cacheRead: 460_000, cacheCreation: 5_000 },
    });

    expect(mockUpdateAgent).toHaveBeenCalledWith(
      'agent-claude',
      expect.objectContaining({
        contextUsed: 465_002,
        contextLimit: 1_000_000,
      }),
      false,
    );
    expect(mockUpdateAgent).not.toHaveBeenCalledWith(
      'agent-claude',
      expect.objectContaining({ contextUsed: 0 }),
      expect.anything(),
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
