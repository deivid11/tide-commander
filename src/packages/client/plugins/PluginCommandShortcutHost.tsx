import React, { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import { SpotlightCommandResultModal } from '../components/Spotlight/SpotlightCommandResultModal';
import { runPluginCommand, type SpotlightPluginCommand } from '../components/Spotlight/pluginCommands';
import { matchesShortcutString } from '../store/shortcuts';
import { getPluginSlashCommands } from './registry';
import { usePluginRegistryRevision } from './hooks';
import {
  pluginCommandShortcutKey,
  usePluginCommandShortcuts,
} from './commandShortcuts';
import type { PluginOutputEnvelope, RegisteredPluginSlashCommand } from './types';
import { store } from '../store';
import { SHELL_COMMAND_PLUGIN_ID } from './shell-commands/execution';

function toExecutableCommand(command: RegisteredPluginSlashCommand): SpotlightPluginCommand {
  return {
    name: command.name,
    canonicalName: command.name,
    pluginId: command.pluginId,
    pluginName: command.pluginName || command.pluginId,
    summary: command.summary,
    handler: command.handler || command.name.replace(/^\//, ''),
  };
}

export function PluginCommandShortcutHost() {
  const shortcutMap = usePluginCommandShortcuts();
  const registryRevision = usePluginRegistryRevision();
  const runningRef = useRef(false);
  const [result, setResult] = useState<{ command: string; output: PluginOutputEnvelope } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || runningRef.current) return;
      const target = event.target instanceof Element ? event.target : null;
      // KeyCaptureInput must receive the chord without firing the old binding.
      if (target?.closest('.key-capture-container')) return;

      const command = getPluginSlashCommands().find((candidate) => {
        const shortcut = shortcutMap[pluginCommandShortcutKey(candidate.pluginId, candidate.name)];
        return shortcut ? matchesShortcutString(event, shortcut) : false;
      });
      if (!command) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      runningRef.current = true;
      setError(null);
      const agentId = command.pluginId === SHELL_COMMAND_PLUGIN_ID
        ? store.getState().selectedAgentIds.values().next().value
        : undefined;
      void runPluginCommand(toExecutableCommand(command), command.name, { agentId })
        .then((next) => { if (next.kind === 'output') setResult(next); })
        .catch((cause) => {
          const message = cause instanceof Error ? cause.message : String(cause);
          if (message !== 'Shell command execution cancelled') setError(message);
        })
        .finally(() => { runningRef.current = false; });
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [registryRevision, shortcutMap]);

  if (result) {
    return <SpotlightCommandResultModal command={result.command} output={result.output} onClose={() => setResult(null)} />;
  }
  if (!error) return null;
  return (
    <div className="spotlight-overlay plugin-shortcut-error-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setError(null);
    }}>
      <section className="plugin-shortcut-error-modal" role="alertdialog" aria-modal="true">
        <span className="plugin-shortcut-error-modal__icon"><Icon name="warn" size={18} /></span>
        <div><strong>Plugin command failed</strong><p>{error}</p></div>
        <button type="button" onClick={() => setError(null)} aria-label="Close"><Icon name="close" size={13} /></button>
      </section>
    </div>
  );
}
