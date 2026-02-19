/**
 * Tests for ClaudeBackend event parsing and utility functions
 *
 * Covers: parseEvent (all event types), extractSessionId,
 * parseContextOutput, parseUsageOutput, formatStdinInput
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import { ClaudeBackend, parseContextOutput, parseUsageOutput } from './backend.js';
import type { StandardEvent } from './types.js';

// Mock fs/os to avoid file system side effects from buildArgs
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe('ClaudeBackend', () => {
  describe('buildArgs', () => {
    it('merges Tide, class instructions, and system prompt into one appended project block', () => {
      vi.mocked(fs.writeFileSync).mockClear();

      const backend = new ClaudeBackend();
      const args = backend.buildArgs({
        agentId: 'agent-123',
        prompt: 'Do the task',
        workingDir: '/tmp/project',
        customAgent: {
          name: 'caterpie-1',
          definition: {
            description: 'Custom class',
            prompt: 'Run lint before release.',
          },
        },
        systemPrompt: 'Boss context here.',
      });

      const appendFlags = args.filter((arg) => arg === '--append-system-prompt-file');
      expect(appendFlags).toHaveLength(1);

      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      const mergedContent = String(writeCalls[writeCalls.length - 1]?.[1] ?? '');

      expect(mergedContent).toContain('CLAUDE.md / Project instructions');
      expect(mergedContent).toContain('## Tide Commander Appended Instructions');
      expect(mergedContent).toContain('## Agent Class Instructions');
      expect(mergedContent).toContain('Run lint before release.');
      expect(mergedContent).toContain('## Runtime System Context');
      expect(mergedContent).toContain('Boss context here.');
    });
  });

  describe('parseEvent', () => {
    const backend = new ClaudeBackend();

    describe('system events', () => {
      it('parses init event with session and model', () => {
        const result = backend.parseEvent({
          type: 'system',
          subtype: 'init',
          session_id: 'sess-abc',
          model: 'claude-opus-4-6',
          tools: ['Bash', 'Read', 'Write'],
        });

        expect(result).toEqual({
          type: 'init',
          sessionId: 'sess-abc',
          model: 'claude-opus-4-6',
          tools: ['Bash', 'Read', 'Write'],
        });
      });

      it('parses error event', () => {
        const result = backend.parseEvent({
          type: 'system',
          subtype: 'error',
          error: 'Rate limited',
        });

        expect(result).toEqual({
          type: 'error',
          errorMessage: 'Rate limited',
        });
      });

      it('returns null for unknown system subtypes', () => {
        const result = backend.parseEvent({
          type: 'system',
          subtype: 'heartbeat',
        });
        expect(result).toBeNull();
      });
    });

    describe('assistant events', () => {
      it('extracts text blocks with UUID', () => {
        const result = backend.parseEvent({
          type: 'assistant',
          uuid: 'msg-uuid-123',
          message: {
            content: [
              { type: 'text', text: 'Hello world' },
            ],
          },
        });

        expect(result).toEqual({
          type: 'text',
          text: 'Hello world',
          isStreaming: false,
          uuid: 'msg-uuid-123',
        });
      });

      it('extracts tool_use blocks with metadata', () => {
        const result = backend.parseEvent({
          type: 'assistant',
          uuid: 'msg-uuid-456',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'Bash',
                input: { command: 'ls -la' },
              },
            ],
          },
        });

        expect(result).toMatchObject({
          type: 'tool_start',
          toolName: 'Bash',
          toolInput: { command: 'ls -la' },
          toolUseId: 'tool-1',
          uuid: 'tool-1',
        });
      });

      it('extracts Task tool subagent metadata', () => {
        const result = backend.parseEvent({
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tool-task-1',
                name: 'Task',
                input: {
                  name: 'researcher',
                  description: 'Research the API docs',
                  subagent_type: 'Explore',
                  model: 'haiku',
                },
              },
            ],
          },
        }) as StandardEvent;

        expect(result.subagentName).toBe('researcher');
        expect(result.subagentDescription).toBe('Research the API docs');
        expect(result.subagentType).toBe('Explore');
        expect(result.subagentModel).toBe('haiku');
      });

      it('returns multiple events for mixed text and tool_use', () => {
        const result = backend.parseEvent({
          type: 'assistant',
          uuid: 'msg-mixed',
          message: {
            content: [
              { type: 'text', text: 'Let me check that file.' },
              { type: 'tool_use', id: 'tool-2', name: 'Read', input: { file_path: '/tmp/test.ts' } },
            ],
          },
        });

        expect(Array.isArray(result)).toBe(true);
        const events = result as StandardEvent[];
        expect(events).toHaveLength(2);
        expect(events[0].type).toBe('text');
        expect(events[0].text).toBe('Let me check that file.');
        expect(events[1].type).toBe('tool_start');
        expect(events[1].toolName).toBe('Read');
      });

      it('skips empty/whitespace text blocks', () => {
        const result = backend.parseEvent({
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: '   ' },
              { type: 'text', text: '' },
            ],
          },
        });
        expect(result).toBeNull();
      });

      it('returns null for empty content array', () => {
        const result = backend.parseEvent({
          type: 'assistant',
          message: { content: [] },
        });
        expect(result).toBeNull();
      });
    });

    describe('tool_use events', () => {
      it('parses tool input event', () => {
        const result = backend.parseEvent({
          type: 'tool_use',
          subtype: 'input',
          tool_name: 'Grep',
          input: { pattern: 'TODO', path: '/src' },
        });

        expect(result).toEqual({
          type: 'tool_start',
          toolName: 'Grep',
          toolInput: { pattern: 'TODO', path: '/src' },
        });
      });

      it('parses tool result event (string)', () => {
        const result = backend.parseEvent({
          type: 'tool_use',
          subtype: 'result',
          tool_name: 'Bash',
          result: 'file1.ts\nfile2.ts',
        });

        expect(result).toEqual({
          type: 'tool_result',
          toolName: 'Bash',
          toolOutput: 'file1.ts\nfile2.ts',
        });
      });

      it('parses tool result event (object)', () => {
        const result = backend.parseEvent({
          type: 'tool_use',
          subtype: 'result',
          tool_name: 'Read',
          result: { content: 'file content' },
        });

        expect(result).toMatchObject({
          type: 'tool_result',
          toolName: 'Read',
        });
        // Object results are JSON stringified
        expect((result as StandardEvent).toolOutput).toContain('file content');
      });

      it('returns null for unknown subtype', () => {
        const result = backend.parseEvent({
          type: 'tool_use',
          subtype: 'progress',
          tool_name: 'Bash',
        });
        expect(result).toBeNull();
      });
    });

    describe('result events', () => {
      it('parses step_complete with usage and cost', () => {
        const result = backend.parseEvent({
          type: 'result',
          duration_ms: 5000,
          total_cost_usd: 0.05,
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 800,
          },
        }) as StandardEvent;

        expect(result.type).toBe('step_complete');
        expect(result.durationMs).toBe(5000);
        expect(result.cost).toBe(0.05);
        expect(result.tokens).toEqual({
          input: 1000,
          output: 500,
          cacheCreation: 200,
          cacheRead: 800,
        });
      });

      it('parses modelUsage with context window info', () => {
        const result = backend.parseEvent({
          type: 'result',
          total_cost_usd: 0.01,
          modelUsage: {
            'claude-opus-4-6': {
              contextWindow: 200000,
              maxOutputTokens: 16000,
              inputTokens: 5000,
              outputTokens: 1000,
              cacheReadInputTokens: 3000,
              cacheCreationInputTokens: 500,
            },
          },
        }) as StandardEvent;

        expect(result.modelUsage).toEqual({
          contextWindow: 200000,
          maxOutputTokens: 16000,
          inputTokens: 5000,
          outputTokens: 1000,
          cacheReadInputTokens: 3000,
          cacheCreationInputTokens: 500,
        });
      });

      it('parses result text for boss delegation', () => {
        const result = backend.parseEvent({
          type: 'result',
          result: 'I will delegate this to agent-1',
          total_cost_usd: 0.02,
        }) as StandardEvent;

        expect(result.resultText).toBe('I will delegate this to agent-1');
      });

      it('includes permission denials', () => {
        const result = backend.parseEvent({
          type: 'result',
          total_cost_usd: 0.01,
          permission_denials: [
            { tool_name: 'Bash', tool_use_id: 'tool-1', tool_input: { command: 'rm -rf /' } },
          ],
        }) as StandardEvent;

        expect(result.permissionDenials).toHaveLength(1);
        expect(result.permissionDenials![0].toolName).toBe('Bash');
      });
    });

    describe('stream events', () => {
      it('parses text_delta streaming', () => {
        const result = backend.parseEvent({
          type: 'stream_event',
          uuid: 'stream-uuid-1',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello' },
          },
        });

        expect(result).toEqual({
          type: 'text',
          text: 'Hello',
          isStreaming: true,
          uuid: 'stream-uuid-1',
        });
      });

      it('parses thinking_delta streaming', () => {
        const result = backend.parseEvent({
          type: 'stream_event',
          uuid: 'think-uuid-1',
          event: {
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', text: 'Let me think...' },
          },
        });

        expect(result).toEqual({
          type: 'thinking',
          text: 'Let me think...',
          isStreaming: true,
          uuid: 'think-uuid-1',
        });
      });

      it('parses content_block_start', () => {
        const result = backend.parseEvent({
          type: 'stream_event',
          uuid: 'block-uuid',
          event: {
            type: 'content_block_start',
            content_block: { type: 'text' },
          },
        });

        expect(result).toEqual({
          type: 'block_start',
          blockType: 'text',
          uuid: 'block-uuid',
        });
      });

      it('parses content_block_stop', () => {
        const result = backend.parseEvent({
          type: 'stream_event',
          uuid: 'stop-uuid',
          event: { type: 'content_block_stop' },
        });

        expect(result).toEqual({
          type: 'block_end',
          uuid: 'stop-uuid',
        });
      });

      it('returns null for unknown stream event types', () => {
        const result = backend.parseEvent({
          type: 'stream_event',
          event: { type: 'message_start' },
        });
        expect(result).toBeNull();
      });
    });

    describe('user events (tool_result)', () => {
      it('extracts tool_result from user message content array', () => {
        // First register a tool_use_id mapping via an assistant event
        backend.parseEvent({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'tu-abc', name: 'Bash', input: { command: 'echo hi' } },
            ],
          },
        });

        // Now parse the tool_result
        const result = backend.parseEvent({
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tu-abc', content: 'hi' },
            ],
          },
        }) as StandardEvent;

        expect(result.type).toBe('tool_result');
        expect(result.toolName).toBe('Bash');
        expect(result.toolOutput).toBe('hi');
        expect(result.toolUseId).toBe('tu-abc');
      });

      it('prefers tool_use_result.stdout over block content', () => {
        backend.parseEvent({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'tu-xyz', name: 'Bash', input: {} },
            ],
          },
        });

        const result = backend.parseEvent({
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tu-xyz', content: 'truncated...' },
            ],
          },
          tool_use_result: {
            stdout: 'full output here',
            stderr: 'some warning',
          },
        }) as StandardEvent;

        expect(result.toolOutput).toBe('full output here\n[stderr] some warning');
      });

      it('parses /context output from local-command-stdout', () => {
        const contextOutput = `<local-command-stdout>## Context Usage
**Model:** claude-opus-4-6
**Tokens:** 19.6k / 200.0k (10%)</local-command-stdout>`;

        const result = backend.parseEvent({
          type: 'user',
          message: { content: contextOutput },
        }) as StandardEvent;

        expect(result.type).toBe('context_stats');
        expect(result.contextStatsRaw).toContain('## Context Usage');
      });

      it('parses /usage output from local-command-stdout', () => {
        const usageOutput = `<local-command-stdout>## Usage
Current Session</local-command-stdout>`;

        const result = backend.parseEvent({
          type: 'user',
          message: { content: usageOutput },
        }) as StandardEvent;

        expect(result.type).toBe('usage_stats');
        expect(result.usageStatsRaw).toContain('## Usage');
      });
    });

    it('returns null for unknown event types', () => {
      const result = backend.parseEvent({ type: 'custom_unknown' });
      expect(result).toBeNull();
    });
  });

  describe('extractSessionId', () => {
    const backend = new ClaudeBackend();

    it('extracts session ID from system init event', () => {
      const sessionId = backend.extractSessionId({
        type: 'system',
        subtype: 'init',
        session_id: 'sess-123',
      });
      expect(sessionId).toBe('sess-123');
    });

    it('returns null for non-init events', () => {
      expect(backend.extractSessionId({ type: 'assistant' })).toBeNull();
      expect(backend.extractSessionId({ type: 'system', subtype: 'error' })).toBeNull();
    });

    it('returns null for init without session_id', () => {
      const sessionId = backend.extractSessionId({
        type: 'system',
        subtype: 'init',
      });
      expect(sessionId).toBeNull();
    });
  });

  describe('formatStdinInput', () => {
    const backend = new ClaudeBackend();

    it('formats prompt as stream-json user message', () => {
      const result = backend.formatStdinInput('Hello Claude');
      const parsed = JSON.parse(result);

      expect(parsed.type).toBe('user');
      expect(parsed.message.role).toBe('user');
      expect(parsed.message.content).toBe('Hello Claude');
    });

    it('produces valid JSON', () => {
      const result = backend.formatStdinInput('test with "quotes" and \nnewlines');
      expect(() => JSON.parse(result)).not.toThrow();
    });
  });

  describe('requiresStdinInput', () => {
    it('returns true for Claude backend', () => {
      const backend = new ClaudeBackend();
      expect(backend.requiresStdinInput()).toBe(true);
    });
  });
});

describe('parseContextOutput', () => {
  it('parses full context output', () => {
    const content = `## Context Usage
**Model:** claude-opus-4-6
**Tokens:** 19.6k / 200.0k (10%)

### Categories
| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 3.1k | 1.6% |
| System tools | 16.5k | 8.3% |
| Messages | 8 | 0.0% |
| Free space | 135.4k | 67.7% |
| Autocompact buffer | 45.0k | 22.5% |`;

    const result = parseContextOutput(content);
    expect(result).not.toBeNull();
    expect(result!.model).toBe('claude-opus-4-6');
    expect(result!.usedPercent).toBe(10);
    expect(result!.categories.systemPrompt.percent).toBe(1.6);
    expect(result!.categories.freeSpace.percent).toBe(67.7);
    expect(result!.lastUpdated).toBeGreaterThan(0);
  });

  it('returns null for invalid input', () => {
    expect(parseContextOutput('random text')).toBeNull();
    expect(parseContextOutput('')).toBeNull();
  });

  it('parses comma-separated token counts with decimal percent', () => {
    const content = `## Context Usage
**Model:** claude-opus-4-6
**Tokens:** 46,123 / 200,000 (23.1%)

### Categories
| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 6,700 | 3.4% |
| System tools | 12,479 | 6.2% |
| Messages | 26,944 | 13.5% |
| Free space | 153,877 | 76.9% |
| Autocompact buffer | 0 | 0.0% |`;

    const result = parseContextOutput(content);
    expect(result).not.toBeNull();
    expect(result!.totalTokens).toBe(46123);
    expect(result!.contextWindow).toBe(200000);
    expect(result!.usedPercent).toBe(23.1);
    expect(result!.categories.systemPrompt.tokens).toBe(6700);
  });

  it('parses visual context format', () => {
    const content = `claude-opus-4-6 · 377.3k/1.0m tokens (37.7%)
⛁ System prompt: 6.7k tokens (0.7%)
⛁ System tools: 10.0k tokens (1.0%)
⛁ Messages: 360.6k tokens (36.0%)
⛁ Free space: 622.7k tokens (62.3%)
⛁ Autocompact buffer: 0 tokens (0.0%)`;

    const result = parseContextOutput(content);
    expect(result).not.toBeNull();
    expect(result!.contextWindow).toBe(1000000);
    expect(result!.totalTokens).toBe(377300);
    expect(result!.usedPercent).toBe(37.7);
  });
});

describe('parseUsageOutput', () => {
  it('parses full usage output', () => {
    const content = `## Usage

| Category | % | Reset |
|---|---|---|
| Current Session | 45.2% | Jan 25 at 5:00 PM |
| Current Week (All Models) | 12.3% | Jan 27 at 12:00 AM |
| Current Week (Sonnet Only) | 8.5% | Jan 27 at 12:00 AM |`;

    const result = parseUsageOutput(content);
    expect(result).not.toBeNull();
    expect(result!.session.percentUsed).toBe(45.2);
    expect(result!.weeklyAllModels.percentUsed).toBe(12.3);
    expect(result!.weeklySonnet.percentUsed).toBe(8.5);
    expect(result!.session.resetTime).toBe('Jan 25 at 5:00 PM');
  });

  it('returns null for incomplete usage output', () => {
    const content = `## Usage
| Category | % | Reset |
|---|---|---|
| Current Session | 45.2% | Jan 25 |`;

    expect(parseUsageOutput(content)).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseUsageOutput('')).toBeNull();
  });
});
