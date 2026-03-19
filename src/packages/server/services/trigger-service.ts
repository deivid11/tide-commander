/**
 * Trigger Service
 * Core service for managing triggers: CRUD, event evaluation, firing, and cron management.
 *
 * - In-memory Map backed by JSON file persistence (debounced writes)
 * - Evaluates incoming events against all matching triggers
 * - Supports structural, LLM, and hybrid matching modes
 * - Logs all fires to SQLite via event-db helpers
 * - Rate limits triggers (10 req/min per trigger by default)
 */

import * as crypto from 'crypto';
import type {
  Trigger, CronTrigger, TriggerListener, TriggerListenerEvent,
  TriggerFireOptions, TriggerHandler, TriggerDefinition, ExternalEvent,
  LLMMatchResult, LLMExtractResult, TestMatchResult,
} from '../../shared/trigger-types.js';
import { loadTriggers, saveTriggers as saveTriggersSync, saveTriggersAsync } from '../data/trigger-store.js';
import { insertOne, queryMany, execute } from '../data/event-db.js';
import { llmMatch, llmExtractVariables } from './llm-matcher-service.js';
import * as cronService from './cron-service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('TriggerService');

// ─── State ───

const triggers = new Map<string, Trigger>();
const listeners = new Set<TriggerListener>();
const triggerHandlers = new Map<string, TriggerHandler>(); // triggerType -> handler
const cronJobs = new Map<string, cronService.CronJob>(); // triggerId -> CronJob

// Rate limiting: triggerId -> array of fire timestamps
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 10; // 10 per minute per trigger

// Debounced persistence
const PERSIST_DEBOUNCE_MS = 2000;
let persistTimer: NodeJS.Timeout | null = null;

function debouncedPersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    saveTriggersAsync(Array.from(triggers.values())).catch(err => {
      log.error('Failed to persist triggers:', err);
    });
  }, PERSIST_DEBOUNCE_MS);
}

function emit(event: TriggerListenerEvent, data: unknown): void {
  for (const listener of listeners) {
    try {
      listener(event, data);
    } catch (err) {
      log.error('Trigger listener error:', err);
    }
  }
}

// ─── Lifecycle ───

export function initTriggers(): void {
  const stored = loadTriggers();
  for (const trigger of stored) {
    triggers.set(trigger.id, trigger);
  }

  // Register built-in webhook handler
  registerHandler(createWebhookHandler());

  // Start cron jobs for enabled cron triggers
  restartCronJobs();

  log.log(`Initialized ${triggers.size} triggers`);
}

export function shutdown(): void {
  // Stop all cron jobs
  for (const [id, job] of cronJobs) {
    cronService.stop(job);
  }
  cronJobs.clear();

  // Stop all trigger handlers
  for (const [type, handler] of triggerHandlers) {
    handler.stopListening().catch(err => {
      log.error(`Failed to stop handler for ${type}:`, err);
    });
  }
  triggerHandlers.clear();

  // Flush pending writes
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  // Sync save on shutdown
  saveTriggersSync(Array.from(triggers.values()));

  log.log('Trigger service shut down');
}

// ─── Handler Registration ───

export function registerHandler(handler: TriggerHandler): void {
  triggerHandlers.set(handler.triggerType, handler);
  log.log(`Registered trigger handler for type: ${handler.triggerType}`);

  // Start listening — events are routed to evaluateEvent
  handler.startListening((event: ExternalEvent) => {
    void evaluateEvent(handler, event);
  }).catch(err => {
    log.error(`Failed to start handler for ${handler.triggerType}:`, err);
  });
}

// ─── CRUD ───

export function getTrigger(id: string): Trigger | undefined {
  return triggers.get(id);
}

export function getAllTriggers(): Trigger[] {
  return Array.from(triggers.values());
}

export function createTrigger(data: Omit<Trigger, 'id' | 'createdAt' | 'updatedAt' | 'fireCount'>): Trigger {
  const id = crypto.randomBytes(8).toString('hex');
  const now = Date.now();

  const trigger: Trigger = {
    ...data,
    id,
    fireCount: 0,
    status: data.enabled ? 'enabled' : 'disabled',
    createdAt: now,
    updatedAt: now,
  } as Trigger;

  triggers.set(id, trigger);
  debouncedPersist();

  // Start cron job if applicable
  if (trigger.type === 'cron' && trigger.enabled) {
    startCronJob(trigger as CronTrigger);
  }

  emit('trigger_created', trigger);
  log.log(`Created trigger: ${trigger.name} (${trigger.type})`);

  return trigger;
}

