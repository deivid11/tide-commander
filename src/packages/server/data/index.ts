/**
 * Tide Data Manager
 * Manages persistent storage for Tide Commander
 *
 * Data is stored in ~/.local/share/tide-commander/
 * - agents.json - Agent configurations and session mappings
 * - areas.json - Drawing areas (synced from frontend)
 *
 * Claude sessions are stored in ~/.claude/projects/<cwd>/
 * We reference them by session ID
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import type { Agent, DrawingArea, AgentSupervisorHistory, AgentSupervisorHistoryEntry, Building, DelegationDecision, Skill, StoredSkill, CustomAgentClass, ContextStats, Secret, StoredSecret, QueryHistoryEntry, SessionHistoryEntry } from '../../shared/types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('Data');

// XDG-compliant data directory
const DATA_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander'
);

const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const AREAS_FILE = path.join(DATA_DIR, 'areas.json');
const BUILDINGS_FILE = path.join(DATA_DIR, 'buildings.json');
const SUPERVISOR_HISTORY_FILE = path.join(DATA_DIR, 'supervisor-history.json');
const DELEGATION_HISTORY_FILE = path.join(DATA_DIR, 'delegation-history.json');
const SKILLS_FILE = path.join(DATA_DIR, 'skills.json');
const CUSTOM_CLASSES_FILE = path.join(DATA_DIR, 'custom-agent-classes.json');
const RUNNING_PROCESSES_FILE = path.join(DATA_DIR, 'running-processes.json');
const SECRETS_FILE = path.join(DATA_DIR, 'secrets.json');
const SESSION_HISTORY_FILE = path.join(DATA_DIR, 'session-history.json');
const AREA_LOGOS_DIR = path.join(DATA_DIR, 'area-logos');

// Maximum history entries per agent
const MAX_HISTORY_PER_AGENT = 50;
const MAX_SESSION_HISTORY_PER_AGENT = 100;
const MAX_DELEGATION_HISTORY_PER_BOSS = 100;

// Agent with session history reference (stored on disk)
// Some fields may be missing in older saved data
export interface StoredAgent {
  id: string;
  name: string;
  class: Agent['class'];
  provider?: Agent['provider']; // May be missing in older data
  position: Agent['position'];
  cwd: string;
  tokensUsed: number;
  contextUsed?: number;  // May be missing in older data
  contextLimit?: number; // May be missing in older data
  contextStats?: ContextStats; // Detailed context stats from /context command
  taskCount?: number;    // May be missing in older data
  permissionMode?: Agent['permissionMode']; // May be missing in older data
  useChrome?: boolean;   // May be missing in older data
  model?: Agent['model']; // May be missing in older data
  codexModel?: Agent['codexModel']; // May be missing in older data
  codexConfig?: Agent['codexConfig']; // May be missing in older data
  opencodeModel?: Agent['opencodeModel']; // May be missing in older data
  createdAt: number;
  lastActivity: number;
  sessionId?: string;
  lastSessionId?: string;
  currentTask?: string;
  // Task tracking for auto-resume
  lastAssignedTask?: string;      // Last task assigned (persisted for auto-resume)
  lastAssignedTaskTime?: number;  // When last task was assigned
  // Brief task label for scene display
  taskLabel?: string;
  // Tracking board status (persisted across restarts)
  trackingStatus?: Agent['trackingStatus'];
  trackingStatusDetail?: string;
  trackingStatusTimestamp?: number;
  // Boss-specific fields
  isBoss?: boolean;           // True if this agent is a boss
  subordinateIds?: string[];  // Only for boss agents
  bossId?: string;            // ID of boss this agent reports to
}

export interface TideData {
  agents: StoredAgent[];
  savedAt: number;
  version: string;
}

// Ensure data directory exists
function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    log.log(` Created data directory: ${DATA_DIR}`);
  }
}

// ============================================================================
// Atomic Write & Safe Read Helpers
// ============================================================================

/**
 * Atomic write (sync): write to .tmp, backup existing to .bak, rename .tmp to target.
 * Prevents corruption from crashes mid-write. Used for shutdown and infrequent saves.
 */
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

/**
 * Atomic write (async): non-blocking variant for hot paths.
 * Same corruption guarantees, doesn't block the event loop.
 */
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

