/**
 * SlackInstanceManifest — owns the list of Slack instances the server knows
 * about, persisted at ~/.local/share/tide-commander/slack-instances.json.
 *
 * Each instance has:
 *   - `id`     : kebab-case slug. `default` is reserved + always present.
 *   - `label`  : human-readable name shown in the UI.
 *   - `createdAt` : ms since epoch.
 *
 * The manifest is the source of truth for "which instances exist". Per-instance
 * config (auth mode, polling settings, etc.) lives in `slack-config-<id>.json`,
 * managed by slack-config.ts.
 *
 * Atomic writes: temp + rename, same pattern as the watermark store.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getDataDir } from '../../data/index.js';
import { DEFAULT_INSTANCE_ID, deleteConfig } from './slack-config.js';

export interface SlackInstanceMeta {
  id: string;
  label: string;
  createdAt: number;
}

interface ManifestFile {
  version: 1;
  instances: SlackInstanceMeta[];
}

const FILE_VERSION = 1;

function manifestPath(): string {
  return path.join(getDataDir(), 'slack-instances.json');
}

function defaultManifest(): ManifestFile {
  return {
    version: FILE_VERSION,
    instances: [
      { id: DEFAULT_INSTANCE_ID, label: 'Default', createdAt: Date.now() },
    ],
  };
}

let cached: ManifestFile | null = null;

function readManifest(): ManifestFile {
  if (cached) return cached;
  const p = manifestPath();
  try {
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<ManifestFile>;
      if (raw && raw.version === FILE_VERSION && Array.isArray(raw.instances)) {
        // Sanity: ensure default is present
        const hasDefault = raw.instances.some((i) => i?.id === DEFAULT_INSTANCE_ID);
        const list: SlackInstanceMeta[] = raw.instances
          .filter((i): i is SlackInstanceMeta => !!i && typeof i.id === 'string' && typeof i.label === 'string');
        if (!hasDefault) {
          list.unshift({ id: DEFAULT_INSTANCE_ID, label: 'Default', createdAt: Date.now() });
        }
        cached = { version: FILE_VERSION, instances: list };
        return cached;
      }
    }
  } catch {
    // Corrupt — fall through to defaults.
  }
  cached = defaultManifest();
  // Persist so subsequent reads are stable.
  writeManifest(cached);
  return cached;
}

function writeManifest(m: ManifestFile): void {
  const p = manifestPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
  cached = m;
}

// ─── Change events ───
//
// Consumers (e.g. the trigger handler) need to know when an instance is added
// or removed so they can attach/detach per-instance listeners without waiting
// for an integration restart. Kept intentionally tiny — a Set of callbacks
// instead of pulling in Node's EventEmitter.

export type SlackInstanceChange =
  | { type: 'added'; id: string; meta: SlackInstanceMeta }
  | { type: 'removed'; id: string };

type ChangeListener = (change: SlackInstanceChange) => void;

const changeListeners = new Set<ChangeListener>();

/**
 * Register a listener for instance-added / instance-removed events. Returns an
 * unsubscribe function. Listener errors are swallowed so one bad subscriber
 * can't break the manifest mutation path.
 */
export function onInstanceChange(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => { changeListeners.delete(listener); };
}

function emitChange(change: SlackInstanceChange): void {
  for (const l of changeListeners) {
    try { l(change); } catch { /* swallow */ }
  }
}

// ─── Public API ───

/** All instances, in display order. `default` always first if present. */
export function listInstanceMetas(): SlackInstanceMeta[] {
  const m = readManifest();
  // Default first, then other instances by createdAt ascending.
  const def = m.instances.filter((i) => i.id === DEFAULT_INSTANCE_ID);
  const rest = m.instances
    .filter((i) => i.id !== DEFAULT_INSTANCE_ID)
    .sort((a, b) => a.createdAt - b.createdAt);
  return [...def, ...rest];
}

export function getInstanceMeta(id: string): SlackInstanceMeta | undefined {
  return readManifest().instances.find((i) => i.id === id);
}

export function hasInstance(id: string): boolean {
  return readManifest().instances.some((i) => i.id === id);
}

const ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

/** Validate a user-provided instance id. Returns null if valid, error string otherwise. */
export function validateInstanceId(id: string): string | null {
  if (!id || typeof id !== 'string') return 'Instance id is required';
  if (!ID_RE.test(id)) {
    return 'Instance id must be 1-32 chars, lowercase alphanumeric or dashes, no leading/trailing dash';
  }
  if (id === 'tmp' || id === 'new') return `"${id}" is reserved`;
  return null;
}

export function addInstance(id: string, label: string): SlackInstanceMeta {
  const validationErr = validateInstanceId(id);
  if (validationErr) throw new Error(validationErr);
  const m = readManifest();
  if (m.instances.some((i) => i.id === id)) {
    throw new Error(`Instance "${id}" already exists`);
  }
  const meta: SlackInstanceMeta = {
    id,
    label: label?.trim() || id,
    createdAt: Date.now(),
  };
  m.instances.push(meta);
  writeManifest(m);
  emitChange({ type: 'added', id: meta.id, meta });
  return meta;
}

export function renameInstance(id: string, newLabel: string): SlackInstanceMeta {
  const m = readManifest();
  const inst = m.instances.find((i) => i.id === id);
  if (!inst) throw new Error(`Instance "${id}" not found`);
  inst.label = newLabel?.trim() || inst.label;
  writeManifest(m);
  return inst;
}

/**
 * Remove an instance from the manifest AND delete its persisted config file.
 * The default instance can NEVER be removed — it's the implicit fallback.
 * Secrets are not auto-purged here (no enumerate API on the secret store);
 * the caller should overwrite the per-instance secret keys with empty strings
 * if it wants them gone.
 */
export function removeInstance(id: string): void {
  if (id === DEFAULT_INSTANCE_ID) {
    throw new Error('Cannot remove the default instance');
  }
  const m = readManifest();
  const before = m.instances.length;
  m.instances = m.instances.filter((i) => i.id !== id);
  if (m.instances.length === before) {
    throw new Error(`Instance "${id}" not found`);
  }
  writeManifest(m);
  // Drop the per-instance config file too.
  deleteConfig(id);
  emitChange({ type: 'removed', id });
}

/** Reset cache — for tests. */
export function resetManifestCache(): void {
  cached = null;
}

/** Drop all change-listeners — for tests that need a clean slate. */
export function resetManifestListeners(): void {
  changeListeners.clear();
}
