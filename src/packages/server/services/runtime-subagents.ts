import type { RuntimeEvent } from '../runtime/index.js';

export interface ActiveSubagent {
  id: string;
  parentAgentId: string;
  toolUseId: string;
  name: string;
  description: string;
  subagentType: string;
  model?: string;
  startedAt: number;
  // Completion stats (populated when task completes)
  stats?: {
    durationMs: number;
    tokensUsed: number;
    toolUseCount: number;
  };
}

let subagentCounter = 0;
const activeSubagents = new Map<string, ActiveSubagent>();
const subagentIdToToolUseId = new Map<string, string>();

// Background tasks: the CLI assigns task_ids to async Task/Agent launches AND to slow
// Bash commands. The parent turn can end while these still run — the CLI wakes the
// model with a task-notification when each finishes. While any are pending the agent
// must NOT be flipped to idle.
const pendingBackgroundTasks = new Map<string, Map<string, string | undefined>>(); // parentAgentId -> toolUseId -> taskId

function generateSubagentId(): string {
  return `sub_${Date.now().toString(36)}_${(subagentCounter++).toString(36)}`;
}

export function handleTaskToolStart(
  agentId: string,
  event: RuntimeEvent,
  log: { log: (message: string) => void }
): ActiveSubagent | null {
  if ((event.toolName !== 'Task' && event.toolName !== 'Agent') || !event.toolUseId || !event.subagentName) {
    return null;
  }

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
  return subagent;
}

export function handleTaskToolResult(
  agentId: string,
  event: RuntimeEvent,
  log: { log: (message: string) => void }
): void {
  if ((event.toolName !== 'Task' && event.toolName !== 'Agent') || !event.toolUseId) {
    return;
  }

  const subagent = activeSubagents.get(event.toolUseId);
  if (!subagent) {
    return;
  }

  log.log(`[Subagent] Completed: ${subagent.name} (${subagent.id}) for agent ${agentId}`);
  event.subagentName = subagent.name;
  // Store completion stats from event onto the subagent before removal
  if (event.subagentStats) {
    subagent.stats = event.subagentStats;
  }
  activeSubagents.delete(event.toolUseId);
  subagentIdToToolUseId.delete(subagent.id);
}

export function addPendingBackgroundTask(agentId: string, toolUseId: string, taskId?: string): void {
  let tasks = pendingBackgroundTasks.get(agentId);
  if (!tasks) {
    tasks = new Map();
    pendingBackgroundTasks.set(agentId, tasks);
  }
  tasks.set(toolUseId, taskId);
}

export function resolvePendingBackgroundTask(agentId: string, toolUseId: string): boolean {
  const tasks = pendingBackgroundTasks.get(agentId);
  if (!tasks?.delete(toolUseId)) {
    return false;
  }
  if (tasks.size === 0) {
    pendingBackgroundTasks.delete(agentId);
  }
  return true;
}

export function resolvePendingBackgroundTaskByTaskId(agentId: string, taskId: string): boolean {
  const tasks = pendingBackgroundTasks.get(agentId);
  if (!tasks) {
    return false;
  }
  for (const [toolUseId, pendingTaskId] of tasks) {
    if (pendingTaskId === taskId) {
      return resolvePendingBackgroundTask(agentId, toolUseId);
    }
  }
  return false;
}

export function hasPendingBackgroundTasks(agentId: string): boolean {
  return (pendingBackgroundTasks.get(agentId)?.size ?? 0) > 0;
}

export function clearPendingBackgroundTasks(agentId: string): void {
  pendingBackgroundTasks.delete(agentId);
}

export function getActiveSubagentByToolUseId(toolUseId: string): ActiveSubagent | undefined {
  return activeSubagents.get(toolUseId);
}

export function getActiveSubagentsForAgent(parentAgentId: string): ActiveSubagent[] {
  return Array.from(activeSubagents.values()).filter((subagent) => subagent.parentAgentId === parentAgentId);
}

export function resetSubagentStateForTests(): void {
  activeSubagents.clear();
  subagentIdToToolUseId.clear();
  pendingBackgroundTasks.clear();
  subagentCounter = 0;
}
