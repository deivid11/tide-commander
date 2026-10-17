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

  describe('session_not_found', () => {
    const buildHandlers = async (emitOutput = vi.fn()) => {
      const { createRuntimeEventHandlers } = await import('./runtime-events.js');
      return createRuntimeEventHandlers({
        log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        emitEvent: vi.fn(),
        emitOutput,
        emitComplete: vi.fn(),
        emitError: vi.fn(),
        executeCommand: vi.fn(async () => {}),
      });
    };

    it('marks the agent as missing its session, instead of failing silently', async () => {
      mockGetAgent.mockReturnValue({ id: 'agent-1', name: 'Gone', provider: 'claude', sessionId: 'dead-session' });
      const handlers = await buildHandlers();

      handlers.handleEvent('agent-1', {
        type: 'error',
        errorMessage: 'No conversation found with session ID: dead-session',
        errorCode: 'session_not_found',
      });

      expect(mockUpdateAgent).toHaveBeenCalledWith('agent-1', {
        status: 'error',
        sessionMissing: { sessionId: 'dead-session', detectedAt: expect.any(Number) },
      });
    });

    it('keeps the first observation time when the same dead session fails again', async () => {
      mockGetAgent.mockReturnValue({
        id: 'agent-1',
        name: 'Gone',
        provider: 'claude',
        sessionId: 'dead-session',
        sessionMissing: { sessionId: 'dead-session', detectedAt: 12345 },
      });
      const handlers = await buildHandlers();

      handlers.handleEvent('agent-1', {
        type: 'error',
        errorMessage: 'No conversation found with session ID: dead-session',
        errorCode: 'session_not_found',
      });

      expect(mockUpdateAgent).toHaveBeenCalledWith('agent-1', {
        status: 'error',
        sessionMissing: { sessionId: 'dead-session', detectedAt: 12345 },
      });
    });

    it('leaves ordinary errors alone', async () => {
      mockGetAgent.mockReturnValue({ id: 'agent-1', name: 'Fine', provider: 'claude', sessionId: 'live-session' });
      const handlers = await buildHandlers();

      handlers.handleEvent('agent-1', { type: 'error', errorMessage: 'boom' });

      expect(mockUpdateAgent).toHaveBeenCalledWith('agent-1', { status: 'error' });
    });

    it('drops the marker once the CLI opens a session again', async () => {
      mockGetAgent.mockReturnValue({
        id: 'agent-1',
        name: 'Recovered',
        provider: 'claude',
        sessionId: 'new-session',
        sessionMissing: { sessionId: 'dead-session', detectedAt: 1 },
      });
      const handlers = await buildHandlers();

      handlers.handleEvent('agent-1', { type: 'init', sessionId: 'new-session' });

      expect(mockUpdateAgent).toHaveBeenCalledWith('agent-1', { sessionMissing: undefined });
    });

    it('keeps the marker when the failed process closes, so the banner survives the exit', async () => {
      mockGetAgent.mockReturnValue({
        id: 'agent-1',
        name: 'Gone',
        provider: 'claude',
        sessionId: 'dead-session',
        sessionMissing: { sessionId: 'dead-session', detectedAt: 1 },
      });
      const handlers = await buildHandlers();

      // The runner reports a "finished turn" (success) for the failed resume's exit.
      handlers.handleComplete('agent-1', true);
      handlers.handleComplete('agent-1', false);

      for (const [, updates] of mockUpdateAgent.mock.calls) {
        expect(updates).not.toHaveProperty('sessionMissing');
      }
    });
  });
});
