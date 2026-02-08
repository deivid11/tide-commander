/**
 * Runtime Service
 * Manages Claude/Codex runtime runners and command execution
 */

import { parseUsageOutput } from '../claude/backend.js';
import {
  isClaudeProcessRunningInCwd,
  isCodexProcessRunningInCwd,
  killClaudeProcessInCwd,
  killCodexProcessInCwd,
} from '../claude/session-loader.js';
import * as agentService from './agent-service.js';
import { loadRunningProcesses, isProcessRunning } from '../data/index.js';
import { logger } from '../utils/logger.js';
import {
  createClaudeRuntimeProvider,
  createCodexRuntimeProvider,
  type RuntimeProvider,
  type RuntimeRunner,
  type RuntimeEvent,
} from '../runtime/index.js';
import type { AgentProvider } from '../../shared/types.js';
import {
  createRuntimeCommandExecution,
  type CustomAgentConfig,
} from './runtime-command-execution.js';
import { createRuntimeEventHandlers } from './runtime-events.js';
import { createRuntimeStatusSync } from './runtime-status-sync.js';
import {
  getActiveSubagentByToolUseId as getTrackedSubagentByToolUseId,
  getActiveSubagentsForAgent as getTrackedSubagentsForAgent,
  type ActiveSubagent,
} from './runtime-subagents.js';

const log = logger.claude;

// Event types emitted by runtime service
export interface RuntimeServiceEvents {
  event: (agentId: string, event: RuntimeEvent) => void;
  output: (agentId: string, text: string, isStreaming?: boolean, subagentName?: string, uuid?: string, toolMeta?: { toolName?: string; toolInput?: Record<string, unknown> }) => void;
  complete: (agentId: string, success: boolean) => void;
  error: (agentId: string, error: string) => void;
}

// Backward-compatible alias while call sites migrate
export type ClaudeServiceEvents = RuntimeServiceEvents;

type EventListener<K extends keyof RuntimeServiceEvents> = RuntimeServiceEvents[K];
const eventListeners = new Map<keyof RuntimeServiceEvents, Set<EventListener<any>>>();

const runtimeProviders: Record<AgentProvider, RuntimeProvider> = {
  claude: createClaudeRuntimeProvider(),
  codex: createCodexRuntimeProvider(),
};
const runners = new Map<AgentProvider, RuntimeRunner>();

function getRunner(provider: AgentProvider): RuntimeRunner | null {
  return runners.get(provider) ?? null;
}

function getAgentProvider(agentId: string): AgentProvider {
  const agent = agentService.getAgent(agentId);
  return agent?.provider ?? 'claude';
}

function getRunnerForAgent(agentId: string): RuntimeRunner | null {
  return getRunner(getAgentProvider(agentId));
}

function isAnyRunnerActive(agentId: string): boolean {
  return Array.from(runners.values()).some((runner) => runner.isRunning(agentId));
}

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

// Callback for broadcasting session updates to clients
let sessionUpdateCallback: ((agentId: string) => void) | null = null;

export function setSessionUpdateCallback(callback: (agentId: string) => void): void {
  sessionUpdateCallback = callback;
}

async function isProviderProcessRunningInCwd(provider: AgentProvider, cwd: string): Promise<boolean> {
  if (provider === 'codex') {
    return isCodexProcessRunningInCwd(cwd);
  }
  return isClaudeProcessRunningInCwd(cwd);
}

async function killDetachedProviderProcessInCwd(provider: AgentProvider, cwd: string): Promise<boolean> {
  if (provider === 'codex') {
    return killCodexProcessInCwd(cwd);
  }
  return killClaudeProcessInCwd(cwd);
}

export function on<K extends keyof RuntimeServiceEvents>(
  event: K,
  listener: RuntimeServiceEvents[K]
): void {
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event)!.add(listener);
}

export function off<K extends keyof RuntimeServiceEvents>(
  event: K,
  listener: RuntimeServiceEvents[K]
): void {
  eventListeners.get(event)?.delete(listener);
}

function emit<K extends keyof RuntimeServiceEvents>(
  event: K,
  ...args: Parameters<RuntimeServiceEvents[K]>
): void {
  const listeners = eventListeners.get(event);
  const listenerCount = listeners?.size || 0;

  if (event === 'event') {
    const standardEvent = args[1] as any;
    log.log(`[EMIT] event: type=${standardEvent?.type} tool=${standardEvent?.toolName || 'n/a'} listeners=${listenerCount}`);
  }

  if (listeners) {
    listeners.forEach((listener) => (listener as Function)(...args));
  }
}

function scheduleSilentContextRefresh(agentId: string, reason: 'step_complete' | 'handle_complete'): void {
  setTimeout(() => {
    if (reason === 'step_complete') {
      log.log(`[step_complete] Sending silent /context for agent ${agentId}`);
    }
    if (reason === 'handle_complete') {
      log.log(`[handleComplete] Triggering fallback /context refresh for agent ${agentId}`);
    }
    sendSilentCommand(agentId, '/context').catch((err) => {
      if (reason === 'step_complete') {
        log.log(`[step_complete] Silent /context failed for ${agentId}: ${err}`);
      } else {
        log.log(`[handleComplete] Fallback /context failed for ${agentId}: ${err}`);
      }
    });
  }, 300);
}

const commandExecution = createRuntimeCommandExecution({
  log,
  getRunner,
  getRunnerForAgent,
  notifyCommandStarted,
  emitOutput: (agentId, text, isStreaming, subagentName, uuid) => {
    emit('output', agentId, text, isStreaming, subagentName, uuid);
  },
  killDetachedProviderProcessInCwd,
});

