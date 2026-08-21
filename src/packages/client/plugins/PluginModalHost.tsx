import React, { useEffect, useMemo, useRef } from 'react';
import { Icon } from '../components/Icon';
import { hasModalsAbove, useModalStackRegistration } from '../hooks/useModalStack';
import { apiUrl, authFetch } from '../utils/storage';
import { closePluginModal, openPluginModal } from './registry';
import { useOpenPluginModal, usePluginModals } from './hooks';

function MountedPluginModal({
  registration,
  data,
  close,
}: {
  registration: ReturnType<typeof usePluginModals>[number];
  data?: unknown;
  close: () => void;
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
      openModal: (id, nextData) => openPluginModal(registration.pluginId, id, nextData),
      data,
      close,
    })).then((nextCleanup) => {
      if (disposed) {
        if (typeof nextCleanup === 'function') nextCleanup();
      } else {
        cleanup = nextCleanup;
      }
    }).catch((error) => {
      if (ref.current) ref.current.textContent = `Plugin modal failed: ${error instanceof Error ? error.message : String(error)}`;
    });
    return () => {
      disposed = true;
      if (typeof cleanup === 'function') cleanup();
      if (ref.current) ref.current.replaceChildren();
    };
  }, [close, data, registration]);
  return <div ref={ref} className="plugin-modal__mount" />;
}

export function PluginModalHost() {
  const open = useOpenPluginModal();
  const registrations = usePluginModals();
  const registration = useMemo(() => open
    ? registrations.find((entry) => entry.pluginId === open.pluginId && entry.id === open.id)
    : undefined, [open, registrations]);
  const close = React.useCallback(() => closePluginModal(), []);

  useModalStackRegistration(
    open ? `plugin-modal:${open.pluginId}:${open.id}` : 'plugin-modal:none',
    !!open,
    close,
  );

  useEffect(() => {
    if (open && !registration) closePluginModal(open.pluginId, open.id);
  }, [open, registration]);

  useEffect(() => {
    if (!open) return;
    const modalId = `plugin-modal:${open.pluginId}:${open.id}`;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || hasModalsAbove(modalId)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [close, open]);

  if (!open || !registration) return null;
  const Component = registration.component;
  return (
    <div className="modal-overlay visible plugin-modal-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section
        className="modal plugin-modal"
        role="dialog"
        aria-modal="true"
        aria-label={registration.title}
        data-plugin-id={registration.pluginId}
        data-plugin-modal-id={registration.id}
      >
        <header className="plugin-modal__header">
          <span><Icon name="plug" size={14} />{registration.title}</span>
          <button type="button" onClick={close} aria-label="Close"><Icon name="close" size={14} /></button>
        </header>
        <div className="plugin-modal__body">
          {Component
            ? <Component pluginId={registration.pluginId} data={open.data} onClose={close} />
            : <MountedPluginModal registration={registration} data={open.data} close={close} />}
        </div>
      </section>
    </div>
  );
}
