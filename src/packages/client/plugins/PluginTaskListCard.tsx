import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../components/Icon';
import { apiUrl, authFetch } from '../utils/storage';
import { openPluginModal } from './registry';
import type { PluginOutputEnvelope, PluginTaskItem, PluginTaskListData } from './types';

interface PluginTaskListCardProps {
  output: PluginOutputEnvelope;
  agentId?: string;
  surface?: 'guake' | 'sidebar' | 'modal';
  onDataChange?: (data: PluginTaskListData) => void;
}

function formatRegistrationDate(value?: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value.slice(0, 10);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: 'short',
    ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: '2-digit' }),
  }).format(date).replace('.', '');
}

function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function isCompletedTask(item: PluginTaskItem): boolean {
  const status = (item.status || '').toLowerCase();
  return status === 'done' || status === 'completed' || status === 'discarded';
}

function dueClass(item: PluginTaskItem): string {
  if (!item.due || isCompletedTask(item)) return '';
  const day = item.due.slice(0, 10);
  const today = localDay();
  if (day < today) return ' plugin-task-due--overdue';
  if (day === today) return ' plugin-task-due--today';
  return '';
}

function isTaskListData(value: unknown): value is PluginTaskListData {
  return !!value
    && typeof value === 'object'
    && (value as { kind?: unknown }).kind === 'task-list'
    && Array.isArray((value as { items?: unknown }).items);
}

function extractUpdatedData(body: unknown): PluginTaskListData | null {
  if (isTaskListData(body)) return body;
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (isTaskListData(record.data)) return record.data;
  if (record.output && typeof record.output === 'object') {
    const output = record.output as Record<string, unknown>;
    if (isTaskListData(output.data)) return output.data;
  }
  return null;
}

