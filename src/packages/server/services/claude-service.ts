/**
 * Claude Service
 * Manages Claude Code runner and command execution
 */

import { ClaudeRunner, StandardEvent } from '../claude/index.js';
import { parseContextOutput, parseUsageOutput } from '../claude/backend.js';
import { getSessionActivityStatus, isClaudeProcessRunningInCwd } from '../claude/session-loader.js';
import type { CustomAgentDefinition } from '../claude/types.js';
import * as agentService from './agent-service.js';
import * as supervisorService from './supervisor-service.js';
import { loadRunningProcesses, isProcessRunning } from '../data/index.js';
import { logger } from '../utils/logger.js';

const log = logger.claude;

// Event types emitted by Claude service
export interface ClaudeServiceEvents {
  event: (agentId: string, event: StandardEvent) => void;
  output: (agentId: string, text: string, isStreaming?: boolean, subagentName?: string, uuid?: string, toolMeta?: { toolName?: string; toolInput?: Record<string, unknown> }) => void;
  complete: (agentId: string, success: boolean) => void;
  error: (agentId: string, error: string) => void;
}

// Event listeners
type EventListener<K extends keyof ClaudeServiceEvents> = ClaudeServiceEvents[K];
const eventListeners = new Map<keyof ClaudeServiceEvents, Set<EventListener<any>>>();

// Claude Runner instance
let runner: ClaudeRunner | null = null;

// Track agents with pending silent /context refresh to prevent recursive loops
// When sendSilentCommand sends /context, the agentId is added here
// When step_complete fires, we check this set to avoid triggering another /context
const pendingSilentContextRefresh = new Set<string>();

// ============================================================================
// Subagent Tracking (Task tool spawned subagents)
// ============================================================================

// Map: toolUseId -> subagent info (tracks active Task tool subagents)
interface ActiveSubagent {
  id: string;
  parentAgentId: string;
  toolUseId: string;
  name: string;
  description: string;
  subagentType: string;
  model?: string;
  startedAt: number;
}
const activeSubagents = new Map<string, ActiveSubagent>();

// Reverse lookup: subagentId -> toolUseId
const subagentIdToToolUseId = new Map<string, string>();

let subagentCounter = 0;
function generateSubagentId(): string {
  return `sub_${Date.now().toString(36)}_${(subagentCounter++).toString(36)}`;
}

// Track agents that received step_complete for their current turn
// This is used to avoid duplicate /context refresh in handleComplete
// Set in step_complete handler, cleared in handleComplete
const stepCompleteReceived = new Set<string>();

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

// Interval for polling orphaned agents (10 seconds)
const ORPHAN_POLL_INTERVAL = 10000;
let orphanPollTimer: NodeJS.Timeout | null = null;

// Callback for broadcasting session updates to clients
let sessionUpdateCallback: ((agentId: string) => void) | null = null;

export function setSessionUpdateCallback(callback: (agentId: string) => void): void {
  sessionUpdateCallback = callback;
}

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

  // Start polling for orphaned agents with active sessions
  if (orphanPollTimer) {
    clearInterval(orphanPollTimer);
  }
  orphanPollTimer = setInterval(() => {
    pollOrphanedAgents();
  }, ORPHAN_POLL_INTERVAL);

  log.log(' Initialized with periodic status sync and orphan polling');
}

/**
 * Shutdown the Claude service
 * @param killProcesses - If true, kill all running Claude processes.
 *                        If false (default), processes continue running independently.
 *                        Set to true for clean shutdown, false for commander restart/crash recovery.
 */
export async function shutdown(): Promise<void> {
  if (statusSyncTimer) {
    clearInterval(statusSyncTimer);
    statusSyncTimer = null;
  }
  if (orphanPollTimer) {
    clearInterval(orphanPollTimer);
    orphanPollTimer = null;
  }
  if (runner) {
    await runner.stopAll();
  }
}

/**
 * Poll orphaned agents (those with 'working' status but no tracked process)
 * to check if their session files have been updated, indicating the detached
 * Claude process is still active.
 */
