/**
 * Claude Service
 * Manages Claude Code runner and command execution
 */

import { execSync } from 'child_process';
import { ClaudeRunner, StandardEvent } from '../claude/index.js';
import { getSessionActivityStatus } from '../claude/session-loader.js';
import { parseContextOutput } from '../claude/backend.js';
import type { CustomAgentDefinition } from '../claude/types.js';
import * as agentService from './agent-service.js';
import * as supervisorService from './supervisor-service.js';
import { logger } from '../utils/logger.js';
import type { ContextStats } from '../../shared/types.js';

const log = logger.claude;

// Event types emitted by Claude service
export interface ClaudeServiceEvents {
  event: (agentId: string, event: StandardEvent) => void;
  output: (agentId: string, text: string, isStreaming?: boolean) => void;
  complete: (agentId: string, success: boolean) => void;
  error: (agentId: string, error: string) => void;
}

// Event listeners
type EventListener<K extends keyof ClaudeServiceEvents> = ClaudeServiceEvents[K];
const eventListeners = new Map<keyof ClaudeServiceEvents, Set<EventListener<any>>>();

// Claude Runner instance
let runner: ClaudeRunner | null = null;

// Track agents that are currently running /context to avoid infinite loops
const pendingContextRefresh = new Set<string>();

// Command started callback (set by websocket handler)
let commandStartedCallback: ((agentId: string, command: string) => void) | null = null;

export function setCommandStartedCallback(callback: (agentId: string, command: string) => void): void {
  commandStartedCallback = callback;
}

function notifyCommandStarted(agentId: string, command: string): void {
  if (commandStartedCallback) {
    commandStartedCallback(agentId, command);
  }
}

// ============================================================================
// Initialization
// ============================================================================

// Interval for periodic status sync (30 seconds)
const STATUS_SYNC_INTERVAL = 30000;
let statusSyncTimer: NodeJS.Timeout | null = null;

export function init(): void {
  runner = new ClaudeRunner({
    onEvent: handleEvent,
    onOutput: handleOutput,
    onSessionId: handleSessionId,
    onComplete: handleComplete,
    onError: handleError,
  });

  // Start periodic status sync to catch processes that die unexpectedly
  if (statusSyncTimer) {
    clearInterval(statusSyncTimer);
  }
  statusSyncTimer = setInterval(() => {
    syncAllAgentStatus();
  }, STATUS_SYNC_INTERVAL);

  log.log(' Initialized with periodic status sync');
}

export async function shutdown(): Promise<void> {
  if (statusSyncTimer) {
    clearInterval(statusSyncTimer);
    statusSyncTimer = null;
  }
  if (runner) {
    await runner.stopAll();
  }
}

// ============================================================================
// Event System
// ============================================================================

export function on<K extends keyof ClaudeServiceEvents>(
  event: K,
  listener: ClaudeServiceEvents[K]
): void {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event)!.add(listener);
}

export function off<K extends keyof ClaudeServiceEvents>(
  event: K,
  listener: ClaudeServiceEvents[K]
): void {
  eventListeners.get(event)?.delete(listener);
}

function emit<K extends keyof ClaudeServiceEvents>(
  event: K,
  ...args: Parameters<ClaudeServiceEvents[K]>
): void {
  const listeners = eventListeners.get(event);
  if (listeners) {
    listeners.forEach((listener) => (listener as Function)(...args));
  }
}

// ============================================================================
// Runner Callbacks
// ============================================================================

