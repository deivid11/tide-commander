import React, { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';
import { apiUrl, authFetch } from '../utils/storage';
import { refreshPluginCatalog } from '../plugins/registry';
import type { ClientPluginInfo, PluginIntegrationSettingsContribution } from '../plugins/types';
import { IntegrationsPanel } from './IntegrationsPanel';
import { KeyCaptureInput } from './KeyCaptureInput';
import { parseShortcutString, type ShortcutConfig } from '../store/shortcuts';
import { ShellCommandsSettings } from '../plugins/shell-commands/ShellCommandsSettings';
import {
  pluginCommandShortcutKey,
  setPluginCommandShortcut,
  usePluginCommandShortcuts,
} from '../plugins/commandShortcuts';

export function PluginsPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [plugins, setPlugins] = useState<ClientPluginInfo[]>([]);
  const [sourcePath, setSourcePath] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);
  const [openIntegrationId, setOpenIntegrationId] = useState<string | null>(null);
  const commandShortcuts = usePluginCommandShortcuts();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPlugins(await refreshPluginCatalog());
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
    else setOpenIntegrationId(null);
  }, [isOpen, load]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const setEnabled = async (plugin: ClientPluginInfo, enabled: boolean) => {
    setBusyId(plugin.id);
    setMessage(null);
    try {
      const response = await authFetch(apiUrl(`/api/plugins/${encodeURIComponent(plugin.id)}/${enabled ? 'enable' : 'disable'}`), {
        method: 'POST',
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Failed to ${enabled ? 'enable' : 'disable'} plugin`);
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusyId(null);
    }
  };

  const install = async () => {
    const path = sourcePath.trim();
    if (!path) return;
    setBusyId('__install__');
    setMessage(null);
    try {
      const response = await authFetch(apiUrl('/api/plugins/install'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath: path }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; plugin?: { name?: string } };
      if (!response.ok) throw new Error(body.error || 'Plugin install failed');
      setSourcePath('');
      setMessage({ kind: 'success', text: `${body.plugin?.name || 'Plugin'} installed` });
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusyId(null);
    }
  };

  if (!isOpen) return null;
  return (
    <>
    <div className="modal-overlay visible plugins-panel-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal plugins-panel" role="dialog" aria-modal="true" aria-label="Plugins">
        <header className="plugins-panel__header">
          <div>
            <h2><Icon name="plug" size={18} /> Plugins</h2>
            <p>Trusted local extensions for Tide Commander</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </header>

        <div className="plugins-panel__install">
          <div className="plugins-panel__install-heading">
            <span className="plugins-panel__install-icon"><Icon name="folder" size={16} /></span>
            <div>
              <label htmlFor="plugin-source-path">Install from a local folder</label>
              <p>Enter the absolute path to a Tide plugin directory.</p>
            </div>
          </div>
          <div className="plugins-panel__path-row">
            <span className="plugins-panel__path-prefix" aria-hidden="true"><Icon name="terminal" size={13} /></span>
            <input
              id="plugin-source-path"
              value={sourcePath}
              onChange={(event) => setSourcePath(event.target.value)}
              placeholder="/path/to/tide-plugin"
              autoComplete="off"
              spellCheck={false}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void install();
              }}
            />
            <button type="button" onClick={() => void install()} disabled={!sourcePath.trim() || busyId === '__install__'}>
              <Icon name="plug" size={13} />
              <span>{busyId === '__install__' ? 'Installing…' : 'Install plugin'}</span>
            </button>
          </div>
          <div className="plugins-panel__trust-note">
            <Icon name="lock" size={12} />
            <span><strong>Trusted local code.</strong> Plugins run with Tide Commander permissions, so install only code you trust.</span>
          </div>
        </div>

        {message && <div className={`plugins-panel__message is-${message.kind}`}>{message.text}</div>}

        <div className="plugins-panel__list">
          <ShellCommandsSettings />
          {loading && plugins.length === 0 ? (
            <div className="plugins-panel__empty">Loading plugins…</div>
          ) : plugins.length === 0 ? (
            <div className="plugins-panel__empty">No plugins installed</div>
          ) : plugins.map((plugin) => (
            <article className={`plugin-list-item${plugin.enabled ? ' is-enabled' : ''}`} key={plugin.id}>
              <div className="plugin-list-item__icon"><Icon name="plug" size={16} /></div>
              <div className="plugin-list-item__info">
                <div className="plugin-list-item__title">
                  <strong>{plugin.name}</strong>
                  <span>v{plugin.version}</span>
                  {plugin.builtin || plugin.source === 'builtin' ? <em>built-in</em> : null}
                </div>
                <p>{plugin.description || plugin.id}</p>
                {(plugin.contributes?.settings || plugin.manifest?.contributes?.settings || []).map((setting) => {
                  const integrationSetting = setting as PluginIntegrationSettingsContribution;
                  if (integrationSetting.type !== 'integration') return null;
                  return (
                    <section className="plugin-list-item__settings" key={integrationSetting.id}>
                      <div className="plugin-list-item__settings-heading">
                        <span><Icon name="gear" size={12} /> Configuración</span>
                        <button type="button" onClick={() => setOpenIntegrationId(integrationSetting.integrationId)}>
                          <Icon name="key" size={11} /> Configurar
                        </button>
                      </div>
                      <strong>{integrationSetting.title}</strong>
                      {integrationSetting.description && <p>{integrationSetting.description}</p>}
                      {integrationSetting.instructions?.length ? (
                        <ol>
                          {integrationSetting.instructions.map((instruction, index) => (
                            <li key={`${integrationSetting.id}-${index}`}>{instruction}</li>
                          ))}
                        </ol>
                      ) : null}
                      {integrationSetting.secrets?.length ? (
                        <div className="plugin-list-item__secrets">
                          <span><Icon name="lock" size={10} /> Secretos administrados de forma segura</span>
                          <div>
                            {integrationSetting.secrets.map((secret) => <code key={secret}>{secret}</code>)}
                          </div>
                        </div>
                      ) : null}
                    </section>
                  );
                })}
                {(plugin.contributes?.slashCommands || plugin.manifest?.contributes?.slashCommands || []).length > 0 && (
                  <div className="plugin-list-item__commands">
                    <div className="plugin-list-item__commands-title">
                      <Icon name="keyboard" size={11} /> Global command shortcuts
                    </div>
                    {(plugin.contributes?.slashCommands || plugin.manifest?.contributes?.slashCommands || []).map((command) => {
                      const storageKey = pluginCommandShortcutKey(plugin.id, command.name);
                      const value = parseShortcutString(commandShortcuts[storageKey]);
                      const shortcut: ShortcutConfig = {
                        id: `plugin-command:${plugin.id}:${command.name}`,
                        name: command.name,
                        description: command.summary,
                        key: value?.key || '',
                        modifiers: value?.modifiers || {},
                        enabled: true,
                        context: 'global',
                      };
                      return (
                        <div className="plugin-command-shortcut" key={command.name}>
                          <div className="plugin-command-shortcut__info">
                            <code>{command.name}</code>
                            <span>{command.summary}</span>
                            {command.aliases?.length ? <em>Aliases: {command.aliases.join(', ')}</em> : null}
                          </div>
                          <KeyCaptureInput
                            shortcut={shortcut}
                            onUpdate={(next) => setPluginCommandShortcut(plugin.id, command.name, next)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
                {plugin.error && <div className="plugin-list-item__error">{plugin.error}</div>}
              </div>
              <label className="plugin-list-item__toggle" title={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}>
                <input
                  type="checkbox"
                  checked={plugin.enabled}
                  disabled={busyId === plugin.id}
                  onChange={(event) => void setEnabled(plugin, event.target.checked)}
                />
                <span />
              </label>
            </article>
          ))}
        </div>
      </section>
    </div>
    {openIntegrationId && (
      <IntegrationsPanel
        isOpen
        initialTab={openIntegrationId}
        zIndex={10030}
        onClose={() => {
          setOpenIntegrationId(null);
          void load();
        }}
      />
    )}
    </>
  );
}
