import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('session-loader codex normalization', () => {
  let tempHomeDir: string;

  beforeEach(() => {
    tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-loader-test-'));
    vi.resetModules();
    vi.doMock('os', async () => {
      const actual = await vi.importActual<typeof import('os')>('os');
      return {
        ...actual,
        homedir: () => tempHomeDir,
      };
    });
  });

  afterEach(() => {
    vi.doUnmock('os');
    vi.resetModules();
    fs.rmSync(tempHomeDir, { recursive: true, force: true });
  });

  it('maps exec_command function calls to Bash tool history on reload', async () => {
    const sessionId = 'session-abc123';
    const sessionDir = path.join(tempHomeDir, '.codex', 'sessions', '2026', '02', '07');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, `run-${sessionId}.jsonl`);

    const entryToolUse = {
      timestamp: '2026-02-07T00:00:00.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-1',
        arguments: JSON.stringify({ cmd: 'echo hello' }),
      },
    };
    const entryToolResult = {
      timestamp: '2026-02-07T00:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-1',
        output: 'hello\n',
      },
    };

    fs.writeFileSync(
      sessionFile,
      `${JSON.stringify(entryToolUse)}\n${JSON.stringify(entryToolResult)}\n`,
      'utf8'
    );

    const { loadSession } = await import('./session-loader.js');
    const history = await loadSession('/workspace/project', sessionId, 20, 0);

    expect(history).not.toBeNull();
    expect(history?.messages).toHaveLength(2);

    const [toolUse, toolResult] = history!.messages;
    expect(toolUse).toMatchObject({
      type: 'tool_use',
      toolName: 'Bash',
      toolInput: {
        cmd: 'echo hello',
        command: 'echo hello',
      },
      toolUseId: 'call-1',
    });
    expect(toolResult).toMatchObject({
      type: 'tool_result',
      toolName: 'Bash',
      toolUseId: 'call-1',
      content: 'hello\n',
    });
  });

  it('normalizes codex image user_message content without base64 blobs', async () => {
    const sessionId = 'session-image123';
    const sessionDir = path.join(tempHomeDir, '.codex', 'sessions', '2026', '02', '07');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, `run-${sessionId}.jsonl`);

    const entryUserMessage = {
      timestamp: '2026-02-07T00:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: JSON.stringify([
          { type: 'input_text', text: 'what says this image?\n\n' },
          { type: 'input_image', image_url: 'data:image/png;base64,AAAAABBBBB' },
        ]),
      },
    };

    fs.writeFileSync(sessionFile, `${JSON.stringify(entryUserMessage)}\n`, 'utf8');

    const { loadSession } = await import('./session-loader.js');
    const history = await loadSession('/workspace/project', sessionId, 20, 0);

    expect(history).not.toBeNull();
    expect(history?.messages).toHaveLength(1);
    expect(history?.messages[0].type).toBe('user');
    expect(history?.messages[0].content).toContain('what says this image?');
    expect(history?.messages[0].content).toContain('[Image attached]');
    expect(history?.messages[0].content).not.toContain('data:image/png;base64');
  });

  it('skips image-only response_item user duplicates', async () => {
    const sessionId = 'session-image-dup';
    const sessionDir = path.join(tempHomeDir, '.codex', 'sessions', '2026', '02', '07');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, `run-${sessionId}.jsonl`);

    const primaryUserMessage = {
      timestamp: '2026-02-07T00:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: 'what this image says?\n\n[Image: /tmp/tide-commander-uploads/image-xlz8m7.png]',
      },
    };

    const imageOnlyDuplicate = {
      timestamp: '2026-02-07T00:00:00.100Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_image', image_url: 'data:image/png;base64,AAAAABBBBB' },
        ],
      },
    };

    fs.writeFileSync(
      sessionFile,
      `${JSON.stringify(primaryUserMessage)}\n${JSON.stringify(imageOnlyDuplicate)}\n`,
      'utf8'
    );

    const { loadSession } = await import('./session-loader.js');
    const history = await loadSession('/workspace/project', sessionId, 20, 0);

    expect(history).not.toBeNull();
    expect(history?.messages).toHaveLength(1);
    expect(history?.messages[0].type).toBe('user');
    expect(history?.messages[0].content).toContain('[Image: /tmp/tide-commander-uploads/image-xlz8m7.png]');
    expect(history?.messages[0].content).not.toContain('[Image attached]');
  });
});
