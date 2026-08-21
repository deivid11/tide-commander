import { beforeAll, describe, expect, it } from 'vitest';
import { registerBuiltinPlugin, registerPluginSlashCommand } from './registry';
import { getSlashCommandInfo, matchSlashCommands } from '../utils/slashCommands';

beforeAll(() => {
  registerBuiltinPlugin('test-tasks');
  registerPluginSlashCommand({
    pluginId: 'test-tasks',
    pluginName: 'Test Tasks',
    name: '/show-pending-tasks',
    aliases: ['/tasks'],
    summary: 'Show pending tasks',
  });
});

describe('plugin slash command contributions', () => {
  it('adds plugin commands and aliases to autocomplete', () => {
    expect(matchSlashCommands('/show-p', 'claude')?.some((item) => (
      item.name === '/show-pending-tasks' && item.source === 'plugin'
    ))).toBe(true);
    expect(matchSlashCommands('/tasks', 'pi')?.[0]).toMatchObject({
      name: '/tasks',
      source: 'plugin',
      pluginId: 'test-tasks',
    });
  });

  it('recognizes contributed commands in rendered history', () => {
    expect(getSlashCommandInfo('/tasks')).toMatchObject({
      name: '/tasks',
      pluginId: 'test-tasks',
      source: 'plugin',
    });
  });
});
