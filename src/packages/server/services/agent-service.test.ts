import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoadAgents = vi.hoisted(() => vi.fn());
const mockSaveAgents = vi.hoisted(() => vi.fn());
const mockSaveAgentsAsync = vi.hoisted(() => vi.fn(async () => {}));
const mockGetDataDir = vi.hoisted(() => vi.fn(() => '/tmp/tide-data'));
const mockExistsSync = vi.hoisted(() => vi.fn(() => true));
const mockReadFileSync = vi.hoisted(() => vi.fn(() => ''));
const mockReaddirSync = vi.hoisted(() => vi.fn(() => []));
const mockGenerateId = vi.hoisted(() => vi.fn(() => 'agent-new'));

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
}));

vi.mock('../data/index.js', () => ({
  loadAgents: mockLoadAgents,
  saveAgents: mockSaveAgents,
  saveAgentsAsync: mockSaveAgentsAsync,
  getDataDir: mockGetDataDir,
}));

vi.mock('../claude/session-loader.js', () => ({
  listSessions: vi.fn(),
  getSessionSummary: vi.fn(),
  loadSession: vi.fn(),
  loadToolHistory: vi.fn(),
  searchSession: vi.fn(),
  detectSessionProvider: vi.fn(() => 'claude'),
}));

vi.mock('../claude/subagent-history-loader.js', () => ({
  loadSubagentHistory: vi.fn(),
}));

