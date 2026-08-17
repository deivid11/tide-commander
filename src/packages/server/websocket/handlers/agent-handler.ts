/**
 * Agent Lifecycle Handler
 * Handles spawn, kill, stop, remove, rename, and update operations for agents
 */

import * as fs from 'fs';
import { spawn } from 'child_process';
import type { Agent, AgentProvider, CodexConfig, ContextStats } from '../../../shared/types.js';
import { CLAUDE_MODELS as CLAUDE_MODEL_METADATA } from '../../../shared/agent-types.js';
import { agentService, runtimeService, skillService, customClassService, bossService, permissionService } from '../../services/index.js';
import { markInstructionsDirty } from '../../services/instruction-refresh.js';
import { createLogger } from '../../utils/index.js';
import { ClaudeBackend, parseContextOutput } from '../../claude/backend.js';
import { detectSessionProvider } from '../../claude/session-loader.js';
import { getGrokSessionDir, readGrokSignalsUsage } from '../../grok/session-watcher.js';
import type { HandlerContext } from './types.js';

const log = createLogger('AgentHandler');
const claudeBackend = new ClaudeBackend();

// Test change: Server restart validation - if you see this log, the server restarted successfully
log.log('🔄 AgentHandler loaded - server restart test');

/**
 * Unlink an agent from boss hierarchy before deletion.
 * If agent is a subordinate, remove from their boss.
 * If agent is a boss, unlink all their subordinates.
 */
export function unlinkAgentFromBossHierarchy(agentId: string): void {
  const agent = agentService.getAgent(agentId);
  if (!agent) return;

  // If this agent has a boss, remove from boss's subordinate list
  if (agent.bossId) {
    try {
      bossService.removeSubordinate(agent.bossId, agentId);
    } catch (err) {
      log.error(` Failed to unlink from boss: ${err}`);
    }
  }

  // If this agent is a boss, unlink all subordinates
  if ((agent.isBoss || agent.class === 'boss') && agent.subordinateIds?.length) {
    for (const subId of agent.subordinateIds) {
      try {
        // Clear the bossId from subordinate
        agentService.updateAgent(subId, { bossId: undefined });
      } catch (err) {
        log.error(` Failed to unlink subordinate ${subId}: ${err}`);
      }
    }
  }
}

/**
 * Handle spawn_agent message
 */
export async function handleSpawnAgent(
  ctx: HandlerContext,
  payload: {
    name: string;
    class: string;
    cwd: string;
    sessionId?: string;
    useChrome?: boolean;
    permissionMode?: string;
    provider?: AgentProvider;
    codexConfig?: CodexConfig;
    codexModel?: string;
    opencodeModel?: string;
    grokModel?: string;
    piModel?: string;
    position?: { x: number; y: number; z: number };
    initialSkillIds?: string[];
    model?: string;
    effort?: string;
    customInstructions?: string;
  }
): Promise<void> {
  log.log('Request received:', {
    name: payload.name,
    class: payload.class,
    cwd: payload.cwd,
    sessionId: payload.sessionId,
    useChrome: payload.useChrome,
    permissionMode: payload.permissionMode,
    position: payload.position,
    initialSkillIds: payload.initialSkillIds,
    model: payload.model,
    opencodeModel: payload.opencodeModel,
    grokModel: payload.grokModel,
    piModel: payload.piModel,
    customInstructions: payload.customInstructions ? `${payload.customInstructions.length} chars` : undefined,
  });

  try {
    const agent = await agentService.createAgent(
      payload.name,
      payload.class,
      payload.cwd,
      payload.position,
      payload.sessionId,
      payload.useChrome,
      payload.permissionMode as any,
      undefined, // initialSkillIds handled separately below
      undefined, // isBoss
      payload.model as any,
      payload.codexModel as any,
      payload.customInstructions,
      payload.provider,
      payload.codexConfig,
      payload.effort as any,
      payload.opencodeModel as any,
      payload.grokModel as any,
      payload.piModel as any
    );

    log.log('Agent created successfully:', {
      id: agent.id,
      name: agent.name,
      class: agent.class,
      sessionId: agent.sessionId,
    });

    // Assign initial skills if provided
    const initialSkillIds = payload.initialSkillIds || [];

    // Also get default skills from custom class if applicable
    const classDefaultSkills = customClassService.getClassDefaultSkillIds(agent.class);
    const allSkillIds = [...new Set([...initialSkillIds, ...classDefaultSkills])];

    if (allSkillIds.length > 0) {
      log.log(`Assigning ${allSkillIds.length} skills to ${agent.name}`);
      for (const skillId of allSkillIds) {
        skillService.assignSkillToAgent(skillId, agent.id);
      }
    }

    ctx.broadcast({
      type: 'agent_created',
      payload: agent,
    });

    ctx.sendActivity(agent.id, `${agent.name} deployed`);
  } catch (err: any) {
    log.error('Failed to spawn agent:', err);

    // Check if this is a directory not found error
    if (err.message?.includes('Directory does not exist')) {
      ctx.sendToClient({
        type: 'directory_not_found' as any,
        payload: {
          path: payload.cwd,
          name: payload.name,
          class: payload.class,
        },
      });
    } else {
      ctx.sendError(err.message);
    }
  }
}

/**
 * Shared core for clone/fork: duplicate a source agent's configuration into a
 * brand-new agent (new id, copied config + skills). Does NOT touch sessions —
 * the caller decides whether to start fresh (clone) or fork the source session.
 */
async function duplicateAgentConfig(
  source: Agent,
  name: string,
  position: { x: number; y: number; z: number },
  overrides?: {
    /** Attach the new agent to a different project (session restore). */
    cwd?: string;
    /** Session for the new agent. Clone/fork never pass one (clone=fresh,
     * fork sets forkSourceSessionId afterwards); restore-to-new-agent does. */
    sessionId?: string;
    /** Force the provider (a restored Claude session needs a Claude agent
     * even when the config source runs Codex/OpenCode). */
    provider?: AgentProvider;
  }
): Promise<Agent> {
  // Copy only directly-assigned skills; class-default skills are re-applied
  // automatically below based on the new agent's class.
  const directSkillIds = skillService
    .getAllSkills()
    .filter((skill) => skill.assignedAgentIds.includes(source.id))
    .map((skill) => skill.id);

  const agent = await agentService.createAgent(
    name,
    source.class,
    overrides?.cwd ?? source.cwd,
    position,
    overrides?.sessionId,
    source.useChrome,
    source.permissionMode,
    undefined, // initialSkillIds handled separately below
    source.isBoss,
    source.model,
    source.codexModel,
    source.customInstructions,
    overrides?.provider ?? source.provider,
    source.codexConfig,
    source.effort,
    source.opencodeModel,
    source.grokModel,
    source.piModel
  );

  // Re-apply skills: copied direct assignments + class defaults.
  const classDefaultSkills = customClassService.getClassDefaultSkillIds(agent.class);
  const allSkillIds = [...new Set([...directSkillIds, ...classDefaultSkills])];
  for (const skillId of allSkillIds) {
    skillService.assignSkillToAgent(skillId, agent.id);
  }

  return agent;
}

// Offset a duplicate so it doesn't overlap the source on the battlefield.
function duplicateOffset(source: Agent): { x: number; y: number; z: number } {
  return { x: source.position.x + 2, y: 0, z: source.position.z + 2 };
}

// Providers whose conversation history can be forked. Codex forks through the
// app-server `thread/fork` method even when regular turns use `codex exec`.
const FORKABLE_PROVIDERS: ReadonlySet<AgentProvider> = new Set(['claude', 'codex', 'opencode', 'grok', 'pi']);

