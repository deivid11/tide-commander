/**
 * Workflow Executor
 * Orchestration layer for the Workflow-as-Agent architecture.
 *
 * Adds three capabilities on top of workflow-service.ts:
 *   1. handleTrigger — routes an incoming trigger to the correct workflow instance
 *   2. executeInstanceState — enters a state with agent binding and reasoning capture
 *   3. transitionInstance — transitions with reasoning/summary capture
 *
 * The core state machine (enterState, evaluateTransitions, etc.) lives in
 * workflow-service.ts.  This module deals only with the agent binding,
 * trigger routing, and reasoning-capture concerns.
 */

import { createLogger } from '../utils/logger.js';
import * as workflowService from './workflow-service.js';
import * as workflowStore from '../data/workflow-store.js';
import * as eventQueries from '../data/event-queries.js';
import type {
  WorkflowDefinition,
  WorkflowState,
} from '../../shared/workflow-types.js';
import type {
  WorkflowInstanceRow,
  WorkflowStepLogRow,
} from '../../shared/event-types.js';

const log = createLogger('WorkflowExecutor');

// ─── Types ───

export interface TriggerPayload {
  triggerId: string;
  triggerData: Record<string, unknown>;
  agentId?: string;
}

export interface AgentResult {
  agentResponse?: string;
  agentReasoning?: string;
  agentSummary?: string;
  variables?: Record<string, unknown>;
}

// ─── Handle Trigger ───

/**
 * Route an incoming trigger to the matching workflow instance(s).
 *
 * Resolution order:
 *   1. Find running workflow instances whose trigger_id matches the incoming triggerId.
 *   2. If none found, search workflow definitions for states that reference this triggerId
 *      (via wait_for_trigger or trigger_setup actions) and create a new instance.
 *   3. If still no match, log and return — the trigger is not wired to any workflow.
 *
 * When a match is found, the trigger data is forwarded to the instance via
 * workflowService.notifyEvent so the state machine can evaluate transitions.
 */
export async function handleTrigger(payload: TriggerPayload): Promise<void> {
  const { triggerId, triggerData } = payload;

  // 1. Try to find a running instance waiting for this trigger
  const runningInstances = eventQueries.listWorkflowInstances({ status: 'running' });
  const matchedInstances = runningInstances.filter(inst => {
    // Check if the instance has this trigger in its active triggers
    if (inst.activeTriggerIds.includes(triggerId)) return true;
    // Check if the instance was started by this trigger
    if (inst.triggerId === triggerId) return true;
    return false;
  });

  if (matchedInstances.length > 0) {
    for (const instance of matchedInstances) {
      log.log(`Routing trigger ${triggerId} to instance ${instance.id}`);
      await workflowService.notifyEvent({
        instanceId: instance.id,
        eventType: 'trigger_fired',
        triggerId,
        data: triggerData as Record<string, unknown>,
      });
    }
    return;
  }

  // 2. Search definitions for a state wired to this trigger
  const definitions = workflowStore.listDefinitions();
  const matchingDef = findDefinitionForTrigger(definitions, triggerId);

  if (matchingDef) {
    log.log(`Trigger ${triggerId} matched definition ${matchingDef.id} — starting new instance`);
    const instance = await startWorkflowForTrigger(matchingDef, payload);
    log.log(`Created instance ${instance.id} for trigger ${triggerId}`);
    return;
  }

  // 3. No match
  log.log(`Trigger ${triggerId} has no matching workflow — ignoring`);
}

/**
 * Search workflow definitions for any state whose action references the given triggerId.
 */
function findDefinitionForTrigger(
  definitions: WorkflowDefinition[],
  triggerId: string
): WorkflowDefinition | undefined {
  for (const def of definitions) {
    for (const state of def.states) {
      if (!state.action) continue;

      if (state.action.type === 'wait_for_trigger' && state.action.triggerId === triggerId) {
        return def;
      }
      if (state.action.type === 'trigger_setup') {
        const config = state.action.triggerConfig as Record<string, unknown>;
        if (config.triggerId === triggerId) return def;
      }

      // Also check transition conditions for trigger_fired with specific triggerId
      for (const transition of state.transitions) {
        if (
          transition.condition.type === 'trigger_fired' &&
          transition.condition.triggerId === triggerId
        ) {
          return def;
        }
      }
    }
  }
  return undefined;
}

/**
 * Start a new workflow instance in response to a trigger fire.
 * Binds the trigger correlation and optional agent ID to the instance.
 */