vi.mock('../utils/index.js', () => ({
  logger: {
    agent: {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  },
  createLogger: () => ({
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
  generateId: mockGenerateId,
}));

describe('agent-service context limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('');
    mockReaddirSync.mockReturnValue([]);
  });

  it('migrates persisted Codex agents to the provider default context limit', async () => {
    mockLoadAgents.mockReturnValue([
      {
        id: 'codex-legacy',
        name: 'Codex Legacy',
        class: 'default',
        status: 'idle',
        cwd: '/tmp/project',
        provider: 'codex',
        contextLimit: 200000,
      },
      {
        id: 'codex-missing',
        name: 'Codex Missing',
        class: 'default',
        status: 'idle',
        cwd: '/tmp/project',
        provider: 'codex',
      },
      {
        id: 'claude-default',
        name: 'Claude Default',
        class: 'default',
        status: 'idle',
        cwd: '/tmp/project',
        provider: 'claude',
        contextLimit: 200000,
      },
    ]);

    const agentService = await import('./agent-service.js');
    agentService.initAgents();

    expect(agentService.getAgent('codex-legacy')?.contextLimit).toBe(258400);
    expect(agentService.getAgent('codex-missing')?.contextLimit).toBe(258400);
    expect(agentService.getAgent('claude-default')?.contextLimit).toBe(200000);
  });

  it('assigns the Codex provider default context limit to new agents', async () => {
    mockLoadAgents.mockReturnValue([]);

    const agentService = await import('./agent-service.js');
    const agent = await agentService.createAgent(
      'Codex Worker',
      'default',
      '/tmp/project',
      undefined,
      undefined,
      undefined,
      'bypass',
      undefined,
      false,
      undefined,
      'gpt-5.6-luna',
      undefined,
      'codex'
    );

    expect(agent.contextLimit).toBe(258400);
    expect(agent.provider).toBe('codex');
    expect(agent.codexModel).toBe('gpt-5.6-luna');
  });

  const loadOneIdleAgent = (id: string) => {
    mockLoadAgents.mockReturnValue([
      {
        id,
        name: id,
        class: 'default',
        status: 'idle',
        cwd: '/tmp/project',
        provider: 'claude',
      },
    ]);
  };

  it('clears a stale "working" tracking status when an agent goes idle', async () => {
    loadOneIdleAgent('stuck-working');
    const agentService = await import('./agent-service.js');
    agentService.initAgents();

    // Start a turn: entering working sets trackingStatus='working'.
    const working = agentService.updateAgent('stuck-working', { status: 'working' });
    expect(working?.trackingStatus).toBe('working');

    // Process finishes without an end-of-turn PATCH → board would be stuck on 'working'.
    const updated = agentService.updateAgent('stuck-working', { status: 'idle' });

    expect(updated?.status).toBe('idle');
    expect(updated?.trackingStatus).toBeNull();
    expect(updated?.trackingStatusDetail).toBeUndefined();
    expect(updated?.trackingStatusTimestamp).toBeUndefined();
  });

  it('clears a start-of-turn "thinking" tracking status when an agent goes idle', async () => {
    loadOneIdleAgent('stuck-thinking');
    const agentService = await import('./agent-service.js');
    agentService.initAgents();

    agentService.updateAgent('stuck-thinking', { status: 'working' });
    // Start-of-turn label skill sets 'thinking'.
    agentService.updateAgent('stuck-thinking', { trackingStatus: 'thinking', trackingStatusDetail: 'planning' });

    const updated = agentService.updateAgent('stuck-thinking', { status: 'idle' });

    expect(updated?.status).toBe('idle');
    expect(updated?.trackingStatus).toBeNull();
  });

  it('preserves a meaningful end-of-turn tracking status when an agent goes idle', async () => {
    loadOneIdleAgent('needs-review');
    const agentService = await import('./agent-service.js');
    agentService.initAgents();

    agentService.updateAgent('needs-review', { status: 'working' });
    // Agent ends its turn properly with a terminal status before the process exits.
    agentService.updateAgent('needs-review', { trackingStatus: 'need-review', trackingStatusDetail: 'PR ready' });

    const updated = agentService.updateAgent('needs-review', { status: 'idle' });

    expect(updated?.status).toBe('idle');
    expect(updated?.trackingStatus).toBe('need-review');
    expect(updated?.trackingStatusDetail).toBe('PR ready');
  });

  it('does not clobber an explicit terminal tracking status set in the same idle update', async () => {
    loadOneIdleAgent('idle-with-status');
    const agentService = await import('./agent-service.js');
    agentService.initAgents();

    agentService.updateAgent('idle-with-status', { status: 'working' });

    const updated = agentService.updateAgent('idle-with-status', {
      status: 'idle',
      trackingStatus: 'can-clear-context',
    });

    expect(updated?.status).toBe('idle');
    expect(updated?.trackingStatus).toBe('can-clear-context');
  });

  it('prefers Codex estimated_token_count from the TUI log over rollout last_token_usage', async () => {
    mockLoadAgents.mockReturnValue([]);
    mockReaddirSync.mockImplementation(((rootDir: string) => {
      if (String(rootDir).includes('/sessions')) {
        return [{ isDirectory: () => false, isFile: () => true, name: 'rollout-019-session.jsonl' }];
      }
      return [];
    }) as any);
    mockReadFileSync.mockImplementation(((filePath: string) => {
      if (String(filePath).includes('rollout-019-session.jsonl')) {
        return [
          JSON.stringify({
            payload: {
              type: 'task_started',
              model_context_window: 258400,
            },
          }),
          JSON.stringify({
            payload: {
              type: 'token_count',
              info: {
                model_context_window: 258400,
                last_token_usage: {
                  input_tokens: 33649,
                },
              },
            },
          }),
        ].join('\n');
      }

      if (String(filePath).includes('codex-tui.log')) {
        return '2026-03-05T19:50:01Z INFO session_loop{thread_id=019-session}: codex_core::codex: post sampling token usage turn_id=abc total_usage_tokens=182167 estimated_token_count=Some(174000) auto_compact_limit=244800 token_limit_reached=false needs_follow_up=false\n';
      }

      return '';
    }) as any);

    const agentService = await import('./agent-service.js');
    expect(agentService.getCodexContextSnapshotFromSession('019-session')).toEqual({
      contextUsed: 174000,
      contextLimit: 258400,
    });
  });
});
