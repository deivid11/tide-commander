/**
 * Work Plan Service
 * Manages work plans created by boss agents, including parsing, storage, and execution
 */

import type {
  WorkPlan,
  WorkPlanPhase,
  WorkPlanTask,
  WorkPlanDraft,
  AnalysisRequest,
  AnalysisRequestDraft,
  AgentClass,
  TaskPriority,
  WorkPlanTaskStatus,
} from '../../shared/types.js';
import * as agentService from './agent-service.js';
import * as bossService from './boss-service.js';
import { logger, generateId } from '../utils/index.js';

const log = logger.boss || console;

// In-memory storage for work plans and analysis requests
const workPlans: Map<string, WorkPlan> = new Map();
const analysisRequests: Map<string, AnalysisRequest> = new Map();

// Event listeners
type WorkPlanListener = (event: string, data: unknown) => void;
const listeners = new Set<WorkPlanListener>();

// ============================================================================
// Event System
// ============================================================================

export function subscribe(listener: WorkPlanListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: string, data: unknown): void {
  listeners.forEach((listener) => listener(event, data));
}

// ============================================================================
// Work Plan Management
// ============================================================================

/**
 * Create a work plan from a draft (parsed from boss response)
 */
export function createWorkPlan(bossId: string, draft: WorkPlanDraft): WorkPlan {
  const now = Date.now();
  const planId = generateId();

  // Convert draft phases to full phases with proper status
  const phases: WorkPlanPhase[] = draft.phases.map((phase) => ({
    id: phase.id,
    name: phase.name,
    execution: phase.execution,
    dependsOn: phase.dependsOn,
    status: 'pending' as WorkPlanTaskStatus,
    tasks: phase.tasks.map((task) => ({
      id: task.id,
      description: task.description,
      suggestedClass: task.suggestedClass as AgentClass,
      assignedAgentId: task.assignToAgent,
      priority: task.priority as TaskPriority,
      blockedBy: task.blockedBy,
      status: 'pending' as WorkPlanTaskStatus,
    })),
  }));

  // Calculate total tasks and parallelizable tasks
  const allTasks = phases.flatMap((p) => p.tasks);
  const parallelPhases = phases.filter((p) => p.execution === 'parallel');
  const parallelizableTasks = parallelPhases.flatMap((p) => p.tasks.map((t) => t.id));

  const workPlan: WorkPlan = {
    id: planId,
    name: draft.name,
    description: draft.description,
    phases,
    createdBy: bossId,
    createdAt: now,
    updatedAt: now,
    status: 'draft',
    totalTasks: allTasks.length,
    completedTasks: 0,
    parallelizableTasks,
  };

  workPlans.set(planId, workPlan);
  log.log?.(`📋 Created work plan "${workPlan.name}" with ${workPlan.totalTasks} tasks`);
  emit('work_plan_created', workPlan);

  return workPlan;
}

/**
 * Get a work plan by ID
 */
export function getWorkPlan(planId: string): WorkPlan | null {
  return workPlans.get(planId) || null;
}

/**
 * Get all work plans for a boss
 */
export function getWorkPlansForBoss(bossId: string): WorkPlan[] {
  return Array.from(workPlans.values()).filter((p) => p.createdBy === bossId);
}

/**
 * Get all work plans
 */
export function getAllWorkPlans(): WorkPlan[] {
  return Array.from(workPlans.values());
}

/**
 * Approve a work plan for execution
 */
export function approveWorkPlan(planId: string): WorkPlan | null {
  const plan = workPlans.get(planId);
  if (!plan) return null;
  if (plan.status !== 'draft') {
    log.log?.(`⚠️ Cannot approve plan "${plan.name}" - status is ${plan.status}`);
    return null;
  }

  plan.status = 'approved';
  plan.updatedAt = Date.now();
  emit('work_plan_updated', plan);
  log.log?.(`✅ Approved work plan "${plan.name}"`);

  return plan;
}

/**
 * Start executing a work plan
 */
export function executeWorkPlan(planId: string): WorkPlan | null {
  const plan = workPlans.get(planId);
  if (!plan) return null;
  if (plan.status !== 'approved') {
    log.log?.(`⚠️ Cannot execute plan "${plan.name}" - status is ${plan.status}`);
    return null;
  }

  plan.status = 'executing';
  plan.updatedAt = Date.now();

  // Start first phase(s) that have no dependencies
  const readyPhases = plan.phases.filter((p) => p.dependsOn.length === 0);
  for (const phase of readyPhases) {
    startPhase(plan, phase);
  }

  emit('work_plan_updated', plan);
  log.log?.(`🚀 Started executing work plan "${plan.name}"`);

  return plan;
}

