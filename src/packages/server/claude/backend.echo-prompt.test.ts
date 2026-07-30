/**
 * Echo Prompt must not corrupt bare slash commands.
 *
 * Duplicating `/compact` into `/compact\n\n---\n\n/compact` stops the CLI from
 * seeing a bare command, so it lands as plain text and the compaction never
 * runs. Codex and OpenCode already skip echo for these; this pins the same
 * behaviour for Claude.
 */

import { describe, it, expect, vi } from 'vitest';

const mockIsEchoPromptEnabled = vi.hoisted(() => vi.fn(() => true));

vi.mock('../services/system-prompt-service.js', () => ({
  isEchoPromptEnabled: mockIsEchoPromptEnabled,
  getSystemPrompt: vi.fn(() => ''),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe('formatStdinInput with Echo Prompt enabled', () => {
  it('leaves a bare slash command untouched', async () => {
    const { ClaudeBackend } = await import('./backend.js');
    const backend = new ClaudeBackend();

    for (const cmd of ['/compact', '/clear', '/context', '/cost']) {
      const parsed = JSON.parse(backend.formatStdinInput(cmd));
      expect(parsed.message.content).toBe(cmd);
    }
  });

  it('still echoes an ordinary prompt', async () => {
    const { ClaudeBackend } = await import('./backend.js');
    const backend = new ClaudeBackend();

    const parsed = JSON.parse(backend.formatStdinInput('Fix the login bug'));
    expect(parsed.message.content).toBe('Fix the login bug\n\n---\n\nFix the login bug');
  });

  it('echoes a slash command that carries arguments (not a bare command)', async () => {
    const { ClaudeBackend } = await import('./backend.js');
    const backend = new ClaudeBackend();

    const parsed = JSON.parse(backend.formatStdinInput('/review PR 14'));
    expect(parsed.message.content).toContain('---');
  });
});
