/**
 * Slash-command autocomplete catalog for the chat input.
 *
 * Deliberately conservative. Every entry here is one the commander can actually
 * deliver to a running CLI: either it is intercepted server-side (`/clear`, see
 * websocket/handlers/command-handler.ts) or it round-trips to the CLI as a bare
 * slash command (see isBareSlashCommand in services/instruction-refresh.ts).
 *
 * Interactive-only Claude Code commands (`/model`, `/login`, `/vim`,
 * `/terminal-setup`, …) are intentionally absent: agents run headless
 * (`--print`), where those would silently do nothing. Suggesting them would be
 * worse than suggesting nothing.
 */

export type SlashCommandProvider = 'claude' | 'codex' | 'opencode' | 'grok';

export interface SlashCommand {
  /** Including the leading slash, exactly as it must be sent. */
  name: string;
  /** One-line description shown next to the name in the dropdown. */
  summary: string;
  /** Providers whose CLI supports it. */
  providers: SlashCommandProvider[];
}

const ALL_CLI_PROVIDERS: SlashCommandProvider[] = ['claude', 'codex', 'opencode'];

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: '/compact',
    summary: 'Resume la conversación para liberar contexto',
    providers: ALL_CLI_PROVIDERS,
  },
  {
    name: '/clear',
    summary: 'Borra el contexto y arranca una sesión nueva',
    providers: ALL_CLI_PROVIDERS,
  },
  {
    name: '/context',
    summary: 'Desglose de en qué se está gastando el contexto',
    providers: ['claude'],
  },
  {
    name: '/cost',
    summary: 'Tokens y costo acumulado de la sesión',
    providers: ['claude'],
  },
];

/**
 * Commands available for a provider. Unknown/absent provider means a Claude
 * agent (the default across the codebase).
 */
export function getSlashCommandsForProvider(provider: string | undefined): SlashCommand[] {
  const key = (provider || 'claude') as SlashCommandProvider;
  return SLASH_COMMANDS.filter((cmd) => cmd.providers.includes(key));
}

/**
 * Look up a command by its exact text, for rendering an entry that is already
 * in the conversation. Provider-agnostic on purpose: history should render the
 * same way regardless of what the agent is running right now.
 */
export function getSlashCommandInfo(text: string): SlashCommand | null {
  const name = text.trim().toLowerCase();
  return SLASH_COMMANDS.find((cmd) => cmd.name === name) ?? null;
}

/**
 * Match the text typed so far against the catalog.
 *
 * A slash command is the *whole* message, so this only fires while the input is
 * a single `/token` with nothing after it. That keeps the dropdown out of the
 * way when a message merely happens to start with an absolute path: `/home/...`
 * stops matching at `/h` and the dropdown closes on its own.
 *
 * Returns null when the input isn't a slash-command prefix at all.
 */
export function matchSlashCommands(
  input: string,
  provider: string | undefined
): SlashCommand[] | null {
  if (!/^\/[a-zA-Z0-9_-]*$/.test(input)) return null;
  const typed = input.slice(1).toLowerCase();
  const matches = getSlashCommandsForProvider(provider)
    .filter((cmd) => cmd.name.slice(1).toLowerCase().startsWith(typed));
  return matches.length > 0 ? matches : null;
}
