import React, { useEffect } from 'react';
import { Icon } from '../Icon';
import { hasModalsAbove, useModalStackRegistration } from '../../hooks/useModalStack';
import { PluginOutputHost } from '../../plugins/PluginOutputHost';
import type { PluginOutputEnvelope } from '../../plugins/types';

interface SpotlightCommandResultModalProps {
  command: string;
  output: PluginOutputEnvelope;
  onClose: () => void;
}

export function SpotlightCommandResultModal({
  command,
  output,
  onClose,
}: SpotlightCommandResultModalProps) {
  useModalStackRegistration('spotlight-command-result', true, onClose);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || hasModalsAbove('spotlight-command-result')) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [onClose]);

  return (
    <div
      className="spotlight-overlay spotlight-command-result-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="spotlight-command-result-modal" role="dialog" aria-modal="true" aria-label={`Result for ${command}`}>
        <header className="spotlight-command-result-header">
          <div className="spotlight-command-result-heading">
            <span className="spotlight-command-result-icon"><Icon name="plug" size={17} /></span>
            <div>
              <span className="spotlight-command-result-eyebrow">Plugin command result</span>
              <h2>{output.title || command}</h2>
            </div>
          </div>
          <button type="button" className="spotlight-command-result-close" onClick={onClose} aria-label="Close command result">
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="spotlight-command-result-command">
          <span aria-hidden="true">›</span>
          <code>{command}</code>
          <span className="spotlight-command-result-plugin">{output.pluginId}</span>
        </div>

        <div className="spotlight-command-result-body">
          <PluginOutputHost output={output} surface="modal" />
        </div>

        <footer className="spotlight-command-result-footer">
          <span><Icon name="lock" size={11} /> Executed locally by the plugin</span>
          <span>The LLM was not invoked</span>
        </footer>
      </section>
    </div>
  );
}
