/**
 * Workflow Store
 * JSON file persistence for WorkflowDefinition[].
 * Definitions are user-edited templates stored in:
 *   ~/.local/share/tide-commander/workflow-definitions.json
 *
 * Runtime instances live in SQLite (via event-queries.ts).
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from './index.js';
import { createLogger } from '../utils/logger.js';
import type { WorkflowDefinition } from '../../shared/workflow-types.js';

const log = createLogger('WorkflowStore');

const FILENAME = 'workflow-definitions.json';
let definitions: WorkflowDefinition[] = [];

function getFilePath(): string {
  return path.join(getDataDir(), FILENAME);
}

// ─── Persistence ───

function loadFromDisk(): void {
  const filePath = getFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      definitions = JSON.parse(raw) as WorkflowDefinition[];
      log.log(`Loaded ${definitions.length} workflow definition(s)`);
    } else {
      definitions = [];
      log.log('No workflow definitions file found, starting empty');
    }
  } catch (err) {
    log.error(`Failed to load workflow definitions: ${err}`);
    definitions = [];
  }
}

function saveToDisk(): void {
  const filePath = getFilePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(definitions, null, 2), 'utf-8');
  } catch (err) {
    log.error(`Failed to save workflow definitions: ${err}`);
  }
}

// ─── Lifecycle ───

export function init(): void {
  loadFromDisk();
}

// ─── CRUD ───

export function listDefinitions(): WorkflowDefinition[] {
  return definitions;
}

export function getDefinition(id: string): WorkflowDefinition | undefined {
  return definitions.find((d) => d.id === id);
}

export function createDefinition(
  data: Omit<WorkflowDefinition, 'id' | 'version' | 'createdAt' | 'updatedAt'>
): WorkflowDefinition {
  const now = Date.now();
  const id = generateId();
  const def: WorkflowDefinition = {
    ...data,
    id,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  definitions.push(def);
  saveToDisk();
  return def;
}

export function updateDefinition(
  id: string,
  updates: Partial<WorkflowDefinition>
): WorkflowDefinition | null {
  const idx = definitions.findIndex((d) => d.id === id);
  if (idx === -1) return null;

  const existing = definitions[idx];
  const updated: WorkflowDefinition = {
    ...existing,
    ...updates,
    id: existing.id, // prevent id overwrite
    version: existing.version + 1,
    updatedAt: Date.now(),
    createdAt: existing.createdAt, // prevent createdAt overwrite
  };
  definitions[idx] = updated;
  saveToDisk();
  return updated;
}

export function deleteDefinition(id: string): boolean {
  const idx = definitions.findIndex((d) => d.id === id);
  if (idx === -1) return false;
  definitions.splice(idx, 1);
  saveToDisk();
  return true;
}

// ─── Helpers ───

function generateId(): string {
  return 'wf_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
