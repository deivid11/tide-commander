import React, { useState, useEffect, useCallback } from 'react';
import type { IntegrationInfo } from '../../../shared/integration-types.js';
import { apiUrl, authFetch } from '../../utils/storage';

const INTEGRATION_ICONS: Record<string, string> = {
  gmail: '\u2709\uFE0F',
  slack: '\uD83D\uDCAC',
  jira: '\uD83D\uDCCB',
  'google-calendar': '\uD83D\uDCC5',
  docx: '\uD83D\uDCC4',
  whatsapp: '\uD83D\uDCF1',
};

interface IntegrationStatusPanelProps {
  onOpenModal: (integrationId?: string) => void;
}

export function IntegrationStatusPanel({ onOpenModal }: IntegrationStatusPanelProps) {
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchIntegrations = useCallback(async () => {
    try {
      const response = await authFetch(apiUrl('/api/integrations'));
      if (!response.ok) return;
      const data = await response.json();
      setIntegrations(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  if (loading) {
    return <div style={{ color: 'var(--text-secondary, #a6adc8)', fontSize: 12, padding: '4px 0' }}>Loading...</div>;
  }

  if (integrations.length === 0) {
    return <div style={{ color: 'var(--text-secondary, #a6adc8)', fontSize: 12, padding: '4px 0' }}>No integrations available.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {integrations.map((integration) => {
        const icon = INTEGRATION_ICONS[integration.id] || '\uD83D\uDD0C';
        const hasError = !!integration.status.error;
        const connected = integration.status.connected;
        const statusColor = hasError ? '#f38ba8' : connected ? '#a6e3a1' : '#fab387';
        const statusText = hasError ? 'Error' : connected ? 'Connected' : 'Setup Required';
        const statusIcon = hasError ? '\u2717' : connected ? '\u2713' : '\u26A0';

        return (
          <div
            key={integration.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '3px 8px',
              borderRadius: 4,
              background: 'var(--surface-1, #181825)',
              border: '1px solid var(--border, #313244)',
              fontSize: 12,
              minHeight: 26,
            }}
          >
            <span style={{ fontSize: 13, flexShrink: 0 }}>{icon}</span>
            <span style={{
              flex: 1,
              minWidth: 0,
              color: 'var(--text-primary, #cdd6f4)',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {integration.name}
            </span>
            <span style={{ color: statusColor, fontSize: 10, fontWeight: 500, whiteSpace: 'nowrap' }} title={statusText}>
              {statusIcon}
            </span>
            <button
              onClick={() => onOpenModal(integration.id)}
              title={`Configure ${integration.name}`}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '1px 3px',
                fontSize: 12,
                color: 'var(--text-secondary, #a6adc8)',
                borderRadius: 3,
                flexShrink: 0,
                lineHeight: 1,
              }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.color = 'var(--text-primary, #cdd6f4)'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.color = 'var(--text-secondary, #a6adc8)'; }}
            >
              {'\u2699\uFE0F'}
            </button>
          </div>
        );
      })}
      <button
        onClick={() => onOpenModal()}
        style={{
          background: 'none',
          border: '1px dashed var(--border, #313244)',
          borderRadius: 4,
          padding: '3px 8px',
          cursor: 'pointer',
          color: 'var(--text-secondary, #a6adc8)',
          fontSize: 11,
          textAlign: 'center',
          marginTop: 2,
        }}
        onMouseEnter={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--accent, #89b4fa)'; (e.target as HTMLElement).style.color = 'var(--accent, #89b4fa)'; }}
        onMouseLeave={(e) => { (e.target as HTMLElement).style.borderColor = 'var(--border, #313244)'; (e.target as HTMLElement).style.color = 'var(--text-secondary, #a6adc8)'; }}
      >
        Manage All Integrations
      </button>
    </div>
  );
}