export function updateTrigger(id: string, updates: Partial<Trigger>): Trigger | null {
  const existing = triggers.get(id);
  if (!existing) return null;

  const updated: Trigger = {
    ...existing,
    ...updates,
    id: existing.id, // Never overwrite id
    createdAt: existing.createdAt, // Never overwrite createdAt
    updatedAt: Date.now(),
  } as Trigger;

  triggers.set(id, updated);
  debouncedPersist();

  // Manage cron jobs
  if (existing.type === 'cron') {
    stopCronJob(id);
    if (updated.enabled && updated.type === 'cron') {
      startCronJob(updated as CronTrigger);
    }
  }

  emit('trigger_updated', updated);
  log.log(`Updated trigger: ${updated.name}`);

  return updated;
}

export function deleteTrigger(id: string): boolean {
  const existing = triggers.get(id);
  if (!existing) return false;

  // Stop cron job if applicable
  stopCronJob(id);

  triggers.delete(id);
  rateLimitMap.delete(id);
  debouncedPersist();

  emit('trigger_deleted', { id });
  log.log(`Deleted trigger: ${existing.name}`);

  return true;
}

// ─── Event Evaluation ───

async function evaluateEvent(handler: TriggerHandler, event: ExternalEvent): Promise<void> {
  const triggersOfType = Array.from(triggers.values()).filter(
    t => t.type === handler.triggerType && t.enabled
  );

  for (const trigger of triggersOfType) {
    try {
      let matched = false;
      let llmResult: LLMMatchResult | undefined;
      let llmExtractResult: LLMExtractResult | undefined;

      // Step 1: Structural matching
      if (trigger.matchMode === 'structural' || trigger.matchMode === 'hybrid') {
        const structuralResult = handler.structuralMatch(trigger, event);
        if (trigger.matchMode === 'structural') {
          matched = structuralResult;
        } else {
          // hybrid: structural must pass before LLM is called
          if (!structuralResult) continue;
        }
      }

      // Step 2: LLM matching
      if (trigger.matchMode === 'llm' || trigger.matchMode === 'hybrid') {
        if (!trigger.llmMatch) {
          log.warn(`Trigger ${trigger.name} has matchMode=${trigger.matchMode} but no llmMatch config`);
          continue;
        }
        const formatted = handler.formatEventForLLM(event);
        llmResult = await llmMatch(formatted, trigger.llmMatch);

        // Check confidence threshold
        const minConfidence = trigger.llmMatch.minConfidence ?? 0.0;
        matched = llmResult.match && llmResult.confidence >= minConfidence;
      }

      if (!matched) continue;

      // Step 3: Variable extraction
      let variables: Record<string, string>;

      if (trigger.extractionMode === 'llm' && trigger.llmExtract) {
        const formatted = handler.formatEventForLLM(event);
        llmExtractResult = await llmExtractVariables(formatted, trigger.llmExtract);
        // Merge with structural variables as fallback
        const structuralVars = handler.extractVariables(trigger, event);
        variables = { ...structuralVars, ...llmExtractResult.variables };
      } else {
        variables = handler.extractVariables(trigger, event);
      }

      // Step 4: Fire the trigger
      await fireTrigger(trigger.id, variables, {
        rawPayload: event.data,
        llmMatchResult: llmResult,
        llmExtractResult: llmExtractResult,
      });
    } catch (err) {
      log.error(`Error evaluating trigger ${trigger.name} for event:`, err);
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      updateTrigger(trigger.id, { status: 'error', lastError: errorMsg });
      emit('trigger_error', { triggerId: trigger.id, error: errorMsg });
    }
  }
}

// ─── Test Match (dry run — no fire, no SQLite log) ───

