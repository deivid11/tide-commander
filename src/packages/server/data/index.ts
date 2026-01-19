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
  tmuxSession: string;
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
      tmuxSession: agent.tmuxSession,
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
