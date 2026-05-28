/**
 * Slack Integration Configuration
 * ConfigField[] schema + config persistence + config type
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConfigField } from '../../../shared/integration-types.js';
import { getDataDir } from '../../data/index.js';

// ─── Config Type ───

/**
 * How the integration receives inbound messages from Slack.
 * - `auto`   — pick from token prefix (xoxb- → socket, xoxp- → polling)
 * - `socket` — Socket Mode (requires bot token + app-level token)
 * - `polling` — Web API polling (works with user tokens, no app token needed)
 */
export type SlackAuthMode = 'auto' | 'socket' | 'polling';

/** Effective transport actually in use after start. Read-only — set by client. */
export type SlackCurrentMode = 'socket' | 'polling' | 'none';

export interface SlackConfig {
  enabled: boolean;
  defaultChannelId?: string;
  botUserId?: string;
  botName?: string;
  connectedAt?: number;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  lastError?: string;

  // ─── Polling-mode controls (also surfaced via the schema) ───
  /** User-selected mode. `auto` (default) infers from token prefix. */
  authMode?: SlackAuthMode;
  /** Polling interval in seconds. Clamped to [5, 600]. */
  pollingIntervalSec?: number;
  /** First-sight backfill cap, in messages, per channel. */
  pollingBackfillMessageCap?: number;
  /** First-sight backfill cap, in seconds (lookback window). */
  pollingBackfillSeconds?: number;
  /** Concurrency for parallel `conversations.history` fetches. Clamped [1,8]. */
  pollingConcurrency?: number;
  /**
   * Minimum milliseconds between any two outbound Slack API calls (history
   * + replies + list). Throttle that smears the per-cycle burst so we don't
   * hammer Slack's Tier 3 limit (~50 req/min). Default 1500ms (~40 req/min).
   * Set to 0 to disable.
   */
  pollingMinMsBetweenCalls?: number;
  /**
   * Channel types passed to `conversations.list`. Comma-separated. Default:
   * `public_channel,private_channel,im,mpim`. Set to a narrower list to
   * exclude DMs or MPIMs.
   */
  pollingChannelTypes?: string;
  /**
   * Comma-separated channel ID allowlist. When non-empty, polling fetches
   * history ONLY for channels whose id is in this list (plus all 1:1 DMs if
   * `pollingDmsAlways` is true). Use this to avoid the rate-limit storm in
   * workspaces where the user is in hundreds of groups.
   */
  pollingChannelAllowlist?: string;
  /**
   * If true, all 1:1 DM channels (`D...`) are always polled even when an
   * allowlist is set. Default true — the typical "give me my DMs + a few
   * specific groups" workflow.
   */
  pollingDmsAlways?: boolean;

  /**
   * If true, polling uses a single `search.messages?query=after:<yesterday>`
   * call per cycle instead of one `conversations.history` per channel. Search
   * returns ALL messages including thread replies on old parents, fixing the
   * "thread replies are missed" bug. Allowlist + DM filter still apply
   * post-fetch. Requires `search:read` scope on the xoxp- token. Default
   * false — the legacy per-channel path stays the safe default for tokens
   * without search scope.
   */
  pollingUseSearch?: boolean;

  /**
   * If true, messages sent by the connected account itself are still logged +
   * broadcast (with `direction: 'outbound'`). Useful for personal-token (xoxp-)
   * instances that want to mirror sent + received traffic. Triggers do NOT
   * fire on own messages even when this is enabled — that would loop. Default
   * false preserves the historical bot behavior of skipping self.
   */
  mirrorOwnMessages?: boolean;

  /**
   * Auto-react with :eyes: (👀) on every incoming message that fires a trigger,
   * as a visual "I saw it, working on it" ack. Default true. The global env
   * `SLACK_REACT_ON_TRIGGER=false` still acts as a kill-switch across all
   * instances; this per-instance flag only takes effect when the env doesn't
   * force-disable.
   */
  reactOnTrigger?: boolean;

