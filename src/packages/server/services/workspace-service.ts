/**
 * Workspace Service
 * Manages workspaces - named groups of areas for filtering agent views
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Workspaces');

const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander'
);

const WORKSPACES_FILE = path.join(DATA_DIR, 'workspaces.json');

export interface Workspace {
  id: string;
  name: string;
  areaIds: string[];
  cameraState?: { x: number; y: number; z: number; targetX: number; targetY: number; targetZ: number };
  cameraState2d?: { x: number; y: number; zoom: number };
  createdAt: number;
  updatedAt: number;
}

interface WorkspacesData {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadData(): WorkspacesData {
  ensureDataDir();
  try {
    if (fs.existsSync(WORKSPACES_FILE)) {
      return JSON.parse(fs.readFileSync(WORKSPACES_FILE, 'utf-8'));
    }
  } catch (error: any) {
    log.error(`Failed to load workspaces: ${error.message}`);
  }
  return { workspaces: [], activeWorkspaceId: null };
}

function saveData(data: WorkspacesData): void {
  ensureDataDir();
  fs.writeFileSync(WORKSPACES_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function getWorkspaces(): Workspace[] {
  return loadData().workspaces;
}

export function getWorkspace(id: string): Workspace | null {
  const data = loadData();
  return data.workspaces.find(w => w.id === id) || null;
}

export function createWorkspace(name: string, areaIds: string[]): Workspace {
  const data = loadData();
  const now = Date.now();
  const workspace: Workspace = {
    id: crypto.randomUUID(),
    name,
    areaIds,
    createdAt: now,
    updatedAt: now,
  };
  data.workspaces.push(workspace);
  saveData(data);
  log.log(`Created workspace "${name}" with ${areaIds.length} areas`);
  return workspace;
}

export function updateWorkspace(
  id: string,
  updates: Partial<Pick<Workspace, 'name' | 'areaIds' | 'cameraState' | 'cameraState2d'>>
): Workspace | null {
  const data = loadData();
  const index = data.workspaces.findIndex(w => w.id === id);
  if (index === -1) return null;

  const workspace = data.workspaces[index];
  if (updates.name !== undefined) workspace.name = updates.name;
  if (updates.areaIds !== undefined) workspace.areaIds = updates.areaIds;
  if (updates.cameraState !== undefined) workspace.cameraState = updates.cameraState;
  if (updates.cameraState2d !== undefined) workspace.cameraState2d = updates.cameraState2d;
  workspace.updatedAt = Date.now();

  data.workspaces[index] = workspace;
  saveData(data);
  log.log(`Updated workspace "${workspace.name}"`);
  return workspace;
}

export function deleteWorkspace(id: string): boolean {
  const data = loadData();
  const before = data.workspaces.length;
  data.workspaces = data.workspaces.filter(w => w.id !== id);
  if (data.workspaces.length === before) return false;

  // Clear active if deleted
  if (data.activeWorkspaceId === id) {
    data.activeWorkspaceId = null;
  }
  saveData(data);
  log.log(`Deleted workspace ${id}`);
  return true;
}

export function getActiveWorkspace(): string | null {
  return loadData().activeWorkspaceId;
}

export function setActiveWorkspace(id: string | null): void {
  const data = loadData();
  if (id !== null) {
    const exists = data.workspaces.some(w => w.id === id);
    if (!exists) {
      throw new Error(`Workspace ${id} not found`);
    }
  }
  data.activeWorkspaceId = id;
  saveData(data);
  log.log(`Active workspace set to: ${id ?? 'none (show all)'}`);
}
