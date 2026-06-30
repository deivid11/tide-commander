/**
 * TriggerManagerPanel
 * UI for managing triggers: list, create/edit, match mode selector,
 * test match button, and fire history log.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAgents } from '../store';
import { apiUrl, authFetch } from '../utils/storage';
import type {
  Trigger, TriggerType, MatchMode, ExtractionMode,
  LLMMatchResult, TestMatchResult, TriggerFireRow,
} from '../../shared/trigger-types';

interface TriggerManagerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type PanelView = 'list' | 'edit';

const TRIGGER_TYPES: { value: TriggerType; label: string }[] = [
  { value: 'webhook', label: 'Webhook' },
  { value: 'bitbucket', label: 'Bitbucket' },
  { value: 'cron', label: 'Cron' },
  { value: 'slack', label: 'Slack' },
  { value: 'email', label: 'Email' },
  { value: 'jira', label: 'Jira' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

type TypeFilter = 'all' | TriggerType;

const TYPE_TAB_DEFS: { value: TypeFilter; label: string; icon: string }[] = [
  { value: 'all',       label: 'All',       icon: '◎' },
  { value: 'webhook',   label: 'Webhook',   icon: '🪝' },
  { value: 'bitbucket', label: 'Bitbucket', icon: '🪣' },
  { value: 'cron',      label: 'Cron',      icon: '⏰' },
  { value: 'slack',     label: 'Slack',     icon: '💬' },
  { value: 'email',     label: 'Email',     icon: '✉️' },
  { value: 'jira',      label: 'Jira',      icon: '🎫' },
  { value: 'whatsapp',  label: 'WhatsApp',  icon: '📱' },
];

const BITBUCKET_EVENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'pullrequest:created', label: 'PR created' },
  { value: 'pullrequest:updated', label: 'PR updated' },
  { value: 'pullrequest:approved', label: 'PR approved' },
  { value: 'pullrequest:unapproved', label: 'PR unapproved' },
  { value: 'pullrequest:fulfilled', label: 'PR merged' },
  { value: 'pullrequest:rejected', label: 'PR declined' },
  { value: 'pullrequest:comment_created', label: 'PR comment created' },
];

const MATCH_MODES: { value: MatchMode; label: string; desc: string }[] = [
  { value: 'structural', label: 'Structural', desc: 'Field-based matching (fast, free)' },
  { value: 'llm', label: 'LLM', desc: 'Semantic matching via LLM (flexible, costs tokens)' },
  { value: 'hybrid', label: 'Hybrid', desc: 'Structural pre-filter + LLM (recommended)' },
];

const EXTRACTION_MODES: { value: ExtractionMode; label: string }[] = [
  { value: 'structural', label: 'Structural' },
  { value: 'llm', label: 'LLM' },
];

// Convert an ISO datetime string (UTC) to the value format expected by
// <input type="datetime-local"> (YYYY-MM-DDTHH:mm in local time). Returns
// empty string for invalid / missing input.
function toDatetimeLocal(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const emptyTrigger = (): Partial<Trigger> => ({
  name: '',
  description: '',
  type: 'webhook',
  agentId: '',
  promptTemplate: '',
  enabled: true,
  matchMode: 'structural',
  extractionMode: 'structural',
  config: { method: 'POST' } as any,
});

export function TriggerManagerPanel({ isOpen, onClose }: TriggerManagerPanelProps) {
  const agents = useAgents();
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [view, setView] = useState<PanelView>('list');
  const [editingTrigger, setEditingTrigger] = useState<Partial<Trigger>>(emptyTrigger());
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fire history
  const [fireHistory, setFireHistory] = useState<TriggerFireRow[]>([]);
  const [selectedTriggerId, setSelectedTriggerId] = useState<string | null>(null);

  // Test match
  const [testPayload, setTestPayload] = useState('{\n  \n}');
  const [testResult, setTestResult] = useState<TestMatchResult | null>(null);
  const [testing, setTesting] = useState(false);

  // Cron validation
  const [cronNextFires, setCronNextFires] = useState<string[]>([]);

  // Type-filter tab selection (persisted across the session)
  const [selectedType, setSelectedType] = useState<TypeFilter>('all');

  // Slack instances (for the instanceId selector in the edit form)
  const [slackInstances, setSlackInstances] = useState<{ id: string; label: string }[]>([]);

  // ─── Data Loading ───

  const loadTriggers = useCallback(async () => {
    try {
      const res = await authFetch(apiUrl('/api/triggers'));
      if (res.ok) {
        const data = await res.json();
        setTriggers(data);
      }
    } catch (err) {
      console.error('Failed to load triggers:', err);
    }
  }, []);

  const loadHistory = useCallback(async (triggerId: string) => {
    try {
      const res = await authFetch(apiUrl(`/api/triggers/${triggerId}/events?limit=20`));
      if (res.ok) {
        const data = await res.json();
        setFireHistory(data);
      }
    } catch (err) {
      console.error('Failed to load trigger history:', err);
    }
  }, []);

  const loadSlackInstances = useCallback(async () => {
    try {
      const res = await authFetch(apiUrl('/api/slack/instances'));
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data?.instances) ? data.instances : [];
        setSlackInstances(list.map((i: { id: string; label?: string }) => ({ id: i.id, label: i.label || i.id })));
      }
    } catch (err) {
      console.error('Failed to load Slack instances:', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadTriggers();
      loadSlackInstances();
    }
  }, [isOpen, loadTriggers, loadSlackInstances]);

  useEffect(() => {
    if (selectedTriggerId) {
      loadHistory(selectedTriggerId);
    }
  }, [selectedTriggerId, loadHistory]);

  // ─── CRUD Actions ───

  const handleSave = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const url = isEditing
        ? apiUrl(`/api/triggers/${editingTrigger.id}`)
        : apiUrl('/api/triggers');
      const method = isEditing ? 'PATCH' : 'POST';

      const body = isEditing ? editingTrigger : editingTrigger;

      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save trigger');
      }

      await loadTriggers();
      setView('list');
      setEditingTrigger(emptyTrigger());
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  }, [editingTrigger, isEditing, loadTriggers]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await authFetch(apiUrl(`/api/triggers/${id}`), { method: 'DELETE' });
      await loadTriggers();
    } catch (err) {
      console.error('Failed to delete trigger:', err);
    }
  }, [loadTriggers]);

  const handleToggleEnabled = useCallback(async (trigger: Trigger) => {
    try {
      await authFetch(apiUrl(`/api/triggers/${trigger.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !trigger.enabled }),
      });
      await loadTriggers();
    } catch (err) {
      console.error('Failed to toggle trigger:', err);
    }
  }, [loadTriggers]);

  // ─── Test Actions ───

  const handleTestFire = useCallback(async (triggerId: string) => {
    try {
      await authFetch(apiUrl(`/api/triggers/${triggerId}/fire`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variables: {} }),
      });
      if (selectedTriggerId === triggerId) {
        await loadHistory(triggerId);
      }
    } catch (err) {
      console.error('Failed to test fire trigger:', err);
    }
  }, [selectedTriggerId, loadHistory]);

  const handleTestMatch = useCallback(async () => {
    if (!editingTrigger.id) return;
    setTesting(true);
    setTestResult(null);

    try {
      let payload: unknown;
      try {
        payload = JSON.parse(testPayload);
      } catch {
        setTestResult({ structuralMatch: undefined, extractedVariables: {}, wouldFire: false });
        setError('Invalid JSON payload');
        return;
      }

      const res = await authFetch(apiUrl(`/api/triggers/${editingTrigger.id}/test-match`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }),
      });

      if (res.ok) {
        const result = await res.json();
        setTestResult(result);
        setError(null);
      } else {
        const data = await res.json();
        setError(data.error || 'Test match failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Test match failed');
    } finally {
      setTesting(false);
    }
  }, [editingTrigger.id, testPayload]);

  const handleValidateCron = useCallback(async (expression: string) => {
    try {
      const res = await authFetch(apiUrl('/api/triggers/validate-cron'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expression,
          timezone: (editingTrigger as any).config?.timezone || 'UTC',
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setCronNextFires(data.valid ? data.nextFires : []);
      }
    } catch {
      setCronNextFires([]);
    }
  }, [editingTrigger]);

  // ─── Edit Helpers ───

  const openEditor = useCallback((trigger?: Trigger) => {
    if (trigger) {
      setEditingTrigger({ ...trigger });
      setIsEditing(true);
    } else {
      setEditingTrigger(emptyTrigger());
      setIsEditing(false);
    }
    setTestResult(null);
    setError(null);
    setView('edit');
  }, []);

  const updateField = useCallback((field: string, value: unknown) => {
    setEditingTrigger(prev => ({ ...prev, [field]: value }));
  }, []);

  const updateConfig = useCallback((field: string, value: unknown) => {
    setEditingTrigger(prev => ({
      ...prev,
      config: { ...(prev as any).config, [field]: value },
    }));
  }, []);

  const updateLlmMatch = useCallback((field: string, value: unknown) => {
    setEditingTrigger(prev => ({
      ...prev,
      llmMatch: { ...(prev.llmMatch || { prompt: '' }), [field]: value },
    }));
  }, []);

  const updateLlmExtract = useCallback((field: string, value: unknown) => {
    setEditingTrigger(prev => ({
      ...prev,
      llmExtract: { ...(prev.llmExtract || { prompt: '', variables: [] }), [field]: value },
    }));
  }, []);

  // ─── Agents list for dropdown ───
  const agentsList = useMemo(() => {
    return Array.from(agents.values()).map(a => ({ id: a.id, name: a.name, class: a.class }));
  }, [agents]);

  // ─── Per-type counts for the tab bar ───
  const typeCounts = useMemo(() => {
    const counts: Record<TypeFilter, number> = {
      all: triggers.length,
      webhook: 0, bitbucket: 0, cron: 0, slack: 0, email: 0, jira: 0, whatsapp: 0,
    };
    for (const t of triggers) {
      if (t.type in counts) counts[t.type as TriggerType] += 1;
    }
    return counts;
  }, [triggers]);

  const filteredTriggers = useMemo(() => {
    if (selectedType === 'all') return triggers;
    return triggers.filter(t => t.type === selectedType);
  }, [triggers, selectedType]);

  // ─── Copy-to-clipboard with brief "Copied!" feedback ───
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyToClipboard = useCallback((value: string, key: string) => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(
      () => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1500);
      },
      () => setError('Failed to copy to clipboard'),
    );
  }, []);

  if (!isOpen) return null;

  // ─── Render ───

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <h2 style={styles.title}>
            {view === 'list' ? 'Triggers' : (isEditing ? 'Edit Trigger' : 'New Trigger')}
          </h2>
          <div style={styles.headerActions}>
            {view === 'list' && (
              <button style={styles.addBtn} onClick={() => openEditor()}>+ New Trigger</button>
            )}
            {view === 'edit' && (
              <button style={styles.backBtn} onClick={() => { setView('list'); setTestResult(null); setError(null); }}>
                Back
              </button>
            )}
            <button style={styles.closeBtn} onClick={onClose}>X</button>
          </div>
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {/* List View */}
        {view === 'list' && (
          <div style={styles.content}>
            <div style={styles.tabBar} role="tablist" aria-label="Filter triggers by type">
              {TYPE_TAB_DEFS.map(tab => {
                const count = typeCounts[tab.value];
                const active = selectedType === tab.value;
                return (
                  <button
                    key={tab.value}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelectedType(tab.value)}
                    style={{ ...styles.tab, ...(active ? styles.tabActive : {}) }}
                    title={`${tab.label} (${count})`}
                  >
                    <span style={styles.tabIcon}>{tab.icon}</span>
                    <span style={styles.tabLabel}>{tab.label}</span>
                    <span style={{ ...styles.tabBadge, ...(active ? styles.tabBadgeActive : {}) }}>{count}</span>
                  </button>
                );
              })}
            </div>
            {triggers.length === 0 ? (
              <div style={styles.empty}>No triggers configured. Create one to get started.</div>
            ) : filteredTriggers.length === 0 ? (
              <div style={styles.empty}>
                No {selectedType} triggers configured yet.
              </div>
            ) : (
              filteredTriggers.map(trigger => (
                <div
                  key={trigger.id}
                  style={{
                    ...styles.triggerCard,
                    borderLeftColor: trigger.status === 'error' ? '#e74c3c' : trigger.enabled ? '#2ecc71' : '#95a5a6',
                  }}
                  onClick={() => { setSelectedTriggerId(trigger.id); openEditor(trigger); }}
                >
                  <div style={styles.cardHeader}>
                    <div style={styles.cardTitle}>
                      <span style={styles.typeTag}>{trigger.type}</span>
                      <span>{trigger.name}</span>
                      {trigger.type === 'cron' && (() => {
                        const cfg = (trigger as any).config || {};
                        if (!cfg.runOnce) {
                          return <span style={styles.matchTag}>Recurring</span>;
                        }
                        if (cfg.completedAt) {
                          return <span style={{ ...styles.matchTag, color: '#a6e3a1' }}>Once · completed</span>;
                        }
                        if (cfg.missedAt) {
                          return <span style={{ ...styles.matchTag, color: '#f38ba8' }}>Once · missed</span>;
                        }
                        return <span style={{ ...styles.matchTag, color: '#f9e2af' }}>Once · pending</span>;
                      })()}
                      {trigger.matchMode !== 'structural' && (
                        <span style={styles.matchTag}>{trigger.matchMode}</span>
                      )}
                    </div>
                    <div style={styles.cardActions}>
                      <button
                        style={styles.smallBtn}
                        onClick={e => { e.stopPropagation(); handleToggleEnabled(trigger); }}
                      >
                        {trigger.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        style={styles.smallBtn}
                        onClick={e => { e.stopPropagation(); handleTestFire(trigger.id); }}
                      >
                        Test Fire
                      </button>
                      <button
                        style={{ ...styles.smallBtn, color: '#e74c3c' }}
                        onClick={e => { e.stopPropagation(); handleDelete(trigger.id); }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div style={styles.cardMeta}>
                    <span>Agent: {agents.get(trigger.agentId)?.name || trigger.agentId}</span>
                    <span>Fires: {trigger.fireCount}</span>
                    {trigger.lastFiredAt && (
                      <span>Last: {new Date(trigger.lastFiredAt).toLocaleString()}</span>
                    )}
                    {trigger.status === 'error' && trigger.lastError && (
                      <span style={{ color: '#e74c3c' }}>Error: {trigger.lastError}</span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Edit View */}
        {view === 'edit' && (
          <div style={styles.content}>
            <div style={styles.form}>
              {/* Basic Fields */}
              <div style={styles.field}>
                <label style={styles.label}>Name</label>
                <input
                  style={styles.input}
                  value={editingTrigger.name || ''}
                  onChange={e => updateField('name', e.target.value)}
                  placeholder="My Trigger"
                />
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Description</label>
                <input
                  style={styles.input}
                  value={editingTrigger.description || ''}
                  onChange={e => updateField('description', e.target.value)}
                  placeholder="Optional description"
                />
              </div>

              <div style={styles.row}>
                <div style={styles.field}>
                  <label style={styles.label}>Type</label>
                  <select
                    style={styles.select}
                    value={editingTrigger.type || 'webhook'}
                    onChange={e => {
                      const type = e.target.value as TriggerType;
                      updateField('type', type);
                      // Reset config for new type
                      if (type === 'webhook') updateField('config', { method: 'POST' });
                      else if (type === 'cron') updateField('config', { expression: '0 9 * * MON-FRI', timezone: 'UTC' });
                      else if (type === 'bitbucket') updateField('config', { workspace: '', repoSlug: '', events: ['pullrequest:created', 'pullrequest:updated'] });
                      else updateField('config', {});
                      // Seed a sensible default promptTemplate for source types
                      // that surface attachments — but ONLY when the user
                      // hasn't typed anything yet, so we don't clobber custom
                      // templates on type-toggle.
                      const currentPrompt = (editingTrigger.promptTemplate ?? '').trim();
                      if (!currentPrompt) {
                        if (type === 'slack') {
                          updateField('promptTemplate', 'Slack message from {{slack.user}} in {{slack.channelName}}:\n{{slack.message}}\n\n{{slack.attachmentsBlock}}');
                        } else if (type === 'whatsapp') {
                          updateField('promptTemplate', 'WhatsApp message from {{whatsapp.fromName}} ({{whatsapp.from}}):\n{{whatsapp.body}}\n\n{{whatsapp.attachmentsBlock}}');
                        }
                      }
                    }}
                  >
                    {TRIGGER_TYPES.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>

                <div style={styles.field}>
                  <label style={styles.label}>Agent</label>
                  <select
                    style={styles.select}
                    value={editingTrigger.agentId || ''}
                    onChange={e => updateField('agentId', e.target.value)}
                  >
                    <option value="">Select agent...</option>
                    {agentsList.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.class})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={styles.field}>
                <label style={styles.label}>Prompt Template</label>
                <textarea
                  style={styles.textarea}
                  value={editingTrigger.promptTemplate || ''}
                  onChange={e => updateField('promptTemplate', e.target.value)}
                  placeholder="Message sent to agent. Use {{variable}} for interpolation."
                  rows={4}
                />
              </div>

              {/* Type-Specific Config */}
              {editingTrigger.type === 'webhook' && (
                <div style={styles.section}>
                  <h4 style={styles.sectionTitle}>Webhook Config</h4>
                  <div style={styles.row}>
                    <div style={styles.field}>
                      <label style={styles.label}>Method</label>
                      <select
                        style={styles.select}
                        value={(editingTrigger as any).config?.method || 'POST'}
                        onChange={e => updateConfig('method', e.target.value)}
                      >
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                      </select>
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Secret (HMAC)</label>
                      <input
                        style={styles.input}
                        type="password"
                        value={(editingTrigger as any).config?.secret || ''}
                        onChange={e => updateConfig('secret', e.target.value || undefined)}
                        placeholder="Optional HMAC secret"
                      />
                    </div>
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>Extract Fields (comma-separated JSON paths)</label>
                    <input
                      style={styles.input}
                      value={(editingTrigger as any).config?.extractFields?.join(', ') || ''}
                      onChange={e => updateConfig('extractFields', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
                      placeholder="body.release_name, body.version"
                    />
                  </div>
                  {isEditing && editingTrigger.id && (
                    <div style={styles.webhookUrl}>
                      <label style={styles.label}>Webhook URL</label>
                      <code style={styles.code}>
                        {`${window.location.origin}/api/triggers/webhook/${editingTrigger.id}`}
                      </code>
                    </div>
                  )}
                </div>
              )}

              {editingTrigger.type === 'bitbucket' && (() => {
                const cfg = (editingTrigger as any).config || {};
                const selectedEvents: string[] = Array.isArray(cfg.events) ? cfg.events : [];
                const webhookUrl = isEditing && editingTrigger.id
                  ? `${window.location.origin}/api/triggers/webhook/${editingTrigger.id}`
                  : '';
                const toggleEvent = (eventKey: string) => {
                  const next = selectedEvents.includes(eventKey)
                    ? selectedEvents.filter(e => e !== eventKey)
                    : [...selectedEvents, eventKey];
                  updateConfig('events', next);
                };
                return (
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Bitbucket Config</h4>
                    <div style={styles.row}>
                      <div style={styles.field}>
                        <label style={styles.label}>Workspace</label>
                        <input
                          style={styles.input}
                          value={cfg.workspace || ''}
                          onChange={e => updateConfig('workspace', e.target.value)}
                          placeholder="tide"
                        />
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>Repository slug</label>
                        <input
                          style={styles.input}
                          value={cfg.repoSlug || ''}
                          onChange={e => updateConfig('repoSlug', e.target.value)}
                          placeholder="wind"
                        />
                      </div>
                    </div>

                    <div style={styles.field}>
                      <label style={styles.label}>Events</label>
                      <div style={styles.checkboxGrid}>
                        {BITBUCKET_EVENT_OPTIONS.map(opt => {
                          const checked = selectedEvents.includes(opt.value);
                          return (
                            <label key={opt.value} style={styles.checkboxLabel}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleEvent(opt.value)}
                              />
                              <span>{opt.label}</span>
                              <code style={styles.checkboxCode}>{opt.value}</code>
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div style={styles.field}>
                      <label style={styles.label}>HMAC secret</label>
                      <div style={styles.inlineRow}>
                        <input
                          style={{ ...styles.input, flex: 1 }}
                          type="password"
                          value={cfg.secret || ''}
                          onChange={e => updateConfig('secret', e.target.value || undefined)}
                          placeholder="Shared secret used to validate Bitbucket signature"
                        />
                        <button
                          type="button"
                          style={styles.smallBtn}
                          onClick={() => copyToClipboard(cfg.secret || '', 'bitbucket-secret')}
                          disabled={!cfg.secret}
                        >
                          {copiedKey === 'bitbucket-secret' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <span style={styles.llmMeta}>
                        Paste the same secret into Bitbucket's webhook configuration.
                      </span>
                    </div>

                    {webhookUrl && (
                      <div style={styles.webhookUrl}>
                        <label style={styles.label}>Webhook URL</label>
                        <div style={styles.inlineRow}>
                          <code style={{ ...styles.code, flex: 1 }}>{webhookUrl}</code>
                          <button
                            type="button"
                            style={styles.smallBtn}
                            onClick={() => copyToClipboard(webhookUrl, 'bitbucket-url')}
                          >
                            {copiedKey === 'bitbucket-url' ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                        <span style={styles.llmMeta}>
                          In Bitbucket: Repository settings → Webhooks → Add webhook, then paste this URL and the secret above.
                        </span>
                      </div>
                    )}
                    {!webhookUrl && (
                      <span style={styles.llmMeta}>
                        Save the trigger to reveal its webhook URL.
                      </span>
                    )}
                  </div>
                );
              })()}

              {editingTrigger.type === 'cron' && (() => {
                const cronConfig = (editingTrigger as any).config || {};
                const runOnce = !!cronConfig.runOnce;
                const completedAt = cronConfig.completedAt as number | undefined;
                const missedAt = cronConfig.missedAt as number | undefined;
                const isCompleted = !!completedAt;

                return (
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Cron Config</h4>

                    {/* Kind selector: Repeats vs Run once */}
                    <div style={styles.modeSelector}>
                      <button
                        type="button"
                        style={{
                          ...styles.modeBtn,
                          ...(!runOnce ? styles.modeBtnActive : {}),
                        }}
                        onClick={() => updateConfig('runOnce', false)}
                        disabled={isCompleted}
                      >
                        <strong>Repeats</strong>
                        <span style={styles.modeDesc}>Fires on a cron schedule</span>
                      </button>
                      <button
                        type="button"
                        style={{
                          ...styles.modeBtn,
                          ...(runOnce ? styles.modeBtnActive : {}),
                        }}
                        onClick={() => updateConfig('runOnce', true)}
                        disabled={isCompleted}
                      >
                        <strong>Run once</strong>
                        <span style={styles.modeDesc}>Fires exactly once at a specific time</span>
                      </button>
                    </div>

                    {/* Status banner for completed / missed one-shots */}
                    {isCompleted && (
                      <div style={{ ...styles.testResult, borderLeft: '3px solid #a6e3a1' }}>
                        <strong style={{ color: '#a6e3a1' }}>Completed</strong>
                        <span style={styles.llmMeta}>
                          Fired at {new Date(completedAt).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {!isCompleted && missedAt && (
                      <div style={{ ...styles.testResult, borderLeft: '3px solid #f38ba8' }}>
                        <strong style={{ color: '#f38ba8' }}>Missed</strong>
                        <span style={styles.llmMeta}>
                          Marked missed at {new Date(missedAt).toLocaleString()} (server was down at runAt)
                        </span>
                      </div>
                    )}

                    {runOnce ? (
                      <div style={styles.row}>
                        <div style={styles.field}>
                          <label style={styles.label}>Run at</label>
                          <input
                            style={styles.input}
                            type="datetime-local"
                            value={toDatetimeLocal(cronConfig.runAt)}
                            onChange={e => {
                              const local = e.target.value;
                              if (!local) {
                                updateConfig('runAt', undefined);
                                return;
                              }
                              // datetime-local is interpreted as local time; convert to absolute UTC ISO.
                              const iso = new Date(local).toISOString();
                              updateConfig('runAt', iso);
                            }}
                            disabled={isCompleted}
                          />
                          <span style={styles.llmMeta}>Interpreted in your browser's local timezone</span>
                        </div>
                      </div>
                    ) : (
                      <div style={styles.row}>
                        <div style={styles.field}>
                          <label style={styles.label}>Expression</label>
                          <input
                            style={styles.input}
                            value={cronConfig.expression || ''}
                            onChange={e => {
                              updateConfig('expression', e.target.value);
                              if (e.target.value) handleValidateCron(e.target.value);
                            }}
                            placeholder="0 9 * * MON-FRI"
                          />
                        </div>
                        <div style={styles.field}>
                          <label style={styles.label}>Timezone</label>
                          <input
                            style={styles.input}
                            value={cronConfig.timezone || 'UTC'}
                            onChange={e => updateConfig('timezone', e.target.value)}
                            placeholder="America/Mexico_City"
                          />
                        </div>
                      </div>
                    )}
                    {!runOnce && cronNextFires.length > 0 && (
                      <div style={styles.nextFires}>
                        <label style={styles.label}>Next fires:</label>
                        {cronNextFires.map((d, i) => (
                          <div key={i} style={styles.nextFireItem}>{new Date(d).toLocaleString()}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {editingTrigger.type === 'slack' && (() => {
                const cfg = (editingTrigger as any).config || {};
                return (
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Slack Config</h4>
                    <div style={styles.row}>
                      <div style={styles.field}>
                        <label style={styles.label}>Instance</label>
                        <select
                          style={styles.select}
                          value={cfg.instanceId || ''}
                          onChange={e => updateConfig('instanceId', e.target.value || undefined)}
                        >
                          <option value="">Any instance</option>
                          {slackInstances.map(inst => (
                            <option key={inst.id} value={inst.id}>{inst.label} ({inst.id})</option>
                          ))}
                          {cfg.instanceId && !slackInstances.some(i => i.id === cfg.instanceId) && (
                            <option value={cfg.instanceId}>{cfg.instanceId} (not found)</option>
                          )}
                        </select>
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>Thread timestamp</label>
                        <input
                          style={styles.input}
                          value={cfg.threadTs || ''}
                          onChange={e => updateConfig('threadTs', e.target.value || undefined)}
                          placeholder="Only replies in this thread"
                        />
                      </div>
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Channel ID (legacy single channel)</label>
                      <input
                        style={styles.input}
                        value={cfg.channelId || ''}
                        onChange={e => updateConfig('channelId', e.target.value || undefined)}
                        placeholder="C0123ABCD (blank = any)"
                      />
                    </div>
                    <div style={styles.row}>
                      <div style={styles.field}>
                        <label style={styles.label}>Channel allowlist (comma-separated IDs)</label>
                        <input
                          style={styles.input}
                          value={cfg.channelIdAllowlist?.join(', ') || ''}
                          onChange={e => updateConfig('channelIdAllowlist', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
                          placeholder="C06UCC5FFST, C0789..."
                        />
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>Exclude channel IDs (comma-separated)</label>
                        <input
                          style={styles.input}
                          value={cfg.excludeChannelIds?.join(', ') || ''}
                          onChange={e => updateConfig('excludeChannelIds', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
                          placeholder="D0AMP833LDQ"
                        />
                      </div>
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Message pattern (regex)</label>
                      <input
                        style={styles.input}
                        value={cfg.messagePattern || ''}
                        onChange={e => updateConfig('messagePattern', e.target.value || undefined)}
                        placeholder="deploy|release"
                      />
                    </div>
                    <div style={styles.row}>
                      <div style={styles.field}>
                        <label style={styles.label}>User filter (comma-separated IDs)</label>
                        <input
                          style={styles.input}
                          value={cfg.userFilter?.join(', ') || ''}
                          onChange={e => updateConfig('userFilter', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
                          placeholder="U0123ABCD, U0456EFGH"
                        />
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>Exclude user IDs (comma-separated)</label>
                        <input
                          style={styles.input}
                          value={cfg.excludeUserIds?.join(', ') || ''}
                          onChange={e => updateConfig('excludeUserIds', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
                          placeholder="U0789IJKL"
                        />
                      </div>
                    </div>
                    <div style={styles.checkboxGrid}>
                      <label style={styles.checkboxLabel}>
                        <input type="checkbox" checked={!!cfg.dmOnly} onChange={e => updateConfig('dmOnly', e.target.checked || undefined)} />
                        <span>DMs only</span>
                      </label>
                      <label style={styles.checkboxLabel}>
                        <input type="checkbox" checked={!!cfg.excludeDms} onChange={e => updateConfig('excludeDms', e.target.checked || undefined)} />
                        <span>Exclude DMs</span>
                      </label>
                      <label style={styles.checkboxLabel}>
                        <input type="checkbox" checked={!!cfg.includeOwnMessages} onChange={e => updateConfig('includeOwnMessages', e.target.checked || undefined)} />
                        <span>Include own messages</span>
                      </label>
                    </div>
                  </div>
                );
              })()}

              {editingTrigger.type === 'email' && (() => {
                const cfg = (editingTrigger as any).config || {};
                const approvals = cfg.requiredApprovals;
                const setApprovals = (patch: Record<string, unknown>) =>
                  updateConfig('requiredApprovals', { count: 1, approvers: [], approvalKeywords: [], ...approvals, ...patch });
                return (
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Email Config</h4>
                    <div style={styles.field}>
                      <label style={styles.label}>From filter (comma-separated addresses)</label>
                      <input
                        style={styles.input}
                        value={cfg.fromFilter?.join(', ') || ''}
                        onChange={e => updateConfig('fromFilter', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
                        placeholder="alerts@example.com, ops@example.com"
                      />
                    </div>
                    <div style={styles.row}>
                      <div style={styles.field}>
                        <label style={styles.label}>Subject pattern (regex)</label>
                        <input
                          style={styles.input}
                          value={cfg.subjectPattern || ''}
                          onChange={e => updateConfig('subjectPattern', e.target.value || undefined)}
                          placeholder="^\\[Deploy\\]"
                        />
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>Thread ID</label>
                        <input
                          style={styles.input}
                          value={cfg.threadId || ''}
                          onChange={e => updateConfig('threadId', e.target.value || undefined)}
                          placeholder="Only watch a specific thread"
                        />
                      </div>
                    </div>
                    <div style={styles.field}>
                      <label style={styles.checkboxLabel}>
                        <input
                          type="checkbox"
                          checked={!!approvals}
                          onChange={e => updateConfig('requiredApprovals', e.target.checked ? { count: 1, approvers: [], approvalKeywords: [] } : undefined)}
                        />
                        <span>Require approvals before firing</span>
                      </label>
                    </div>
                    {approvals && (
                      <>
                        <div style={styles.row}>
                          <div style={styles.field}>
                            <label style={styles.label}>Approvals needed</label>
                            <input
                              style={styles.input}
                              type="number"
                              min="1"
                              value={approvals.count ?? 1}
                              onChange={e => setApprovals({ count: parseInt(e.target.value, 10) || 1 })}
                            />
                          </div>
                          <div style={styles.field}>
                            <label style={styles.label}>Approvers (comma-separated)</label>
                            <input
                              style={styles.input}
                              value={approvals.approvers?.join(', ') || ''}
                              onChange={e => setApprovals({ approvers: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })}
                              placeholder="lead@example.com"
                            />
                          </div>
                        </div>
                        <div style={styles.field}>
                          <label style={styles.label}>Approval keywords (comma-separated)</label>
                          <input
                            style={styles.input}
                            value={approvals.approvalKeywords?.join(', ') || ''}
                            onChange={e => setApprovals({ approvalKeywords: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })}
                            placeholder="approved, lgtm, ship it"
                          />
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {editingTrigger.type === 'jira' && (() => {
                const cfg = (editingTrigger as any).config || {};
                return (
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>Jira Config</h4>
                    <div style={styles.row}>
                      <div style={styles.field}>
                        <label style={styles.label}>Project key</label>
                        <input
                          style={styles.input}
                          value={cfg.projectKey || ''}
                          onChange={e => updateConfig('projectKey', e.target.value || undefined)}
                          placeholder="OPS"
                        />
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>Issue type</label>
                        <input
                          style={styles.input}
                          value={cfg.issueType || ''}
                          onChange={e => updateConfig('issueType', e.target.value || undefined)}
                          placeholder="Service Request"
                        />
                      </div>
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Events (comma-separated)</label>
                      <input
                        style={styles.input}
                        value={cfg.events?.join(', ') || ''}
                        onChange={e => updateConfig('events', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
                        placeholder="jira:issue_created, jira:issue_updated"
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>JQL filter</label>
                      <textarea
                        style={styles.textarea}
                        value={cfg.jqlFilter || ''}
                        onChange={e => updateConfig('jqlFilter', e.target.value || undefined)}
                        placeholder='priority = High AND status = Open'
                        rows={2}
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>HMAC / shared secret</label>
                      <input
                        style={styles.input}
                        type="password"
                        value={cfg.secret || ''}
                        onChange={e => updateConfig('secret', e.target.value || undefined)}
                        placeholder="Required — unsigned deliveries are rejected"
                      />
                    </div>
                  </div>
                );
              })()}

              {editingTrigger.type === 'whatsapp' && (() => {
                const cfg = (editingTrigger as any).config || {};
                return (
                  <div style={styles.section}>
                    <h4 style={styles.sectionTitle}>WhatsApp Config</h4>
                    <div style={styles.row}>
                      <div style={styles.field}>
                        <label style={styles.label}>From filter (comma-separated JID substrings)</label>
                        <input
                          style={styles.input}
                          value={cfg.fromFilter?.join(', ') || ''}
                          onChange={e => updateConfig('fromFilter', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
                          placeholder="5215512345678, @g.us"
                        />
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>Direction</label>
                        <select
                          style={styles.select}
                          value={cfg.direction || 'any'}
                          onChange={e => updateConfig('direction', e.target.value === 'any' ? undefined : e.target.value)}
                        >
                          <option value="any">Any</option>
                          <option value="inbound">Inbound</option>
                          <option value="outbound">Outbound</option>
                        </select>
                      </div>
                    </div>
                    <div style={styles.row}>
                      <div style={styles.field}>
                        <label style={styles.label}>Body pattern (regex)</label>
                        <input
                          style={styles.input}
                          value={cfg.bodyPattern || ''}
                          onChange={e => updateConfig('bodyPattern', e.target.value || undefined)}
                          placeholder="urgente|deploy"
                        />
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>Session ID</label>
                        <input
                          style={styles.input}
                          value={cfg.sessionId || ''}
                          onChange={e => updateConfig('sessionId', e.target.value || undefined)}
                          placeholder="Restrict to a Baileys session"
                        />
                      </div>
                    </div>
                    <div style={styles.checkboxGrid}>
                      <label style={styles.checkboxLabel}>
                        <input type="checkbox" checked={!!cfg.groupOnly} onChange={e => updateConfig('groupOnly', e.target.checked || undefined)} />
                        <span>Groups only</span>
                      </label>
                      <label style={styles.checkboxLabel}>
                        <input type="checkbox" checked={!!cfg.dmOnly} onChange={e => updateConfig('dmOnly', e.target.checked || undefined)} />
                        <span>DMs only</span>
                      </label>
                      <label style={styles.checkboxLabel}>
                        <input type="checkbox" checked={!!cfg.includeStatuses} onChange={e => updateConfig('includeStatuses', e.target.checked || undefined)} />
                        <span>Include statuses</span>
                      </label>
                    </div>
                  </div>
                );
              })()}

              {/* Match Mode Selector */}
              <div style={styles.section}>
                <h4 style={styles.sectionTitle}>Match Mode</h4>
                <div style={styles.modeSelector}>
                  {MATCH_MODES.map(mode => (
                    <button
                      key={mode.value}
                      style={{
                        ...styles.modeBtn,
                        ...(editingTrigger.matchMode === mode.value ? styles.modeBtnActive : {}),
                      }}
                      onClick={() => updateField('matchMode', mode.value)}
                    >
                      <strong>{mode.label}</strong>
                      <span style={styles.modeDesc}>{mode.desc}</span>
                    </button>
                  ))}
                </div>

                {(editingTrigger.matchMode === 'llm' || editingTrigger.matchMode === 'hybrid') && (
                  <div style={styles.llmConfig}>
                    <div style={styles.field}>
                      <label style={styles.label}>LLM Match Prompt</label>
                      <textarea
                        style={styles.textarea}
                        value={editingTrigger.llmMatch?.prompt || ''}
                        onChange={e => updateLlmMatch('prompt', e.target.value)}
                        placeholder="Does this message request a release deployment?"
                        rows={3}
                      />
                    </div>
                    <div style={styles.row}>
                      <div style={styles.field}>
                        <label style={styles.label}>Model</label>
                        <select
                          style={styles.select}
                          value={editingTrigger.llmMatch?.model || 'haiku'}
                          onChange={e => updateLlmMatch('model', e.target.value)}
                        >
                          <option value="haiku">Haiku (fast, cheap)</option>
                          <option value="sonnet">Sonnet (balanced)</option>
                          <option value="opus">Opus (powerful)</option>
                        </select>
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>Min Confidence</label>
                        <input
                          style={styles.input}
                          type="number"
                          min="0"
                          max="1"
                          step="0.1"
                          value={editingTrigger.llmMatch?.minConfidence ?? 0}
                          onChange={e => updateLlmMatch('minConfidence', parseFloat(e.target.value))}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Extraction Mode */}
              <div style={styles.section}>
                <h4 style={styles.sectionTitle}>Extraction Mode</h4>
                <div style={styles.row}>
                  {EXTRACTION_MODES.map(mode => (
                    <button
                      key={mode.value}
                      style={{
                        ...styles.modeBtn,
                        ...(editingTrigger.extractionMode === mode.value ? styles.modeBtnActive : {}),
                      }}
                      onClick={() => updateField('extractionMode', mode.value)}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                {editingTrigger.extractionMode === 'llm' && (
                  <div style={styles.llmConfig}>
                    <div style={styles.field}>
                      <label style={styles.label}>Extraction Instructions</label>
                      <textarea
                        style={styles.textarea}
                        value={editingTrigger.llmExtract?.prompt || ''}
                        onChange={e => updateLlmExtract('prompt', e.target.value)}
                        placeholder="Extract: release version, affected systems, urgency"
                        rows={3}
                      />
                    </div>
                    <div style={styles.field}>
                      <label style={styles.label}>Variable Names (comma-separated)</label>
                      <input
                        style={styles.input}
                        value={editingTrigger.llmExtract?.variables?.join(', ') || ''}
                        onChange={e => updateLlmExtract('variables', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
                        placeholder="release_name, affected_systems, urgency"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Test Match */}
              {isEditing && (
                <div style={styles.section}>
                  <h4 style={styles.sectionTitle}>Test Match</h4>
                  <div style={styles.field}>
                    <label style={styles.label}>Sample Event Payload (JSON)</label>
                    <textarea
                      style={styles.textarea}
                      value={testPayload}
                      onChange={e => setTestPayload(e.target.value)}
                      rows={4}
                    />
                  </div>
                  <button
                    style={styles.testBtn}
                    onClick={handleTestMatch}
                    disabled={testing}
                  >
                    {testing ? 'Testing...' : 'Test Match'}
                  </button>

                  {testResult && (
                    <div style={styles.testResult}>
                      <div style={{
                        ...styles.testResultHeader,
                        color: testResult.wouldFire ? '#2ecc71' : '#e74c3c',
                      }}>
                        {testResult.wouldFire ? 'WOULD FIRE' : 'WOULD NOT FIRE'}
                      </div>
                      {testResult.structuralMatch !== undefined && (
                        <div>Structural: {testResult.structuralMatch ? 'Match' : 'No match'}</div>
                      )}
                      {testResult.llmMatch && (
                        <div style={styles.llmResult}>
                          <div>LLM: {testResult.llmMatch.match ? 'Match' : 'No match'}</div>
                          <div>Confidence: {(testResult.llmMatch.confidence * 100).toFixed(0)}%</div>
                          <div>Reason: {testResult.llmMatch.reason}</div>
                          <div style={styles.llmMeta}>
                            Model: {testResult.llmMatch.model} |
                            Tokens: {testResult.llmMatch.tokensUsed} |
                            Latency: {testResult.llmMatch.durationMs}ms
                          </div>
                        </div>
                      )}
                      {Object.keys(testResult.extractedVariables).length > 0 && (
                        <div>
                          <div style={styles.label}>Extracted Variables:</div>
                          {Object.entries(testResult.extractedVariables).map(([k, v]) => (
                            <div key={k} style={styles.varRow}>
                              <code>{k}</code>: {v}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Fire History */}
              {isEditing && fireHistory.length > 0 && (
                <div style={styles.section}>
                  <h4 style={styles.sectionTitle}>Recent Fires</h4>
                  <div style={styles.historyList}>
                    {fireHistory.map((event, i) => {
                      const llmResult = event.llm_match_result
                        ? JSON.parse(event.llm_match_result) as LLMMatchResult
                        : null;
                      return (
                        <div key={event.id || i} style={styles.historyItem}>
                          <div style={styles.historyHeader}>
                            <span style={{
                              color: event.status === 'delivered' ? '#2ecc71' : event.status === 'failed' ? '#e74c3c' : '#f39c12',
                            }}>
                              {event.status}
                            </span>
                            <span>{new Date(event.fired_at).toLocaleString()}</span>
                            {event.duration_ms && <span>{event.duration_ms}ms</span>}
                          </div>
                          {event.error && (
                            <div style={{ color: '#e74c3c', fontSize: '12px' }}>{event.error}</div>
                          )}
                          {llmResult && (
                            <div style={styles.llmMeta}>
                              LLM: {llmResult.match ? 'match' : 'no match'} ({(llmResult.confidence * 100).toFixed(0)}%) - {llmResult.reason}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Save / Cancel */}
              <div style={styles.actions}>
                <button style={styles.cancelBtn} onClick={() => { setView('list'); setError(null); }}>
                  Cancel
                </button>
                <button
                  style={styles.saveBtn}
                  onClick={handleSave}
                  disabled={
                    loading
                    || !editingTrigger.name
                    || !editingTrigger.agentId
                    || (editingTrigger.type === 'cron'
                      && !!(editingTrigger as any).config?.runOnce
                      && !(editingTrigger as any).config?.runAt)
                    || (editingTrigger.type === 'bitbucket'
                      && (!(editingTrigger as any).config?.workspace
                        || !(editingTrigger as any).config?.repoSlug
                        || !((editingTrigger as any).config?.events?.length)))
                  }
                >
                  {loading ? 'Saving...' : (isEditing ? 'Update' : 'Create')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  panel: {
    background: '#1e1e2e',
    borderRadius: '12px',
    width: '680px',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    color: '#cdd6f4',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid #313244',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
  },
  headerActions: {
    display: 'flex',
    gap: '8px',
  },
  content: {
    overflow: 'auto',
    padding: '16px 20px',
    flex: 1,
  },
  empty: {
    textAlign: 'center',
    padding: '40px',
    color: '#6c7086',
  },
  error: {
    background: '#45252a',
    color: '#f38ba8',
    padding: '8px 20px',
    fontSize: '13px',
  },
  tabBar: {
    display: 'flex',
    gap: '4px',
    marginBottom: '12px',
    paddingBottom: '8px',
    borderBottom: '1px solid #313244',
    flexWrap: 'wrap',
  },
  tab: {
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: '6px',
    padding: '6px 10px',
    color: '#a6adc8',
    cursor: 'pointer',
    fontSize: '12px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'background 0.12s, color 0.12s, border-color 0.12s',
  },
  tabActive: {
    background: '#1e3a5f',
    borderColor: '#89b4fa',
    color: '#cdd6f4',
  },
  tabIcon: {
    fontSize: '13px',
    lineHeight: 1,
  },
  tabLabel: {
    fontWeight: 500,
  },
  tabBadge: {
    background: '#313244',
    color: '#a6adc8',
    borderRadius: '10px',
    padding: '1px 7px',
    fontSize: '10px',
    fontWeight: 600,
    minWidth: '16px',
    textAlign: 'center' as const,
    lineHeight: '14px',
  },
  tabBadgeActive: {
    background: '#89b4fa',
    color: '#1e1e2e',
  },
  triggerCard: {
    background: '#181825',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '8px',
    borderLeft: '3px solid',
    cursor: 'pointer',
    transition: 'background 0.15s',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontWeight: 500,
  },
  typeTag: {
    background: '#313244',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '11px',
    textTransform: 'uppercase' as const,
  },
  matchTag: {
    background: '#45475a',
    padding: '2px 6px',
    borderRadius: '4px',
    fontSize: '10px',
    color: '#a6e3a1',
  },
  cardActions: {
    display: 'flex',
    gap: '6px',
  },
  cardMeta: {
    display: 'flex',
    gap: '16px',
    marginTop: '8px',
    fontSize: '12px',
    color: '#6c7086',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1,
  },
  row: {
    display: 'flex',
    gap: '12px',
  },
  label: {
    fontSize: '12px',
    color: '#a6adc8',
    fontWeight: 500,
  },
  input: {
    background: '#313244',
    border: '1px solid #45475a',
    borderRadius: '6px',
    padding: '8px 10px',
    color: '#cdd6f4',
    fontSize: '13px',
    outline: 'none',
  },
  select: {
    background: '#313244',
    border: '1px solid #45475a',
    borderRadius: '6px',
    padding: '8px 10px',
    color: '#cdd6f4',
    fontSize: '13px',
    outline: 'none',
  },
  textarea: {
    background: '#313244',
    border: '1px solid #45475a',
    borderRadius: '6px',
    padding: '8px 10px',
    color: '#cdd6f4',
    fontSize: '13px',
    outline: 'none',
    fontFamily: 'monospace',
    resize: 'vertical' as const,
  },
  section: {
    borderTop: '1px solid #313244',
    paddingTop: '12px',
  },
  sectionTitle: {
    margin: '0 0 8px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#a6adc8',
  },
  modeSelector: {
    display: 'flex',
    gap: '8px',
    marginBottom: '8px',
  },
  modeBtn: {
    flex: 1,
    background: '#313244',
    border: '1px solid #45475a',
    borderRadius: '6px',
    padding: '8px',
    color: '#cdd6f4',
    cursor: 'pointer',
    textAlign: 'left' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
    fontSize: '12px',
  },
  modeBtnActive: {
    borderColor: '#89b4fa',
    background: '#1e3a5f',
  },
  modeDesc: {
    fontSize: '10px',
    color: '#6c7086',
  },
  llmConfig: {
    background: '#181825',
    borderRadius: '6px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  webhookUrl: {
    marginTop: '8px',
  },
  inlineRow: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  checkboxGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '6px 12px',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#cdd6f4',
    cursor: 'pointer',
  },
  checkboxCode: {
    fontSize: '10px',
    color: '#6c7086',
    background: 'transparent',
    padding: 0,
  },
  code: {
    background: '#313244',
    padding: '6px 10px',
    borderRadius: '4px',
    fontSize: '12px',
    display: 'block',
    wordBreak: 'break-all' as const,
    color: '#89b4fa',
  },
  nextFires: {
    marginTop: '8px',
  },
  nextFireItem: {
    fontSize: '12px',
    color: '#a6e3a1',
    padding: '2px 0',
  },
  testBtn: {
    background: '#89b4fa',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 16px',
    color: '#1e1e2e',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: '13px',
  },
  testResult: {
    background: '#181825',
    borderRadius: '6px',
    padding: '12px',
    marginTop: '8px',
    fontSize: '13px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  testResultHeader: {
    fontWeight: 700,
    fontSize: '14px',
  },
  llmResult: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
  },
  llmMeta: {
    fontSize: '11px',
    color: '#6c7086',
    marginTop: '2px',
  },
  varRow: {
    fontSize: '12px',
    padding: '2px 0',
  },
  historyList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    maxHeight: '200px',
    overflow: 'auto',
  },
  historyItem: {
    background: '#181825',
    borderRadius: '4px',
    padding: '8px 10px',
    fontSize: '12px',
  },
  historyHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  actions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '16px',
    paddingTop: '12px',
    borderTop: '1px solid #313244',
  },
  addBtn: {
    background: '#89b4fa',
    border: 'none',
    borderRadius: '6px',
    padding: '6px 14px',
    color: '#1e1e2e',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: '13px',
  },
  backBtn: {
    background: 'transparent',
    border: '1px solid #45475a',
    borderRadius: '6px',
    padding: '6px 14px',
    color: '#cdd6f4',
    cursor: 'pointer',
    fontSize: '13px',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#6c7086',
    cursor: 'pointer',
    fontSize: '16px',
    padding: '4px 8px',
  },
  smallBtn: {
    background: 'transparent',
    border: '1px solid #45475a',
    borderRadius: '4px',
    padding: '3px 8px',
    color: '#cdd6f4',
    cursor: 'pointer',
    fontSize: '11px',
  },
  saveBtn: {
    background: '#a6e3a1',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 20px',
    color: '#1e1e2e',
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: '13px',
  },
  cancelBtn: {
    background: 'transparent',
    border: '1px solid #45475a',
    borderRadius: '6px',
    padding: '8px 20px',
    color: '#cdd6f4',
    cursor: 'pointer',
    fontSize: '13px',
  },
};

export default TriggerManagerPanel;