/**
 * Safe JSON read with .bak fallback.
 * If main file is corrupted/missing, tries the backup and restores it.
 */
function safeReadJsonSync<T>(filePath: string, label: string): T | null {
  const bakFile = filePath + '.bak';

  // Try main file
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    }
  } catch {
    log.error(` ${label}: main file corrupted, trying backup...`);
  }

  // Try backup
  try {
    if (fs.existsSync(bakFile)) {
      const data = JSON.parse(fs.readFileSync(bakFile, 'utf-8')) as T;
      log.warn(` ${label}: recovered from backup file`);
      try { fs.copyFileSync(bakFile, filePath); } catch { /* best effort */ }
      return data;
    }
  } catch {
    log.error(` ${label}: backup also corrupted`);
  }

  return null;
}

/**
 * Convert Agent objects to StoredAgent format (strips runtime-only fields)
 */
function toStoredAgents(agents: Agent[]): StoredAgent[] {
  return agents.map(agent => ({
    id: agent.id,
    name: agent.name,
    class: agent.class,
    provider: agent.provider,
    position: agent.position,
    cwd: agent.cwd,
    tokensUsed: agent.tokensUsed,
    contextUsed: agent.contextUsed,
    contextLimit: agent.contextLimit,
    contextStats: agent.contextStats,
    taskCount: agent.taskCount,
    permissionMode: agent.permissionMode,
    useChrome: agent.useChrome,
    model: agent.model,
    codexModel: agent.codexModel,
    codexConfig: agent.codexConfig,
    opencodeModel: agent.opencodeModel,
    createdAt: agent.createdAt,
    lastActivity: agent.lastActivity,
    sessionId: agent.sessionId,
    currentTask: agent.currentTask,
    lastAssignedTask: agent.lastAssignedTask,
    lastAssignedTaskTime: agent.lastAssignedTaskTime,
    taskLabel: agent.taskLabel,
    trackingStatus: agent.trackingStatus,
    trackingStatusDetail: agent.trackingStatusDetail,
    trackingStatusTimestamp: agent.trackingStatusTimestamp,
    isBoss: agent.isBoss,
    subordinateIds: agent.subordinateIds,
    bossId: agent.bossId,
  }));
}

/**
 * Load agents from disk
 */
export function loadAgents(): StoredAgent[] {
  ensureDataDir();
  const data = safeReadJsonSync<TideData>(AGENTS_FILE, 'Agents');
  if (data?.agents) {
    log.log(` Loaded ${data.agents.length} agents from ${AGENTS_FILE}`);
    return data.agents;
  }
  return [];
}

/**
 * Save agents to disk
 */
export function saveAgents(agents: Agent[]): void {
  ensureDataDir();
  try {
    const data: TideData = {
      agents: toStoredAgents(agents),
      savedAt: Date.now(),
      version: '1.0.0',
    };
    atomicWriteJsonSync(AGENTS_FILE, data);
  } catch (err) {
    log.error(' Failed to save agents:', err);
  }
}

/**
 * Async save agents - non-blocking for hot paths (e.g. frequent updateAgent calls)
 */
export async function saveAgentsAsync(agents: Agent[]): Promise<void> {
  ensureDataDir();
  try {
    const data: TideData = {
      agents: toStoredAgents(agents),
      savedAt: Date.now(),
      version: '1.0.0',
    };
    await atomicWriteJson(AGENTS_FILE, data);
  } catch (err) {
    log.error(' Failed to save agents (async):', err);
  }
}

/**
 * Validate that an area has the required fields to avoid crashes from malformed data.
 */
function isValidArea(area: any): area is DrawingArea {
  return (
    area &&
    typeof area.id === 'string' &&
    typeof area.center === 'object' &&
    area.center !== null &&
    typeof area.center.x === 'number' &&
    typeof area.center.z === 'number' &&
    (area.type === 'rectangle' || area.type === 'circle')
  );
}

/**
 * Load drawing areas from disk
 */
export function loadAreas(): DrawingArea[] {
  ensureDataDir();
  const data = safeReadJsonSync<{ areas: DrawingArea[] }>(AREAS_FILE, 'Areas');
  const raw = data?.areas || [];
  const valid: DrawingArea[] = [];
  for (const area of raw) {
    if (isValidArea(area)) {
      valid.push(area);
    } else {
      const a = area as any;
      log.error(` Skipping malformed area "${a?.id ?? a?.name ?? 'unknown'}": missing required fields (center, type)`);
    }
  }
  return valid;
}

