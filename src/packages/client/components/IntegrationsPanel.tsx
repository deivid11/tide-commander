import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import type { IntegrationInfo, ConfigField } from '../../shared/integration-types.js';
import { apiUrl, authFetch } from '../utils/storage';

// ─── Custom Settings Components Registry ───
const customComponents: Record<string, React.LazyExoticComponent<React.ComponentType<CustomSettingsProps>>> = {
  'gmail-oauth': lazy(() => import('./GmailOAuthSetup').then((m) => ({ default: m.GmailOAuthSetup }))),
};

interface CustomSettingsProps {
  integration: IntegrationInfo;
  onSave: (config: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

// ─── Constants ───

const INTEGRATION_ICONS: Record<string, string> = {
  gmail: '\u2709\uFE0F',
  slack: '\uD83D\uDCAC',
  jira: '\uD83D\uDCCB',
  'google-calendar': '\uD83D\uDCC5',
  docx: '\uD83D\uDCC4',
};

const INTEGRATION_DESCRIPTIONS: Record<string, string> = {
  gmail: 'Send and receive emails through Gmail. Supports OAuth 2.0 authentication for secure access to your inbox.',
  slack: 'Connect to Slack workspaces. Send messages, receive notifications, and integrate with channels.',
  jira: 'Manage Jira issues and projects. Create tickets, track progress, and handle service desk requests.',
  'google-calendar': 'Access Google Calendar events. Create, update, and monitor calendar entries.',
  docx: 'Generate and manipulate DOCX documents. Create reports, templates, and formatted documents.',
};

const INTEGRATION_REQUIREMENTS: Record<string, string[]> = {
  gmail: ['Google Cloud Console project', 'OAuth 2.0 credentials (Client ID & Secret)', 'Gmail API enabled'],
  slack: ['Slack App with Bot Token', 'Signing Secret for webhook verification', 'Required scopes: chat:write, channels:read'],
  jira: ['Jira Cloud instance URL', 'API Token (from Atlassian account)', 'Account email address'],
  'google-calendar': ['Google Cloud Console project', 'OAuth 2.0 credentials', 'Calendar API enabled'],
  docx: ['No external credentials required', 'Templates directory (optional)'],
};

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
    animation: 'fadeIn 0.15s ease-out',
  },
  modal: {
    background: 'var(--surface-0, #1e1e2e)',
    borderRadius: 12,
    border: '1px solid var(--border, #313244)',
    width: '90vw',
    maxWidth: 720,
    maxHeight: '85vh',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
    animation: 'slideUp 0.2s ease-out',
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
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary, #a6adc8)',
    fontSize: 20,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 6,
    lineHeight: 1,
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid var(--border, #313244)',
    background: 'var(--surface-1, #181825)',
    overflowX: 'auto' as const,
    scrollbarWidth: 'none' as const,
  },
  tab: (active: boolean) => ({
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
  tabStatus: (connected: boolean, hasError: boolean) => ({
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: hasError ? '#f38ba8' : connected ? '#a6e3a1' : '#fab387',
    flexShrink: 0,
  }),
  body: {
    flex: 1,
    overflow: 'auto' as const,
    padding: 20,
  },
  integrationHeader: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 10,
    background: 'var(--surface-1, #181825)',
    border: '1px solid var(--border, #313244)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 22,
    flexShrink: 0,
  },
  integrationMeta: {
    flex: 1,
  },
  integrationName: {
    fontSize: 15,
    fontWeight: 600,
    color: 'var(--text-primary, #cdd6f4)',
    marginBottom: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  description: {
    fontSize: 13,
    color: 'var(--text-secondary, #a6adc8)',
    lineHeight: 1.5,
  },
  statusBadge: (connected: boolean, hasError: boolean) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
    background: hasError ? 'rgba(243, 139, 168, 0.15)' : connected ? 'rgba(166, 227, 161, 0.15)' : 'rgba(250, 179, 135, 0.15)',
    color: hasError ? '#f38ba8' : connected ? '#a6e3a1' : '#fab387',
  }),
  section: {
    marginTop: 16,
    padding: 12,
    borderRadius: 8,
    background: 'var(--surface-1, #181825)',
    border: '1px solid var(--border, #313244)',
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary, #a6adc8)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: 8,
  },
  requirementList: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  requirementItem: {
    fontSize: 12,
    color: 'var(--text-secondary, #a6adc8)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  formSection: {
    marginTop: 16,
  },
  formSectionTitle: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary, #a6adc8)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: 12,
  },
};

// ─── Integration Settings Form ───

