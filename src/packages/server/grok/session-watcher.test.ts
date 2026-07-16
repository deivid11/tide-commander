import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  normalizeGrokToolName,
  encodeGrokProjectKey,
  JsonlTailer,
  startGrokSessionWatcher,
  readGrokSignalsUsage,
} from './session-watcher.js';
import type { StandardEvent } from '../claude/types.js';

describe('normalizeGrokToolName', () => {
  it('maps grok tool ids to Tide UI names', () => {
    expect(normalizeGrokToolName('list_dir')).toBe('ListFiles');
    expect(normalizeGrokToolName('read_file')).toBe('Read');
    expect(normalizeGrokToolName('search_replace')).toBe('Edit');
    expect(normalizeGrokToolName('run_terminal_cmd')).toBe('Bash');
    expect(normalizeGrokToolName('grep')).toBe('Grep');
  });

  it('passes through unknown names', () => {
    expect(normalizeGrokToolName('custom_tool')).toBe('custom_tool');
  });
});

describe('encodeGrokProjectKey', () => {
  it('url-encodes absolute paths like the CLI', () => {
    expect(encodeGrokProjectKey('/tmp')).toBe('%2Ftmp');
    expect(encodeGrokProjectKey('/home/riven/d/tide-commander')).toBe(
      '%2Fhome%2Friven%2Fd%2Ftide-commander'
    );
  });
});

describe('JsonlTailer', () => {
  let tmpFile: string;

  beforeEach(() => {
    tmpFile = path.join(os.tmpdir(), `tide-jsonl-tail-${Date.now()}.jsonl`);
    fs.writeFileSync(tmpFile, '{"type":"old"}\n', 'utf8');
  });

  afterEach(() => {
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  });

  it('starts at EOF and only reads new lines', () => {
    const lines: unknown[] = [];
    const tailer = new JsonlTailer(tmpFile, (o) => lines.push(o));
    tailer.initAtEof();
    tailer.poll();
    expect(lines).toEqual([]);

    fs.appendFileSync(tmpFile, '{"type":"new","n":1}\n{"type":"new","n":2}\n', 'utf8');
    tailer.poll();
    expect(lines).toEqual([
      { type: 'new', n: 1 },
      { type: 'new', n: 2 },
    ]);
  });
});

