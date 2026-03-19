/**
 * Trigger Store
 * JSON file persistence for trigger definitions.
 * Follows the existing pattern: atomicWriteJson / safeReadJsonSync, debounced writes.
 *
 * Storage location: ~/.local/share/tide-commander/triggers.json
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Trigger } from '../../shared/trigger-types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TriggerStore');

// XDG-compliant data directory (same as src/packages/server/data/index.ts)
const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander'
);

const TRIGGERS_FILE = path.join(DATA_DIR, 'triggers.json');

interface TriggersData {
  triggers: Trigger[];
  savedAt: number;
  version: string;
}

// ─── Helpers (same pattern as src/packages/server/data/index.ts) ───

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function atomicWriteJsonSync(filePath: string, data: unknown): void {
  const tmpFile = filePath + '.tmp';
  const bakFile = filePath + '.bak';
  const content = JSON.stringify(data, null, 2);

  fs.writeFileSync(tmpFile, content, 'utf-8');

  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, bakFile);
  }

  fs.renameSync(tmpFile, filePath);
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const tmpFile = filePath + '.tmp';
  const bakFile = filePath + '.bak';
  const content = JSON.stringify(data, null, 2);

  await fs.promises.writeFile(tmpFile, content, 'utf-8');

  try {
    await fs.promises.access(filePath);
    await fs.promises.copyFile(filePath, bakFile);
  } catch {
    // No existing file to backup
  }

  await fs.promises.rename(tmpFile, filePath);
}

function safeReadJsonSync<T>(filePath: string, label: string): T | null {
  const bakFile = filePath + '.bak';

  // Try main file
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    }
  } catch {
    log.error(`${label}: main file corrupted, trying backup...`);
  }

  // Try backup
  try {
    if (fs.existsSync(bakFile)) {
      const data = JSON.parse(fs.readFileSync(bakFile, 'utf-8')) as T;
      log.warn(`${label}: recovered from backup file`);
      try { fs.copyFileSync(bakFile, filePath); } catch { /* best effort */ }
      return data;
    }
  } catch {
    log.error(`${label}: backup also corrupted`);
  }

  return null;
}

// ─── Public API ───

export function loadTriggers(): Trigger[] {
  ensureDataDir();
  const data = safeReadJsonSync<TriggersData>(TRIGGERS_FILE, 'Triggers');
  if (data?.triggers) {
    log.log(`Loaded ${data.triggers.length} triggers from ${TRIGGERS_FILE}`);
    return data.triggers;
  }
  return [];
}

export function saveTriggers(triggers: Trigger[]): void {
  ensureDataDir();
  try {
    const data: TriggersData = {
      triggers,
      savedAt: Date.now(),
      version: '1.0.0',
    };
    atomicWriteJsonSync(TRIGGERS_FILE, data);
  } catch (err) {
    log.error('Failed to save triggers:', err);
  }
}

export async function saveTriggersAsync(triggers: Trigger[]): Promise<void> {
  ensureDataDir();
  try {
    const data: TriggersData = {
      triggers,
      savedAt: Date.now(),
      version: '1.0.0',
    };
    await atomicWriteJson(TRIGGERS_FILE, data);
  } catch (err) {
    log.error('Failed to save triggers (async):', err);
  }
}
