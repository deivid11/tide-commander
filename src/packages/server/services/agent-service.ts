/**
 * Agent Service
 * Business logic for managing agents
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Agent, AgentClass, PermissionMode, ClaudeModel, ClaudeEffort, AgentProvider, CodexConfig, CodexModel, OpencodeModel, DrawingArea, SessionHistoryEntry } from '../../shared/types.js';
import { loadAgents, saveAgents, saveAgentsAsync, getDataDir, loadAreas, saveAreas, loadSessionHistory, saveSessionHistory, addSessionHistoryEntry, getSessionHistoryForAgent } from '../data/index.js';
import {
  listSessions,
  getSessionSummary,
  getProjectDir,
  loadSession,
  loadToolHistory,
  searchSession,
} from '../claude/session-loader.js';
import { loadSubagentHistory, type SubagentHistoryEntry } from '../claude/subagent-history-loader.js';
import { logger, generateId } from '../utils/index.js';

const log = logger.agent;
const CLAUDE_MODELS = new Set<ClaudeModel>([
  'sonnet',
  'opus',
  'haiku',
  'claude-opus-4-7',
  'claude-opus-4-6',
]);
const DEFAULT_CLAUDE_CONTEXT_LIMIT = 200000;
const DEFAULT_CODEX_CONTEXT_LIMIT = 258400;
const DEFAULT_OPENCODE_CONTEXT_LIMIT = 200000;

interface CodexContextSnapshot {
  contextUsed: number;
  contextLimit: number;
}

function getDefaultContextLimit(provider: AgentProvider | undefined): number {
  if (provider === 'codex') return DEFAULT_CODEX_CONTEXT_LIMIT;
  if (provider === 'opencode') return DEFAULT_OPENCODE_CONTEXT_LIMIT;
  return DEFAULT_CLAUDE_CONTEXT_LIMIT;
}

// In-memory agent storage
const agents = new Map<string, Agent>();

// Listeners for agent changes
type AgentListener = (event: string, agent: Agent | string) => void;
const listeners = new Set<AgentListener>();


// Track agents with pending property updates that need notification on next command
// These are changes that affect the agent's behavior but don't require session restart
// Note: Model changes use hot restart (stop + resume with new model) instead of pending updates
interface PendingPropertyUpdate {
  classChanged?: boolean;
  oldClass?: string;
  permissionModeChanged?: boolean;
  oldPermissionMode?: string;
  useChromeChanged?: boolean;
  oldUseChrome?: boolean;
}
const pendingPropertyUpdates = new Map<string, PendingPropertyUpdate>();

export function sanitizeModelForProvider(
  provider: AgentProvider,
  model: unknown
): ClaudeModel | undefined {
  if (provider !== 'claude') return undefined;
  if (typeof model !== 'string') return undefined;
  if (CLAUDE_MODELS.has(model as ClaudeModel)) {
    return model as ClaudeModel;
  }
  return undefined;
}

export function sanitizeCodexModel(model: unknown): CodexModel | undefined {
  if (typeof model !== 'string') return undefined;
  const trimmed = model.trim();
  return trimmed.length > 0 ? (trimmed as CodexModel) : undefined;
}

export function sanitizeOpencodeModel(model: unknown): OpencodeModel | undefined {
  if (typeof model !== 'string') return undefined;
  const trimmed = model.trim();
  return trimmed.length > 0 ? (trimmed as OpencodeModel) : undefined;
}

function findFileRecursively(rootDir: string, pattern: string): string | null {
  if (!fs.existsSync(rootDir)) return null;

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const nested = findFileRecursively(fullPath, pattern);
      if (nested) return nested;
      continue;
    }
    if (entry.isFile() && entry.name.includes(pattern) && entry.name.endsWith('.jsonl')) {
      return fullPath;
    }
  }

  return null;
}

function findCodexRolloutPath(sessionId: string): string | null {
  const codexHome = path.join(os.homedir(), '.codex');
  return findFileRecursively(path.join(codexHome, 'sessions'), sessionId)
    || findFileRecursively(path.join(codexHome, 'archived_sessions'), sessionId);
}

function getCodexLogPath(): string {
  return path.join(os.homedir(), '.codex', 'log', 'codex-tui.log');
}

function parseCodexEstimatedContextSnapshot(sessionId: string, contextLimit: number): CodexContextSnapshot | null {
  const logPath = getCodexLogPath();
  if (!fs.existsSync(logPath)) return null;

  const lines = fs.readFileSync(logPath, 'utf8').split('\n');
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.includes(sessionId) || !line.includes('estimated_token_count=Some(')) continue;

    const estimatedMatch = line.match(/estimated_token_count=Some\((\d+)\)/);
    if (!estimatedMatch) continue;

    const estimatedTokens = Number(estimatedMatch[1]);
    if (!Number.isFinite(estimatedTokens) || estimatedTokens < 0) continue;

    return {
      contextUsed: Math.max(0, Math.round(estimatedTokens)),
      contextLimit,
    };
  }

  return null;
}

function parseCodexContextSnapshot(rolloutPath: string): CodexContextSnapshot | null {
  if (!fs.existsSync(rolloutPath)) return null;

  const lines = fs.readFileSync(rolloutPath, 'utf8').split('\n');
  let contextLimit = DEFAULT_CODEX_CONTEXT_LIMIT;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;

    try {
      const parsed = JSON.parse(line);
      const payload = parsed?.payload;
      if (payload?.type === 'token_count' && payload.info) {
        const modelContextWindow = Number(payload.info.model_context_window);
        if (Number.isFinite(modelContextWindow) && modelContextWindow > 0) {
          contextLimit = modelContextWindow;
        }

        const inputTokens = Number(payload.info?.last_token_usage?.input_tokens);
        if (Number.isFinite(inputTokens) && inputTokens >= 0) {
          return {
            contextUsed: Math.min(Math.round(inputTokens), contextLimit),
            contextLimit,
          };
        }
      }

      if (payload?.type === 'task_started') {
        const modelContextWindow = Number(payload.model_context_window);
        if (Number.isFinite(modelContextWindow) && modelContextWindow > 0) {
          contextLimit = modelContextWindow;
        }
      }
    } catch {
      // Ignore malformed lines and continue scanning older entries.
    }
  }

  return null;
}

export function getCodexContextSnapshotFromSession(sessionId: string | undefined): CodexContextSnapshot | null {
  if (!sessionId) return null;
  const rolloutPath = findCodexRolloutPath(sessionId);
  const rolloutSnapshot = rolloutPath ? parseCodexContextSnapshot(rolloutPath) : null;
  const contextLimit = rolloutSnapshot?.contextLimit ?? DEFAULT_CODEX_CONTEXT_LIMIT;
  const estimatedSnapshot = parseCodexEstimatedContextSnapshot(sessionId, contextLimit);
  return estimatedSnapshot ?? rolloutSnapshot;
}

// ============================================================================
// Initialization
// ============================================================================

export function initAgents(): void {
  try {
    const storedAgents = loadAgents();

    for (const stored of storedAgents) {
      const isCodexProvider = (stored.provider ?? 'claude') === 'codex';
      const repairedCodexContext = isCodexProvider
        ? getCodexContextSnapshotFromSession(stored.sessionId)
        : null;
      const defaultContextLimit = getDefaultContextLimit(stored.provider ?? 'claude');
      const migratedPersistedContextLimit = isCodexProvider
        && (stored.contextLimit === undefined || stored.contextLimit === DEFAULT_CLAUDE_CONTEXT_LIMIT)
        ? defaultContextLimit
        : stored.contextLimit;
      const contextLimit = repairedCodexContext?.contextLimit ?? migratedPersistedContextLimit ?? defaultContextLimit;
      const tokensUsed = stored.tokensUsed ?? 0;
      // Preserve persisted context usage. Falling back to lifetime tokens can
      // inflate context on restart because tokensUsed is cumulative over time.
      const persistedContextUsed = typeof stored.contextUsed === 'number'
        ? stored.contextUsed
        : tokensUsed;
      const baseContextUsed = repairedCodexContext?.contextUsed ?? persistedContextUsed;
      // Don't clamp to contextLimit - contextUsed can legitimately exceed the default
      // 200k limit for models with larger context windows (up to 1M).
      const contextUsed = Math.max(0, baseContextUsed);
      const clearStaleContextStats = isCodexProvider
        && stored.contextStats
        && (stored.contextStats.contextWindow !== contextLimit || stored.contextStats.totalTokens !== contextUsed);

      const agent: Agent = {
        ...stored,
        status: 'idle', // Ready to receive commands
        provider: stored.provider ?? 'claude', // Migration for existing agents
        // Clear runtime state on server restart - we don't know if tasks are still valid
        currentTask: undefined,
        currentTool: undefined,
        // Ensure context fields have defaults (migration for existing agents)
        contextUsed,
        contextLimit,
        contextStats: clearStaleContextStats ? undefined : stored.contextStats,
        taskCount: stored.taskCount ?? 0, // Migration for existing agents
        permissionMode: stored.permissionMode ?? 'bypass', // Migration for existing agents
        useChrome: stored.useChrome, // Restore Chrome flag
        model: sanitizeModelForProvider(stored.provider ?? 'claude', stored.model), // Restore only valid Claude model
        codexModel: sanitizeCodexModel(stored.codexModel),
        codexConfig: stored.codexConfig,
        opencodeModel: sanitizeOpencodeModel(stored.opencodeModel),
        // Boss field - fallback to checking class for backward compatibility
        isBoss: stored.isBoss ?? stored.class === 'boss',
      };
      agents.set(agent.id, agent);
    }
    log.log(` Loaded ${agents.size} agents from ${getDataDir()}`);
  } catch (err) {
    log.error(' Failed to load agents:', err);
  }
}

export function persistAgents(): void {
  try {
    saveAgents(Array.from(agents.values()));
  } catch (err) {
    log.error(' Failed to save agents:', err);
  }
}

// Debounced persist - coalesces rapid updateAgent() calls into one async write
let persistTimer: NodeJS.Timeout | null = null;
const PERSIST_DEBOUNCE_MS = 2000;

function debouncedPersistAgents(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    saveAgentsAsync(Array.from(agents.values())).catch(err => {
      log.error(' Failed to save agents (debounced):', err);
    });
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Flush any pending debounced writes synchronously (for shutdown).
 * Cancels the timer and does an immediate sync atomic write.
 */
