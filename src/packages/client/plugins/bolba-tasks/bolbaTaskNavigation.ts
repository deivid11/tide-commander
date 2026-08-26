import type { PluginTaskItem } from '../types';

export interface BolbaTaskCompletionContext {
  agentId: string;
  instanceId: string;
  rendererId: string;
  action: string;
  data: unknown;
}

export interface BolbaTaskDetailsModalData {
  task: PluginTaskItem;
  tasks: PluginTaskItem[];
  completion?: BolbaTaskCompletionContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isTaskItem(value: unknown): value is PluginTaskItem {
  if (!value || typeof value !== 'object') return false;
  const task = value as Partial<PluginTaskItem>;
  return (typeof task.id === 'string' || typeof task.id === 'number') && typeof task.title === 'string';
}

export function resolveBolbaTaskDetailsModalData(data: unknown): BolbaTaskDetailsModalData | null {
  if (isTaskItem(data)) return { task: data, tasks: [data] };
  if (!isRecord(data)) return null;
  const selectedTask = data.task;
  if (!isTaskItem(selectedTask)) return null;
  const tasks = Array.isArray(data.tasks) ? data.tasks.filter(isTaskItem) : [];
  const unique = tasks.filter((task, index) => (
    tasks.findIndex((candidate) => String(candidate.id) === String(task.id)) === index
  ));
  if (!unique.some((task) => String(task.id) === String(selectedTask.id))) unique.unshift(selectedTask);
  const rawCompletion = data.completion;
  const completion = isRecord(rawCompletion)
    && typeof rawCompletion.agentId === 'string'
    && typeof rawCompletion.instanceId === 'string'
    && typeof rawCompletion.rendererId === 'string'
    && typeof rawCompletion.action === 'string'
    ? {
        agentId: rawCompletion.agentId,
        instanceId: rawCompletion.instanceId,
        rendererId: rawCompletion.rendererId,
        action: rawCompletion.action,
        data: rawCompletion.data,
      }
    : undefined;
  return { task: selectedTask, tasks: unique, ...(completion ? { completion } : {}) };
}

export function adjacentBolbaTask(
  tasks: PluginTaskItem[],
  currentId: PluginTaskItem['id'],
  direction: -1 | 1,
): PluginTaskItem | null {
  const index = tasks.findIndex((task) => String(task.id) === String(currentId));
  const adjacentIndex = index + direction;
  return index >= 0 && adjacentIndex >= 0 && adjacentIndex < tasks.length
    ? tasks[adjacentIndex]
    : null;
}
