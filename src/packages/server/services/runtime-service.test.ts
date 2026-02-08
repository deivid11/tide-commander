import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAgent = vi.hoisted(() => vi.fn());
const mockUpdateAgent = vi.hoisted(() => vi.fn());
const mockGetSessionActivityStatus = vi.hoisted(() => vi.fn());
const mockIsClaudeProcessRunningInCwd = vi.hoisted(() => vi.fn());
const mockIsCodexProcessRunningInCwd = vi.hoisted(() => vi.fn());
const mockKillClaudeProcessInCwd = vi.hoisted(() => vi.fn());
const mockKillCodexProcessInCwd = vi.hoisted(() => vi.fn());
const mockRunnerStopAll = vi.hoisted(() => vi.fn(async () => {}));
const mockCreateRunner = vi.hoisted(() => vi.fn(() => ({
  run: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  stopAll: mockRunnerStopAll,
  isRunning: vi.fn(() => false),
  sendMessage: vi.fn(() => false),
  hasRecentActivity: vi.fn(() => false),
  onNextActivity: vi.fn(),
  supportsStdin: vi.fn(() => false),
})));

vi.mock('./agent-service.js', () => ({
  getAgent: mockGetAgent,
  updateAgent: mockUpdateAgent,
  getAllAgents: vi.fn(() => []),
  getAgentsToResume: vi.fn(() => []),
}));

vi.mock('../claude/session-loader.js', () => ({
  getSessionActivityStatus: mockGetSessionActivityStatus,
  isClaudeProcessRunningInCwd: mockIsClaudeProcessRunningInCwd,
  isCodexProcessRunningInCwd: mockIsCodexProcessRunningInCwd,
  killClaudeProcessInCwd: mockKillClaudeProcessInCwd,
  killCodexProcessInCwd: mockKillCodexProcessInCwd,
}));

vi.mock('../runtime/index.js', () => ({
  createClaudeRuntimeProvider: vi.fn(() => ({ createRunner: mockCreateRunner })),
  createCodexRuntimeProvider: vi.fn(() => ({ createRunner: mockCreateRunner })),
}));

describe('runtime-service codex detached behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves detached processes on default shutdown', async () => {
    const { init, shutdown } = await import('./runtime-service.js');
    init();
    await shutdown();

    expect(mockRunnerStopAll).toHaveBeenCalledWith(false);
  });

  it('marks idle codex agent as detached working when orphan process is active', async () => {
    mockGetAgent.mockReturnValue({
      id: 'agent-codex',
      provider: 'codex',
      status: 'idle',
      sessionId: 'thread-123',
      cwd: '/tmp/project',
    });
    mockGetSessionActivityStatus.mockResolvedValue({ isActive: true });
    mockIsCodexProcessRunningInCwd.mockResolvedValue(true);
    mockIsClaudeProcessRunningInCwd.mockResolvedValue(false);

    const { syncAgentStatus } = await import('./runtime-service.js');
    await syncAgentStatus('agent-codex');

    expect(mockIsCodexProcessRunningInCwd).toHaveBeenCalledWith('/tmp/project');
    expect(mockIsClaudeProcessRunningInCwd).not.toHaveBeenCalled();
    expect(mockUpdateAgent).toHaveBeenCalledWith(
      'agent-codex',
      expect.objectContaining({
        status: 'working',
        currentTask: 'Processing (detached)...',
        isDetached: true,
      })
    );
  });

  it('kills detached codex process on stopAgent', async () => {
    mockGetAgent.mockReturnValue({
      id: 'agent-codex',
      provider: 'codex',
      cwd: '/tmp/project',
    });
    mockKillCodexProcessInCwd.mockResolvedValue(true);

    const { stopAgent } = await import('./runtime-service.js');
    await stopAgent('agent-codex');

    expect(mockKillCodexProcessInCwd).toHaveBeenCalledWith('/tmp/project');
    expect(mockKillClaudeProcessInCwd).not.toHaveBeenCalled();
    expect(mockUpdateAgent).toHaveBeenCalledWith(
      'agent-codex',
      expect.objectContaining({
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
        isDetached: false,
      })
    );
  });
});
