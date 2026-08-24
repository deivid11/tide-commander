import { describe, expect, it } from 'vitest';
import type { RegisteredPluginSlashCommand } from '../../plugins/types';
import {
  commandArguments,
  matchSpotlightPluginCommands,
  readPluginCommandOutput,
} from './pluginCommands';

const commands: RegisteredPluginSlashCommand[] = [{
  pluginId: 'bolba-tasks',
  pluginName: 'Bolba Tasks',
  name: '/show-pending-tasks',
  aliases: ['/tasks'],
  summary: 'Show pending tasks',
  handler: 'show-pending-tasks',
  renderer: 'task-list',
}];

describe('Spotlight plugin commands', () => {
  it('enters command mode only for slash-prefixed queries and matches aliases', () => {
    expect(matchSpotlightPluginCommands('tasks', commands)).toEqual([]);
    expect(matchSpotlightPluginCommands('/ta', commands)).toMatchObject([{
      name: '/tasks',
      canonicalName: '/show-pending-tasks',
      handler: 'show-pending-tasks',
    }]);
  });

  it('preserves commands that require the selected agent', () => {
    const matched = matchSpotlightPluginCommands('/rename', [{
      pluginId: 'rename-agent',
      pluginName: 'Rename Agent',
      name: '/rename-agent',
      summary: 'Generate names',
      requiresAgent: true,
    }]);
    expect(matched).toMatchObject([{ name: '/rename-agent', requiresAgent: true }]);
  });

  it('keeps an exact command match while arguments are present', () => {
    expect(matchSpotlightPluginCommands('/tasks project-a', commands)).toHaveLength(1);
    expect(commandArguments('/tasks project-a open')).toEqual(['project-a', 'open']);
  });

  it('validates structured command output', () => {
    const output = {
      pluginId: 'bolba-tasks',
      rendererId: 'task-list',
      instanceId: 'spotlight-1',
      data: { kind: 'task-list', items: [] },
    };
    expect(readPluginCommandOutput({ output })).toEqual(output);
    expect(() => readPluginCommandOutput({ output: { pluginId: 'broken' } })).toThrow(/invalid output/i);
  });
});