export function flushPersistAgents(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistAgents();
}

// ============================================================================
// Event System
// ============================================================================

export function subscribe(listener: AgentListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: string, data: Agent | string): void {
  listeners.forEach((listener) => listener(event, data));
}

// ============================================================================
// Agent CRUD
// ============================================================================

export function getAgent(id: string): Agent | undefined {
  return agents.get(id);
}

export function getAllAgents(): Agent[] {
  return Array.from(agents.values());
}

export async function createAgent(
  name: string,
  agentClass: AgentClass,
  cwd: string,
  position?: { x: number; y: number; z: number },
  sessionId?: string,
  useChrome?: boolean,
  permissionMode: PermissionMode = 'bypass',
  initialSkillIds?: string[],
  isBoss?: boolean,
  model?: ClaudeModel,
  codexModel?: CodexModel,
  customInstructions?: string,
  provider: AgentProvider = 'claude',
  codexConfig?: CodexConfig,
  effort?: ClaudeEffort,
  opencodeModel?: OpencodeModel
): Promise<Agent> {
  log.log('🎆 [CREATE_AGENT] Starting agent creation:', {
    name,
    agentClass,
    cwd,
    sessionId,
    useChrome,
    permissionMode,
    isBoss,
    model,
    codexModel,
    codexConfig,
    customInstructions: customInstructions ? `${customInstructions.length} chars` : undefined,
  });

  const id = generateId();
  log.log(`  Generated ID: ${id}`);

  // Validate cwd
  log.log(`  Validating directory: ${cwd}`);
  if (!fs.existsSync(cwd)) {
    log.error(`  ❌ Directory does not exist: ${cwd}`);
    throw new Error(`Directory does not exist: ${cwd}`);
  }
  log.log(`  ✅ Directory exists`);

  // Create agent object
  // SessionId can be provided to link to an existing Claude session
  const agent: Agent = {
    id,
    name,
    class: agentClass,
    status: 'idle',
    provider,
    position: position || {
      x: Math.random() * 10 - 5,
      y: 0,
      z: Math.random() * 10 - 5,
    },
    cwd,
    useChrome,
    permissionMode,
    model: sanitizeModelForProvider(provider, model),
    effort: provider === 'claude' ? effort : undefined,
    codexModel: provider === 'codex' ? sanitizeCodexModel(codexModel) : undefined,
    codexConfig,
    opencodeModel: provider === 'opencode' ? sanitizeOpencodeModel(opencodeModel) : undefined,
    tokensUsed: 0,
    contextUsed: 0,
    contextLimit: getDefaultContextLimit(provider),
    taskCount: 0, // Initialize task counter
    createdAt: Date.now(),
    lastActivity: Date.now(),
    sessionId: sessionId,
    isBoss: isBoss || agentClass === 'boss', // Boss if explicitly set or class is 'boss'
    customInstructions,
  };

  log.log('  Agent object created:', {
    id: agent.id,
    name: agent.name,
    cwd: agent.cwd,
  });

  agents.set(id, agent);
  log.log(`  Agent added to memory store (total agents: ${agents.size})`);

  try {
    persistAgents();
    log.log('  ✅ Agent persisted to disk');
  } catch (err) {
    log.error('  ⚠️ Failed to persist agent:', err);
    // Don't throw - agent is still created in memory
  }

  log.log(`✅ Agent ${name} (${id}) created successfully in ${cwd}`);

  // Reconcile area assignment based on initial position
  reconcileAgentAreaAssignment(id, { x: agent.position.x, z: agent.position.z });

  emit('created', agent);
  log.log('  Event emitted: created');

  return agent;
}

