import React, { useEffect, useRef } from 'react';
import { apiUrl, authFetch } from '../utils/storage';
import { openPluginModal } from './registry';
import type { PluginSidebarViewRegistration } from './types';

/** Hosts framework-neutral plugin UI and guarantees its disposer runs. */
export function PluginMountSurface({ view }: { view: PluginSidebarViewRegistration }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!view.mount || !ref.current) return;
    let disposed = false;
    let cleanup: void | (() => void);
    void Promise.resolve(view.mount(ref.current, {
      pluginId: view.pluginId,
      apiBaseUrl: apiUrl(''),
      fetch: authFetch as typeof fetch,
      openModal: (id, data) => openPluginModal(view.pluginId, id, data),
    })).then((nextCleanup) => {
      if (disposed) {
        if (typeof nextCleanup === 'function') nextCleanup();
        return;
      }
      cleanup = nextCleanup;
    }).catch((error) => {
      if (ref.current) ref.current.textContent = `Plugin view failed: ${error instanceof Error ? error.message : String(error)}`;
    });
    return () => {
      disposed = true;
      if (typeof cleanup === 'function') cleanup();
      if (ref.current) ref.current.replaceChildren();
    };
  }, [view]);

  return <div ref={ref} className="plugin-mount-surface" data-plugin-id={view.pluginId} />;
}
