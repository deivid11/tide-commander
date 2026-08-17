import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Agent } from '../../shared/types.js';
import type { ConversationHistory, SessionMessage, SessionProvider } from '../claude/session-loader.js';
import {
  createTransferredPiSession,
  createTransferredSession,
  normalizeSessionForTransfer,
  removeTransferredSession,
  type SessionTransferDependencies,
} from './session-transfer-service.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function message(
  type: SessionMessage['type'],
  content: string,
  extra: Partial<SessionMessage> = {},
): SessionMessage {
  return {
    type,
    content,
    timestamp: '2026-01-01T00:00:00.000Z',
    uuid: `${type}-${Math.random()}`,
    ...extra,
  };
}

function sourceAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Native Agent',
    class: 'builder',
    status: 'idle',
    provider: 'claude',
    position: { x: 0, y: 0, z: 0 },
    sessionId: 'claude-source-session',
    cwd: '/workspace/project',
    permissionMode: 'bypass',
    tokensUsed: 0,
    contextUsed: 0,
    contextLimit: 200_000,
    taskCount: 1,
    createdAt: 1,
    lastActivity: 1,
    ...overrides,
  };
}

function dependencies(
  messages: SessionMessage[],
  home: string,
  options: { sourceProvider?: SessionProvider; sessionIds?: string[] } = {},
): Partial<SessionTransferDependencies> {
  let entry = 0;
  let sessionIndex = 0;
  const sessionIds = options.sessionIds ?? ['11111111-2222-4333-8444-555555555555'];
  const history: ConversationHistory = {
    sessionId: 'claude-source-session',
    messages,
    cwd: '/workspace/project',
    totalCount: messages.length,
    hasMore: false,
  };
  return {
    detectSourceProvider: () => options.sourceProvider ?? 'claude',
    loadSourceSession: async () => history,
    piHome: () => path.join(home, 'pi'),
    claudeHome: () => path.join(home, 'claude'),
    codexHome: () => path.join(home, 'codex'),
    grokHome: () => path.join(home, 'grok'),
    now: () => new Date('2026-01-02T03:04:05.000Z'),
    newSessionId: () => sessionIds[Math.min(sessionIndex++, sessionIds.length - 1)],
    newEntryId: () => `entry-${++entry}`,
  };
}

const SAMPLE_MESSAGES = (): SessionMessage[] => [
  message('user', 'Implement the feature'),
  message('assistant', '[thinking] hidden reasoning must not cross'),
  message('assistant', 'I updated the service.'),
  message('tool_use', '', {
    toolName: 'Write',
    toolUseId: 'call-write',
    toolInput: { file_path: 'src/feature.ts', content: 'not imported' },
  }),
  message('tool_result', 'large stale output', { toolName: 'Write', toolUseId: 'call-write' }),
  message('assistant', 'Tests pass.'),
];

