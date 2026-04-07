/**
 * MonitoringModal
 * Tab-based monitoring interface for viewing trigger history, workflow traces,
 * message logs, and system statistics.
 * Reuses EventLogViewer filtering/display logic and StatsDashboard for stats.
 */

import React, { useState, useEffect, useCallback, useSyncExternalStore, useMemo } from 'react';
import { store } from '../store';
import { apiUrl, authFetch } from '../utils/storage';
import type { TimelineEntry, EventStats } from '../../shared/event-types';
import type { WorkflowDefinition } from '../../shared/workflow-types';
import type { WorkflowInstanceRow, WorkflowStoreState } from '../store/workflows';
import type { StoreState } from '../store/types';

interface MonitoringModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = 'triggers' | 'workflows' | 'instances' | 'messages' | 'stats';
type TimeRange = '1h' | '6h' | '24h' | '7d' | 'all';

interface IntegrationStatusInfo {
  id: string;
  name: string;
  status: { connected: boolean; lastChecked: number; error?: string };
}

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'triggers', label: 'Triggers', icon: '\u26A1' },
  { id: 'workflows', label: 'Workflows', icon: '\u2699\uFE0F' },
  { id: 'instances', label: 'Instances', icon: '\uD83D\uDD04' },
  { id: 'messages', label: 'Messages', icon: '\uD83D\uDCAC' },
  { id: 'stats', label: 'Stats', icon: '\uD83D\uDCCA' },
];

const CATEGORY_COLORS: Record<string, string> = {
  trigger: '#89b4fa',
  slack: '#cba6f7',
  email: '#f9e2af',
  calendar: '#a6e3a1',
  document: '#fab387',
  jira: '#89dceb',
  workflow: '#f38ba8',
  system: '#6c7086',
  step: '#f38ba8',
  variable_change: '#cba6f7',
  approval: '#a6e3a1',
  audit: '#6c7086',
};

const CATEGORY_LABELS: Record<string, string> = {
  trigger: 'Trigger',
  slack: 'Slack',
  email: 'Email',
  calendar: 'Calendar',
  document: 'Document',
  jira: 'Jira',
  workflow: 'Workflow',
  system: 'System',
  step: 'Step',
  variable_change: 'Variable',
  approval: 'Approval',
  audit: 'Audit',
};

