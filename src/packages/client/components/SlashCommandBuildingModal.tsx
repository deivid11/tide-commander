import React, { useCallback, useEffect, useState } from 'react';
import { useModalStackRegistration } from '../hooks/useModalStack';
import { PluginOutputHost } from '../plugins/PluginOutputHost';
import type { PluginOutputEnvelope } from '../plugins/types';
import { store, useBuildings } from '../store';
import { apiUrl, authFetch } from '../utils/storage';
import { Icon } from './Icon';

const OPEN_EVENT = 'tide:open-slash-command-building';

export function openSlashCommandBuilding(buildingId: string): void {
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { buildingId } }));
}

function responseError(body: unknown, status: number): string {
  return body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : `Slash command failed (${status})`;
}

export function SlashCommandBuildingModalHost() {
  const buildings = useBuildings();
  const [buildingId, setBuildingId] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  const [output, setOutput] = useState<PluginOutputEnvelope | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const building = buildingId ? buildings.get(buildingId) : undefined;
  const modalAgentId = store.getState().selectedAgentIds.values().next().value as string | undefined;
  const close = useCallback(() => setBuildingId(null), []);
  useModalStackRegistration('slash-command-building', buildingId !== null, close);

  useEffect(() => {
    if (!buildingId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [buildingId, close]);

  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<{ buildingId?: unknown }>).detail?.buildingId;
      if (typeof id !== 'string') return;
      setBuildingId(id);
      setOutput(null);
      setError(null);
      setRunId((value) => value + 1);
    };
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  useEffect(() => {
    if (!buildingId || !building || building.type !== 'slash-command') return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const selectedAgentId = store.getState().selectedAgentIds.values().next().value as string | undefined;
    void authFetch(apiUrl(`/api/buildings/${encodeURIComponent(buildingId)}/execute-slash-command`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selectedAgentId ? { agentId: selectedAgentId } : {}),
      signal: controller.signal,
    }).then(async (response) => {
      const body = await response.json().catch(() => null) as { output?: PluginOutputEnvelope; error?: string } | null;
      if (!response.ok || !body?.output) throw new Error(responseError(body, response.status));
      setOutput(body.output);
    }).catch((cause) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [building, buildingId, runId]);

  if (!buildingId || !building) return null;

  return (
    <div className="slash-building-overlay" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section className="slash-building-modal" role="dialog" aria-modal="true" aria-label={building.name}>
        <header>
          <span className="slash-building-modal__icon">
            {building.icon || <Icon name="bolt" size={18} />}
          </span>
          <div>
            <small>Slash Command Building</small>
            <h2>{building.name}</h2>
          </div>
          <button type="button" onClick={close} aria-label="Close"><Icon name="close" size={14} /></button>
        </header>
        <div className="slash-building-modal__command">
          <span>›</span><code>{building.slashCommand?.command}</code>
          <button type="button" disabled={loading} onClick={() => {
            setOutput(null);
            setRunId((value) => value + 1);
          }} title="Run again"><Icon name="refresh" size={11} /></button>
        </div>
        <div className="slash-building-modal__body">
          {loading && (
            <div className="slash-building-modal__loading"><span className="spotlight-loading-spinner" /> Ejecutando comando local…</div>
          )}
          {error && (
            <div className="slash-building-modal__error"><Icon name="warn" size={13} /><span>{error}</span></div>
          )}
          {output && <PluginOutputHost output={output} agentId={modalAgentId} surface="modal" />}
        </div>
        <footer><Icon name="lock" size={10} /> Ejecutado localmente por Tide Commander</footer>
      </section>
    </div>
  );
}
