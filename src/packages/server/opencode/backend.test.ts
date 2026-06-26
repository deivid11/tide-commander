import { describe, expect, it } from 'vitest';
import { OpencodeBackend } from './backend.js';

describe('OpencodeBackend.buildArgs', () => {
  it('builds a fresh run with no session/fork flags', () => {
    const backend = new OpencodeBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      prompt: 'do the thing',
    });

    expect(args.slice(0, 4)).toEqual(['run', '--format', 'json', '--dangerously-skip-permissions']);
    expect(args).not.toContain('-s');
    expect(args).not.toContain('--fork');
  });

  it('resumes a session with -s and no --fork', () => {
    const backend = new OpencodeBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      sessionId: 'ses_abc123',
      prompt: 'continue',
    });

    expect(args).toContain('-s');
    expect(args[args.indexOf('-s') + 1]).toBe('ses_abc123');
    expect(args).not.toContain('--fork');
  });

  it('forks a session with -s followed by --fork on the first fork run', () => {
    const backend = new OpencodeBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      sessionId: 'ses_source',
      forkSession: true,
      prompt: 'continue from the forked history',
    });

    expect(args).toContain('-s');
    expect(args[args.indexOf('-s') + 1]).toBe('ses_source');
    expect(args).toContain('--fork');
    // --fork must come after -s <id> (it modifies the resume).
    expect(args.indexOf('--fork')).toBeGreaterThan(args.indexOf('-s'));
  });

  it('ignores forkSession when there is no session to fork', () => {
    const backend = new OpencodeBackend();
    const args = backend.buildArgs({
      workingDir: '/tmp/project',
      forkSession: true,
      prompt: 'fresh',
    });

    expect(args).not.toContain('--fork');
    expect(args).not.toContain('-s');
  });
});