/**
 * Pause a work plan
 */
export function pauseWorkPlan(planId: string): WorkPlan | null {
  const plan = workPlans.get(planId);
  if (!plan) return null;
  if (plan.status !== 'executing') {
    log.log?.(`⚠️ Cannot pause plan "${plan.name}" - status is ${plan.status}`);
    return null;
  }

  plan.status = 'paused';
  plan.updatedAt = Date.now();
  emit('work_plan_updated', plan);
  log.log?.(`⏸️ Paused work plan "${plan.name}"`);

  return plan;
}

/**
 * Cancel a work plan
 */
export function cancelWorkPlan(planId: string): WorkPlan | null {
  const plan = workPlans.get(planId);
  if (!plan) return null;

  plan.status = 'cancelled';
  plan.updatedAt = Date.now();

  // Cancel all pending/in_progress tasks
  for (const phase of plan.phases) {
    if (phase.status === 'pending' || phase.status === 'in_progress') {
      phase.status = 'cancelled';
    }
    for (const task of phase.tasks) {
      if (task.status === 'pending' || task.status === 'in_progress') {
        task.status = 'cancelled';
      }
    }
  }

  emit('work_plan_updated', plan);
  log.log?.(`❌ Cancelled work plan "${plan.name}"`);

  return plan;
}

/**
 * Delete a work plan
 */
export function deleteWorkPlan(planId: string): boolean {
  const plan = workPlans.get(planId);
  if (!plan) return false;

  workPlans.delete(planId);
  emit('work_plan_deleted', { id: planId });
  log.log?.(`🗑️ Deleted work plan "${plan.name}"`);

  return true;
}

/**
 * Start a phase in a work plan
 */
function startPhase(plan: WorkPlan, phase: WorkPlanPhase): void {
  phase.status = 'in_progress';
  phase.startedAt = Date.now();

  // Start tasks that have no blockers
  const readyTasks = phase.tasks.filter((t) => t.blockedBy.length === 0);

  if (phase.execution === 'parallel') {
    // Start all ready tasks in parallel
    for (const task of readyTasks) {
      startTask(plan, phase, task);
    }
  } else {
    // Sequential - start only the first ready task
    if (readyTasks.length > 0) {
      startTask(plan, phase, readyTasks[0]);
    }
  }
}

/**
 * Start a task - auto-assign agent if needed and delegate
 */
function startTask(plan: WorkPlan, phase: WorkPlanPhase, task: WorkPlanTask): void {
  task.status = 'in_progress';
  task.startedAt = Date.now();

  // Auto-assign agent if not already assigned
  if (!task.assignedAgentId) {
    const agent = findBestAgentForTask(plan.createdBy, task);
    if (agent) {
      task.assignedAgentId = agent.id;
      task.assignedAgentName = agent.name;
    }
  }

  if (task.assignedAgentId) {
    const agent = agentService.getAgent(task.assignedAgentId);
    task.assignedAgentName = agent?.name;
    log.log?.(`🎯 Started task "${task.description}" → ${task.assignedAgentName || task.assignedAgentId}`);

    // Emit delegation event for the handler to pick up
    emit('task_started', {
      planId: plan.id,
      phaseId: phase.id,
      task,
      agentId: task.assignedAgentId,
    });
  } else {
    log.log?.(`⚠️ No agent available for task "${task.description}"`);
    task.status = 'blocked';
  }

  plan.updatedAt = Date.now();
  emit('work_plan_updated', plan);
}

/**
 * Find the best available agent for a task based on class and availability
 */