export function MonitoringModal({ isOpen, onClose }: MonitoringModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('triggers');
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [matcherResults, setMatcherResults] = useState<Record<string, unknown[] | null>>({});
  const [loadingMatchers, setLoadingMatchers] = useState(false);

  // Stats tab state
  const [stats, setStats] = useState<EventStats | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatusInfo[]>([]);

  const fetchEvents = useCallback(async () => {
    if (activeTab === 'stats' || activeTab === 'instances') return;
    setLoading(true);
    try {
      const now = Date.now();
      const rangeMs: Record<TimeRange, number> = {
        '1h': 3600000,
        '6h': 21600000,
        '24h': 86400000,
        '7d': 604800000,
        'all': 0,
      };
      const since = rangeMs[timeRange] > 0 ? String(now - rangeMs[timeRange]) : undefined;

      let allEntries: TimelineEntry[] = [];

      if (activeTab === 'triggers') {
        const params = new URLSearchParams({ limit: '200' });
        if (since) params.set('since', since);
        const resp = await authFetch(apiUrl(`/api/events/triggers?${params}`));
        if (!resp.ok) { setError(`HTTP ${resp.status}`); return; }
        const data = await resp.json();
        allEntries = (data.events || []).map((e: Record<string, unknown>) => ({
          type: 'trigger' as const,
          timestamp: e.firedAt as number,
          data: e,
        }));
      } else if (activeTab === 'workflows') {
        const params = new URLSearchParams({ limit: '200', category: 'workflow' });
        if (since) params.set('since', since);
        const resp = await authFetch(apiUrl(`/api/events/audit?${params}`));
        if (!resp.ok) { setError(`HTTP ${resp.status}`); return; }
        const data = await resp.json();
        allEntries = (data.entries || []).map((e: Record<string, unknown>) => ({
          type: 'workflow' as const,
          timestamp: e.createdAt as number,
          data: e,
        }));
      } else if (activeTab === 'messages') {
        const slackParams = new URLSearchParams({ limit: '200' });
        const emailParams = new URLSearchParams({ limit: '200' });
        const approvalParams = new URLSearchParams({ limit: '200' });
        if (since) {
          slackParams.set('since', since);
          emailParams.set('since', since);
        }

        const [slackResp, emailResp, approvalResp] = await Promise.all([
          authFetch(apiUrl(`/api/events/slack?${slackParams}`)),
          authFetch(apiUrl(`/api/events/email?${emailParams}`)),
          authFetch(apiUrl(`/api/events/approvals?${approvalParams}`)),
        ]);

        if (slackResp.ok) {
          const data = await slackResp.json();
          for (const m of data.messages || []) {
            allEntries.push({ type: 'slack', timestamp: m.receivedAt, data: m });
          }
        }
        if (emailResp.ok) {
          const data = await emailResp.json();
          for (const m of data.messages || []) {
            allEntries.push({ type: 'email', timestamp: m.receivedAt, data: m });
          }
        }
        if (approvalResp.ok) {
          const data = await approvalResp.json();
          for (const a of data.events || []) {
            allEntries.push({ type: 'approval', timestamp: a.recordedAt, data: a });
          }
        }

        allEntries.sort((a, b) => b.timestamp - a.timestamp);
      }

      setEntries(allEntries);
      setError(null);
    } catch (err) {
      setError(`Failed to load events: ${err}`);
    } finally {
      setLoading(false);
    }
  }, [activeTab, timeRange]);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const [statsResp, intResp] = await Promise.all([
        authFetch(apiUrl('/api/events/stats')),
        authFetch(apiUrl('/api/integrations')),
      ]);

      if (statsResp.ok) setStats(await statsResp.json());
      if (intResp.ok) {
        const data = await intResp.json();
        setIntegrations(Array.isArray(data) ? data : []);
      }
      setError(null);
    } catch (err) {
      setError(`Failed to load stats: ${err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (activeTab === 'stats') {
      fetchStats();
    } else {
      fetchEvents();
    }
  }, [isOpen, activeTab, fetchEvents, fetchStats]);

  // Filter by search text
  const filtered = entries.filter((entry) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const json = JSON.stringify(entry.data).toLowerCase();
    return json.includes(s);
  });

  if (!isOpen) return null;

  const connectedCount = integrations.filter((i) => i.status.connected).length;

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={S.header}>
          <div style={S.headerTitle}>
            <span>{'\uD83D\uDCCA'}</span>
            <span>Monitoring & Logs</span>
          </div>
          <button style={S.closeBtn} onClick={onClose} title="Close">&times;</button>
        </div>

        {/* Tabs */}
        <div style={S.tabs}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              style={S.tab(activeTab === tab.id)}
              onClick={() => {
                setActiveTab(tab.id);
                setSearch('');
                setExpandedId(null);
              }}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Filters (for event tabs only) */}
        {activeTab !== 'stats' && activeTab !== 'instances' && (
          <div style={S.filters}>
            <div style={{ display: 'flex', gap: 4 }}>
              {(['1h', '6h', '24h', '7d', 'all'] as TimeRange[]).map((range) => (
                <button
                  key={range}
                  style={{
                    ...S.timeBtn,
                    background: timeRange === range ? '#89b4fa' : 'transparent',
                    color: timeRange === range ? '#1e1e2e' : '#a6adc8',
                  }}
                  onClick={() => setTimeRange(range)}
                >
                  {range}
                </button>
              ))}
            </div>

            <input
              style={S.searchInput}
              placeholder="Search events..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            <button style={S.refreshBtn} onClick={fetchEvents}>
              Refresh
            </button>
          </div>
        )}

        {/* Content */}
        <div style={S.content}>
          {activeTab === 'stats' ? (
            <StatsTabContent
              loading={loading}
              error={error}
              stats={stats}
              integrations={integrations}
              connectedCount={connectedCount}
              onRefresh={fetchStats}
            />
          ) : activeTab === 'instances' ? (
            <InstanceMonitorTab />
          ) : (
            <EventListContent
              loading={loading}
              error={error}
              entries={filtered}
              expandedId={expandedId}
              matcherResults={matcherResults}
              loadingMatchers={loadingMatchers}
              onToggleExpand={async (id, entry) => {
                if (expandedId === id) {
                  setExpandedId(null);
                  return;
                }
                setExpandedId(id);
                // Fetch matchers
                if (!matcherResults[id]) {
                  setLoadingMatchers(true);
                  try {
                    let url = '';
                    if (entry?.type === 'trigger' && entry?.data?.id) {
                      // Matchers for a fired trigger event
                      url = `/api/triggers/events/${entry.data.id}/matchers`;
                    } else if (entry && ['slack', 'email', 'approval'].includes(entry.type)) {
                      // Matchers for a message - evaluate ALL triggers against this source
                      const data = entry.data as unknown as Record<string, unknown>;
                      // Use message-specific IDs (ts for Slack, messageId for Email) not the database row ID
                      const sourceId = (data.ts || data.messageId || data.email_id) as string;
                      if (sourceId && entry.type) {
                        url = `/api/triggers/matchers/by-source/${entry.type}/${encodeURIComponent(sourceId)}`;
                      }
                    }

                    if (url) {
                      const resp = await authFetch(apiUrl(url));
                      if (resp.ok) {
                        const data = await resp.json();
                        setMatcherResults(prev => ({ ...prev, [id]: data.matchers || [] }));
                      }
                    }
                  } catch (err) {
                    console.error('Failed to fetch matchers:', err);
                  } finally {
                    setLoadingMatchers(false);
                  }
                }
              }}
            />
          )}
        </div>

        {/* Footer */}
        {activeTab !== 'stats' && activeTab !== 'instances' && (
          <div style={S.footer}>
            <span style={{ color: '#6c7086', fontSize: 11 }}>
              {filtered.length} event{filtered.length !== 1 ? 's' : ''} shown
              {search && ` (filtered from ${entries.length})`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Event List ───

function EventListContent({
  loading,
  error,
  entries,
  expandedId,
  matcherResults,
  loadingMatchers,
  onToggleExpand,
}: {
  loading: boolean;
  error: string | null;
  entries: TimelineEntry[];
  expandedId: string | null;
  matcherResults: Record<string, unknown[] | null>;
  loadingMatchers: boolean;
  onToggleExpand: (id: string, entry?: TimelineEntry) => void;
}) {
  if (loading) return <div style={{ color: '#a6adc8', padding: 20 }}>Loading events...</div>;
  if (error) return <div style={{ color: '#f38ba8', padding: 20 }}>{error}</div>;
  if (entries.length === 0) {
    return (
      <div style={{ color: '#6c7086', textAlign: 'center', padding: 40 }}>
        No events found for the selected filters.
      </div>
    );
  }

  return (
    <>
      {entries.map((entry, i) => {
        const key = `${entry.type}-${entry.timestamp}-${i}`;
        const isExpanded = expandedId === key;
        const color = CATEGORY_COLORS[entry.type] || '#6c7086';
        const summary = getEntrySummary(entry);
        const time = new Date(entry.timestamp);

        return (
          <div
            key={key}
            style={{
              ...S.eventRow,
              borderLeft: `3px solid ${color}`,
              background: isExpanded ? 'rgba(137,180,250,0.05)' : 'transparent',
            }}
            onClick={() => onToggleExpand(key, entry)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...S.tag, background: `${color}22`, color }}>
                {CATEGORY_LABELS[entry.type] || entry.type}
              </span>
              <span style={{ color: '#cdd6f4', fontSize: 12, flex: 1 }}>{summary}</span>
              <span style={{ color: '#6c7086', fontSize: 10, whiteSpace: 'nowrap' }}>
                {time.toLocaleTimeString()} {time.toLocaleDateString()}
              </span>
            </div>

            {isExpanded && (
              <>
                <pre style={S.detail}>
                  {JSON.stringify(entry.data, null, 2)}
                </pre>
                {matcherResults[key] && (
                  <div style={{ marginTop: 12, borderTop: '1px solid #313244', paddingTop: 12 }}>
                    <div style={{ color: '#a6adc8', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                      {entry.type === 'trigger' ? 'Matcher Results' : 'Trigger Evaluations'}
                    </div>
                    {loadingMatchers ? (
                      <div style={{ color: '#6c7086', fontSize: 12 }}>Loading matchers...</div>
                    ) : (matcherResults[key] as unknown[])?.length === 0 ? (
                      <div style={{ color: '#6c7086', fontSize: 12 }}>No matchers evaluated</div>
                    ) : (
                      (() => {
                        const matchers = matcherResults[key] as Record<string, unknown>[];
                        // Group by trigger_id for message views
                        if (entry.type !== 'trigger') {
                          const byTrigger = new Map<string, Record<string, unknown>[]>();
                          for (const m of matchers) {
                            const tId = String(m.trigger_id || 'unknown');
                            if (!byTrigger.has(tId)) byTrigger.set(tId, []);
                            byTrigger.get(tId)!.push(m);
                          }
                          return Array.from(byTrigger.entries()).map(([tId, ms]) => (
                            <div key={tId} style={{ marginBottom: 12 }}>
                              <div style={{ color: '#cdd6f4', fontSize: 11, fontWeight: 500, marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid #45475a' }}>
                                Trigger: {String(ms[0]?.trigger_name || tId)}
                              </div>
                              {ms.map((m, idx) => {
                                const matched = m.matched === 1 || m.matched === true;
                                const matchColor = matched ? '#a6e3a1' : '#f38ba8';
                                const confidence = (m.confidence as number | null) ?? null;
                                const matcherName = String(m.matcher_name || 'unknown');
                                const reason = m.reason ? String(m.reason) : '';
                                return (
                                  <div key={idx} style={{ display: 'flex', gap: 8, padding: '6px 10px', background: '#313244', borderRadius: 4, marginBottom: 4, fontSize: 11 }}>
                                    <span style={{ color: matchColor, fontWeight: 600, minWidth: 50 }}>{matched ? '✓' : '✗'}</span>
                                    <span style={{ color: '#cdd6f4', flex: 1 }}>{matcherName}</span>
                                    {confidence !== null && <span style={{ color: '#a6adc8' }}>({(confidence * 100).toFixed(0)}%)</span>}
                                    {reason && <span style={{ color: '#6c7086', fontSize: 10 }}>{reason}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          ));
                        } else {
                          // Flat list for trigger events
                          return matchers.map((m, idx) => {
                            const matched = m.matched === 1 || m.matched === true;
                            const matchColor = matched ? '#a6e3a1' : '#f38ba8';
                            const confidence = (m.confidence as number | null) ?? null;
                            const matcherName = String(m.matcher_name || 'unknown');
                            const reason = m.reason ? String(m.reason) : '';
                            return (
                              <div key={idx} style={{ display: 'flex', gap: 8, padding: '6px 10px', background: '#313244', borderRadius: 4, marginBottom: 4, fontSize: 11 }}>
                                <span style={{ color: matchColor, fontWeight: 600, minWidth: 50 }}>{matched ? '✓ MATCH' : '✗ FAIL'}</span>
                                <span style={{ color: '#cdd6f4', flex: 1 }}>{matcherName}</span>
                                {confidence !== null && <span style={{ color: '#a6adc8' }}>({(confidence * 100).toFixed(0)}%)</span>}
                                {reason && <span style={{ color: '#6c7086', fontSize: 10 }}>{reason}</span>}
                              </div>
                            );
                          });
                        }
                      })()
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

// ─── Stats Tab ───

function StatsTabContent({
  loading,
  error,
  stats,
  integrations,
  connectedCount,
  onRefresh,
}: {
  loading: boolean;
  error: string | null;
  stats: EventStats | null;
  integrations: IntegrationStatusInfo[];
  connectedCount: number;
  onRefresh: () => void;
}) {
  if (loading) return <div style={{ color: '#a6adc8', padding: 20 }}>Loading stats...</div>;
  if (error) return <div style={{ color: '#f38ba8', padding: 20 }}>{error}</div>;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button style={S.refreshBtn} onClick={onRefresh}>Refresh</button>
      </div>

      {stats && (
        <>
          <div style={S.section}>
            <h3 style={S.sectionTitle}>Workflows</h3>
            <div style={S.grid}>
              <StatCard label="Active" value={stats.activeWorkflows} color="#89b4fa" />
              <StatCard label="Completed" value={stats.completedWorkflows} color="#a6e3a1" />
              <StatCard label="Failed" value={stats.failedWorkflows} color="#f38ba8" />
            </div>
          </div>

          <div style={S.section}>
            <h3 style={S.sectionTitle}>Events (Today)</h3>
            <div style={S.grid}>
              <StatCard label="Triggers Fired" value={stats.triggersFiredToday} color="#f9e2af" />
              <StatCard label="Slack Messages" value={stats.slackMessageCount} color="#cba6f7" />
              <StatCard label="Emails" value={stats.emailCount} color="#fab387" />
            </div>
          </div>

          <div style={S.section}>
            <h3 style={S.sectionTitle}>
              Integrations ({connectedCount}/{integrations.length} connected)
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {integrations.map((integration) => (
                <div key={integration.id} style={S.integrationRow}>
                  <span style={{ color: '#cdd6f4', fontSize: 13 }}>{integration.name}</span>
                  <span
                    style={{
                      ...S.statusBadge,
                      background: integration.status.connected
                        ? 'rgba(166,227,161,0.15)'
                        : 'rgba(108,112,134,0.15)',
                      color: integration.status.connected ? '#a6e3a1' : '#6c7086',
                    }}
                  >
                    {integration.status.error
                      ? 'Error'
                      : integration.status.connected
                        ? 'Connected'
                        : 'Disconnected'}
                  </span>
                </div>
              ))}
              {integrations.length === 0 && (
                <div style={{ color: '#6c7086', fontSize: 12 }}>No integrations configured</div>
              )}
            </div>
          </div>
        </>
      )}

      {!stats && (
        <div style={{ color: '#6c7086', textAlign: 'center', padding: 40 }}>
          No stats available. The event store may not have any data yet.
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={S.card}>
      <div style={{ color, fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      <div style={{ color: '#a6adc8', fontSize: 11, marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ─── Helpers ───

function getEntrySummary(entry: TimelineEntry): string {
  const d = entry.data as unknown as Record<string, unknown>;
  switch (entry.type) {
    case 'trigger':
      return `Trigger "${d.triggerName || d.triggerId}" ${d.status || 'fired'}`;
    case 'slack':
      return `${d.direction === 'outbound' ? 'Sent' : 'Received'} in #${d.channelName || d.channelId}: ${truncate(d.text as string, 60)}`;
    case 'email':
      return `${d.direction === 'outbound' ? 'Sent to' : 'From'} ${d.direction === 'outbound' ? d.toAddresses : d.fromAddress}: ${truncate(d.subject as string, 50)}`;
    case 'approval':
      return `${d.approved ? 'Approved' : 'Rejected'} by ${d.approverEmail}`;
    case 'document':
      return `Generated "${d.outputFilename}" from template "${d.templateName}"`;
    case 'calendar':
      return `Calendar event ${d.action}: "${d.summary}"`;
    case 'jira':
      return `${d.ticketKey} ${d.action}: ${truncate(d.summary as string, 50)}`;
    case 'step':
      return `Workflow step: ${d.toStateName} (${d.status})`;
    case 'variable_change':
      return `Variable "${d.variableName}" changed by ${d.changedBy}`;
    case 'audit':
      return `[${(d.level as string || 'info').toUpperCase()}] ${d.category}: ${d.action}`;
    default:
      return JSON.stringify(d).slice(0, 80);
  }
}

