/**
 * Tests for ClaudeBackend event parsing and utility functions
 *
 * Covers: parseEvent (all event types), extractSessionId,
 * parseContextOutput, formatStdinInput
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import { ClaudeBackend, parseContextOutput } from './backend.js';
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

    describe('model selection', () => {
      const baseConfig = {
        agentId: 'agent-123',
        prompt: 'Do the task',
        workingDir: '/tmp/project',
      };

      function modelArg(model: string): string | undefined {
        const backend = new ClaudeBackend();
        const args = backend.buildArgs({ ...baseConfig, model } as never);
        const flagIndex = args.indexOf('--model');
        return flagIndex === -1 ? undefined : args[flagIndex + 1];
      }

      it('translates the claude-sonnet-5[1m] label to the bare claude-sonnet-5 id', () => {
        expect(modelArg('claude-sonnet-5[1m]')).toBe('claude-sonnet-5');
      });

      it('passes the plain claude-sonnet-5 id through unchanged', () => {
        expect(modelArg('claude-sonnet-5')).toBe('claude-sonnet-5');
      });

      it('still translates the existing [1m]-suffixed labels unchanged', () => {
        expect(modelArg('opus[1m]')).toBe('claude-opus-4-7');
        expect(modelArg('claude-opus-4-8[1m]')).toBe('claude-opus-4-8');
        expect(modelArg('claude-fable-5[1m]')).toBe('claude-fable-5');
      });

      it('omits --model when no model is configured', () => {
        const backend = new ClaudeBackend();
        const args = backend.buildArgs({ ...baseConfig } as never);
        expect(args).not.toContain('--model');
      });
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

      // A single turn routinely bills the conversation model plus a short
      // auxiliary Haiku call (web search, titles). `modelUsage` key order
      // follows first use, so the helper is frequently first — attributing its
      // 200k window to the agent collapsed the context meter.
      it('attributes modelUsage to the model the main loop streamed, not the first key', () => {
        backend.parseEvent(
          {
            type: 'assistant',
            uuid: 'assistant-1',
            message: {
              model: 'claude-opus-5',
              content: [{ type: 'text', text: 'working' }],
              usage: { input_tokens: 2, cache_read_input_tokens: 400000 },
            },
          },
          'agent-multi'
        );

        const result = backend.parseEvent(
          {
            type: 'result',
            total_cost_usd: 0.5,
            modelUsage: {
              'claude-haiku-4-5-20251001': {
                contextWindow: 200000,
                maxOutputTokens: 32000,
                inputTokens: 31131,
                outputTokens: 1545,
                cacheReadInputTokens: 0,
                cacheCreationInputTokens: 0,
              },
              'claude-opus-5': {
                contextWindow: 1000000,
                maxOutputTokens: 64000,
                inputTokens: 472,
                outputTokens: 74547,
                cacheReadInputTokens: 7126923,
                cacheCreationInputTokens: 132402,
              },
            },
          },
          'agent-multi'
        ) as StandardEvent;

        expect(result.modelUsage?.contextWindow).toBe(1000000);
        expect(result.modelUsage?.cacheReadInputTokens).toBe(7126923);
      });

      it('falls back to the dominant prompt footprint when the main model is unknown', () => {
        const result = backend.parseEvent({
          type: 'result',
          total_cost_usd: 0.5,
          modelUsage: {
            'claude-haiku-4-5-20251001': {
              contextWindow: 200000,
              maxOutputTokens: 32000,
              inputTokens: 31131,
              outputTokens: 1545,
            },
            'claude-opus-5': {
              contextWindow: 1000000,
              maxOutputTokens: 64000,
              inputTokens: 472,
              outputTokens: 74547,
              cacheReadInputTokens: 7126923,
              cacheCreationInputTokens: 132402,
            },
          },
        }) as StandardEvent;

        expect(result.modelUsage?.contextWindow).toBe(1000000);
      });

      it('ignores subagent model when attributing the parent turn', () => {
        backend.parseEvent(
          {
            type: 'assistant',
            uuid: 'parent-1',
            message: {
              model: 'claude-opus-5',
              content: [{ type: 'text', text: 'spawning' }],
            },
          },
          'agent-sub'
        );
        backend.parseEvent(
          {
            type: 'assistant',
            uuid: 'child-1',
            parent_tool_use_id: 'toolu_child',
            message: {
              model: 'claude-haiku-4-5-20251001',
              content: [{ type: 'text', text: 'subagent output' }],
            },
          },
          'agent-sub'
        );

        const result = backend.parseEvent(
          {
            type: 'result',
            total_cost_usd: 0.1,
            modelUsage: {
              'claude-haiku-4-5-20251001': { contextWindow: 200000, inputTokens: 9_000_000, outputTokens: 10 },
              'claude-opus-5': { contextWindow: 1000000, inputTokens: 100, outputTokens: 10 },
            },
          },
          'agent-sub'
        ) as StandardEvent;

        expect(result.modelUsage?.contextWindow).toBe(1000000);
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
      it('mints a stable stream uuid across text_delta chunks (outer event uuids differ)', () => {
        backend.parseEvent({
          type: 'stream_event',
          uuid: 'evt-start',
          event: {
            type: 'message_start',
            message: { id: 'msg_abc' },
          },
        });

        const a = backend.parseEvent({
          type: 'stream_event',
          uuid: 'evt-delta-1',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hel' },
          },
        });
        const b = backend.parseEvent({
          type: 'stream_event',
          uuid: 'evt-delta-2',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'lo' },
          },
        });

        expect(a).toEqual({
          type: 'text',
          text: 'Hel',
          isStreaming: true,
          uuid: 'claude-stream-msg_abc-text-0',
        });
        expect(b).toEqual({
          type: 'text',
          text: 'lo',
          isStreaming: true,
          uuid: 'claude-stream-msg_abc-text-0',
        });
        // Same uuid → client merges into one typewriter row
        expect((a as any).uuid).toBe((b as any).uuid);
      });

      it('keeps stream state isolated per agent (one backend serves all agents)', () => {
        // Agent A opens a message, then agent B opens ITS OWN message — B's
        // message_start must not reset A's stream uuids (that used to drop A's
        // deltas / split A's bubble when two Claude agents streamed at once).
        backend.parseEvent({
          type: 'stream_event',
          uuid: 'a-start',
          event: { type: 'message_start', message: { id: 'msg_A' } },
        }, 'agent-a');
        backend.parseEvent({
          type: 'stream_event',
          uuid: 'b-start',
          event: { type: 'message_start', message: { id: 'msg_B' } },
        }, 'agent-b');

        const aDelta = backend.parseEvent({
          type: 'stream_event',
          uuid: 'a-delta',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'from A' },
          },
        }, 'agent-a');
        const bDelta = backend.parseEvent({
          type: 'stream_event',
          uuid: 'b-delta',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'from B' },
          },
        }, 'agent-b');

        expect((aDelta as any).uuid).toBe('claude-stream-msg_A-text-0');
        expect((bDelta as any).uuid).toBe('claude-stream-msg_B-text-0');

        // A's finalize must not suppress B's still-live deltas.
        backend.parseEvent({
          type: 'assistant',
          uuid: 'a-final',
          message: {
            id: 'msg_A',
            content: [{ type: 'text', text: 'from A' }],
          },
        }, 'agent-a');
        const bDelta2 = backend.parseEvent({
          type: 'stream_event',
          uuid: 'b-delta-2',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: ' more B' },
          },
        }, 'agent-b');
        expect(bDelta2).not.toBeNull();
        expect((bDelta2 as any).uuid).toBe('claude-stream-msg_B-text-0');
      });

      it('parses thinking_delta streaming with a stable stream uuid', () => {
        backend.parseEvent({
          type: 'stream_event',
          uuid: 'evt-start',
          event: { type: 'message_start', message: { id: 'msg_think' } },
        });
        const result = backend.parseEvent({
          type: 'stream_event',
          uuid: 'think-uuid-1',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', text: 'Let me think...' },
          },
        });

        expect(result).toEqual({
          type: 'thinking',
          text: 'Let me think...',
          isStreaming: true,
          uuid: 'claude-stream-msg_think-thinking-0',
        });
      });

      it('parses content_block_start with stream uuid', () => {
        backend.parseEvent({
          type: 'stream_event',
          uuid: 'evt-start',
          event: { type: 'message_start', message: { id: 'msg_block' } },
        });
        const result = backend.parseEvent({
          type: 'stream_event',
          uuid: 'block-uuid',
          event: {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'text' },
          },
        });

        expect(result).toEqual({
          type: 'block_start',
          blockType: 'text',
          uuid: 'claude-stream-msg_block-text-0',
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

      it('returns null for message_start (state only)', () => {
        const result = backend.parseEvent({
          type: 'stream_event',
          event: { type: 'message_start', message: { id: 'msg_x' } },
        });
        expect(result).toBeNull();
      });

      it('final assistant text reuses the stream uuid so the row finalizes', () => {
        backend.parseEvent({
          type: 'stream_event',
          uuid: 's1',
          event: { type: 'message_start', message: { id: 'msg_final' } },
        });
        backend.parseEvent({
          type: 'stream_event',
          uuid: 's2',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hi' },
          },
        });
        const result = backend.parseEvent({
          type: 'assistant',
          uuid: 'assistant-outer-uuid',
          message: {
            id: 'msg_final',
            content: [{ type: 'text', text: 'Hi there' }],
          },
        });
        const events = Array.isArray(result) ? result : [result];
        const textEv = events.find((e: any) => e?.type === 'text');
        expect(textEv).toMatchObject({
          type: 'text',
          text: 'Hi there',
          isStreaming: false,
          uuid: 'claude-stream-msg_final-text-0',
        });
      });

      it('does not reset stream uuids on thinking-only assistant (avoids duplicate bubbles)', () => {
        // Real Claude order with --include-partial-messages + thinking:
        // message_start → thinking block 0 → intermediate assistant(thinking) →
        // text block 1 deltas → final assistant(text only at content[0]).
        backend.parseEvent({
          type: 'stream_event',
          uuid: 's0',
          event: { type: 'message_start', message: { id: 'msg_think_text' } },
        });
        backend.parseEvent({
          type: 'stream_event',
          uuid: 's1',
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', text: 'hmm' },
          },
        });
        // Intermediate assistant: thinking only — must NOT wipe stream state.
        backend.parseEvent({
          type: 'assistant',
          uuid: 'asst-thinking',
          message: {
            id: 'msg_think_text',
            content: [{ type: 'thinking', thinking: 'hmm' } as any],
          },
        });
        const delta = backend.parseEvent({
          type: 'stream_event',
          uuid: 's2',
          event: {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'text_delta', text: 'Te explico' },
          },
        });
        expect(delta).toMatchObject({
          type: 'text',
          text: 'Te explico',
          isStreaming: true,
          // Still keyed by the original message id (not "anon")
          uuid: 'claude-stream-msg_think_text-text-1',
        });
        // Final assistant content array has text at index 0 (thinking stripped),
        // but stream block was index 1 — must still reuse the text stream uuid.
        const final = backend.parseEvent({
          type: 'assistant',
          uuid: 'asst-final-outer',
          message: {
            id: 'msg_think_text',
            content: [{ type: 'text', text: 'Te explico paso a paso' }],
          },
        });
        const events = Array.isArray(final) ? final : [final];
        const textEv = events.find((e: any) => e?.type === 'text');
        expect(textEv).toMatchObject({
          type: 'text',
          text: 'Te explico paso a paso',
          isStreaming: false,
          uuid: 'claude-stream-msg_think_text-text-1',
        });
      });

      it('buildArgs includes --include-partial-messages for token streaming', () => {
        const args = backend.buildArgs({
          agentId: 'a1',
          prompt: 'hi',
          workingDir: '/tmp',
        } as never);
        expect(args).toContain('--include-partial-messages');
        expect(args).toContain('--output-format');
        expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
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
        expect(result.uuid).toBe('tu-abc');
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

      it('reclassifies background Task launch stub as task_started', () => {
        backend.parseEvent({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'tu-bg-1', name: 'Agent', input: { description: 'Map stuff' } },
            ],
          },
        });

        const result = backend.parseEvent({
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu-bg-1',
                content: 'Async agent launched successfully. The agent is working in the background.',
              },
            ],
          },
        }) as StandardEvent;

        expect(result.type).toBe('task_started');
        expect(result.toolUseId).toBe('tu-bg-1');
      });

      it('keeps real Task tool_result as tool_result', () => {
        backend.parseEvent({
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', id: 'tu-fg-1', name: 'Agent', input: { description: 'Map stuff' } },
            ],
          },
        });

        const result = backend.parseEvent({
          type: 'user',
          message: {
            content: [
              { type: 'tool_result', tool_use_id: 'tu-fg-1', content: 'Here is the full report.' },
            ],
          },
        }) as StandardEvent;

        expect(result.type).toBe('tool_result');
        expect(result.toolUseId).toBe('tu-fg-1');
      });

      it('parses task_notification from user text blocks', () => {
        const result = backend.parseEvent({
          type: 'user',
          message: {
            content: [
              {
                type: 'text',
                text: '<task-notification>\n<task-id>abc123</task-id>\n<tool-use-id>tu-bg-2</tool-use-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n</task-notification>',
              },
            ],
          },
        }) as StandardEvent;

        expect(result.type).toBe('task_notification');
        expect(result.toolUseId).toBe('tu-bg-2');
        expect(result.taskId).toBe('abc123');
      });

      it('parses system task_started into task_started event', () => {
        const result = backend.parseEvent({
          type: 'system',
          subtype: 'task_started',
          task_id: 'task-9',
          tool_use_id: 'tu-bg-3',
        }) as StandardEvent;

        expect(result.type).toBe('task_started');
        expect(result.taskId).toBe('task-9');
        expect(result.toolUseId).toBe('tu-bg-3');
      });

      it('parses system task_notification into task_notification event', () => {
        const result = backend.parseEvent({
          type: 'system',
          subtype: 'task_notification',
          task_id: 'task-9',
          tool_use_id: 'tu-bg-3',
        }) as StandardEvent;

        expect(result.type).toBe('task_notification');
        expect(result.taskId).toBe('task-9');
        expect(result.toolUseId).toBe('tu-bg-3');
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
