import React, { memo, useEffect, useRef } from 'react';
import { Icon } from '../components/Icon';
import { apiUrl, authFetch } from '../utils/storage';
import { getPluginOutputRenderer, openPluginModal } from './registry';
import { PluginTaskListCard, isTaskListData } from './PluginTaskListCard';
import type { PluginOutputEnvelope, PluginOutputRendererRegistration } from './types';

function MountedPluginOutput({
  registration,
  output,
  agentId,
}: {
  registration: PluginOutputRendererRegistration;
  output: PluginOutputEnvelope;
  agentId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!registration.mount || !ref.current) return;
    let disposed = false;
    let cleanup: void | (() => void);
    void Promise.resolve(registration.mount(ref.current, {
      pluginId: registration.pluginId,
      apiBaseUrl: apiUrl(''),
      fetch: authFetch as typeof fetch,
      openModal: (id, data) => openPluginModal(registration.pluginId, id, data),
      output,
      agentId,
    })).then((nextCleanup) => {
      if (disposed) {
        if (typeof nextCleanup === 'function') nextCleanup();
      } else {
        cleanup = nextCleanup;
      }
    }).catch((error) => {
      if (ref.current) ref.current.textContent = `Plugin renderer failed: ${error instanceof Error ? error.message : String(error)}`;
    });
    return () => {
      disposed = true;
      if (typeof cleanup === 'function') cleanup();
      if (ref.current) ref.current.replaceChildren();
    };
  }, [agentId, output, registration]);
  return <div ref={ref} className="plugin-output-card plugin-output-card--mounted" data-plugin-id={output.pluginId} />;
}

export const PluginOutputHost = memo(function PluginOutputHost({
  output,
  agentId,
  surface = 'guake',
}: {
  output: PluginOutputEnvelope;
  agentId?: string;
  surface?: 'guake' | 'modal';
}) {
  if (isTaskListData(output.data)) {
    return <PluginTaskListCard output={output} agentId={agentId} surface={surface} />;
  }

  const registered = getPluginOutputRenderer(output.pluginId, output.rendererId);
  if (registered?.component) {
    const Component = registered.component;
    return <Component output={output} agentId={agentId} />;
  }
  if (registered?.mount) {
    return <MountedPluginOutput registration={registered} output={output} agentId={agentId} />;
  }

  const printable = typeof output.data === 'string'
    ? output.data
    : JSON.stringify(output.data, null, 2);
  return (
    <section className="plugin-output-card" data-plugin-id={output.pluginId}>
      <header className="plugin-output-card__header">
        <Icon name="plug" size={12} />
        <strong>{output.title || output.pluginId}</strong>
        <code>{output.rendererId}</code>
      </header>
      <pre>{printable}</pre>
    </section>
  );
});