export const PluginTaskListCard = memo(function PluginTaskListCard({
  output,
  agentId,
  surface = 'guake',
  onDataChange,
}: PluginTaskListCardProps) {
  const initial = isTaskListData(output.data)
    ? output.data
    : { kind: 'task-list' as const, items: [], title: output.title };
  const [data, setData] = useState<PluginTaskListData>(initial);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isTaskListData(output.data)) setData(output.data);
  }, [output.data]);

  const setNextData = useCallback((next: PluginTaskListData) => {
    setData(next);
    onDataChange?.(next);
    window.dispatchEvent(new CustomEvent('tide:plugin-data-updated', {
      detail: { pluginId: output.pluginId, rendererId: output.rendererId, data: next },
    }));
  }, [onDataChange, output.pluginId, output.rendererId]);

  const invoke = useCallback(async (action: string, item?: PluginTaskItem) => {
    const itemKey = item ? String(item.id) : '__refresh__';
    if (item) setBusyIds((current) => new Set(current).add(itemKey));
    else setRefreshing(true);
    setError(null);

    const previous = data;
    if (item && (action === data.actions?.complete || action.toLowerCase().includes('complete'))) {
      setData((current) => ({
        ...current,
        items: current.items.map((entry) => String(entry.id) === itemKey ? { ...entry, status: 'done' } : entry),
      }));
    } else if (item && (action === data.actions?.reopen || action.toLowerCase().includes('reopen'))) {
      setData((current) => ({
        ...current,
        items: current.items.map((entry) => String(entry.id) === itemKey ? { ...entry, status: 'open' } : entry),
      }));
    }

    try {
      const response = await authFetch(apiUrl(
        `/api/plugins/${encodeURIComponent(output.pluginId)}/actions/${encodeURIComponent(action)}`
      ), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          instanceId: output.instanceId,
          rendererId: output.rendererId,
          item,
          itemId: item?.id,
          data,
        }),
      });
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : `Plugin action failed (${response.status})`;
        throw new Error(message);
      }
      const updated = extractUpdatedData(body);
      if (updated) setNextData(updated);
      else if (item) {
        const status = action === data.actions?.reopen || action.toLowerCase().includes('reopen') ? 'open' : 'done';
        setNextData({
          ...data,
          items: data.items.map((entry) => String(entry.id) === itemKey ? { ...entry, status } : entry),
        });
      }
    } catch (cause) {
      setData(previous);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (item) {
        setBusyIds((current) => {
          const next = new Set(current);
          next.delete(itemKey);
          return next;
        });
      } else {
        setRefreshing(false);
      }
    }
  }, [agentId, data, output.instanceId, output.pluginId, output.rendererId, setNextData]);

  const visibleItems = useMemo(() => surface === 'guake' ? data.items.slice(0, 40) : data.items, [data.items, surface]);
  const activeItems = useMemo(() => visibleItems.filter((item) => !isCompletedTask(item)), [visibleItems]);
  const completedItems = useMemo(() => visibleItems.filter(isCompletedTask), [visibleItems]);
  const completeAction = data.actions?.complete;
  const reopenAction = data.actions?.reopen;
  const detailNavigationItems = useMemo(
    () => [...activeItems, ...completedItems],
    [activeItems, completedItems],
  );

  const renderTask = (item: PluginTaskItem) => {
    const key = String(item.id);
    const done = isCompletedTask(item);
    const action = done ? reopenAction : completeAction;
    const registrationDate = formatRegistrationDate(item.registeredAt);
    return (
      <div className={`plugin-task-row${done ? ' is-done' : ''}`} key={key}>
        {registrationDate && (
          <time className="plugin-task-row__registered" dateTime={item.registeredAt} title={`Registered ${item.registeredAt}`}>
            {registrationDate}
          </time>
        )}
        <button
          type="button"
          className="plugin-task-row__toggle"
          disabled={!action || busyIds.has(key)}
          onClick={() => action && void invoke(action, item)}
          title={done ? 'Reopen task' : 'Complete task'}
          aria-label={done ? `Reopen ${item.title}` : `Complete ${item.title}`}
        >
          {busyIds.has(key)
            ? <span className="plugin-task-row__spinner" />
            : <Icon name={done ? 'check' : 'square'} size={14} />}
        </button>
        <span className="plugin-task-row__id">#{item.id}</span>
        {item.project && <span className="plugin-task-row__project">{item.project}</span>}
        {item.status && <span className={`plugin-task-row__status plugin-task-row__status--${item.status}`}>{item.status}</span>}
        {item.due && <span className={`plugin-task-row__due${dueClass(item)}`}>{item.due.slice(0, 10)}</span>}
        <button
          type="button"
          className="plugin-task-row__title"
          disabled={!data.actions?.openDetails}
          onClick={() => {
            if (!data.actions?.openDetails) return;
            const modalData = output.pluginId === 'bolba-tasks'
              ? { task: item, tasks: detailNavigationItems }
              : item;
            openPluginModal(output.pluginId, data.actions.openDetails, modalData);
          }}
          title={item.description || item.title}
        >
          {item.title}
        </button>
      </div>
    );
  };

  return (
    <section className={`plugin-task-card plugin-task-card--${surface}`} data-plugin-id={output.pluginId}>
      <header className="plugin-task-card__header">
        <span className="plugin-task-card__brand"><Icon name="plug" size={12} /></span>
        <span className="plugin-task-card__title">{data.title || output.title || 'Tasks'}</span>
        <span className="plugin-task-card__count">{data.count ?? data.items.length}</span>
        {data.actions?.refresh && (
          <button
            type="button"
            className="plugin-task-card__icon-btn"
            disabled={refreshing}
            onClick={() => void invoke(data.actions!.refresh!)}
            title="Refresh"
          >
            <Icon name="arrow-clockwise" size={12} className={refreshing ? 'is-spinning' : undefined} />
          </button>
        )}
      </header>

      {error && <div className="plugin-task-card__error"><Icon name="warn" size={11} />{error}</div>}

      <div className="plugin-task-card__items">
        {visibleItems.length === 0 ? (
          <div className="plugin-task-card__empty">
            <Icon name="check" size={14} />
            {data.emptyMessage || 'No pending tasks'}
          </div>
        ) : (
          <>
            {activeItems.length > 0 && (
              <section className="plugin-task-group" aria-label="Pending tasks">
                <div className="plugin-task-group__header">
                  <span>Pending</span>
                  <strong>{activeItems.length}</strong>
                </div>
                {activeItems.map(renderTask)}
              </section>
            )}
            {completedItems.length > 0 && (
              <section className="plugin-task-group plugin-task-group--completed" aria-label="Recently completed tasks">
                <div className="plugin-task-group__header">
                  <span>Recently completed</span>
                  <strong>{completedItems.length}</strong>
                  <em>Click the check to reopen</em>
                </div>
                {completedItems.map(renderTask)}
              </section>
            )}
          </>
        )}
      </div>

      {surface === 'guake' && data.items.length > visibleItems.length && (
        <div className="plugin-task-card__more">+{data.items.length - visibleItems.length} more — open the sidebar for all tasks</div>
      )}
    </section>
  );
});

export { isTaskListData };
