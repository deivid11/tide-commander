/**
 * WhatsApp Notification Config Service
 * Manages per-event-type filters for the WhatsApp notification publisher.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createLogger } from '../utils/logger.js';

const log = createLogger('WhatsAppNotificationConfig');

const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander'
);

const CONFIG_FILE = path.join(DATA_DIR, 'whatsapp-notifications.json');

export type WhatsAppNotificationEventType =
  | 'messages'
  | 'statusChanges'
  | 'taskComplete'
  | 'errors'
  | 'planReady'
  | 'agentSpawned'
  | 'agentStopped';

export const WHATSAPP_NOTIFICATION_EVENT_TYPES: WhatsAppNotificationEventType[] = [
  'messages',
  'statusChanges',
  'taskComplete',
  'errors',
  'planReady',
  'agentSpawned',
  'agentStopped',
];

export interface WhatsAppNotificationFilter {
  messages: boolean;
  statusChanges: boolean;
  taskComplete: boolean;
  errors: boolean;
  planReady: boolean;
  agentSpawned: boolean;
  agentStopped: boolean;
}

export interface WhatsAppNotificationConfig {
  filter: WhatsAppNotificationFilter;
  recipient: string;
  updatedAt: number;
  version: string;
}

const DEFAULT_FILTER: WhatsAppNotificationFilter = {
  messages: true,
  statusChanges: true,
  taskComplete: true,
  errors: true,
  planReady: true,
  agentSpawned: true,
  agentStopped: true,
};

export function getDefaultConfig(): WhatsAppNotificationConfig {
  return {
    filter: { ...DEFAULT_FILTER },
    recipient: '',
    updatedAt: 0,
    version: '1.0',
  };
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function normalizeFilter(input: unknown): WhatsAppNotificationFilter {
  const next: WhatsAppNotificationFilter = { ...DEFAULT_FILTER };
  if (!input || typeof input !== 'object') return next;
  const obj = input as Record<string, unknown>;
  for (const key of WHATSAPP_NOTIFICATION_EVENT_TYPES) {
    const v = obj[key];
    if (typeof v === 'boolean') next[key] = v;
  }
  return next;
}

export function getConfig(): WhatsAppNotificationConfig {
  ensureDataDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      return {
        filter: normalizeFilter(raw?.filter),
        recipient: typeof raw?.recipient === 'string' ? raw.recipient : '',
        updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : 0,
        version: typeof raw?.version === 'string' ? raw.version : '1.0',
      };
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`Failed to load WhatsApp notification config: ${msg}`);
  }
  return getDefaultConfig();
}

export interface UpdateInput {
  filter?: Partial<WhatsAppNotificationFilter>;
  recipient?: string;
}

export function updateConfig(input: UpdateInput): WhatsAppNotificationConfig {
  ensureDataDir();
  const current = getConfig();
  const nextFilter: WhatsAppNotificationFilter = { ...current.filter };
  if (input.filter && typeof input.filter === 'object') {
    for (const key of WHATSAPP_NOTIFICATION_EVENT_TYPES) {
      const v = input.filter[key];
      if (typeof v === 'boolean') nextFilter[key] = v;
    }
  }
  const next: WhatsAppNotificationConfig = {
    filter: nextFilter,
    recipient: typeof input.recipient === 'string' ? input.recipient.trim() : current.recipient,
    updatedAt: Date.now(),
    version: '1.0',
  };
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf-8');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`Failed to save WhatsApp notification config: ${msg}`);
    throw error;
  }
  return next;
}

export function clearConfig(): void {
  ensureDataDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    log.error(`Failed to clear WhatsApp notification config: ${msg}`);
    throw error;
  }
}

export function isEventEnabled(event: WhatsAppNotificationEventType): boolean {
  const cfg = getConfig();
  return cfg.filter[event] !== false;
}

export function getRecipient(): string {
  return getConfig().recipient;
}