/**
 * Check if a point is inside a drawing area.
 */
function isPositionInArea(pos: { x: number; z: number }, area: DrawingArea): boolean {
  if (area.archived) return false;
  if (area.type === 'rectangle' && area.width && area.height) {
    const halfW = area.width / 2;
    const halfH = area.height / 2;
    return (
      pos.x >= area.center.x - halfW &&
      pos.x <= area.center.x + halfW &&
      pos.z >= area.center.z - halfH &&
      pos.z <= area.center.z + halfH
    );
  }
  if (area.type === 'circle' && area.radius) {
    const dx = pos.x - area.center.x;
    const dz = pos.z - area.center.z;
    return dx * dx + dz * dz <= area.radius * area.radius;
  }
  return false;
}

/**
 * Reconcile an agent's area assignment based on its physical position.
 * Adds the agent to the area it's inside (if any) and removes it from others.
 */
function reconcileAgentAreaAssignment(agentId: string, position: { x: number; z: number }): void {
  try {
    const areas = loadAreas();
    let changed = false;

    // Find which area the agent is inside (by position)
    let containingAreaId: string | null = null;
    for (const area of areas) {
      if (isPositionInArea(position, area)) {
        containingAreaId = area.id;
        break;
      }
    }

    for (const area of areas) {
      const isAssigned = area.assignedAgentIds.includes(agentId);
      if (area.id === containingAreaId) {
        // Agent is inside this area — ensure assigned
        if (!isAssigned) {
          area.assignedAgentIds.push(agentId);
          changed = true;
        }
      } else {
        // Agent is NOT inside this area — ensure unassigned
        if (isAssigned) {
          area.assignedAgentIds = area.assignedAgentIds.filter(id => id !== agentId);
          changed = true;
        }
      }
    }

    if (changed) {
      saveAreas(areas);
    }
  } catch (err) {
    // Non-critical — don't let area reconciliation break agent updates
    log.error(` Area reconciliation failed for agent ${agentId}:`, err);
  }
}