/**
 * Save drawing areas to disk
 */
export function saveAreas(areas: DrawingArea[]): void {
  ensureDataDir();
  try {
    atomicWriteJsonSync(AREAS_FILE, { areas, savedAt: Date.now() });
  } catch (err) {
    log.error(' Failed to save areas:', err);
  }
}

/**
 * Ensure area logos directory exists
 */
export function ensureAreaLogosDir(): void {
  if (!fs.existsSync(AREA_LOGOS_DIR)) {
    fs.mkdirSync(AREA_LOGOS_DIR, { recursive: true });
  }
}

/**
 * Get path to the area logos directory
 */
export function getAreaLogosDir(): string {
  return AREA_LOGOS_DIR;
}

/**
 * Delete an area logo file from disk
 */
export function deleteAreaLogo(filename: string): void {
  const filePath = path.join(AREA_LOGOS_DIR, path.basename(filename));
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    log.log(` Deleted area logo: ${filename}`);
  }
}

/**
 * Update a single agent's session ID
 */
export function updateAgentSession(agentId: string, sessionId: string): void {
  const agents = loadAgents();
  const agent = agents.find(a => a.id === agentId);

  if (agent) {
    agent.lastSessionId = agent.sessionId;
    agent.sessionId = sessionId;
    // Re-save with proper typing - ensure context fields have defaults
    saveAgents(agents.map(a => ({
      ...a,
      provider: a.provider ?? 'claude',
      status: 'offline' as const,
      contextUsed: a.contextUsed ?? 0,
      contextLimit: a.contextLimit ?? 200000,
      taskCount: a.taskCount ?? 0,
      permissionMode: a.permissionMode ?? 'bypass',
      codexModel: a.codexModel,
      codexConfig: a.codexConfig,
    })));
  }
}

/**
 * Get the data directory path (for UI display)
 */
export function getDataDir(): string {
  return DATA_DIR;
}

/**
 * Get Claude's project directory for a cwd
 */
export function getClaudeProjectDir(cwd: string): string {
  const encoded = cwd.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', encoded);
}

// ============================================================================
// Supervisor History Persistence
// ============================================================================

interface SupervisorHistoryData {
  histories: Record<string, AgentSupervisorHistoryEntry[]>;
  savedAt: number;
  version: string;
}

/**
 * Load all supervisor history from disk
 */
export function loadSupervisorHistory(): Map<string, AgentSupervisorHistoryEntry[]> {
  ensureDataDir();
  const data = safeReadJsonSync<SupervisorHistoryData>(SUPERVISOR_HISTORY_FILE, 'Supervisor history');
  if (data?.histories) {
    log.log(` Loaded supervisor history for ${Object.keys(data.histories).length} agents`);
    return new Map(Object.entries(data.histories));
  }
  return new Map();
}

/**
 * Save supervisor history to disk
 */
export function saveSupervisorHistory(histories: Map<string, AgentSupervisorHistoryEntry[]>): void {
  ensureDataDir();
  try {
    atomicWriteJsonSync(SUPERVISOR_HISTORY_FILE, {
      histories: Object.fromEntries(histories),
      savedAt: Date.now(),
      version: '1.0.0',
    });
  } catch (err) {
    log.error(' Failed to save supervisor history:', err);
  }
}

/**
 * Add a history entry for an agent
 */
export function addSupervisorHistoryEntry(
  histories: Map<string, AgentSupervisorHistoryEntry[]>,
  agentId: string,
  entry: AgentSupervisorHistoryEntry
): void {
  let agentHistory = histories.get(agentId);
  if (!agentHistory) {
    agentHistory = [];
    histories.set(agentId, agentHistory);
  }

  // Add to beginning (most recent first)
  agentHistory.unshift(entry);

  // Trim to max entries
  if (agentHistory.length > MAX_HISTORY_PER_AGENT) {
    agentHistory.pop();
  }
}

/**
 * Get supervisor history for a specific agent
 */
export function getAgentSupervisorHistory(
  histories: Map<string, AgentSupervisorHistoryEntry[]>,
  agentId: string
): AgentSupervisorHistory {
  return {
    agentId,
    entries: histories.get(agentId) || [],
  };
}

