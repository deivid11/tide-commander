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
