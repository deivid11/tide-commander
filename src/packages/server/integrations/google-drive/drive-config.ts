/**
 * Google Drive Integration Configuration
 * ConfigField[] schema + config persistence
 *
 * Shares OAuth2 credentials with Gmail/Calendar plugins via the shared secrets system.
 * Secrets used: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConfigField } from '../../../shared/integration-types.js';
import { getDataDir } from '../../data/index.js';

// ─── Config Type ───

export interface DriveConfig {
  enabled: boolean;
  defaultFolderId: string;  // Default folder ID to operate in ('' = root)
}

const DEFAULT_CONFIG: DriveConfig = {
  enabled: false,
  defaultFolderId: '',
};

// ─── Config File Persistence ───

function getConfigPath(): string {
  return path.join(getDataDir(), 'drive-config.json');
}

let cachedConfig: DriveConfig | null = null;

export function loadConfig(): DriveConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const result: DriveConfig = { ...DEFAULT_CONFIG, ...data };
      cachedConfig = result;
      return result;
    }
  } catch {
    // Corrupted config, use defaults
  }

  const defaults: DriveConfig = { ...DEFAULT_CONFIG };
  cachedConfig = defaults;
  return defaults;
}

export function saveConfig(config: DriveConfig): void {
  cachedConfig = config;
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function updateConfig(updates: Partial<DriveConfig>): DriveConfig {
  const config = loadConfig();
  const updated = { ...config, ...updates };
  saveConfig(updated);
  return updated;
}

// ─── Config Schema (for generic settings UI) ───

export const driveConfigSchema: ConfigField[] = [
  {
    key: 'enabled',
    label: 'Enable Google Drive Integration',
    type: 'boolean',
    description: 'Enable or disable the Google Drive connection',
    defaultValue: false,
    group: 'General',
  },
  {
    key: 'GOOGLE_CLIENT_ID',
    label: 'Google Client ID',
    type: 'password',
    description: 'OAuth2 Client ID (shared with Gmail/Calendar integrations)',
    placeholder: 'xxxx.apps.googleusercontent.com',
    required: true,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'GOOGLE_CLIENT_SECRET',
    label: 'Google Client Secret',
    type: 'password',
    description: 'OAuth2 Client Secret (shared with Gmail/Calendar integrations)',
    required: true,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'GOOGLE_REFRESH_TOKEN',
    label: 'Google Refresh Token',
    type: 'password',
    description: 'OAuth2 Refresh Token (obtained via one-time auth flow, shared with Gmail/Calendar)',
    required: true,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'defaultFolderId',
    label: 'Default Folder ID',
    type: 'text',
    description: 'Google Drive folder ID to use as default root (leave empty for My Drive root)',
    placeholder: 'e.g. 1a2b3c4d5e6f...',
    group: 'Defaults',
  },
];

// ─── Config Value Access ───

export function getConfigValues(secrets: { get: (key: string) => string | undefined }): Record<string, unknown> {
  const config = loadConfig();
  return {
    enabled: config.enabled,
    defaultFolderId: config.defaultFolderId,
    GOOGLE_CLIENT_ID: secrets.get('GOOGLE_CLIENT_ID') ? '********' : '',
    GOOGLE_CLIENT_SECRET: secrets.get('GOOGLE_CLIENT_SECRET') ? '********' : '',
    GOOGLE_REFRESH_TOKEN: secrets.get('GOOGLE_REFRESH_TOKEN') ? '********' : '',
  };
}

export async function setConfigValues(
  values: Record<string, unknown>,
  secrets: { get: (key: string) => string | undefined; set: (key: string, value: string) => void },
): Promise<void> {
  // Handle secret fields (shared with Gmail/Calendar)
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const) {
    const val = values[key];
    if (typeof val === 'string' && val && val !== '********') {
      secrets.set(key, val);
    }
  }

  // Handle non-secret config
  const updates: Partial<DriveConfig> = {};
  if (typeof values.enabled === 'boolean') updates.enabled = values.enabled;
  if (typeof values.defaultFolderId === 'string') updates.defaultFolderId = values.defaultFolderId;

  updateConfig(updates);
}
