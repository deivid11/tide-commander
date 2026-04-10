/**
 * Work Plan Service
 * Manages work plans created by boss agents, including parsing, storage, and execution
 */

import type {
  WorkPlan,
  WorkPlanPhase,
  WorkPlanDraft,
  AnalysisRequest,
  AnalysisRequestDraft,
  AgentClass,
  TaskPriority,
  WorkPlanTaskStatus,
} from '../../shared/types.js';
import * as agentService from './agent-service.js';
import { logger, generateId } from '../utils/index.js';

const log = logger.boss || console;

// In-memory storage for work plans and analysis requests
const workPlans: Map<string, WorkPlan> = new Map();
const analysisRequests: Map<string, AnalysisRequest> = new Map();

// Event listeners
type WorkPlanListener = (event: string, data: unknown) => void;
const listeners = new Set<WorkPlanListener>();

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
 * Start an analysis request (send to agent)
 */
export function startAnalysisRequest(requestId: string): AnalysisRequest | null {
  const request = analysisRequests.get(requestId);
  if (!request) return null;

  request.status = 'in_progress';
  emit('analysis_request_started', request);

  return request;
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