/**
 * Handle restore_session_new_agent — restore a (possibly orphaned) session
 * onto a BRAND-NEW agent. The new agent copies the configuration and skills
 * of the most similar existing agent: the most recently worked one whose cwd
 * matches the session's project (same-provider preferred — the session's
 * provider is detected from where its file lives, so a grok session gets a
 * grok agent). Without a similar agent it spawns a default builder in the
 * session's cwd.
 */
export async function handleRestoreSessionNewAgent(
  ctx: HandlerContext,
  payload: { sessionId: string; cwd: string; name?: string }
): Promise<void> {
  if (!payload?.sessionId || !payload?.cwd) {
    ctx.sendError('restore_session_new_agent requires sessionId and cwd');
    return;
  }

  const provider: AgentProvider = detectSessionProvider(payload.cwd, payload.sessionId) ?? 'claude';
  const candidates = agentService
    .getAllAgents()
    .filter((a) => a.cwd === payload.cwd)
    .sort((a, b) => (b.lastWorkedAt ?? b.lastActivity ?? 0) - (a.lastWorkedAt ?? a.lastActivity ?? 0));
  const source = candidates.find((a) => (a.provider ?? 'claude') === provider) ?? candidates[0];

  log.log(
    `Restoring ${provider} session ${payload.sessionId} onto a new agent in ${payload.cwd}` +
      (source ? ` (config from ${source.name})` : ' (no similar agent — defaults)')
  );

  try {
    let agent: Agent;
    if (source) {
      const name = payload.name?.trim() || `${source.name} (Restored)`;
      agent = await duplicateAgentConfig(source, name, duplicateOffset(source), {
        cwd: payload.cwd,
        sessionId: payload.sessionId,
        provider,
      });
    } else {
      agent = await agentService.createAgent(
        payload.name?.trim() || 'Restored Session',
        'builder',
        payload.cwd,
        undefined,
        payload.sessionId,
        undefined,          // useChrome
        undefined,          // permissionMode (default)
        undefined,          // initialSkillIds
        undefined,          // isBoss
        undefined,          // model
        undefined,          // codexModel
        undefined,          // customInstructions
        provider
      );
      for (const skillId of customClassService.getClassDefaultSkillIds(agent.class)) {
        skillService.assignSkillToAgent(skillId, agent.id);
      }
    }

    ctx.broadcast({ type: 'agent_created', payload: agent });
    ctx.sendActivity(agent.id, `${agent.name} created to restore session ${payload.sessionId.slice(0, 8)}…`);
    log.log(`Session ${payload.sessionId} restored onto new agent ${agent.name} (${agent.id})`);
  } catch (err: any) {
    log.error('Failed to restore session onto a new agent:', err);
    ctx.sendError(err.message);
  }
}

/**
 * Handle clone_agent message - duplicates an existing agent's configuration
 * into a brand-new agent (fresh session, no inherited context/memory).
 */
export async function handleCloneAgent(
  ctx: HandlerContext,
  payload: {
    sourceAgentId: string;
    name?: string;
    position?: { x: number; y: number; z: number };
  }
): Promise<void> {
  const source = agentService.getAgent(payload.sourceAgentId);
  if (!source) {
    log.error(`Cannot clone: source agent ${payload.sourceAgentId} not found`);
    ctx.sendError(`Agent ${payload.sourceAgentId} not found`);
    return;
  }

  const name = payload.name?.trim() || `${source.name} (Copy)`;
  const position = payload.position ?? duplicateOffset(source);

  log.log(`Cloning agent ${source.name} (${source.id}) -> ${name}`);

  try {
    const agent = await duplicateAgentConfig(source, name, position);
    log.log(`Agent cloned successfully: ${agent.name} (${agent.id})`);

    ctx.broadcast({ type: 'agent_created', payload: agent });
    ctx.sendActivity(agent.id, `${agent.name} cloned from ${source.name}`);
  } catch (err: any) {
    log.error('Failed to clone agent:', err);
    ctx.sendError(err.message);
  }
}

/**
 * Handle fork_agent message - like clone, but the new agent also CONTINUES the
 * source's conversation history. On the new agent's first run the backend
 * resumes the source session and forks it into a fresh one (Claude
 * --fork-session / Codex thread/fork / OpenCode --fork); the new session id is then captured and
 * forkSourceSessionId is cleared. If the source has no session or its provider
 * isn't forkable, this degrades to a plain clone (fresh session).
 */
export async function handleForkAgent(
  ctx: HandlerContext,
  payload: {
    sourceAgentId: string;
    name?: string;
    position?: { x: number; y: number; z: number };
  }
): Promise<void> {
  const source = agentService.getAgent(payload.sourceAgentId);
  if (!source) {
    log.error(`Cannot fork: source agent ${payload.sourceAgentId} not found`);
    ctx.sendError(`Agent ${payload.sourceAgentId} not found`);
    return;
  }

  const provider = source.provider ?? 'claude';
  const canForkHistory = !!source.sessionId && FORKABLE_PROVIDERS.has(provider);
  const name = payload.name?.trim() || `${source.name} (Fork)`;
  const position = payload.position ?? duplicateOffset(source);

  log.log(`Forking agent ${source.name} (${source.id}) -> ${name} (history: ${canForkHistory ? 'yes' : 'no'})`);

  try {
    const agent = await duplicateAgentConfig(source, name, position);

    if (canForkHistory) {
      // Mark the source session so the new agent's first run forks it. Also flag
      // instructions dirty so that first turn re-injects THIS agent's identity
      // (new id/notify token) + skills — the forked history carries the source's.
      agentService.updateAgent(agent.id, { forkSourceSessionId: source.sessionId });
      markInstructionsDirty(agent.id);
    }

    log.log(`Agent forked successfully: ${agent.name} (${agent.id})`);

    ctx.broadcast({ type: 'agent_created', payload: agent });
    const fallbackReason = !source.sessionId
      ? 'source has no conversation yet'
      : `history fork not supported for ${provider}`;
    ctx.sendActivity(
      agent.id,
      canForkHistory
        ? `${agent.name} forked from ${source.name} (continues its conversation)`
        : `${agent.name} cloned from ${source.name} (${fallbackReason})`
    );
  } catch (err: any) {
    log.error('Failed to fork agent:', err);
    ctx.sendError(err.message);
  }
}

/**
 * Handle kill_agent message - stops and deletes agent
 */
export async function handleKillAgent(
  ctx: HandlerContext,
  payload: { agentId: string }
): Promise<void> {
  const agent = agentService.getAgent(payload.agentId);
  log.log(`Agent ${agent?.name || payload.agentId}: User requested agent deletion`);

  // Cancel any pending permissions and notify clients
  const cancelledPermissions = permissionService.cancelRequestsForAgent(payload.agentId);
  for (const requestId of cancelledPermissions) {
    ctx.broadcast({
      type: 'permission_resolved',
      payload: { requestId, approved: false },
    });
  }

  await runtimeService.stopAgent(payload.agentId);
  unlinkAgentFromBossHierarchy(payload.agentId);
  agentService.deleteAgent(payload.agentId);

  log.log(`Agent ${agent?.name || payload.agentId}: Agent deleted successfully`);
}

/**
 * Handle stop_agent message - stops current operation but keeps agent alive
 */
