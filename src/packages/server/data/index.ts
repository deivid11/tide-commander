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
import { execSync } from 'child_process';
import type { Agent, DrawingArea, AgentSupervisorHistory, AgentSupervisorHistoryEntry, Building, DelegationDecision, Skill, StoredSkill, CustomAgentClass, ContextStats } from '../../shared/types.js';
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

// Maximum history entries per agent
const MAX_HISTORY_PER_AGENT = 50;
const MAX_DELEGATION_HISTORY_PER_BOSS = 100;

// Agent with session history reference (stored on disk)
// Some fields may be missing in older saved data
export interface StoredAgent {
  id: string;
  name: string;
  class: Agent['class'];
  position: Agent['position'];
  cwd: string;
  tokensUsed: number;
  contextUsed?: number;  // May be missing in older data
  contextLimit?: number; // May be missing in older data
  contextStats?: ContextStats; // Detailed context stats from /context command
  taskCount?: number;    // May be missing in older data
  permissionMode?: Agent['permissionMode']; // May be missing in older data
  createdAt: number;
  lastActivity: number;
  sessionId?: string;
  lastSessionId?: string;
  currentTask?: string;
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
      position: agent.position,
      cwd: agent.cwd,
      tokensUsed: agent.tokensUsed,
      contextUsed: agent.contextUsed,
      contextLimit: agent.contextLimit,
      contextStats: agent.contextStats, // Persist detailed context stats
      taskCount: agent.taskCount,
      permissionMode: agent.permissionMode, // Persist permission mode
      createdAt: agent.createdAt,
      lastActivity: agent.lastActivity,
      sessionId: agent.sessionId,
      currentTask: agent.currentTask,
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
      status: 'offline' as const,
      contextUsed: a.contextUsed ?? 0,
      contextLimit: a.contextLimit ?? 200000,
      taskCount: a.taskCount ?? 0,
      permissionMode: a.permissionMode ?? 'bypass',
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

// Directory for Claude process output files
const PROCESS_OUTPUT_DIR = path.join(DATA_DIR, 'process-output');

/**
 * Ensure process output directory exists
 */
export function ensureProcessOutputDir(): void {
  if (!fs.existsSync(PROCESS_OUTPUT_DIR)) {
    fs.mkdirSync(PROCESS_OUTPUT_DIR, { recursive: true });
  }
}

/**
 * Get the output file path for an agent's Claude process
 */
export function getProcessOutputPath(agentId: string): string {
  ensureProcessOutputDir();
  return path.join(PROCESS_OUTPUT_DIR, `${agentId}.out`);
}

/**
 * Get the stderr file path for an agent's Claude process
 */
export function getProcessStderrPath(agentId: string): string {
  ensureProcessOutputDir();
  return path.join(PROCESS_OUTPUT_DIR, `${agentId}.err`);
}

/**
 * Get the stdin FIFO path for an agent's Claude process (legacy, kept for compatibility)
 */
export function getProcessStdinFifoPath(agentId: string): string {
  ensureProcessOutputDir();
  return path.join(PROCESS_OUTPUT_DIR, `${agentId}.stdin`);
}

/**
 * Get the stdin file path for an agent's Claude process
 * This is a regular file read by `tail -f` to feed stdin to Claude
 */
export function getProcessStdinPath(agentId: string): string {
  ensureProcessOutputDir();
  return path.join(PROCESS_OUTPUT_DIR, `${agentId}.in`);
}

/**
 * Create a FIFO (named pipe) for stdin communication (legacy, kept for compatibility)
 * Returns true if FIFO was created, false if it already exists
 */
export function createStdinFifo(agentId: string): boolean {
  const fifoPath = getProcessStdinFifoPath(agentId);

  // Remove existing FIFO if present
  try {
    if (fs.existsSync(fifoPath)) {
      fs.unlinkSync(fifoPath);
    }
  } catch {
    // Ignore
  }

  try {
    // Create FIFO using mkfifo command
    execSync(`mkfifo "${fifoPath}"`, { encoding: 'utf8' as const });
    return true;
  } catch (err) {
    log.error(`Failed to create stdin FIFO for ${agentId}:`, err);
    return false;
  }
}

/**
 * Clean up output files for an agent (including stdin file)
 */
export function cleanupProcessOutputFiles(agentId: string): void {
  try {
    const outPath = getProcessOutputPath(agentId);
    const errPath = getProcessStderrPath(agentId);
    const fifoPath = getProcessStdinFifoPath(agentId);
    const stdinPath = getProcessStdinPath(agentId);
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    if (fs.existsSync(errPath)) fs.unlinkSync(errPath);
    if (fs.existsSync(fifoPath)) fs.unlinkSync(fifoPath);
    if (fs.existsSync(stdinPath)) fs.unlinkSync(stdinPath);
  } catch (err) {
    log.error(`Failed to cleanup output files for ${agentId}:`, err);
  }
}

/**
 * Clean up all stale output files (for processes that are no longer running)
 */
export function cleanupStaleOutputFiles(): void {
  ensureProcessOutputDir();
  try {
    const files = fs.readdirSync(PROCESS_OUTPUT_DIR);
    const runningProcesses = loadRunningProcesses();
    const runningAgentIds = new Set(runningProcesses.map(p => p.agentId));

    for (const file of files) {
      const match = file.match(/^(.+)\.(out|err)$/);
      if (match) {
        const agentId = match[1];
        if (!runningAgentIds.has(agentId)) {
          const filePath = path.join(PROCESS_OUTPUT_DIR, file);
          fs.unlinkSync(filePath);
          log.log(`Cleaned up stale output file: ${file}`);
        }
      }
    }
  } catch (err) {
    log.error('Failed to cleanup stale output files:', err);
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