/**
 * Delete supervisor history for an agent (when agent is deleted)
 */
export function deleteSupervisorHistory(
  histories: Map<string, AgentSupervisorHistoryEntry[]>,
  agentId: string
): void {
  histories.delete(agentId);
}

// ============================================================================
// Building Persistence
// ============================================================================

// Buildings cache to avoid reading from disk on every call
let buildingsCache: Building[] | null = null;
let buildingsCacheMtime: number = 0;

/**
 * Load buildings from disk (cached, invalidated by file mtime)
 */
export function loadBuildings(): Building[] {
  ensureDataDir();

  // Check cache validity
  try {
    if (fs.existsSync(BUILDINGS_FILE)) {
      const mtime = fs.statSync(BUILDINGS_FILE).mtimeMs;
      if (buildingsCache !== null && mtime === buildingsCacheMtime) {
        return buildingsCache;
      }
    }
  } catch { /* proceed to read */ }

  const data = safeReadJsonSync<{ buildings: Building[] }>(BUILDINGS_FILE, 'Buildings');
  if (data?.buildings) {
    buildingsCache = data.buildings;
    try { buildingsCacheMtime = fs.statSync(BUILDINGS_FILE).mtimeMs; } catch { buildingsCacheMtime = 0; }
    log.log(` Loaded ${buildingsCache.length} buildings from ${BUILDINGS_FILE}`);
    return buildingsCache;
  }
  return [];
}

/**
 * Save buildings to disk
 */
export function saveBuildings(buildings: Building[]): void {
  ensureDataDir();
  try {
    atomicWriteJsonSync(BUILDINGS_FILE, { buildings, savedAt: Date.now(), version: '1.0.0' });
    buildingsCache = buildings;
    buildingsCacheMtime = fs.statSync(BUILDINGS_FILE).mtimeMs;
  } catch (err) {
    log.error(' Failed to save buildings:', err);
  }
}

// ============================================================================
// Delegation History Persistence (Boss Agent)
// ============================================================================

interface DelegationHistoryData {
  histories: Record<string, DelegationDecision[]>;  // bossId -> decisions
  savedAt: number;
  version: string;
}

/**
 * Load all delegation history from disk
 */
export function loadDelegationHistory(): Map<string, DelegationDecision[]> {
  ensureDataDir();
  const data = safeReadJsonSync<DelegationHistoryData>(DELEGATION_HISTORY_FILE, 'Delegation history');
  if (data?.histories) {
    log.log(` Loaded delegation history for ${Object.keys(data.histories).length} bosses`);
    return new Map(Object.entries(data.histories));
  }
  return new Map();
}

/**
 * Save delegation history to disk
 */
export function saveDelegationHistory(histories: Map<string, DelegationDecision[]>): void {
  ensureDataDir();
  try {
    atomicWriteJsonSync(DELEGATION_HISTORY_FILE, {
      histories: Object.fromEntries(histories),
      savedAt: Date.now(),
      version: '1.0.0',
    });
  } catch (err) {
    log.error(' Failed to save delegation history:', err);
  }
}

/**
 * Add a delegation decision for a boss
 */
export function addDelegationDecision(
  histories: Map<string, DelegationDecision[]>,
  bossId: string,
  decision: DelegationDecision
): void {
  let bossHistory = histories.get(bossId);
  if (!bossHistory) {
    bossHistory = [];
    histories.set(bossId, bossHistory);
  }

  // Add to beginning (most recent first)
  bossHistory.unshift(decision);

  // Trim to max entries
  if (bossHistory.length > MAX_DELEGATION_HISTORY_PER_BOSS) {
    bossHistory.pop();
  }
}

/**
 * Get delegation history for a specific boss
 */
export function getDelegationHistory(
  histories: Map<string, DelegationDecision[]>,
  bossId: string
): DelegationDecision[] {
  return histories.get(bossId) || [];
}

/**
 * Delete delegation history for a boss (when boss is deleted)
 */
export function deleteDelegationHistory(
  histories: Map<string, DelegationDecision[]>,
  bossId: string
): void {
  histories.delete(bossId);
}

// ============================================================================
// Skills Persistence
// ============================================================================