async function pollOrphanedAgents(): Promise<void> {
  const agents = agentService.getAllAgents();

  for (const agent of agents) {
    // Only poll agents that are marked as working but we're not tracking their process
    if (agent.status !== 'working') continue;

    const isTracked = runner?.isRunning(agent.id) ?? false;
    if (isTracked) continue;

    // This is an orphaned working agent - check its session activity
    if (!agent.sessionId || !agent.cwd) continue;

    try {
      const activity = await getSessionActivityStatus(agent.cwd, agent.sessionId, 60);

      if (activity && activity.isActive) {
        // Session file was updated recently - the orphaned process is still working
        // Notify clients to refresh the history for this agent
        if (sessionUpdateCallback) {
          sessionUpdateCallback(agent.id);
        }
      } else if (activity && !activity.isActive) {
        // Session file hasn't been updated in 60+ seconds - process likely finished
        // Check if there's still an orphaned process running
        const hasOrphanedProcess = await isClaudeProcessRunningInCwd(agent.cwd);

        if (!hasOrphanedProcess) {
          // No orphaned process and no recent activity - mark as idle
          log.log(`Orphaned agent ${agent.id} has no activity - marking as idle`);
          agentService.updateAgent(agent.id, {
            status: 'idle',
            currentTask: undefined,
            currentTool: undefined,
            isDetached: false,
          });
        }
      }
    } catch (err) {
      // Failed to check session activity, skip this agent
      log.error(`Failed to poll orphaned agent ${agent.id}:`, err);
    }
  }
}

// ============================================================================
// Subagent Public API
// ============================================================================

/** Get an active subagent by toolUseId */
export function getActiveSubagentByToolUseId(toolUseId: string): ActiveSubagent | undefined {
  return activeSubagents.get(toolUseId);
}

