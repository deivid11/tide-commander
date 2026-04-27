/**
 * WhatsApp Integration Configuration
 * Persists non-secret config to ~/.local/share/tide-commander/whatsapp-config.json.
 * Secrets (API key) live in the encrypted secrets store via IntegrationContext.secrets.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ConfigField } from '../../../shared/integration-types.js';
import { getDataDir } from '../../data/index.js';

// ─── Config Type ───

export interface WhatsAppConfig {
  enabled: boolean;
  baseUrl: string;
  defaultSessionId?: string;
  webhookVerifyToken?: string;
  /**
   * When true, the bridge enriches inbound `whatsapp_message` payloads with
   * the sender's display name via GET /api/sessions/:id/contacts (cached). The
   * upstream webhook payload does NOT include pushName, so this is the only
   * way to render "Juan Perez" instead of a raw JID on the frontend toast.
   * Defaults to true; set false to skip the upstream call entirely.
   */
  enrichContactName?: boolean;
  /**
   * Frontend-only UI preference. When false, the client suppresses the
   * incoming-message toast. The bridge ALWAYS broadcasts `whatsapp_message`
   * events on the WS — this flag is read by the toast component, not by the
   * server, so other consumers (workflows, scripts) keep observing events.
   * Defaults to true.
   */
  showIncomingToasts?: boolean;
  updatedAt: number;
  version: '1';
}

const DEFAULT_CONFIG: WhatsAppConfig = {
  enabled: false,
  baseUrl: 'http://localhost:3007',
  enrichContactName: true,
  showIncomingToasts: true,
  updatedAt: 0,
  version: '1',
};

// ─── Secret Keys ───

export const WHATSAPP_API_KEY_SECRET = 'whatsapp.apiKey';

// ─── Config File Persistence ───

function getConfigPath(): string {
  return path.join(getDataDir(), 'whatsapp-config.json');
}

let cachedConfig: WhatsAppConfig | null = null;

export function loadConfig(): WhatsAppConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getConfigPath();
  try {
    if (fs.existsSync(configPath)) {
      const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const result: WhatsAppConfig = { ...DEFAULT_CONFIG, ...data, version: '1' };
      cachedConfig = result;
      return result;
    }
  } catch {
    // Corrupted config, use defaults
  }

  const defaults: WhatsAppConfig = { ...DEFAULT_CONFIG };
  cachedConfig = defaults;
  return defaults;
}

export function saveConfig(config: WhatsAppConfig): void {
  const next: WhatsAppConfig = { ...config, updatedAt: Date.now(), version: '1' };
  cachedConfig = next;
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf-8');
}

export function updateConfig(updates: Partial<WhatsAppConfig>): WhatsAppConfig {
  const config = loadConfig();
  const updated: WhatsAppConfig = { ...config, ...updates };
  saveConfig(updated);
  return updated;
}

// ─── Config Schema (for generic settings UI) ───

export const whatsappConfigSchema: ConfigField[] = [
  {
    key: 'enabled',
    label: 'Enable WhatsApp Integration',
    type: 'boolean',
    description: 'Enable or disable the WhatsApp connection',
    defaultValue: false,
    group: 'General',
  },
  {
    key: 'enrichContactName',
    label: 'Enrich sender name from contacts',
    type: 'boolean',
    description: 'Resolve inbound sender display names via the contacts API (cached). Disable if the upstream contacts endpoint is unavailable.',
    defaultValue: true,
    group: 'General',
  },
  {
    key: 'showIncomingToasts',
    label: 'Show incoming message toasts',
    type: 'boolean',
    description: 'Pop a toast in the UI when a WhatsApp message arrives. Disable to silence the integration without unbroadcasting events — agents and workflows still receive `whatsapp_message` events.',
    defaultValue: true,
    group: 'General',
  },
  {
    key: 'baseUrl',
    label: 'WhatsApp API Base URL',
    type: 'url',
    description: 'Base URL of the WhatsApp API server (e.g. http://localhost:3007)',
    placeholder: 'http://localhost:3007',
    defaultValue: 'http://localhost:3007',
    required: true,
    group: 'Connection',
  },
  {
    key: 'whatsappApiKey',
    label: 'WhatsApp API Key',
    type: 'password',
    description: 'X-API-Key header value used to authenticate against the WhatsApp API server',
    required: true,
    secret: true,
    group: 'Authentication',
  },
  {
    key: 'defaultSessionId',
    label: 'Default Session ID',
    type: 'text',
    description: 'Default Baileys session id used when send-message is called without an explicit sessionId',
    placeholder: 'default',
    group: 'Defaults',
  },
  {
    key: 'webhookVerifyToken',
    label: 'Webhook Verify Token',
    type: 'password',
    description: 'Token used to verify incoming webhooks from the WhatsApp API server (Phase 2)',
    secret: true,
    group: 'Webhooks',
  },
];

// ─── Config Value Access (for IntegrationPlugin.getConfig/setConfig) ───

interface SecretsAccessor {
  get: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
}

export function getConfigValues(secrets: { get: (key: string) => string | undefined }): Record<string, unknown> {
  const config = loadConfig();
  return {
    enabled: config.enabled,
    baseUrl: config.baseUrl,
    defaultSessionId: config.defaultSessionId || '',
    enrichContactName: config.enrichContactName !== false,
    showIncomingToasts: config.showIncomingToasts !== false,
    // Mask secret values for UI display
    whatsappApiKey: secrets.get(WHATSAPP_API_KEY_SECRET) ? '********' : '',
    webhookVerifyToken: config.webhookVerifyToken ? '********' : '',
  };
}

export async function setConfigValues(
  values: Record<string, unknown>,
  secrets: SecretsAccessor,
): Promise<void> {
  // Handle secret fields
  if (
    typeof values.whatsappApiKey === 'string' &&
    values.whatsappApiKey &&
    values.whatsappApiKey !== '********'
  ) {
    secrets.set(WHATSAPP_API_KEY_SECRET, values.whatsappApiKey);
  }

  // Handle non-secret config
  const updates: Partial<WhatsAppConfig> = {};
  if (typeof values.enabled === 'boolean') updates.enabled = values.enabled;
  if (typeof values.baseUrl === 'string' && values.baseUrl) updates.baseUrl = values.baseUrl;
  if (typeof values.defaultSessionId === 'string') {
    updates.defaultSessionId = values.defaultSessionId || undefined;
  }
  if (typeof values.enrichContactName === 'boolean') updates.enrichContactName = values.enrichContactName;
  if (typeof values.showIncomingToasts === 'boolean') updates.showIncomingToasts = values.showIncomingToasts;
  if (
    typeof values.webhookVerifyToken === 'string' &&
    values.webhookVerifyToken &&
    values.webhookVerifyToken !== '********'
  ) {
    updates.webhookVerifyToken = values.webhookVerifyToken;
  }

  updateConfig(updates);
}