interface SkillsData {
  skills: StoredSkill[];
  savedAt: number;
  version: string;
}

/**
 * Load skills from disk
 */
export function loadSkills(): Skill[] {
  ensureDataDir();
  const data = safeReadJsonSync<SkillsData>(SKILLS_FILE, 'Skills');
  if (data?.skills) {
    log.log(` Loaded ${data.skills.length} skills from ${SKILLS_FILE}`);
    return data.skills;
  }
  return [];
}

/**
 * Save skills to disk
 */
export function saveSkills(skills: Skill[]): void {
  ensureDataDir();
  try {
    atomicWriteJsonSync(SKILLS_FILE, {
      skills: skills as StoredSkill[],
      savedAt: Date.now(),
      version: '1.0.0',
    });
    log.log(` Saved ${skills.length} skills to ${SKILLS_FILE}`);
  } catch (err) {
    log.error(' Failed to save skills:', err);
  }
}

// ============================================================================
// Custom Agent Classes Persistence
// ============================================================================

interface CustomAgentClassesData {
  classes: CustomAgentClass[];
  savedAt: number;
  version: string;
}

/**
 * Load custom agent classes from disk
 */
export function loadCustomAgentClasses(): CustomAgentClass[] {
  ensureDataDir();
  const data = safeReadJsonSync<CustomAgentClassesData>(CUSTOM_CLASSES_FILE, 'Custom agent classes');
  if (data?.classes) {
    log.log(` Loaded ${data.classes.length} custom agent classes from ${CUSTOM_CLASSES_FILE}`);
    return data.classes;
  }
  return [];
}

/**
 * Save custom agent classes to disk
 */
export function saveCustomAgentClasses(classes: CustomAgentClass[]): void {
  ensureDataDir();
  try {
    atomicWriteJsonSync(CUSTOM_CLASSES_FILE, { classes, savedAt: Date.now(), version: '1.0.0' });
    log.log(` Saved ${classes.length} custom agent classes to ${CUSTOM_CLASSES_FILE}`);
  } catch (err) {
    log.error(' Failed to save custom agent classes:', err);
  }
}

// ============================================================================
// Running Processes Persistence (for crash recovery)
// ============================================================================

export interface RunningProcessInfo {
  agentId: string;
  pid: number;
  sessionId?: string;
  startTime: number;
  outputFile?: string;  // File where Claude writes stdout (for reconnection)
  stderrFile?: string;  // File where Claude writes stderr
  lastRequest?: unknown; // Last request for auto-restart (serialized)
  agentStatus?: string; // Agent status at persist time - only 'working' agents should be resumed
  tmuxSession?: string; // tmux session name (when using TIDE_USE_TMUX)
  tmuxLogOffset?: number; // byte offset into the tmux log file for resuming
  provider?: string; // Runtime provider ('claude', 'codex', 'opencode')
}

interface RunningProcessesData {
  processes: RunningProcessInfo[];
  savedAt: number;
  commanderPid: number;  // PID of the commander that saved this
}

/**
 * Load running processes info from disk
 * Used on startup to detect orphaned processes from previous commander instance
 */
export function loadRunningProcesses(): RunningProcessInfo[] {
  ensureDataDir();
  const data = safeReadJsonSync<RunningProcessesData>(RUNNING_PROCESSES_FILE, 'Running processes');
  if (data?.processes) {
    log.log(` Loaded ${data.processes.length} running process records (from commander PID ${data.commanderPid})`);
    return data.processes;
  }
  return [];
}

/**
 * Save running processes info to disk
 * Called periodically and on shutdown to enable crash recovery
 */
export function saveRunningProcesses(processes: RunningProcessInfo[]): void {
  ensureDataDir();
  try {
    atomicWriteJsonSync(RUNNING_PROCESSES_FILE, {
      processes,
      savedAt: Date.now(),
      commanderPid: process.pid,
    });
  } catch (err) {
    log.error(' Failed to save running processes:', err);
  }
}

/**
 * Clear running processes file (called when all processes are stopped)
 */