function handleEvent(agentId: string, event: StandardEvent): void {
  const agent = agentService.getAgent(agentId);
  if (!agent) {
    log.log(` handleEvent: agent ${agentId} not found, ignoring event ${event.type}`);
    return;
  }

  log.log(` handleEvent: agent=${agentId}, event.type=${event.type}, current status=${agent.status}`);

  switch (event.type) {
    case 'init':
      if (agent.status !== 'working') {
        log.log(`🟢 [${agent.name}] status: ${agent.status} → working (init event)`);
      }
      agentService.updateAgent(agentId, { status: 'working' });
      break;

    case 'tool_start':
      log.log(` Agent ${agentId} tool_start: toolName=${event.toolName}`);
      if (agent.status !== 'working') {
        log.log(`🟢 [${agent.name}] status: ${agent.status} → working (tool_start)`);
      }
      agentService.updateAgent(agentId, {
        status: 'working',
        currentTool: event.toolName,
      });
      break;

    case 'tool_result':
      agentService.updateAgent(agentId, { currentTool: undefined });
      break;

    case 'step_complete':
      // step_complete (result event) signals Claude finished processing this turn
      // Update tokens and context usage
      log.log(` Agent ${agentId} received step_complete event, tokens:`, event.tokens, 'modelUsage:', event.modelUsage);

      // Calculate actual context window usage from cache tokens
      // The context window contains: cached system prompt + conversation history + new input + output
      // cacheRead = tokens read from cache (system prompt, conversation history)
      // cacheCreation = new tokens being added to cache
      // input = new user input tokens (often 0 when using cache)
      // output = response tokens
      let contextUsed = agent.contextUsed || 0;
      let contextLimit = agent.contextLimit || 200000;

      if (event.modelUsage) {
        // Use modelUsage data which has the most accurate context window info
        const cacheRead = event.modelUsage.cacheReadInputTokens || 0;
        const cacheCreation = event.modelUsage.cacheCreationInputTokens || 0;
        const inputTokens = event.modelUsage.inputTokens || 0;
        const outputTokens = event.modelUsage.outputTokens || 0;
        const contextWindow = event.modelUsage.contextWindow || 200000;

        // Context used = everything in the context window
        // This is the actual snapshot of what's loaded, not accumulated over time
        contextUsed = cacheRead + cacheCreation + inputTokens + outputTokens;
        contextLimit = contextWindow;

        log.log(` Agent ${agentId} context calculation from modelUsage: cacheRead=${cacheRead}, cacheCreation=${cacheCreation}, input=${inputTokens}, output=${outputTokens}, contextUsed=${contextUsed}, contextLimit=${contextLimit}`);
      } else if (event.tokens) {
        // Fallback: use tokens data
        const cacheRead = event.tokens.cacheRead || 0;
        const cacheCreation = event.tokens.cacheCreation || 0;
        const inputTokens = event.tokens.input || 0;
        const outputTokens = event.tokens.output || 0;

        // Context used = everything in the context window
        contextUsed = cacheRead + cacheCreation + inputTokens + outputTokens;

        log.log(` Agent ${agentId} context calculation from tokens: cacheRead=${cacheRead}, cacheCreation=${cacheCreation}, input=${inputTokens}, output=${outputTokens}, contextUsed=${contextUsed}`);
      }

      // Update tokensUsed as cumulative (for cost tracking), contextUsed as snapshot
      const newTokensUsed = (agent.tokensUsed || 0) + (event.tokens?.input || 0) + (event.tokens?.output || 0);

      agentService.updateAgent(agentId, {
        tokensUsed: newTokensUsed,
        contextUsed,
        contextLimit,
        // Note: contextStats is populated separately via /context command parsing
      });

      // Set to idle
      log.log(`🔴 [${agent.name}] status: ${agent.status} → idle (step_complete)`);
      const updated = agentService.updateAgent(agentId, {
        status: 'idle',
        currentTask: undefined,
        currentTool: undefined,
      });
      log.log(` Agent ${agentId} after update: status=${updated?.status}, contextUsed=${updated?.contextUsed}, contextLimit=${updated?.contextLimit}`);

      // Auto-refresh context stats after turn completion (with delay to ensure idle state)
      // Skip if:
      // - This agent is already doing a /context refresh (to avoid infinite loop)
      // - The last assigned task was a /context command (user already ran it)
      const lastTask = agent.lastAssignedTask?.trim() || '';
      const isContextCommand = lastTask === '/context' || lastTask === '/cost' || lastTask === '/compact';

      if (agent.sessionId && !pendingContextRefresh.has(agentId) && !isContextCommand) {
        setTimeout(() => {
          const currentAgent = agentService.getAgent(agentId);
          if (currentAgent?.status === 'idle' && !pendingContextRefresh.has(agentId)) {
            log.log(` Auto-refreshing context stats for ${agent.name} after turn completion`);
            pendingContextRefresh.add(agentId);
            import('./claude-service.js').then(({ sendCommand }) => {
              sendCommand(agentId, '/context')
                .catch(err => {
                  log.error(` Failed to auto-refresh context for ${agent.name}:`, err);
                })
                .finally(() => {
                  // Clear the flag after a delay to allow the response to be processed
                  setTimeout(() => pendingContextRefresh.delete(agentId), 2000);
                });
            });
          }
        }, 500);
      }
      break;

    case 'error':
      log.log(`❌ [${agent.name}] status: ${agent.status} → error`);
      agentService.updateAgent(agentId, { status: 'error' });
      break;

    case 'context_stats':
      // Parse /context command output and update agent's context stats
      if (event.contextStatsRaw) {
        log.log(` Agent ${agentId} received context_stats event`);
        const contextStats = parseContextOutput(event.contextStatsRaw);
        if (contextStats) {
          log.log(` Agent ${agentId} parsed context stats: model=${contextStats.model}, used=${contextStats.usedPercent}%`);
          agentService.updateAgent(agentId, {
            contextStats,
            contextUsed: contextStats.totalTokens,
            contextLimit: contextStats.contextWindow,
          });
        } else {
          log.log(` Agent ${agentId} failed to parse context stats`);
        }
      }
      break;
  }

  // Generate human-readable narrative for supervisor
  supervisorService.generateNarrative(agentId, event);

  emit('event', agentId, event);
}

