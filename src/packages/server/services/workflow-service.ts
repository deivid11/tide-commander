/**
 * Workflow Service
 * Core state machine — start, transition, variables, trigger/timer management.
 * Definitions in JSON (workflow-store.ts), instances in SQLite (event-queries.ts).
 */

import { createLogger } from '../utils/logger.js';
import * as workflowStore from '../data/workflow-store.js';
import * as eventQueries from '../data/event-queries.js';
import type {
  WorkflowDefinition,
  WorkflowState,
  WorkflowAction,
  WorkflowTransition,
  WorkflowCondition,
  WorkflowListener,
  WorkflowEventPayload,
} from '../../shared/workflow-types.js';
import type {
  WorkflowInstanceRow,
  WorkflowStepLogRow,
  VariableChangeRow,
  TimelineEntry,
} from '../../shared/event-types.js';

const log = createLogger('WorkflowService');

// ─── Event System ───

const listeners: Set<WorkflowListener> = new Set();

export function subscribe(listener: WorkflowListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: WorkflowEventPayload): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      log.error(`Listener error: ${err}`);
    }
  }
}

// ─── Active Timers ───

const activeTimeouts = new Map<string, NodeJS.Timeout>();

function clearInstanceTimers(instanceId: string): void {
  for (const [key, timer] of activeTimeouts) {
    if (key.startsWith(instanceId + ':')) {
      clearTimeout(timer);
      activeTimeouts.delete(key);
    }
  }
}

// ─── Lifecycle ───

export function initWorkflows(): void {
  workflowStore.init();
  log.log('Workflow service initialized');
}

export function shutdown(): void {
  // Clear all active timers
  for (const [, timer] of activeTimeouts) {
    clearTimeout(timer);
  }
  activeTimeouts.clear();
  listeners.clear();
}

// ─── Definitions (delegates to store) ───

export function listDefinitions(): WorkflowDefinition[] {
  return workflowStore.listDefinitions();
}

export function getDefinition(id: string): WorkflowDefinition | undefined {
  return workflowStore.getDefinition(id);
}

export function createDefinition(
  data: Omit<WorkflowDefinition, 'id' | 'version' | 'createdAt' | 'updatedAt'>
): WorkflowDefinition {
  const def = workflowStore.createDefinition(data);
  emit({ instanceId: '', eventType: 'state_changed', data: { definitionId: def.id, action: 'created' } });
  return def;
}

export function updateDefinition(
  id: string,
  updates: Partial<WorkflowDefinition>
): WorkflowDefinition | null {
  const def = workflowStore.updateDefinition(id, updates);
  if (def) {
    emit({ instanceId: '', eventType: 'state_changed', data: { definitionId: def.id, action: 'updated' } });
  }
  return def;
}

export function deleteDefinition(id: string): boolean {
  const result = workflowStore.deleteDefinition(id);
  if (result) {
    emit({ instanceId: '', eventType: 'state_changed', data: { definitionId: id, action: 'deleted' } });
  }
  return result;
}

// ─── Instances (backed by SQLite) ───