export function updateAgent(id: string, updates: Partial<Agent>, updateActivity = true): Agent | null {
  const agent = agents.get(id);
  if (!agent) return null;
  const normalizedUpdates = { ...updates };

  const sessionIdBefore = agent.sessionId;
  const hasSessionIdInUpdates = 'sessionId' in normalizedUpdates;

  // Track pending property updates for notification on next command
  // (these are changes that affect behavior but don't require restart)
  const pending = pendingPropertyUpdates.get(id) || {};

  if (normalizedUpdates.class !== undefined && normalizedUpdates.class !== agent.class) {
    pending.classChanged = true;
    pending.oldClass = agent.class;
    log.log(`Agent ${agent.name}: Class change pending (${agent.class} -> ${normalizedUpdates.class})`);
  }

  if (normalizedUpdates.permissionMode !== undefined && normalizedUpdates.permissionMode !== agent.permissionMode) {
    pending.permissionModeChanged = true;
    pending.oldPermissionMode = agent.permissionMode;
    log.log(`Agent ${agent.name}: Permission mode change pending (${agent.permissionMode} -> ${normalizedUpdates.permissionMode})`);
  }

  if (normalizedUpdates.useChrome !== undefined && normalizedUpdates.useChrome !== agent.useChrome) {
    pending.useChromeChanged = true;
    pending.oldUseChrome = agent.useChrome;
    log.log(`Agent ${agent.name}: Chrome mode change pending (${agent.useChrome} -> ${normalizedUpdates.useChrome})`);
  }

  // Note: Model changes are handled via hot restart (stop + resume with new model)
  // in agent-handler.ts, not via pending updates

  if (Object.keys(pending).length > 0) {
    pendingPropertyUpdates.set(id, pending);
  }

  const nextStatus = normalizedUpdates.status ?? agent.status;
  const hasExplicitTrackingStatus = Object.prototype.hasOwnProperty.call(normalizedUpdates, 'trackingStatus');
  const explicitTrackingStatus = normalizedUpdates.trackingStatus;
  const shouldPreserveExplicitTrackingStatus = explicitTrackingStatus !== undefined
    && explicitTrackingStatus !== null
    && explicitTrackingStatus !== 'working';
  const enteredWorkingState = agent.status !== 'working' && nextStatus === 'working';
  if (enteredWorkingState && !shouldPreserveExplicitTrackingStatus) {
    normalizedUpdates.trackingStatus = 'working';
    normalizedUpdates.trackingStatusDetail = undefined;
    if (!hasExplicitTrackingStatus || explicitTrackingStatus === null || explicitTrackingStatus === 'working') {
      normalizedUpdates.trackingStatusTimestamp = Date.now();
    }
  }

  // Only update lastActivity for real activity (not position changes, etc.)
  if (updateActivity) {
    Object.assign(agent, normalizedUpdates, { lastActivity: Date.now() });
  } else {
    Object.assign(agent, normalizedUpdates);
  }
  agents.set(id, agent);
  debouncedPersistAgents();

  // Reconcile area assignment when position changes
  if (normalizedUpdates.position) {
    reconcileAgentAreaAssignment(id, { x: agent.position.x, z: agent.position.z });
  }

  // Debug logging for sessionId changes
  if (sessionIdBefore !== agent.sessionId) {
    log.warn(`🔑 [SESSION CHANGE] Agent ${agent.name} (${id}): sessionId changed from "${sessionIdBefore}" to "${agent.sessionId}". Updates had sessionId: ${hasSessionIdInUpdates}, updates keys: ${Object.keys(normalizedUpdates).join(', ')}`);
  }

  emit('updated', agent);
  return agent;
}

