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
}

let subagentCounter = 0;
const activeSubagents = new Map<string, ActiveSubagent>();
const subagentIdToToolUseId = new Map<string, string>();

function generateSubagentId(): string {
  return `sub_${Date.now().toString(36)}_${(subagentCounter++).toString(36)}`;
}

export function handleTaskToolStart(
  agentId: string,
  event: RuntimeEvent,
  log: { log: (message: string) => void }
): ActiveSubagent | null {
  if (event.toolName !== 'Task' || !event.toolUseId || !event.subagentName) {
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
  if (event.toolName !== 'Task' || !event.toolUseId) {
    return;
  }

  const subagent = activeSubagents.get(event.toolUseId);
  if (!subagent) {
    return;
  }

  log.log(`[Subagent] Completed: ${subagent.name} (${subagent.id}) for agent ${agentId}`);
  event.subagentName = subagent.name;
  activeSubagents.delete(event.toolUseId);
  subagentIdToToolUseId.delete(subagent.id);
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
  subagentCounter = 0;
}
