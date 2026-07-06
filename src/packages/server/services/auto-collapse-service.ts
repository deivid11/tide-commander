/**
 * Auto-Collapse Service
 *
 * Per-agent scheduled context collapse. When an agent has `autoCollapse` enabled
 * with a valid cron expression, this service arms a recurring cron job that fires
 * `collapseAgentContext(agentId, { waitForIdle: true })` at the configured time.
 *
 * Intended for unattended agents (slack channels, log-supervising cronjobs) whose
 * context grows indefinitely — collapse it overnight so each day starts fresh.
 *
 * - Subscribes to agent-service lifecycle events ('created' | 'updated' | 'deleted')
 *   and reconciles each agent's armed job against its current config.
 * - Re-arms only when the collapse config (enabled | cron | tz) actually changes,
 *   so the high-frequency agent updates (status, tokens, tracking) don't churn jobs.
 */

import * as cronService from './cron-service.js';
import * as agentService from './agent-service.js';
import { collapseAgentContext } from './runtime-service.js';
import type { Agent } from '../../shared/agent-types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('AutoCollapse');

// agentId -> armed cron job
const jobs = new Map<string, cronService.CronJob>();
// agentId -> { expression, timezone } the armed job was built from
const armed = new Map<string, { expression: string; timezone: string }>();

let unsubscribe: (() => void) | null = null;

/** Default timezone when an agent enables auto-collapse without specifying one. */
function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * The (expression, timezone) the agent's config asks us to arm, or null if it
 * should not be armed (disabled, no cron, or an invalid cron expression).
 */
function desiredConfig(agent: Agent): { expression: string; timezone: string } | null {
  const expression = (agent.autoCollapseCron ?? '').trim();
  if (!agent.autoCollapse || !expression) return null;
  if (!cronService.validate(expression)) {
    log.warn(`Agent ${agent.id} has auto-collapse on but an invalid cron: '${expression}' — not arming`);
    return null;
  }
  const timezone = (agent.autoCollapseTz ?? '').trim() || defaultTimezone();
  return { expression, timezone };
}

function stopJob(agentId: string): void {
  const job = jobs.get(agentId);
  if (job) {
    cronService.stop(job);
    jobs.delete(agentId);
  }
  armed.delete(agentId);
}

function armJob(agentId: string, config: { expression: string; timezone: string }): void {
  const { expression, timezone } = config;
  const job = cronService.schedule(expression, timezone, () => {
    void runCollapse(agentId, expression, timezone);
  });
  jobs.set(agentId, job);
  armed.set(agentId, config);
  log.log(`Armed auto-collapse for agent ${agentId}: '${expression}' (${timezone})`);
}

async function runCollapse(agentId: string, expression: string, timezone: string): Promise<void> {
  try {
    // Read the prompt at fire time (not arm time) so edits to it apply on the
    // next collapse without re-arming the cron job.
    const afterPrompt = (agentService.getAgent(agentId)?.autoCollapsePrompt ?? '').trim() || undefined;
    const result = await collapseAgentContext(agentId, {
      waitForIdle: true,
      ...(afterPrompt ? { afterPrompt } : {}),
    });
    log.log(`Auto-collapse fired for agent ${agentId} ('${expression}' ${timezone}): ${result.status}${afterPrompt ? ' [post-collapse prompt armed]' : ''}`);
  } catch (err) {
    log.error(`Auto-collapse failed for agent ${agentId}:`, err);
  }
}

/**
 * Reconcile a single agent's armed job against its current config. Idempotent:
 * a no-op when the collapse config is unchanged.
 */
function reconcile(agent: Agent): void {
  const desired = desiredConfig(agent);
  const current = armed.get(agent.id) ?? null;

  const unchanged =
    (desired === null && current === null) ||
    (desired !== null && current !== null &&
      desired.expression === current.expression &&
      desired.timezone === current.timezone);
  if (unchanged) return;

  // Config changed (toggled, re-scheduled, or became invalid) — rebuild from scratch.
  const wasArmed = current !== null;
  stopJob(agent.id);
  if (desired) {
    armJob(agent.id, desired);
  } else if (wasArmed) {
    log.log(`Disarmed auto-collapse for agent ${agent.id}`);
  }
}

/** Arm jobs for all existing agents and start listening for changes. */
export function initAutoCollapse(): void {
  for (const agent of agentService.getAllAgents()) {
    reconcile(agent);
  }

  unsubscribe = agentService.subscribe((event, data) => {
    if (event === 'deleted') {
      const id = typeof data === 'string' ? data : (data as Agent).id;
      if (id) stopJob(id);
      return;
    }
    if (event === 'created' || event === 'updated') {
      if (data && typeof data !== 'string') reconcile(data);
    }
  });

  log.log(`Auto-collapse initialized (${jobs.size} agent(s) armed)`);
}

/** Stop all armed jobs and detach the listener (for graceful shutdown). */
export function shutdown(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  for (const job of jobs.values()) {
    cronService.stop(job);
  }
  jobs.clear();
  armed.clear();
}

/** Number of currently armed agents (test/inspection accessor). */
export function armedCount(): number {
  return jobs.size;
}