function handleOutput(agentId: string, text: string, isStreaming?: boolean): void {
  emit('output', agentId, text, isStreaming);
}

function handleSessionId(agentId: string, sessionId: string): void {
  log.log(` Agent ${agentId} got session ID: ${sessionId}`);
  agentService.updateAgent(agentId, { sessionId });
}

function handleComplete(agentId: string, success: boolean): void {
  const agent = agentService.getAgent(agentId);
  const agentName = agent?.name || agentId;
  const prevStatus = agent?.status || 'unknown';

  log.log(`${success ? '✅' : '🔴'} [${agentName}] status: ${prevStatus} → idle (process ${success ? 'completed' : 'failed'})`);

  // Process completed, set to idle
  agentService.updateAgent(agentId, {
    status: 'idle',
    currentTask: undefined,
    currentTool: undefined,
  });

  emit('complete', agentId, success);
}

function handleError(agentId: string, error: string): void {
  const agent = agentService.getAgent(agentId);
  const agentName = agent?.name || agentId;
  const prevStatus = agent?.status || 'unknown';

  log.error(`❌ [${agentName}] status: ${prevStatus} → error: ${error}`);
  agentService.updateAgent(agentId, { status: 'error' });
  emit('error', agentId, error);
}

// ============================================================================
// Command Execution
// ============================================================================

// Custom agent config type
interface CustomAgentConfig {
  name: string;
  definition: CustomAgentDefinition;
}

// Internal function to actually execute a command
// forceNewSession: when true, don't resume existing session (for boss team questions)
// customAgent: optional custom agent config for --agents flag (used for custom class instructions)
async function executeCommand(agentId: string, command: string, systemPrompt?: string, forceNewSession?: boolean, customAgent?: CustomAgentConfig): Promise<void> {
  if (!runner) {
    throw new Error('ClaudeService not initialized');
  }

  const agent = agentService.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  log.log(` Executing command for ${agentId}: ${command.substring(0, 50)}...`);
  if (forceNewSession) {
    log.log(` Force new session mode - not resuming existing session`);
  }
  if (customAgent) {
    log.log(` Using custom agent "${customAgent.name}" for this session`);
  }

  // Notify that command is starting (so client can show user prompt in conversation)
  notifyCommandStarted(agentId, command);

  const prevStatus = agent.status;
  log.log(`🟢 [${agent.name}] status: ${prevStatus} → working (command started)`);

  const updated = agentService.updateAgent(agentId, {
    status: 'working',
    currentTask: command.substring(0, 100),
    lastAssignedTask: command, // Store full command for supervisor context
    lastAssignedTaskTime: Date.now(),
  });

  await runner.run({
    agentId,
    prompt: command,
    workingDir: agent.cwd,
    sessionId: agent.sessionId,
    useChrome: agent.useChrome,
    permissionMode: agent.permissionMode,
    systemPrompt,
    customAgent,
    forceNewSession,
  });
}