/** Get all active subagents for a parent agent */
export function getActiveSubagentsForAgent(parentAgentId: string): ActiveSubagent[] {
  return Array.from(activeSubagents.values()).filter(s => s.parentAgentId === parentAgentId);
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
  const listenerCount = listeners?.size || 0;

  // Debug log for event emissions
  if (event === 'event') {
    const standardEvent = args[1] as any;
    log.log(`[EMIT] event: type=${standardEvent?.type} tool=${standardEvent?.toolName || 'n/a'} listeners=${listenerCount}`);
  }

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
    return;
  }

  switch (event.type) {
    case 'init':
      agentService.updateAgent(agentId, { status: 'working' });
      break;

    case 'tool_start':
      agentService.updateAgent(agentId, {
        status: 'working',
        currentTool: event.toolName,
      });
      // Track Task tool subagent spawning
      if (event.toolName === 'Task' && event.toolUseId && event.subagentName) {
        const subId = generateSubagentId();
        const subagent: ActiveSubagent = {
          id: subId,
          parentAgentId: agentId,
          toolUseId: event.toolUseId,
          name: event.subagentName,
          description: event.subagentDescription || '',
          subagentType: event.subagentType || 'general-purpose',
          model: event.subagentModel,
          startedAt: Date.now(),
        };
        activeSubagents.set(event.toolUseId, subagent);
        subagentIdToToolUseId.set(subId, event.toolUseId);
        log.log(`[Subagent] Started: ${subagent.name} (${subId}) for agent ${agentId}, toolUseId=${event.toolUseId}`);
        // Emit subagent_started event for websocket handler to broadcast
        emit('event', agentId, {
          ...event,
          type: 'tool_start',
          // Attach subagent info so handler can create the Subagent object
        });
      }
      break;

    case 'tool_result':
      // Check if this is a Task tool result (subagent completion)
      if (event.toolName === 'Task' && event.toolUseId) {
        const subagent = activeSubagents.get(event.toolUseId);
        if (subagent) {
          log.log(`[Subagent] Completed: ${subagent.name} (${subagent.id}) for agent ${agentId}`);
          // Attach subagent name to the event BEFORE cleaning up so websocket handler can use it
          event.subagentName = subagent.name;
          // Clean up
          activeSubagents.delete(event.toolUseId);
          subagentIdToToolUseId.delete(subagent.id);
        }
      }
      agentService.updateAgent(agentId, { currentTool: undefined });
      break;

    case 'step_complete': {
      // Mark that step_complete was received for this agent's turn
      // This prevents duplicate /context refresh in handleComplete
      stepCompleteReceived.add(agentId);

      // step_complete (result event) signals Claude finished processing this turn
      // Calculate actual context window usage from cache tokens
      let contextUsed = agent.contextUsed || 0;
      let contextLimit = agent.contextLimit || 200000;

      if (event.modelUsage) {
        const cacheRead = event.modelUsage.cacheReadInputTokens || 0;
        const cacheCreation = event.modelUsage.cacheCreationInputTokens || 0;
        const inputTokens = event.modelUsage.inputTokens || 0;
        const outputTokens = event.modelUsage.outputTokens || 0;
        contextUsed = cacheRead + cacheCreation + inputTokens + outputTokens;
        contextLimit = event.modelUsage.contextWindow || 200000;
      } else if (event.tokens) {
        const cacheRead = event.tokens.cacheRead || 0;
        const cacheCreation = event.tokens.cacheCreation || 0;
        const inputTokens = event.tokens.input || 0;
        const outputTokens = event.tokens.output || 0;
        contextUsed = cacheRead + cacheCreation + inputTokens + outputTokens;
      }

      const newTokensUsed = (agent.tokensUsed || 0) + (event.tokens?.input || 0) + (event.tokens?.output || 0);

      agentService.updateAgent(agentId, {
        tokensUsed: newTokensUsed,
        contextUsed,
        contextLimit,
      });

      // Delay setting to idle to ensure output messages are sent to clients first
      // This fixes a race condition where the status change could arrive before the final output
      // Using 200ms to ensure all output messages have time to be broadcast
      setTimeout(() => {
        log.log(`[step_complete] Setting status to idle for agent ${agentId} (lastTask: ${agent.lastAssignedTask})`);
        agentService.updateAgent(agentId, {
          status: 'idle',
          currentTask: undefined,
          currentTool: undefined,
        });
      }, 200);

      // Auto-refresh context stats after turn completion
      // Skip if:
      // 1. The last assigned task was a /context command (user already ran it)
      // 2. There's already a pending silent /context refresh for this agent
      const lastTask = agent.lastAssignedTask?.trim() || '';
      const isContextCommand = lastTask === '/context' || lastTask === '/cost' || lastTask === '/compact';
      const hasPendingSilentRefresh = pendingSilentContextRefresh.has(agentId);

      log.log(`[step_complete] Auto-refresh check: agentId=${agentId}, lastTask="${lastTask}", isContextCmd=${isContextCommand}, hasPending=${hasPendingSilentRefresh}`);

      // Clear the pending flag since step_complete means the command finished
      pendingSilentContextRefresh.delete(agentId);

      // Re-fetch agent to get latest sessionId (may have been set by handleSessionId after initial fetch)
      const currentAgent = agentService.getAgent(agentId);
      const hasSession = !!currentAgent?.sessionId;
      const shouldRefresh = hasSession && !isContextCommand && !hasPendingSilentRefresh;

      log.log(`[step_complete] sessionId=${currentAgent?.sessionId}, shouldRefresh=${shouldRefresh}`);

      if (shouldRefresh) {
        // Small delay to let the process settle
        setTimeout(() => {
          log.log(`[step_complete] Sending silent /context for agent ${agentId}`);
          // Send /context to the running process or spawn new one
          import('./claude-service.js').then(({ sendSilentCommand }) => {
            sendSilentCommand(agentId, '/context').catch((err) => {
              log.log(`[step_complete] Silent /context failed for ${agentId}: ${err}`);
            });
          });
        }, 300);
      }
      break;
    }

    case 'error':
      agentService.updateAgent(agentId, { status: 'error' });
      break;

    case 'context_stats':
      // Context stats are parsed and broadcast in websocket/handler.ts
      // This event just flows through to the handler which does:
      // 1. Parse contextStatsRaw into ContextStats
      // 2. Update agent with contextStats
      // 3. Broadcast to all clients via WebSocket
      break;

    case 'usage_stats':
      console.log('[Claude] Received usage_stats event');
      console.log('[Claude] usageStatsRaw:', event.usageStatsRaw?.substring(0, 200));
      if (event.usageStatsRaw) {
        const usageStats = parseUsageOutput(event.usageStatsRaw);
        console.log('[Claude] Parsed usage stats:', usageStats);
        if (usageStats) {
          // Store in supervisor service for global access
          supervisorService.updateGlobalUsage(agentId, agent.name, usageStats);
        } else {
          console.log('[Claude] Failed to parse usage stats');
        }
      } else {
        console.log('[Claude] No usageStatsRaw in event');
      }
      break;
  }

  // Generate human-readable narrative for supervisor
  supervisorService.generateNarrative(agentId, event);

  emit('event', agentId, event);
}

