import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * getAgentRuntimeProcessInfoBatch must resolve N agents with ONE persisted-file
 * read and ONE process snapshot. The per-agent form used to re-read the
 * crash-recovery JSON and spawn `ps aux | grep` + `readlink` per agent, which
 * with ~180 agents made a single /api/perf poll take ~30 s of event-loop-
 * blocking work and flooded the log with "Loaded N running process records".
 */

const mockGetAgent = vi.hoisted(() => vi.fn());
const mockSnapshotProviderProcesses = vi.hoisted(() => vi.fn());
const mockLoadRunningProcesses = vi.hoisted(() => vi.fn());
const mockIsProcessRunning = vi.hoisted(() => vi.fn());
const mockGetActiveProcessesState = vi.hoisted(() => vi.fn(() => [] as Array<{ agentId: string; pid?: number }>));
const mockCreateRunner = vi.hoisted(() => vi.fn(() => ({
  run: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
  stopAll: vi.fn(async () => {}),
  isRunning: vi.fn(() => false),
  sendMessage: vi.fn(() => false),
  hasRecentActivity: vi.fn(() => false),
  onNextActivity: vi.fn(),
  supportsStdin: vi.fn(() => false),
  getActiveProcessesState: mockGetActiveProcessesState,
})));

vi.mock('./agent-service.js', () => ({
  getAgent: mockGetAgent,
  updateAgent: vi.fn(),
  getAllAgents: vi.fn(() => []),
}));

vi.mock('../claude/session-loader.js', () => ({
  getSessionActivityStatus: vi.fn(),
  isClaudeProcessRunningInCwd: vi.fn(),
  isCodexProcessRunningInCwd: vi.fn(),
  isOpencodeProcessRunningInCwd: vi.fn(),
  isGrokProcessRunningInCwd: vi.fn(),
  isPiProcessRunningInCwd: vi.fn(),
  killClaudeProcessInCwd: vi.fn(),
  killCodexProcessInCwd: vi.fn(),
  killOpencodeProcessInCwd: vi.fn(),
  killGrokProcessInCwd: vi.fn(),
  killPiProcessInCwd: vi.fn(),
  snapshotProviderProcesses: mockSnapshotProviderProcesses,
}));

// Partial mock: init() starts real runners whose recovery store uses the other
// data exports (sandboxed to a temp XDG_DATA_HOME by src/test-setup.ts).
vi.mock('../data/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../data/index.js')>();
  return {
    ...actual,
    loadRunningProcesses: mockLoadRunningProcesses,
    isProcessRunning: mockIsProcessRunning,
  };
});

vi.mock('../runtime/index.js', () => ({
  createClaudeRuntimeProvider: vi.fn(() => ({ createRunner: mockCreateRunner })),
  createCodexRuntimeProvider: vi.fn(() => ({ createRunner: mockCreateRunner })),
  createOpencodeRuntimeProvider: vi.fn(() => ({ createRunner: mockCreateRunner })),
  createGrokRuntimeProvider: vi.fn(() => ({ createRunner: mockCreateRunner })),
  createPiRuntimeProvider: vi.fn(() => ({ createRunner: mockCreateRunner })),
}));

const AGENTS: Record<string, { id: string; provider?: string; cwd?: string }> = {
  'a-active': { id: 'a-active', provider: 'claude', cwd: '/work/active' },
  'a-persisted': { id: 'a-persisted', provider: 'claude', cwd: '/work/persisted' },
  'a-discovered': { id: 'a-discovered', provider: 'codex', cwd: '/work/discovered/' },
  'a-wrong-provider': { id: 'a-wrong-provider', provider: 'grok', cwd: '/work/discovered' },
  'a-none': { id: 'a-none', provider: 'claude', cwd: '/work/none' },
};

describe('getAgentRuntimeProcessInfoBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgent.mockImplementation((id: string) => AGENTS[id]);
    mockGetActiveProcessesState.mockReturnValue([{ agentId: 'a-active', pid: 111 }]);
    mockLoadRunningProcesses.mockReturnValue([
      { agentId: 'a-persisted', pid: 222, startTime: 0 },
      { agentId: 'a-none', pid: 999, startTime: 0 }, // dead PID → falls through
    ]);
    mockIsProcessRunning.mockImplementation((pid: number) => pid !== 999);
    mockSnapshotProviderProcesses.mockResolvedValue([
      { pid: 333, provider: 'codex', cwd: '/work/discovered' },
      { pid: 444, provider: 'claude', cwd: null },
    ]);
  });

  it('resolves active, persisted, discovered and unknown agents with one snapshot and one persisted read', async () => {
    const { init, getAgentRuntimeProcessInfoBatch } = await import('./runtime-service.js');
    init();
    // init() starts the runners, whose recovery store reads the persisted file
    // on its own — only count what the batch resolver itself does.
    mockLoadRunningProcesses.mockClear();
    mockSnapshotProviderProcesses.mockClear();

    const ids = ['a-active', 'a-persisted', 'a-discovered', 'a-wrong-provider', 'a-none', 'a-missing'];
    const infos = await getAgentRuntimeProcessInfoBatch(ids);

    expect(infos).toEqual([
      { pid: 111, isRunning: true, source: 'active' },
      { pid: 222, isRunning: true, source: 'persisted' },
      { pid: 333, isRunning: true, source: 'discovered' }, // trailing slash in agent cwd ignored
      { isRunning: false, source: 'none' }, // same cwd, different provider
      { isRunning: false, source: 'none' }, // persisted PID is dead, no live process in cwd
      { isRunning: false, source: 'none' }, // unknown agent
    ]);

    expect(mockSnapshotProviderProcesses).toHaveBeenCalledTimes(1);
    expect(mockLoadRunningProcesses).toHaveBeenCalledTimes(1);
  });

  it('skips the process snapshot entirely when every agent is resolved in memory or from the persisted file', async () => {
    const { init, getAgentRuntimeProcessInfoBatch } = await import('./runtime-service.js');
    init();
    mockSnapshotProviderProcesses.mockClear();

    const infos = await getAgentRuntimeProcessInfoBatch(['a-active', 'a-persisted']);

    expect(infos.map((i) => i.source)).toEqual(['active', 'persisted']);
    expect(mockSnapshotProviderProcesses).not.toHaveBeenCalled();
  });

  it('getAgentRuntimeProcessInfo stays a thin wrapper over the batch resolver', async () => {
    const { init, getAgentRuntimeProcessInfo } = await import('./runtime-service.js');
    init();

    await expect(getAgentRuntimeProcessInfo('a-discovered')).resolves.toEqual({
      pid: 333,
      isRunning: true,
      source: 'discovered',
    });
    await expect(getAgentRuntimeProcessInfo('a-missing')).resolves.toEqual({ isRunning: false, source: 'none' });
  });
});
