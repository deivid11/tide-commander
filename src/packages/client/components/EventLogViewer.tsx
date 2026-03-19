/**
 * EventLogViewer
 * UI for browsing event logs and audit trail.
 * Supports filtering by category, time range, and search.
 * Renders a chronological timeline of all system events.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiUrl, authFetch } from '../utils/storage';
import type {
  TimelineEntry, AuditLogEntry, AuditCategory, AuditLevel,
} from '../../shared/event-types';

interface EventLogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORY_COLORS: Record<AuditCategory | string, string> = {
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

const LEVEL_COLORS: Record<AuditLevel, string> = {
  debug: '#6c7086',
  info: '#89b4fa',
  warn: '#f9e2af',
  error: '#f38ba8',
};

type TimeRange = '1h' | '6h' | '24h' | '7d' | 'all';

export function EventLogViewer({ isOpen, onClose }: EventLogViewerProps) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (category !== 'all') params.set('category', category);

      const now = Date.now();
      const rangeMs: Record<TimeRange, number> = {
        '1h': 3600000,
        '6h': 21600000,
        '24h': 86400000,
        '7d': 604800000,
        'all': 0,
      };
      if (rangeMs[timeRange] > 0) {
        params.set('since', String(now - rangeMs[timeRange]));
      }

      const resp = await authFetch(apiUrl(`/api/events/timeline?${params}`));
      if (resp.ok) {
        const data = await resp.json();
        setEntries(Array.isArray(data) ? data : data.events || []);
        setError(null);
      } else {
        setError(`HTTP ${resp.status}`);
      }
    } catch (err) {
      setError(`Failed to load events: ${err}`);
    } finally {
      setLoading(false);
    }
  }, [category, timeRange]);

  useEffect(() => {
    if (isOpen) fetchEvents();
  }, [isOpen, fetchEvents]);

  // Filter by search text
  const filtered = entries.filter((entry) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const json = JSON.stringify(entry.data).toLowerCase();
    return json.includes(s);
  });

  if (!isOpen) return null;

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <h2 style={{ color: '#cdd6f4', fontSize: 16, fontWeight: 600, margin: 0 }}>Event Log</h2>
          <button style={closeBtnStyle} onClick={onClose}>Close</button>
        </div>

        {/* Filters */}
        <div style={filtersStyle}>
          <select
            style={selectStyle}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="all">All Categories</option>
            {Object.entries(CATEGORY_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>

          <div style={{ display: 'flex', gap: 4 }}>
            {(['1h', '6h', '24h', '7d', 'all'] as TimeRange[]).map((range) => (
              <button
                key={range}
                style={{
                  ...timeBtnStyle,
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
            style={searchInputStyle}
            placeholder="Search events..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <button style={refreshBtnStyle} onClick={fetchEvents}>Refresh</button>
        </div>

        {/* Event List */}
        <div style={contentStyle}>
          {loading && <div style={{ color: '#a6adc8', padding: 20 }}>Loading events...</div>}
          {error && <div style={{ color: '#f38ba8', padding: 20 }}>{error}</div>}

          {!loading && filtered.length === 0 && (
            <div style={{ color: '#6c7086', textAlign: 'center', padding: 40 }}>
              No events found for the selected filters.
            </div>
          )}

          {filtered.map((entry, i) => {
            const key = `${entry.type}-${entry.timestamp}-${i}`;
            const isExpanded = expandedId === key;
            const color = CATEGORY_COLORS[entry.type] || '#6c7086';
            const summary = getEntrySummary(entry);
            const time = new Date(entry.timestamp);

            return (
              <div
                key={key}
                style={{
                  ...eventRowStyle,
                  borderLeft: `3px solid ${color}`,
                  background: isExpanded ? 'rgba(137,180,250,0.05)' : 'transparent',
                }}
                onClick={() => setExpandedId(isExpanded ? null : key)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ ...tagStyle, background: `${color}22`, color }}>{CATEGORY_LABELS[entry.type] || entry.type}</span>
                  <span style={{ color: '#cdd6f4', fontSize: 12, flex: 1 }}>{summary}</span>
                  <span style={{ color: '#6c7086', fontSize: 10, whiteSpace: 'nowrap' }}>
                    {time.toLocaleTimeString()} {time.toLocaleDateString()}
                  </span>
                </div>

                {isExpanded && (
                  <pre style={detailStyle}>
                    {JSON.stringify(entry.data, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={footerStyle}>
          <span style={{ color: '#6c7086', fontSize: 11 }}>
            {filtered.length} event{filtered.length !== 1 ? 's' : ''} shown
            {search && ` (filtered from ${entries.length})`}
          </span>
        </div>
      </div>
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

const overlayStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.6)', zIndex: 1000,
  display: 'flex', justifyContent: 'center', alignItems: 'center',
};

const panelStyle: React.CSSProperties = {
  background: '#1e1e2e', borderRadius: 12, border: '1px solid #313244',
  width: '90vw', maxWidth: 1000, height: '85vh',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '12px 20px', borderBottom: '1px solid #313244',
};

const filtersStyle: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center', padding: '10px 20px',
  borderBottom: '1px solid #313244', flexWrap: 'wrap',
};

const selectStyle: React.CSSProperties = {
  background: '#313244', border: '1px solid #45475a', borderRadius: 6,
  padding: '5px 8px', color: '#cdd6f4', fontSize: 12, outline: 'none',
};

const timeBtnStyle: React.CSSProperties = {
  border: '1px solid #45475a', borderRadius: 4, padding: '4px 8px',
  fontSize: 10, fontWeight: 600, cursor: 'pointer',
};

const searchInputStyle: React.CSSProperties = {
  background: '#313244', border: '1px solid #45475a', borderRadius: 6,
  padding: '5px 10px', color: '#cdd6f4', fontSize: 12, flex: 1,
  minWidth: 120, outline: 'none',
};

const refreshBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid #45475a', borderRadius: 6,
  padding: '5px 12px', color: '#a6adc8', fontSize: 11, cursor: 'pointer',
};

const contentStyle: React.CSSProperties = {
  flex: 1, overflow: 'auto', padding: '0 20px',
};

const eventRowStyle: React.CSSProperties = {
  padding: '8px 12px', borderBottom: '1px solid #313244',
  cursor: 'pointer', transition: 'background 0.1s',
};

const tagStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, padding: '2px 6px',
  borderRadius: 4, whiteSpace: 'nowrap',
};

const detailStyle: React.CSSProperties = {
  marginTop: 8, padding: 10, background: '#181825', borderRadius: 6,
  fontSize: 11, fontFamily: 'monospace', color: '#a6adc8',
  overflow: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
};

const footerStyle: React.CSSProperties = {
  padding: '8px 20px', borderTop: '1px solid #313244',
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid #45475a', borderRadius: 6,
  padding: '4px 12px', color: '#a6adc8', cursor: 'pointer', fontSize: 12,
};