export async function handleStopAgent(
  ctx: HandlerContext,
  payload: { agentId: string }
): Promise<void> {
  const agent = agentService.getAgent(payload.agentId);
  log.log(`Agent ${agent?.name || payload.agentId}: Stop requested`);

  // Cancel any pending permissions and notify clients
  const cancelledPermissions = permissionService.cancelRequestsForAgent(payload.agentId);
  for (const requestId of cancelledPermissions) {
    ctx.broadcast({
      type: 'permission_resolved',
      payload: { requestId, approved: false },
    });
  }

  await runtimeService.stopAgent(payload.agentId);
  agentService.updateAgent(payload.agentId, {
    status: 'idle',
    currentTask: undefined,
    currentTool: undefined,
  });
  ctx.sendActivity(payload.agentId, 'Operation cancelled');

  log.log(`Agent ${agent?.name || payload.agentId}: Stopped successfully, agent now idle`);
}

/**
 * Handle clear_context message - clears agent's context and forces new session
 */
export async function handleClearContext(
  ctx: HandlerContext,
  payload: { agentId: string }
): Promise<void> {
  const agent = agentService.getAgent(payload.agentId);
  log.log(`Agent ${agent?.name || payload.agentId}: User requested context clear`);

  // Archive the current session before clearing
  agentService.archiveCurrentSession(payload.agentId);

  await runtimeService.stopAgent(payload.agentId);
  agentService.updateAgent(payload.agentId, {
    status: 'idle',
    currentTask: undefined,
    taskLabel: undefined,
    trackingStatus: undefined,
    trackingStatusDetail: undefined,
    trackingStatusTimestamp: undefined,
    currentTool: undefined,
    lastAssignedTask: undefined,
    lastAssignedTaskTime: undefined,
    sessionId: undefined, // Clear session to force new one
    tokensUsed: 0,
    contextUsed: 0,
    contextStats: undefined,
  });
  ctx.sendActivity(payload.agentId, 'Context cleared - new session on next command');

  log.log(`Agent ${agent?.name || payload.agentId}: Context cleared, session reset`);
}

/**
 * Handle restore_session message - restores a previous session for an agent
 *
 * Optional `cwd` enables cross-project restore from the global Session Finder:
 * if the chosen session lives in a different project directory than the agent
 * currently uses, we update the agent's cwd alongside its sessionId so Claude
 * Code can resolve the JSONL on the next run.
 */
export async function handleRestoreSession(
  ctx: HandlerContext,
  payload: { agentId: string; sessionId: string; cwd?: string }
): Promise<void> {
  const agent = agentService.getAgent(payload.agentId);
  if (!agent) {
    ctx.sendError(`Agent not found: ${payload.agentId}`);
    return;
  }

  const targetCwd = payload.cwd && payload.cwd !== agent.cwd ? payload.cwd : undefined;
  log.log(
    `Agent ${agent.name}: Restoring session ${payload.sessionId}` +
      (targetCwd ? ` (cwd change: ${agent.cwd} -> ${targetCwd})` : '')
  );

  // Archive the current session first (if any)
  agentService.archiveCurrentSession(payload.agentId);

  // Stop any running process
  await runtimeService.stopAgent(payload.agentId);

  const updates: Parameters<typeof agentService.updateAgent>[1] = {
    status: 'idle',
    currentTask: undefined,
    taskLabel: undefined,
    currentTool: undefined,
    sessionId: payload.sessionId,
    tokensUsed: 0,
    contextUsed: 0,
    contextStats: undefined,
  };
  if (targetCwd) {
    updates.cwd = targetCwd;
  }
  agentService.updateAgent(payload.agentId, updates);

  ctx.sendActivity(
    payload.agentId,
    targetCwd
      ? `Session restored from ${targetCwd} - will resume on next command`
      : `Session restored - will resume on next command`
  );
  log.log(`Agent ${agent.name}: Session restored to ${payload.sessionId}`);
}

/**
 * Handle request_session_history - returns archived sessions for an agent
 */
export function handleRequestSessionHistory(
  ctx: HandlerContext,
  payload: { agentId: string }
): void {
  const entries = agentService.getAgentSessionHistory(payload.agentId);
  ctx.sendToClient({
    type: 'session_history',
    payload: {
      agentId: payload.agentId,
      entries,
    },
  });
}

/**
 * Handle collapse_context message - sends /compact command to collapse context.
 * Thin wrapper around runtimeService.collapseAgentContext that maps each
 * discriminated result back to the WS activity stream.
 */
export async function handleCollapseContext(
  ctx: HandlerContext,
  payload: { agentId: string }
): Promise<void> {
  // WS path never opts into waitForIdle — the UI button only makes sense when
  // the agent is already idle. Default behavior (409-equivalent activity msg
  // for busy) is preserved.
  const result = await runtimeService.collapseAgentContext(payload.agentId);
  switch (result.status) {
    case 'collapse-initiated':
      ctx.sendActivity(payload.agentId, 'Context collapse initiated');
      return;
    case 'queued':
      // Not reachable from this path (we don't pass waitForIdle), but the
      // exhaustive switch keeps the type system honest if a future caller
      // flips the flag here.
      ctx.sendActivity(payload.agentId, 'Context collapse queued — will fire when agent is idle');
      return;
    case 'busy':
      ctx.sendActivity(payload.agentId, 'Cannot collapse context while agent is busy');
      return;
    case 'not-found':
      // No agent → no activity stream to write to; quietly drop (the UI shouldn't
      // be able to reach this state, and logging keeps the breadcrumb).
      log.warn(`collapse_context for unknown agent ${payload.agentId}`);
      return;
    case 'error':
      log.error(` Failed to collapse context: ${result.error}`);
      ctx.sendActivity(payload.agentId, 'Failed to collapse context');
      return;
  }
}

/**
 * Parse the visual terminal format from /context command output.
 * Example: "claude-opus-4-6 · 46k/200k tokens (23%)"
 *          "⛁ System prompt: 6.7k tokens (3.4%)"
 */
function parseVisualContextOutput(content: string): ContextStats | null {
  try {
    const parseTokenVal = (raw: string): number => {
      const normalized = raw.trim().replace(/,/g, '');
      const suffix = normalized.slice(-1).toLowerCase();
      const numericPart = suffix === 'k' || suffix === 'm'
        ? normalized.slice(0, -1)
        : normalized;
      const value = parseFloat(numericPart);
      if (!Number.isFinite(value)) return NaN;
      if (suffix === 'k') return value * 1000;
      if (suffix === 'm') return value * 1000000;
      return value;
    };

    // Match: model-name · 46k/200k tokens (23%)
    const headerMatch = content.match(/([^\n]+?)\s*[·•]\s*([\d.,]+(?:[kKmM])?)\s*\/\s*([\d.,]+(?:[kKmM])?)\s*tokens?\s*\(([\d.]+)%\)/i);
    if (!headerMatch) {
      return null;
    }

    const model = headerMatch[1].trim();
    const totalTokens = parseTokenVal(headerMatch[2]);
    const contextWindow = parseTokenVal(headerMatch[3]);
    const usedPercent = parseFloat(headerMatch[4]);
    if (!Number.isFinite(totalTokens) || !Number.isFinite(contextWindow) || !Number.isFinite(usedPercent)) {
      return null;
    }

    // Parse categories from visual format: "⛁ Category Name: 6.7k tokens (3.4%)" or "⛁ Category Name: 479 tokens (0.2%)"
    const parseVisualCategory = (name: string): { tokens: number; percent: number } => {
      const regex = new RegExp(`${name}:\\s*([\\d.,]+(?:[kKmM])?)\\s*(?:tokens)?\\s*\\(([\\d.]+)%\\)`, 'i');
      const match = content.match(regex);
      if (match) {
        return { tokens: parseTokenVal(match[1]), percent: parseFloat(match[2]) };
      }
      return { tokens: 0, percent: 0 };
    };

    return {
      model,
      contextWindow,
      totalTokens,
      usedPercent,
      categories: {
        systemPrompt: parseVisualCategory('System prompt'),
        systemTools: parseVisualCategory('System tools'),
        messages: parseVisualCategory('Messages'),
        freeSpace: parseVisualCategory('Free space'),
        autocompactBuffer: parseVisualCategory('Autocompact buffer'),
      },
      lastUpdated: Date.now(),
    };
  } catch (err) {
    log.error('parseVisualContextOutput error:', err);
    return null;
  }
}