export function deleteAgent(id: string): boolean {
  const agent = agents.get(id);
  if (!agent) return false;

  agents.delete(id);
  persistAgents();

  // Clean up area assignments for this agent
  try {
    const areas = loadAreas();
    let changed = false;
    for (const area of areas) {
      const idx = area.assignedAgentIds.indexOf(id);
      if (idx !== -1) {
        area.assignedAgentIds.splice(idx, 1);
        changed = true;
      }
    }
    if (changed) saveAreas(areas);
  } catch {
    // Non-critical
  }

  // Clean up skill assignments for this agent (deferred import to avoid circular dependency)
  setImmediate(async () => {
    try {
      const skillService = await import('./skill-service.js');
      skillService.removeAgentFromAllSkills(id);
    } catch {
      // Skill service might not be loaded yet, ignore
    }
  });

  emit('deleted', id);
  return true;
}

// ============================================================================
// Session Operations
// ============================================================================

export async function getAgentSessions(agentId: string) {
  const agent = agents.get(agentId);
  if (!agent) return null;

  const sessions = await listSessions(agent.cwd);
  return {
    sessions,
    currentSessionId: agent.sessionId,
    summary: getSessionSummary(sessions),
  };
}

export async function getAgentHistory(
  agentId: string,
  limit: number = 50,
  offset: number = 0,
  includeSubagents: boolean = true,
  subagentEntriesLimit: number = 200
) {
  const agent = agents.get(agentId);
  log.log(` getAgentHistory called for agentId=${agentId}, agent found: ${!!agent}`);
  if (!agent) return null;

  log.log(` Agent ${agent.name} (${agentId}): sessionId=${agent.sessionId}, cwd=${agent.cwd}`);

  if (!agent.sessionId) {
    log.log(` No sessionId for agent ${agentId}, returning empty`);
    return { messages: [], sessionId: null, totalCount: 0, hasMore: false, subagents: [] as SubagentHistoryEntry[] };
  }

  const history = await loadSession(agent.cwd, agent.sessionId, limit, offset);
  const messages = history?.messages || [];
  log.log(` Loaded ${messages.length} messages for agent ${agentId} from session ${agent.sessionId}`);

  // Load subagent history if requested
  let subagents: SubagentHistoryEntry[] = [];
  if (includeSubagents && messages.length > 0) {
    // Collect Task/Agent tool_use IDs from the current page
    const toolUseIdsInPage = new Set<string>();
    for (const msg of messages) {
      if (msg.type === 'tool_use' && (msg.toolName === 'Task' || msg.toolName === 'Agent') && msg.toolUseId) {
        toolUseIdsInPage.add(msg.toolUseId);
      }
    }

    if (toolUseIdsInPage.size > 0) {
      try {
        // We need all messages for correlation (not just the page), so load full session
        const fullHistory = await loadSession(agent.cwd, agent.sessionId, 10000, 0);
        const allMessages = fullHistory?.messages || messages;

        subagents = await loadSubagentHistory(
          agent.cwd,
          agent.sessionId,
          allMessages,
          toolUseIdsInPage,
          subagentEntriesLimit
        );
        log.log(` Loaded ${subagents.length} subagent histories for agent ${agentId}`);
      } catch (err) {
        log.error(` Failed to load subagent history for agent ${agentId}:`, err);
      }
    }
  }

  return {
    sessionId: agent.sessionId,
    messages,
    cwd: agent.cwd,
    totalCount: history?.totalCount || 0,
    hasMore: history?.hasMore || false,
    subagents,
  };
}