describe('startGrokSessionWatcher', () => {
  let projectDir: string;
  let sessionDir: string;
  let sessionId: string;

  beforeEach(() => {
    // Point GROK sessions at a temp tree by using a unique cwd under /tmp
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tide-grok-proj-'));
    sessionId = '019f4d49-test-session-000000000001';
    // Real Grok path uses ~/.grok/sessions — for unit tests we write into that
    // layout under the real home so the watcher finds it. Use a unique project
    // path so we don't clash with live sessions.
    const key = encodeGrokProjectKey(projectDir);
    sessionDir = path.join(os.homedir(), '.grok', 'sessions', key, sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'events.jsonl'), '', 'utf8');
    fs.writeFileSync(path.join(sessionDir, 'chat_history.jsonl'), '', 'utf8');
  });

  afterEach(() => {
    try {
      fs.rmSync(path.join(os.homedir(), '.grok', 'sessions', encodeGrokProjectKey(projectDir)), {
        recursive: true,
        force: true,
      });
    } catch {
      // ignore
    }
    try {
      fs.rmSync(projectDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('emits tool_start/tool_result from chat_history and early starts from events', async () => {
    const events: StandardEvent[] = [];
    const watcher = startGrokSessionWatcher({
      agentId: 'agent-test',
      workingDir: projectDir,
      sessionId,
      startedAt: Date.now(),
      onEvent: (e) => events.push(e),
    });

    // Early tool from events.jsonl
    fs.appendFileSync(
      path.join(sessionDir, 'events.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), type: 'tool_started', tool_name: 'list_dir' }) + '\n',
      'utf8'
    );

    // Wait for poll
    await new Promise((r) => setTimeout(r, 350));

    const earlyStarts = events.filter((e) => e.type === 'tool_start' && e.toolName === 'ListFiles');
    expect(earlyStarts.length).toBeGreaterThanOrEqual(1);

    // Full tool call + result from chat_history
    fs.appendFileSync(
      path.join(sessionDir, 'chat_history.jsonl'),
      JSON.stringify({
        type: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-abc',
            name: 'list_dir',
            arguments: JSON.stringify({ target_directory: '/tmp' }),
          },
        ],
      }) + '\n',
      'utf8'
    );
    fs.appendFileSync(
      path.join(sessionDir, 'chat_history.jsonl'),
      JSON.stringify({
        type: 'tool_result',
        tool_call_id: 'call-abc',
        content: '- /tmp/foo\n',
      }) + '\n',
      'utf8'
    );

    await new Promise((r) => setTimeout(r, 350));

    // When an early tool_started card exists, chat_history upgrades that same
    // uuid with full args (no second empty "Using tool" row under call-abc).
    const upgradedEarly = events
      .filter((e) => e.type === 'tool_start' && e.toolName === 'ListFiles')
      .find((e) => e.toolInput && (e.toolInput as { target_directory?: string }).target_directory === '/tmp');
    expect(upgradedEarly).toBeDefined();
    expect(upgradedEarly!.toolInput).toMatchObject({ target_directory: '/tmp' });

    const result = events.find(
      (e) => e.type === 'tool_result' && (e.toolUseId === 'call-abc' || e.toolUseId === upgradedEarly!.toolUseId)
    );
    expect(result).toBeDefined();
    expect(result!.toolOutput).toContain('/tmp/foo');

    watcher.stop();
  });

  it('emits real Bash stdout from chat_history even when tool_completed races first', async () => {
    const events: StandardEvent[] = [];
    const watcher = startGrokSessionWatcher({
      agentId: 'agent-bash-out',
      workingDir: projectDir,
      sessionId,
      startedAt: Date.now(),
      onEvent: (e) => events.push(e),
    });

    // Fast Bash: started + completed before chat_history has the call
    fs.appendFileSync(
      path.join(sessionDir, 'events.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), type: 'tool_started', tool_name: 'run_terminal_command' }) + '\n',
      'utf8'
    );
    await new Promise((r) => setTimeout(r, 300));
    fs.appendFileSync(
      path.join(sessionDir, 'events.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        type: 'tool_completed',
        tool_name: 'run_terminal_command',
        outcome: 'success',
      }) + '\n',
      'utf8'
    );
    await new Promise((r) => setTimeout(r, 300));

    // Must NOT have emitted placeholder "(ok)" bash result
    const earlyOk = events.filter(
      (e) => e.type === 'tool_result' && (e.toolOutput === '(ok)' || e.toolOutput === '(error)')
    );
    expect(earlyOk).toHaveLength(0);

    fs.appendFileSync(
      path.join(sessionDir, 'chat_history.jsonl'),
      JSON.stringify({
        type: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-bash-1',
            name: 'run_terminal_command',
            arguments: JSON.stringify({ command: 'echo hello-from-bash' }),
          },
        ],
      }) + '\n',
      'utf8'
    );
    fs.appendFileSync(
      path.join(sessionDir, 'chat_history.jsonl'),
      JSON.stringify({
        type: 'tool_result',
        tool_call_id: 'call-bash-1',
        content: 'hello-from-bash\n',
      }) + '\n',
      'utf8'
    );
    await new Promise((r) => setTimeout(r, 350));

    const fullResults = events.filter(
      (e) => e.type === 'tool_result' && (e.toolOutput || '').includes('hello-from-bash')
    );
    expect(fullResults.length).toBeGreaterThanOrEqual(1);

    // Card uuid (early) should carry the real stdout for UI pairing
    const start = events.find(
      (e) => e.type === 'tool_start' && e.toolName === 'Bash' && (e.toolInput as { command?: string })?.command
    );
    expect(start).toBeDefined();
    const cardResult = fullResults.find((e) => e.uuid === start!.uuid || e.toolUseId === start!.uuid);
    expect(cardResult).toBeDefined();
    expect(cardResult!.toolOutput).toContain('hello-from-bash');

    watcher.stop();
  });

  it('still upgrades early TodoWrite when tool_completed races ahead of chat_history', async () => {
    const events: StandardEvent[] = [];
    const watcher = startGrokSessionWatcher({
      agentId: 'agent-todo-race',
      workingDir: projectDir,
      sessionId,
      startedAt: Date.now(),
      onEvent: (e) => events.push(e),
    });

    // Fast path: start → complete BEFORE chat_history has the call (TodoWrite often does this).
    fs.appendFileSync(
      path.join(sessionDir, 'events.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), type: 'tool_started', tool_name: 'todo_write' }) + '\n',
      'utf8'
    );
    await new Promise((r) => setTimeout(r, 350));

    fs.appendFileSync(
      path.join(sessionDir, 'events.jsonl'),
      JSON.stringify({
        ts: new Date().toISOString(),
        type: 'tool_completed',
        tool_name: 'todo_write',
        outcome: 'success',
      }) + '\n',
      'utf8'
    );
    await new Promise((r) => setTimeout(r, 350));

    const earlyEmpty = events.find(
      (e) => e.type === 'tool_start' && e.toolName === 'TodoWrite' && e.uuid?.startsWith('grok-early-')
    );
    expect(earlyEmpty).toBeDefined();
    const earlyUuid = earlyEmpty!.uuid!;

    // chat_history lands after complete — must upgrade the same early uuid, not mint call-*.
    fs.appendFileSync(
      path.join(sessionDir, 'chat_history.jsonl'),
      JSON.stringify({
        type: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-todo-1',
            name: 'todo_write',
            arguments: JSON.stringify({
              todos: [{ id: '1', content: 'Do the thing', status: 'in_progress' }],
              merge: false,
            }),
          },
        ],
      }) + '\n',
      'utf8'
    );
    await new Promise((r) => setTimeout(r, 350));

    const upgraded = events.filter(
      (e) => e.type === 'tool_start' && e.toolName === 'TodoWrite' && e.uuid === earlyUuid
    );
    expect(upgraded.length).toBeGreaterThanOrEqual(2); // empty early + full upgrade
    const withTodos = upgraded.find(
      (e) => Array.isArray((e.toolInput as { todos?: unknown })?.todos)
        && ((e.toolInput as { todos: unknown[] }).todos.length > 0)
    );
    expect(withTodos).toBeDefined();
    expect((withTodos!.toolInput as { todos: Array<{ content: string }> }).todos[0].content).toBe('Do the thing');

    // Must not leave a second full chip under the real call id.
    const callIdStarts = events.filter(
      (e) => e.type === 'tool_start' && e.toolName === 'TodoWrite' && e.uuid === 'call-todo-1'
    );
    expect(callIdStarts).toHaveLength(0);

    watcher.stop();
  });

  it('reads context usage from signals.json and emits usage_snapshot', async () => {
    const events: StandardEvent[] = [];
    const watcher = startGrokSessionWatcher({
      agentId: 'agent-usage',
      workingDir: projectDir,
      sessionId,
      startedAt: Date.now(),
      onEvent: (e) => events.push(e),
    });

    fs.writeFileSync(
      path.join(sessionDir, 'signals.json'),
      JSON.stringify({
        contextTokensUsed: 120000,
        contextWindowTokens: 500000,
        contextWindowUsage: 24,
      }),
      'utf8'
    );

    await new Promise((r) => setTimeout(r, 350));

    const snap = events.find((e) => e.type === 'usage_snapshot');
    expect(snap).toBeDefined();
    expect(snap!.tokens?.input).toBe(120000);
    expect(snap!.modelUsage?.contextWindow).toBe(500000);

    // Unchanged signals should not re-emit
    const before = events.filter((e) => e.type === 'usage_snapshot').length;
    await new Promise((r) => setTimeout(r, 350));
    expect(events.filter((e) => e.type === 'usage_snapshot').length).toBe(before);

    // Updated fill re-emits
    fs.writeFileSync(
      path.join(sessionDir, 'signals.json'),
      JSON.stringify({
        contextTokensUsed: 250000,
        contextWindowTokens: 500000,
        contextWindowUsage: 50,
      }),
      'utf8'
    );
    await new Promise((r) => setTimeout(r, 350));
    const latest = events.filter((e) => e.type === 'usage_snapshot').at(-1);
    expect(latest?.tokens?.input).toBe(250000);

    watcher.stop();
  });

  it('discovery never grabs a pre-existing session with a hot mtime (concurrent agent in same cwd)', async () => {
    // sessionDir was CREATED in beforeEach (birthtime ≈ now). Simulate an
    // agent launching later while that session is still being written by
    // another agent: startedAt in the future, mtime bumped into the window.
    const startedAt = Date.now() + 60_000;
    fs.utimesSync(sessionDir, new Date(startedAt), new Date(startedAt));

    const sessionIds: string[] = [];
    const events: StandardEvent[] = [];
    const watcher = startGrokSessionWatcher({
      agentId: 'agent-latecomer',
      workingDir: projectDir,
      startedAt,
      onEvent: (e) => events.push(e),
      onSessionId: (id) => sessionIds.push(id),
    });

    fs.appendFileSync(
      path.join(sessionDir, 'events.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), type: 'tool_started', tool_name: 'list_dir' }) + '\n',
      'utf8'
    );
    await new Promise((r) => setTimeout(r, 700));

    // Must not attach to the other agent's session nor mirror its tools.
    expect(sessionIds).toEqual([]);
    expect(events).toEqual([]);

    watcher.stop();
  });

  it('discovery skips a session already owned by another agent', async () => {
    const owner = startGrokSessionWatcher({
      agentId: 'agent-owner',
      workingDir: projectDir,
      sessionId,
      startedAt: Date.now(),
      onEvent: () => {},
    });

    const sessionIds: string[] = [];
    const thief = startGrokSessionWatcher({
      agentId: 'agent-second',
      workingDir: projectDir,
      startedAt: Date.now(),
      onEvent: () => {},
      onSessionId: (id) => sessionIds.push(id),
    });

    // sessionDir passes the creation-time filter (just created) — only the
    // ownership claim keeps the second agent off it.
    await new Promise((r) => setTimeout(r, 400));
    expect(sessionIds).toEqual([]);

    // Its own fresh session appears → attaches to that one.
    const ownId = '019f4d49-test-session-000000000002';
    const ownDir = path.join(os.homedir(), '.grok', 'sessions', encodeGrokProjectKey(projectDir), ownId);
    fs.mkdirSync(ownDir, { recursive: true });
    fs.writeFileSync(path.join(ownDir, 'events.jsonl'), '', 'utf8');
    fs.writeFileSync(path.join(ownDir, 'chat_history.jsonl'), '', 'utf8');

    await new Promise((r) => setTimeout(r, 600));
    expect(sessionIds).toEqual([ownId]);

    owner.stop();
    thief.stop();
  });

  it('setSessionId re-attaches to the CLI-reported session', async () => {
    const sessionIds: string[] = [];
    const events: StandardEvent[] = [];
    const watcher = startGrokSessionWatcher({
      agentId: 'agent-repin',
      workingDir: projectDir,
      sessionId,
      startedAt: Date.now(),
      onEvent: (e) => events.push(e),
      onSessionId: (id) => sessionIds.push(id),
    });

    const realId = '019f4d49-test-session-000000000003';
    const realDir = path.join(os.homedir(), '.grok', 'sessions', encodeGrokProjectKey(projectDir), realId);
    fs.mkdirSync(realDir, { recursive: true });
    fs.writeFileSync(path.join(realDir, 'events.jsonl'), '', 'utf8');
    fs.writeFileSync(path.join(realDir, 'chat_history.jsonl'), '', 'utf8');

    watcher.setSessionId(realId);
    expect(sessionIds).toEqual([sessionId, realId]);

    // New lines in the real session are tailed…
    fs.appendFileSync(
      path.join(realDir, 'events.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), type: 'tool_started', tool_name: 'list_dir' }) + '\n',
      'utf8'
    );
    // …while the previously attached session is no longer read.
    fs.appendFileSync(
      path.join(sessionDir, 'events.jsonl'),
      JSON.stringify({ ts: new Date().toISOString(), type: 'tool_started', tool_name: 'grep' }) + '\n',
      'utf8'
    );
    await new Promise((r) => setTimeout(r, 500));

    expect(events.some((e) => e.type === 'tool_start' && e.toolName === 'ListFiles')).toBe(true);
    expect(events.some((e) => e.type === 'tool_start' && e.toolName === 'Grep')).toBe(false);

    watcher.stop();
  });

  it('readGrokSignalsUsage parses signals.json', () => {
    fs.writeFileSync(
      path.join(sessionDir, 'signals.json'),
      JSON.stringify({ contextTokensUsed: 10, contextWindowTokens: 100 }),
      'utf8'
    );
    expect(readGrokSignalsUsage(sessionDir)).toEqual({
      contextTokensUsed: 10,
      contextWindowTokens: 100,
      contextWindowUsage: undefined,
    });
  });
});
