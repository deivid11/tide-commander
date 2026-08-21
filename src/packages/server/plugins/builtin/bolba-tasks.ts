import type {
  PluginActionContext,
  PluginTaskItem,
  PluginTaskListData,
  TideServerPluginActivation,
} from '../../../shared/plugin-types.js';
import type { BuiltinPluginDefinition } from '../manager.js';

const DEFAULT_BOLBA_TASKS_URL = 'http://127.0.0.1:7492';
const DEFAULT_BOLBA_TASKS_TOKEN = 'abcd';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_TASKS = 500;
const RECENT_COMPLETED_LIMIT = 8;
const PENDING_STATUSES = new Set(['open', 'waiting', 'delegated']);
const COMPLETED_STATUSES = new Set(['done', 'completed']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function getConfig(): { baseUrl: string; token: string } {
  const configuredUrl = process.env.BOLBA_TASKS_URL?.trim() || DEFAULT_BOLBA_TASKS_URL;
  return {
    baseUrl: configuredUrl.replace(/\/+$/, ''),
    token: process.env.BOLBA_TASKS_TOKEN ?? DEFAULT_BOLBA_TASKS_TOKEN,
  };
}

async function bolbaRequest(endpoint: string, init?: RequestInit): Promise<unknown> {
  const { baseUrl, token } = getConfig();
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...init,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      Accept: 'application/json',
      'X-Auth-Token': token,
      'X-Actor': 'tide-commander',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try { payload = JSON.parse(text) as unknown; } catch { payload = text; }
  }
  if (!response.ok) {
    const detail = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : typeof payload === 'string' && payload.length < 500
        ? payload
        : response.statusText;
    throw new Error(`Bolba Tasks request failed (${response.status}): ${detail || 'Unknown error'}`);
  }
  return payload;
}

function toTaskItem(value: unknown): PluginTaskItem | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'number' || typeof value.id === 'string' ? value.id : undefined;
  const title = optionalString(value.title) ?? optionalString(value.head);
  if (id === undefined || !title) return null;
  return {
    id,
    title,
    status: optionalString(value.status),
    project: optionalString(value.proj) ?? optionalString(value.project),
    registeredAt: optionalString(value.reg) ?? optionalString(value.created_at),
    due: optionalString(value.due),
    description: optionalString(value.description) ?? optionalString(value.notes),
    metadata: { ...value },
  };
}

function taskArray(payload: unknown, label: string): unknown[] {
  if (!isRecord(payload) || !Array.isArray(payload.tasks)) {
    throw new Error(`Bolba Tasks returned an invalid ${label} response`);
  }
  return payload.tasks;
}

export async function fetchPendingTasks(): Promise<PluginTaskListData> {
  const [pendingPayload, completedPayload] = await Promise.all([
    bolbaRequest('/tasks'),
    bolbaRequest(`/tasks?status=done&limit=${RECENT_COMPLETED_LIMIT}`),
  ]);
  const pendingItems = taskArray(pendingPayload, 'task-list')
    .map(toTaskItem)
    .filter((item): item is PluginTaskItem => item !== null && PENDING_STATUSES.has((item.status ?? '').toLowerCase()))
    .slice(0, MAX_TASKS);
  const completedItems = taskArray(completedPayload, 'completed-task-list')
    .map(toTaskItem)
    .filter((item): item is PluginTaskItem => item !== null && COMPLETED_STATUSES.has((item.status ?? '').toLowerCase()))
    .slice(0, RECENT_COMPLETED_LIMIT);
  const items = [...pendingItems, ...completedItems];
  return {
    kind: 'task-list',
    title: 'Bolba Tasks',
    emptyMessage: 'No pending or recently completed tasks',
    count: items.length,
    items,
    actions: {
      complete: 'complete',
      reopen: 'reopen',
      refresh: 'refresh',
      openDetails: 'openDetails',
    },
  };
}

function getTaskId(context: PluginActionContext): string {
  const nestedId = isRecord(context.item)
    && (typeof context.item.id === 'number' || typeof context.item.id === 'string')
    ? context.item.id
    : undefined;
  const candidate = context.itemId ?? nestedId;
  const clean = String(candidate ?? '').trim();
  if (!/^\d+$/.test(clean)) throw new Error('Bolba task action requires a numeric itemId');
  return clean;
}

async function completeTask(context: PluginActionContext): Promise<PluginTaskListData> {
  const id = getTaskId(context);
  await bolbaRequest(`/tasks/${encodeURIComponent(id)}/close`, {
    method: 'POST',
    body: JSON.stringify({ status: 'done' }),
  });
  return fetchPendingTasks();
}

async function reopenTask(context: PluginActionContext): Promise<PluginTaskListData> {
  const id = getTaskId(context);
  await bolbaRequest(`/tasks/${encodeURIComponent(id)}/reopen`, { method: 'POST' });
  return fetchPendingTasks();
}

async function fetchTaskDetails(context: PluginActionContext): Promise<Record<string, unknown>> {
  const id = getTaskId(context);
  const payload = await bolbaRequest(`/tasks/${encodeURIComponent(id)}`);
  const source = isRecord(payload) && isRecord(payload.task) ? payload.task : payload;
  if (!isRecord(source)) throw new Error('Bolba Tasks returned invalid task details');
  const task = toTaskItem(source);
  if (!task) throw new Error('Bolba Tasks returned a task without an id or title');
  const events = Array.isArray(source.timeline)
    ? source.timeline.filter((event): event is string => typeof event === 'string' && event.trim().length > 0)
    : [];
  return {
    kind: 'bolba-task-details',
    task,
    events,
  };
}

function activateBolbaTasks(): TideServerPluginActivation {
  return {
    commands: {
      'show-pending-tasks': fetchPendingTasks,
    },
    actions: {
      complete: completeTask,
      reopen: reopenTask,
      refresh: fetchPendingTasks,
      details: fetchTaskDetails,
    },
  };
}

export const bolbaTasksPlugin: BuiltinPluginDefinition = {
  manifest: {
    id: 'bolba-tasks',
    name: 'Bolba Tasks',
    version: '1.0.0',
    description: 'Show pending and recently completed tasks from the local Bolba task board.',
    contributes: {
      slashCommands: [{
        name: '/tasks',
        aliases: ['/show-pending-tasks'],
        summary: 'Show pending tasks and the 8 most recently completed tasks',
        handler: 'show-pending-tasks',
        renderer: 'task-list',
      }],
      outputRenderers: [{ id: 'task-list' }],
    },
  },
  activate: activateBolbaTasks,
};