export async function testMatch(triggerId: string, event: ExternalEvent): Promise<TestMatchResult> {
  const trigger = triggers.get(triggerId);
  if (!trigger) throw new Error(`Trigger not found: ${triggerId}`);

  const handler = triggerHandlers.get(trigger.type);
  // For webhook triggers, we provide a basic handler
  const effectiveHandler = handler || createWebhookHandler();

  let structuralResult: boolean | undefined;
  let llmResult: LLMMatchResult | undefined;
  let wouldFire = false;

  // Structural matching
  if (trigger.matchMode === 'structural' || trigger.matchMode === 'hybrid') {
    structuralResult = effectiveHandler.structuralMatch(trigger, event);
    if (trigger.matchMode === 'structural') {
      wouldFire = structuralResult;
    } else if (!structuralResult) {
      // hybrid: structural failed, skip LLM
      return {
        structuralMatch: structuralResult,
        extractedVariables: {},
        wouldFire: false,
      };
    }
  }

  // LLM matching
  if (trigger.matchMode === 'llm' || trigger.matchMode === 'hybrid') {
    if (trigger.llmMatch) {
      const formatted = effectiveHandler.formatEventForLLM(event);
      llmResult = await llmMatch(formatted, trigger.llmMatch);
      const minConfidence = trigger.llmMatch.minConfidence ?? 0.0;
      wouldFire = llmResult.match && llmResult.confidence >= minConfidence;
    }
  }

  // Variable extraction (always run for test)
  let extractedVariables: Record<string, string> = {};
  if (trigger.extractionMode === 'llm' && trigger.llmExtract) {
    const formatted = effectiveHandler.formatEventForLLM(event);
    const extractResult = await llmExtractVariables(formatted, trigger.llmExtract);
    const structuralVars = effectiveHandler.extractVariables(trigger, event);
    extractedVariables = { ...structuralVars, ...extractResult.variables };
  } else {
    extractedVariables = effectiveHandler.extractVariables(trigger, event);
  }

  return {
    structuralMatch: structuralResult,
    llmMatch: llmResult,
    extractedVariables,
    wouldFire,
  };
}

// ─── Fire Trigger ───

export async function fireTrigger(
  id: string,
  variables: Record<string, string>,
  opts?: TriggerFireOptions
): Promise<void> {
  const trigger = triggers.get(id);
  if (!trigger) {
    log.error(`Cannot fire unknown trigger: ${id}`);
    return;
  }

  // Rate limit check
  if (!checkRateLimit(id)) {
    log.warn(`Trigger ${trigger.name} rate-limited (>${RATE_LIMIT_MAX}/min)`);
    return;
  }

  const startTime = Date.now();

  // Interpolate prompt template
  const interpolatedPrompt = interpolateTemplate(trigger.promptTemplate, variables);

  // Log fire event to SQLite
  let eventId: number;
  try {
    eventId = insertOne('trigger_events', {
      trigger_id: trigger.id,
      trigger_name: trigger.name,
      trigger_type: trigger.type,
      agent_id: trigger.agentId,
      workflow_instance_id: opts?.workflowInstanceId || null,
      fired_at: startTime,
      variables: JSON.stringify(variables),
      payload: opts?.rawPayload ? JSON.stringify(opts.rawPayload) : null,
      match_mode: trigger.matchMode,
      llm_match_result: opts?.llmMatchResult ? JSON.stringify(opts.llmMatchResult) : null,
      llm_extract_result: opts?.llmExtractResult ? JSON.stringify(opts.llmExtractResult) : null,
      status: 'fired',
      error: null,
      duration_ms: null,
    });
  } catch (err) {
    log.error('Failed to log trigger fire to SQLite:', err);
    eventId = -1;
  }

  // Send command to agent
  try {
    // Dynamic import to avoid circular dependencies
    const { sendCommand } = await import('./runtime-service.js');
    await sendCommand(trigger.agentId, interpolatedPrompt);

    // Update trigger state
    const updated = {
      lastFiredAt: startTime,
      fireCount: trigger.fireCount + 1,
      status: 'enabled' as const,
      lastError: undefined,
    };
    updateTrigger(id, updated);

    // Update event status in SQLite
    if (eventId > 0) {
      try {
        execute(
          'UPDATE trigger_events SET status = ?, duration_ms = ? WHERE id = ?',
          ['delivered', Date.now() - startTime, eventId]
        );
      } catch { /* best effort */ }
    }

    emit('trigger_fired', { triggerId: id, agentId: trigger.agentId, timestamp: startTime });
    log.log(`Fired trigger ${trigger.name} -> agent ${trigger.agentId}`);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    updateTrigger(id, { status: 'error', lastError: errorMsg });

    // Update event status in SQLite
    if (eventId > 0) {
      try {
        execute(
          'UPDATE trigger_events SET status = ?, error = ?, duration_ms = ? WHERE id = ?',
          ['failed', errorMsg, Date.now() - startTime, eventId]
        );
      } catch { /* best effort */ }
    }

    emit('trigger_error', { triggerId: id, error: errorMsg });
    log.error(`Failed to fire trigger ${trigger.name}:`, err);
  }
}

