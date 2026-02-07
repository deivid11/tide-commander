import { describe, expect, it } from 'vitest';
import { CodexBackend } from './backend.js';

describe('CodexBackend', () => {
  it('builds exec args for a fresh run', () => {
    const backend = new CodexBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      prompt: 'find recent taco recipes',
    });

    expect(args).toEqual([
      'exec',
      '--json',
      '--full-auto',
      '-C',
      '/tmp/project',
      'find recent taco recipes',
    ]);
  });

  it('builds exec resume args when session id exists', () => {
    const backend = new CodexBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      sessionId: '019c3925-c665-7b70-8711-d63bf7d8bda0',
      prompt: 'continue',
    });

    expect(args).toEqual([
      'exec',
      '--json',
      '--full-auto',
      '-C',
      '/tmp/project',
      'resume',
      '019c3925-c665-7b70-8711-d63bf7d8bda0',
      'continue',
    ]);
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

    expect(args).toEqual([
      'exec',
      '--json',
      '--ask-for-approval',
      'never',
      '--sandbox',
      'read-only',
      '--search',
      '--profile',
      'ci',
      '-C',
      '/tmp/project',
      'continue',
    ]);
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
    expect(args[1]).toBe('--json');
    expect(args[2]).toBe('--full-auto');
    expect(args[3]).toBe('-C');
    expect(args[4]).toBe('/tmp/project');

    const promptArg = args[5];
    expect(promptArg).toContain('Follow all instructions below for this task.');
    expect(promptArg).toContain('## Agent Instructions');
    expect(promptArg).toContain('# Skills\n- Use grep skill first');
    expect(promptArg).toContain('## System Context');
    expect(promptArg).toContain('You are operating as team lead.');
    expect(promptArg).toContain('## User Request');
    expect(promptArg).toContain('Implement the feature');
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

    expect(args[5]).toBe('resume');
    expect(args[6]).toBe('thread-123');
    expect(args[7]).toContain('Always apply assigned skills.');
    expect(args[7]).toContain('## User Request');
    expect(args[7]).toContain('continue');
  });
});