describe('native session to Pi transfer', () => {
  it('drops hidden reasoning and tool-result bodies while preserving changed paths', () => {
    const normalized = normalizeSessionForTransfer([
      message('user', 'Fix the parser'),
      message('assistant', '[thinking] private chain of thought'),
      message('tool_use', '', {
        toolName: 'Edit',
        toolUseId: 'call-1',
        toolInput: {
          file_path: 'src/parser.ts',
          new_string: 'SECRET_TOOL_ARGUMENT_BODY',
        },
      }),
      message('tool_result', 'SECRET_TOOL_RESULT_BODY', {
        toolName: 'Edit',
        toolUseId: 'call-1',
      }),
      message('assistant', 'The parser is fixed.'),
    ]);

    expect(normalized.changedFiles).toEqual(['src/parser.ts']);
    expect(normalized.droppedToolResultBodies).toBe(1);
    const text = normalized.turns.map((turn) => turn.text).join('\n');
    expect(text).toContain('[Tool activity] Edit — src/parser.ts — completed');
    expect(text).toContain('The parser is fixed.');
    expect(text).not.toContain('private chain of thought');
    expect(text).not.toContain('SECRET_TOOL_ARGUMENT_BODY');
    expect(text).not.toContain('SECRET_TOOL_RESULT_BODY');
  });

  it('creates a new validated Pi v3 session without reusing the native id', async () => {
    const piHome = mkdtempSync(path.join(tmpdir(), 'tide-pi-transfer-'));
    temporaryDirectories.push(piHome);
    const messages = [
      message('user', 'Implement the feature'),
      message('assistant', 'I updated the service.'),
      message('tool_use', '', {
        toolName: 'Write',
        toolUseId: 'call-write',
        toolInput: { file_path: 'src/feature.ts', content: 'not imported' },
      }),
      message('tool_result', 'large stale output', {
        toolName: 'Write',
        toolUseId: 'call-write',
      }),
      message('assistant', 'Tests pass.'),
    ];

    const created = await createTransferredPiSession(
      sourceAgent(),
      { mode: 'smart', contextLimit: 200_000 },
      dependencies(messages, piHome),
    );

    expect(created.sessionId).toBe('11111111-2222-4333-8444-555555555555');
    expect(created.sessionId).not.toBe('claude-source-session');
    expect(created.summary.sourceProvider).toBe('claude');
    expect(created.summary.droppedToolResultBodies).toBe(1);
    expect(created.summary.importedTurnCount).toBeGreaterThan(1);

    const records = readFileSync(created.filePath, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({
      type: 'session',
      version: 3,
      id: created.sessionId,
      cwd: '/workspace/project',
    });
    expect(records[1]).toMatchObject({
      type: 'custom',
      customType: 'tide-session-transfer',
      data: {
        sourceProvider: 'claude',
        sourceSessionId: 'claude-source-session',
        sourcePreserved: true,
      },
    });

    const assistant = records.find((record) => record.type === 'message' && record.message?.role === 'assistant');
    expect(assistant.message.usage).toMatchObject({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { total: 0 },
    });
    expect(JSON.stringify(records)).not.toContain('large stale output');
  });

  it('never overwrites or deletes an existing Pi session on an id collision', async () => {
    const piHome = mkdtempSync(path.join(tmpdir(), 'tide-pi-transfer-collision-'));
    temporaryDirectories.push(piHome);
    const firstMessages = [message('user', 'Original imported conversation')];
    const first = await createTransferredPiSession(
      sourceAgent(),
      { mode: 'full', contextLimit: 200_000 },
      dependencies(firstMessages, piHome),
    );
    const originalBytes = readFileSync(first.filePath, 'utf-8');

    const replacementMessages = [message('user', 'This must never replace the first file')];
    await expect(createTransferredPiSession(
      sourceAgent(),
      { mode: 'full', contextLimit: 200_000 },
      dependencies(replacementMessages, piHome),
    )).rejects.toMatchObject({ code: 'EEXIST' });

    expect(readFileSync(first.filePath, 'utf-8')).toBe(originalBytes);
  });

  it('budgets a smart transfer and reports omitted older turns', async () => {
    const piHome = mkdtempSync(path.join(tmpdir(), 'tide-pi-transfer-budget-'));
    temporaryDirectories.push(piHome);
    const messages: SessionMessage[] = [message('user', 'First objective')];
    for (let index = 0; index < 40; index += 1) {
      messages.push(message(index % 2 === 0 ? 'assistant' : 'user', `${index}: ${'x'.repeat(500)}`));
    }

    const created = await createTransferredPiSession(
      sourceAgent(),
      { mode: 'smart', contextLimit: 8_000 },
      dependencies(messages, piHome),
    );

    expect(created.summary.droppedTurnCount).toBeGreaterThan(0);
    expect(created.summary.estimatedTokens).toBeLessThanOrEqual(2_400);
    expect(created.summary.warnings.join(' ')).toContain('omitted');
    const text = readFileSync(created.filePath, 'utf-8');
    expect(text).toContain('First objective');
    expect(text).toContain('[Session transfer note]');
  });
});

describe('generic harness migration writers', () => {
  it('writes a resumable Claude Code transcript (uuid chain, text-only blocks) from a Pi source', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'tide-transfer-claude-'));
    temporaryDirectories.push(home);
    const uuids = ['aaaaaaaa-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000002', 'dddddddd-0000-4000-8000-000000000003', 'eeeeeeee-0000-4000-8000-000000000004', 'ffffffff-0000-4000-8000-000000000005', '99999999-0000-4000-8000-000000000006'];

    const created = await createTransferredSession(
      sourceAgent({ provider: 'pi', sessionId: 'pi-source-session' }),
      { targetProvider: 'claude', mode: 'full', contextLimit: 200_000 },
      dependencies(SAMPLE_MESSAGES(), home, { sourceProvider: 'pi', sessionIds: uuids }),
    );

    expect(created.targetProvider).toBe('claude');
    expect(created.sessionId).toBe(uuids[0]);
    expect(created.filePath).toBe(path.join(home, 'claude', 'projects', '-workspace-project', `${uuids[0]}.jsonl`));
    expect(created.summary).toMatchObject({ sourceProvider: 'pi', targetProvider: 'claude', droppedToolResultBodies: 1 });

    const records = readFileSync(created.filePath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({
      type: 'user',
      parentUuid: null,
      isSidechain: false,
      sessionId: uuids[0],
      cwd: '/workspace/project',
      message: { role: 'user', content: 'Implement the feature' },
    });
    // Every following entry chains to the previous uuid.
    for (let index = 1; index < records.length; index += 1) {
      expect(records[index].parentUuid).toBe(records[index - 1].uuid);
      expect(records[index].sessionId).toBe(uuids[0]);
    }
    const assistant = records.find((record) => record.type === 'assistant');
    expect(assistant.message).toMatchObject({
      role: 'assistant',
      type: 'message',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'I updated the service.' }],
    });
    const serialized = JSON.stringify(records);
    expect(serialized).not.toContain('hidden reasoning');
    expect(serialized).not.toContain('large stale output');
    expect(serialized).toContain('imported from Pi session pi-source-session');
    expect(records.at(-1).type).toBe('assistant');
    expect(records.at(-1).message.content[0].text).toContain('[Session transfer note]');
  });

  it('writes a Codex rollout (session_meta + response_item messages) under the local-date directory', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'tide-transfer-codex-'));
    temporaryDirectories.push(home);

    const created = await createTransferredSession(
      sourceAgent({ provider: 'grok', sessionId: 'grok-source-session' }),
      { targetProvider: 'codex', mode: 'full', contextLimit: 258_400 },
      dependencies(SAMPLE_MESSAGES(), home, { sourceProvider: 'grok' }),
    );

    const createdAt = new Date('2026-01-02T03:04:05.000Z');
    const pad = (value: number) => String(value).padStart(2, '0');
    const expectedDir = path.join(
      home, 'codex', 'sessions',
      String(createdAt.getFullYear()), pad(createdAt.getMonth() + 1), pad(createdAt.getDate()),
    );
    expect(path.dirname(created.filePath)).toBe(expectedDir);
    expect(path.basename(created.filePath)).toMatch(/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-11111111-2222-4333-8444-555555555555\.jsonl$/);

    const records = readFileSync(created.filePath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({
      type: 'session_meta',
      payload: { id: created.sessionId, cwd: '/workspace/project', originator: 'tide-commander', source: 'exec' },
    });
    expect(records[1]).toMatchObject({
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Implement the feature' }] },
    });
    const assistant = records.find((record) => record.payload?.role === 'assistant');
    expect(assistant.payload.content[0]).toMatchObject({ type: 'output_text', text: 'I updated the service.' });
    expect(records.every((record, index) => index === 0 || record.type === 'response_item')).toBe(true);
    expect(JSON.stringify(records)).not.toContain('large stale output');
  });

  it('writes a Grok session directory (chat_history + summary) with <user_query> wrapping and rolls it back cleanly', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'tide-transfer-grok-'));
    temporaryDirectories.push(home);

    const created = await createTransferredSession(
      sourceAgent({ provider: 'codex', sessionId: 'codex-source-session' }),
      { targetProvider: 'grok', mode: 'full', contextLimit: 500_000, targetModel: 'grok-4.5' },
      dependencies(SAMPLE_MESSAGES(), home, { sourceProvider: 'codex' }),
    );

    const sessionDir = path.join(home, 'grok', 'sessions', encodeURIComponent('/workspace/project'), created.sessionId);
    expect(created.ownedDir).toBe(sessionDir);
    expect(created.filePath).toBe(path.join(sessionDir, 'chat_history.jsonl'));
    expect(created.createdFiles).toEqual([
      path.join(sessionDir, 'chat_history.jsonl'),
      path.join(sessionDir, 'summary.json'),
    ]);
    expect(readdirSync(sessionDir).sort()).toEqual(['chat_history.jsonl', 'summary.json']);

    const chat = readFileSync(created.filePath, 'utf-8').trim().split('\n').map((line) => JSON.parse(line));
    expect(chat[0]).toEqual({
      type: 'user',
      content: [{ type: 'text', text: '<user_query>\nImplement the feature\n</user_query>' }],
      prompt_index: 0,
    });
    expect(chat.some((entry) => entry.type === 'system')).toBe(false);
    expect(chat.find((entry) => entry.type === 'assistant')).toEqual({ type: 'assistant', content: 'I updated the service.' });

    const summary = JSON.parse(readFileSync(path.join(sessionDir, 'summary.json'), 'utf-8'));
    expect(summary).toMatchObject({
      info: { id: created.sessionId, cwd: '/workspace/project' },
      chat_format_version: 1,
      // Grok refuses to resume ("Session does not exist") without current_model_id.
      current_model_id: 'grok-4.5',
      num_chat_messages: chat.length,
      tide_session_transfer: { sourceProvider: 'codex', sourceSessionId: 'codex-source-session', sourcePreserved: true },
    });

    removeTransferredSession(created);
    expect(existsSync(sessionDir)).toBe(false);
  });

  it('never replaces an existing Grok session directory with the same id', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'tide-transfer-grok-collision-'));
    temporaryDirectories.push(home);
    const first = await createTransferredSession(
      sourceAgent(),
      { targetProvider: 'grok', mode: 'full', contextLimit: 500_000 },
      dependencies([message('user', 'Original imported conversation')], home),
    );
    const originalBytes = readFileSync(first.filePath, 'utf-8');

    await expect(createTransferredSession(
      sourceAgent(),
      { targetProvider: 'grok', mode: 'full', contextLimit: 500_000 },
      dependencies([message('user', 'This must never replace the first session')], home),
    )).rejects.toMatchObject({ code: 'EEXIST' });

    expect(readFileSync(first.filePath, 'utf-8')).toBe(originalBytes);
    expect(existsSync(path.join(first.ownedDir!, 'summary.json'))).toBe(true);
  });

  it('refuses a transfer onto the runtime the agent already uses', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'tide-transfer-same-'));
    temporaryDirectories.push(home);
    await expect(createTransferredSession(
      sourceAgent({ provider: 'codex', sessionId: 'codex-source-session' }),
      { targetProvider: 'codex', mode: 'full', contextLimit: 258_400 },
      dependencies(SAMPLE_MESSAGES(), home, { sourceProvider: 'codex' }),
    )).rejects.toMatchObject({ code: 'source-provider-mismatch' });
  });

  it('accepts OpenCode as a source through the shared loader', async () => {
    const home = mkdtempSync(path.join(tmpdir(), 'tide-transfer-opencode-src-'));
    temporaryDirectories.push(home);
    const created = await createTransferredSession(
      sourceAgent({ provider: 'opencode', sessionId: 'ses_opencode' }),
      { targetProvider: 'pi', mode: 'smart', contextLimit: 200_000 },
      dependencies(SAMPLE_MESSAGES(), home, { sourceProvider: 'opencode' }),
    );
    expect(created.summary.sourceProvider).toBe('opencode');
    expect(readFileSync(created.filePath, 'utf-8')).toContain('imported from OpenCode session ses_opencode');
  });
});