// Public function to send a command - sends directly to running process if busy
// This allows users to send messages while Claude is working - Claude will see them in stdin
// systemPrompt is only used when starting a new process (not for messages to running process)
// forceNewSession: when true, don't resume existing session (for boss team questions with context)
// customAgent: optional custom agent config for --agents flag (used for custom class instructions)
export async function sendCommand(agentId: string, command: string, systemPrompt?: string, forceNewSession?: boolean, customAgent?: CustomAgentConfig): Promise<void> {
  if (!runner) {
    throw new Error('ClaudeService not initialized');
  }

  const agent = agentService.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Check if agent is currently busy (has a running process)
  // If busy, send the message directly to the running process via stdin
  // Claude will process it as part of its current turn - no interruption needed
  // Note: customAgent config only applies when starting a new process
  if (runner.isRunning(agentId) && !forceNewSession) {
    log.log(` Agent ${agentId} is busy, sending message directly to running process...`);

    // Send directly to the running process via stdin
    const sent = runner.sendMessage(agentId, command);
    if (sent) {
      log.log(` Sent message to running process for ${agentId}: ${command.substring(0, 50)}...`);
      notifyCommandStarted(agentId, command);
      agentService.updateAgent(agentId, {
        taskCount: (agent.taskCount || 0) + 1,
        lastAssignedTask: command,
        lastAssignedTaskTime: Date.now(),
      });
      return;
    }
    // If sending failed (process died), fall through to start new process
    log.log(` Failed to send to running process, starting new process for ${agentId}`);
  }

  // Increment task counter for this agent
  agentService.updateAgent(agentId, { taskCount: (agent.taskCount || 0) + 1 });

  // Agent is idle, sending failed, or we need special options - execute with new process
  await executeCommand(agentId, command, systemPrompt, forceNewSession, customAgent);
}

export async function stopAgent(agentId: string): Promise<void> {
  const agent = agentService.getAgent(agentId);
  const agentName = agent?.name || agentId;
  const prevStatus = agent?.status || 'unknown';

  log.log(`🛑 [STOP REQUEST] Agent ${agentName} (${agentId}): Stop requested, current status=${prevStatus}`);

  if (!runner) {
    log.log(`🛑 [STOP REQUEST] Agent ${agentName}: Runner not initialized, cannot stop`);
    return;
  }

  await runner.stop(agentId);
  log.log(`🛑 [STOP REQUEST] Agent ${agentName}: Stop sequence initiated`);
}

export function isAgentRunning(agentId: string): boolean {
  return runner?.isRunning(agentId) ?? false;
}

/**
 * Check if a tmux session exists and has an active Claude process running
 * This detects "orphaned" sessions where Claude is running but we're not tracking it
 */
function checkTmuxHasClaudeProcess(tmuxSession: string): boolean {
  try {
    // Check if tmux session exists
    execSync(`tmux has-session -t ${tmuxSession} 2>/dev/null`, { encoding: 'utf8' });

    // Get the pane PID from the tmux session
    const panePid = execSync(`tmux list-panes -t ${tmuxSession} -F '#{pane_pid}' 2>/dev/null`, {
      encoding: 'utf8',
      timeout: 2000,
    }).trim();

    if (!panePid) return false;

    // Check if there's a claude process under that pane PID
    // Use pgrep to find claude processes with the pane PID as ancestor
    try {
      execSync(`pgrep -P ${panePid} -f claude 2>/dev/null || pstree -p ${panePid} 2>/dev/null | grep -q claude`, {
        encoding: 'utf8',
        timeout: 2000,
      });
      return true;
    } catch {
      // No claude process found
      return false;
    }
  } catch {
    // tmux session doesn't exist or error occurred
    return false;
  }
}

