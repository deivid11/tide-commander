import React, { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { store } from '../../store';
import { apiUrl, authFetch } from '../../utils/storage';
import type {
  PluginAgentNameProposalsData,
  PluginOutputRendererProps,
} from '../types';

function isProposalData(value: unknown): value is PluginAgentNameProposalsData {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<PluginAgentNameProposalsData>;
  return data.kind === 'agent-name-proposals'
    && typeof data.agentId === 'string'
    && typeof data.requestId === 'string'
    && typeof data.previousName === 'string'
    && typeof data.contextSummary === 'string'
    && typeof data.action === 'string'
    && ['generating', 'ready', 'renamed', 'error'].includes(data.status ?? '')
    && Array.isArray(data.proposals)
    && (data.status === 'generating' || data.status === 'error' ? data.proposals.length === 0 : data.proposals.length === 3)
    && data.proposals.every((proposal) => (
      proposal && typeof proposal.name === 'string' && typeof proposal.reason === 'string'
    ));
}

function responseError(body: unknown, status: number): string {
  return body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : `No se pudo renombrar el agente (${status})`;
}

export function RenameAgentCard({ output, agentId }: PluginOutputRendererProps) {
  const incoming = isProposalData(output.data) ? output.data : null;
  const [data, setData] = useState<PluginAgentNameProposalsData | null>(incoming);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (incoming) setData(incoming);
  }, [incoming]);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{
        pluginId?: string;
        instanceId?: string;
        data?: unknown;
      }>).detail;
      if (detail?.pluginId !== 'rename-agent' || detail.instanceId !== output.instanceId) return;
      if (isProposalData(detail.data)) setData(detail.data);
    };
    window.addEventListener('tide:plugin-data-updated', onUpdate);
    return () => window.removeEventListener('tide:plugin-data-updated', onUpdate);
  }, [output.instanceId]);

  if (!data) return <div className="rename-agent-card rename-agent-card--invalid">Propuestas de nombre inválidas.</div>;
  const dismiss = (event: React.MouseEvent) => {
    event.stopPropagation();
    store.dismissPluginOutput(agentId || data.agentId, output.instanceId);
  };

  const choose = async (name: string) => {
    if (data.status !== 'ready' || data.selectedName || busyName) return;
    setBusyName(name);
    setError(null);
    try {
      const response = await authFetch(apiUrl(
        `/api/plugins/rename-agent/actions/${encodeURIComponent(data.action)}`
      ), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: data.agentId,
          instanceId: output.instanceId,
          rendererId: output.rendererId,
          data,
          name,
        }),
      });
      const body = await response.json().catch(() => null) as {
        output?: { data?: unknown };
        error?: string;
      } | null;
      if (!response.ok) throw new Error(responseError(body, response.status));
      if (isProposalData(body?.output?.data)) setData(body.output.data);
      else setData((current) => current ? { ...current, selectedName: name, renamedAt: Date.now(), status: 'renamed' } : current);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusyName(null);
    }
  };

  return (
    <section className={`rename-agent-card${data.status === 'renamed' ? ' is-complete' : ''}`}>
      <header>
        <span className="rename-agent-card__icon">
          {data.status === 'generating'
            ? <span className="spotlight-loading-spinner" />
            : <Icon name={data.status === 'renamed' ? 'check' : data.status === 'error' ? 'warn' : 'signature'} size={16} />}
        </span>
        <div>
          <strong>{data.status === 'generating'
            ? 'El agente está creando sus nombres'
            : data.status === 'renamed'
              ? 'Agente renombrado'
              : data.status === 'error'
                ? 'No se pudieron generar nombres'
                : 'Elige un nombre para el agente'}</strong>
          <span>{data.previousName}</span>
        </div>
        <button type="button" onClick={dismiss} aria-label="Descartar propuestas"><Icon name="close" size={11} /></button>
      </header>

      {data.status === 'renamed' && data.selectedName ? (
        <div className="rename-agent-card__success">
          <span>{data.previousName}</span>
          <Icon name="arrow-right" size={13} />
          <strong>{data.selectedName}</strong>
        </div>
      ) : (
        <>
          <div className="rename-agent-card__context">
            <Icon name="bolt" size={11} />
            <span><small>{data.status === 'ready' ? 'Contexto elegido por el agente' : 'Actividad detectada'}</small>{data.contextSummary}</span>
          </div>
          {data.status === 'generating' && (
            <div className="rename-agent-card__generating">
              <span className="spotlight-loading-spinner" />
              <div><strong>Analizando la conversación completa…</strong><span>Las tres propuestas aparecerán aquí automáticamente.</span></div>
            </div>
          )}
          {data.status === 'error' && (
            <div className="rename-agent-card__generation-error"><Icon name="warn" size={12} /> {data.error || 'Ejecuta /rename-agent otra vez.'}</div>
          )}
          {data.status === 'ready' && <div className="rename-agent-card__proposals">
            {data.proposals.map((proposal, index) => (
              <button
                type="button"
                key={proposal.name}
                disabled={busyName !== null}
                onClick={(event) => {
                  event.stopPropagation();
                  void choose(proposal.name);
                }}
              >
                <span>{index + 1}</span>
                <div><strong>{proposal.name}</strong><small>{proposal.reason}</small></div>
                {busyName === proposal.name
                  ? <span className="spotlight-loading-spinner" />
                  : <Icon name="arrow-right" size={11} />}
              </button>
            ))}
          </div>}
        </>
      )}
      {error && <div className="rename-agent-card__error"><Icon name="warn" size={11} /> {error}</div>}
    </section>
  );
}