/**
 * Spawn a short-lived Claude CLI process to fetch real context stats for a session.
 *
 * Strategy: Two attempts.
 *   1. stream-json mode (--print --input/output-format stream-json)
 *      The /context slash command IS recognised (0 tokens, no API call) but
 *      its output may come as a `user` event with <local-command-stdout> tags
 *      or may be completely absent from the JSON stream.
 *   2. Plain pipe mode (no --print, no format flags)
 *      Pipe `/context\n` as plain text. The CLI should run the local command
 *      and write the visual bar-chart output to stdout/stderr.
 */
function fetchContextFromCLI(sessionId: string, cwd: string): Promise<ContextStats | null> {
  return new Promise((resolve) => {
    // Attempt 1: stream-json mode (fast, preferred if output is available)
    tryStreamJson(sessionId, cwd).then((stats) => {
      if (stats) {
        resolve(stats);
        return;
      }
      // Attempt 2: plain pipe mode (interactive-like, captures visual output)
      tryPlainPipe(sessionId, cwd).then((stats2) => {
        resolve(stats2);
      });
    });
  });
}

function waitForContextStatsUpdate(agentId: string, previousLastUpdated: number, timeoutMs = 2500): Promise<boolean> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      const agent = agentService.getAgent(agentId);
      const lastUpdated = agent?.contextStats?.lastUpdated || 0;
      if (lastUpdated > previousLastUpdated) {
        clearInterval(interval);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 100);
  });
}

function tryStreamJson(sessionId: string, cwd: string): Promise<ContextStats | null> {
  return new Promise((resolve) => {
    const executable = claudeBackend.getExecutablePath();
    const args = [
      '--resume', sessionId,
      '--print',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
    ];

    log.log(`[fetchContext:stream-json] Spawning: ${executable} ${args.join(' ')}`);

    const child = spawn(executable, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    const input = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: '/context' },
    });
    child.stdin.write(input + '\n');
    child.stdin.end();

    const timer = setTimeout(() => {
      log.warn('[fetchContext:stream-json] Timed out');
      child.kill();
      resolve(null);
    }, 10000);

    child.on('close', () => {
      clearTimeout(timer);
      log.log(`[fetchContext:stream-json] exited, stdout=${stdout.length}, stderr=${stderr.length}`);
      const combined = stdout + '\n' + stderr;

      // Look for <local-command-stdout> in raw text or inside JSON user events
      const localCmdMatch = combined.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
      if (localCmdMatch) {
        const stats = parseContextOutput(localCmdMatch[1]);
        if (stats) {
          log.log(`[fetchContext:stream-json] Parsed from tags: ${stats.totalTokens}/${stats.contextWindow}`);
          resolve(stats);
          return;
        }
      }

      for (const line of combined.split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'user' && typeof event.message?.content === 'string') {
            const tagMatch = event.message.content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
            if (tagMatch) {
              const stats = parseContextOutput(tagMatch[1]);
              if (stats) {
                log.log(`[fetchContext:stream-json] Parsed from user event: ${stats.totalTokens}/${stats.contextWindow}`);
                resolve(stats);
                return;
              }
            }
          }
        } catch { /* not JSON */ }
      }

      log.log('[fetchContext:stream-json] No context data found, will try plain pipe');
      resolve(null);
    });

    child.on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

