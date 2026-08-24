import type { BuiltinPluginDefinition } from '../manager.js';

/**
 * Catalog entry for Commander-managed Bash slash commands. The command list is
 * dynamic and persisted by PluginShellCommandService rather than in a manifest.
 */
export const shellCommandsPlugin: BuiltinPluginDefinition = {
  manifest: {
    id: 'shell-commands',
    name: 'Command Scripts',
    version: '1.0.0',
    description: 'User-managed Bash scripts exposed as streamed slash commands.',
  },
  activate: () => undefined,
};
