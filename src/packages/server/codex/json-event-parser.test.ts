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

  it('ignores invalid json lines', () => {
    const parser = new CodexJsonEventParser();
    const events = parser.parseLine('{invalid');
    expect(events).toEqual([]);
  });
});