function tryPlainPipe(sessionId: string, cwd: string): Promise<ContextStats | null> {
  return new Promise((resolve) => {
    const executable = claudeBackend.getExecutablePath();
    // No --print, no format flags. Pipe /context as plain text.
    // The CLI should recognise it as a slash command in interactive-like mode.
    const args = ['--resume', sessionId];

    log.log(`[fetchContext:plain] Spawning: ${executable} ${args.join(' ')}`);

    const child = spawn(executable, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' }, // suppress ANSI codes
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    // Send the slash command and close stdin so CLI exits
    child.stdin.write('/context\n');
    child.stdin.end();

    const timer = setTimeout(() => {
      log.warn('[fetchContext:plain] Timed out');
      child.kill('SIGTERM');
      // Even on timeout, try to parse what we have
      const stats = parseAllFormats(stdout + '\n' + stderr);
      resolve(stats);
    }, 10000);

    child.on('close', () => {
      clearTimeout(timer);
      log.log(`[fetchContext:plain] exited, stdout=${stdout.length}, stderr=${stderr.length}`);
      const stats = parseAllFormats(stdout + '\n' + stderr);
      if (stats) {
        log.log(`[fetchContext:plain] Parsed: ${stats.totalTokens}/${stats.contextWindow} (${stats.model})`);
      } else {
        log.warn('[fetchContext:plain] Could not parse context');
        if (stdout.length < 2000) log.log(`[fetchContext:plain] stdout: ${stdout}`);
        if (stderr.length < 2000) log.log(`[fetchContext:plain] stderr: ${stderr}`);
      }
      resolve(stats);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      log.error(`[fetchContext:plain] error: ${err}`);
      resolve(null);
    });
  });
}

/** Try every known format parser on the combined output. */
export function parseAllFormats(raw: string): ContextStats | null {
  // Strip ANSI escape codes
  const stripped = raw.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');

  // 1. Markdown table format (from <local-command-stdout> or raw)
  const localCmd = stripped.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
  if (localCmd) {
    const stats = parseContextOutput(localCmd[1]);
    if (stats) return stats;
  }
  const mdStats = parseContextOutput(stripped);
  if (mdStats) return mdStats;

  // 2. Visual terminal format (⛁ bar chart)
  const vizStats = parseVisualContextOutput(stripped);
  if (vizStats) return vizStats;

  return null;
}

/**
 * Build context stats from tracked agent data (fallback when CLI fetch isn't possible).
 */
function buildStatsFromTrackedData(agent: Agent): ContextStats {
  // Always use the real-time tracked values from step_complete/usage_snapshot events.
  // These are updated on every API turn and are the most accurate source of truth.
  // Do NOT prefer agent.contextStats here — those can become stale when previous
  // fallback calls save their (potentially wrong) output back to agent.contextStats
  // via broadcastContextStats, creating a self-reinforcing feedback loop.
  const provider = agent.provider ?? 'claude';
  const defaultContextLimit = provider === 'codex' ? 258400
    : provider === 'opencode' ? 200000
    : provider === 'grok' ? 500000
    : 200000;
  const contextLimit = Math.max(1, Math.round(agent.contextLimit || defaultContextLimit));
  const rawContextUsed = Math.max(0, Math.round(agent.contextUsed || 0));
  // Guard: contextUsed can never exceed contextLimit. Values above the limit are
  // cumulative session totals from result events, not per-request context fill.
  const contextUsed = rawContextUsed <= contextLimit ? rawContextUsed : 0;

  if (rawContextUsed > contextLimit) {
    log.log(`[contextStats] Building from tracked data: raw ${rawContextUsed} exceeds limit ${contextLimit}, reset to 0`);
  } else {
    log.log(`[contextStats] Building from tracked data: ${contextUsed}/${contextLimit}`);
  }

  const usedPercent = Math.min(100, Math.round((contextUsed / contextLimit) * 100));
  const freeTokens = Math.max(0, contextLimit - contextUsed);
  const model = agent.model || agent.codexModel || agent.opencodeModel || agent.grokModel || agent.piModel || 'unknown';

  return {
    model,
    contextWindow: contextLimit,
    totalTokens: contextUsed,
    usedPercent,
    categories: {
      systemPrompt: { tokens: 0, percent: 0 },
      systemTools: { tokens: 0, percent: 0 },
      messages: { tokens: contextUsed, percent: Number(((contextUsed / contextLimit) * 100).toFixed(1)) },
      freeSpace: { tokens: freeTokens, percent: Number(((freeTokens / contextLimit) * 100).toFixed(1)) },
      autocompactBuffer: { tokens: 0, percent: 0 },
    },
    lastUpdated: Date.now(),
  };
}

/**
 * Broadcast context stats to UI (both the modal and the context bar).
 */
function broadcastContextStats(ctx: HandlerContext, agentId: string, stats: ContextStats, label: string): void {
  // Sanitize: if totalTokens exceeds contextWindow, it's a cumulative artifact — reset to 0.
  if (stats.totalTokens > stats.contextWindow) {
    stats = { ...stats, totalTokens: 0, usedPercent: 0, categories: {
      ...stats.categories,
      messages: { tokens: 0, percent: 0 },
      freeSpace: { tokens: stats.contextWindow, percent: 100 },
    }};
  }
  const freePercent = stats.categories?.freeSpace?.percent ?? (100 - stats.usedPercent);

  agentService.updateAgent(agentId, {
    contextStats: stats,
    contextUsed: stats.totalTokens,
    contextLimit: stats.contextWindow,
  }, false);

  ctx.broadcast({ type: 'context_stats', payload: { agentId, stats } } as any);
  ctx.broadcast({ type: 'context_update', payload: { agentId, contextUsed: stats.totalTokens, contextLimit: stats.contextWindow } } as any);
  ctx.broadcast({
    type: 'output',
    payload: {
      agentId,
      text: `Context (${label}): ${(stats.totalTokens / 1000).toFixed(1)}k/${(stats.contextWindow / 1000).toFixed(1)}k (${freePercent}% free)`,
      isStreaming: false,
      timestamp: Date.now(),
    },
  });
}

/**
 * Handle request_context_stats message.
 * For Claude agents with a session, fetches REAL context stats from the CLI.
 * Falls back to tracked data if CLI fetch fails or agent has no session.
 */
export async function handleRequestContextStats(
  ctx: HandlerContext,
  payload: { agentId: string }
): Promise<void> {
  const agent = agentService.getAgent(payload.agentId);
  if (!agent) {
    log.error(` Agent not found for context stats: ${payload.agentId}`);
    return;
  }

  const isClaudeProvider = (agent.provider ?? 'claude') === 'claude';
  const isCodexProvider = (agent.provider ?? 'claude') === 'codex';
  const isOpencodeProvider = (agent.provider ?? 'claude') === 'opencode';
  const _isCodexLikeProvider = isCodexProvider || isOpencodeProvider;

  // For Claude agents with an active session, fetch real context stats from the CLI
  if (isClaudeProvider && agent.sessionId) {
    log.log(`[contextStats] Fetching real context from CLI for ${agent.name} (session=${agent.sessionId})`);
    try {
      const stats = await fetchContextFromCLI(agent.sessionId, agent.cwd || process.cwd());
      if (stats) {
        log.log(`[contextStats] Got real stats: ${stats.totalTokens}/${stats.contextWindow} (${stats.model})`);
        broadcastContextStats(ctx, payload.agentId, stats, 'from CLI');
        return;
      }
      log.warn(`[contextStats] CLI fetch returned null, trying in-session /context command`);
    } catch (err) {
      log.error(`[contextStats] CLI fetch failed: ${err}`);
    }

    // Fallback #2 for Claude: ask the runtime session directly and let runtime-listeners
    // parse/broadcast the authoritative context_stats event.
    try {
      const beforeUpdate = agent.contextStats?.lastUpdated || 0;
      await runtimeService.sendSilentCommand(payload.agentId, '/context');
      ctx.sendActivity(payload.agentId, 'Fetching context from Claude session');
      const gotContextStats = await waitForContextStatsUpdate(payload.agentId, beforeUpdate);
      if (gotContextStats) {
        log.log(`[contextStats] In-session /context produced context_stats for ${agent.name}`);
        return;
      }
      log.warn(`[contextStats] In-session /context produced no context_stats, falling back to tracked data`);
    } catch (err) {
      log.error(`[contextStats] In-session /context failed: ${err}`);
    }
  }

  if (isCodexProvider && agent.sessionId) {
    const codexSnapshot = agentService.getCodexContextSnapshotFromSession(agent.sessionId);
    if (codexSnapshot) {
      const contextLimit = Math.max(1, codexSnapshot.contextLimit);
      const contextUsed = Math.max(0, Math.min(codexSnapshot.contextUsed, contextLimit));
      const usedPercent = Math.min(100, Math.round((contextUsed / contextLimit) * 100));
      const freeTokens = Math.max(0, contextLimit - contextUsed);
      const stats: ContextStats = {
        model: agent.codexModel || agent.model || 'codex',
        contextWindow: contextLimit,
        totalTokens: contextUsed,
        usedPercent,
        categories: {
          systemPrompt: { tokens: 0, percent: 0 },
          systemTools: { tokens: 0, percent: 0 },
          messages: { tokens: contextUsed, percent: Number(((contextUsed / contextLimit) * 100).toFixed(1)) },
          freeSpace: { tokens: freeTokens, percent: Number(((freeTokens / contextLimit) * 100).toFixed(1)) },
          autocompactBuffer: { tokens: 0, percent: 0 },
        },
        lastUpdated: Date.now(),
      };
      log.log(`[contextStats] Codex session snapshot for ${agent.name}: ${contextUsed}/${contextLimit}`);
      broadcastContextStats(ctx, payload.agentId, stats, 'from Codex session');
      return;
    }
  }

  // Grok: streaming-json has no usage events. Read signals.json from the session dir.
  const isGrokProvider = (agent.provider ?? 'claude') === 'grok';
  if (isGrokProvider && agent.sessionId && agent.cwd) {
    try {
      const sessionDir = getGrokSessionDir(agent.cwd, agent.sessionId);
      const usage = readGrokSignalsUsage(sessionDir);
      if (usage) {
        const contextLimit = Math.max(1, usage.contextWindowTokens);
        const contextUsed = Math.max(0, Math.min(usage.contextTokensUsed, contextLimit));
        const usedPercent = Math.min(
          100,
          Math.round(usage.contextWindowUsage ?? (contextUsed / contextLimit) * 100)
        );
        const freeTokens = Math.max(0, contextLimit - contextUsed);
        const stats: ContextStats = {
          model: agent.grokModel || agent.model || 'grok',
          contextWindow: contextLimit,
          totalTokens: contextUsed,
          usedPercent,
          categories: {
            systemPrompt: { tokens: 0, percent: 0 },
            systemTools: { tokens: 0, percent: 0 },
            messages: { tokens: contextUsed, percent: Number(((contextUsed / contextLimit) * 100).toFixed(1)) },
            freeSpace: { tokens: freeTokens, percent: Number(((freeTokens / contextLimit) * 100).toFixed(1)) },
            autocompactBuffer: { tokens: 0, percent: 0 },
          },
          lastUpdated: Date.now(),
        };
        log.log(`[contextStats] Grok signals.json for ${agent.name}: ${contextUsed}/${contextLimit}`);
        broadcastContextStats(ctx, payload.agentId, stats, 'from Grok signals.json');
        return;
      }
      log.warn(`[contextStats] Grok signals.json missing/unreadable for ${agent.name} session=${agent.sessionId}`);
    } catch (err) {
      log.error(`[contextStats] Grok signals read failed: ${err}`);
    }
  }

  // Fallback: generate from tracked data
  const latestAgent = agentService.getAgent(payload.agentId) || agent;
  const stats = buildStatsFromTrackedData(latestAgent);
  const label = latestAgent.provider === 'codex' || latestAgent.provider === 'opencode' || latestAgent.provider === 'grok'
    ? 'estimated from turn usage'
    : 'tracked from token usage';
  broadcastContextStats(ctx, payload.agentId, stats, label);
}

/**
 * Handle move_agent message
 */
export function handleMoveAgent(
  ctx: HandlerContext,
  payload: { agentId: string; position: { x: number; y: number; z: number } }
): void {
  // Don't update lastActivity for position changes
  agentService.updateAgent(payload.agentId, {
    position: payload.position,
  }, false);
}

/**
 * Handle remove_agent message - stops runtime and deletes agent
 */
export async function handleRemoveAgent(
  ctx: HandlerContext,
  payload: { agentId: string }
): Promise<void> {
  const agent = agentService.getAgent(payload.agentId);
  log.log(`Agent ${agent?.name || payload.agentId}: User requested agent removal`);

  // Cancel any pending permissions and notify clients
  const cancelledPermissions = permissionService.cancelRequestsForAgent(payload.agentId);
  for (const requestId of cancelledPermissions) {
    ctx.broadcast({
      type: 'permission_resolved',
      payload: { requestId, approved: false },
    });
  }

  await runtimeService.stopAgent(payload.agentId);
  unlinkAgentFromBossHierarchy(payload.agentId);
  agentService.deleteAgent(payload.agentId);

  log.log(`Agent ${agent?.name || payload.agentId}: Agent removed successfully`);
}

/**
 * Handle rename_agent message
 */
export function handleRenameAgent(
  ctx: HandlerContext,
  payload: { agentId: string; name: string }
): void {
  // Don't update lastActivity for name changes
  agentService.updateAgent(payload.agentId, {
    name: payload.name,
  }, false);
}

/**
 * Handle update_agent_properties message
 */
export async function handleUpdateAgentProperties(
  ctx: HandlerContext,
  payload: {
    agentId: string;
    updates: {
      class?: string;
      permissionMode?: string;
      provider?: AgentProvider;
      codexConfig?: CodexConfig;
      model?: string;
      effort?: string;
      codexModel?: string;
      opencodeModel?: string;
      grokModel?: string;
      piModel?: string;
      useChrome?: boolean;
      skillIds?: string[];
      cwd?: string;
      shortcut?: string;
      soundsMuted?: boolean;
      customInstructions?: string;
      customPrompt?: string;
      autoCollapse?: boolean;
      autoCollapseCron?: string;
      autoCollapseTz?: string;
      autoCollapsePrompt?: string;
    };
  }
): Promise<void> {
  const { agentId, updates } = payload;
  const agent = agentService.getAgent(agentId);

  if (!agent) {
    ctx.sendError(`Agent not found: ${agentId}`);
    return;
  }

  const nextProvider = updates.provider ?? agent.provider;
  const normalizedUpdatedModel =
    updates.model !== undefined
      ? agentService.sanitizeModelForProvider(nextProvider, updates.model)
      : undefined;
  const normalizedUpdatedCodexModel =
    updates.codexModel !== undefined
      ? agentService.sanitizeCodexModel(updates.codexModel)
      : undefined;
  const normalizedUpdatedOpencodeModel =
    updates.opencodeModel !== undefined
      ? agentService.sanitizeOpencodeModel(updates.opencodeModel)
      : undefined;
  const normalizedUpdatedGrokModel =
    updates.grokModel !== undefined
      ? agentService.sanitizeGrokModel(updates.grokModel)
      : undefined;
  const normalizedUpdatedPiModel =
    updates.piModel !== undefined
      ? agentService.sanitizePiModel(updates.piModel)
      : undefined;

  // Track if model changed (requires hot restart to apply new model while preserving context)
  const modelChanged = updates.model !== undefined && normalizedUpdatedModel !== agent.model;
  const codexModelChanged = updates.codexModel !== undefined && normalizedUpdatedCodexModel !== agent.codexModel;
  const opencodeModelChanged = updates.opencodeModel !== undefined && normalizedUpdatedOpencodeModel !== agent.opencodeModel;
  const grokModelChanged = updates.grokModel !== undefined && normalizedUpdatedGrokModel !== agent.grokModel;
  const piModelChanged = updates.piModel !== undefined && normalizedUpdatedPiModel !== agent.piModel;
  const providerChanged = updates.provider !== undefined && updates.provider !== agent.provider;
  const classChanged = updates.class !== undefined && updates.class !== agent.class;
  const codexConfigChanged = updates.codexConfig !== undefined
    && JSON.stringify(updates.codexConfig || {}) !== JSON.stringify(agent.codexConfig || {});
  const effortChanged = updates.effort !== undefined && updates.effort !== (agent.effort || undefined);
  const sessionId = agent.sessionId; // Save before update

  // Track if Chrome flag changed (requires hot restart to add/remove --chrome flag)
  const useChromeChanged = updates.useChrome !== undefined && updates.useChrome !== agent.useChrome;

  // Track if cwd changed (requires hot restart to change working directory)
  const cwdChanged = updates.cwd !== undefined && updates.cwd !== agent.cwd;

  // Track if skills changed (requires hot restart to apply new skills in system prompt)
  let skillsChanged = false;
  if (updates.skillIds !== undefined) {
    const currentSkills = skillService.getSkillsForAgent(agentId, agent.class);
    const currentDirectSkillIds = currentSkills
      .filter(s => s.assignedAgentIds.includes(agentId))
      .map(s => s.id)
      .sort();
    const newSkillIds = [...updates.skillIds].sort();
    skillsChanged = JSON.stringify(currentDirectSkillIds) !== JSON.stringify(newSkillIds);
  }

  // Update agent properties
  const agentUpdates: Partial<Agent> = {};

  if (updates.class !== undefined) {
    agentUpdates.class = updates.class;
  }

  if (updates.permissionMode !== undefined) {
    agentUpdates.permissionMode = updates.permissionMode as any;
  }

  if (updates.provider !== undefined) {
    agentUpdates.provider = updates.provider;
    if (updates.provider !== 'pi') agentUpdates.piModelProvider = undefined;
    if (updates.provider === 'pi' && updates.piModel === undefined) agentUpdates.piModelProvider = undefined;
  }

  if (updates.codexConfig !== undefined) {
    agentUpdates.codexConfig = updates.codexConfig;
  }

  if (updates.model !== undefined) {
    agentUpdates.model = normalizedUpdatedModel as any;
    if (nextProvider === 'claude' && normalizedUpdatedModel === undefined) {
      ctx.sendActivity(agentId, `Ignored unsupported Claude model "${updates.model}"`);
    }
    // Refresh contextLimit from the new model's metadata so the UI reflects
    // the correct window size immediately (e.g. 1M for opus[1m], 200k for
    // standard Opus) instead of waiting for the next modelUsage event.
    if (nextProvider === 'claude' && normalizedUpdatedModel) {
      const meta = CLAUDE_MODEL_METADATA[normalizedUpdatedModel];
      if (meta) {
        agentUpdates.contextLimit = meta.contextWindow;
        // Drop stale contextStats so the UI doesn't show the old window size
        // until the new model reports its own.
        if (agent.contextStats && agent.contextStats.contextWindow !== meta.contextWindow) {
          agentUpdates.contextStats = undefined;
        }
      }
    }
  }

  if (updates.codexModel !== undefined) {
    agentUpdates.codexModel = normalizedUpdatedCodexModel as any;
  }

  if (updates.opencodeModel !== undefined) {
    agentUpdates.opencodeModel = normalizedUpdatedOpencodeModel as any;
  }

  if (updates.grokModel !== undefined) {
    agentUpdates.grokModel = normalizedUpdatedGrokModel as any;
  }

  if (updates.piModel !== undefined) {
    agentUpdates.piModel = normalizedUpdatedPiModel as any;
    const source = normalizedUpdatedPiModel?.includes('/')
      ? normalizedUpdatedPiModel.slice(0, normalizedUpdatedPiModel.indexOf('/')).trim().toLowerCase()
      : '';
    agentUpdates.piModelProvider = source || undefined;
    const piContextLimit = await agentService.resolvePiModelContextLimit(normalizedUpdatedPiModel);
    if (piContextLimit && piContextLimit !== agent.contextLimit) {
      agentUpdates.contextLimit = piContextLimit;
      agentUpdates.contextStats = undefined;
    }
  }

  if (updates.effort !== undefined) {
    agentUpdates.effort = updates.effort as any;
  }

  if (updates.useChrome !== undefined) {
    agentUpdates.useChrome = updates.useChrome;
  }

  if (updates.cwd !== undefined) {
    // Validate directory exists
    if (!fs.existsSync(updates.cwd)) {
      ctx.sendError(`Directory does not exist: ${updates.cwd}`);
      return;
    }
    agentUpdates.cwd = updates.cwd;
  }

  if (updates.shortcut !== undefined) {
    agentUpdates.shortcut = updates.shortcut;
  }

  if (updates.soundsMuted !== undefined) {
    agentUpdates.soundsMuted = updates.soundsMuted;
  }

  if (updates.customInstructions !== undefined) {
    agentUpdates.customInstructions = updates.customInstructions || undefined;
  }

  if (updates.customPrompt !== undefined) {
    agentUpdates.customPrompt = updates.customPrompt || undefined;
  }

  if (updates.autoCollapse !== undefined) {
    agentUpdates.autoCollapse = updates.autoCollapse;
  }

  if (updates.autoCollapseCron !== undefined) {
    agentUpdates.autoCollapseCron = updates.autoCollapseCron || undefined;
  }

  if (updates.autoCollapseTz !== undefined) {
    agentUpdates.autoCollapseTz = updates.autoCollapseTz || undefined;
  }

  if (updates.autoCollapsePrompt !== undefined) {
    agentUpdates.autoCollapsePrompt = updates.autoCollapsePrompt || undefined;
  }

  // Apply agent property updates if any
  // agentService.updateAgent tracks pending property changes for notification on next command
  if (Object.keys(agentUpdates).length > 0) {
    agentService.updateAgent(agentId, agentUpdates, false);
  }

  // Pi RPC owns a provider-neutral session, so a pure Pi model/provider change
  // can use its native set_model command without replacing the process or
  // conversation. Other runtime/config changes still use stop + resume.
  const modelLikeChanged = modelChanged || codexModelChanged || opencodeModelChanged || grokModelChanged || piModelChanged || providerChanged || codexConfigChanged || classChanged;
  const onlyPiModelChanged = piModelChanged
    && nextProvider === 'pi'
    && !providerChanged
    && !modelChanged
    && !codexModelChanged
    && !opencodeModelChanged
    && !grokModelChanged
    && !codexConfigChanged
    && !classChanged;
  let piModelSwitchedInPlace = false;
  let piModelSwitchFailed = false;
  if (onlyPiModelChanged && normalizedUpdatedPiModel) {
    try {
      piModelSwitchedInPlace = await runtimeService.switchAgentModel(
        agentId,
        normalizedUpdatedPiModel,
        updates.effort ?? agent.effort,
      );
      if (piModelSwitchedInPlace) {
        ctx.sendActivity(agentId, `Pi model changed to ${normalizedUpdatedPiModel} - context preserved`);
      }
    } catch (err) {
      piModelSwitchFailed = true;
      const previousSource = agent.piModel?.includes('/')
        ? agent.piModel.slice(0, agent.piModel.indexOf('/')).trim().toLowerCase()
        : agent.piModelProvider;
      agentService.updateAgent(agentId, {
        piModel: agent.piModel,
        piModelProvider: previousSource,
        contextLimit: agent.contextLimit,
        contextStats: agent.contextStats,
      }, false);
      log.warn(`Native Pi model switch failed for ${agent.name}; keeping ${agent.piModel || 'current model'}: ${String(err)}`);
      ctx.sendActivity(agentId, `Pi model switch failed - keeping ${agent.piModel || 'the current model'}`);
    }
  }

  // If model changed, do a hot restart: stop process, resume with new model.
  // This preserves context when the old and new model share the same harness.
  if (modelLikeChanged && sessionId && !piModelSwitchedInPlace && !piModelSwitchFailed) {
    const reason = providerChanged
      ? `runtime changed to ${updates.provider}`
      : classChanged
        ? `class changed to ${updates.class}`
      : codexConfigChanged
        ? 'Codex config changed'
        : codexModelChanged
          ? `Codex model changed to ${updates.codexModel}`
        : opencodeModelChanged
          ? `OpenCode model changed to ${updates.opencodeModel}`
        : grokModelChanged
          ? `Grok model changed to ${updates.grokModel}`
        : piModelChanged
          ? `Pi model changed to ${updates.piModel}`
        : `model changed to ${updates.model}`;
    log.log(`Agent ${agent.name}: ${reason}, hot restarting with --resume to preserve context`);
    try {
      await runtimeService.stopAgent(agentId);
      agentService.updateAgent(agentId, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
      }, false);
      ctx.sendActivity(agentId, `${reason} - context preserved`);
    } catch (err) {
      log.error(`Failed to hot restart agent ${agent.name} after runtime config change:`, err);
    }
  } else if (modelLikeChanged && !sessionId && !piModelSwitchedInPlace && !piModelSwitchFailed) {
    const reason = providerChanged
      ? `runtime changed to ${updates.provider}`
      : classChanged
        ? `class changed to ${updates.class}`
      : codexConfigChanged
        ? 'Codex config changed'
        : codexModelChanged
          ? `Codex model changed to ${updates.codexModel}`
        : opencodeModelChanged
          ? `OpenCode model changed to ${updates.opencodeModel}`
        : grokModelChanged
          ? `Grok model changed to ${updates.grokModel}`
        : piModelChanged
          ? `Pi model changed to ${updates.piModel}`
        : `model changed to ${updates.model}`;
    log.log(`Agent ${agent.name}: ${reason}, will apply on next session start`);
  }

  // If Chrome flag changed, do a hot restart to add/remove --chrome flag
  // Only restart if model didn't already trigger a restart
  if (useChromeChanged && !modelChanged && !codexModelChanged && !opencodeModelChanged && !grokModelChanged && !piModelChanged && !providerChanged && !codexConfigChanged && sessionId) {
    const chromeStatus = updates.useChrome ? 'enabled' : 'disabled';
    log.log(`Agent ${agent.name}: Chrome ${chromeStatus}, hot restarting with --resume to apply change`);
    try {
      // Stop the current Claude process
      await runtimeService.stopAgent(agentId);

      // Mark as idle temporarily (the resume will happen on next command)
      // Keep sessionId to allow resume with chrome flag change
      agentService.updateAgent(agentId, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
        // Keep sessionId! This allows --resume to work with the new chrome setting
      }, false);

      ctx.sendActivity(agentId, `Chrome browser ${chromeStatus} - context preserved`);
    } catch (err) {
      log.error(`Failed to hot restart agent ${agent.name} after Chrome change:`, err);
    }
  } else if (useChromeChanged && !providerChanged && !codexConfigChanged && !codexModelChanged && !opencodeModelChanged && !grokModelChanged && !piModelChanged && !sessionId) {
    // No existing session, chrome flag will apply on next start
    const chromeStatus = updates.useChrome ? 'enabled' : 'disabled';
    log.log(`Agent ${agent.name}: Chrome ${chromeStatus}, will apply on next session start`);
  }

  // If effort changed, hot restart to apply new --effort flag
  if (effortChanged && !modelChanged && !codexModelChanged && !opencodeModelChanged && !grokModelChanged && !piModelChanged && !providerChanged && !codexConfigChanged && !classChanged && !useChromeChanged && sessionId) {
    const effortLabel = updates.effort || 'default';
    log.log(`Agent ${agent.name}: effort changed to ${effortLabel}, hot restarting with --resume to apply change`);
    try {
      await runtimeService.stopAgent(agentId);
      agentService.updateAgent(agentId, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
      }, false);
      ctx.sendActivity(agentId, `Effort set to ${effortLabel} - context preserved`);
    } catch (err) {
      log.error(`Failed to hot restart agent ${agent.name} after effort change:`, err);
    }
  } else if (effortChanged && !sessionId) {
    log.log(`Agent ${agent.name}: effort changed to ${updates.effort || 'default'}, will apply on next session start`);
  }

  // If cwd changed, stop the process and clear the session
  // Unlike model/chrome changes, cwd changes cannot preserve context because
  // Claude sessions are tied to the directory they were created in
  if (cwdChanged && sessionId) {
    log.log(`Agent ${agent.name}: Working directory changed to ${updates.cwd}, clearing session (cwd change requires new session)`);
    // Archive the current session before clearing
    agentService.archiveCurrentSession(agentId);
    try {
      // Stop the current Claude process
      await runtimeService.stopAgent(agentId);

      // Mark as idle and CLEAR sessionId - cwd changes require a fresh session
      agentService.updateAgent(agentId, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
        sessionId: undefined, // Clear session - can't resume in different directory
        tokensUsed: 0,
        contextUsed: 0,
      }, false);

      ctx.sendActivity(agentId, `Working directory changed - new session will start on next command`);
    } catch (err) {
      log.error(`Failed to stop agent ${agent.name} after cwd change:`, err);
    }
  } else if (cwdChanged && !sessionId) {
    // No existing session, cwd will apply on next start
    log.log(`Agent ${agent.name}: Working directory changed to ${updates.cwd}, will apply on next session start`);
  }

  // Handle skill reassignment
  if (updates.skillIds !== undefined) {
    // First, unassign all current skills from this agent
    const currentSkills = skillService.getSkillsForAgent(agentId, agent.class);
    for (const skill of currentSkills) {
      // Only unassign if it's a direct assignment (not class-based)
      if (skill.assignedAgentIds.includes(agentId)) {
        skillService.unassignSkillFromAgent(skill.id, agentId);
      }
    }

    // Then assign the new skills
    for (const skillId of updates.skillIds) {
      skillService.assignSkillToAgent(skillId, agentId);
    }

    // If skills changed and we didn't already hot restart for model/chrome/cwd change, do it now
    // Skills are injected into the system prompt, so we need to restart to apply them
    if (skillsChanged && !modelChanged && !codexModelChanged && !opencodeModelChanged && !grokModelChanged && !piModelChanged && !providerChanged && !codexConfigChanged && !classChanged && !useChromeChanged && !cwdChanged && sessionId) {
      log.log(`Agent ${agent.name}: Skills changed, hot restarting with --resume to apply new system prompt`);
      try {
        // Stop the current Claude process
        await runtimeService.stopAgent(agentId);

        // Mark as idle temporarily (the resume will happen on next command)
        // Keep sessionId to allow resume with new skills in system prompt
        agentService.updateAgent(agentId, {
          status: 'idle',
          currentTask: undefined,
          currentTool: undefined,
          // Keep sessionId! This allows --resume to work with updated skills
        }, false);

        const newSkillCount = updates.skillIds.length;
        ctx.sendActivity(agentId, `Skills updated (${newSkillCount} skill${newSkillCount !== 1 ? 's' : ''}) - context preserved`);
      } catch (err) {
        log.error(`Failed to hot restart agent ${agent.name} after skill change:`, err);
      }
    } else if (skillsChanged && !sessionId) {
      // No existing session, skills will apply on next start
      log.log(`Agent ${agent.name}: Skills changed, will apply on next session start`);
    }
  }

  log.log(`Updated agent properties for ${agent.name}: ${JSON.stringify(updates)}`);
}