function IntegrationSettingsForm({ integration, onSave, onCancel }: { integration: IntegrationInfo; onSave: (config: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [values, setValues] = useState<Record<string, unknown>>({ ...integration.values });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Reset values when integration changes
  useEffect(() => {
    setValues({ ...integration.values });
    setErrors({});
    setSaveSuccess(false);
  }, [integration.id]);

  const handleChange = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => { const next = { ...prev }; delete next[key]; return next; });
    setSaveSuccess(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fieldErrors: Record<string, string> = {};
    for (const field of integration.schema) {
      if (field.required && !values[field.key] && values[field.key] !== 0 && values[field.key] !== false) {
        fieldErrors[field.key] = `${field.label} is required`;
      }
      if (field.validate) {
        const err = field.validate(values[field.key]);
        if (err) fieldErrors[field.key] = err;
      }
    }
    if (Object.keys(fieldErrors).length > 0) { setErrors(fieldErrors); return; }

    setSaving(true);
    try {
      await onSave(values);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setErrors({ _form: String(err) });
    } finally {
      setSaving(false);
    }
  };

  const groups = new Map<string, ConfigField[]>();
  for (const field of integration.schema) {
    const group = field.group || '';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(field);
  }

  const fieldStyle = {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    marginBottom: 12,
  };

  const labelStyle = {
    fontSize: 13,
    fontWeight: 500 as const,
    color: 'var(--text-primary, #cdd6f4)',
  };

  const inputStyle = {
    padding: '8px 10px',
    borderRadius: 6,
    border: '1px solid var(--border, #313244)',
    background: 'var(--surface-0, #1e1e2e)',
    color: 'var(--text-primary, #cdd6f4)',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  };

  const hintStyle = {
    fontSize: 11,
    color: 'var(--text-secondary, #a6adc8)',
  };

  const errorStyle = {
    fontSize: 11,
    color: '#f38ba8',
  };

  const renderField = (field: ConfigField) => {
    const value = values[field.key] ?? field.defaultValue ?? '';
    switch (field.type) {
      case 'boolean':
        return (
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-primary, #cdd6f4)', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!value} onChange={(e) => handleChange(field.key, e.target.checked)} />
            {field.label}
          </label>
        );
      case 'select':
        return (
          <select style={inputStyle} value={String(value)} onChange={(e) => handleChange(field.key, e.target.value)}>
            <option value="">{field.placeholder || 'Select...'}</option>
            {field.options?.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        );
      case 'textarea':
        return <textarea style={{ ...inputStyle, resize: 'vertical' as const, minHeight: 80 }} value={String(value)} placeholder={field.placeholder} onChange={(e) => handleChange(field.key, e.target.value)} rows={4} />;
      case 'number':
        return <input type="number" style={inputStyle} value={value === '' ? '' : Number(value)} placeholder={field.placeholder} onChange={(e) => handleChange(field.key, e.target.value === '' ? '' : Number(e.target.value))} />;
      case 'password':
        return <input type="password" style={inputStyle} value={String(value)} placeholder={field.placeholder} onChange={(e) => handleChange(field.key, e.target.value)} autoComplete="off" />;
      default:
        return <input type={field.type} style={inputStyle} value={String(value)} placeholder={field.placeholder} onChange={(e) => handleChange(field.key, e.target.value)} />;
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {errors._form && <div style={{ ...errorStyle, marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'rgba(243, 139, 168, 0.1)' }}>{errors._form}</div>}
      {Array.from(groups.entries()).map(([groupName, fields]) => (
        <div key={groupName || '_default'}>
          {groupName && <div style={{ ...S.sectionTitle, marginTop: 16, marginBottom: 8 }}>{groupName}</div>}
          {fields.map((field) => (
            <div key={field.key} style={fieldStyle}>
              {field.type !== 'boolean' && (
                <label style={labelStyle}>
                  {field.label}
                  {field.required && <span style={{ color: '#f38ba8', marginLeft: 2 }}>*</span>}
                </label>
              )}
              {renderField(field)}
              {field.description && <span style={hintStyle}>{field.description}</span>}
              {errors[field.key] && <span style={errorStyle}>{errors[field.key]}</span>}
            </div>
          ))}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border, #313244)' }}>
        <button type="button" onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid var(--border, #313244)', background: 'none', color: 'var(--text-secondary, #a6adc8)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
        <button type="submit" disabled={saving} style={{ padding: '8px 16px', borderRadius: 6, border: 'none', background: saveSuccess ? '#a6e3a1' : 'var(--accent, #89b4fa)', color: saveSuccess ? '#1e1e2e' : '#1e1e2e', fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1 }}>
          {saving ? 'Saving...' : saveSuccess ? 'Saved' : 'Save Configuration'}
        </button>
      </div>
    </form>
  );
}

// ─── Integrations Modal ───

interface IntegrationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: string;
}

export function IntegrationsPanel({ isOpen, onClose, initialTab }: IntegrationsModalProps) {
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(initialTab || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIntegrations = useCallback(async () => {
    try {
      const response = await authFetch(apiUrl('/api/integrations'));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setIntegrations(data);
      setError(null);
      if (!activeTab && data.length > 0) {
        setActiveTab(initialTab || data[0].id);
      }
    } catch (err) {
      setError(`Failed to load integrations: ${err}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      fetchIntegrations();
      if (initialTab) setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  const handleSave = async (integrationId: string, config: Record<string, unknown>) => {
    const response = await authFetch(apiUrl(`/api/integrations/${integrationId}/config`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    await fetchIntegrations();
  };

  if (!isOpen) return null;

  const active = integrations.find((i) => i.id === activeTab);

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={S.header}>
          <div style={S.headerTitle}>
            <span>{'\uD83D\uDD0C'}</span>
            <span>Integrations</span>
          </div>
          <button style={S.closeBtn} onClick={onClose} title="Close">&times;</button>
        </div>

        {/* Loading / Error */}
        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary, #a6adc8)' }}>Loading integrations...</div>
        )}
        {error && (
          <div style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ color: '#f38ba8', marginBottom: 8 }}>{error}</div>
            <button onClick={fetchIntegrations} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border, #313244)', background: 'none', color: 'var(--text-primary, #cdd6f4)', cursor: 'pointer', fontSize: 13 }}>Retry</button>
          </div>
        )}

        {/* Tabs + Content */}
        {!loading && !error && integrations.length > 0 && (
          <>
            <div style={S.tabs}>
              {integrations.map((integration) => (
                <button
                  key={integration.id}
                  style={S.tab(activeTab === integration.id)}
                  onClick={() => setActiveTab(integration.id)}
                >
                  <span>{INTEGRATION_ICONS[integration.id] || '\uD83D\uDD0C'}</span>
                  <span>{integration.name}</span>
                  <span style={S.tabStatus(integration.status.connected, !!integration.status.error)} />
                </button>
              ))}
            </div>

            <div style={S.body}>
              {active && (
                <div>
                  {/* Integration Header */}
                  <div style={S.integrationHeader}>
                    <div style={S.iconCircle}>
                      {INTEGRATION_ICONS[active.id] || '\uD83D\uDD0C'}
                    </div>
                    <div style={S.integrationMeta}>
                      <div style={S.integrationName}>
                        {active.name}
                        <span style={S.statusBadge(active.status.connected, !!active.status.error)}>
                          {active.status.error ? '\u2717 Error' : active.status.connected ? '\u2713 Connected' : '\u26A0 Not Configured'}
                        </span>
                      </div>
                      <div style={S.description}>
                        {INTEGRATION_DESCRIPTIONS[active.id] || active.description}
                      </div>
                    </div>
                  </div>

                  {/* Error detail */}
                  {active.status.error && (
                    <div style={{ ...S.section, borderColor: 'rgba(243, 139, 168, 0.3)', background: 'rgba(243, 139, 168, 0.05)' }}>
                      <div style={{ ...S.sectionTitle, color: '#f38ba8' }}>Error</div>
                      <div style={{ fontSize: 12, color: '#f38ba8' }}>{active.status.error}</div>
                    </div>
                  )}

                  {/* Requirements */}
                  {INTEGRATION_REQUIREMENTS[active.id] && (
                    <div style={S.section}>
                      <div style={S.sectionTitle}>Requirements</div>
                      <ul style={S.requirementList}>
                        {INTEGRATION_REQUIREMENTS[active.id].map((req, i) => (
                          <li key={i} style={S.requirementItem}>
                            <span style={{ color: 'var(--accent, #89b4fa)' }}>{'\u2022'}</span>
                            {req}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Configuration Form */}
                  <div style={S.formSection}>
                    <div style={S.formSectionTitle}>Configuration</div>
                    {active.customComponent && customComponents[active.customComponent] ? (
                      <Suspense fallback={<div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Loading...</div>}>
                        {React.createElement(customComponents[active.customComponent], {
                          integration: active,
                          onSave: (config: Record<string, unknown>) => handleSave(active.id, config),
                          onCancel: onClose,
                        })}
                      </Suspense>
                    ) : (
                      <IntegrationSettingsForm
                        integration={active}
                        onSave={(config) => handleSave(active.id, config)}
                        onCancel={onClose}
                      />
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {!loading && !error && integrations.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-secondary, #a6adc8)' }}>No integrations available.</div>
        )}
      </div>
    </div>
  );
}