function handleOutput(agentId: string, text: string, isStreaming?: boolean, subagentName?: string, uuid?: string, toolMeta?: { toolName?: string; toolInput?: Record<string, unknown> }): void {
  emit('output', agentId, text, isStreaming, subagentName, uuid, toolMeta);
}

function handleSessionId(agentId: string, sessionId: string): void {
  const agent = agentService.getAgent(agentId);
  const existingSessionId = agent?.sessionId;

  if (!existingSessionId) {
    agentService.updateAgent(agentId, { sessionId });
  } else if (existingSessionId !== sessionId) {
    // Claude returned a different session ID - resume failed, keep original
    log.log(`Session mismatch for ${agentId}: expected ${existingSessionId}, got ${sessionId}`);
  }
}

function handleComplete(agentId: string, success: boolean): void {
  const receivedStepComplete = stepCompleteReceived.has(agentId);
  stepCompleteReceived.delete(agentId);

  agentService.updateAgent(agentId, {
    status: 'idle',
    currentTask: undefined,
    currentTool: undefined,
    isDetached: false,
  });
  emit('complete', agentId, success);

  // Fallback: trigger /context refresh if step_complete wasn't received
  // This handles edge cases where the process exits without emitting a result event
  // (e.g., when the last response is a tool use that doesn't complete normally)
  if (!receivedStepComplete && success) {
    const agent = agentService.getAgent(agentId);
    const lastTask = agent?.lastAssignedTask?.trim() || '';
    const isContextCommand = lastTask === '/context' || lastTask === '/cost' || lastTask === '/compact';
    const hasSession = !!agent?.sessionId;
    const hasPendingSilentRefresh = pendingSilentContextRefresh.has(agentId);

    log.log(`[handleComplete] Fallback /context check: agentId=${agentId}, receivedStepComplete=${receivedStepComplete}, lastTask="${lastTask}", isContextCmd=${isContextCommand}, hasSession=${hasSession}, hasPending=${hasPendingSilentRefresh}`);

    if (hasSession && !isContextCommand && !hasPendingSilentRefresh) {
      log.log(`[handleComplete] Triggering fallback /context refresh for agent ${agentId}`);
      setTimeout(() => {
        import('./claude-service.js').then(({ sendSilentCommand }) => {
          sendSilentCommand(agentId, '/context').catch((err) => {
            log.log(`[handleComplete] Fallback /context failed for ${agentId}: ${err}`);
          });
        });
      }, 300);
    }
  }
}

