/**
 * Tests for buildInteractiveClaudeArgs model-label translation
 * (mirrors ClaudeBackend.buildArgs's '[1m]'-suffix handling).
 */

import { describe, it, expect, vi } from 'vitest';

// Mock fs to avoid file system side effects from writePromptToFile
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { buildInteractiveClaudeArgs } from './interactive-backend-args.js';

describe('buildInteractiveClaudeArgs', () => {
  const opts = { sessionId: 'session-123', resume: false };

  function modelArg(model: string): string | undefined {
    const args = buildInteractiveClaudeArgs(
      { agentId: 'agent-123', prompt: 'Do the task', workingDir: '/tmp/project', model } as never,
      opts,
    );
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
    const args = buildInteractiveClaudeArgs(
      { agentId: 'agent-123', prompt: 'Do the task', workingDir: '/tmp/project' } as never,
      opts,
    );
    expect(args).not.toContain('--model');
  });
});