export function listInstances(opts?: {
  workflowDefId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): WorkflowInstanceRow[] {
  return eventQueries.listWorkflowInstances(opts);
}

export function getInstance(id: string): WorkflowInstanceRow | undefined {
  return eventQueries.getWorkflowInstance(id);
}

export function countInstances(opts?: {
  status?: string;
  workflowDefId?: string;
}): number {
  return eventQueries.countWorkflowInstances(opts);
}

// ─── Start Workflow ───

export async function startWorkflow(params: {
  workflowDefId: string;
  initialVariables?: Record<string, unknown>;
}): Promise<WorkflowInstanceRow> {
  const def = workflowStore.getDefinition(params.workflowDefId);
  if (!def) {
    throw new Error(`Workflow definition not found: ${params.workflowDefId}`);
  }

  // Build initial variables from schema defaults + provided values
  const variables: Record<string, unknown> = {};
  for (const v of def.variables) {
    if (v.defaultValue !== undefined) {
      variables[v.name] = v.defaultValue;
    }
  }
  if (params.initialVariables) {
    Object.assign(variables, params.initialVariables);
  }

  const now = Date.now();
  const instanceId = 'wi_' + Math.random().toString(36).slice(2, 10) + now.toString(36);

  const instance: WorkflowInstanceRow = {
    id: instanceId,
    workflowDefId: def.id,
    workflowName: def.name,
    status: 'running',
    currentStateId: def.initialStateId,
    variables,
    activeTriggerIds: [],
    activeTimers: [],
    createdAt: now,
    updatedAt: now,
  };

  eventQueries.insertWorkflowInstance(instance);

  eventQueries.logAudit({
    category: 'workflow',
    action: 'workflow_started',
    workflowInstanceId: instanceId,
    details: { workflowDefId: def.id, workflowName: def.name },
    level: 'info',
    createdAt: now,
  });

  emit({ instanceId, eventType: 'state_changed', data: instance });

  // Enter the initial state
  await enterState(instance, def.initialStateId, def);

  // Return fresh copy from DB
  return eventQueries.getWorkflowInstance(instanceId)!;
}

// ─── Pause / Resume / Cancel ───

export function pauseWorkflow(instanceId: string): WorkflowInstanceRow | null {
  const instance = eventQueries.getWorkflowInstance(instanceId);
  if (!instance || instance.status !== 'running') return null;

  clearInstanceTimers(instanceId);

  eventQueries.updateWorkflowInstance(instanceId, {
    status: 'paused',
    updatedAt: Date.now(),
  });

  const updated = eventQueries.getWorkflowInstance(instanceId)!;
  emit({ instanceId, eventType: 'state_changed', data: updated });
  return updated;
}

export async function resumeWorkflow(instanceId: string): Promise<WorkflowInstanceRow | null> {
  const instance = eventQueries.getWorkflowInstance(instanceId);
  if (!instance || instance.status !== 'paused') return null;

  eventQueries.updateWorkflowInstance(instanceId, {
    status: 'running',
    updatedAt: Date.now(),
  });

  const updated = eventQueries.getWorkflowInstance(instanceId)!;
  emit({ instanceId, eventType: 'state_changed', data: updated });

  return updated;
}

export function cancelWorkflow(instanceId: string): WorkflowInstanceRow | null {
  const instance = eventQueries.getWorkflowInstance(instanceId);
  if (!instance || instance.status === 'completed' || instance.status === 'cancelled') return null;

  clearInstanceTimers(instanceId);

  const now = Date.now();

  // Complete the current step if one is active
  const currentStep = eventQueries.getCurrentStep(instanceId);
  if (currentStep) {
    eventQueries.updateStepLog(currentStep.id!, {
      status: 'skipped',
      exitedAt: now,
      durationMs: now - currentStep.enteredAt,
    });
  }

  eventQueries.updateWorkflowInstance(instanceId, {
    status: 'cancelled',
    completedAt: now,
    updatedAt: now,
  });

  eventQueries.logAudit({
    category: 'workflow',
    action: 'workflow_cancelled',
    workflowInstanceId: instanceId,
    level: 'info',
    createdAt: now,
  });

  const updated = eventQueries.getWorkflowInstance(instanceId)!;
  emit({ instanceId, eventType: 'completed', data: updated });
  return updated;
}

// ─── State Machine Execution ───

async function enterState(
  instance: WorkflowInstanceRow,
  stateId: string,
  def: WorkflowDefinition
): Promise<void> {
  const state = def.states.find((s) => s.id === stateId);
  if (!state) {
    log.error(`State not found: ${stateId} in workflow ${def.id}`);
    failWorkflow(instance.id, `State not found: ${stateId}`);
    return;
  }

  const now = Date.now();
  const previousStateId = instance.currentStateId !== stateId ? instance.currentStateId : undefined;

  // Update instance current state
  eventQueries.updateWorkflowInstance(instance.id, {
    currentStateId: stateId,
    updatedAt: now,
  });

  // Create step log entry
  const stepLogId = eventQueries.insertStepLog({
    workflowInstanceId: instance.id,
    fromStateId: previousStateId,
    toStateId: stateId,
    toStateName: state.name,
    actionType: state.action?.type,
    variablesBefore: instance.variables,
    enteredAt: now,
    status: 'entered',
  } as WorkflowStepLogRow);

  emit({
    instanceId: instance.id,
    eventType: 'state_changed',
    data: { fromState: previousStateId, toState: stateId, stepLogId },
  });

  // Handle 'end' state
  if (state.type === 'end') {
    completeWorkflow(instance.id, stepLogId);
    return;
  }

  // Execute the state's action (if any)
  if (state.action) {
    eventQueries.updateStepLog(stepLogId, { status: 'executing' });
    emit({
      instanceId: instance.id,
      eventType: 'step_update',
      data: { stepLogId, status: 'executing' },
    });

    try {
      await executeAction(instance, state.action, stepLogId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      log.error(`Action failed in state ${stateId}: ${errorMsg}`);
      eventQueries.updateStepLog(stepLogId, {
        status: 'failed',
        error: errorMsg,
        exitedAt: Date.now(),
        durationMs: Date.now() - now,
      });
      failWorkflow(instance.id, `Action failed in state ${state.name}: ${errorMsg}`);
      return;
    }
  }

  // Set up timeout transitions
  setupTimeoutTransitions(instance, state, def);
}

async function executeAction(
  instance: WorkflowInstanceRow,
  action: WorkflowAction,
  stepLogId: number,
): Promise<void> {
  switch (action.type) {
    case 'agent_task': {
      const prompt = interpolateTemplate(action.promptTemplate, instance.variables, instance.id);
      eventQueries.updateStepLog(stepLogId, {
        agentId: action.agentId,
        promptSent: prompt,
      });
      // The agent task is async — the agent calls back via notifyEvent when done
      // We don't await the agent here; the workflow waits for agent_complete transition
      log.log(`Sent agent task to ${action.agentId} for instance ${instance.id}`);
      break;
    }

    case 'trigger_setup': {
      // Dynamic trigger creation is handled externally by the trigger service
      // We log the intent; the actual trigger creation happens via the API
      log.log(`Trigger setup requested for instance ${instance.id}`);
      break;
    }

    case 'wait_for_trigger': {
      // Set up a timeout if specified
      if (action.timeoutMs) {
        const timerKey = `${instance.id}:timeout:${stepLogId}`;
        const timer = setTimeout(() => {
          activeTimeouts.delete(timerKey);
          void notifyEvent({
            instanceId: instance.id,
            eventType: 'trigger_fired',
            data: { timeout: true },
          });
        }, action.timeoutMs);
        timer.unref();
        activeTimeouts.set(timerKey, timer);
      }
      break;
    }

    case 'set_variables': {
      for (const [varName, expression] of Object.entries(action.assignments)) {
        const value = interpolateTemplate(expression, instance.variables, instance.id);
        const oldValue = instance.variables[varName];
        instance.variables[varName] = value;

        eventQueries.logVariableChange({
          workflowInstanceId: instance.id,
          stepLogId,
          variableName: varName,
          oldValue,
          newValue: value,
          changedBy: 'workflow_engine',
          changedAt: Date.now(),
        } as VariableChangeRow);
      }

      eventQueries.updateWorkflowInstance(instance.id, {
        variables: instance.variables,
        updatedAt: Date.now(),
      });

      emit({
        instanceId: instance.id,
        eventType: 'variable_changed',
        data: { variables: instance.variables },
      });
      break;
    }
  }
}

export async function evaluateTransitions(
  instance: WorkflowInstanceRow,
  def: WorkflowDefinition
): Promise<void> {
  const state = def.states.find((s) => s.id === instance.currentStateId);
  if (!state) return;

  for (const transition of state.transitions) {
    if (checkCondition(transition.condition, instance)) {
      await handleTransition(instance, transition, def);
      return; // Only fire the first matching transition
    }
  }
}

function checkCondition(
  condition: WorkflowCondition,
  instance: WorkflowInstanceRow
): boolean {
  switch (condition.type) {
    case 'agent_complete':
      // Agent completion is signaled externally via notifyEvent
      return false;

    case 'trigger_fired':
      // Trigger fires are signaled externally via notifyEvent
      return false;

    case 'variable_check': {
      const value = instance.variables[condition.variable];
      switch (condition.operator) {
        case 'equals':
          return value === condition.value;
        case 'not_equals':
          return value !== condition.value;
        case 'contains':
          return typeof value === 'string' && typeof condition.value === 'string'
            && value.includes(condition.value);
        case 'greater_than':
          return typeof value === 'number' && typeof condition.value === 'number'
            && value > condition.value;
        case 'less_than':
          return typeof value === 'number' && typeof condition.value === 'number'
            && value < condition.value;
        case 'is_true':
          return !!value;
        default:
          return false;
      }
    }

    case 'timeout':
      // Timeout transitions are handled by timers set up in enterState
      return false;

    case 'manual':
      // Manual transitions are triggered by user action via notifyEvent
      return false;

    case 'cron':
      // Cron transitions are handled by external scheduling
      return false;

    default:
      return false;
  }
}

async function handleTransition(
  instance: WorkflowInstanceRow,
  transition: WorkflowTransition,
  def: WorkflowDefinition
): Promise<void> {
  const now = Date.now();

  // Complete the current step
  const currentStep = eventQueries.getCurrentStep(instance.id);
  if (currentStep) {
    eventQueries.updateStepLog(currentStep.id!, {
      status: 'completed',
      transitionName: transition.name,
      transitionCondition: transition.condition,
      variablesAfter: instance.variables,
      exitedAt: now,
      durationMs: now - currentStep.enteredAt,
    });

    emit({
      instanceId: instance.id,
      eventType: 'step_update',
      data: { stepLogId: currentStep.id, status: 'completed' },
    });
  }

  // Clear timers for this instance before transitioning
  clearInstanceTimers(instance.id);

  log.log(`Transition: ${instance.currentStateId} → ${transition.targetStateId} (${transition.name})`);

  // Enter the target state
  await enterState(instance, transition.targetStateId, def);
}

function setupTimeoutTransitions(
  instance: WorkflowInstanceRow,
  state: WorkflowState,
  def: WorkflowDefinition
): void {
  for (const transition of state.transitions) {
    if (transition.condition.type === 'timeout') {
      const timerKey = `${instance.id}:transition:${transition.id}`;
      const timer = setTimeout(() => {
        activeTimeouts.delete(timerKey);
        const freshInstance = eventQueries.getWorkflowInstance(instance.id);
        if (freshInstance && freshInstance.status === 'running') {
          void handleTransition(freshInstance, transition, def);
        }
      }, transition.condition.afterMs);
      timer.unref();
      activeTimeouts.set(timerKey, timer);
    }
  }
}

// ─── External Event Injection ───

export async function notifyEvent(params: {
  instanceId: string;
  eventType: 'trigger_fired' | 'agent_complete' | 'manual_transition';
  triggerId?: string;
  transitionId?: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const instance = eventQueries.getWorkflowInstance(params.instanceId);
  if (!instance || instance.status !== 'running') {
    log.log(`Ignoring event for instance ${params.instanceId} (status: ${instance?.status ?? 'not found'})`);
    return;
  }

  const def = workflowStore.getDefinition(instance.workflowDefId);
  if (!def) {
    log.error(`Definition not found for instance ${params.instanceId}`);
    return;
  }

  // Merge event data into instance variables
  if (params.data) {
    for (const [key, value] of Object.entries(params.data)) {
      const oldValue = instance.variables[key];
      instance.variables[key] = value;

      eventQueries.logVariableChange({
        workflowInstanceId: instance.id,
        variableName: key,
        oldValue,
        newValue: value,
        changedBy: `event:${params.eventType}`,
        changedAt: Date.now(),
      } as VariableChangeRow);
    }

    eventQueries.updateWorkflowInstance(instance.id, {
      variables: instance.variables,
      updatedAt: Date.now(),
    });
  }

  // Update current step with agent response if applicable
  if (params.eventType === 'agent_complete') {
    const currentStep = eventQueries.getCurrentStep(instance.id);
    if (currentStep && params.data) {
      eventQueries.updateStepLog(currentStep.id!, {
        agentResponse: params.data.agentResponse as string | undefined,
        agentReasoning: params.data.agentReasoning as string | undefined,
        agentSummary: params.data.agentSummary as string | undefined,
      });
    }
  }

  eventQueries.logAudit({
    category: 'workflow',
    action: `event:${params.eventType}`,
    workflowInstanceId: instance.id,
    details: {
      triggerId: params.triggerId,
      transitionId: params.transitionId,
      data: params.data,
    },
    level: 'info',
    createdAt: Date.now(),
  });

  const state = def.states.find((s) => s.id === instance.currentStateId);
  if (!state) return;

  // Find matching transition
  if (params.transitionId) {
    // Explicit transition (manual)
    const transition = state.transitions.find((t) => t.id === params.transitionId);
    if (transition) {
      await handleTransition(instance, transition, def);
    }
    return;
  }

  // Match by event type
  for (const transition of state.transitions) {
    let matches = false;

    if (params.eventType === 'agent_complete' && transition.condition.type === 'agent_complete') {
      matches = true;
    } else if (params.eventType === 'trigger_fired' && transition.condition.type === 'trigger_fired') {
      if (transition.condition.triggerId && params.triggerId) {
        matches = transition.condition.triggerId === params.triggerId;
      } else {
        matches = true;
      }
    }

    if (matches) {
      await handleTransition(instance, transition, def);
      return;
    }
  }
}

// ─── Explicit Transition (agent-driven) ───

export async function transitionTo(
  instanceId: string,
  targetStateId: string,
  reason?: string
): Promise<WorkflowInstanceRow> {
  const instance = eventQueries.getWorkflowInstance(instanceId);
  if (!instance) throw new Error(`Workflow instance not found: ${instanceId}`);
  if (instance.status !== 'running') throw new Error(`Instance ${instanceId} is not running (status: ${instance.status})`);

  const def = workflowStore.getDefinition(instance.workflowDefId);
  if (!def) throw new Error(`Workflow definition not found: ${instance.workflowDefId}`);

  const state = def.states.find(s => s.id === instance.currentStateId);
  if (!state) throw new Error(`Current state not found: ${instance.currentStateId}`);

  // Find a transition that targets the requested state
  const transition = state.transitions.find(t => t.targetStateId === targetStateId);
  if (!transition) {
    const validTargets = state.transitions.map(t => t.targetStateId).join(', ');
    throw new Error(`No transition from "${state.name}" to "${targetStateId}". Valid targets: ${validTargets}`);
  }

  log.log(`Explicit transition: ${instance.currentStateId} → ${targetStateId} (reason: ${reason ?? 'none'})`);

  // Log the reason in audit
  eventQueries.logAudit({
    category: 'workflow',
    action: 'explicit_transition',
    workflowInstanceId: instanceId,
    details: { from: instance.currentStateId, to: targetStateId, transitionId: transition.id, reason },
    level: 'info',
    createdAt: Date.now(),
  });

  await handleTransition(instance, transition, def);
  return eventQueries.getWorkflowInstance(instanceId)!;
}

export function getAvailableTransitions(instanceId: string): Array<{
  id: string;
  name: string;
  targetStateId: string;
  targetStateName: string;
  conditionType: string;
  condition: WorkflowCondition;
}> {
  const instance = eventQueries.getWorkflowInstance(instanceId);
  if (!instance) throw new Error(`Workflow instance not found: ${instanceId}`);

  const def = workflowStore.getDefinition(instance.workflowDefId);
  if (!def) throw new Error(`Workflow definition not found: ${instance.workflowDefId}`);

  const state = def.states.find(s => s.id === instance.currentStateId);
  if (!state) return [];

  return state.transitions.map(t => {
    const targetState = def.states.find(s => s.id === t.targetStateId);
    return {
      id: t.id,
      name: t.name,
      targetStateId: t.targetStateId,
      targetStateName: targetState?.name ?? 'unknown',
      conditionType: t.condition.type,
      condition: t.condition,
    };
  });
}

// ─── Variable Updates (called by agents via API) ───

export function updateVariables(
  instanceId: string,
  updates: Record<string, unknown>,
  changedBy: string
): void {
  const instance = eventQueries.getWorkflowInstance(instanceId);
  if (!instance) {
    throw new Error(`Workflow instance not found: ${instanceId}`);
  }

  const currentStep = eventQueries.getCurrentStep(instanceId);
  const now = Date.now();

  for (const [key, value] of Object.entries(updates)) {
    const oldValue = instance.variables[key];
    instance.variables[key] = value;

    eventQueries.logVariableChange({
      workflowInstanceId: instanceId,
      stepLogId: currentStep?.id,
      variableName: key,
      oldValue,
      newValue: value,
      changedBy,
      changedAt: now,
    } as VariableChangeRow);

    emit({
      instanceId,
      eventType: 'variable_changed',
      data: { variableName: key, oldValue, newValue: value, changedBy },
    });
  }

  eventQueries.updateWorkflowInstance(instanceId, {
    variables: instance.variables,
    updatedAt: now,
  });
}

// ─── History Queries (delegates to eventQueries) ───

export function getInstanceTimeline(instanceId: string): TimelineEntry[] {
  // Build timeline by querying step log and variable changes for this instance
  const timeline: TimelineEntry[] = [];

  const triggers = eventQueries.queryTriggerEvents({ workflowInstanceId: instanceId, limit: 1000 });
  for (const e of triggers.events) {
    timeline.push({ type: 'trigger', timestamp: e.firedAt, data: e });
  }

  const steps = eventQueries.getStepsByInstance(instanceId);
  for (const s of steps) {
    timeline.push({ type: 'step', timestamp: s.enteredAt, data: s });
  }

  const varChanges = eventQueries.getVariableHistory(instanceId);
  for (const v of varChanges) {
    timeline.push({ type: 'variable_change', timestamp: v.changedAt, data: v });
  }

  timeline.sort((a, b) => a.timestamp - b.timestamp);
  return timeline;
}

export function getInstanceSteps(instanceId: string): WorkflowStepLogRow[] {
  return eventQueries.getStepsByInstance(instanceId);
}

export function getInstanceVariableHistory(
  instanceId: string,
  variableName?: string
): VariableChangeRow[] {
  return eventQueries.getVariableHistory(instanceId, variableName);
}

export function getInstanceReasoning(instanceId: string): Array<{
  stateId: string;
  stateName: string;
  agentId?: string;
  promptSent?: string;
  agentResponse?: string;
  agentReasoning?: string;
  agentSummary?: string;
  durationMs?: number;
}> {
  const steps = eventQueries.getStepsByInstance(instanceId);
  return steps
    .filter((s) => s.promptSent || s.agentResponse || s.agentSummary)
    .map((s) => ({
      stateId: s.toStateId,
      stateName: s.toStateName,
      agentId: s.agentId,
      promptSent: s.promptSent,
      agentResponse: s.agentResponse,
      agentReasoning: s.agentReasoning,
      agentSummary: s.agentSummary,
      durationMs: s.durationMs,
    }));
}

// ─── Internal Helpers ───

function completeWorkflow(instanceId: string, stepLogId: number): void {
  const now = Date.now();

  eventQueries.updateStepLog(stepLogId, {
    status: 'completed',
    exitedAt: now,
    durationMs: 0,
  });

  eventQueries.updateWorkflowInstance(instanceId, {
    status: 'completed',
    completedAt: now,
    updatedAt: now,
  });

  clearInstanceTimers(instanceId);

  eventQueries.logAudit({
    category: 'workflow',
    action: 'workflow_completed',
    workflowInstanceId: instanceId,
    level: 'info',
    createdAt: now,
  });

  emit({ instanceId, eventType: 'completed' });
}

function failWorkflow(instanceId: string, error: string): void {
  const now = Date.now();

  eventQueries.updateWorkflowInstance(instanceId, {
    status: 'failed',
    error,
    completedAt: now,
    updatedAt: now,
  });

  clearInstanceTimers(instanceId);

  eventQueries.logAudit({
    category: 'workflow',
    action: 'workflow_failed',
    workflowInstanceId: instanceId,
    details: { error },
    level: 'error',
    createdAt: now,
  });

  emit({ instanceId, eventType: 'error', data: { error } });
}

function interpolateTemplate(
  template: string,
  variables: Record<string, unknown>,
  instanceId: string
): string {
  return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, key: string) => {
    if (key === 'workflow.instanceId') return instanceId;

    // Support dotted paths: workflow.variables.name → variables.name
    const parts = key.split('.');
    let value: unknown = variables;
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = (value as Record<string, unknown>)[part];
      } else {
        value = undefined;
        break;
      }
    }

    if (value === undefined || value === null) {
      // Try direct variable lookup
      value = variables[key];
    }

    return value !== undefined && value !== null ? String(value) : `{{${key}}}`;
  });
}