function truncate(str: string | undefined, max: number): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

// ─── Instance Monitor Tab ───

const INSTANCE_STATUS_COLORS: Record<string, string> = {
  running: '#a6e3a1',
  paused: '#f9e2af',
  completed: '#89b4fa',
  failed: '#f38ba8',
  cancelled: '#6c7086',
};

const STATE_TYPE_COLORS: Record<string, string> = {
  action: '#89b4fa',
  wait: '#f9e2af',
  decision: '#cba6f7',
  end: '#6c7086',
};

type InstanceStatusFilter = 'all' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

// Memoized snapshot to prevent infinite re-renders.
// useSyncExternalStore compares by reference (Object.is), so getSnapshot
// must return the same object when the underlying data hasn't changed.
let _cachedWorkflowSnap: { definitions: Map<string, WorkflowDefinition>; instances: Map<string, WorkflowInstanceRow> } | null = null;
let _prevDefs: Map<string, WorkflowDefinition> | undefined;
let _prevInsts: Map<string, WorkflowInstanceRow> | undefined;

function getWorkflowSnapshot() {
  const state = store.getState() as StoreState & WorkflowStoreState;
  const defs = state.workflowDefinitions ?? new Map<string, WorkflowDefinition>();
  const insts = state.workflowInstances ?? new Map<string, WorkflowInstanceRow>();
  if (_cachedWorkflowSnap && _prevDefs === defs && _prevInsts === insts) {
    return _cachedWorkflowSnap;
  }
  _prevDefs = defs;
  _prevInsts = insts;
  _cachedWorkflowSnap = { definitions: defs, instances: insts };
  return _cachedWorkflowSnap;
}

