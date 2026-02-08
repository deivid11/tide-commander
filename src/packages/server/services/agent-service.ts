/**
 * Agent Service
 * Business logic for managing agents
 */

import * as fs from 'fs';
import type { Agent, AgentClass, PermissionMode, ClaudeModel, AgentProvider, CodexConfig, CodexModel } from '../../shared/types.js';
import { loadAgents, saveAgents, getDataDir } from '../data/index.js';
import {
  listSessions,
  getSessionSummary,
  loadSession,
  loadToolHistory,
  searchSession,
} from '../claude/session-loader.js';
import { logger, generateId } from '../utils/index.js';

const log = logger.agent;
const CLAUDE_MODELS = new Set<ClaudeModel>(['sonnet', 'opus', 'haiku']);

// In-memory agent storage
const agents = new Map<string, Agent>();

// Listeners for agent changes
type AgentListener = (event: string, agent: Agent | string) => void;
const listeners = new Set<AgentListener>();

// Track agents that were working before server restart (for auto-resume)
interface AgentToResume {
  id: string;
  name: string;
  lastTask: string;
  sessionId?: string;
}
const agentsToResume: AgentToResume[] = [];

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

// ============================================================================
// Initialization
// ============================================================================

// Max age for auto-resume (5 minutes) - only resume if task was assigned recently
const AUTO_RESUME_MAX_AGE_MS = 5 * 60 * 1000;

export function initAgents(): void {
  try {
    const storedAgents = loadAgents();
    const now = Date.now();

    for (const stored of storedAgents) {
      const contextLimit = stored.contextLimit ?? 200000;
      const tokensUsed = stored.tokensUsed ?? 0;
      // Preserve persisted context usage. Falling back to lifetime tokens can
      // inflate context on restart because tokensUsed is cumulative over time.
      const persistedContextUsed = typeof stored.contextUsed === 'number'
        ? stored.contextUsed
        : tokensUsed;
      const contextUsed = Math.max(0, Math.min(persistedContextUsed, contextLimit));

      // Track agents that were working before restart
      // Use lastAssignedTask (which persists) instead of currentTask (which gets cleared)
      // Only resume if task was assigned within the last 5 minutes
      // Skip if lastAssignedTask is a system auto-resume message (avoid recursive loop)
      const taskAge = stored.lastAssignedTaskTime ? now - stored.lastAssignedTaskTime : Infinity;
      const isSystemMessage = stored.lastAssignedTask?.startsWith('[System:');
      const wasRecentlyWorking = stored.lastAssignedTask && stored.sessionId && taskAge < AUTO_RESUME_MAX_AGE_MS && !isSystemMessage;

      if (wasRecentlyWorking) {
        agentsToResume.push({
          id: stored.id,
          name: stored.name,
          lastTask: stored.lastAssignedTask!,
          sessionId: stored.sessionId,
        });
        const ageSeconds = Math.round(taskAge / 1000);
        log.log(` Agent ${stored.name} was working ${ageSeconds}s ago on: "${stored.lastAssignedTask}" - will auto-resume`);
      } else if (isSystemMessage) {
        log.log(` Agent ${stored.name} skipped auto-resume: lastAssignedTask is a system message`);
      }

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
        taskCount: stored.taskCount ?? 0, // Migration for existing agents
        permissionMode: stored.permissionMode ?? 'bypass', // Migration for existing agents
        useChrome: stored.useChrome, // Restore Chrome flag
        model: sanitizeModelForProvider(stored.provider ?? 'claude', stored.model), // Restore only valid Claude model
        codexModel: sanitizeCodexModel(stored.codexModel),
        codexConfig: stored.codexConfig,
        // Boss field - fallback to checking class for backward compatibility
        isBoss: stored.isBoss ?? stored.class === 'boss',
      };
      agents.set(agent.id, agent);
    }
    log.log(` Loaded ${agents.size} agents from ${getDataDir()}`);
    if (agentsToResume.length > 0) {
      log.log(` ${agentsToResume.length} agent(s) will be auto-resumed`);
    }
  } catch (err) {
    log.error(' Failed to load agents:', err);
  }
}

/**
 * Get list of agents that were working before server restart
 * These should be auto-resumed to continue their tasks
 */
