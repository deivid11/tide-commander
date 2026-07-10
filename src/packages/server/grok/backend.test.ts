import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { GrokBackend, buildGrokPrompt } from './backend.js';

describe('GrokBackend.buildArgs', () => {
  let backend: GrokBackend;

  beforeEach(() => {
    backend = new GrokBackend();
  });

  afterEach(() => {
    // Drain any pending prompt file via formatStdinInput cleanup
    backend.formatStdinInput('');
  });

  it('builds a fresh headless run with streaming-json and yolo', () => {
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      prompt: 'do the thing',
      permissionMode: 'bypass',
    });

    expect(args).toContain('--output-format');
    expect(args[args.indexOf('--output-format') + 1]).toBe('streaming-json');
    expect(args).toContain('--yolo');
    expect(args).toContain('--cwd');
    expect(args[args.indexOf('--cwd') + 1]).toBe('/tmp/project');
    expect(args).toContain('-p');
    expect(args[args.indexOf('-p') + 1]).toContain('do the thing');
    expect(args).not.toContain('--resume');
    expect(args).not.toContain('--fork-session');
  });

  it('resumes a session with --resume', () => {
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      sessionId: '019f4d3a-c77d-7ac2-9daf-42f6775e5451',
      prompt: 'continue',
      permissionMode: 'bypass',
    });

    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe('019f4d3a-c77d-7ac2-9daf-42f6775e5451');
    expect(args).not.toContain('--fork-session');
  });

  it('forks a session with --resume and --fork-session', () => {
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      sessionId: '019f4d3a-c77d-7ac2-9daf-42f6775e5451',
      forkSession: true,
      prompt: 'continue from fork',
      permissionMode: 'bypass',
    });

    expect(args).toContain('--resume');
    expect(args).toContain('--fork-session');
    expect(args.indexOf('--fork-session')).toBeGreaterThan(args.indexOf('--resume'));
  });

  it('passes model when it looks like a grok model', () => {
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      prompt: 'hi',
      model: 'grok-4.5',
      permissionMode: 'bypass',
    });

    expect(args).toContain('-m');
    expect(args[args.indexOf('-m') + 1]).toBe('grok-4.5');
  });

  it('ignores claude model ids when provider-switched', () => {
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      prompt: 'hi',
      model: 'claude-opus-4-8',
      permissionMode: 'bypass',
    });

    expect(args).not.toContain('-m');
  });

  it('uses --prompt-file for large prompts', () => {
    const large = 'x'.repeat(5000);
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      prompt: large,
      permissionMode: 'bypass',
    });

    expect(args).toContain('--prompt-file');
    const filePath = args[args.indexOf('--prompt-file') + 1];
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain(large);
    expect(args).not.toContain('-p');
  });

  it('maps effort levels to --reasoning-effort', () => {
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      prompt: 'hi',
      effort: 'xHigh',
      permissionMode: 'bypass',
    });

    expect(args).toContain('--reasoning-effort');
    expect(args[args.indexOf('--reasoning-effort') + 1]).toBe('xhigh');
  });

  it('declares no stdin and supports session resume', () => {
    expect(backend.requiresStdinInput()).toBe(false);
    expect(backend.shouldCloseStdinAfterPrompt?.()).toBe(true);
    expect(backend.supportsSessionResume?.()).toBe(true);
  });
});

describe('buildGrokPrompt', () => {
  it('passes bare slash commands through verbatim', () => {
    expect(buildGrokPrompt({ workingDir: '/tmp', prompt: '/compact' })).toBe('/compact');
  });

  it('includes user request for normal prompts', () => {
    const result = buildGrokPrompt({ workingDir: '/tmp', prompt: 'fix the bug' });
    expect(result).toContain('## User Request');
    expect(result).toContain('fix the bug');
  });
});

describe('GrokBackend.extractSessionId', () => {
  it('extracts sessionId from end events', () => {
    const backend = new GrokBackend();
    expect(backend.extractSessionId({
      type: 'end',
      sessionId: 'abc-123',
      stopReason: 'EndTurn',
    })).toBe('abc-123');
  });

  it('returns null when sessionId is missing', () => {
    const backend = new GrokBackend();
    expect(backend.extractSessionId({ type: 'text', data: 'hi' })).toBeNull();
  });
});
