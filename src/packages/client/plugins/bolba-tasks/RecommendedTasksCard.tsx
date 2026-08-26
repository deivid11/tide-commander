import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/Icon';
import { apiUrl, authFetch } from '../../utils/storage';
import { openPluginModal } from '../registry';
import type {
  PluginOutputRendererProps,
  PluginRecommendedTask,
  PluginRecommendedTasksData,
} from '../types';

export function isRecommendedTasksData(value: unknown): value is PluginRecommendedTasksData {
  return !!value
    && typeof value === 'object'
    && (value as { kind?: unknown }).kind === 'bolba-recommended-tasks'
    && ['generating', 'ready', 'error'].includes(String((value as { status?: unknown }).status))
    && typeof (value as { agentId?: unknown }).agentId === 'string'
    && typeof (value as { requestId?: unknown }).requestId === 'string'
    && Array.isArray((value as { items?: unknown }).items);
}

function extractRecommendedData(body: unknown): PluginRecommendedTasksData | null {
  if (isRecommendedTasksData(body)) return body;
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (isRecommendedTasksData(record.data)) return record.data;
  if (record.output && typeof record.output === 'object') {
    const output = record.output as Record<string, unknown>;
    if (isRecommendedTasksData(output.data)) return output.data;
  }
  return null;
}