const runtimeEvents = createRuntimeEventHandlers({
  log,
  emitEvent: (agentId, event) => emit('event', agentId, event),
  emitOutput: (agentId, text, isStreaming, subagentName, uuid, toolMeta) => {
    emit('output', agentId, text, isStreaming, subagentName, uuid, toolMeta);
  },
  emitComplete: (agentId, success) => emit('complete', agentId, success),
  emitError: (agentId, error) => emit('error', agentId, error),
  parseUsageOutput: (raw) => parseUsageOutput(raw),
  executeCommand: (agentId, command, systemPrompt, forceNewSession) =>
    commandExecution.executeCommand(agentId, command, systemPrompt, forceNewSession),
  scheduleSilentContextRefresh,
});

const statusSync = createRuntimeStatusSync({
  log,
  getRunnerForAgent,
  isProviderProcessRunningInCwd,
  onSessionUpdate: (agentId) => {
    if (sessionUpdateCallback) {
      sessionUpdateCallback(agentId);
    }
  },
});

// Interval for periodic status sync (30 seconds)
const STATUS_SYNC_INTERVAL = 30000;
let statusSyncTimer: NodeJS.Timeout | null = null;

// Interval for polling orphaned agents (10 seconds)
const ORPHAN_POLL_INTERVAL = 10000;
let orphanPollTimer: NodeJS.Timeout | null = null;

export function init(): void {
  runners.set('claude', runtimeProviders.claude.createRunner({
    onEvent: runtimeEvents.handleEvent,
    onOutput: runtimeEvents.handleOutput,
    onSessionId: runtimeEvents.handleSessionId,
    onComplete: runtimeEvents.handleComplete,
    onError: runtimeEvents.handleError,
  }));
  runners.set('codex', runtimeProviders.codex.createRunner({
    onEvent: runtimeEvents.handleEvent,
    onOutput: runtimeEvents.handleOutput,
    onSessionId: runtimeEvents.handleSessionId,
    onComplete: runtimeEvents.handleComplete,
    onError: runtimeEvents.handleError,
  }));

  if (statusSyncTimer) {
    clearInterval(statusSyncTimer);
  }
  statusSyncTimer = setInterval(() => {
    syncAllAgentStatus();
  }, STATUS_SYNC_INTERVAL);

  if (orphanPollTimer) {
    clearInterval(orphanPollTimer);
  }
  orphanPollTimer = setInterval(() => {
    statusSync.pollOrphanedAgents();
  }, ORPHAN_POLL_INTERVAL);

  log.log(' Initialized with periodic status sync and orphan polling');
}

/**
 * Shutdown the runtime service
 * @param killProcesses - If true, kill all running runtime processes.
 *                        If false (default), processes continue running independently.
 *                        Set to true for clean shutdown, false for commander restart/crash recovery.
 */
export async function shutdown(killProcesses: boolean = false): Promise<void> {
  if (statusSyncTimer) {
    clearInterval(statusSyncTimer);
    statusSyncTimer = null;
  }
  if (orphanPollTimer) {
    clearInterval(orphanPollTimer);
    orphanPollTimer = null;
  }
  for (const runner of runners.values()) {
    await runner.stopAll(killProcesses);
  }
  runners.clear();
}

/** Get an active subagent by toolUseId */
export function getActiveSubagentByToolUseId(toolUseId: string): ActiveSubagent | undefined {
  return getTrackedSubagentByToolUseId(toolUseId);
}

/** Get all active subagents for a parent agent */
export function getActiveSubagentsForAgent(parentAgentId: string): ActiveSubagent[] {
  return getTrackedSubagentsForAgent(parentAgentId);
}

export async function sendCommand(
  agentId: string,
  command: string,
  systemPrompt?: string,
  forceNewSession?: boolean,
  customAgent?: CustomAgentConfig
): Promise<void> {
  await commandExecution.sendCommand(agentId, command, systemPrompt, forceNewSession, customAgent);
}

export async function sendSilentCommand(agentId: string, command: string): Promise<void> {
  await commandExecution.sendSilentCommand(agentId, command);
}

export async function stopAgent(agentId: string): Promise<void> {
  await commandExecution.stopAgent(agentId);
}

export function isAgentRunning(agentId: string): boolean {
  return isAnyRunnerActive(agentId);
}

/**
 * Check if there's an orphaned process for this agent
 * Uses ONLY PID tracking - not general process discovery
 * (Process discovery is too aggressive and matches unrelated Claude sessions)
 */
function _checkForOrphanedProcess(agentId: string): boolean {
  try {
    const savedProcesses = loadRunningProcesses();
    const savedProcess = savedProcesses.find((process: { agentId: string }) => process.agentId === agentId);
    if (savedProcess && isProcessRunning(savedProcess.pid)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function syncAgentStatus(agentId: string, isStartupSync: boolean = false): Promise<void> {
  await statusSync.syncAgentStatus(agentId, isStartupSync);
}

export async function syncAllAgentStatus(isStartupSync: boolean = false): Promise<void> {
  await statusSync.syncAllAgentStatus(isStartupSync);
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

      if (isAnyRunnerActive(agentInfo.id)) {
        continue;
      }

      const { buildCustomAgentConfig } = await import('../websocket/handlers/command-handler.js');
      const customAgentConfig = buildCustomAgentConfig(agentInfo.id, agent.class);

      const resumeMessage = `[System: The commander server was restarted while you were working. Please continue with your previous task. Your last assigned task was: "${agentInfo.lastTask}"]`;

      await sendCommand(agentInfo.id, resumeMessage, undefined, undefined, customAgentConfig);

      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (err) {
      log.error(`Failed to auto-resume ${agentInfo.name}:`, err);
    }
  }

  agentService.clearAgentsToResume();
}