  // ─── Diagnostic, set by the client at runtime ───
  /** Effective transport in use (socket / polling / none). Read-only. */
  currentMode?: SlackCurrentMode;
}

const DEFAULT_CONFIG: SlackConfig = {
  enabled: false,
  status: 'disconnected',
  authMode: 'auto',
  pollingIntervalSec: 45,
  pollingBackfillMessageCap: 100,
  pollingBackfillSeconds: 24 * 60 * 60,
  pollingConcurrency: 4,
  pollingChannelTypes: 'public_channel,private_channel,im,mpim',
  pollingChannelAllowlist: '',
  pollingDmsAlways: true,
  pollingMinMsBetweenCalls: 1500,
  pollingUseSearch: false,
  mirrorOwnMessages: false,
  reactOnTrigger: true,
  currentMode: 'none',
};

// ─── Config File Persistence ───

/** Default instance id — kept in sync with slack-instance.ts (intentionally duplicated to avoid a cycle). */
export const DEFAULT_INSTANCE_ID = 'default';

/**
 * Backward-compat: the `default` instance keeps the legacy `slack-config.json`
 * filename so existing users don't need to migrate. Other instances live at
 * `slack-config-<id>.json`.
 */
function getConfigPath(instanceId: string = DEFAULT_INSTANCE_ID): string {
  if (instanceId === DEFAULT_INSTANCE_ID) {
    return path.join(getDataDir(), 'slack-config.json');
  }
  return path.join(getDataDir(), `slack-config-${instanceId}.json`);
}

/** Per-instance config cache. Keyed by instance id. */
const cachedConfigs = new Map<string, SlackConfig>();

export function loadConfig(instanceId: string = DEFAULT_INSTANCE_ID): SlackConfig {
  const cached = cachedConfigs.get(instanceId);
  if (cached) return cached;

  const configPath = getConfigPath(instanceId);
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const result: SlackConfig = { ...DEFAULT_CONFIG, ...data };
      cachedConfigs.set(instanceId, result);
      return result;
    }
  } catch {
    // Corrupted config, use defaults
  }

  const defaults: SlackConfig = { ...DEFAULT_CONFIG };
  cachedConfigs.set(instanceId, defaults);
  return defaults;
}