function handleError(agentId: string, error: string): void {
  const agent = agentService.getAgent(agentId);
  const timestamp = new Date().toISOString();

  log.error(`❌ [ERROR] Agent ${agent?.name || agentId} (${agentId})`);
  log.error(`   Time: ${timestamp}`);
  log.error(`   Message: ${error}`);
  log.error(`   Status before: ${agent?.status}`);
  log.error(`   Last task: ${agent?.lastAssignedTask}`);
  log.error(`   Current tool: ${agent?.currentTool}`);
  log.error(`   Session ID: ${agent?.sessionId}`);

  agentService.updateAgent(agentId, {
    status: 'error',
    currentTask: undefined,
    currentTool: undefined,
  });
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
// silent: when true, don't update agent status to 'working' (used for internal commands like /context refresh)
async function executeCommand(agentId: string, command: string, systemPrompt?: string, forceNewSession?: boolean, customAgent?: CustomAgentConfig, silent?: boolean): Promise<void> {
  if (!runner) {
    throw new Error('ClaudeService not initialized');
  }

  const agent = agentService.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Notify that command is starting (so client can show user prompt in conversation)
  // Skip notification for silent commands (internal operations)
  if (!silent) {
    notifyCommandStarted(agentId, command);
  }

  // Don't update lastAssignedTask for system messages (like auto-resume) to avoid recursive loops
  // Don't update status for silent commands (internal operations like /context refresh)
  const isSystemMessage = command.startsWith('[System:');

  const updateData: Partial<Parameters<typeof agentService.updateAgent>[1]> = {};

  // Only update status/UI fields for non-silent commands
  if (!silent) {
    updateData.status = 'working' as const;
    updateData.currentTask = command.substring(0, 100);
    updateData.isDetached = false; // Agent is now attached since we're executing a command
  }

  // ALWAYS update lastAssignedTask for non-system messages (needed for context recalc recursion detection)
  // This must happen even for silent commands so that the next step_complete knows what was sent
  if (!isSystemMessage) {
    updateData.lastAssignedTask = command;
    updateData.lastAssignedTaskTime = Date.now();
  }

  // Only update agent if there are changes
  if (Object.keys(updateData).length > 0) {
    agentService.updateAgent(agentId, updateData);
  }

  await runner.run({
    agentId,
    prompt: command,
    workingDir: agent.cwd,
    sessionId: agent.sessionId,
    model: agent.model,
    useChrome: agent.useChrome,
    permissionMode: agent.permissionMode,
    systemPrompt,
    customAgent,
    forceNewSession,
  });
}

// Timeout for stdin message watchdog (10 seconds)
const STDIN_ACTIVITY_TIMEOUT_MS = 10000;

// Track active stdin watchdog timers to prevent duplicates
const stdinWatchdogTimers = new Map<string, NodeJS.Timeout>();

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
  if (runner.isRunning(agentId) && !forceNewSession) {
    const sent = runner.sendMessage(agentId, command);
    if (sent) {
      notifyCommandStarted(agentId, command);
      const isSystemMessage = command.startsWith('[System:');
      const updateData: Record<string, unknown> = {
        taskCount: (agent.taskCount || 0) + 1,
      };
      if (!isSystemMessage) {
        updateData.lastAssignedTask = command;
        updateData.lastAssignedTaskTime = Date.now();
      }
      agentService.updateAgent(agentId, updateData);

      // Start stdin activity watchdog
      // If no activity is received within timeout, the process may be stuck
      // We'll respawn the process with the same command
      startStdinWatchdog(agentId, command, systemPrompt, customAgent);

      return;
    }
  }

  // Increment task counter for this agent
  agentService.updateAgent(agentId, { taskCount: (agent.taskCount || 0) + 1 });

  // If agent is detached, reattach by resuming the existing session
  // This allows the agent to pick up where it left off after server restart
  if (agent.isDetached && agent.sessionId && !forceNewSession) {
    log.log(`[sendCommand] Agent ${agentId} is detached, reattaching to existing session ${agent.sessionId}`);
    // Broadcast reattachment notification to UI immediately (non-blocking)
    setImmediate(() => {
      emit('output', agentId, `🔄 [System] Reattaching to existing session... (Session: ${agent.sessionId})`, false, undefined, 'system-reattach');
      emit('output', agentId, `📋 [System] Resuming task: ${command.substring(0, 100)}${command.length > 100 ? '...' : ''}`, false, undefined, 'system-reattach');
    });
    // Execute with existing session (forceNewSession=false means resume) - don't wait for UI notifications
    await executeCommand(agentId, command, systemPrompt, false, customAgent);
    return;
  }

  // Agent is idle, sending failed, or we need special options - execute with new process
  await executeCommand(agentId, command, systemPrompt, forceNewSession, customAgent);
}

/**
 * Start a watchdog timer for stdin messages
 * If no activity is received within the timeout, respawn the process
 */
function startStdinWatchdog(
  agentId: string,
  command: string,
  systemPrompt?: string,
  customAgent?: CustomAgentConfig
): void {
  if (!runner) return;

  // Clear any existing watchdog for this agent
  const existingTimer = stdinWatchdogTimers.get(agentId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  log.log(`[STDIN-WATCHDOG] Starting watchdog for ${agentId}, timeout=${STDIN_ACTIVITY_TIMEOUT_MS}ms`);

  // Create the watchdog timer
  const watchdogTimer = setTimeout(async () => {
    stdinWatchdogTimers.delete(agentId);

    // Check if we received any activity since sending the message
    if (runner && !runner.hasRecentActivity(agentId, STDIN_ACTIVITY_TIMEOUT_MS)) {
      log.warn(`[STDIN-WATCHDOG] Agent ${agentId}: No activity after stdin message, respawning process...`);

      // Stop the stuck process
      await runner.stop(agentId);

      // Respawn with the same command
      try {
        await executeCommand(agentId, command, systemPrompt, false, customAgent);
        log.log(`[STDIN-WATCHDOG] Agent ${agentId}: Successfully respawned process`);
      } catch (err) {
        log.error(`[STDIN-WATCHDOG] Agent ${agentId}: Failed to respawn process:`, err);
      }
    } else {
      log.log(`[STDIN-WATCHDOG] Agent ${agentId}: Activity received, watchdog cleared`);
    }
  }, STDIN_ACTIVITY_TIMEOUT_MS);

  stdinWatchdogTimers.set(agentId, watchdogTimer);

  // Register callback to clear the watchdog when activity is received
  runner.onNextActivity(agentId, () => {
    const timer = stdinWatchdogTimers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      stdinWatchdogTimers.delete(agentId);
      log.log(`[STDIN-WATCHDOG] Agent ${agentId}: Cleared watchdog on activity`);
    }
  });
}