async function startWorkflowForTrigger(
  def: WorkflowDefinition,
  payload: TriggerPayload
): Promise<WorkflowInstanceRow> {
  // Start the workflow through the existing service
  const instance = await workflowService.startWorkflow({
    workflowDefId: def.id,
    initialVariables: payload.triggerData as Record<string, unknown>,
  });

  // Bind the trigger and agent correlation
  eventQueries.updateWorkflowInstance(instance.id, {
    triggerId: payload.triggerId,
    triggerData: payload.triggerData,
    agentId: payload.agentId,
    updatedAt: Date.now(),
  });

  return eventQueries.getWorkflowInstance(instance.id)!;
}

// ─── Execute Instance State ───

/**
 * Execute a specific state in a workflow instance, capturing agent binding.
 *
 * This is called when an agent is about to execute a state's action.
 * It updates the step log with the agent ID and records the prompt being sent.
 */
export function executeInstanceState(
  instanceId: string,
  stateId: string,
  agentId: string
): { instance: WorkflowInstanceRow; state: WorkflowState; currentStep: WorkflowStepLogRow | undefined } {
  const instance = eventQueries.getWorkflowInstance(instanceId);
  if (!instance) {
    throw new Error(`Workflow instance not found: ${instanceId}`);
  }

  if (instance.status !== 'running') {
    throw new Error(`Instance ${instanceId} is not running (status: ${instance.status})`);
  }

  const def = workflowStore.getDefinition(instance.workflowDefId);
  if (!def) {
    throw new Error(`Workflow definition not found: ${instance.workflowDefId}`);
  }

  const state = def.states.find(s => s.id === stateId);
  if (!state) {
    throw new Error(`State ${stateId} not found in workflow ${def.id}`);
  }

  // Bind agent to instance if not already bound
  if (!instance.agentId) {
    eventQueries.updateWorkflowInstance(instanceId, {
      agentId,
      updatedAt: Date.now(),
    });
  }

  // Update current step with the agent ID
  const currentStep = eventQueries.getCurrentStep(instanceId);
  if (currentStep) {
    eventQueries.updateStepLog(currentStep.id!, { agentId });
  }

  return { instance, state, currentStep };
}

// ─── Transition Instance ───

/**
 * Transition a workflow instance to the next state, capturing reasoning and summary.
 *
 * This wraps workflowService.notifyEvent with reasoning capture:
 *   - agentResponse: the raw output from the agent
 *   - agentReasoning: the agent's chain-of-thought or decision explanation
 *   - agentSummary: a short human-readable summary for the timeline
 */
export async function transitionInstance(
  instanceId: string,
  eventType: 'agent_complete' | 'trigger_fired' | 'manual_transition',
  result: AgentResult,
  opts?: { triggerId?: string; transitionId?: string }
): Promise<WorkflowInstanceRow | undefined> {
  const instance = eventQueries.getWorkflowInstance(instanceId);
  if (!instance) {
    log.error(`Cannot transition: instance ${instanceId} not found`);
    return undefined;
  }

  // Capture reasoning on the current step before transitioning
  const currentStep = eventQueries.getCurrentStep(instanceId);
  if (currentStep) {
    const stepUpdates: Partial<WorkflowStepLogRow> = {};

    if (result.agentResponse !== undefined) {
      stepUpdates.agentResponse = result.agentResponse;
    }
    if (result.agentReasoning !== undefined) {
      stepUpdates.agentReasoning = result.agentReasoning;
    }
    if (result.agentSummary !== undefined) {
      stepUpdates.agentSummary = result.agentSummary;
    }

    if (Object.keys(stepUpdates).length > 0) {
      eventQueries.updateStepLog(currentStep.id!, stepUpdates);
    }
  }

  // Build the event data payload (merge agent result variables)
  const eventData: Record<string, unknown> = { ...result.variables };
  if (result.agentResponse) eventData.agentResponse = result.agentResponse;
  if (result.agentReasoning) eventData.agentReasoning = result.agentReasoning;
  if (result.agentSummary) eventData.agentSummary = result.agentSummary;

  // Forward to the state machine
  await workflowService.notifyEvent({
    instanceId,
    eventType,
    triggerId: opts?.triggerId,
    transitionId: opts?.transitionId,
    data: Object.keys(eventData).length > 0 ? eventData : undefined,
  });

  return eventQueries.getWorkflowInstance(instanceId);
}

// ─── Query Helpers ───

/**
 * Get all workflow instances bound to a specific agent.
 */
export function getInstancesByAgent(agentId: string, opts?: { status?: string; limit?: number }): WorkflowInstanceRow[] {
  const allInstances = eventQueries.listWorkflowInstances({
    status: opts?.status,
    limit: opts?.limit ?? 50,
  });
  return allInstances.filter(inst => inst.agentId === agentId);
}

/**
 * Get the reasoning chain for an instance, including agentSummary.
 */
export function getReasoningChain(instanceId: string): Array<{
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
    .filter(s => s.promptSent || s.agentResponse || s.agentSummary)
    .map(s => ({
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
