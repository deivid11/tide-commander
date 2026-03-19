/**
 * Google Calendar Integration Configuration
 * ConfigField[] schema + config persistence
 *
 * Shares OAuth2 credentials with Gmail plugin via the shared secrets system.
 * Secrets used: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConfigField } from '../../../shared/integration-types.js';
import { getDataDir } from '../../data/index.js';

// ─── Config Type ───

export interface CalendarConfig {
  enabled: boolean;
  calendarId: string;           // Default: 'primary'
  holidays: string[];           // ISO date strings (e.g. "2024-12-25")
  urgentThreshold: number;      // Working days threshold for isUrgent flag
}

const DEFAULT_CONFIG: CalendarConfig = {
  enabled: false,
  calendarId: 'primary',
  holidays: [],
  urgentThreshold: 2,
};

// ─── Config File Persistence ───

function getConfigPath(): string {
  return path.join(getDataDir(), 'calendar-config.json');
}

let cachedConfig: CalendarConfig | null = null;

export function loadConfig(): CalendarConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const result: CalendarConfig = { ...DEFAULT_CONFIG, ...data };
      cachedConfig = result;
      return result;
    }
  } catch {
    // Corrupted config, use defaults
  }

  const defaults: CalendarConfig = { ...DEFAULT_CONFIG };
  cachedConfig = defaults;
  return defaults;
}

export function saveConfig(config: CalendarConfig): void {
  cachedConfig = config;
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

export function updateConfig(updates: Partial<CalendarConfig>): CalendarConfig {
  const config = loadConfig();
  const updated = { ...config, ...updates };
  saveConfig(updated);
  return updated;
}

// ─── Config Schema (for generic settings UI) ───

export const calendarConfigSchema: ConfigField[] = [
  {
    key: 'enabled',
    label: 'Enable Calendar Integration',
    type: 'boolean',
    description: 'Enable or disable the Google Calendar connection',
    defaultValue: false,
    group: 'General',
  },
  {
    key: 'GOOGLE_CLIENT_ID',
    label: 'Google Client ID',
    type: 'password',
    description: 'OAuth2 Client ID (shared with Gmail integration)',
    placeholder: 'xxxx.apps.googleusercontent.com',
    required: true,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'GOOGLE_CLIENT_SECRET',
    label: 'Google Client Secret',
    type: 'password',
    description: 'OAuth2 Client Secret (shared with Gmail integration)',
    required: true,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'GOOGLE_REFRESH_TOKEN',
    label: 'Google Refresh Token',
    type: 'password',
    description: 'OAuth2 Refresh Token (obtained via one-time auth flow, shared with Gmail)',
    required: true,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'calendarId',
    label: 'Calendar ID',
    type: 'text',
    description: 'Google Calendar ID to use (default: primary)',
    placeholder: 'primary',
    defaultValue: 'primary',
    group: 'Defaults',
  },
  {
    key: 'holidays',
    label: 'Holidays',
    type: 'textarea',
    description: 'Holiday dates in ISO format, one per line (e.g. 2024-12-25). Used for working-days calculation.',
    placeholder: '2024-12-25\n2024-01-01',
    group: 'Working Days',
  },
  {
    key: 'urgentThreshold',
    label: 'Urgent Threshold (days)',
    type: 'number',
    description: 'Number of working days below which a release is considered urgent',
    defaultValue: 2,
    group: 'Working Days',
  },
];

// ─── Config Value Access ───

export function getConfigValues(secrets: { get: (key: string) => string | undefined }): Record<string, unknown> {
  const config = loadConfig();
  return {
    enabled: config.enabled,
    calendarId: config.calendarId,
    holidays: config.holidays.join('\n'),
    urgentThreshold: config.urgentThreshold,
    GOOGLE_CLIENT_ID: secrets.get('GOOGLE_CLIENT_ID') ? '********' : '',
    GOOGLE_CLIENT_SECRET: secrets.get('GOOGLE_CLIENT_SECRET') ? '********' : '',
    GOOGLE_REFRESH_TOKEN: secrets.get('GOOGLE_REFRESH_TOKEN') ? '********' : '',
  };
}

export async function setConfigValues(
  values: Record<string, unknown>,
  secrets: { get: (key: string) => string | undefined; set: (key: string, value: string) => void },
): Promise<void> {
  // Handle secret fields (shared with Gmail)
  for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'] as const) {
    const val = values[key];
    if (typeof val === 'string' && val && val !== '********') {
      secrets.set(key, val);
    }
  }

  // Handle non-secret config
  const updates: Partial<CalendarConfig> = {};
  if (typeof values.enabled === 'boolean') updates.enabled = values.enabled;
  if (typeof values.calendarId === 'string') updates.calendarId = values.calendarId || 'primary';
  if (typeof values.urgentThreshold === 'number') updates.urgentThreshold = values.urgentThreshold;

  // Parse holidays textarea (newline-separated ISO dates)
  if (typeof values.holidays === 'string') {
    updates.holidays = values.holidays
      .split('\n')
      .map((d: string) => d.trim())
      .filter((d: string) => d && /^\d{4}-\d{2}-\d{2}$/.test(d));
  }

  updateConfig(updates);
}
