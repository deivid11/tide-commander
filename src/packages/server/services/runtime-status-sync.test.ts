import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAllAgents = vi.hoisted(() => vi.fn(() => []));
const mockGetAgent = vi.hoisted(() => vi.fn());
const mockUpdateAgent = vi.hoisted(() => vi.fn());
const mockGetSessionActivityStatus = vi.hoisted(() => vi.fn());

vi.mock('./agent-service.js', () => ({
  getAllAgents: mockGetAllAgents,
  getAgent: mockGetAgent,
  updateAgent: mockUpdateAgent,
}));

vi.mock('../claude/session-loader.js', () => ({
  getSessionActivityStatus: mockGetSessionActivityStatus,
}));

describe('runtime-status-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('marks idle agent as detached working when orphan process has activity', async () => {
    mockGetAgent.mockReturnValue({
      id: 'a1',
      status: 'idle',
      provider: 'codex',
      sessionId: 's1',
      cwd: '/tmp/project',
    });
    mockGetSessionActivityStatus.mockResolvedValue({ isActive: true });

    const { createRuntimeStatusSync } = await import('./runtime-status-sync.js');
    const sync = createRuntimeStatusSync({
      log: { log: vi.fn(), error: vi.fn() },
      getRunnerForAgent: () => null,
      isProviderProcessRunningInCwd: vi.fn(async () => true),
      onSessionUpdate: vi.fn(),
    });

    await sync.syncAgentStatus('a1');

    expect(mockUpdateAgent).toHaveBeenCalledWith(
      'a1',
      expect.objectContaining({
        status: 'working',
        currentTask: 'Processing (detached)...',
        isDetached: true,
      })
    );
  });

  it('marks stale working agent as idle when no activity and no orphan process', async () => {
    mockGetAgent.mockReturnValue({
      id: 'a2',
      status: 'working',
      provider: 'claude',
      sessionId: 's2',
      cwd: '/tmp/project',
    });
    mockGetSessionActivityStatus.mockResolvedValue({ isActive: false });

    const { createRuntimeStatusSync } = await import('./runtime-status-sync.js');
    const sync = createRuntimeStatusSync({
      log: { log: vi.fn(), error: vi.fn() },
      getRunnerForAgent: () => null,
      isProviderProcessRunningInCwd: vi.fn(async () => false),
      onSessionUpdate: vi.fn(),
    });

    await sync.syncAgentStatus('a2');

    expect(mockUpdateAgent).toHaveBeenCalledWith(
      'a2',
      expect.objectContaining({
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
        isDetached: false,
      })
    );
  });
});