// ─── Rate Limiting ───

function checkRateLimit(triggerId: string): boolean {
  const now = Date.now();
  let timestamps = rateLimitMap.get(triggerId);

  if (!timestamps) {
    timestamps = [];
    rateLimitMap.set(triggerId, timestamps);
  }

  // Remove old entries outside the window
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift();
  }

  if (timestamps.length >= RATE_LIMIT_MAX) {
    return false;
  }

  timestamps.push(now);
  return true;
}

// ─── Template Interpolation ───

function interpolateTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, key: string) => {
    // Check flat key first (e.g. "slack.user" as a literal key)
    if (key in variables) {
      return variables[key];
    }

    // Fall back to nested key traversal (e.g. payload.field -> payload["field"])
    const parts = key.split('.');
    let value: unknown = variables;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in (value as Record<string, unknown>)) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return `{{${key}}}`; // Leave unresolved placeholders as-is
      }
    }

    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

// ─── Cron Management ───

function startCronJob(trigger: CronTrigger): void {
  // Stop existing job if any
  stopCronJob(trigger.id);

  const job = cronService.schedule(
    trigger.config.expression,
    trigger.config.timezone,
    () => {
      const variables: Record<string, string> = {
        'cron.expression': trigger.config.expression,
        'cron.scheduledAt': new Date().toISOString(),
        ...(trigger.config.payload || {}),
      };

      void fireTrigger(trigger.id, variables);
    }
  );

  cronJobs.set(trigger.id, job);
  log.log(`Started cron job for trigger ${trigger.name}: ${trigger.config.expression}`);
}

function stopCronJob(triggerId: string): void {
  const job = cronJobs.get(triggerId);
  if (job) {
    cronService.stop(job);
    cronJobs.delete(triggerId);
  }
}

function restartCronJobs(): void {
  // Stop all existing cron jobs
  for (const [id, job] of cronJobs) {
    cronService.stop(job);
  }
  cronJobs.clear();

  // Start new jobs for all enabled cron triggers
  for (const trigger of triggers.values()) {
    if (trigger.type === 'cron' && trigger.enabled) {
      startCronJob(trigger as CronTrigger);
    }
  }
}

// ─── Pub/Sub ───

export function subscribe(listener: TriggerListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ─── Trigger Event History (from SQLite) ───

export function getTriggerEvents(triggerId: string, limit: number = 50): unknown[] {
  return queryMany(
    'SELECT * FROM trigger_events WHERE trigger_id = ? ORDER BY fired_at DESC LIMIT ?',
    [triggerId, limit]
  );
}

export function getAllTriggerEvents(limit: number = 100): unknown[] {
  return queryMany(
    'SELECT * FROM trigger_events ORDER BY fired_at DESC LIMIT ?',
    [limit]
  );
}

// ─── Webhook Handler (basic built-in handler for webhook triggers) ───

function createWebhookHandler(): TriggerHandler {
  return {
    triggerType: 'webhook',

    async startListening() {
      // Webhooks are handled via HTTP routes, not event listeners
    },

    async stopListening() {
      // Nothing to stop
    },

    structuralMatch(trigger: TriggerDefinition, _event: ExternalEvent): boolean {
      // Webhook triggers always structurally match (the route already filters by triggerId)
      return trigger.type === 'webhook';
    },

    extractVariables(trigger: TriggerDefinition, event: ExternalEvent): Record<string, string> {
      const variables: Record<string, string> = {
        'trigger.name': trigger.name,
        timestamp: new Date().toISOString(),
      };

      // Extract fields from payload if configured
      const extractFields = trigger.config.extractFields as string[] | undefined;
      if (trigger.type === 'webhook' && extractFields && event.data) {
        const payload = event.data as Record<string, unknown>;
        variables['payload'] = JSON.stringify(payload);

        for (const fieldPath of extractFields) {
          const value = getNestedValue(payload, fieldPath);
          if (value !== undefined) {
            variables[fieldPath] = typeof value === 'string' ? value : JSON.stringify(value);
          }
        }
      }

      return variables;
    },

    formatEventForLLM(event: ExternalEvent): string {
      return `Webhook event received at ${new Date(event.timestamp).toISOString()}:\n${JSON.stringify(event.data, null, 2)}`;
    },
  };
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;

  for (const part of parts) {
    if (current && typeof current === 'object' && part in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

// Webhook handler is registered in initTriggers()
