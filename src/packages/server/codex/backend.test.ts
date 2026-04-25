import { describe, expect, it } from 'vitest';
import { CodexBackend } from './backend.js';

describe('CodexBackend', () => {
  it('builds exec args for a fresh run and caches the prompt for stdin', () => {
    const backend = new CodexBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      prompt: 'find recent taco recipes',
    });

    expect(args[0]).toBe('exec');
    expect(args[1]).toBe('--experimental-json');
    expect(args[2]).toBe('--enable');
    expect(args[3]).toBe('multi_agent');
    expect(args[4]).toBe('--dangerously-bypass-approvals-and-sandbox');
    expect(args[5]).toBe('-C');
    expect(args[6]).toBe('/tmp/project');
    // Prompt is delivered via stdin; positional '-' tells codex to read it
    expect(args[7]).toBe('-');

    const stdin = backend.formatStdinInput('ignored-fallback');
    expect(stdin).toContain('find recent taco recipes');
    expect(stdin).toContain('## User Request');
    expect(stdin).toContain('Tide Commander');
  });

  it('builds exec resume args when session id exists', () => {
    const backend = new CodexBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      sessionId: '019c3925-c665-7b70-8711-d63bf7d8bda0',
      prompt: 'continue',
    });

    expect(args[0]).toBe('exec');
    expect(args[1]).toBe('--experimental-json');
    expect(args[2]).toBe('--enable');
    expect(args[3]).toBe('multi_agent');
    expect(args[4]).toBe('--dangerously-bypass-approvals-and-sandbox');
    expect(args[5]).toBe('-C');
    expect(args[6]).toBe('/tmp/project');
    expect(args[7]).toBe('resume');
    expect(args[8]).toBe('019c3925-c665-7b70-8711-d63bf7d8bda0');
    expect(args[9]).toBe('-');

    const stdin = backend.formatStdinInput('ignored-fallback');
    expect(stdin).toContain('continue');
    expect(stdin).toContain('## User Request');
  });

  it('builds explicit approval/sandbox args when fullAuto is disabled', () => {
    const backend = new CodexBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      prompt: 'continue',
      codexConfig: {
        fullAuto: false,
        approvalMode: 'never',
        sandbox: 'read-only',
        search: true,
        profile: 'ci',
      },
    });

    expect(args[0]).toBe('exec');
    expect(args[1]).toBe('--experimental-json');
    expect(args[2]).toBe('--enable');
    expect(args[3]).toBe('multi_agent');
    expect(args[4]).toBe('--ask-for-approval');
    expect(args[5]).toBe('never');
    expect(args[6]).toBe('--sandbox');
    expect(args[7]).toBe('read-only');
    expect(args[8]).toBe('--search');
    expect(args[9]).toBe('--profile');
    expect(args[10]).toBe('ci');
    expect(args[11]).toBe('-C');
    expect(args[12]).toBe('/tmp/project');
    expect(args[13]).toBe('-');

    const stdin = backend.formatStdinInput('ignored-fallback');
    expect(stdin).toContain('continue');
    expect(stdin).toContain('## User Request');
  });

  it('extracts thread id as session id', () => {
    const backend = new CodexBackend();
    const sessionId = backend.extractSessionId({
      type: 'thread.started',
      thread_id: '019c3925-c665-7b70-8711-d63bf7d8bda0',
    });

    expect(sessionId).toBe('019c3925-c665-7b70-8711-d63bf7d8bda0');
  });

  it('injects custom agent and system prompts into codex task prompt', () => {
    const backend = new CodexBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      prompt: 'Implement the feature',
      systemPrompt: 'You are operating as team lead.',
      customAgent: {
        name: 'scout',
        definition: {
          description: 'Scout agent',
          prompt: '# Skills\n- Use grep skill first',
        },
      },
    });

    expect(args[0]).toBe('exec');
    expect(args[1]).toBe('--experimental-json');
    expect(args[2]).toBe('--enable');
    expect(args[3]).toBe('multi_agent');
    expect(args[4]).toBe('--dangerously-bypass-approvals-and-sandbox');
    expect(args[5]).toBe('-C');
    expect(args[6]).toBe('/tmp/project');
    expect(args[7]).toBe('-');

    const stdin = backend.formatStdinInput('ignored-fallback');
    expect(stdin).toContain('Follow all instructions below for this task.');
    expect(stdin).toContain('## Agent Instructions');
    expect(stdin).toContain('# Skills\n- Use grep skill first');
    expect(stdin).toContain('## System Context');
    expect(stdin).toContain('You are operating as team lead.');
    expect(stdin).toContain('## User Request');
    expect(stdin).toContain('Implement the feature');
  });

  it('injects custom prompts for resume runs too', () => {
    const backend = new CodexBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      sessionId: 'thread-123',
      prompt: 'continue',
      customAgent: {
        name: 'scout',
        definition: {
          description: 'Scout agent',
          prompt: 'Always apply assigned skills.',
        },
      },
    });

    expect(args[7]).toBe('resume');
    expect(args[8]).toBe('thread-123');
    expect(args[9]).toBe('-');

    const stdin = backend.formatStdinInput('ignored-fallback');
    expect(stdin).toContain('Always apply assigned skills.');
    expect(stdin).toContain('## User Request');
    expect(stdin).toContain('continue');
  });

  it('stdin input consumption clears the cached prompt', () => {
    const backend = new CodexBackend();
    backend.buildArgs({
      workingDir: '/tmp/project',
      prompt: 'first turn',
    });
    const first = backend.formatStdinInput('fallback');
    expect(first).toContain('first turn');

    // A subsequent formatStdinInput without buildArgs falls back to the raw
    // message — used by the runner.sendMessage path when the agent is still
    // alive and only a fresh user message needs delivering.
    const second = backend.formatStdinInput('fallback text');
    expect(second).toBe('fallback text');
  });

  it('requires stdin input and closes stdin after delivering the prompt', () => {
    const backend = new CodexBackend();
    expect(backend.requiresStdinInput()).toBe(true);
    expect(backend.shouldCloseStdinAfterPrompt?.()).toBe(true);
  });

  it('always enables the multi_agent feature flag (replaces deprecated [features].collab)', () => {
    const backend = new CodexBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      prompt: 'anything',
    });

    const enableIdx = args.indexOf('--enable');
    expect(enableIdx).toBeGreaterThanOrEqual(0);
    expect(args[enableIdx + 1]).toBe('multi_agent');
    // We must never re-introduce the deprecated `collab` feature value.
    expect(args).not.toContain('collab');
  });
});
