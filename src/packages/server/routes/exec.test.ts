import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import * as http from 'node:http';
import { spawnSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';

// PTY tests need util-linux `script`; skip them where it's absent (macOS CI).
const HAS_SCRIPT = (() => {
  try {
    return spawnSync('script', ['--version'], { timeout: 3000 }).status === 0;
  } catch {
    return false;
  }
})();

const pluginManagerMock = vi.hoisted(() => ({ get: vi.fn() }));
const runtimeServiceMock = vi.hoisted(() => ({ sendCommand: vi.fn() }));
const shellCommandServiceMock = vi.hoisted(() => ({
  get: vi.fn(),
  prepareArgs: vi.fn(),
  prepareExecution: vi.fn(),
  materializeScript: vi.fn(),
  openSudoCredentialChannel: vi.fn(),
}));

// Keep the route layer off the real service graph — exec only needs an agent
// lookup and secret passthrough.
vi.mock('../services/index.js', () => ({
  agentService: {
    getAgent: vi.fn((id: string) => (id === 'agent-1'
      ? { id: 'agent-1', name: 'Probe', cwd: process.cwd(), class: 'developer', isBoss: false }
      : undefined)),
  },
  secretsService: {
    replaceSecrets: vi.fn((command: string) => command),
  },
  runtimeService: runtimeServiceMock,
}));

vi.mock('../plugins/index.js', () => ({ pluginManager: pluginManagerMock }));
vi.mock('../services/plugin-shell-command-service.js', () => {
  class PluginShellCommandError extends Error {
    constructor(
      message: string,
      public readonly statusCode = 400,
      public readonly code = 'SHELL_COMMAND_ERROR',
    ) {
      super(message);
    }
  }
  return {
    pluginShellCommandService: shellCommandServiceMock,
    PluginShellCommandError,
    shellQuote: (value: string) => `'${value.replace(/'/g, `'\\''`)}'`,
  };
});

import execRouter, { applyLiteralGrepFilter, applyTailFilter, buildShellCommandAgentResult, setBroadcast, splitTrailingTailFilter, getRunningTasksSnapshot, _resetCompletedExecTasks } from './exec.js';

describe('splitTrailingTailFilter', () => {
  it('parses the common short form', () => {
    expect(splitTrailingTailFilter('npm test 2>&1 | tail -25')).toEqual({
      command: 'npm test 2>&1',
      tail: { lines: 25 },
    });
  });

  it('parses -n, -n -N and -c forms (spaces optional)', () => {
    expect(splitTrailingTailFilter('cmd | tail -n 40')).toEqual({ command: 'cmd', tail: { lines: 40 } });
    expect(splitTrailingTailFilter('cmd | tail -n -40')).toEqual({ command: 'cmd', tail: { lines: 40 } });
    expect(splitTrailingTailFilter('cmd | tail -c 3000')).toEqual({ command: 'cmd', tail: { bytes: 3000 } });
    expect(splitTrailingTailFilter('cmd|tail -5')).toEqual({ command: 'cmd', tail: { lines: 5 } });
  });

  it('strips only the LAST tail of a chain', () => {
    expect(splitTrailingTailFilter('cmd | grep x | tail -3')).toEqual({ command: 'cmd | grep x', tail: { lines: 3 } });
    expect(splitTrailingTailFilter('cmd | tail -50 | tail -3')).toEqual({ command: 'cmd | tail -50', tail: { lines: 3 } });
  });

  it('leaves non-trailing and different-semantics forms untouched', () => {
    // tail is not the final segment
    expect(splitTrailingTailFilter('cmd | tail -2 | grep foo')).toBeNull();
    // skip-first semantics is NOT last-N — must not be rewritten
    expect(splitTrailingTailFilter('cmd | tail -n +5')).toBeNull();
    // follow mode
    expect(splitTrailingTailFilter('cmd | tail -f')).toBeNull();
    // tail reading a file, no pipe
    expect(splitTrailingTailFilter('tail -5 build.log')).toBeNull();
    // the tail lives inside a quoted remote command — command ends with a quote
    expect(splitTrailingTailFilter('ssh host "make 2>&1 | tail -5"')).toBeNull();
    expect(splitTrailingTailFilter("ssh host 'make | tail -5'")).toBeNull();
    // plain commands
    expect(splitTrailingTailFilter('npm run build')).toBeNull();
  });
});

describe('applyLiteralGrepFilter', () => {
  it('filters complete lines by a literal value without shell evaluation', () => {
    expect(applyLiteralGrepFilter('ok\nerror one\nERROR\nerror $(id)\n', 'error')).toBe('error one\nerror $(id)\n');
    expect(applyLiteralGrepFilter('one\ntwo\n', 'missing')).toBe('');
  });
});

describe('buildShellCommandAgentResult', () => {
  it('creates a bounded completion message for the requesting agent', () => {
    const message = buildShellCommandAgentResult('/daisy-pcb', 0, `prefix-${'x'.repeat(13_000)}`, 1234);
    expect(message).toContain('COMMANDER_SLASH_COMMAND_RESULT');
    expect(message).toContain('Command: /daisy-pcb');
    expect(message).toContain('Exit code: 0');
    expect(message).toContain('earlier output omitted');
    expect(message).toContain('Do not rerun the command automatically');
    expect(message).not.toContain('prefix-');
    expect(message.length).toBeLessThan(13_000);
  });
});

describe('applyTailFilter', () => {
  it('keeps the last N lines, preserving the trailing newline', () => {
    expect(applyTailFilter('a\nb\nc\nd\n', { lines: 2 })).toBe('c\nd\n');
    expect(applyTailFilter('a\nb\nc\nd', { lines: 2 })).toBe('c\nd');
  });

  it('returns everything when the output is already short enough', () => {
    expect(applyTailFilter('a\nb\n', { lines: 5 })).toBe('a\nb\n');
    expect(applyTailFilter('short', { bytes: 100 })).toBe('short');
  });

  it('applies byte (char) tails', () => {
    expect(applyTailFilter('abcdefgh', { bytes: 3 })).toBe('fgh');
  });
});

describe('getRunningTasksSnapshot (WS initial state)', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/exec', execRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it('lists a running task with buffered output tail, cwd/pty and the paired toolUseId; keeps it as completed after the run', async () => {
    _resetCompletedExecTasks();
    expect(getRunningTasksSnapshot()).toEqual([]);

    // Start a slow command; snapshot it mid-flight.
    const done = fetch(`${baseUrl}/api/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-1', command: 'echo snapshot-probe; sleep 1.2', pty: false }),
    });
    await new Promise((r) => setTimeout(r, 500));

    const snapshot = getRunningTasksSnapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({
      agentId: 'agent-1',
      agentName: 'Probe',
      command: 'echo snapshot-probe; sleep 1.2',
      pty: false,
      status: 'running',
    });
    expect(typeof snapshot[0].taskId).toBe('string');
    expect(typeof snapshot[0].cwd).toBe('string');
    expect(snapshot[0].startedAt).toBeGreaterThan(0);
    expect(snapshot[0].outputTail).toContain('snapshot-probe');

    await done;
    // The finished run stays in the snapshot (bounded buffer) so a client
    // that connects AFTER a short exec still attaches the card to its row.
    const after = getRunningTasksSnapshot();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({
      agentId: 'agent-1',
      command: 'echo snapshot-probe; sleep 1.2',
      status: 'completed',
      exitCode: 0,
    });
    expect(after[0].completedAt).toBeGreaterThanOrEqual(after[0].startedAt);
    expect(after[0].outputTail).toContain('snapshot-probe');

    _resetCompletedExecTasks();
    expect(getRunningTasksSnapshot()).toEqual([]);
  });
});

