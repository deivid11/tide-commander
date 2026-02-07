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
import type { Agent, DrawingArea, AgentSupervisorHistory, AgentSupervisorHistoryEntry, Building, DelegationDecision, Skill, StoredSkill, CustomAgentClass, ContextStats, Secret, StoredSecret, QueryHistoryEntry } from '../../shared/types.js';
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

// Maximum history entries per agent
const MAX_HISTORY_PER_AGENT = 50;
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
  createdAt: number;
  lastActivity: number;
  sessionId?: string;
  lastSessionId?: string;
  currentTask?: string;
  // Task tracking for auto-resume
  lastAssignedTask?: string;      // Last task assigned (persisted for auto-resume)
  lastAssignedTaskTime?: number;  // When last task was assigned
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

/**
 * Load agents from disk
 */
export function loadAgents(): StoredAgent[] {
  ensureDataDir();

  try {
    if (fs.existsSync(AGENTS_FILE)) {
      const data: TideData = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf-8'));
      log.log(` Loaded ${data.agents.length} agents from ${AGENTS_FILE}`);
      return data.agents;
    }
  } catch (err) {
    log.error(' Failed to load agents:', err);
  }

  return [];
}

/**
 * Save agents to disk
 */
export function saveAgents(agents: Agent[]): void {
  ensureDataDir();

  try {
    // Convert to stored format (remove runtime-only fields)
    const storedAgents: StoredAgent[] = agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      class: agent.class,
      provider: agent.provider,
      position: agent.position,
      cwd: agent.cwd,
      tokensUsed: agent.tokensUsed,
      contextUsed: agent.contextUsed,
      contextLimit: agent.contextLimit,
      contextStats: agent.contextStats, // Persist detailed context stats
      taskCount: agent.taskCount,
      permissionMode: agent.permissionMode, // Persist permission mode
      useChrome: agent.useChrome, // Persist Chrome flag
      model: agent.model, // Persist model selection
      codexModel: agent.codexModel,
      codexConfig: agent.codexConfig,
      createdAt: agent.createdAt,
      lastActivity: agent.lastActivity,
      sessionId: agent.sessionId,
      currentTask: agent.currentTask,
      // Task tracking for auto-resume
      lastAssignedTask: agent.lastAssignedTask,
      lastAssignedTaskTime: agent.lastAssignedTaskTime,
      // Boss-specific fields
      isBoss: agent.isBoss,
      subordinateIds: agent.subordinateIds,
      bossId: agent.bossId,
    }));

    const data: TideData = {
      agents: storedAgents,
      savedAt: Date.now(),
      version: '1.0.0',
    };

    fs.writeFileSync(AGENTS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    log.error(' Failed to save agents:', err);
  }
}

/**
 * Load drawing areas from disk
 */
export function loadAreas(): DrawingArea[] {
  ensureDataDir();

  try {
    if (fs.existsSync(AREAS_FILE)) {
      const data = JSON.parse(fs.readFileSync(AREAS_FILE, 'utf-8'));
      return data.areas || [];
    }
  } catch (err) {
    log.error(' Failed to load areas:', err);
  }

  return [];
}

/**
 * Save drawing areas to disk
 */
