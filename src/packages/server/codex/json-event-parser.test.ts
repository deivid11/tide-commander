import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { CodexJsonEventParser } from './json-event-parser.js';

describe('CodexJsonEventParser', () => {
  it('maps reasoning item completion to thinking event', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'item.completed',
      item: {
        type: 'reasoning',
        text: '**Preparing web search query**',
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'thinking',
      text: '**Preparing web search query**',
      isStreaming: false,
    });
  });

  it('maps agent_message item completion to text event', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'Here are some taco recipes.',
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'text',
      text: 'Here are some taco recipes.',
      isStreaming: false,
    });
  });

  it('filters turn_aborted marker noise from agent_message', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'item.completed',
      item: {
        type: 'agent_message',
        text: 'You<turn_aborted>\nThe user interrupted the previous turn on purpose.\n</turn_aborted>',
      },
    });

    expect(events).toHaveLength(0);
  });

  it('maps web_search started/completed to tool_start/tool_result', () => {
    const parser = new CodexJsonEventParser();

    const started = parser.parseEvent({
      type: 'item.started',
      item: {
        id: 'ws_123',
        type: 'web_search',
        query: '',
        action: { type: 'other' },
      },
    });

    const completed = parser.parseEvent({
      type: 'item.completed',
      item: {
        id: 'ws_123',
        type: 'web_search',
        query: 'new taco recipes 2026',
        action: {
          type: 'search',
          query: 'new taco recipes 2026',
          queries: ['new taco recipes 2026'],
        },
      },
    });

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      type: 'tool_start',
      toolName: 'web_search',
    });

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      type: 'tool_result',
      toolName: 'web_search',
    });
  });

  it('maps response_item web_search_call completed to synthetic tool_start/tool_result', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'response_item',
      payload: {
        type: 'web_search_call',
        status: 'completed',
        action: {
          type: 'search',
          query: 'codex web search events',
          queries: ['codex web search events'],
        },
      },
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'tool_start',
      toolName: 'web_search',
      toolInput: {
        actionType: 'search',
        actionQuery: 'codex web search events',
        actionQueries: ['codex web search events'],
        status: 'completed',
      },
    });
    expect(events[1]).toMatchObject({
      type: 'tool_result',
      toolName: 'web_search',
    });
  });

  it('maps command_execution started/completed to Bash tool events', () => {
    const parser = new CodexJsonEventParser();

    const started = parser.parseEvent({
      type: 'item.started',
      item: {
        id: 'cmd_123',
        type: 'command_execution',
        command: '/bin/zsh -lc "tail -n 5 README.md"',
        aggregated_output: '',
        exit_code: null,
        status: 'in_progress',
      },
    });

    const completed = parser.parseEvent({
      type: 'item.completed',
      item: {
        id: 'cmd_123',
        type: 'command_execution',
        command: '/bin/zsh -lc "tail -n 5 README.md"',
        aggregated_output: 'line1\nline2\n',
        exit_code: 0,
        status: 'completed',
      },
    });

    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      type: 'tool_start',
      toolName: 'Bash',
      toolInput: {
        command: '/bin/zsh -lc "tail -n 5 README.md"',
        status: 'in_progress',
      },
    });

    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      type: 'tool_result',
      toolName: 'Bash',
      toolOutput: 'line1\nline2\n',
    });
  });

  it('infers append edit from printf redirect command', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'item.completed',
      item: {
        id: 'cmd_456',
        type: 'command_execution',
        command: '/usr/bin/zsh -lc "printf \'\\nLine added.\\n\' >> README.md && tail -n 5 README.md"',
        aggregated_output: 'MIT\n\nAdded line.\nThis line was added as requested.\n\nLine added.\n',
        exit_code: 0,
        status: 'completed',
      },
    });

    const editStart = events.find((event) => event.type === 'tool_start' && event.toolName === 'Edit');
    expect(editStart).toMatchObject({
      type: 'tool_start',
      toolName: 'Edit',
      toolInput: {
        file_path: './README.md',
        operation: 'append',
        old_string: '',
        new_string: '\nLine added.\n',
      },
    });
  });

  it('maps turn.completed usage to step_complete tokens', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'turn.completed',
      usage: {
        input_tokens: 24450,
        cached_input_tokens: 7040,
        output_tokens: 1030,
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'step_complete',
      tokens: {
        input: 24450,
        output: 1030,
        cacheRead: 7040,
      },
    });
  });

  it('emits text fallback for unhandled codex event types', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'mystery.event',
      payload: { foo: 'bar' },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'text',
      isStreaming: false,
    });
    expect((events[0] as any).text).toContain('[codex-event]');
    expect((events[0] as any).text).toContain('mystery.event');
  });

  it('ignores invalid json lines', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseLine('{invalid');
    expect(events).toEqual([]);
  });

  it('silently ignores event_msg.token_count', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 1000, output_tokens: 200 } },
        rate_limits: { primary: { used_percent: 39 } },
      },
    });
    expect(events).toHaveLength(0);
  });

  it('maps event_msg.agent_reasoning to thinking event', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'event_msg',
      payload: {
        type: 'agent_reasoning',
        text: 'Adding fallback helper and branches',
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'thinking',
      text: 'Adding fallback helper and branches',
      isStreaming: false,
    });
  });

  it('silently ignores turn.started', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({ type: 'turn.started' });
    expect(events).toHaveLength(0);
  });

  it('silently ignores thread.started', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'thread.started',
      thread_id: '019c9bf5-4abe-7c92-817c-e04d3bc4ca97',
    });
    expect(events).toHaveLength(0);
  });

  it('silently ignores event_msg.turn_aborted', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'event_msg',
      payload: { type: 'turn_aborted', reason: 'interrupted' },
    });
    expect(events).toHaveLength(0);
  });

  it('maps event_msg.task_complete to formatted text from last_agent_message', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: '019c9bff-3b84-7e81-8c2e-e9afa20399be',
        last_agent_message: 'Done.\n\n1. Fixed the bug\n2. Updated tests',
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'text',
      text: 'Done.\n\n1. Fixed the bug\n2. Updated tests',
      isStreaming: false,
    });
  });

  it('silently ignores event_msg.task_complete without last_agent_message', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'event_msg',
      payload: { type: 'task_complete', turn_id: 'abc' },
    });
    expect(events).toHaveLength(0);
  });

  it('maps response_item.reasoning summary to thinking event', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'response_item',
      payload: {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'Analyzing the codebase structure' }],
        content: null,
        encrypted_content: 'gAAAA_encrypted_data...',
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'thinking',
      text: 'Analyzing the codebase structure',
      isStreaming: false,
    });
  });

  it('maps response_item.custom_tool_call for apply_patch to inferred Edit events', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        status: 'completed',
        call_id: 'call_abc123',
        name: 'apply_patch',
        input: '*** Begin Patch\n*** Update File: src/foo.ts\n@@\n-old line\n+new line\n*** End Patch',
      },
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    const editStart = events.find((e) => e.type === 'tool_start' && e.toolName === 'Edit');
    expect(editStart).toBeDefined();
    expect(editStart?.toolInput?.file_path).toContain('foo.ts');
  });

  it('maps response_item.custom_tool_call for non-patch tool to generic tool_start', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        status: 'completed',
        call_id: 'call_xyz',
        name: 'my_custom_tool',
        input: 'some input',
      },
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'tool_start',
      toolName: 'my_custom_tool',
    });
  });

  it('maps response_item.custom_tool_call_output to tool_result', () => {
    const parser = new CodexJsonEventParser();
    // First register the call_id -> toolName mapping
    parser.parseEvent({
      type: 'response_item',
      payload: {
        type: 'custom_tool_call',
        call_id: 'call_out1',
        name: 'apply_patch',
        input: '*** Begin Patch\n*** End Patch',
      },
    });

    const events = parser.parseEvent({
      type: 'response_item',
      payload: {
        type: 'custom_tool_call_output',
        call_id: 'call_out1',
        output: '{"output":"Success. Updated the following files:\\nM src/foo.ts\\n","metadata":{"exit_code":0}}',
      },
    });

    expect(events.length).toBeGreaterThanOrEqual(1);
    const result = events.find((e) => e.type === 'tool_result');
    expect(result).toBeDefined();
    expect(result?.toolOutput).toContain('Success');
  });

  it('silently ignores item.completed file_change', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseEvent({
      type: 'item.completed',
      item: {
        id: 'item_9',
        type: 'file_change',
        status: 'completed',
      },
    });
    expect(events).toHaveLength(0);
  });

  it('enriches inferred shell edits with git-backed old/new content', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-parser-'));
    try {
      execFileSync('git', ['init'], { cwd: tempDir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tempDir, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'Codex Parser Test'], { cwd: tempDir, stdio: 'ignore' });

      const readmePath = path.join(tempDir, 'README.md');
      fs.writeFileSync(readmePath, 'MIT\n', 'utf8');
      execFileSync('git', ['add', 'README.md'], { cwd: tempDir, stdio: 'ignore' });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: tempDir, stdio: 'ignore' });

      fs.writeFileSync(readmePath, 'MIT\nLine added.\n', 'utf8');

      const parser = new CodexJsonEventParser({
        enableFileDiffEnrichment: true,
        workingDirectory: tempDir,
      });

      const events = parser.parseEvent({
        type: 'item.completed',
        item: {
          id: 'cmd_789',
          type: 'command_execution',
          command: '/usr/bin/zsh -lc "printf \'Line added.\\n\' >> README.md"',
          aggregated_output: '',
          exit_code: 0,
          status: 'completed',
        },
      });

      const editStart = events.find((event) => event.type === 'tool_start' && event.toolName === 'Edit');
      expect(editStart).toMatchObject({
        type: 'tool_start',
        toolName: 'Edit',
        toolInput: {
          file_path: './README.md',
          old_string: 'MIT\n',
          new_string: 'MIT\nLine added.\n',
        },
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