export async function getAllToolHistory(limit: number = 100) {
  const allToolExecutions: Array<{
    agentId: string;
    agentName: string;
    toolName: string;
    timestamp: number;
  }> = [];
  const allFileChanges: Array<{
    agentId: string;
    agentName: string;
    action: 'created' | 'modified' | 'deleted' | 'read';
    filePath: string;
    timestamp: number;
  }> = [];

  // Load tool history for each agent that has a session
  for (const agent of agents.values()) {
    if (!agent.sessionId) continue;

    try {
      const { toolExecutions, fileChanges } = await loadToolHistory(
        agent.cwd,
        agent.sessionId,
        agent.id,
        agent.name,
        limit
      );
      allToolExecutions.push(...toolExecutions);
      allFileChanges.push(...fileChanges);
    } catch (err) {
      log.error(` Failed to load tool history for ${agent.name}:`, err);
    }
  }

  // Sort by timestamp (newest first) and limit
  allToolExecutions.sort((a, b) => b.timestamp - a.timestamp);
  allFileChanges.sort((a, b) => b.timestamp - a.timestamp);

  return {
    toolExecutions: allToolExecutions.slice(0, limit),
    fileChanges: allFileChanges.slice(0, limit),
  };
}

export async function searchAgentHistory(agentId: string, query: string, limit: number = 50) {
  const agent = agents.get(agentId);
  if (!agent) return null;

  if (!agent.sessionId) {
    return { matches: [], totalMatches: 0 };
  }

  const result = await searchSession(agent.cwd, agent.sessionId, query, limit);
  return result || { matches: [], totalMatches: 0 };
}