export function saveAreas(areas: DrawingArea[]): void {
  ensureDataDir();

  try {
    const data = {
      areas,
      savedAt: Date.now(),
    };
    fs.writeFileSync(AREAS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    log.error(' Failed to save areas:', err);
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

  try {
    if (fs.existsSync(SUPERVISOR_HISTORY_FILE)) {
      const data: SupervisorHistoryData = JSON.parse(fs.readFileSync(SUPERVISOR_HISTORY_FILE, 'utf-8'));
      log.log(` Loaded supervisor history for ${Object.keys(data.histories).length} agents`);
      return new Map(Object.entries(data.histories));
    }
  } catch (err) {
    log.error(' Failed to load supervisor history:', err);
  }

  return new Map();
}

/**
 * Save supervisor history to disk
 */
export function saveSupervisorHistory(histories: Map<string, AgentSupervisorHistoryEntry[]>): void {
  ensureDataDir();

  try {
    const data: SupervisorHistoryData = {
      histories: Object.fromEntries(histories),
      savedAt: Date.now(),
      version: '1.0.0',
    };

    fs.writeFileSync(SUPERVISOR_HISTORY_FILE, JSON.stringify(data, null, 2));
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

/**
 * Load buildings from disk
 */
export function loadBuildings(): Building[] {
  ensureDataDir();

  try {
    if (fs.existsSync(BUILDINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(BUILDINGS_FILE, 'utf-8'));
      log.log(` Loaded ${data.buildings?.length || 0} buildings from ${BUILDINGS_FILE}`);
      return data.buildings || [];
    }
  } catch (err) {
    log.error(' Failed to load buildings:', err);
  }

  return [];
}

/**
 * Save buildings to disk
 */
export function saveBuildings(buildings: Building[]): void {
  ensureDataDir();

  try {
    const data = {
      buildings,
      savedAt: Date.now(),
      version: '1.0.0',
    };
    fs.writeFileSync(BUILDINGS_FILE, JSON.stringify(data, null, 2));
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

  try {
    if (fs.existsSync(DELEGATION_HISTORY_FILE)) {
      const data: DelegationHistoryData = JSON.parse(fs.readFileSync(DELEGATION_HISTORY_FILE, 'utf-8'));
      log.log(` Loaded delegation history for ${Object.keys(data.histories).length} bosses`);
      return new Map(Object.entries(data.histories));
    }
  } catch (err) {
    log.error(' Failed to load delegation history:', err);
  }

  return new Map();
}

/**
 * Save delegation history to disk
 */
export function saveDelegationHistory(histories: Map<string, DelegationDecision[]>): void {
  ensureDataDir();

  try {
    const data: DelegationHistoryData = {
      histories: Object.fromEntries(histories),
      savedAt: Date.now(),
      version: '1.0.0',
    };

    fs.writeFileSync(DELEGATION_HISTORY_FILE, JSON.stringify(data, null, 2));
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

  try {
    if (fs.existsSync(SKILLS_FILE)) {
      const data: SkillsData = JSON.parse(fs.readFileSync(SKILLS_FILE, 'utf-8'));
      log.log(` Loaded ${data.skills.length} skills from ${SKILLS_FILE}`);
      return data.skills;
    }
  } catch (err) {
    log.error(' Failed to load skills:', err);
  }

  return [];
}

/**
 * Save skills to disk
 */
export function saveSkills(skills: Skill[]): void {
  ensureDataDir();

  try {
    const data: SkillsData = {
      skills: skills as StoredSkill[],
      savedAt: Date.now(),
      version: '1.0.0',
    };

    fs.writeFileSync(SKILLS_FILE, JSON.stringify(data, null, 2));
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

  try {
    if (fs.existsSync(CUSTOM_CLASSES_FILE)) {
      const data: CustomAgentClassesData = JSON.parse(fs.readFileSync(CUSTOM_CLASSES_FILE, 'utf-8'));
      log.log(` Loaded ${data.classes.length} custom agent classes from ${CUSTOM_CLASSES_FILE}`);
      return data.classes;
    }
  } catch (err) {
    log.error(' Failed to load custom agent classes:', err);
  }

  return [];
}

/**
 * Save custom agent classes to disk
 */
export function saveCustomAgentClasses(classes: CustomAgentClass[]): void {
  ensureDataDir();

  try {
    const data: CustomAgentClassesData = {
      classes,
      savedAt: Date.now(),
      version: '1.0.0',
    };

    fs.writeFileSync(CUSTOM_CLASSES_FILE, JSON.stringify(data, null, 2));
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

  try {
    if (fs.existsSync(RUNNING_PROCESSES_FILE)) {
      const data: RunningProcessesData = JSON.parse(fs.readFileSync(RUNNING_PROCESSES_FILE, 'utf-8'));
      log.log(` Loaded ${data.processes.length} running process records (from commander PID ${data.commanderPid})`);
      return data.processes;
    }
  } catch (err) {
    log.error(' Failed to load running processes:', err);
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
    const data: RunningProcessesData = {
      processes,
      savedAt: Date.now(),
      commanderPid: process.pid,
    };

    fs.writeFileSync(RUNNING_PROCESSES_FILE, JSON.stringify(data, null, 2));
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

/**
 * Ultra-resilient process discovery interface
 */
export interface DiscoveredProcess {
  pid: number;
  cwd?: string;
  sessionId?: string;
  cmdline?: string;
}

/**
 * Discover all running Claude processes on the system
 * This is the ultimate fallback - finds processes even if we lost all tracking
 * Returns a list of discovered processes with their working directories
 *
 * Works on both Linux and macOS
 */
export function discoverClaudeProcesses(): DiscoveredProcess[] {
  const discovered: DiscoveredProcess[] = [];
  const platform = process.platform;

  try {
    // Find all processes with 'claude' in their command line
    let pids: string[] = [];

    if (platform === 'linux') {
      // Linux: Use pgrep
      try {
        const pgrepOutput = execSync('pgrep -f "claude.*--print"', {
          encoding: 'utf8',
          timeout: 5000,
        }).trim();
        pids = pgrepOutput.split('\n').filter((p: string) => p.trim());
      } catch {
        // pgrep returns exit code 1 if no processes found - that's ok
      }

      // Also try finding by exact command name
      try {
        const pgrepOutput2 = execSync('pgrep -x claude', {
          encoding: 'utf8',
          timeout: 5000,
        }).trim();
        const morePids = pgrepOutput2.split('\n').filter((p: string) => p.trim());
        for (const pid of morePids) {
          if (!pids.includes(pid)) {
            pids.push(pid);
          }
        }
      } catch {
        // No additional processes found
      }
    } else if (platform === 'darwin') {
      // macOS: Use ps with grep
      try {
        // ps aux shows all processes, grep for claude, awk to get PID (column 2)
        const psOutput = execSync('ps aux | grep -i "[c]laude.*--print" | awk \'{print $2}\'', {
          encoding: 'utf8' as const,
          timeout: 5000,
          shell: '/bin/sh',
        }).trim();
        pids = psOutput.split('\n').filter((p: string) => p.trim());
      } catch {
        // No processes found
      }

      // Also try finding claude processes without --print
      try {
        const psOutput2 = execSync('ps aux | grep -i "[c]laude" | grep -v grep | awk \'{print $2}\'', {
          encoding: 'utf8' as const,
          timeout: 5000,
          shell: '/bin/sh',
        }).trim();
        const morePids = psOutput2.split('\n').filter((p: string) => p.trim());
        for (const pid of morePids) {
          if (!pids.includes(pid)) {
            pids.push(pid);
          }
        }
      } catch {
        // No additional processes found
      }
    }

    log.log(` Process discovery found ${pids.length} potential Claude process(es) on ${platform}`);

    for (const pidStr of pids) {
      const pid = parseInt(pidStr, 10);
      if (isNaN(pid)) continue;

      // Skip our own process
      if (pid === process.pid) continue;

      const processInfo: DiscoveredProcess = { pid };

      if (platform === 'linux') {
        // Linux: Use /proc filesystem
        // Try to get working directory from /proc/{pid}/cwd
        try {
          const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
          processInfo.cwd = cwd;
        } catch {
          // Can't read cwd - process might be gone or permission denied
        }

        // Try to get command line from /proc/{pid}/cmdline
        try {
          const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8')
            .replace(/\0/g, ' ')
            .trim();
          processInfo.cmdline = cmdline;

          // Try to extract session ID from command line (--resume <session-id>)
          const resumeMatch = cmdline.match(/--resume\s+([a-f0-9-]+)/i);
          if (resumeMatch) {
            processInfo.sessionId = resumeMatch[1];
          }
        } catch {
          // Can't read cmdline
        }
      } else if (platform === 'darwin') {
        // macOS: Use lsof and ps for process info
        // Get working directory using lsof
        try {
          const lsofOutput = execSync(`lsof -p ${pid} -Fn 2>/dev/null | grep "^n/" | head -1`, {
            encoding: 'utf8' as const,
            timeout: 2000,
            shell: '/bin/sh',
          }).trim();
          if (lsofOutput.startsWith('n')) {
            processInfo.cwd = lsofOutput.slice(1); // Remove 'n' prefix
          }
        } catch {
          // Can't get cwd
        }

        // Get command line using ps
        try {
          const psOutput = execSync(`ps -p ${pid} -o args=`, {
            encoding: 'utf8',
            timeout: 2000,
          }).trim();
          processInfo.cmdline = psOutput;

          // Try to extract session ID from command line
          const resumeMatch = psOutput.match(/--resume\s+([a-f0-9-]+)/i);
          if (resumeMatch) {
            processInfo.sessionId = resumeMatch[1];
          }
        } catch {
          // Can't get cmdline
        }
      }

      discovered.push(processInfo);
    }
  } catch (err) {
    log.error(' Process discovery failed:', err);
  }

  return discovered;
}

/**
 * Find orphaned Claude processes that match known agents
 * Returns a map of agentId -> DiscoveredProcess for processes we can match
 */
export function matchOrphanedProcessesToAgents(
  agents: Array<{ id: string; cwd: string; sessionId?: string }>,
  discoveredProcesses: DiscoveredProcess[]
): Map<string, DiscoveredProcess> {
  const matches = new Map<string, DiscoveredProcess>();

  for (const process of discoveredProcesses) {
    // Try to match by session ID first (most reliable)
    if (process.sessionId) {
      const matchedAgent = agents.find(a => a.sessionId === process.sessionId);
      if (matchedAgent) {
        log.log(` Matched process PID ${process.pid} to agent ${matchedAgent.id} by sessionId`);
        matches.set(matchedAgent.id, process);
        continue;
      }
    }

    // Try to match by working directory
    if (process.cwd) {
      const matchedAgent = agents.find(a => a.cwd === process.cwd);
      if (matchedAgent && !matches.has(matchedAgent.id)) {
        log.log(` Matched process PID ${process.pid} to agent ${matchedAgent.id} by cwd`);
        matches.set(matchedAgent.id, process);
        continue;
      }
    }
  }

  return matches;
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

  try {
    if (fs.existsSync(SECRETS_FILE)) {
      const data: SecretsData = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf-8'));
      log.log(` Loaded ${data.secrets.length} secrets from ${SECRETS_FILE}`);

      // Decrypt values
      const decryptedSecrets: Secret[] = data.secrets.map(secret => {
        try {
          // Check if value is encrypted (for migration from unencrypted)
          if (secret.encrypted !== false && isEncrypted(secret.value)) {
            return {
              ...secret,
              value: decryptValue(secret.value),
            };
          }
          // Unencrypted value (legacy or migration)
          return secret as Secret;
        } catch (err) {
          log.error(` Failed to decrypt secret "${secret.name}":`, err);
          // Return with empty value if decryption fails
          return {
            ...secret,
            value: '',
          };
        }
      });

      return decryptedSecrets;
    }
  } catch (err) {
    log.error(' Failed to load secrets:', err);
  }

  return [];
}

/**
 * Save secrets to disk with encrypted values
 */
export function saveSecrets(secrets: Secret[]): void {
  ensureDataDir();

  try {
    // Encrypt values before saving
    const encryptedSecrets: EncryptedStoredSecret[] = secrets.map(secret => ({
      ...secret,
      value: encryptValue(secret.value),
      encrypted: true,
    }));

    const data: SecretsData = {
      secrets: encryptedSecrets,
      savedAt: Date.now(),
      version: '1.0.0',
    };

    fs.writeFileSync(SECRETS_FILE, JSON.stringify(data, null, 2));
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

  try {
    const filePath = getQueryHistoryFile(buildingId);
    if (fs.existsSync(filePath)) {
      const data: QueryHistoryData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      return data.history || [];
    }
  } catch (err) {
    log.error(` Failed to load query history for building ${buildingId}:`, err);
  }

  return [];
}

/**
 * Save query history for a building
 */
export function saveQueryHistory(buildingId: string, history: QueryHistoryEntry[]): void {
  ensureQueryHistoryDir();

  try {
    const data: QueryHistoryData = {
      history,
      savedAt: Date.now(),
      version: '1.0.0',
    };

    const filePath = getQueryHistoryFile(buildingId);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
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
