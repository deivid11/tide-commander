import React, { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { apiUrl, authFetch } from '../../utils/storage';
import type { PluginShellCommandDefinition, PluginShellCommandInput } from '../types';
import { refreshShellSlashCommands } from './index';

const EMPTY_COMMAND: PluginShellCommandInput = {
  name: '/',
  summary: '',
  script: '',
  cwd: '',
  runAsSudo: false,
  pty: true,
  enabled: true,
};

function errorMessage(body: unknown, fallback: string): string {
  return body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
    ? (body as { error: string }).error
    : fallback;
}

export function ShellCommandsSettings() {
  const [commands, setCommands] = useState<PluginShellCommandDefinition[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PluginShellCommandInput>(EMPTY_COMMAND);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCommands(await refreshShellSlashCommands());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const beginCreate = () => {
    setEditingId('__new__');
    setDraft({ ...EMPTY_COMMAND });
    setError(null);
  };

  const beginEdit = (command: PluginShellCommandDefinition) => {
    setEditingId(command.id);
    setDraft({
      name: command.name,
      summary: command.summary,
      script: command.script,
      cwd: command.cwd ?? '',
      runAsSudo: command.runAsSudo,
      pty: command.pty,
      enabled: command.enabled,
    });
    setError(null);
  };

  const save = async () => {
    if (!editingId) return;
    setBusy(true);
    setError(null);
    try {
      const creating = editingId === '__new__';
      const response = await authFetch(apiUrl(creating
        ? '/api/plugins/shell-commands'
        : `/api/plugins/shell-commands/${encodeURIComponent(editingId)}`), {
        method: creating ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, 'Unable to save command script'));
      setEditingId(null);
      setDraft({ ...EMPTY_COMMAND });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (command: PluginShellCommandDefinition) => {
    if (!window.confirm(`Delete ${command.name}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const response = await authFetch(apiUrl(`/api/plugins/shell-commands/${encodeURIComponent(command.id)}`), {
        method: 'DELETE',
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, 'Unable to delete command script'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (command: PluginShellCommandDefinition) => {
    setBusy(true);
    setError(null);
    try {
      const response = await authFetch(apiUrl(`/api/plugins/shell-commands/${encodeURIComponent(command.id)}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...command, enabled: !command.enabled }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, 'Unable to update command script'));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="shell-commands-settings">
      <header className="shell-commands-settings__header">
        <div>
          <span className="shell-commands-settings__eyebrow"><Icon name="terminal" size={11} /> Streamed exec</span>
          <h3>Slash command scripts</h3>
          <p>Register trusted Bash scripts that run locally without invoking an LLM.</p>
        </div>
        <button type="button" onClick={beginCreate} disabled={Boolean(editingId) || busy}>
          <Icon name="plus" size={12} /> Add command
        </button>
      </header>

      {error && <div className="shell-commands-settings__error"><Icon name="warn" size={12} /> {error}</div>}

      {editingId && (
        <div className="shell-command-editor">
          <div className="shell-command-editor__grid">
            <label>
              <span>Slash command</span>
              <input
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="/deploy"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label>
              <span>Description</span>
              <input
                value={draft.summary}
                onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                placeholder="Deploy the current project"
                autoComplete="off"
              />
            </label>
          </div>
          <label>
            <span>Working directory <em>optional · defaults to the active agent workspace</em></span>
            <input
              value={draft.cwd ?? ''}
              onChange={(event) => setDraft({ ...draft, cwd: event.target.value })}
              placeholder="/home/user/project"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label>
            <span>Bash script <em>slash arguments are available as $1, $2, …</em></span>
            <textarea
              value={draft.script}
              onChange={(event) => setDraft({ ...draft, script: event.target.value })}
              placeholder={'set -euo pipefail\necho "Deploying $1"'}
              rows={7}
              spellCheck={false}
            />
          </label>
          <div className="shell-command-editor__options">
            <label>
              <input type="checkbox" checked={draft.runAsSudo === true} onChange={(event) => setDraft({ ...draft, runAsSudo: event.target.checked })} />
              <span><strong>Allow sudo</strong><small>Ask once; only sudo lines run as root</small></span>
            </label>
            <label>
              <input type="checkbox" checked={draft.pty !== false} onChange={(event) => setDraft({ ...draft, pty: event.target.checked })} />
              <span><strong>PTY output</strong><small>Stream interactive progress and colors</small></span>
            </label>
            <label>
              <input type="checkbox" checked={draft.enabled !== false} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />
              <span><strong>Enabled</strong><small>Show in slash command results</small></span>
            </label>
          </div>
          {draft.runAsSudo && (
            <div className="shell-command-editor__sudo-note">
              <Icon name="lock" size={11} /> Tide passes the password to nested sudo calls over a private per-run channel. The script itself keeps running as the normal user.
            </div>
          )}
          <footer>
            <button type="button" onClick={() => setEditingId(null)} disabled={busy}>Cancel</button>
            <button type="button" className="is-primary" onClick={() => void save()} disabled={busy || !draft.name.trim() || !draft.summary.trim() || !draft.script.trim()}>
              <Icon name="save" size={11} /> {busy ? 'Saving…' : 'Save command'}
            </button>
          </footer>
        </div>
      )}

      <div className="shell-command-list">
        {loading && commands.length === 0 ? (
          <div className="shell-command-list__empty">Loading command scripts…</div>
        ) : commands.length === 0 ? (
          <div className="shell-command-list__empty">
            <Icon name="terminal" size={18} />
            <strong>No command scripts registered</strong>
            <span>Add one to expose it in Spotlight and the Commander terminal.</span>
          </div>
        ) : commands.map((command) => (
          <article className={command.enabled ? 'is-enabled' : 'is-disabled'} key={command.id}>
            <div className="shell-command-list__identity">
              <code>{command.name}</code>
              <div><strong>{command.summary}</strong><span>{command.cwd || 'Active agent workspace'}</span></div>
            </div>
            <div className="shell-command-list__badges">
              {command.runAsSudo && <em className="is-sudo"><Icon name="lock" size={9} /> sudo</em>}
              <em><Icon name="bolt" size={9} /> streamed</em>
            </div>
            <div className="shell-command-list__actions">
              <button type="button" onClick={() => beginEdit(command)} disabled={busy || Boolean(editingId)} aria-label={`Edit ${command.name}`}><Icon name="edit" size={11} /></button>
              <button type="button" onClick={() => void remove(command)} disabled={busy} aria-label={`Delete ${command.name}`}><Icon name="trash" size={11} /></button>
              <label title={command.enabled ? 'Disable command' : 'Enable command'}>
                <input type="checkbox" checked={command.enabled} disabled={busy} onChange={() => void toggleEnabled(command)} />
                <span />
              </label>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
