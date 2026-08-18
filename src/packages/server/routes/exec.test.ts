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

// Keep the route layer off the real service graph — exec only needs an agent
// lookup and secret passthrough.
const guardState = { enabled: true, agentHasSkill: true };
vi.mock('../services/index.js', () => ({
  agentService: {
    getAgent: vi.fn((id: string) => (id === 'agent-1'
      ? { id: 'agent-1', name: 'Probe', cwd: process.cwd(), class: 'developer', isBoss: false }
      : undefined)),
  },
  secretsService: {
    replaceSecrets: vi.fn((command: string) => command),
  },
  skillService: {
    getSkillsForAgent: vi.fn(() => (guardState.agentHasSkill ? [{ id: 'builtin-streaming-exec' }] : [])),
  },
}));
vi.mock('../services/system-prompt-service.js', () => ({
  isExecGuardEnabled: vi.fn(() => guardState.enabled),
}));
vi.mock('../auth/index.js', () => ({
  getAuthToken: vi.fn(() => 'tok'),
}));

import execRouter, { applyTailFilter, setBroadcast, splitTrailingTailFilter } from './exec.js';

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

describe('POST /api/exec/guard — streaming-exec guard', () => {
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

  beforeEach(() => {
    guardState.enabled = true;
    guardState.agentHasSkill = true;
  });

  async function guard(body: Record<string, unknown>) {
    const res = await fetch(`${baseUrl}/api/exec/guard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);
    return res.json() as Promise<{ allow: boolean; reason?: string; signals?: string[] }>;
  }

  it('denies a long-running direct command with a ready-to-run /api/exec curl (agent id, cwd, auth)', async () => {
    const v = await guard({ agentId: 'agent-1', cwd: '/repo', command: 'npm run build' });
    expect(v.allow).toBe(false);
    expect(v.signals).toContain('npm task/install');
    expect(v.reason).toContain('/api/exec');
    expect(v.reason).toContain('"agentId":"agent-1"');
    expect(v.reason).toContain('"cwd":"/repo"');
    expect(v.reason).toContain('X-Auth-Token: tok');
  });

  it('allows quick commands, background runs and the API itself', async () => {
    expect((await guard({ agentId: 'agent-1', command: 'git status' })).allow).toBe(true);
    expect((await guard({ agentId: 'agent-1', command: 'npm run dev', runInBackground: true })).allow).toBe(true);
    expect((await guard({ agentId: 'agent-1', command: `curl -s -X POST http://localhost:5174/api/exec -d '{}'` })).allow).toBe(true);
  });

  it('is opt-in and fail-open: guard off, unknown agent, agent without the skill, empty body → allow', async () => {
    guardState.enabled = false;
    expect((await guard({ agentId: 'agent-1', command: 'npm run build' })).allow).toBe(true);
    guardState.enabled = true;
    expect((await guard({ agentId: 'nope', command: 'npm run build' })).allow).toBe(true);
    guardState.agentHasSkill = false;
    expect((await guard({ agentId: 'agent-1', command: 'npm run build' })).allow).toBe(true);
    expect((await guard({})).allow).toBe(true);
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