export function clearRunningProcesses(): void {
  ensureDataDir();

  try {
    if (fs.existsSync(RUNNING_PROCESSES_FILE)) {
      fs.unlinkSync(RUNNING_PROCESSES_FILE);
      log.log(' Cleared running processes file');
    }
    // Also remove the .bak file to prevent safeReadJsonSync from resurrecting stale data
    const bakFile = RUNNING_PROCESSES_FILE + '.bak';
    if (fs.existsSync(bakFile)) {
      fs.unlinkSync(bakFile);
      log.log(' Cleared running processes backup file');
    }
  } catch (err) {
    log.error(' Failed to clear running processes file:', err);
  }
}

/**
 * Check if a process is still running by PID
 */
export function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 doesn't kill the process, just checks if it exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}


// ============================================================================
// Secrets Persistence (with encryption)
// ============================================================================

// Encryption constants
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16;  // 128 bits for GCM
const AUTH_TAG_LENGTH = 16;
const SALT = 'tide-commander-secrets-v1'; // Static salt for key derivation

// Cached encryption key (derived once per session)
let encryptionKey: Buffer | null = null;

/**
 * Get machine-specific identifier for key derivation
 * Uses machine-id on Linux, or falls back to hostname + username
 */
function getMachineId(): string {
  // Try to read machine-id (Linux)
  try {
    const machineIdPath = '/etc/machine-id';
    if (fs.existsSync(machineIdPath)) {
      return fs.readFileSync(machineIdPath, 'utf8').trim();
    }
  } catch {
    // Ignore and try fallback
  }

  // Try macOS hardware UUID
  try {
    if (process.platform === 'darwin') {
      const hwUuid = execSync('ioreg -rd1 -c IOPlatformExpertDevice | awk \'/IOPlatformUUID/ { split($0, a, "\\""); print a[4] }\'', {
        encoding: 'utf8',
        timeout: 2000,
      }).trim();
      if (hwUuid) return hwUuid;
    }
  } catch {
    // Ignore and try fallback
  }

  // Fallback: combine hostname + username + home directory
  // This is less ideal but provides some uniqueness per user/machine
  return `${os.hostname()}-${os.userInfo().username}-${os.homedir()}`;
}

/**
 * Derive encryption key from machine-specific identifier
 * Uses PBKDF2 for secure key derivation
 */
function getEncryptionKey(): Buffer {
  if (encryptionKey) {
    return encryptionKey;
  }

  const machineId = getMachineId();
  encryptionKey = crypto.pbkdf2Sync(
    machineId,
    SALT,
    100000, // iterations
    KEY_LENGTH,
    'sha256'
  );

  return encryptionKey;
}

/**
 * Encrypt a string value
 * Returns format: iv:authTag:encryptedData (all base64)
 */
