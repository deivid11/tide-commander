/**
 * Agent Service
 * Business logic for managing agents
 */

import * as fs from 'fs';
import type { Agent, AgentClass, PermissionMode, ClaudeModel } from '../../shared/types.js';
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

// In-memory agent storage
const agents = new Map<string, Agent>();

// Listeners for agent changes
type AgentListener = (event: string, agent: Agent | string) => void;
const listeners = new Set<AgentListener>();

// ============================================================================
// Initialization
// ============================================================================

export function initAgents(): void {
  try {
    const storedAgents = loadAgents();
    for (const stored of storedAgents) {
      const contextLimit = stored.contextLimit ?? 200000;
      const tokensUsed = stored.tokensUsed ?? 0;
      // Just use tokensUsed as contextUsed - it's a good proxy for conversation fullness
      const contextUsed = tokensUsed;

      const agent: Agent = {
        ...stored,
        status: 'idle', // Ready to receive commands
        // Clear runtime state on server restart - we don't know if tasks are still valid
        currentTask: undefined,
        currentTool: undefined,
        // Ensure context fields have defaults (migration for existing agents)
        contextUsed,
        contextLimit,
        taskCount: stored.taskCount ?? 0, // Migration for existing agents
        permissionMode: stored.permissionMode ?? 'bypass', // Migration for existing agents
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
  model?: ClaudeModel
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
    position: position || {
      x: Math.random() * 10 - 5,
      y: 0,
      z: Math.random() * 10 - 5,
    },
    cwd,
    useChrome,
    permissionMode,
    model,
    tokensUsed: 0,
    contextUsed: 0,
    contextLimit: 200000, // Claude's default context limit
    taskCount: 0, // Initialize task counter
    createdAt: Date.now(),
    lastActivity: Date.now(),
    sessionId: sessionId,
    isBoss: isBoss || agentClass === 'boss', // Boss if explicitly set or class is 'boss'
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

  // Only update lastActivity for real activity (not position changes, etc.)
  if (updateActivity) {
    Object.assign(agent, updates, { lastActivity: Date.now() });
  } else {
    Object.assign(agent, updates);
  }
  agents.set(id, agent);
  persistAgents();

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
    } catch (err) {
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
// Utilities
// ============================================================================
