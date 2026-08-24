import type { PluginTaskItem } from '../types';

export interface BolbaTaskDetailsModalData {
  task: PluginTaskItem;
  tasks: PluginTaskItem[];
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
  return { task: selectedTask, tasks: unique };
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
