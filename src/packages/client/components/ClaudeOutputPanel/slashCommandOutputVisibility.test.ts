import { describe, expect, it } from 'vitest';
import { filterSlashCommandOutputs } from './slashCommandOutputVisibility';

describe('slash command output visibility', () => {
  const outputs = [
    { uuid: 'assistant', text: 'normal response' },
    { uuid: 'plugin', text: '', pluginOutput: { pluginId: 'omni-search' } },
    { uuid: 'slash-chip', text: '/omni query', isUserPrompt: true },
  ];

  it('preserves every output while enabled', () => {
    expect(filterSlashCommandOutputs(outputs, true)).toBe(outputs);
  });

  it('hides only structured plugin output cards while disabled', () => {
    expect(filterSlashCommandOutputs(outputs, false).map((output) => output.uuid))
      .toEqual(['assistant', 'slash-chip']);
  });
});
