import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAllAgents = vi.hoisted(() => vi.fn(() => [] as Array<{ status: string }>));
const mockFetchLatest = vi.hoisted(() => vi.fn(async () => '2.0.0'));
const mockRunUpdate = vi.hoisted(() => vi.fn(async () => ({
  exitCode: 0, signal: null, stdout: '', stderr: '', permissionDenied: false,
})));
const mockScheduleRestart = vi.hoisted(() => vi.fn(() => true));
const mockIsSupported = vi.hoisted(() => vi.fn(() => true));

// In-memory settings file so ticks see the persisted enabled flag.
const files = vi.hoisted(() => new Map<string, string>());

vi.mock('fs', () => ({
  existsSync: (p: unknown) => files.has(String(p)),
  readFileSync: (p: unknown) => {
    const content = files.get(String(p));
    if (content === undefined) throw new Error('ENOENT');
    return content;
  },
  writeFileSync: (p: unknown, data: unknown) => { files.set(String(p), String(data)); },
  mkdirSync: () => {},
}));

vi.mock('../../shared/version.js', () => ({
  fetchLatestNpmVersion: mockFetchLatest,
  getVersionRelation: (current: string, latest: string) => (current === latest ? 'equal' : 'behind'),
}));

vi.mock('./agent-service.js', () => ({
  getAllAgents: mockGetAllAgents,
}));

vi.mock('./self-update-service.js', async (importOriginal) => {
  // Real lock implementation, mocked I/O around it.
  const actual = await importOriginal<typeof import('./self-update-service.js')>();
  return {
    isUpdateInProgress: actual.isUpdateInProgress,
    tryBeginUpdate: actual.tryBeginUpdate,
    endUpdate: actual.endUpdate,
    getInstallInfo: vi.fn(() => ({ currentVersion: '1.0.0', reason: 'test' })),
    isAutoUpdateSupported: mockIsSupported,
    runNpmGlobalUpdate: mockRunUpdate,
    schedulePostUpdateRestart: mockScheduleRestart,
  };
});

vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import {
  __resetAutoUpdateStateForTests,
  getAutoUpdateStatus,
  setAutoUpdateEnabled,
  shutdownAutoUpdateService,
} from './auto-update-service.js';
import { endUpdate, tryBeginUpdate } from './self-update-service.js';

// The scheduler's first check after enabling fires 60s later.
const ENABLE_DELAY_MS = 60_000;

// Mutable fleet the getAllAgents mock reads — avoids mockReturnValueOnce
// bookkeeping (status calls also invoke getAllAgents for the busy count).
let agents: Array<{ status: string }> = [];

async function enableAndTick(): Promise<void> {
  setAutoUpdateEnabled(true);
  await vi.advanceTimersByTimeAsync(ENABLE_DELAY_MS);
}

describe('auto-update-service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    files.clear();
    agents = [];
    mockGetAllAgents.mockImplementation(() => agents);
    mockFetchLatest.mockResolvedValue('2.0.0');
    mockRunUpdate.mockResolvedValue({ exitCode: 0, signal: null, stdout: '', stderr: '', permissionDenied: false });
    mockScheduleRestart.mockReturnValue(true);
    mockIsSupported.mockReturnValue(true);
    endUpdate();
    __resetAutoUpdateStateForTests();
  });

  afterEach(() => {
    setAutoUpdateEnabled(false);
    shutdownAutoUpdateService();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('is disabled by default', () => {
    expect(getAutoUpdateStatus().enabled).toBe(false);
  });

  it('updates and restarts when a new version exists and all agents are idle', async () => {
    await enableAndTick();
    expect(mockRunUpdate).toHaveBeenCalledTimes(1);
    expect(mockScheduleRestart).toHaveBeenCalledTimes(1);
  });

  it('does not install while an agent is working', async () => {
    agents = [{ status: 'working' }];
    await enableAndTick();
    expect(mockRunUpdate).not.toHaveBeenCalled();
    expect(mockScheduleRestart).not.toHaveBeenCalled();
  });

  it('defers the restart when an agent starts working mid-install, then restarts once idle', async () => {
    // Fleet is idle at the pre-install gate; an agent starts working DURING
    // the npm install, so the post-install re-check must defer the restart.
    mockRunUpdate.mockImplementation(async () => {
      agents = [{ status: 'working' }];
      return { exitCode: 0, signal: null, stdout: '', stderr: '', permissionDenied: false };
    });
    await enableAndTick();
    expect(mockRunUpdate).toHaveBeenCalledTimes(1);
    expect(mockScheduleRestart).not.toHaveBeenCalled();
    expect(getAutoUpdateStatus().pendingRestartVersion).toBe('2.0.0');

    // The pending-restart retry fires a minute later; fleet is idle now.
    agents = [];
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockScheduleRestart).toHaveBeenCalledTimes(1);
    expect(getAutoUpdateStatus().pendingRestartVersion).toBeNull();
  });

  it('does nothing when already up to date', async () => {
    mockFetchLatest.mockResolvedValue('1.0.0');
    await enableAndTick();
    expect(mockRunUpdate).not.toHaveBeenCalled();
  });

  it('skips when a manual update holds the lock', async () => {
    expect(tryBeginUpdate()).toBe(true); // simulate the SSE route mid-update
    await enableAndTick();
    expect(mockRunUpdate).not.toHaveBeenCalled();
    endUpdate();
  });

  it('gives up on a version after 3 failed installs', async () => {
    mockRunUpdate.mockResolvedValue({ exitCode: 1, signal: null, stdout: '', stderr: '', permissionDenied: false });
    await enableAndTick();
    await vi.advanceTimersByTimeAsync(30 * 60_000); // next interval ticks
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(mockRunUpdate).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30 * 60_000); // 4th tick: version blacklisted
    expect(mockRunUpdate).toHaveBeenCalledTimes(3);
    expect(mockScheduleRestart).not.toHaveBeenCalled();
  });

  it('stops checking when disabled again', async () => {
    await enableAndTick();
    expect(mockRunUpdate).toHaveBeenCalledTimes(1);
    setAutoUpdateEnabled(false);
    await vi.advanceTimersByTimeAsync(3 * 30 * 60_000);
    expect(mockRunUpdate).toHaveBeenCalledTimes(1);
  });
});