/**
 * Send a silent command that doesn't update agent status
 * Used for internal operations like auto /context refresh
 *
 * IMPORTANT: This does NOT change the agent's visible status.
 * The agent will appear "idle" to the user while the silent command runs.
 * This prevents UI flickering when auto-refreshing context after step_complete.
 */
export async function sendSilentCommand(agentId: string, command: string): Promise<void> {
  if (!runner) {
    throw new Error('ClaudeService not initialized');
  }

  const agent = agentService.getAgent(agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }

  // Track /context commands to prevent recursive loops
  // When step_complete fires, it will check this set before auto-refreshing
  const isContextCommand = command.trim() === '/context' || command.trim() === '/cost' || command.trim() === '/compact';
  if (isContextCommand) {
    pendingSilentContextRefresh.add(agentId);
  }

  // If agent has a running process, send the command to it via stdin
  // This is the expected case for /context refresh after step_complete
  if (runner.isRunning(agentId)) {
    log.log(`[sendSilentCommand] Sending command via stdin for agent ${agentId} (command: ${command}) - status unchanged`);

    const sent = runner.sendMessage(agentId, command);
    if (sent) {
      log.log(`[sendSilentCommand] Command sent via stdin for agent ${agentId}`);
      return;
    }
    // If sendMessage failed, fall through to spawn new process
  }

  // Execute silently - no command notifications, no status changes
  log.log(`[sendSilentCommand] Spawning new process for silent command for agent ${agentId} (command: ${command}) - status unchanged`);
  await executeCommand(agentId, command, undefined, undefined, undefined, true);
}

export async function stopAgent(agentId: string): Promise<void> {
  // Try to stop the tracked process first
  if (runner) {
    await runner.stop(agentId);
  }

  // Also try to kill any detached Claude process for this agent
  const agent = agentService.getAgent(agentId);
  if (agent?.cwd) {
    const { killClaudeProcessInCwd } = await import('../claude/session-loader.js');
    const killed = await killClaudeProcessInCwd(agent.cwd);
    if (killed) {
      log.log(`Killed detached Claude process for agent ${agentId}`);
    }
  }

  // Update agent status to idle
  agentService.updateAgent(agentId, {
    status: 'idle',
    currentTask: undefined,
    currentTool: undefined,
    isDetached: false,
  });
}

export function isAgentRunning(agentId: string): boolean {
  return runner?.isRunning(agentId) ?? false;
}

/**
 * Check if there's an orphaned Claude process for this agent
 * Uses ONLY PID tracking - not general process discovery
 * (Process discovery is too aggressive and matches unrelated Claude sessions)
 */
