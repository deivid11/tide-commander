import type { PluginOutputEnvelope, RegisteredPluginSlashCommand } from '../../plugins/types';
import { apiUrl, authFetch } from '../../utils/storage';
import {
  executeShellSlashCommand,
  SHELL_COMMAND_PLUGIN_ID,
  type ShellCommandExecutionResult,
} from '../../plugins/shell-commands/execution';

export interface SpotlightPluginCommand {
  name: string;
  canonicalName: string;
  pluginId: string;
  pluginName: string;
  summary: string;
  handler: string;
  requiresAgent?: boolean;
}

/** Match enabled plugin commands when Spotlight is explicitly in `/` mode. */
export function matchSpotlightPluginCommands(
  query: string,
  commands: RegisteredPluginSlashCommand[],
): SpotlightPluginCommand[] {
  if (!query.startsWith('/')) return [];
  const trimmed = query.trim();
  const token = (trimmed.split(/\s+/, 1)[0] || '/').toLowerCase();
  const hasArguments = /\s/.test(trimmed);
  const matches: SpotlightPluginCommand[] = [];

  for (const command of commands) {
    const variants = [command.name, ...(command.aliases ?? [])];
    for (const variant of variants) {
      const name = variant.toLowerCase();
      const isMatch = hasArguments ? name === token : name.startsWith(token);
      if (!isMatch) continue;
      matches.push({
        name: variant,
        canonicalName: command.name,
        pluginId: command.pluginId,
        pluginName: command.pluginName || command.pluginId,
        summary: command.summary,
        handler: command.handler || command.name.replace(/^\//, ''),
        ...(command.requiresAgent ? { requiresAgent: true } : {}),
      });
    }
  }

  return matches.sort((a, b) => {
    const aExact = a.name.toLowerCase() === token ? 0 : 1;
    const bExact = b.name.toLowerCase() === token ? 0 : 1;
    return aExact - bExact || a.name.localeCompare(b.name);
  });
}

export function commandArguments(query: string): string[] {
  return query.trim().split(/\s+/).slice(1);
}

export type PluginCommandRunResult =
  | { kind: 'output'; command: string; output: PluginOutputEnvelope }
  | ShellCommandExecutionResult;

export async function runPluginCommand(
  selected: SpotlightPluginCommand,
  query = selected.name,
  options: { agentId?: string } = {},
): Promise<PluginCommandRunResult> {
  const args = commandArguments(query);
  const invocation = [selected.name, ...args].join(' ');
  if (selected.pluginId === SHELL_COMMAND_PLUGIN_ID) {
    return executeShellSlashCommand(selected.handler, query, options.agentId);
  }
  const response = await authFetch(apiUrl(
    `/api/plugins/${encodeURIComponent(selected.pluginId)}/commands/${encodeURIComponent(selected.name.replace(/^\//, ''))}`
  ), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      command: invocation,
      slashCommand: selected.name,
      canonicalCommand: selected.canonicalName,
      rawCommand: invocation,
      argsText: args.join(' '),
      args,
      ...(options.agentId ? { agentId: options.agentId } : {}),
      source: 'client-command',
    }),
  });
  const body = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `Plugin command failed (${response.status})`;
    throw new Error(message);
  }
  return { kind: 'output', command: invocation, output: readPluginCommandOutput(body) };
}

export function readPluginCommandOutput(body: unknown): PluginOutputEnvelope {
  const candidate = body && typeof body === 'object' && 'output' in body
    ? (body as { output?: unknown }).output
    : body;
  if (!candidate || typeof candidate !== 'object') throw new Error('Plugin returned no output');
  const output = candidate as Partial<PluginOutputEnvelope>;
  if (
    typeof output.pluginId !== 'string'
    || typeof output.rendererId !== 'string'
    || typeof output.instanceId !== 'string'
    || !('data' in output)
  ) {
    throw new Error('Plugin returned an invalid output envelope');
  }
  return output as PluginOutputEnvelope;
}