function useWorkflowStore() {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    getWorkflowSnapshot,
    getWorkflowSnapshot
  );
}

function InstanceMonitorTab() {
  const { definitions, instances } = useWorkflowStore();
  const [statusFilter, setStatusFilter] = useState<InstanceStatusFilter>('all');
  const [defFilter, setDefFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedStepIdx, setExpandedStepIdx] = useState<number | null>(null);
  const [debugId, setDebugId] = useState<string | null>(null);

  const allInstances = useMemo(() => Array.from(instances.values()), [instances]);
  const allDefs = useMemo(() => Array.from(definitions.values()), [definitions]);

  const filtered = useMemo(() => {
    return allInstances
      .filter((inst) => {
        if (statusFilter !== 'all' && inst.status !== statusFilter) return false;
        if (defFilter !== 'all' && inst.workflowDefId !== defFilter) return false;
        if (search) {
          const s = search.toLowerCase();
          return inst.workflowName.toLowerCase().includes(s) ||
            inst.id.toLowerCase().includes(s) ||
            JSON.stringify(inst.variables).toLowerCase().includes(s);
        }
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [allInstances, statusFilter, defFilter, search]);

  const expandedInstance = expandedId ? instances.get(expandedId) : null;
  const debugInstance = debugId ? instances.get(debugId) : null;

  // Debug view
  if (debugInstance) {
    const def = definitions.get(debugInstance.workflowDefId);
    const currentState = def?.states.find(s => s.id === debugInstance.currentStateId);
    const statusColor = INSTANCE_STATUS_COLORS[debugInstance.status] || '#6c7086';

    // Split variables
    const wiVars: Record<string, unknown> = {};
    const userVars: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(debugInstance.variables)) {
      if (key.startsWith('wi_')) wiVars[key] = val;
      else userVars[key] = val;
    }

    return (
      <div style={{ padding: '12px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <button style={{ ...S.refreshBtn, fontSize: 12 }} onClick={() => setDebugId(null)}>Back</button>
          <span style={{ color: '#cdd6f4', fontSize: 13, fontWeight: 500 }}>Debug: {debugInstance.workflowName}</span>
          <span style={{ ...S.tag, background: `${statusColor}22`, color: statusColor }}>{debugInstance.status}</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginBottom: 16 }}>
          <DebugCell label="ID" value={debugInstance.id} />
          <DebugCell label="Def ID" value={debugInstance.workflowDefId} />
          <DebugCell label="Current State" value={currentState?.name || debugInstance.currentStateId} />
          <DebugCell label="State Type" value={currentState?.type || 'unknown'} />
          <DebugCell label="Created" value={fmtFull(debugInstance.createdAt)} />
          <DebugCell label="Updated" value={fmtFull(debugInstance.updatedAt)} />
          {debugInstance.completedAt && <DebugCell label="Completed" value={fmtFull(debugInstance.completedAt)} />}
          {debugInstance.error && <DebugCell label="Error" value={debugInstance.error} color="#f38ba8" />}
          <DebugCell label="Steps" value={String(debugInstance.history?.length ?? 0)} />
        </div>

        {Object.keys(userVars).length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#a6adc8', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 6 }}>User Variables</div>
            <pre style={S.detail}>{JSON.stringify(userVars, null, 2)}</pre>
          </div>
        )}

        {Object.keys(wiVars).length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#a6adc8', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 6 }}>Internal Variables (wi_*)</div>
            <pre style={S.detail}>{JSON.stringify(wiVars, null, 2)}</pre>
          </div>
        )}

        {currentState && currentState.transitions.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ color: '#a6adc8', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 6 }}>Available Transitions</div>
            {currentState.transitions.map(t => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 10px', background: '#313244', borderRadius: 4, marginBottom: 4 }}>
                <span style={{ color: '#cdd6f4', fontSize: 12 }}>{t.name}</span>
                <span style={{ color: '#6c7086', fontSize: 10 }}>{t.condition.type} &rarr; {def?.states.find(s => s.id === t.targetStateId)?.name || t.targetStateId}</span>
              </div>
            ))}
          </div>
        )}

        <div>
          <div style={{ color: '#a6adc8', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 6 }}>Raw JSON</div>
          <pre style={{ ...S.detail, maxHeight: 400 }}>{JSON.stringify(debugInstance, null, 2)}</pre>
        </div>
      </div>
    );
  }

  // Timeline view for expanded instance
  if (expandedInstance) {
    const def = definitions.get(expandedInstance.workflowDefId);
    const statusColor = INSTANCE_STATUS_COLORS[expandedInstance.status] || '#6c7086';

    return (
      <div style={{ padding: '12px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <button style={{ ...S.refreshBtn, fontSize: 12 }} onClick={() => { setExpandedId(null); setExpandedStepIdx(null); }}>Back</button>
          <span style={{ color: '#cdd6f4', fontSize: 13, fontWeight: 500 }}>{expandedInstance.workflowName}</span>
          <span style={{ color: '#6c7086', fontSize: 10, fontFamily: 'monospace' }}>({expandedInstance.id.slice(0, 8)})</span>
          <span style={{ ...S.tag, background: `${statusColor}22`, color: statusColor }}>{expandedInstance.status}</span>
          <div style={{ flex: 1 }} />
          <button style={{ ...S.refreshBtn, fontFamily: 'monospace', fontSize: 10 }} onClick={() => setDebugId(expandedInstance.id)}>{'{..}'}</button>
        </div>

        <div style={{ display: 'flex', gap: 16, color: '#6c7086', fontSize: 11, marginBottom: 12 }}>
          <span>Created: {fmtFull(expandedInstance.createdAt)}</span>
          <span>Updated: {fmtFull(expandedInstance.updatedAt)}</span>
          {expandedInstance.error && <span style={{ color: '#f38ba8' }}>Error: {expandedInstance.error}</span>}
        </div>

        <div style={{ color: '#a6adc8', fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 8 }}>
          Timeline ({expandedInstance.history.length} step{expandedInstance.history.length !== 1 ? 's' : ''})
        </div>

        {expandedInstance.history.length === 0 && (
          <div style={{ color: '#6c7086', fontSize: 12, padding: 16 }}>No steps recorded yet.</div>
        )}

        {expandedInstance.history.map((entry, idx) => {
          const state = def?.states.find(s => s.id === entry.toStateId);
          const isExpanded = expandedStepIdx === idx;
          const stateColor = state ? STATE_TYPE_COLORS[state.type] || '#6c7086' : '#6c7086';

          return (
            <div
              key={idx}
              style={{
                padding: '10px 12px',
                borderLeft: `3px solid ${stateColor}`,
                borderBottom: '1px solid #313244',
                cursor: 'pointer',
                background: isExpanded ? 'rgba(137,180,250,0.05)' : 'transparent',
                marginLeft: 8,
              }}
              onClick={() => setExpandedStepIdx(isExpanded ? null : idx)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: stateColor, flexShrink: 0 }} />
                <span style={{ color: '#cdd6f4', fontSize: 12, fontWeight: 500 }}>{state?.name || entry.toStateId}</span>
                {state && <span style={{ ...S.tag, background: `${stateColor}22`, color: stateColor }}>{state.type}</span>}
                {entry.transitionName && <span style={{ color: '#6c7086', fontSize: 10 }}>via "{entry.transitionName}"</span>}
                <div style={{ flex: 1 }} />
                <span style={{ color: '#6c7086', fontSize: 10, whiteSpace: 'nowrap' }}>{fmtFull(entry.timestamp)}</span>
              </div>

              {isExpanded && (
                <div style={{ marginTop: 8, paddingLeft: 20 }}>
                  {entry.fromStateId && (
                    <div style={{ color: '#6c7086', fontSize: 11, marginBottom: 2 }}>
                      <span style={{ fontWeight: 600, fontSize: 10, textTransform: 'uppercase' as const }}>From: </span>
                      <span style={{ fontFamily: 'monospace' }}>{entry.fromStateId}</span>
                    </div>
                  )}
                  {entry.details && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ color: '#6c7086', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, marginBottom: 4 }}>Agent Reasoning / Summary</div>
                      <div style={{ padding: 10, background: '#181825', borderRadius: 6, border: '1px solid #313244', fontSize: 12, color: '#cdd6f4', lineHeight: 1.5, whiteSpace: 'pre-wrap' as const }}>{entry.details}</div>
                    </div>
                  )}
                  {state?.description && (
                    <div style={{ marginTop: 6, color: '#a6adc8', fontSize: 11 }}>
                      <span style={{ color: '#6c7086', fontWeight: 600, fontSize: 10, textTransform: 'uppercase' as const }}>Description: </span>{state.description}
                    </div>
                  )}
                  {entry.variables && Object.keys(entry.variables).length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ color: '#6c7086', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, marginBottom: 4 }}>Variables at this step</div>
                      <pre style={S.detail}>{JSON.stringify(entry.variables, null, 2)}</pre>
                    </div>
                  )}
                  {state?.action && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ color: '#6c7086', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, marginBottom: 4 }}>Action ({state.action.type})</div>
                      <pre style={S.detail}>{JSON.stringify(state.action, null, 2)}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // Instance list view
  return (
    <div style={{ padding: '12px 0' }}>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' as const }}>
        <select
          style={{ background: '#313244', border: '1px solid #45475a', borderRadius: 6, padding: '5px 10px', color: '#cdd6f4', fontSize: 12, outline: 'none' }}
          value={defFilter}
          onChange={(e) => setDefFilter(e.target.value)}
        >
          <option value="all">All Workflows</option>
          {allDefs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>

        <div style={{ display: 'flex', gap: 4 }}>
          {(['all', 'running', 'paused', 'completed', 'failed', 'cancelled'] as InstanceStatusFilter[]).map((sf) => (
            <button
              key={sf}
              style={{
                ...S.timeBtn,
                background: statusFilter === sf ? (sf === 'all' ? '#89b4fa' : INSTANCE_STATUS_COLORS[sf] || '#89b4fa') : 'transparent',
                color: statusFilter === sf ? '#1e1e2e' : '#a6adc8',
                borderColor: statusFilter === sf ? 'transparent' : '#45475a',
                textTransform: 'capitalize' as const,
              }}
              onClick={() => setStatusFilter(sf)}
            >{sf}</button>
          ))}
        </div>

        <input
          style={S.searchInput}
          placeholder="Search instances..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <span style={{ color: '#6c7086', fontSize: 11 }}>
          {filtered.length}/{allInstances.length}
        </span>
      </div>

      {/* Instance List */}
      {filtered.length === 0 ? (
        <div style={{ color: '#6c7086', textAlign: 'center', padding: 40 }}>
          No workflow instances found.
        </div>
      ) : (
        filtered.map((inst) => {
          const def = definitions.get(inst.workflowDefId);
          const statusColor = INSTANCE_STATUS_COLORS[inst.status] || '#6c7086';
          const currentState = def?.states.find(s => s.id === inst.currentStateId);
          const stateTypeColor = currentState ? STATE_TYPE_COLORS[currentState.type] || '#6c7086' : '#6c7086';

          return (
            <div
              key={inst.id}
              style={{ ...S.eventRow, display: 'flex', alignItems: 'center', gap: 12, borderLeft: `3px solid ${statusColor}` }}
              onClick={() => setExpandedId(inst.id)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#cdd6f4', fontSize: 13, fontWeight: 500 }}>{inst.workflowName}</span>
                  <span style={{ ...S.tag, background: `${statusColor}22`, color: statusColor }}>{inst.status}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <span style={{ color: '#6c7086', fontSize: 10, fontFamily: 'monospace' }}>{inst.id.slice(0, 8)}</span>
                  {currentState && <span style={{ color: stateTypeColor, fontSize: 10 }}>@ {currentState.name}</span>}
                  <span style={{ color: '#45475a', fontSize: 10 }}>{(inst.history?.length ?? 0)} step{(inst.history?.length ?? 0) !== 1 ? 's' : ''}</span>
                </div>
              </div>
              <span style={{ color: '#6c7086', fontSize: 10, whiteSpace: 'nowrap' }}>{fmtTime(inst.updatedAt)}</span>
              <button
                style={{ background: 'transparent', border: '1px solid #45475a', borderRadius: 4, padding: '3px 6px', color: '#6c7086', fontSize: 10, fontFamily: 'monospace', cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); setDebugId(inst.id); }}
                title="Debug view"
              >{'{..}'}</button>
            </div>
          );
        })
      )}
    </div>
  );
}

function DebugCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 2, padding: '8px 10px', background: '#313244', borderRadius: 6 }}>
      <span style={{ color: '#6c7086', fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>{label}</span>
      <span style={{ color: color || '#cdd6f4', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' as const }}>{value}</span>
    </div>
  );
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtFull(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

// ─── Styles ───

const S = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: 'var(--surface-0, #1e1e2e)',
    borderRadius: 12,
    border: '1px solid var(--border, #313244)',
    width: '90vw',
    maxWidth: 1000,
    height: '85vh',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid var(--border, #313244)',
    background: 'var(--surface-1, #181825)',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary, #cdd6f4)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } as React.CSSProperties,
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary, #a6adc8)',
    fontSize: 20,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 6,
    lineHeight: 1,
  } as React.CSSProperties,
  tabs: {
    display: 'flex',
    borderBottom: '1px solid var(--border, #313244)',
    background: 'var(--surface-1, #181825)',
    overflowX: 'auto' as const,
    scrollbarWidth: 'none' as const,
  },
  tab: (active: boolean): React.CSSProperties => ({
    padding: '10px 16px',
    background: 'none',
    border: 'none',
    borderBottom: active ? '2px solid var(--accent, #89b4fa)' : '2px solid transparent',
    color: active ? 'var(--accent, #89b4fa)' : 'var(--text-secondary, #a6adc8)',
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    whiteSpace: 'nowrap' as const,
    transition: 'color 0.15s, border-color 0.15s',
    flexShrink: 0,
  }),
  filters: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    padding: '10px 20px',
    borderBottom: '1px solid var(--border, #313244)',
    flexWrap: 'wrap' as const,
  },
  timeBtn: {
    border: '1px solid #45475a',
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer',
  } as React.CSSProperties,
  searchInput: {
    background: '#313244',
    border: '1px solid #45475a',
    borderRadius: 6,
    padding: '5px 10px',
    color: '#cdd6f4',
    fontSize: 12,
    flex: 1,
    minWidth: 120,
    outline: 'none',
  } as React.CSSProperties,
  refreshBtn: {
    background: 'transparent',
    border: '1px solid #45475a',
    borderRadius: 6,
    padding: '5px 12px',
    color: '#a6adc8',
    fontSize: 11,
    cursor: 'pointer',
  } as React.CSSProperties,
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '0 20px',
  } as React.CSSProperties,
  eventRow: {
    padding: '8px 12px',
    borderBottom: '1px solid #313244',
    cursor: 'pointer',
    transition: 'background 0.1s',
  } as React.CSSProperties,
  tag: {
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: 4,
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  detail: {
    marginTop: 8,
    padding: 10,
    background: '#181825',
    borderRadius: 6,
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#a6adc8',
    overflow: 'auto',
    maxHeight: 300,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
  } as React.CSSProperties,
  footer: {
    padding: '8px 20px',
    borderTop: '1px solid #313244',
  } as React.CSSProperties,
  section: {
    marginBottom: 24,
  } as React.CSSProperties,
  sectionTitle: {
    color: '#a6adc8',
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 12,
    margin: 0,
  } as React.CSSProperties,
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12,
  } as React.CSSProperties,
  card: {
    background: '#313244',
    borderRadius: 8,
    padding: '16px 14px',
    textAlign: 'center' as const,
  } as React.CSSProperties,
  integrationRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    background: '#313244',
    borderRadius: 6,
  } as React.CSSProperties,
  statusBadge: {
    fontSize: 10,
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: 4,
  } as React.CSSProperties,
};
