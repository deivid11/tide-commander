import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('session-loader provider normalization', () => {
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

  it('hydrates Pi edit history with its exact result patch', async () => {
    const cwd = '/workspace/pi-project';
    const sessionId = 'pi-session-123';
    const sessionDir = path.join(tempHomeDir, '.pi', 'agent', 'sessions', '--workspace-pi-project--');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, `2026-08-17T00-00-00-000Z_${sessionId}.jsonl`);
    const patch = '--- src/a.ts\n+++ src/a.ts\n@@ -1 +1 @@\n-old\n+new\n';

    const entries = [
      { type: 'session', version: 3, id: sessionId, timestamp: '2026-08-17T00:00:00.000Z', cwd },
      {
        type: 'message',
        id: 'assistant-1',
        parentId: null,
        timestamp: '2026-08-17T00:00:01.000Z',
        message: {
          role: 'assistant',
          content: [{
            type: 'toolCall',
            id: 'pi-edit-call',
            name: 'edit',
            arguments: {
              path: 'src/a.ts',
              edits: [{ oldText: 'old', newText: 'new' }],
            },
          }],
        },
      },
      {
        type: 'message',
        id: 'result-1',
        parentId: 'assistant-1',
        timestamp: '2026-08-17T00:00:02.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'pi-edit-call',
          toolName: 'edit',
          content: [{ type: 'text', text: 'Successfully replaced 1 block(s).' }],
          details: { patch, firstChangedLine: 1 },
          isError: false,
        },
      },
    ];
    fs.writeFileSync(sessionFile, `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`, 'utf8');

    const { loadSession } = await import('./session-loader.js');
    const history = await loadSession(cwd, sessionId, 20, 0);
    const toolUse = history?.messages.find(message => message.type === 'tool_use');

    expect(toolUse).toMatchObject({
      toolName: 'Edit',
      toolInput: {
        file_path: 'src/a.ts',
        old_string: 'old',
        new_string: 'new',
        operation: 'pi-edit',
        unified_diff: patch,
        first_changed_line: 1,
      },
    });
  });

  it('hydrates native Pi compaction entries as compacted history markers', async () => {
    const cwd = '/workspace/pi-compaction';
    const sessionId = 'pi-compaction-session';
    const sessionDir = path.join(tempHomeDir, '.pi', 'agent', 'sessions', '--workspace-pi-compaction--');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, `2026-08-17T00-00-00-000Z_${sessionId}.jsonl`);

    const entries = [
      { type: 'session', version: 3, id: sessionId, timestamp: '2026-08-17T00:00:00.000Z', cwd },
      {
        type: 'compaction',
        id: 'compact-1',
        parentId: null,
        timestamp: '2026-08-17T00:00:01.000Z',
        summary: 'Internal summary that should not flood chat history',
        tokensBefore: 150000,
        retainedTail: [],
      },
    ];
    fs.writeFileSync(sessionFile, `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`, 'utf8');

    const { loadSession } = await import('./session-loader.js');
    const history = await loadSession(cwd, sessionId, 20, 0);

    expect(history?.messages).toContainEqual(expect.objectContaining({
      type: 'assistant',
      content: '<local-command-stdout>Compacted</local-command-stdout>',
      uuid: 'pi-compaction-compact-1',
    }));
  });

  it('hydrates Pi reasoning summaries with token and encryption metadata', async () => {
    const cwd = '/workspace/pi-reasoning';
    const sessionId = 'pi-reasoning-session';
    const sessionDir = path.join(tempHomeDir, '.pi', 'agent', 'sessions', '--workspace-pi-reasoning--');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, `2026-08-17T00-00-00-000Z_${sessionId}.jsonl`);
    const thinkingSignature = JSON.stringify({
      encrypted_content: 'opaque-provider-reasoning',
      content: [],
      summary: [
        { type: 'summary_text', text: 'Inspecting event flow' },
        { type: 'summary_text', text: 'Planning UI metadata' },
      ],
    });

    fs.writeFileSync(sessionFile, `${JSON.stringify({
      type: 'session', version: 3, id: sessionId, timestamp: '2026-08-17T00:00:00.000Z', cwd,
    })}\n${JSON.stringify({
      type: 'message',
      id: 'assistant-reasoning',
      parentId: null,
      timestamp: '2026-08-17T00:00:01.000Z',
      message: {
        role: 'assistant',
        content: [{
          type: 'thinking',
          thinking: '**Inspecting event flow**\n\n**Planning UI metadata**',
          thinkingSignature,
        }],
        usage: { input: 100, output: 80, reasoning: 64, totalTokens: 180 },
      },
    })}\n`, 'utf8');

    const { loadSession } = await import('./session-loader.js');
    const history = await loadSession(cwd, sessionId, 20, 0);

    expect(history?.messages[0]).toMatchObject({
      type: 'assistant',
      content: '[thinking] **Inspecting event flow**\n\n**Planning UI metadata**',
      reasoningTokens: 64,
      reasoningSummaryCount: 2,
      reasoningEncrypted: true,
      reasoningSummaryOnly: true,
    });
  });

  it('maps a sed line-range exec_command to a Read tool with offset/limit on reload', async () => {
    const sessionId = 'session-sed-read';
    const sessionDir = path.join(tempHomeDir, '.codex', 'sessions', '2026', '05', '25');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, `run-${sessionId}.jsonl`);

    const entryToolUse = {
      timestamp: '2026-05-25T00:00:00.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'exec_command',
        call_id: 'call-read',
        arguments: JSON.stringify({ cmd: "sed -n '280,520p' src/main/java/Foo.java", workdir: '/repo' }),
      },
    };
    const entryToolResult = {
      timestamp: '2026-05-25T00:00:01.000Z',
      type: 'response_item',
      payload: { type: 'function_call_output', call_id: 'call-read', output: '...lines...' },
    };

    fs.writeFileSync(
      sessionFile,
      `${JSON.stringify(entryToolUse)}\n${JSON.stringify(entryToolResult)}\n`,
      'utf8'
    );

    const { loadSession } = await import('./session-loader.js');
    const history = await loadSession('/workspace/project', sessionId, 20, 0);

    expect(history).not.toBeNull();
    const toolUse = history!.messages.find((m) => m.type === 'tool_use');
    expect(toolUse).toMatchObject({
      type: 'tool_use',
      toolName: 'Read',
      toolInput: { file_path: 'src/main/java/Foo.java', offset: 280, limit: 241 },
      toolUseId: 'call-read',
    });
    // The result correlates to the Read tool, not Bash.
    const toolResult = history!.messages.find((m) => m.type === 'tool_result');
    expect(toolResult).toMatchObject({ type: 'tool_result', toolName: 'Read' });
  });

  it('suppresses empty write_stdin rows and attributes their output to Bash', async () => {
    const sessionId = 'session-write-stdin';
    const sessionDir = path.join(tempHomeDir, '.codex', 'sessions', '2026', '02', '07');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, `run-${sessionId}.jsonl`);

    const writeStdinCall = {
      timestamp: '2026-02-07T00:00:00.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call',
        name: 'write_stdin',
        call_id: 'call-stdin-1',
        arguments: JSON.stringify({ session_id: 32358, chars: '', yield_time_ms: 30000 }),
      },
    };
    const writeStdinOutput = {
      timestamp: '2026-02-07T00:00:01.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        call_id: 'call-stdin-1',
        output: 'Process exited with code 0\nOutput:\nbuild ok\n',
      },
    };

    fs.writeFileSync(
      sessionFile,
      `${JSON.stringify(writeStdinCall)}\n${JSON.stringify(writeStdinOutput)}\n`,
      'utf8'
    );

    const { loadSession } = await import('./session-loader.js');
    const history = await loadSession('/workspace/project', sessionId, 20, 0);

    expect(history).not.toBeNull();
    // No bare "write_stdin" tool_use row.
    expect(history!.messages.some((m) => m.type === 'tool_use' && m.toolName === 'write_stdin')).toBe(false);
    expect(history!.messages.some((m) => m.toolName === 'write_stdin')).toBe(false);
    // Its output is preserved, attributed to Bash.
    const toolResult = history!.messages.find((m) => m.type === 'tool_result');
    expect(toolResult).toMatchObject({ type: 'tool_result', toolName: 'Bash', toolUseId: 'call-stdin-1' });
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

  it('loads codex response_item web_search_call into tool history entries', async () => {
    const sessionId = 'session-websearch123';
    const sessionDir = path.join(tempHomeDir, '.codex', 'sessions', '2026', '02', '07');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, `run-${sessionId}.jsonl`);

    const webSearchEntry = {
      timestamp: '2026-02-07T00:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'web_search_call',
        status: 'completed',
        action: {
          type: 'search',
          query: 'codex web search_call docs',
          queries: ['codex web search_call docs'],
        },
      },
    };

    fs.writeFileSync(sessionFile, `${JSON.stringify(webSearchEntry)}\n`, 'utf8');

    const { loadSession } = await import('./session-loader.js');
    const history = await loadSession('/workspace/project', sessionId, 20, 0);

    expect(history).not.toBeNull();
    expect(history?.messages).toHaveLength(2);

    const [toolUse, toolResult] = history!.messages;
    expect(toolUse).toMatchObject({
      type: 'tool_use',
      toolName: 'web_search',
      toolInput: {
        actionType: 'search',
        actionQuery: 'codex web search_call docs',
        actionQueries: ['codex web search_call docs'],
        status: 'completed',
      },
    });
    expect(toolResult).toMatchObject({
      type: 'tool_result',
      toolName: 'web_search',
    });
  });

  it('silently skips event_msg.task_complete (handled by response_item.message)', async () => {
    const sessionId = 'session-task-complete';
    const sessionDir = path.join(tempHomeDir, '.codex', 'sessions', '2026', '02', '07');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, `run-${sessionId}.jsonl`);

    const taskCompleteEntry = {
      timestamp: '2026-02-07T00:00:04.000Z',
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: '019c9bff-3b84-7e81-8c2e-e9afa20399be',
        last_agent_message: 'Done.\n\n1. Fixed the bug\n2. Updated tests',
      },
    };

    fs.writeFileSync(sessionFile, `${JSON.stringify(taskCompleteEntry)}\n`, 'utf8');

    const { loadSession } = await import('./session-loader.js');
    const history = await loadSession('/workspace/project', sessionId, 20, 0);

    expect(history).not.toBeNull();
    expect(history?.messages).toHaveLength(0);
  });

  it('loads end-only event_msg MCP calls as structured tool history', async () => {
    const sessionId = 'session-mcp-event';
    const sessionDir = path.join(tempHomeDir, '.codex', 'sessions', '2026', '07', '13');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, `run-${sessionId}.jsonl`);
    const entry = {
      timestamp: '2026-07-13T00:00:00.000Z',
      type: 'event_msg',
      payload: {
        type: 'mcp_tool_call_end',
        call_id: 'exec-mcp-1',
        invocation: {
          server: 'onshape',
          tool: 'create_fillet',
          arguments: { documentId: 'doc-1', radius: 0.118 },
        },
        result: { Ok: { content: [{ type: 'text', text: 'Error creating fillet: API returned 400.' }] } },
      },
    };
    fs.writeFileSync(sessionFile, `${JSON.stringify(entry)}\n`, 'utf8');

    const { loadSession } = await import('./session-loader.js');
    const history = await loadSession('/workspace/project', sessionId, 20, 0);

    expect(history?.messages).toHaveLength(2);
    expect(history?.messages[0]).toMatchObject({
      type: 'tool_use',
      toolName: 'mcp__onshape__create_fillet',
      toolInput: { server: 'onshape', documentId: 'doc-1', radius: 0.118 },
      toolUseId: 'exec-mcp-1',
    });
    expect(history?.messages[1]).toMatchObject({
      type: 'tool_result',
      toolName: 'mcp__onshape__create_fillet',
      content: 'Error creating fillet: API returned 400.',
    });
    expect(history?.messages.some((message) => message.content.includes('[codex-event]'))).toBe(false);
  });

  it('enriches apply_patch Edit rows with the unified diff from patch_apply_end', async () => {
    const sessionId = 'session-apply-patch';
    const sessionDir = path.join(tempHomeDir, '.codex', 'sessions', '2026', '05', '25');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, `run-${sessionId}.jsonl`);

    const customToolCall = {
      timestamp: '2026-05-25T00:00:00.000Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        name: 'apply_patch',
        call_id: 'call-patch-1',
        input: '*** Begin Patch\n*** Update File: src/Foo.java\n@@\n-old\n+new\n*** End Patch',
      },
    };
    const patchApplyEnd = {
      timestamp: '2026-05-25T00:00:00.100Z',
      type: 'event_msg',
      payload: {
        type: 'patch_apply_end',
        call_id: 'call-patch-1',
        success: true,
        changes: {
          '/repo/src/Foo.java': { type: 'update', unified_diff: '@@ -1 +1 @@\n-old\n+new\n' },
        },
        status: 'completed',
      },
    };
    const customToolCallOutput = {
      timestamp: '2026-05-25T00:00:00.200Z',
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'call-patch-1',
        output: '{"output":"Success. Updated the following files:\\nM src/Foo.java\\n"}',
      },
    };

    fs.writeFileSync(
      sessionFile,
      `${JSON.stringify(customToolCall)}\n${JSON.stringify(patchApplyEnd)}\n${JSON.stringify(customToolCallOutput)}\n`,
      'utf8'
    );

    const { loadSession } = await import('./session-loader.js');
    const history = await loadSession('/workspace/project', sessionId, 20, 0);

    expect(history).not.toBeNull();
    // One Edit tool_use (enriched with unified_diff) + one tool_result.
    // The patch_apply_end event itself must NOT produce a standalone message.
    const toolUses = history!.messages.filter((m) => m.type === 'tool_use');
    expect(toolUses).toHaveLength(1);
    expect(toolUses[0]).toMatchObject({
      toolName: 'Edit',
      toolInput: {
        file_path: '/repo/src/Foo.java',
        unified_diff: '@@ -1 +1 @@\n-old\n+new\n',
      },
      toolUseId: 'call-patch-1',
    });
    // No raw "[codex-event] ... patch_apply_end" dump anywhere.
    expect(history!.messages.some((m) => m.content.includes('patch_apply_end'))).toBe(false);
  });

  it('keeps unknown codex response_item payloads via fallback assistant message', async () => {
    const sessionId = 'session-unknown-event';
    const sessionDir = path.join(tempHomeDir, '.codex', 'sessions', '2026', '02', '07');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, `run-${sessionId}.jsonl`);

    const unknownEntry = {
      timestamp: '2026-02-07T00:00:03.000Z',
      type: 'response_item',
      payload: {
        type: 'future_event_type',
        status: 'completed',
        payload: { alpha: 1 },
      },
    };

    fs.writeFileSync(sessionFile, `${JSON.stringify(unknownEntry)}\n`, 'utf8');

    const { loadSession } = await import('./session-loader.js');
    const history = await loadSession('/workspace/project', sessionId, 20, 0);

    expect(history).not.toBeNull();
    expect(history?.messages).toHaveLength(1);
    expect(history?.messages[0].type).toBe('assistant');
    expect(history?.messages[0].content).toContain('[codex-event]');
    expect(history?.messages[0].content).toContain('response_item.future_event_type');
  });
});