export function getAgentsToResume(): AgentToResume[] {
  return [...agentsToResume];
}

/**
 * Clear the list of agents to resume (call after auto-resume completes)
 */
export function clearAgentsToResume(): void {
  agentsToResume.length = 0;
}

export function persistAgents(): void {
  try {
    saveAgents(Array.from(agents.values()));
  } catch (err) {
    log.error(' Failed to save agents:', err);
  }
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
  codexConfig?: CodexConfig
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
    codexModel: provider === 'codex' ? sanitizeCodexModel(codexModel) : undefined,
    codexConfig,
    tokensUsed: 0,
    contextUsed: 0,
    contextLimit: 200000, // Claude's default context limit
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

  emit('created', agent);
  log.log('  Event emitted: created');

  return agent;
}

export function updateAgent(id: string, updates: Partial<Agent>, updateActivity = true): Agent | null {
  const agent = agents.get(id);
  if (!agent) return null;

  const sessionIdBefore = agent.sessionId;
  const hasSessionIdInUpdates = 'sessionId' in updates;

  // Track pending property updates for notification on next command
  // (these are changes that affect behavior but don't require restart)
  const pending = pendingPropertyUpdates.get(id) || {};

  if (updates.class !== undefined && updates.class !== agent.class) {
    pending.classChanged = true;
    pending.oldClass = agent.class;
    log.log(`Agent ${agent.name}: Class change pending (${agent.class} -> ${updates.class})`);
  }

  if (updates.permissionMode !== undefined && updates.permissionMode !== agent.permissionMode) {
    pending.permissionModeChanged = true;
    pending.oldPermissionMode = agent.permissionMode;
    log.log(`Agent ${agent.name}: Permission mode change pending (${agent.permissionMode} -> ${updates.permissionMode})`);
  }

  if (updates.useChrome !== undefined && updates.useChrome !== agent.useChrome) {
    pending.useChromeChanged = true;
    pending.oldUseChrome = agent.useChrome;
    log.log(`Agent ${agent.name}: Chrome mode change pending (${agent.useChrome} -> ${updates.useChrome})`);
  }

  // Note: Model changes are handled via hot restart (stop + resume with new model)
  // in agent-handler.ts, not via pending updates

  if (Object.keys(pending).length > 0) {
    pendingPropertyUpdates.set(id, pending);
  }

  // Only update lastActivity for real activity (not position changes, etc.)
  if (updateActivity) {
    Object.assign(agent, updates, { lastActivity: Date.now() });
  } else {
    Object.assign(agent, updates);
  }
  agents.set(id, agent);
  persistAgents();

  // Debug logging for sessionId changes
  if (sessionIdBefore !== agent.sessionId) {
    log.warn(`🔑 [SESSION CHANGE] Agent ${agent.name} (${id}): sessionId changed from "${sessionIdBefore}" to "${agent.sessionId}". Updates had sessionId: ${hasSessionIdInUpdates}, updates keys: ${Object.keys(updates).join(', ')}`);
  }

  emit('updated', agent);
  return agent;
}

export function deleteAgent(id: string): boolean {
  const agent = agents.get(id);
  if (!agent) return false;

  agents.delete(id);
  persistAgents();

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

export async function getAgentHistory(agentId: string, limit: number = 50, offset: number = 0) {
  const agent = agents.get(agentId);
  log.log(` getAgentHistory called for agentId=${agentId}, agent found: ${!!agent}`);
  if (!agent) return null;

  log.log(` Agent ${agent.name} (${agentId}): sessionId=${agent.sessionId}, cwd=${agent.cwd}`);

  if (!agent.sessionId) {
    log.log(` No sessionId for agent ${agentId}, returning empty`);
    return { messages: [], sessionId: null, totalCount: 0, hasMore: false };
  }

  const history = await loadSession(agent.cwd, agent.sessionId, limit, offset);
  log.log(` Loaded ${history?.messages.length || 0} messages for agent ${agentId} from session ${agent.sessionId}`);
  return {
    sessionId: agent.sessionId,
    messages: history?.messages || [],
    cwd: agent.cwd,
    totalCount: history?.totalCount || 0,
    hasMore: history?.hasMore || false,
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
// Utilities
// ============================================================================