function _checkForOrphanedProcess(agentId: string): boolean {
  try {
    // Check our persisted PID records - this is agent-specific
    const savedProcesses = loadRunningProcesses();
    const savedProcess = savedProcesses.find((p: { agentId: string }) => p.agentId === agentId);
    if (savedProcess && isProcessRunning(savedProcess.pid)) {
      return true;
    }

    return false;
  } catch {
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
 *    (This handles server restart while Claude was processing - ONLY during startup sync)
 *
 * @param agentId - The agent ID to sync
 * @param isStartupSync - If true, apply full recovery logic including reviving idle agents.
 *                        If false (periodic sync), only set stale working agents to idle.
 */
export async function syncAgentStatus(agentId: string, isStartupSync: boolean = false): Promise<void> {
  const agent = agentService.getAgent(agentId);
  if (!agent) return;

  // Check 1: Is our runner tracking this process?
  const isTrackedProcess = runner?.isRunning(agentId) ?? false;
  if (isTrackedProcess) return;

  // Check 2: Session file activity - is there recent pending work?
  let isRecentlyActive = false;
  let hasOrphanedProcess = false;

  if (agent.sessionId && agent.cwd) {
    try {
      // Use 60 second threshold for orphaned process detection
      const activity = await getSessionActivityStatus(agent.cwd, agent.sessionId, 60);
      if (activity) {
        isRecentlyActive = activity.isActive;
      }
    } catch {
      // Session activity check failed, assume not active
    }

    // Check 3: Is there an orphaned Claude process running in this cwd?
    // This detects processes that survived a server restart
    if (agent.status === 'idle') {
      try {
        hasOrphanedProcess = await isClaudeProcessRunningInCwd(agent.cwd);
        if (hasOrphanedProcess) {
          log.log(`[syncAgentStatus] Agent ${agentId}: Found orphaned process, isRecentlyActive=${isRecentlyActive}`);
        }
      } catch (err) {
        // Process detection failed, assume no orphaned process
        log.error(`[syncAgentStatus] Agent ${agentId}: Failed to check for orphaned process:`, err);
      }
    }
  }

  // Case 1: Agent shows 'working' but no tracked process and not recently active -> set to idle
  // This applies during both startup and periodic syncs
  if (agent.status === 'working' && !isRecentlyActive && !hasOrphanedProcess) {
    agentService.updateAgent(agentId, {
      status: 'idle',
      currentTask: undefined,
      currentTool: undefined,
      isDetached: false,
    });
  }
  // Case 2: Agent shows 'idle' but there's an orphaned process with recent session activity
  // Mark as working so the UI reflects the actual state
  else if (agent.status === 'idle' && hasOrphanedProcess && isRecentlyActive) {
    log.log(`Agent ${agentId} has orphaned Claude process with recent activity - marking as working (detached)`);
    agentService.updateAgent(agentId, {
      status: 'working',
      currentTask: 'Processing (detached)...',
      isDetached: true,
    });
  }
  // Case 3: Legacy startup sync behavior for agents without orphaned process detection
  else if (isStartupSync && agent.status === 'idle' && isRecentlyActive) {
    agentService.updateAgent(agentId, {
      status: 'working',
      currentTask: 'Processing...',
    });
  }
}

/**
 * Sync all agents' status with actual process state and session activity
 * @param isStartupSync - If true, apply full recovery logic including reviving idle agents.
 *                        If false (default, periodic sync), only set stale working agents to idle.
 */
export async function syncAllAgentStatus(isStartupSync: boolean = false): Promise<void> {
  const agents = agentService.getAllAgents();
  await Promise.all(agents.map(agent => syncAgentStatus(agent.id, isStartupSync)));
}

/**
 * Auto-resume agents that were working before server restart
 * Uses Claude's session persistence to continue where they left off
 */
export async function autoResumeWorkingAgents(): Promise<void> {
  const agentsToResume = agentService.getAgentsToResume();

  if (agentsToResume.length === 0) {
    return;
  }

  log.log(`🔄 Auto-resuming ${agentsToResume.length} agent(s)`);

  for (const agentInfo of agentsToResume) {
    try {
      const agent = agentService.getAgent(agentInfo.id);
      if (!agent) {
        continue;
      }

      // Don't resume if agent is already running somehow
      if (runner?.isRunning(agentInfo.id)) {
        continue;
      }

      // Build customAgentConfig using the same function as command-handler
      // This ensures agent ID is properly injected into the prompt
      const { buildCustomAgentConfig } = await import('../websocket/handlers/command-handler.js');
      const customAgentConfig = buildCustomAgentConfig(agentInfo.id, agent.class);

      // Send a continuation message to Claude
      const resumeMessage = `[System: The commander server was restarted while you were working. Please continue with your previous task. Your last assigned task was: "${agentInfo.lastTask}"]`;

      await sendCommand(agentInfo.id, resumeMessage, undefined, undefined, customAgentConfig);

      // Small delay between agents to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (err) {
      log.error(`Failed to auto-resume ${agentInfo.name}:`, err);
    }
  }

  // Clear the list after processing
  agentService.clearAgentsToResume();
}
