import { describe, expect, it } from 'vitest';
import { markInstructionsDirty } from '../services/instruction-refresh.js';
import { buildPiPrompt, PiBackend } from './backend.js';

describe('PiBackend.buildArgs', () => {
  it('builds a fresh headless run with the prompt as the final argv', () => {
    const backend = new PiBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      prompt: 'do the thing',
    });

    expect(args.slice(0, 3)).toEqual(['--mode', 'json', '-p']);
    expect(args).toContain('--extension');
    expect(args[args.indexOf('--extension') + 1]).toMatch(/detailed-reasoning-extension\.(?:ts|js)$/);
    expect(args).not.toContain('--session');
    expect(args).not.toContain('--fork');
    // Prompt is the last argument (instruction block included on first run).
    expect(args[args.length - 1]).toContain('do the thing');
  });

  it('resumes a session with --session and no --fork', () => {
    const backend = new PiBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      sessionId: '019ff4bc-44ba-737c-ae6c-6c19e44fe904',
      prompt: 'continue',
    });

    expect(args).toContain('--session');
    expect(args[args.indexOf('--session') + 1]).toBe('019ff4bc-44ba-737c-ae6c-6c19e44fe904');
    expect(args).not.toContain('--fork');
  });

  it('forks the source session with --fork on the first fork run', () => {
    const backend = new PiBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      sessionId: 'source-session-id',
      forkSession: true,
      prompt: 'continue from the forked history',
    });

    expect(args).toContain('--fork');
    expect(args[args.indexOf('--fork') + 1]).toBe('source-session-id');
    expect(args).not.toContain('--session');
  });

  it('passes provider/model patterns but rejects cross-provider leaks', () => {
    const backend = new PiBackend();
    const withModel = backend.buildArgs({
      workingDir: '/tmp/project',
      model: 'anthropic/claude-sonnet-4-5',
      prompt: 'hi',
    });
    expect(withModel[withModel.indexOf('--model') + 1]).toBe('anthropic/claude-sonnet-4-5');

    for (const leaked of ['claude-opus-4-8[1m]', 'gpt-5.6-luna', 'grok-4.5']) {
      const args = backend.buildArgs({ workingDir: '/tmp/project', model: leaked, prompt: 'hi' });
      expect(args).not.toContain('--model');
    }
  });

  it('maps Tide effort levels to pi thinking levels', () => {
    const backend = new PiBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      effort: 'xHigh',
      prompt: 'think hard',
    });
    expect(args[args.indexOf('--thinking') + 1]).toBe('xhigh');

    const maxArgs = backend.buildArgs({
      workingDir: '/tmp/project',
      effort: 'max',
      prompt: 'think harder',
    });
    expect(maxArgs[maxArgs.indexOf('--thinking') + 1]).toBe('xhigh');
  });

  it('re-injects updated skills once when a resumed session is marked dirty', () => {
    const config = {
      agentId: 'pi-skill-refresh-test',
      workingDir: '/tmp/project',
      sessionId: 'existing-session',
      prompt: 'use the newly assigned capability',
      customAgent: {
        name: 'portable',
        definition: {
          description: 'test',
          prompt: '## Skill: Google Drive\nUpload files with the Drive integration.',
        },
      },
    };

    expect(buildPiPrompt(config)).not.toContain('## Skill: Google Drive');
    markInstructionsDirty(config.agentId);
    expect(buildPiPrompt(config)).toContain('## Skill: Google Drive');
    expect(buildPiPrompt(config)).not.toContain('## Skill: Google Drive');
  });

  it('extracts the session id only from the session header event', () => {
    const backend = new PiBackend();
    expect(
      backend.extractSessionId({ type: 'session', id: 'abc-123', cwd: '/tmp' })
    ).toBe('abc-123');
    expect(backend.extractSessionId({ type: 'agent_start' })).toBeNull();
    expect(backend.extractSessionId({ type: 'message_end', id: 'not-a-session' })).toBeNull();
  });

  it('declares grok-style stdin semantics (argv prompt, one-shot process)', () => {
    const backend = new PiBackend();
    expect(backend.requiresStdinInput()).toBe(false);
    expect(backend.shouldCloseStdinAfterPrompt()).toBe(true);
    expect(backend.supportsSessionResume()).toBe(true);
  });
});