export function saveConfig(config: SlackConfig, instanceId: string = DEFAULT_INSTANCE_ID): void {
  cachedConfigs.set(instanceId, config);
  const configPath = getConfigPath(instanceId);
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function updateConfig(updates: Partial<SlackConfig>, instanceId: string = DEFAULT_INSTANCE_ID): SlackConfig {
  const config = loadConfig(instanceId);
  const updated = { ...config, ...updates };
  saveConfig(updated, instanceId);
  return updated;
}

/** Drop a per-instance config (in-memory cache + on-disk file). */
export function deleteConfig(instanceId: string): void {
  cachedConfigs.delete(instanceId);
  if (instanceId === DEFAULT_INSTANCE_ID) return; // never delete the legacy file
  const configPath = getConfigPath(instanceId);
  try {
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  } catch {
    // Best-effort delete.
  }
}

// ─── Config Schema (for generic settings UI) ───

export const slackConfigSchema: ConfigField[] = [
  {
    key: 'enabled',
    label: 'Enable Slack Integration',
    type: 'boolean',
    description: 'Enable or disable the Slack connection',
    defaultValue: false,
    group: 'General',
  },
  {
    key: 'SLACK_BOT_TOKEN',
    label: 'Slack Token',
    type: 'password',
    description: 'Bot token (xoxb-...) or User token (xoxp-...). xoxb- uses real-time Socket Mode; xoxp- uses Web API polling (~30-60s lag, no Slack app config needed). Required scopes for xoxb: channels:history, channels:read, chat:write, groups:history, groups:read, im:history, im:read, users:read. For xoxp the same read scopes apply, granted by the user.',
    placeholder: 'xoxb-... or xoxp-...',
    required: true,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'SLACK_APP_TOKEN',
    label: 'App Token (Socket Mode only)',
    type: 'password',
    description: 'Slack App-Level Token for Socket Mode (xapp-...). Required when using a bot token (xoxb-). Leave blank when using a user token (xoxp-) — polling mode does not need it.',
    placeholder: 'xapp-...',
    required: false,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'authMode',
    label: 'Inbound Mode',
    type: 'select',
    description: 'How to receive messages. "auto" picks from the token prefix (xoxb- → socket, xoxp- → polling). Override only if you know what you\'re doing.',
    defaultValue: 'auto',
    options: [
      { value: 'auto', label: 'Auto (from token prefix)' },
      { value: 'socket', label: 'Socket Mode (xoxb-)' },
      { value: 'polling', label: 'Polling (xoxp-)' },
    ],
    group: 'Authentication',
  },
  {
    key: 'defaultChannelId',
    label: 'Default Channel',
    type: 'text',
    description: 'Default Slack channel ID for notifications (e.g. C0123456789)',
    placeholder: 'C0123456789',
    group: 'Defaults',
  },
  {
    key: 'pollingIntervalSec',
    label: 'Polling Interval (seconds)',
    type: 'number',
    description: 'How often to poll Slack for new messages (polling mode only). Default 45s. Range 5-600. Note: in search mode (pollingUseSearch) Slack\'s ~10-30s search-index lag is the real latency floor, so values below ~10s mostly add API calls without delivering faster.',
    defaultValue: 45,
    group: 'Polling',
  },
  {
    key: 'pollingConcurrency',
    label: 'Polling Concurrency',
    type: 'number',
    description: 'Max channels fetched in parallel each poll cycle. Default 4. Range 1-8.',
    defaultValue: 4,
    group: 'Polling',
  },
  {
    key: 'pollingBackfillMessageCap',
    label: 'First-run Backfill (messages/channel)',
    type: 'number',
    description: 'On first sight of a channel, fetch at most this many recent messages. Default 100.',
    defaultValue: 100,
    group: 'Polling',
  },
  {
    key: 'pollingChannelAllowlist',
    label: 'Channel Allowlist',
    type: 'textarea',
    description: 'Comma- or newline-separated channel IDs to poll. When set, only these channels are polled (plus all 1:1 DMs if "Always include DMs" is on). Use to avoid rate limits when in hundreds of channels. Leave blank to poll everything per Channel Types.',
    placeholder: 'C0123456789, G0987654321',
    group: 'Polling',
  },
  {
    key: 'pollingMinMsBetweenCalls',
    label: 'Min ms between API calls',
    type: 'number',
    description: 'Throttle that smears the per-cycle API burst so Slack\'s rate limit (~50/min) isn\'t hit. Default 1500ms (~40 req/min). Lower = faster cycle but risks 429s. Set to 0 to disable pacing.',
    defaultValue: 1500,
    group: 'Polling',
  },
  {
    key: 'pollingDmsAlways',
    label: 'Always include DMs',
    type: 'boolean',
    description: 'When the allowlist is set, still poll all 1:1 DMs (D-prefix). Default on. Turn off if you want strict allowlist-only.',
    defaultValue: true,
    group: 'Polling',
  },
  {
    key: 'pollingUseSearch',
    label: 'Use search.messages (catches thread replies)',
    type: 'boolean',
    description: 'When on, polling uses a single search.messages call per cycle instead of one conversations.history per channel. Catches replies on old threads that the per-channel sweep misses. Allowlist + DM filter still apply. Requires the user (xoxp-) token to have the search:read scope. Default off.',
    defaultValue: false,
    group: 'Polling',
  },
  {
    key: 'mirrorOwnMessages',
    label: 'Mirror messages I send too',
    type: 'boolean',
    description: 'When enabled, your outgoing messages are also captured (logged as direction:outbound). Recommended for personal (xoxp-) tokens. Triggers do NOT fire on own messages to avoid loops.',
    defaultValue: false,
    group: 'General',
  },
  {
    key: 'reactOnTrigger',
    label: 'Auto-react with :eyes: on trigger',
    type: 'boolean',
    description: 'When a Slack trigger fires on an incoming message, react with 👀 as a visual acknowledgement. Default on. Per-instance — turn off for accounts where the reaction is noisy.',
    defaultValue: true,
    group: 'General',
  },
];

// ─── Per-Instance Secret Keys ───

/**
 * Compose the actual secret-store key for a given logical secret + instance.
 * Default instance keeps the legacy bare key (SLACK_BOT_TOKEN) so existing
 * users don't lose their connection. Other instances use a `__<id>` suffix.
 *
 * Reading also falls back to the legacy bare key for the default instance,
 * which means an existing single-instance setup continues to work without any
 * migration step.
 */
export function instanceSecretKey(logicalKey: 'SLACK_BOT_TOKEN' | 'SLACK_APP_TOKEN', instanceId: string): string {
  if (instanceId === DEFAULT_INSTANCE_ID) return logicalKey;
  return `${logicalKey}__${instanceId}`;
}

export function readInstanceSecret(
  secrets: { get: (key: string) => string | undefined },
  logicalKey: 'SLACK_BOT_TOKEN' | 'SLACK_APP_TOKEN',
  instanceId: string,
): string | undefined {
  const v = secrets.get(instanceSecretKey(logicalKey, instanceId));
  if (v) return v;
  // Legacy fallback: only for the default instance, where the unsuffixed key is canonical.
  if (instanceId === DEFAULT_INSTANCE_ID) return undefined;
  return undefined;
}

// ─── Config Value Access (for IntegrationPlugin.getConfig/setConfig) ───

export function getConfigValues(
  secrets: { get: (key: string) => string | undefined },
  instanceId: string = DEFAULT_INSTANCE_ID,
): Record<string, unknown> {
  const config = loadConfig(instanceId);
  return {
    enabled: config.enabled,
    defaultChannelId: config.defaultChannelId || '',
    authMode: config.authMode ?? 'auto',
    pollingIntervalSec: config.pollingIntervalSec ?? 45,
    pollingConcurrency: config.pollingConcurrency ?? 4,
    pollingBackfillMessageCap: config.pollingBackfillMessageCap ?? 100,
    pollingBackfillSeconds: config.pollingBackfillSeconds ?? 24 * 60 * 60,
    pollingChannelTypes: config.pollingChannelTypes ?? 'public_channel,private_channel,im,mpim',
    pollingChannelAllowlist: config.pollingChannelAllowlist ?? '',
    pollingDmsAlways: config.pollingDmsAlways ?? true,
    pollingMinMsBetweenCalls: config.pollingMinMsBetweenCalls ?? 1500,
    pollingUseSearch: config.pollingUseSearch ?? false,
    mirrorOwnMessages: config.mirrorOwnMessages ?? false,
    reactOnTrigger: config.reactOnTrigger ?? true,
    currentMode: config.currentMode ?? 'none',
    // Mask secret values for UI display
    SLACK_BOT_TOKEN: secrets.get(instanceSecretKey('SLACK_BOT_TOKEN', instanceId)) ? '********' : '',
    SLACK_APP_TOKEN: secrets.get(instanceSecretKey('SLACK_APP_TOKEN', instanceId)) ? '********' : '',
  };
}

export async function setConfigValues(
  values: Record<string, unknown>,
  secrets: { get: (key: string) => string | undefined; set: (key: string, value: string) => void },
  instanceId: string = DEFAULT_INSTANCE_ID,
): Promise<void> {
  // Handle secret fields
  if (typeof values.SLACK_BOT_TOKEN === 'string' && values.SLACK_BOT_TOKEN && values.SLACK_BOT_TOKEN !== '********') {
    secrets.set(instanceSecretKey('SLACK_BOT_TOKEN', instanceId), values.SLACK_BOT_TOKEN);
  }
  if (typeof values.SLACK_APP_TOKEN === 'string' && values.SLACK_APP_TOKEN && values.SLACK_APP_TOKEN !== '********') {
    secrets.set(instanceSecretKey('SLACK_APP_TOKEN', instanceId), values.SLACK_APP_TOKEN);
  }

  // Handle non-secret config
  const updates: Partial<SlackConfig> = {};
  if (typeof values.enabled === 'boolean') updates.enabled = values.enabled;
  if (typeof values.defaultChannelId === 'string') updates.defaultChannelId = values.defaultChannelId || undefined;
  if (typeof values.authMode === 'string' && (values.authMode === 'auto' || values.authMode === 'socket' || values.authMode === 'polling')) {
    updates.authMode = values.authMode;
  }
  if (typeof values.pollingIntervalSec === 'number' && Number.isFinite(values.pollingIntervalSec)) {
    updates.pollingIntervalSec = values.pollingIntervalSec;
  }
  if (typeof values.pollingConcurrency === 'number' && Number.isFinite(values.pollingConcurrency)) {
    updates.pollingConcurrency = values.pollingConcurrency;
  }
  if (typeof values.pollingBackfillMessageCap === 'number' && Number.isFinite(values.pollingBackfillMessageCap)) {
    updates.pollingBackfillMessageCap = values.pollingBackfillMessageCap;
  }
  if (typeof values.pollingBackfillSeconds === 'number' && Number.isFinite(values.pollingBackfillSeconds)) {
    updates.pollingBackfillSeconds = values.pollingBackfillSeconds;
  }
  if (typeof values.pollingChannelTypes === 'string' && values.pollingChannelTypes) {
    updates.pollingChannelTypes = values.pollingChannelTypes;
  }
  if (typeof values.pollingChannelAllowlist === 'string') {
    updates.pollingChannelAllowlist = values.pollingChannelAllowlist;
  }
  if (typeof values.pollingDmsAlways === 'boolean') {
    updates.pollingDmsAlways = values.pollingDmsAlways;
  }
  if (typeof values.pollingMinMsBetweenCalls === 'number' && Number.isFinite(values.pollingMinMsBetweenCalls)) {
    updates.pollingMinMsBetweenCalls = Math.max(0, values.pollingMinMsBetweenCalls);
  }
  if (typeof values.pollingUseSearch === 'boolean') {
    updates.pollingUseSearch = values.pollingUseSearch;
  }
  if (typeof values.mirrorOwnMessages === 'boolean') {
    updates.mirrorOwnMessages = values.mirrorOwnMessages;
  }
  if (typeof values.reactOnTrigger === 'boolean') {
    updates.reactOnTrigger = values.reactOnTrigger;
  }

  updateConfig(updates, instanceId);
}

// ─── Mode Detection ───

/**
 * Decide which inbound transport to use given the user's tokens and explicit
 * mode preference. Returns either a definite mode or an error reason.
 */
export function resolveAuthMode(args: {
  authMode: SlackAuthMode | undefined;
  botToken: string | undefined;
  appToken: string | undefined;
}): { mode: 'socket' | 'polling' } | { error: string } {
  const { botToken, appToken } = args;
  const explicit = args.authMode ?? 'auto';

  if (!botToken) return { error: 'Missing Slack token (SLACK_BOT_TOKEN)' };

  const looksLikeUserToken = botToken.startsWith('xoxp-');

  let resolved: 'socket' | 'polling';
  if (explicit === 'auto') {
    if (looksLikeUserToken) resolved = 'polling';
    else resolved = 'socket'; // xoxb- and unknown prefixes default to socket
  } else {
    resolved = explicit;
  }

  if (resolved === 'socket' && !appToken) {
    return { error: 'Socket Mode requires SLACK_APP_TOKEN (xapp-...)' };
  }
  if (resolved === 'socket' && looksLikeUserToken) {
    return { error: 'User tokens (xoxp-) cannot use Socket Mode — set Inbound Mode to "polling"' };
  }

  return { mode: resolved };
}