function formatGeneratedAt(value: number | undefined): string {
  if (!value) return 'pendiente';
  return new Intl.DateTimeFormat('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function localDay(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dueLabel(value?: string): { label: string; tone: 'overdue' | 'today' | 'soon' | 'future' } | null {
  if (!value) return null;
  const due = value.slice(0, 10);
  const today = localDay();
  if (due < today) {
    const parsed = new Date(`${due}T12:00:00`);
    const current = new Date(`${today}T12:00:00`);
    const days = Math.max(1, Math.round((current.getTime() - parsed.getTime()) / 86_400_000));
    return { label: `${days}d vencida`, tone: 'overdue' };
  }
  if (due === today) return { label: 'Hoy', tone: 'today' };
  const parsed = new Date(`${due}T12:00:00`);
  const current = new Date(`${today}T12:00:00`);
  const days = Math.max(1, Math.round((parsed.getTime() - current.getTime()) / 86_400_000));
  return { label: days === 1 ? 'Mañana' : `En ${days}d`, tone: days <= 7 ? 'soon' : 'future' };
}

function displayTaskTitle(value: string): string {
  return value
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .trim();
}

function urgencyLabel(item: PluginRecommendedTask): string {
  switch (item.urgency) {
    case 'critical': return 'Crítica';
    case 'high': return 'Alta';
    case 'medium': return 'Media';
    default: return 'Sugerida';
  }
}

export const RecommendedTasksCard = memo(function RecommendedTasksCard({
  output,
  agentId,
}: PluginOutputRendererProps) {
  const initial = isRecommendedTasksData(output.data) ? output.data : null;
  const [data, setData] = useState<PluginRecommendedTasksData | null>(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isRecommendedTasksData(output.data)) setData(output.data);
  }, [output.data]);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ pluginId?: string; instanceId?: string; data?: unknown }>).detail;
      if (detail?.pluginId !== output.pluginId || detail.instanceId !== output.instanceId) return;
      if (isRecommendedTasksData(detail.data)) setData(detail.data);
    };
    window.addEventListener('tide:plugin-data-updated', onUpdate);
    return () => window.removeEventListener('tide:plugin-data-updated', onUpdate);
  }, [output.instanceId, output.pluginId]);

  const invoke = useCallback(async (action: string, item?: PluginRecommendedTask) => {
    if (!data) return;
    if (item) setBusyTaskId(String(item.task.id));
    else setRefreshing(true);
    setError(null);
    try {
      const response = await authFetch(apiUrl(
        `/api/plugins/${encodeURIComponent(output.pluginId)}/actions/${encodeURIComponent(action)}`,
      ), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: agentId || data.agentId,
          instanceId: output.instanceId,
          rendererId: output.rendererId,
          item: item?.task,
          itemId: item?.task.id,
          data,
        }),
      });
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) {
        const message = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
          ? (body as { error: string }).error
          : `Bolba request failed (${response.status})`;
        throw new Error(message);
      }
      const next = extractRecommendedData(body);
      if (!next) throw new Error('Bolba devolvió recomendaciones inválidas');
      setData(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
      setBusyTaskId(null);
    }
  }, [agentId, data, output.instanceId, output.pluginId, output.rendererId]);

  const navigationTasks = useMemo(() => data?.items.map((item) => item.task) ?? [], [data]);

  if (!data) {
    return (
      <section className="bolba-recommended-card bolba-recommended-card--invalid">
        <Icon name="warn" size={13} /> No se pudieron interpretar las recomendaciones.
      </section>
    );
  }

  return (
    <section className="bolba-recommended-card" data-plugin-id={output.pluginId} data-renderer-id={output.rendererId} data-status={data.status}>
      <header className="bolba-recommended-card__header">
        <span className="bolba-recommended-card__brand"><Icon name="plant" size={15} /></span>
        <div className="bolba-recommended-card__heading">
          <span className="bolba-recommended-card__eyebrow"><Icon name="sparkle" size={9} /> Bolba recomienda</span>
          <strong>{data.title}</strong>
          <small>{data.subtitle}</small>
        </div>
        <div className="bolba-recommended-card__summary" title={`${data.count} de ${data.totalCandidates} tareas abiertas`}>
          <strong>{data.status === 'generating' ? 'IA' : data.count}</strong><span>{data.status === 'generating' ? 'analizando' : `de ${data.totalCandidates}`}</span>
        </div>
        <button
          type="button"
          className="bolba-recommended-card__refresh"
          disabled={refreshing || data.status === 'generating'}
          onClick={() => void invoke(data.actions.refresh)}
          title="Recalcular recomendaciones"
        >
          <Icon name="arrow-clockwise" size={12} className={refreshing ? 'is-spinning' : undefined} />
        </button>
      </header>

      {(error || data.error) && <div className="bolba-recommended-card__error"><Icon name="warn" size={11} />{error || data.error}</div>}

      {data.status === 'generating' ? (
        <div className="bolba-recommended-card__generating">
          <span className="spotlight-loading-spinner" />
          <div><strong>La IA está analizando todas las tareas…</strong><span>Comparando urgencia, impacto, seguridad, esfuerzo y dependencias.</span></div>
        </div>
      ) : data.status === 'error' ? (
        <div className="bolba-recommended-card__generation-error">
          <Icon name="brain" size={17} />
          <strong>El análisis todavía no está listo</strong>
          <span>Puedes recalcularlo con el botón de actualizar.</span>
        </div>
      ) : <>
      {data.analysisSummary && (
        <div className="bolba-recommended-card__analysis"><Icon name="brain" size={11} /><span><small>Criterio de la IA</small>{data.analysisSummary}</span></div>
      )}
      <div className="bolba-recommended-card__items">
        {data.items.length === 0 ? (
          <div className="bolba-recommended-card__empty">
            <Icon name="check" size={16} />
            <strong>Todo bajo control</strong>
            <span>No hay tareas abiertas para recomendar.</span>
          </div>
        ) : data.items.map((item) => {
          const due = dueLabel(item.task.due);
          const id = String(item.task.id);
          const busy = busyTaskId === id;
          const title = displayTaskTitle(item.task.title);
          return (
            <article className={`bolba-recommended-task is-${item.urgency}`} key={id}>
              <span className="bolba-recommended-task__rank">{item.rank}</span>
              <button
                type="button"
                className="bolba-recommended-task__content"
                onClick={() => openPluginModal(output.pluginId, data.actions.openDetails, {
                  task: item.task,
                  tasks: navigationTasks,
                  completion: {
                    agentId: agentId || data.agentId,
                    instanceId: output.instanceId,
                    rendererId: output.rendererId,
                    action: data.actions.complete,
                    data,
                  },
                })}
                title={`Abrir detalle de #${item.task.id}`}
              >
                <span className="bolba-recommended-task__meta">
                  <span className={`bolba-recommended-task__urgency is-${item.urgency}`}>
                    {urgencyLabel(item)}
                  </span>
                  <span className="bolba-recommended-task__id">#{item.task.id}</span>
                  {item.task.project && <span className="bolba-recommended-task__project">{item.task.project}</span>}
                  {due && <span className={`bolba-recommended-task__due is-${due.tone}`}>{due.label}</span>}
                </span>
                <strong className="bolba-recommended-task__title">{title}</strong>
                <span className="bolba-recommended-task__reason">
                  <Icon name="target" size={10} />{item.reason}
                </span>
              </button>
              <button
                type="button"
                className="bolba-recommended-task__complete"
                disabled={busy}
                onClick={() => void invoke(data.actions.complete, item)}
                aria-label={`Completar ${title}`}
                title="Marcar como completada"
              >
                {busy ? <span className="plugin-task-row__spinner" /> : <Icon name="check" size={12} />}
                <span>Completar</span>
              </button>
            </article>
          );
        })}
      </div>
      </>}

      <footer className="bolba-recommended-card__footer">
        <span><Icon name="history" size={10} /> {data.status === 'ready' ? `Analizado ${formatGeneratedAt(data.generatedAt)}` : 'Análisis con IA en proceso'}</span>
        <span>Priorización realizada por IA</span>
      </footer>
    </section>
  );
});