/**
 * Handle create_directory message - creates directory then spawns agent
 */
export async function handleCreateDirectory(
  ctx: HandlerContext,
  payload: { path: string; name: string; class: string }
): Promise<void> {
  try {
    fs.mkdirSync(payload.path, { recursive: true });
    log.log(` Created directory: ${payload.path}`);

    const agent = await agentService.createAgent(
      payload.name,
      payload.class,
      payload.path
    );

    ctx.broadcast({
      type: 'agent_created',
      payload: agent,
    });
    ctx.sendActivity(agent.id, `${agent.name} deployed`);
  } catch (err: any) {
    log.error(' Failed to create directory:', err);
    ctx.sendError(`Failed to create directory: ${err.message}`);
  }
}

/**
 * Handle reattach_agent message - reattach a detached agent to its existing session
 * Detached agents are those with running Claude processes that survived a server restart
 */
export async function handleReattachAgent(
  ctx: HandlerContext,
  payload: { agentId: string }
): Promise<void> {
  const agent = agentService.getAgent(payload.agentId);
  if (!agent) {
    log.error(` Agent not found: ${payload.agentId}`);
    ctx.sendError(`Agent not found: ${payload.agentId}`);
    return;
  }

  if (!agent.isDetached) {
    log.log(` Agent ${payload.agentId} is not detached, no action needed`);
    ctx.sendActivity(payload.agentId, 'Agent is already attached to the session');
    return;
  }

  if (!agent.sessionId) {
    log.error(` Cannot reattach agent ${payload.agentId} - no session ID available`);
    ctx.sendError(`Cannot reattach agent - no existing session found`);
    return;
  }

  try {
    log.log(` Reattaching agent ${payload.agentId} to existing session ${agent.sessionId}`);

    // Clear detached mode while preserving "working" status if this agent
    // already appears to be processing. This avoids flipping back/forth.
    const shouldRemainWorking = agent.status === 'working';
    agentService.updateAgent(payload.agentId, {
      isDetached: false,
      status: shouldRemainWorking ? 'working' : 'idle',
      currentTask: shouldRemainWorking ? (agent.currentTask || 'Processing...') : undefined,
      currentTool: undefined,
    });

    ctx.sendActivity(payload.agentId, `Reattached to existing session ${agent.sessionId}`);
    log.log(` Successfully reattached agent ${payload.agentId}`);
  } catch (err: any) {
    log.error(` Failed to reattach agent ${payload.agentId}:`, err);
    ctx.sendError(`Failed to reattach agent: ${err.message}`);
  }
}
