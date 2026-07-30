import { describe, it, expect } from 'vitest';
import { matchSlashCommands, getSlashCommandsForProvider, getSlashCommandInfo } from './slashCommands';

describe('getSlashCommandInfo', () => {
  it('resolves a command so history can render it as a chip', () => {
    expect(getSlashCommandInfo('/compact')?.summary).toBeTruthy();
    expect(getSlashCommandInfo('  /clear  ')?.name).toBe('/clear');
  });

  // History renders the same regardless of the agent's current provider.
  it('ignores provider gating', () => {
    expect(getSlashCommandInfo('/context')?.name).toBe('/context');
  });

  it('returns null for anything not in the catalog', () => {
    expect(getSlashCommandInfo('/model')).toBeNull();
    expect(getSlashCommandInfo('/home/erick')).toBeNull();
    expect(getSlashCommandInfo('deploy the app')).toBeNull();
  });
});

describe('matchSlashCommands', () => {
  it('suggests every command for a bare slash', () => {
    const matches = matchSlashCommands('/', 'claude');
    expect(matches?.map((c) => c.name)).toContain('/compact');
  });

  it('narrows as the user types', () => {
    expect(matchSlashCommands('/comp', 'claude')?.map((c) => c.name)).toEqual(['/compact']);
    expect(matchSlashCommands('/c', 'claude')?.map((c) => c.name))
      .toEqual(['/compact', '/clear', '/context', '/cost']);
  });

  it('is case-insensitive', () => {
    expect(matchSlashCommands('/COMP', 'claude')?.map((c) => c.name)).toEqual(['/compact']);
  });

  // The dropdown must not fight a message that merely starts with a path.
  it('stops matching once the text cannot be a command', () => {
    expect(matchSlashCommands('/home/erick/file.ts', 'claude')).toBeNull();
    expect(matchSlashCommands('/h', 'claude')).toBeNull();
  });

  it('only fires while the command is the whole message', () => {
    expect(matchSlashCommands('/compact now please', 'claude')).toBeNull();
    expect(matchSlashCommands('run /compact', 'claude')).toBeNull();
    expect(matchSlashCommands('/compact\nmore', 'claude')).toBeNull();
  });

  it('hides Claude-only commands from other providers', () => {
    const codex = matchSlashCommands('/c', 'codex')?.map((c) => c.name);
    expect(codex).toEqual(['/compact', '/clear']);
    expect(codex).not.toContain('/context');
  });

  // Grok has no CLI slash commands wired through the commander.
  it('offers nothing for grok', () => {
    expect(matchSlashCommands('/', 'grok')).toBeNull();
  });

  it('treats a missing provider as Claude', () => {
    expect(getSlashCommandsForProvider(undefined).map((c) => c.name))
      .toEqual(getSlashCommandsForProvider('claude').map((c) => c.name));
  });
});