describe('POST /api/exec — tail-resistant execution', () => {
  let server: http.Server;
  let baseUrl: string;
  const broadcasts: any[] = [];

  beforeAll(async () => {
    setBroadcast((msg) => broadcasts.push(msg));
    const app = express();
    app.use(express.json());
    app.use('/api/exec', execRouter);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    broadcasts.length = 0;
    vi.clearAllMocks();
    pluginManagerMock.get.mockReturnValue({ id: 'shell-commands', enabled: true });
  });

  async function exec(body: Record<string, unknown>) {
    const res = await fetch(`${baseUrl}/api/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-1', ...body }),
    });
    expect(res.status).toBe(200);
    return res.json();
  }

  function streamedOutput(): string {
    return broadcasts
      .filter((m) => m.type === 'exec_task_output')
      .map((m) => m.payload.output)
      .join('');
  }

  it('renders an inline sudo request when an agent invokes a sudo slash command', async () => {
    shellCommandServiceMock.get.mockResolvedValue({
      id: 'shell-1',
      name: '/daisy-pcb',
      summary: 'Flash Daisy PCB',
      script: 'make daisy-pcb',
      runAsSudo: true,
      pty: true,
      enabled: true,
    });
    shellCommandServiceMock.prepareArgs.mockResolvedValue({
      commandId: 'shell-1',
      invocation: '/daisy-pcb',
      args: [],
      requiresSudo: true,
      challengeId: 'challenge-1',
      expiresAt: Date.now() + 600_000,
    });

    const response = await fetch(`${baseUrl}/api/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'agent-1',
        shellCommandId: 'shell-1',
        shellArgs: [],
        grep: 'error',
        tail: 10,
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({ success: true, awaitingUserAuthorization: true, command: '/daisy-pcb' });
    expect(shellCommandServiceMock.prepareArgs).toHaveBeenCalledWith('shell-1', 'agent-1', []);
    expect(shellCommandServiceMock.prepareExecution).not.toHaveBeenCalled();
    expect(broadcasts).toContainEqual(expect.objectContaining({
      type: 'plugin_output',
      payload: expect.objectContaining({
        agentId: 'agent-1',
        output: expect.objectContaining({
          rendererId: 'shell-command-sudo-request',
          data: expect.objectContaining({
            kind: 'shell-command-sudo-request',
            challengeId: 'challenge-1',
            grep: 'error',
            tail: 10,
          }),
        }),
      }),
    }));
  });

  it('invokes the requesting agent with the result after user-authorized execution', async () => {
    const definition = {
      id: 'shell-1',
      name: '/daisy-pcb',
      summary: 'Flash Daisy PCB',
      script: 'true',
      runAsSudo: true,
      pty: false,
      enabled: true,
    };
    shellCommandServiceMock.get.mockResolvedValue(definition);
    shellCommandServiceMock.prepareExecution.mockResolvedValue({
      definition,
      invocation: '/daisy-pcb',
      args: [],
      requestedByAgent: true,
    });
    shellCommandServiceMock.materializeScript.mockResolvedValue({
      filePath: '/dev/null',
      cleanup: vi.fn(async () => undefined),
    });
    runtimeServiceMock.sendCommand.mockResolvedValue(undefined);

    const result = await exec({
      shellCommandId: 'shell-1',
      shellArgs: [],
      sudoAuthorization: 'authorized-challenge',
    });

    expect(result.exitCode).toBe(0);
    expect(runtimeServiceMock.sendCommand).toHaveBeenCalledWith(
      'agent-1',
      expect.stringContaining('Command: /daisy-pcb'),
    );
    expect(runtimeServiceMock.sendCommand).toHaveBeenCalledWith(
      'agent-1',
      expect.stringContaining('Exit code: 0'),
    );
  });

  it('applies structured literal grep then tail while preserving the full stream', async () => {
    const result = await exec({
      command: "printf 'ok\\nerror one\\nerror two\\ndone\\n'",
      grep: 'error',
      tail: 1,
    });
    expect(result.output).toBe('error two\n');
    expect(result.tailApplied).toBe(true);
    expect(streamedOutput()).toContain('ok');
    expect(streamedOutput()).toContain('done');
  });

  it('strips a trailing pipe-tail: full output streams live, response is tailed', async () => {
    const result = await exec({ command: "printf 'l1\\nl2\\nl3\\nl4\\n' | tail -2" });
    expect(result.exitCode).toBe(0);
    // The agent receives exactly what its tail asked for…
    expect(result.output).toBe('l3\nl4\n');
    expect(result.tailApplied).toBe(true);
    expect(result.fullOutputBytes).toBe(12);
    // …while the live stream (the user's exec card) carried EVERYTHING.
    expect(streamedOutput()).toContain('l1');
    expect(streamedOutput()).toContain('l4');
  });

  it('honors the explicit tail body param', async () => {
    const result = await exec({ command: "printf 'l1\\nl2\\nl3\\nl4\\n'", tail: 1 });
    expect(result.output).toBe('l4\n');
    expect(result.tailApplied).toBe(true);
    expect(streamedOutput()).toContain('l1');
  });

  it('runs untouched commands exactly as before', async () => {
    const result = await exec({ command: "printf 'x\\ny\\n'" });
    expect(result.output).toBe('x\ny\n');
    expect(result.tailApplied).toBeUndefined();
    expect(result.fullOutputBytes).toBeUndefined();
  });

  it('leaves a quoted remote tail alone (no rewrite, pipe behaves normally)', async () => {
    const result = await exec({ command: 'bash -c "printf \'a\\nb\\nc\\n\' | tail -1"' });
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('c\n');
    // The pipe ran inside the quoted subcommand — nothing was rewritten,
    // so the response equals the full (already-tailed) output.
    expect(result.tailApplied).toBeUndefined();
  });

  describe.skipIf(!HAS_SCRIPT)('PTY mode', () => {
    it('runs under a PTY by default and returns rendered text, not raw redraws', async () => {
      const result = await exec({ command: "printf 'p1\\rdone   \\x1b[K\\n'; printf '\\033[32mok\\033[0m\\n'" });
      expect(result.exitCode).toBe(0);
      // \r rewrite collapsed, erase-line applied, colors stripped
      expect(result.output).toBe('done\nok\n');
      const started = broadcasts.find((m) => m.type === 'exec_task_started');
      expect(started.payload.pty).toBe(true);
      // The live stream carried the raw PTY chunks (redraw included)
      expect(streamedOutput()).toContain('p1');
    });

    it('propagates the exit code through script(1)', async () => {
      const result = await exec({ command: 'exit 7' });
      expect(result.exitCode).toBe(7);
    });

    it('child processes see a real TTY', async () => {
      const result = await exec({ command: '[ -t 1 ] && echo IS_TTY || echo NO_TTY' });
      expect(result.output).toContain('IS_TTY');
    });

    it('pty:false keeps the legacy piped behavior', async () => {
      const result = await exec({ command: "printf 'p1\\rp2\\n'", pty: false });
      // Raw pipe output — the \r rewrite reaches the agent untouched
      expect(result.output).toBe('p1\rp2\n');
      const started = broadcasts.find((m) => m.type === 'exec_task_started');
      expect(started.payload.pty).toBe(false);
    });
  });
});