function findBestAgentForTask(bossId: string, task: WorkPlanTask): { id: string; name: string } | null {
  const subordinates = bossService.getSubordinates(bossId);

  // First, try to find an idle agent of the suggested class
  const idealAgent = subordinates.find(
    (a) => a.class === task.suggestedClass && a.status === 'idle'
  );
  if (idealAgent) {
    return { id: idealAgent.id, name: idealAgent.name };
  }

  // If no idle agent of the right class, find any idle agent
  const anyIdleAgent = subordinates.find((a) => a.status === 'idle');
  if (anyIdleAgent) {
    return { id: anyIdleAgent.id, name: anyIdleAgent.name };
  }

  // If all agents are busy, find the one with lowest context usage of the right class
  const sameClassAgents = subordinates.filter((a) => a.class === task.suggestedClass);
  if (sameClassAgents.length > 0) {
    const lowestContext = sameClassAgents.reduce((a, b) =>
      (a.contextUsed / a.contextLimit) < (b.contextUsed / b.contextLimit) ? a : b
    );
    return { id: lowestContext.id, name: lowestContext.name };
  }

  // Fallback to any agent with lowest context
  if (subordinates.length > 0) {
    const lowestContext = subordinates.reduce((a, b) =>
      (a.contextUsed / a.contextLimit) < (b.contextUsed / b.contextLimit) ? a : b
    );
    return { id: lowestContext.id, name: lowestContext.name };
  }

  return null;
}

/**
 * Mark a task as completed and check for next tasks/phases
 */
export function completeTask(planId: string, taskId: string, result?: string): WorkPlan | null {
  const plan = workPlans.get(planId);
  if (!plan) return null;

  // Find the task
  let targetTask: WorkPlanTask | null = null;
  let targetPhase: WorkPlanPhase | null = null;

  for (const phase of plan.phases) {
    const task = phase.tasks.find((t) => t.id === taskId);
    if (task) {
      targetTask = task;
      targetPhase = phase;
      break;
    }
  }

  if (!targetTask || !targetPhase) {
    log.log?.(`⚠️ Task ${taskId} not found in plan ${planId}`);
    return null;
  }

  // Mark task complete
  targetTask.status = 'completed';
  targetTask.completedAt = Date.now();
  targetTask.result = result;
  plan.completedTasks++;

  log.log?.(`✅ Completed task "${targetTask.description}"`);

  // Check for tasks that were blocked by this one
  for (const phase of plan.phases) {
    for (const task of phase.tasks) {
      if (task.status === 'pending' && task.blockedBy.includes(taskId)) {
        // Remove this task from blockers
        task.blockedBy = task.blockedBy.filter((id) => id !== taskId);

        // If no more blockers and phase is in progress, start the task
        if (task.blockedBy.length === 0 && phase.status === 'in_progress') {
          if (phase.execution === 'parallel') {
            startTask(plan, phase, task);
          } else {
            // Sequential - only start if no other task is in progress
            const inProgressTask = phase.tasks.find((t) => t.status === 'in_progress');
            if (!inProgressTask) {
              startTask(plan, phase, task);
            }
          }
        }
      }
    }
  }

  // Check if phase is complete
  const allTasksComplete = targetPhase.tasks.every((t) => t.status === 'completed');
  if (allTasksComplete) {
    targetPhase.status = 'completed';
    targetPhase.completedAt = Date.now();
    log.log?.(`✅ Completed phase "${targetPhase.name}"`);

    // Check for phases that depend on this one
    for (const phase of plan.phases) {
      if (phase.status === 'pending' && phase.dependsOn.includes(targetPhase.id)) {
        // Remove this phase from dependencies
        phase.dependsOn = phase.dependsOn.filter((id) => id !== targetPhase.id);

        // If no more dependencies, start the phase
        if (phase.dependsOn.length === 0) {
          startPhase(plan, phase);
        }
      }
    }
  }

  // Check if entire plan is complete
  const allPhasesComplete = plan.phases.every((p) => p.status === 'completed');
  if (allPhasesComplete) {
    plan.status = 'completed';
    log.log?.(`🎉 Completed work plan "${plan.name}"`);
  }

  plan.updatedAt = Date.now();
  emit('work_plan_updated', plan);

  return plan;
}

// ============================================================================
// Analysis Request Management
// ============================================================================

/**
 * Create an analysis request from a draft (parsed from boss response)
 */
export function createAnalysisRequest(bossId: string, draft: AnalysisRequestDraft): AnalysisRequest {
  const now = Date.now();
  const requestId = generateId();

  const agent = agentService.getAgent(draft.targetAgent);

  const request: AnalysisRequest = {
    id: requestId,
    targetAgentId: draft.targetAgent,
    targetAgentName: agent?.name,
    query: draft.query,
    focus: draft.focus,
    status: 'pending',
    requestedAt: now,
  };

  analysisRequests.set(requestId, request);
  log.log?.(`🔍 Created analysis request for ${request.targetAgentName || request.targetAgentId}`);
  emit('analysis_request_created', request);

  return request;
}

