/**
 * StatsDashboard
 * Aggregate statistics dashboard showing event counts, workflow metrics,
 * and integration activity summaries.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { apiUrl, authFetch } from '../utils/storage';
import type { EventStats } from '../../shared/event-types';

interface StatsDashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

interface IntegrationStatusInfo {
  id: string;
  name: string;
  status: { connected: boolean; lastChecked: number; error?: string };
}

export function StatsDashboard({ isOpen, onClose }: StatsDashboardProps) {
  const [stats, setStats] = useState<EventStats | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatusInfo[]>([]);
  const [recentTriggers, setRecentTriggers] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch stats, integrations, and recent trigger count in parallel
      const [statsResp, intResp] = await Promise.all([
        authFetch(apiUrl('/api/events/stats')),
        authFetch(apiUrl('/api/integrations')),
      ]);

      if (statsResp.ok) {
        setStats(await statsResp.json());
      }
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
    if (isOpen) fetchStats();
  }, [isOpen, fetchStats]);

  if (!isOpen) return null;

  const connectedCount = integrations.filter((i) => i.status.connected).length;

  return (
    <div style={overlayStyle}>
      <div style={panelStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <h2 style={{ color: '#cdd6f4', fontSize: 16, fontWeight: 600, margin: 0 }}>Dashboard</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={refreshBtnStyle} onClick={fetchStats}>Refresh</button>
            <button style={closeBtnStyle} onClick={onClose}>Close</button>
          </div>
        </div>

        <div style={contentStyle}>
          {loading && <div style={{ color: '#a6adc8', padding: 20 }}>Loading stats...</div>}
          {error && <div style={{ color: '#f38ba8', padding: 20 }}>{error}</div>}

          {stats && (
            <>
              {/* Workflow Stats */}
              <div style={sectionStyle}>
                <h3 style={sectionTitleStyle}>Workflows</h3>
                <div style={gridStyle}>
                  <StatCard label="Active" value={stats.activeWorkflows} color="#89b4fa" />
                  <StatCard label="Completed" value={stats.completedWorkflows} color="#a6e3a1" />
                  <StatCard label="Failed" value={stats.failedWorkflows} color="#f38ba8" />
                </div>
              </div>

              {/* Event Stats */}
              <div style={sectionStyle}>
                <h3 style={sectionTitleStyle}>Events (Today)</h3>
                <div style={gridStyle}>
                  <StatCard label="Triggers Fired" value={stats.triggersFiredToday} color="#f9e2af" />
                  <StatCard label="Slack Messages" value={stats.slackMessageCount} color="#cba6f7" />
                  <StatCard label="Emails" value={stats.emailCount} color="#fab387" />
                </div>
              </div>

              {/* Integrations */}
              <div style={sectionStyle}>
                <h3 style={sectionTitleStyle}>
                  Integrations ({connectedCount}/{integrations.length} connected)
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {integrations.map((integration) => (
                    <div key={integration.id} style={integrationRowStyle}>
                      <span style={{ color: '#cdd6f4', fontSize: 13 }}>{integration.name}</span>
                      <span
                        style={{
                          ...statusBadgeStyle,
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

          {!loading && !stats && !error && (
            <div style={{ color: '#6c7086', textAlign: 'center', padding: 40 }}>
              No stats available. The event store may not have any data yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── StatCard ───

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ color, fontSize: 28, fontWeight: 700, lineHeight: 1 }}>{value}</div>
      <div style={{ color: '#a6adc8', fontSize: 11, marginTop: 4 }}>{label}</div>
    </div>
  );
}

// ─── Styles ───

const overlayStyle: React.CSSProperties = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.6)', zIndex: 1000,
  display: 'flex', justifyContent: 'center', alignItems: 'center',
};

const panelStyle: React.CSSProperties = {
  background: '#1e1e2e', borderRadius: 12, border: '1px solid #313244',
  width: '90vw', maxWidth: 700, maxHeight: '85vh',
  display: 'flex', flexDirection: 'column', overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '12px 20px', borderBottom: '1px solid #313244',
};

const contentStyle: React.CSSProperties = {
  flex: 1, overflow: 'auto', padding: 20,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 24,
};

const sectionTitleStyle: React.CSSProperties = {
  color: '#a6adc8', fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: 1, marginBottom: 12, margin: 0,
};

const gridStyle: React.CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
};

const cardStyle: React.CSSProperties = {
  background: '#313244', borderRadius: 8, padding: '16px 14px',
  textAlign: 'center',
};

const integrationRowStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  padding: '8px 12px', background: '#313244', borderRadius: 6,
};

const statusBadgeStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid #45475a', borderRadius: 6,
  padding: '4px 12px', color: '#a6adc8', cursor: 'pointer', fontSize: 12,
};

const refreshBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid #45475a', borderRadius: 6,
  padding: '4px 12px', color: '#a6adc8', cursor: 'pointer', fontSize: 12,
};
