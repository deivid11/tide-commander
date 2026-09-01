/**
 * SlackMultiInstanceSetup
 *
 * Custom settings UI for the Slack integration. Renders a left-rail list of
 * instances with an "Add" button, and on the right a per-instance editor
 * (token, app token, mode, polling settings, enable toggle). Each instance
 * persists to its own slack-config-<id>.json + per-instance secret keys via
 * the /api/slack/instances/* endpoints added in the backend.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { IntegrationInfo } from '../../shared/integration-types.js';
import { apiUrl, authFetch } from '../utils/storage';

interface CustomSettingsProps {
  integration: IntegrationInfo;
  onSave: (config: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

interface InstanceStatus {
  connected: boolean;
  error?: string;
  lastChecked: number;
}

interface InstanceConfig {
  enabled: boolean;
  defaultChannelId?: string;
  authMode?: 'auto' | 'socket' | 'polling';
  pollingIntervalSec?: number;
  pollingConcurrency?: number;
  pollingBackfillMessageCap?: number;
  currentMode?: 'socket' | 'polling' | 'none';
  status?: string;
  lastError?: string;
}

interface InstanceListEntry {
  id: string;
  label: string;
  createdAt: number;
  status: InstanceStatus;
  config: InstanceConfig;
}

interface InstanceValues {
  enabled: boolean;
  defaultChannelId: string;
  authMode: 'auto' | 'socket' | 'polling';
  pollingIntervalSec: number;
  pollingConcurrency: number;
  pollingBackfillMessageCap: number;
  pollingChannelTypes: string;
  pollingChannelAllowlist: string;
  pollingDmsAlways: boolean;
  pollingMinMsBetweenCalls: number;
  currentMode: string;
  mirrorOwnMessages: boolean;
  SLACK_BOT_TOKEN: string;
  SLACK_APP_TOKEN: string;
}

// ─── Channel-type checkbox helpers ───
const ALL_CHANNEL_TYPES = ['public_channel', 'private_channel', 'im', 'mpim'] as const;
type ChannelType = typeof ALL_CHANNEL_TYPES[number];

const TYPE_LABELS: Record<ChannelType, string> = {
  public_channel: 'Public channels',
  private_channel: 'Private channels',
  im: '1:1 DMs',
  mpim: 'Group DMs',
};

function parseChannelTypes(csv: string): Set<ChannelType> {
  const out = new Set<ChannelType>();
  for (const raw of (csv || '').split(',')) {
    const t = raw.trim();
    if ((ALL_CHANNEL_TYPES as readonly string[]).includes(t)) out.add(t as ChannelType);
  }
  return out;
}

function serializeChannelTypes(set: Set<ChannelType>): string {
  return ALL_CHANNEL_TYPES.filter((t) => set.has(t)).join(',');
}

const S = {
  container: { display: 'flex', gap: 16, minHeight: 420 } as const,
  list: {
    width: 200,
    flexShrink: 0,
    background: 'var(--surface-1, #181825)',
    borderRadius: 8,
    border: '1px solid var(--border, #313244)',
    padding: 8,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  } as const,
  listItem: (active: boolean) => ({
    padding: '8px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    background: active ? 'rgba(137,180,250,0.15)' : 'transparent',
    border: active ? '1px solid rgba(137,180,250,0.3)' : '1px solid transparent',
    color: active ? '#cdd6f4' : '#a6adc8',
    fontSize: 13,
  }) as const,
  label: { fontWeight: 500 } as const,
  sub: { fontSize: 11, color: '#6c7086', marginTop: 2 } as const,
  addBtn: {
    marginTop: 8,
    padding: '8px 10px',
    borderRadius: 6,
    background: 'transparent',
    color: '#89b4fa',
    border: '1px dashed rgba(137,180,250,0.4)',
    cursor: 'pointer',
    fontSize: 13,
  } as const,
  editor: { flex: 1, display: 'flex', flexDirection: 'column' as const, gap: 12 } as const,
  field: { display: 'flex', flexDirection: 'column' as const, gap: 4 } as const,
  fieldLabel: { fontSize: 12, fontWeight: 500, color: '#a6adc8' } as const,
  fieldDesc: { fontSize: 11, color: '#6c7086' } as const,
  input: {
    padding: '8px 10px',
    background: 'var(--surface-0, #1e1e2e)',
    border: '1px solid var(--border, #313244)',
    borderRadius: 6,
    color: '#cdd6f4',
    fontSize: 13,
    fontFamily: 'inherit',
  } as const,
  badge: (mode: string) => {
    const colorMap: Record<string, string> = {
      socket: '#a6e3a1',
      polling: '#89b4fa',
      none: '#6c7086',
    };
    const c = colorMap[mode] ?? '#6c7086';
    return {
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 500,
      background: `${c}26`,
      color: c,
      border: `1px solid ${c}55`,
    };
  },
  rowGap: { display: 'flex', gap: 12 } as const,
  buttons: { display: 'flex', gap: 8, marginTop: 12 } as const,
  btnPrimary: {
    padding: '8px 16px',
    background: '#89b4fa',
    color: '#1e1e2e',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: 13,
  } as const,
  btnSecondary: {
    padding: '8px 16px',
    background: 'transparent',
    color: '#cdd6f4',
    border: '1px solid var(--border, #313244)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
  } as const,
  btnDanger: {
    padding: '8px 16px',
    background: 'transparent',
    color: '#f38ba8',
    border: '1px solid rgba(243,139,168,0.4)',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 13,
  } as const,
  alert: (kind: 'error' | 'success') => ({
    padding: '8px 12px',
    borderRadius: 6,
    fontSize: 12,
    background: kind === 'error' ? 'rgba(243,139,168,0.15)' : 'rgba(166,227,161,0.15)',
    color: kind === 'error' ? '#f38ba8' : '#a6e3a1',
    border: `1px solid ${kind === 'error' ? 'rgba(243,139,168,0.3)' : 'rgba(166,227,161,0.3)'}`,
  }),
};

const INSTANCES_BASE = '/api/slack/instances';

async function fetchInstances(): Promise<InstanceListEntry[]> {
  const r = await authFetch(apiUrl(INSTANCES_BASE));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = (await r.json()) as { instances: InstanceListEntry[] };
  return data.instances;
}

async function fetchInstanceValues(id: string): Promise<InstanceValues> {
  const r = await authFetch(apiUrl(`${INSTANCES_BASE}/${encodeURIComponent(id)}/values`));
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = (await r.json()) as { values: InstanceValues };
  return data.values;
}

async function createInstance(id: string, label: string): Promise<void> {
  const r = await authFetch(apiUrl(INSTANCES_BASE), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, label }),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
  }
}

async function patchInstance(
  id: string,
  payload: { label?: string; values?: Partial<InstanceValues> },
): Promise<void> {
  const r = await authFetch(apiUrl(`${INSTANCES_BASE}/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
  }
}

async function deleteInstance(id: string): Promise<void> {
  const r = await authFetch(apiUrl(`${INSTANCES_BASE}/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  });
  if (!r.ok) {
    const data = await r.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `HTTP ${r.status}`);
  }
}

export const SlackMultiInstanceSetup: React.FC<CustomSettingsProps> = ({ integration, onCancel }) => {
  void integration; // we drive everything off /api/slack/instances directly
  const [instances, setInstances] = useState<InstanceListEntry[]>([]);
  const [activeId, setActiveId] = useState<string>('default');
  const [values, setValues] = useState<InstanceValues | null>(null);
  const [originalValues, setOriginalValues] = useState<InstanceValues | null>(null);
  const [labelDraft, setLabelDraft] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);

  const loadInstances = useCallback(async () => {
    try {
      const list = await fetchInstances();
      setInstances(list);
      const stillExists = list.some((i) => i.id === activeId);
      if (!stillExists && list.length > 0) {
        setActiveId(list[0].id);
      }
    } catch (err) {
      setAlert({ kind: 'error', message: `Failed to load instances: ${(err as Error).message}` });
    }
  }, [activeId]);

  const loadActive = useCallback(async () => {
    if (!activeId) return;
    setLoading(true);
    try {
      const v = await fetchInstanceValues(activeId);
      setValues(v);
      setOriginalValues(v);
      const meta = instances.find((i) => i.id === activeId);
      setLabelDraft(meta?.label ?? activeId);
    } catch (err) {
      setAlert({ kind: 'error', message: `Failed to load instance: ${(err as Error).message}` });
    } finally {
      setLoading(false);
    }
  }, [activeId, instances]);

  useEffect(() => { void loadInstances(); }, [loadInstances]);
  useEffect(() => { void loadActive(); }, [loadActive]);

  const handleAdd = async () => {
    const id = window.prompt('Instance id (kebab-case, e.g. "personal", "team-bot"):');
    if (!id) return;
    const label = window.prompt('Display label:', id) || id;
    try {
      await createInstance(id.trim(), label.trim());
      await loadInstances();
      setActiveId(id.trim());
      setAlert({ kind: 'success', message: `Created "${id}"` });
    } catch (err) {
      setAlert({ kind: 'error', message: (err as Error).message });
    }
  };

  const handleDelete = async () => {
    if (activeId === 'default') return;
    if (!window.confirm(`Delete Slack instance "${activeId}"? This disconnects it and removes its config.`)) return;
    try {
      await deleteInstance(activeId);
      setActiveId('default');
      await loadInstances();
      setAlert({ kind: 'success', message: 'Instance deleted' });
    } catch (err) {
      setAlert({ kind: 'error', message: (err as Error).message });
    }
  };

  const handleSave = async () => {
    if (!values || !originalValues) return;
    setSaving(true);
    try {
      // Compute the values diff so we don't overwrite masked tokens with '********'.
      const dirty: Partial<InstanceValues> = {};
      (Object.keys(values) as Array<keyof InstanceValues>).forEach((k) => {
        const v = values[k];
        if (v !== originalValues[k]) {
          // Skip masked-token noise: if user didn't change the token field it's still '********'.
          if ((k === 'SLACK_BOT_TOKEN' || k === 'SLACK_APP_TOKEN') && v === '********') return;
          (dirty as Record<string, unknown>)[k] = v;
        }
      });
      const meta = instances.find((i) => i.id === activeId);
      const labelChanged = meta && labelDraft.trim() && labelDraft.trim() !== meta.label;

      await patchInstance(activeId, {
        label: labelChanged ? labelDraft.trim() : undefined,
        values: Object.keys(dirty).length > 0 ? dirty : undefined,
      });
      setAlert({ kind: 'success', message: 'Saved. Slack will reconnect with the new settings.' });
      await loadInstances();
      await loadActive();
    } catch (err) {
      setAlert({ kind: 'error', message: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const setField = <K extends keyof InstanceValues>(key: K, val: InstanceValues[K]) => {
    if (!values) return;
    setValues({ ...values, [key]: val });
  };

  return (
    <div>
      <div style={{ marginBottom: 12, fontSize: 12, color: '#a6adc8' }}>
        Add multiple Slack connections side-by-side. The default instance maps to your existing
        bot / token; add more for personal (xoxp-) tokens or additional workspaces.
      </div>
      {alert && (
        <div style={{ ...S.alert(alert.kind), marginBottom: 12 }}>{alert.message}</div>
      )}
      <div style={S.container}>
        {/* Left rail: instance list */}
        <div style={S.list}>
          {instances.map((meta) => {
            const mode = meta.config?.currentMode ?? 'none';
            return (
              <div
                key={meta.id}
                style={S.listItem(meta.id === activeId)}
                onClick={() => setActiveId(meta.id)}
              >
                <div style={S.label}>{meta.label}</div>
                <div style={S.sub}>
                  <span style={S.badge(mode)}>{mode === 'none' ? '—' : mode}</span>
                  {meta.status?.connected ? ' • connected' : meta.status?.error ? ' • error' : ' • idle'}
                </div>
              </div>
            );
          })}
          <button type="button" style={S.addBtn} onClick={handleAdd}>+ Add Instance</button>
        </div>

        {/* Right pane: editor */}
        <div style={S.editor}>
          {loading && <div style={{ color: '#6c7086', fontSize: 13 }}>Loading…</div>}
          {!loading && values && (
            <>
              <div style={S.field}>
                <span style={S.fieldLabel}>Display label</span>
                <input
                  type="text"
                  style={S.input}
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  disabled={activeId === 'default' && labelDraft === 'Default' ? false : false}
                />
                <span style={S.fieldDesc}>Shown in the instance list. Id is fixed: <code>{activeId}</code></span>
              </div>

              <div style={S.field}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={values.enabled}
                    onChange={(e) => setField('enabled', e.target.checked)}
                  />
                  <span style={S.fieldLabel}>Enabled</span>
                </label>
                <span style={S.fieldDesc}>Toggle off to disconnect this instance without deleting its config.</span>
              </div>

              <div style={S.field}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={values.mirrorOwnMessages}
                    onChange={(e) => setField('mirrorOwnMessages', e.target.checked)}
                  />
                  <span style={S.fieldLabel}>Mirror messages I send too</span>
                </label>
                <span style={S.fieldDesc}>
                  Capture your outgoing messages alongside incoming ones (logged as <code>direction:outbound</code>).
                  Recommended for personal (xoxp-) tokens. Triggers do not fire on your own messages — that would loop.
                </span>
              </div>

              <div style={S.field}>
                <span style={S.fieldLabel}>Slack Token</span>
                <input
                  type="password"
                  style={S.input}
                  placeholder="xoxb-... or xoxp-..."
                  value={values.SLACK_BOT_TOKEN}
                  onChange={(e) => setField('SLACK_BOT_TOKEN', e.target.value)}
                />
                <span style={S.fieldDesc}>
                  Bot token (xoxb-) → Socket Mode. User token (xoxp-) → Web API polling (~30-60s lag).
                  Stored encrypted under a per-instance key; leave as <code>********</code> to keep the existing token.
                </span>
              </div>

              <div style={S.field}>
                <span style={S.fieldLabel}>App Token (Socket Mode only)</span>
                <input
                  type="password"
                  style={S.input}
                  placeholder="xapp-..."
                  value={values.SLACK_APP_TOKEN}
                  onChange={(e) => setField('SLACK_APP_TOKEN', e.target.value)}
                />
                <span style={S.fieldDesc}>Required for xoxb- only. Leave blank for xoxp- (polling mode).</span>
              </div>

              <div style={S.rowGap}>
                <div style={{ ...S.field, flex: 1 }}>
                  <span style={S.fieldLabel}>Inbound Mode</span>
                  <select
                    style={S.input}
                    value={values.authMode}
                    onChange={(e) => setField('authMode', e.target.value as InstanceValues['authMode'])}
                  >
                    <option value="auto">Auto (from token prefix)</option>
                    <option value="socket">Socket Mode (xoxb-)</option>
                    <option value="polling">Polling (xoxp-)</option>
                  </select>
                </div>
                <div style={{ ...S.field, flex: 1 }}>
                  <span style={S.fieldLabel}>Default Channel</span>
                  <input
                    type="text"
                    style={S.input}
                    placeholder="C0123456789"
                    value={values.defaultChannelId}
                    onChange={(e) => setField('defaultChannelId', e.target.value)}
                  />
                </div>
              </div>

              <div style={S.rowGap}>
                <div style={{ ...S.field, flex: 1 }}>
                  <span style={S.fieldLabel}>Polling Interval (s)</span>
                  <input
                    type="number"
                    style={S.input}
                    min={10}
                    max={600}
                    value={values.pollingIntervalSec}
                    onChange={(e) => setField('pollingIntervalSec', Number(e.target.value))}
                  />
                </div>
                <div style={{ ...S.field, flex: 1 }}>
                  <span style={S.fieldLabel}>Concurrency</span>
                  <input
                    type="number"
                    style={S.input}
                    min={1}
                    max={8}
                    value={values.pollingConcurrency}
                    onChange={(e) => setField('pollingConcurrency', Number(e.target.value))}
                  />
                </div>
                <div style={{ ...S.field, flex: 1 }}>
                  <span style={S.fieldLabel}>Backfill Cap (msgs)</span>
                  <input
                    type="number"
                    style={S.input}
                    min={1}
                    max={1000}
                    value={values.pollingBackfillMessageCap}
                    onChange={(e) => setField('pollingBackfillMessageCap', Number(e.target.value))}
                  />
                </div>
                <div style={{ ...S.field, flex: 1 }}>
                  <span style={S.fieldLabel}>Min ms between calls</span>
                  <input
                    type="number"
                    style={S.input}
                    min={0}
                    max={10000}
                    value={values.pollingMinMsBetweenCalls}
                    onChange={(e) => setField('pollingMinMsBetweenCalls', Number(e.target.value))}
                  />
                  <span style={{ ...S.fieldDesc, fontSize: 11 }}>
                    Throttle. 1500 ≈ 40 req/min. Set 0 to disable.
                  </span>
                </div>
              </div>

              <div style={S.field}>
                <span style={S.fieldLabel}>Channel Types (poll all of these)</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
                  {ALL_CHANNEL_TYPES.map((t) => {
                    const set = parseChannelTypes(values.pollingChannelTypes);
                    const checked = set.has(t);
                    return (
                      <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set(parseChannelTypes(values.pollingChannelTypes));
                            if (e.target.checked) next.add(t); else next.delete(t);
                            setField('pollingChannelTypes', serializeChannelTypes(next));
                          }}
                        />
                        <span>{TYPE_LABELS[t]}</span>
                      </label>
                    );
                  })}
                </div>
                <span style={S.fieldDesc}>
                  Determines which channel types are polled when the allowlist below is empty. Tick all four for full coverage. Heads-up: hundreds of channels at once can hit Slack's rate limit (~50 req/min) — use the allowlist to narrow down.
                </span>
              </div>

              <div style={S.field}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={S.fieldLabel}>Channel Allowlist (optional)</span>
                  {values.pollingChannelAllowlist && (
                    <button
                      type="button"
                      style={{ ...S.btnSecondary, padding: '4px 10px', fontSize: 12 }}
                      onClick={() => setField('pollingChannelAllowlist', '')}
                      title="Clear the allowlist — fall back to polling all channels per the type checkboxes above."
                    >
                      Include all (clear list)
                    </button>
                  )}
                </div>
                <textarea
                  style={{ ...S.input, minHeight: 60, fontFamily: 'monospace', fontSize: 12 }}
                  placeholder="C0123456789, G0987654321&#10;C9999999999"
                  value={values.pollingChannelAllowlist}
                  onChange={(e) => setField('pollingChannelAllowlist', e.target.value)}
                />
                <span style={S.fieldDesc}>
                  Comma- or newline-separated channel IDs. When set, polling restricts to these channels (plus DMs if "Always include DMs" is on). The Channel Types checkboxes above are ignored while an allowlist is active. Leave blank to fall back to polling all channels per the type checkboxes.
                </span>
              </div>

              <div style={S.field}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={values.pollingDmsAlways}
                    onChange={(e) => setField('pollingDmsAlways', e.target.checked)}
                  />
                  <span style={S.fieldLabel}>Always include DMs</span>
                </label>
                <span style={S.fieldDesc}>
                  When the allowlist is set, still poll all 1:1 DMs (D-prefix). Default on. Turn off for strict allowlist-only mode.
                </span>
              </div>

              <div style={S.buttons}>
                <button type="button" style={S.btnPrimary} onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save & Reconnect'}
                </button>
                <button type="button" style={S.btnSecondary} onClick={onCancel}>Close</button>
                {activeId !== 'default' && (
                  <button type="button" style={{ ...S.btnDanger, marginLeft: 'auto' }} onClick={handleDelete}>
                    Delete Instance
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SlackMultiInstanceSetup;
