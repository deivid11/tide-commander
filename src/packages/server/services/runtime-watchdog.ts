import type { RuntimeRunner } from '../runtime/index.js';
import { logger } from '../utils/logger.js';

const log = logger.claude;

const pendingSilentContextRefresh = new Set<string>();
const stepCompleteReceived = new Set<string>();
const stdinWatchdogTimers = new Map<string, NodeJS.Timeout>();

export const STDIN_ACTIVITY_TIMEOUT_MS = 10000;

export function markPendingSilentContextRefresh(agentId: string): void {
  pendingSilentContextRefresh.add(agentId);
}

export function clearPendingSilentContextRefresh(agentId: string): void {
  pendingSilentContextRefresh.delete(agentId);
}

export function hasPendingSilentContextRefresh(agentId: string): boolean {
  return pendingSilentContextRefresh.has(agentId);
}

export function markStepCompleteReceived(agentId: string): void {
  stepCompleteReceived.add(agentId);
}

export function consumeStepCompleteReceived(agentId: string): boolean {
  const hasStepComplete = stepCompleteReceived.has(agentId);
  stepCompleteReceived.delete(agentId);
  return hasStepComplete;
}

interface StartStdinWatchdogOptions {
  agentId: string;
  command: string;
  systemPrompt?: string;
  customAgent?: unknown;
  runner: RuntimeRunner | null;
  onRespawn: (agentId: string, command: string, systemPrompt?: string, customAgent?: unknown) => Promise<void>;
}

export function startStdinWatchdog(options: StartStdinWatchdogOptions): void {
  const { agentId, command, systemPrompt, customAgent, runner, onRespawn } = options;
  if (!runner) return;

  const existingTimer = stdinWatchdogTimers.get(agentId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  log.log(`[STDIN-WATCHDOG] Starting watchdog for ${agentId}, timeout=${STDIN_ACTIVITY_TIMEOUT_MS}ms`);

  const watchdogTimer = setTimeout(async () => {
    stdinWatchdogTimers.delete(agentId);

    if (runner && !runner.hasRecentActivity(agentId, STDIN_ACTIVITY_TIMEOUT_MS)) {
      log.warn(`[STDIN-WATCHDOG] Agent ${agentId}: No activity after stdin message, respawning process...`);
      await runner.stop(agentId);

      try {
        await onRespawn(agentId, command, systemPrompt, customAgent);
        log.log(`[STDIN-WATCHDOG] Agent ${agentId}: Successfully respawned process`);
      } catch (err) {
        log.error(`[STDIN-WATCHDOG] Agent ${agentId}: Failed to respawn process:`, err);
      }
    } else {
      log.log(`[STDIN-WATCHDOG] Agent ${agentId}: Activity received, watchdog cleared`);
    }
  }, STDIN_ACTIVITY_TIMEOUT_MS);

  stdinWatchdogTimers.set(agentId, watchdogTimer);

  runner.onNextActivity(agentId, () => {
    const timer = stdinWatchdogTimers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      stdinWatchdogTimers.delete(agentId);
      log.log(`[STDIN-WATCHDOG] Agent ${agentId}: Cleared watchdog on activity`);
    }
  });
}

export function clearStdinWatchdog(agentId: string): void {
  const timer = stdinWatchdogTimers.get(agentId);
  if (!timer) return;
  clearTimeout(timer);
  stdinWatchdogTimers.delete(agentId);
}

export function resetWatchdogStateForTests(): void {
  pendingSilentContextRefresh.clear();
  stepCompleteReceived.clear();
  for (const timer of stdinWatchdogTimers.values()) {
    clearTimeout(timer);
  }
  stdinWatchdogTimers.clear();
}