function encryptValue(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  const authTag = cipher.getAuthTag();

  // Combine iv:authTag:encrypted
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

/**
 * Decrypt an encrypted value
 * Expects format: iv:authTag:encryptedData (all base64)
 */
function decryptValue(encrypted: string): string {
  const key = getEncryptionKey();
  const parts = encrypted.split(':');

  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encryptedData = parts[2];

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Check if a value appears to be encrypted (has our format)
 */
function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;

  // Check if parts look like base64
  try {
    Buffer.from(parts[0], 'base64');
    Buffer.from(parts[1], 'base64');
    return true;
  } catch {
    return false;
  }
}

// Stored secret on disk has encrypted value
interface EncryptedStoredSecret extends Omit<StoredSecret, 'value'> {
  value: string; // encrypted value
  encrypted?: boolean; // marker for encrypted values
}

interface SecretsData {
  secrets: EncryptedStoredSecret[];
  savedAt: number;
  version: string;
}

/**
 * Load secrets from disk and decrypt values
 */
export function loadSecrets(): Secret[] {
  ensureDataDir();
  const data = safeReadJsonSync<SecretsData>(SECRETS_FILE, 'Secrets');
  if (data?.secrets) {
    log.log(` Loaded ${data.secrets.length} secrets from ${SECRETS_FILE}`);
    return data.secrets.map(secret => {
      try {
        if (secret.encrypted !== false && isEncrypted(secret.value)) {
          return { ...secret, value: decryptValue(secret.value) };
        }
        return secret as Secret;
      } catch (err) {
        log.error(` Failed to decrypt secret "${secret.name}":`, err);
        return { ...secret, value: '' };
      }
    });
  }
  return [];
}

/**
 * Save secrets to disk with encrypted values
 */
export function saveSecrets(secrets: Secret[]): void {
  ensureDataDir();
  try {
    const encryptedSecrets: EncryptedStoredSecret[] = secrets.map(secret => ({
      ...secret,
      value: encryptValue(secret.value),
      encrypted: true,
    }));
    atomicWriteJsonSync(SECRETS_FILE, {
      secrets: encryptedSecrets,
      savedAt: Date.now(),
      version: '1.0.0',
    });
    log.log(` Saved ${secrets.length} secrets to ${SECRETS_FILE} (encrypted)`);
  } catch (err) {
    log.error(' Failed to save secrets:', err);
  }
}

// ============================================================================
// Query History Persistence (Database Building)
// ============================================================================

const QUERY_HISTORY_DIR = path.join(DATA_DIR, 'query-history');

interface QueryHistoryData {
  history: QueryHistoryEntry[];
  savedAt: number;
  version: string;
}

/**
 * Ensure query history directory exists
 */
function ensureQueryHistoryDir(): void {
  if (!fs.existsSync(QUERY_HISTORY_DIR)) {
    fs.mkdirSync(QUERY_HISTORY_DIR, { recursive: true });
    log.log(` Created query history directory: ${QUERY_HISTORY_DIR}`);
  }
}

/**
 * Get query history file path for a building
 */
function getQueryHistoryFile(buildingId: string): string {
  return path.join(QUERY_HISTORY_DIR, `${buildingId}.json`);
}

/**
 * Load query history for a building
 */
export function loadQueryHistory(buildingId: string): QueryHistoryEntry[] {
  ensureQueryHistoryDir();
  const data = safeReadJsonSync<QueryHistoryData>(getQueryHistoryFile(buildingId), `Query history (${buildingId})`);
  return data?.history || [];
}

/**
 * Save query history for a building
 */
export function saveQueryHistory(buildingId: string, history: QueryHistoryEntry[]): void {
  ensureQueryHistoryDir();
  try {
    atomicWriteJsonSync(getQueryHistoryFile(buildingId), { history, savedAt: Date.now(), version: '1.0.0' });
  } catch (err) {
    log.error(` Failed to save query history for building ${buildingId}:`, err);
  }
}

/**
 * Delete query history for a building (when building is deleted)
 */
export function deleteQueryHistory(buildingId: string): void {
  try {
    const filePath = getQueryHistoryFile(buildingId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      log.log(` Deleted query history for building ${buildingId}`);
    }
  } catch (err) {
    log.error(` Failed to delete query history for building ${buildingId}:`, err);
  }
}

// ============================================================================
// Session History
// ============================================================================

interface SessionHistoryData {
  histories: Record<string, SessionHistoryEntry[]>;
  savedAt: number;
  version: string;
}

export function loadSessionHistory(): Map<string, SessionHistoryEntry[]> {
  ensureDataDir();
  const data = safeReadJsonSync<SessionHistoryData>(SESSION_HISTORY_FILE, 'Session history');
  if (data?.histories) {
    log.log(` Loaded session history for ${Object.keys(data.histories).length} agents`);
    return new Map(Object.entries(data.histories));
  }
  return new Map();
}

export function saveSessionHistory(histories: Map<string, SessionHistoryEntry[]>): void {
  ensureDataDir();
  try {
    atomicWriteJsonSync(SESSION_HISTORY_FILE, {
      histories: Object.fromEntries(histories),
      savedAt: Date.now(),
      version: '1.0.0',
    });
  } catch (err) {
    log.error(' Failed to save session history:', err);
  }
}

export function addSessionHistoryEntry(
  histories: Map<string, SessionHistoryEntry[]>,
  agentId: string,
  entry: SessionHistoryEntry
): void {
  let agentHistory = histories.get(agentId);
  if (!agentHistory) {
    agentHistory = [];
    histories.set(agentId, agentHistory);
  }

  // Add to beginning (most recent first)
  agentHistory.unshift(entry);

  // Trim to max entries
  if (agentHistory.length > MAX_SESSION_HISTORY_PER_AGENT) {
    agentHistory.pop();
  }
}

export function getSessionHistoryForAgent(
  histories: Map<string, SessionHistoryEntry[]>,
  agentId: string
): SessionHistoryEntry[] {
  return histories.get(agentId) || [];
}
