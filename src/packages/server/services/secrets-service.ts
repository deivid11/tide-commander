/**
 * Secrets Service
 * Business logic for managing secrets that can be used in agent prompts
 *
 * Secrets are key-value pairs stored securely on disk. They can be referenced
 * in prompts using placeholders like {{SECRET_KEY}} which are replaced with
 * the actual values before being sent to Claude.
 */

import type { Secret } from '../../shared/types.js';
import { loadSecrets, saveSecrets } from '../data/index.js';
import { createLogger, generateId } from '../utils/index.js';

const log = createLogger('SecretsService');

// In-memory secret storage
const secrets = new Map<string, Secret>();

// Listeners for secret changes
type SecretListener = (event: string, secret: Secret | string) => void;
const listeners = new Set<SecretListener>();

// ============================================================================
// Initialization
// ============================================================================

export function initSecrets(): void {
  try {
    const storedSecrets = loadSecrets();
    for (const secret of storedSecrets) {
      secrets.set(secret.id, secret);
    }
    log.log(` Loaded ${secrets.size} secrets`);
  } catch (err) {
    log.error(' Failed to load secrets:', err);
  }
}

export function persistSecrets(): void {
  try {
    saveSecrets(Array.from(secrets.values()));
  } catch (err) {
    log.error(' Failed to save secrets:', err);
  }
}

// ============================================================================
// Event System
// ============================================================================

export function subscribe(listener: SecretListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: string, data: Secret | string): void {
  listeners.forEach((listener) => listener(event, data));
}

// ============================================================================
// Secret CRUD
// ============================================================================

export function getSecret(id: string): Secret | undefined {
  return secrets.get(id);
}

export function getSecretByKey(key: string): Secret | undefined {
  return Array.from(secrets.values()).find(s => s.key === key);
}

export function getAllSecrets(): Secret[] {
  return Array.from(secrets.values());
}

/**
 * Ensure key is unique by checking existing secrets
 */
function isKeyUnique(key: string, excludeId?: string): boolean {
  const existing = getSecretByKey(key);
  return !existing || existing.id === excludeId;
}

/**
 * Normalize a key to uppercase with underscores
 */
function normalizeKey(key: string): string {
  return key
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export interface CreateSecretInput {
  name: string;
  key: string;
  value: string;
  description?: string;
}

export function createSecret(input: CreateSecretInput): Secret | { error: string } {
  const normalizedKey = normalizeKey(input.key);

  if (!normalizedKey) {
    return { error: 'Key cannot be empty' };
  }

  if (!isKeyUnique(normalizedKey)) {
    return { error: `Key "${normalizedKey}" already exists` };
  }

  const id = generateId();

  const secret: Secret = {
    id,
    name: input.name,
    key: normalizedKey,
    value: input.value,
    description: input.description,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  secrets.set(id, secret);
  persistSecrets();
  emit('created', secret);

  log.log(` Created secret "${secret.name}" (${secret.key})`);
  return secret;
}

export function updateSecret(id: string, updates: Partial<Omit<Secret, 'id' | 'createdAt' | 'updatedAt'>>): Secret | { error: string } | undefined {
  const secret = secrets.get(id);
  if (!secret) {
    log.error(` Secret not found: ${id}`);
    return undefined;
  }

  // If key is being updated, normalize and check uniqueness
  let newKey = secret.key;
  if (updates.key !== undefined) {
    newKey = normalizeKey(updates.key);
    if (!newKey) {
      return { error: 'Key cannot be empty' };
    }
    if (!isKeyUnique(newKey, id)) {
      return { error: `Key "${newKey}" already exists` };
    }
  }

  const updatedSecret: Secret = {
    ...secret,
    ...updates,
    key: newKey,
    updatedAt: Date.now(),
  };

  secrets.set(id, updatedSecret);
  persistSecrets();
  emit('updated', updatedSecret);

  log.log(` Updated secret "${updatedSecret.name}" (${updatedSecret.key})`);
  return updatedSecret;
}

export function deleteSecret(id: string): boolean {
  const secret = secrets.get(id);
  if (!secret) {
    log.error(` Secret not found: ${id}`);
    return false;
  }

  secrets.delete(id);
  persistSecrets();
  emit('deleted', id);

  log.log(` Deleted secret "${secret.name}" (${secret.key})`);
  return true;
}

// ============================================================================
// Secret Replacement
// ============================================================================

/**
 * Replace all secret placeholders in a string with their actual values.
 * Placeholders use the format {{SECRET_KEY}}.
 *
 * @param text - The text containing placeholders
 * @returns The text with placeholders replaced by actual values
 */
export function replaceSecrets(text: string): string {
  if (!text) return text;

  // Match {{KEY}} patterns
  return text.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    const secret = getSecretByKey(key);
    if (secret) {
      return secret.value;
    }
    // Leave unmatched placeholders as-is
    return match;
  });
}

/**
 * Check if a string contains any secret placeholders
 */
export function hasSecretPlaceholders(text: string): boolean {
  if (!text) return false;
  return /\{\{[A-Z0-9_]+\}\}/.test(text);
}

/**
 * Get all placeholder keys found in a string
 */
export function getPlaceholderKeys(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/\{\{([A-Z0-9_]+)\}\}/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.slice(2, -2)))];
}

/**
 * Validate that all placeholders in a string have corresponding secrets
 * Returns an array of missing keys, or empty array if all are found
 */
export function validatePlaceholders(text: string): string[] {
  const keys = getPlaceholderKeys(text);
  return keys.filter(key => !getSecretByKey(key));
}

// Export secrets service as a singleton-like object for consistency
export const secretsService = {
  init: initSecrets,
  persist: persistSecrets,
  subscribe,
  getSecret,
  getSecretByKey,
  getAllSecrets,
  createSecret,
  updateSecret,
  deleteSecret,
  replaceSecrets,
  hasSecretPlaceholders,
  getPlaceholderKeys,
  validatePlaceholders,
};