/**
 * Sync agent status with actual process state and session activity
 * Called on startup and client reconnection to ensure UI shows correct status
 *
 * The rules are:
 * 1. If we're tracking the process -> trust the current status
 * 2. If agent shows 'working' but no tracked process AND session is not active -> set to idle
 * 3. If agent shows 'idle' but session is RECENTLY active (< 30s) with pending work -> set to working
 *    (This handles server restart while Claude was processing)
 * 4. If agent shows 'idle' but tmux session has active Claude process -> set to orphaned
 *    (This handles out-of-sync state where Claude is running but we lost track)
 */
export async function syncAgentStatus(agentId: string): Promise<void> {
  const agent = agentService.getAgent(agentId);
  if (!agent) return;

  // Check 1: Is our runner tracking this process?
  const isTrackedProcess = runner?.isRunning(agentId) ?? false;

  // If we're tracking the process, trust the current status - no need to sync
  if (isTrackedProcess) {
    return;
  }

  // Check 2: Session file activity - is there recent pending work?
  let isRecentlyActive = false;
  let hasPendingWork = false;

  if (agent.sessionId && agent.cwd) {
    try {
      // Use 30 second threshold - if Claude was actively working, session would be very recent
      const activity = await getSessionActivityStatus(agent.cwd, agent.sessionId, 30);
      if (activity) {
        isRecentlyActive = activity.isActive; // Modified within 30s AND has pending work
        hasPendingWork = activity.hasPendingWork;
      }
    } catch {
      // Ignore errors
    }
  }

  // Check 3: Does the tmux session have an active Claude process?
  const hasOrphanedProcess = checkTmuxHasClaudeProcess(agent.tmuxSession);

  // Case 1: Agent shows 'working' but no tracked process and not recently active -> set to idle
  if (agent.status === 'working' && !isRecentlyActive && !hasOrphanedProcess) {
    log.log(`🔴 [${agent.name}] status: working → idle (no process, not recently active)`);
    agentService.updateAgent(agentId, {
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
    });
  }
  // Case 2: Agent shows 'idle' but session is recently active with pending work -> set to working
  // This handles server restart while Claude was processing
  else if (agent.status === 'idle' && isRecentlyActive) {
    log.log(`🟢 [${agent.name}] status: idle → working (session recently active)`);
    agentService.updateAgent(agentId, {
      status: 'working',
      currentTask: 'Processing...',
    });
  }
  // Case 3: Agent shows 'idle' but tmux session has active Claude process -> set to orphaned
  // This handles out-of-sync state where Claude is running but we lost track of it
  else if ((agent.status === 'idle' || agent.status === 'error') && hasOrphanedProcess) {
    log.log(`⚠️ [${agent.name}] status: ${agent.status} → orphaned (tmux has active Claude process)`);
    agentService.updateAgent(agentId, {
      status: 'orphaned',
      currentTask: 'Orphaned process detected',
    });
  }
  // Case 4: Agent shows 'orphaned' but no longer has an orphaned process -> set back to idle
  else if (agent.status === 'orphaned' && !hasOrphanedProcess) {
    log.log(`🔄 [${agent.name}] status: orphaned → idle (process ended)`);
    agentService.updateAgent(agentId, {
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
    });
  }
}

/**
 * Sync all agents' status with actual process state and session activity
 */
export async function syncAllAgentStatus(): Promise<void> {
  const agents = agentService.getAllAgents();
  await Promise.all(agents.map(agent => syncAgentStatus(agent.id)));
  log.log(` Synced status for ${agents.length} agents`);
}