// ============================================================================
// Pending Property Updates (for live notification injection)
// ============================================================================

/**
 * Check if an agent has pending property updates
 */
export function hasPendingPropertyUpdates(agentId: string): boolean {
  return pendingPropertyUpdates.has(agentId);
}

/**
 * Get pending property updates for an agent
 */
export function getPendingPropertyUpdates(agentId: string): PendingPropertyUpdate | undefined {
  return pendingPropertyUpdates.get(agentId);
}

/**
 * Clear pending property updates for an agent
 */
export function clearPendingPropertyUpdates(agentId: string): void {
  pendingPropertyUpdates.delete(agentId);
}

/**
 * Build a notification message for property updates
 * This is injected into the next command to notify the agent of changes
 */
export function buildPropertyUpdateNotification(agentId: string): string {
  const pending = pendingPropertyUpdates.get(agentId);
  if (!pending) return '';

  const agent = agents.get(agentId);
  if (!agent) return '';

  const notifications: string[] = [];

  if (pending.classChanged) {
    notifications.push(`- Your agent class has changed from "${pending.oldClass}" to "${agent.class}". Adjust your behavior accordingly.`);
  }

  if (pending.permissionModeChanged) {
    const modeDesc = agent.permissionMode === 'bypass'
      ? 'bypass (you can execute tools without asking for permission)'
      : 'interactive (you should ask for permission before executing tools)';
    notifications.push(`- Your permission mode has changed to: ${modeDesc}`);
  }

  if (pending.useChromeChanged) {
    const chromeDesc = agent.useChrome
      ? 'Chrome browser is now enabled for web interactions'
      : 'Chrome browser has been disabled';
    notifications.push(`- ${chromeDesc}`);
  }

  // Note: Model changes are handled via hot restart, not pending notifications

  if (notifications.length === 0) return '';

  return `
---
# ⚙️ CONFIGURATION UPDATE

Your configuration has been updated:

${notifications.join('\n')}

Please acknowledge this update and continue with your work.
---

`;
}

// ============================================================================
// Session History
// ============================================================================

let sessionHistories: Map<string, SessionHistoryEntry[]> = new Map();

export function initSessionHistory(): void {
  sessionHistories = loadSessionHistory();
  log.log?.(` Loaded session history for ${sessionHistories.size} agents`);
}

export function shutdownSessionHistory(): void {
  saveSessionHistory(sessionHistories);
}

/**
 * Archive the current session for an agent before it gets cleared.
 * Call this before setting sessionId to undefined.
 */
export function archiveCurrentSession(agentId: string): void {
  const agent = agents.get(agentId);
  if (!agent || !agent.sessionId) return;

  const entry: SessionHistoryEntry = {
    sessionId: agent.sessionId,
    summary: agent.taskLabel || agent.lastAssignedTask || agent.currentTask || 'No description',
    startedAt: agent.createdAt,
    endedAt: Date.now(),
  };

  addSessionHistoryEntry(sessionHistories, agentId, entry);
  saveSessionHistory(sessionHistories);
  log.log?.(`Archived session ${agent.sessionId} for agent ${agent.name}`);
}

export function getAgentSessionHistory(agentId: string): SessionHistoryEntry[] {
  const agent = agents.get(agentId);
  const entries = getSessionHistoryForAgent(sessionHistories, agentId);
  if (!agent) return entries;

  const projectDir = getProjectDir(agent.cwd);
  return entries.map((entry) => ({
    ...entry,
    fileExists: fs.existsSync(path.join(projectDir, `${entry.sessionId}.jsonl`)),
  }));
}

// ============================================================================
// Utilities
// ============================================================================
