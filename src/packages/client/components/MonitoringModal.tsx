/**
 * MonitoringModal
 * Tab-based monitoring interface for viewing trigger history, workflow traces,
 * message logs, and system statistics.
 * Reuses EventLogViewer filtering/display logic and StatsDashboard for stats.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiUrl, authFetch } from '../utils/storage';
import type { TimelineEntry, EventStats } from '../../shared/event-types';

interface MonitoringModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabId = 'triggers' | 'workflows' | 'messages' | 'stats';
type TimeRange = '1h' | '6h' | '24h' | '7d' | 'all';

interface IntegrationStatusInfo {
  id: string;
  name: string;
  status: { connected: boolean; lastChecked: number; error?: string };
}

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'triggers', label: 'Triggers', icon: '\u26A1' },
  { id: 'workflows', label: 'Workflows', icon: '\u2699\uFE0F' },
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

// Categories that belong to each tab
const TAB_CATEGORIES: Record<TabId, string[]> = {
  triggers: ['trigger'],
  workflows: ['step', 'variable_change', 'workflow'],
  messages: ['slack', 'email', 'approval'],
  stats: [],
};

export function MonitoringModal({ isOpen, onClose }: MonitoringModalProps) {
  const [activeTab, setActiveTab] = useState<TabId>('triggers');
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Stats tab state
  const [stats, setStats] = useState<EventStats | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatusInfo[]>([]);

  const fetchEvents = useCallback(async () => {
    if (activeTab === 'stats') return;
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

        {/* Filters (for non-stats tabs) */}
        {activeTab !== 'stats' && (
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
          ) : (
            <EventListContent
              loading={loading}
              error={error}
              entries={filtered}
              totalCount={entries.length}
              search={search}
              expandedId={expandedId}
              onToggleExpand={(id) => setExpandedId(expandedId === id ? null : id)}
            />
          )}
        </div>

        {/* Footer */}
        {activeTab !== 'stats' && (
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
  totalCount,
  search,
  expandedId,
  onToggleExpand,
}: {
  loading: boolean;
  error: string | null;
  entries: TimelineEntry[];
  totalCount: number;
  search: string;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
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
            onClick={() => onToggleExpand(key)}
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
              <pre style={S.detail}>
                {JSON.stringify(entry.data, null, 2)}
              </pre>
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