/**
 * Get an analysis request by ID
 */
export function getAnalysisRequest(requestId: string): AnalysisRequest | null {
  return analysisRequests.get(requestId) || null;
}

/**
 * Start an analysis request (send to agent)
 */
export function startAnalysisRequest(requestId: string): AnalysisRequest | null {
  const request = analysisRequests.get(requestId);
  if (!request) return null;

  request.status = 'in_progress';
  emit('analysis_request_started', request);

  return request;
}

/**
 * Complete an analysis request with results
 */
export function completeAnalysisRequest(requestId: string, result: string): AnalysisRequest | null {
  const request = analysisRequests.get(requestId);
  if (!request) return null;

  request.status = 'completed';
  request.result = result;
  request.completedAt = Date.now();

  log.log?.(`✅ Completed analysis request from ${request.targetAgentName || request.targetAgentId}`);
  emit('analysis_request_completed', request);

  return request;
}

/**
 * Get all pending analysis requests for a boss's subordinates
 */
export function getPendingAnalysisRequests(bossId: string): AnalysisRequest[] {
  const subordinateIds = bossService.getSubordinates(bossId).map((a) => a.id);
  return Array.from(analysisRequests.values()).filter(
    (r) => r.status === 'pending' && subordinateIds.includes(r.targetAgentId)
  );
}

// ============================================================================
// Parsing Utilities
// ============================================================================

/**
 * Parse work-plan block from boss response
 */
export function parseWorkPlanBlock(content: string): WorkPlanDraft | null {
  const match = content.match(/```work-plan\s*([\s\S]*?)```/);
  if (!match) return null;

  try {
    const json = match[1].trim();
    const draft = JSON.parse(json) as WorkPlanDraft;

    // Validate required fields
    if (!draft.name || !draft.phases || !Array.isArray(draft.phases)) {
      log.log?.('⚠️ Invalid work-plan: missing required fields');
      return null;
    }

    return draft;
  } catch (err) {
    log.log?.('⚠️ Failed to parse work-plan JSON:', err);
    return null;
  }
}

/**
 * Parse analysis-request block from boss response
 */
export function parseAnalysisRequestBlock(content: string): AnalysisRequestDraft[] {
  const match = content.match(/```analysis-request\s*([\s\S]*?)```/);
  if (!match) return [];

  try {
    const json = match[1].trim();
    const drafts = JSON.parse(json) as AnalysisRequestDraft[];

    if (!Array.isArray(drafts)) {
      return [drafts as AnalysisRequestDraft];
    }

    // Validate each request
    return drafts.filter((d) => d.targetAgent && d.query);
  } catch (err) {
    log.log?.('⚠️ Failed to parse analysis-request JSON:', err);
    return [];
  }
}

// ============================================================================
// Conversion Utilities
// ============================================================================

/**
 * Convert work plan tasks to delegation format for immediate execution
 */
export function convertTasksToDelegations(plan: WorkPlan): Array<{
  selectedAgentId: string;
  selectedAgentName: string;
  taskCommand: string;
  reasoning: string;
  confidence: 'high' | 'medium' | 'low';
}> {
  const delegations: Array<{
    selectedAgentId: string;
    selectedAgentName: string;
    taskCommand: string;
    reasoning: string;
    confidence: 'high' | 'medium' | 'low';
  }> = [];

  // Get tasks that are ready to execute (in phases with no dependencies)
  for (const phase of plan.phases) {
    if (phase.dependsOn.length > 0) continue; // Skip phases with dependencies

    for (const task of phase.tasks) {
      if (task.blockedBy.length > 0) continue; // Skip tasks with blockers
      if (!task.assignedAgentId) continue; // Skip unassigned tasks

      delegations.push({
        selectedAgentId: task.assignedAgentId,
        selectedAgentName: task.assignedAgentName || task.assignedAgentId,
        taskCommand: task.description,
        reasoning: `Work plan task: ${phase.name} (${phase.execution})`,
        confidence: task.priority === 'high' ? 'high' : task.priority === 'medium' ? 'medium' : 'low',
      });
    }
  }

  return delegations;
}
