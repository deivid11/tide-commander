/**
 * Slack Integration Configuration
 * ConfigField[] schema + config persistence + config type
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConfigField } from '../../../shared/integration-types.js';
import { getDataDir } from '../../data/index.js';

// ─── Config Type ───

export interface SlackConfig {
  enabled: boolean;
  defaultChannelId?: string;
  botUserId?: string;
  botName?: string;
  connectedAt?: number;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  lastError?: string;
}

const DEFAULT_CONFIG: SlackConfig = {
  enabled: false,
  status: 'disconnected',
};

// ─── Config File Persistence ───

function getConfigPath(): string {
  return path.join(getDataDir(), 'slack-config.json');
}

let cachedConfig: SlackConfig | null = null;

export function loadConfig(): SlackConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const result: SlackConfig = { ...DEFAULT_CONFIG, ...data };
      cachedConfig = result;
      return result;
    }
  } catch {
    // Corrupted config, use defaults
  }

  const defaults: SlackConfig = { ...DEFAULT_CONFIG };
  cachedConfig = defaults;
  return defaults;
}

export function saveConfig(config: SlackConfig): void {
  cachedConfig = config;
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function updateConfig(updates: Partial<SlackConfig>): SlackConfig {
  const config = loadConfig();
  const updated = { ...config, ...updates };
  saveConfig(updated);
  return updated;
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
    label: 'Bot Token',
    type: 'password',
    description: 'Slack Bot User OAuth Token (xoxb-...)',
    placeholder: 'xoxb-...',
    required: true,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'SLACK_APP_TOKEN',
    label: 'App Token',
    type: 'password',
    description: 'Slack App-Level Token for Socket Mode (xapp-...)',
    placeholder: 'xapp-...',
    required: true,
    secret: true,
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
];

// ─── Config Value Access (for IntegrationPlugin.getConfig/setConfig) ───

export function getConfigValues(secrets: { get: (key: string) => string | undefined }): Record<string, unknown> {
  const config = loadConfig();
  return {
    enabled: config.enabled,
    defaultChannelId: config.defaultChannelId || '',
    // Mask secret values for UI display
    SLACK_BOT_TOKEN: secrets.get('SLACK_BOT_TOKEN') ? '********' : '',
    SLACK_APP_TOKEN: secrets.get('SLACK_APP_TOKEN') ? '********' : '',
  };
}

export async function setConfigValues(
  values: Record<string, unknown>,
  secrets: { get: (key: string) => string | undefined; set: (key: string, value: string) => void },
): Promise<void> {
  // Handle secret fields
  if (typeof values.SLACK_BOT_TOKEN === 'string' && values.SLACK_BOT_TOKEN && values.SLACK_BOT_TOKEN !== '********') {
    secrets.set('SLACK_BOT_TOKEN', values.SLACK_BOT_TOKEN);
  }
  if (typeof values.SLACK_APP_TOKEN === 'string' && values.SLACK_APP_TOKEN && values.SLACK_APP_TOKEN !== '********') {
    secrets.set('SLACK_APP_TOKEN', values.SLACK_APP_TOKEN);
  }

  // Handle non-secret config
  const updates: Partial<SlackConfig> = {};
  if (typeof values.enabled === 'boolean') updates.enabled = values.enabled;
  if (typeof values.defaultChannelId === 'string') updates.defaultChannelId = values.defaultChannelId || undefined;

  updateConfig(updates);
}
