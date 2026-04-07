/**
 * WorkflowPanel - Workflow status panel for the agent terminal
 *
 * Displays current workflow state, available transitions, and manual transition controls.
 * Fetches all data directly from the API (the store is not yet wired via WebSocket).
 * Designed to slide in from the right side of the ClaudeOutputPanel, similar to GuakeGitPanel.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiUrl, authFetch } from '../utils/storage';
import type { WorkflowDefinition, WorkflowTransition, WorkflowStateType, WorkflowInstanceStatus } from '../../shared/workflow-types';

// ─── Types ───

interface WorkflowPanelProps {
  agentId: string;
  onClose: () => void;
}

interface ApiInstance {
  id: string;
  workflowDefId: string;
  workflowName: string;
  status: WorkflowInstanceStatus;
  currentStateId: string;
  variables: Record<string, unknown>;
  history: Array<{
    timestamp: number;
    fromStateId?: string;
    toStateId: string;
    transitionName?: string;
    details?: string;
  }>;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  agentId?: string;
}

interface AvailableTransition {
  id: string;
  name: string;
  targetStateId: string;
  targetStateName?: string;
}

// ─── Styling Constants ───

const STATE_TYPE_COLORS: Record<WorkflowStateType, string> = {
  action: '#cba6f7',
  wait: '#f9e2af',
  decision: '#89b4fa',
  end: '#a6e3a1',
};

const STATUS_COLORS: Record<string, string> = {
  running: '#a6e3a1',
  paused: '#f9e2af',
  completed: '#89b4fa',
  failed: '#f38ba8',
  cancelled: '#6c7086',
};

// ─── Helpers ───

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ─── Main Component ───

export function WorkflowPanel({ agentId, onClose }: WorkflowPanelProps) {
  const [definitions, setDefinitions] = useState<WorkflowDefinition[]>([]);
  const [instances, setInstances] = useState<ApiInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch definitions and instances from the API
  const fetchData = useCallback(async () => {
    try {
      const [defsRes, instsRes] = await Promise.all([
        authFetch(apiUrl('/api/workflows/definitions')),
        authFetch(apiUrl('/api/workflows/instances')),
      ]);
      if (defsRes.ok) {
        const defs = await defsRes.json();
        setDefinitions(defs);
      }
      if (instsRes.ok) {
        const data = await instsRes.json();
        setInstances(data.instances || data || []);
      }
    } catch { /* skip */ } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    pollRef.current = setInterval(fetchData, 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchData]);

  // Find definitions that reference this agent via agent_task actions
  const agentDefs = definitions.filter(def =>
    def.states.some(s => s.action?.type === 'agent_task' && (s.action as { agentId?: string }).agentId === agentId)
  );
  const agentDefIds = new Set(agentDefs.map(d => d.id));

  // Find instances for those definitions (or that have this agentId directly)
  const agentInstances = instances
    .filter(inst => agentDefIds.has(inst.workflowDefId) || inst.agentId === agentId)
    .sort((a, b) => {
      // Running instances first, then by update time
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (b.status === 'running' && a.status !== 'running') return 1;
      return b.updatedAt - a.updatedAt;
    });

  // Auto-select on first load or if selection is stale
  useEffect(() => {
    if (agentInstances.length === 0) { setSelectedInstanceId(null); return; }
    const current = agentInstances.find(i => i.id === selectedInstanceId);
    if (!current) {
      setSelectedInstanceId(agentInstances[0].id);
    }
  }, [agentInstances, selectedInstanceId]);

  const selectedInstance = agentInstances.find(i => i.id === selectedInstanceId) ?? null;
  const selectedDef = selectedInstance
    ? definitions.find(d => d.id === selectedInstance.workflowDefId) ?? null
    : null;

  return (
    <div className="guake-git-panel">
      <div className="guake-git-header">
        <div className="guake-git-title">
          <span style={{ padding: '0 12px', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Workflow
          </span>
          {agentInstances.length > 0 && (
            <span style={S.headerBadge}>{agentInstances.length}</span>
          )}
        </div>
        <div className="guake-git-header-actions">
          <button className="guake-git-refresh" onClick={fetchData} title="Refresh" disabled={loading}>
            {loading ? '\u23F3' : '\u21BB'}
          </button>
          <button className="guake-git-close" onClick={onClose} title="Close">&times;</button>
        </div>
      </div>

      <div className="guake-git-body" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {loading && agentInstances.length === 0 && (
          <div style={S.emptyState}>
            <span style={S.loadingText}>Loading workflows...</span>
          </div>
        )}

        {!loading && agentInstances.length === 0 && (
          <div style={S.emptyState}>
            <span style={S.emptyIcon}>{'\u2298'}</span>
            <span>No workflow instances for this agent</span>
          </div>
        )}

        {/* Instance list */}
        {agentInstances.length > 0 && (
          <div style={S.instanceList}>
            {agentInstances.map(inst => {
              const isSelected = inst.id === selectedInstanceId;
              const def = definitions.find(d => d.id === inst.workflowDefId);
              const currentState = def?.states.find(s => s.id === inst.currentStateId);
              return (
                <button
                  key={inst.id}
                  onClick={() => setSelectedInstanceId(inst.id)}
                  style={{
                    ...S.instanceRow,
                    ...(isSelected ? S.instanceRowSelected : {}),
                  }}
                >
                  <div style={S.instanceRowTop}>
                    <span style={{ ...S.statusDot, backgroundColor: STATUS_COLORS[inst.status] || '#6c7086' }} />
                    <span style={S.instanceName}>{inst.workflowName}</span>
                    <span style={{ ...S.instanceStatus, color: STATUS_COLORS[inst.status] || '#6c7086' }}>
                      {inst.status}
                    </span>
                  </div>
                  <div style={S.instanceRowBottom}>
                    <span style={S.instanceState}>
                      {currentState?.name || inst.currentStateId}
                    </span>
                    <span style={S.instanceTime}>{fmtDate(inst.updatedAt)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Selected instance detail */}
        {selectedInstance && selectedDef && (
          <InstanceView
            definition={selectedDef}
            instance={selectedInstance}
            onRefresh={fetchData}
          />
        )}
      </div>
    </div>
  );
}

// ─── Instance View ───

function InstanceView({ definition, instance, onRefresh }: {
  definition: WorkflowDefinition;
  instance: ApiInstance;
  onRefresh: () => void;
}) {
  const currentState = definition.states.find(s => s.id === instance.currentStateId);
  const [tab, setTab] = useState<'states' | 'timeline' | 'variables'>('states');

  return (
    <div style={S.instanceView}>
      {/* Status bar */}
      <div style={S.statusBar}>
        <span style={{ ...S.statusBadge, color: STATUS_COLORS[instance.status] || '#6c7086', borderColor: STATUS_COLORS[instance.status] || '#6c7086' }}>
          {instance.status}
        </span>
        <span style={S.currentLabel}>
          Current: <strong>{currentState?.name || instance.currentStateId}</strong>
        </span>
      </div>

      {/* Transition controls */}
      <TransitionControls definition={definition} instance={instance} onRefresh={onRefresh} />

      {/* Tabs */}
      <div style={S.tabs}>
        {(['states', 'timeline', 'variables'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{ ...S.tab, ...(tab === t ? S.tabActive : {}) }}
          >
            {t === 'states' ? 'States' : t === 'timeline' ? 'Timeline' : 'Variables'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={S.tabContent}>
        {tab === 'states' && <StatesTab definition={definition} currentStateId={instance.currentStateId} />}
        {tab === 'timeline' && <TimelineTab definition={definition} instance={instance} />}
        {tab === 'variables' && <VariablesTab variables={instance.variables} />}
      </div>
    </div>
  );
}

// ─── Transition Controls ───

function TransitionControls({ definition, instance, onRefresh }: {
  definition: WorkflowDefinition;
  instance: ApiInstance;
  onRefresh: () => void;
}) {
  const [transitions, setTransitions] = useState<AvailableTransition[]>([]);
  const [loading, setLoading] = useState(false);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTransitions = useCallback(async () => {
    if (instance.status !== 'running') {
      setTransitions([]);
      return;
    }
    setLoading(true);
    try {
      const res = await authFetch(apiUrl(`/api/workflows/instances/${instance.id}/available-transitions`));
      if (res.ok) {
        const data = await res.json();
        const mapped = (data.transitions || []).map((t: WorkflowTransition) => {
          const target = definition.states.find(s => s.id === t.targetStateId);
          return { ...t, targetStateName: target?.name };
        });
        setTransitions(mapped);
      }
    } catch { /* skip */ } finally {
      setLoading(false);
    }
  }, [instance.id, instance.status, definition]);

  useEffect(() => {
    fetchTransitions();
  }, [fetchTransitions, instance.currentStateId]);

  const handleTransition = useCallback(async (targetStateId: string) => {
    setTransitioning(targetStateId);
    setError(null);
    try {
      const res = await authFetch(apiUrl(`/api/workflows/instances/${instance.id}/transition`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetStateId, reason: 'Transitioned via UI panel' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Transition failed' }));
        setError(data.error || 'Transition failed');
      } else {
        setTimeout(() => { fetchTransitions(); onRefresh(); }, 500);
      }
    } catch {
      setError('Network error');
    } finally {
      setTransitioning(null);
    }
  }, [instance.id, fetchTransitions, onRefresh]);

  if (instance.status !== 'running') return null;
  if (loading && transitions.length === 0) {
    return <div style={S.transitionSection}><span style={S.loadingText}>Loading transitions...</span></div>;
  }
  if (transitions.length === 0) return null;

  return (
    <div style={S.transitionSection}>
      <div style={S.transitionLabel}>Available Transitions</div>
      <div style={S.transitionButtons}>
        {transitions.map(t => (
          <button
            key={t.id}
            onClick={() => handleTransition(t.targetStateId)}
            disabled={transitioning !== null}
            style={{
              ...S.transitionBtn,
              opacity: transitioning === t.targetStateId ? 0.6 : 1,
            }}
            title={`${t.name} \u2192 ${t.targetStateName || t.targetStateId}`}
          >
            {transitioning === t.targetStateId ? '...' : t.name}
            <span style={S.transitionArrow}>{'\u2192'} {t.targetStateName || t.targetStateId}</span>
          </button>
        ))}
      </div>
      {error && <div style={S.transitionError}>{error}</div>}
    </div>
  );
}

// ─── States Tab ───

function StatesTab({ definition, currentStateId }: {
  definition: WorkflowDefinition;
  currentStateId: string;
}) {
  return (
    <div style={S.stateList}>
      {definition.states.map(state => {
        const isCurrent = state.id === currentStateId;
        return (
          <div
            key={state.id}
            style={{
              ...S.stateItem,
              ...(isCurrent ? S.stateItemCurrent : {}),
            }}
          >
            <div style={S.stateHeader}>
              <span style={{
                ...S.stateTypeBadge,
                backgroundColor: `${STATE_TYPE_COLORS[state.type]}22`,
                color: STATE_TYPE_COLORS[state.type],
                borderColor: `${STATE_TYPE_COLORS[state.type]}44`,
              }}>
                {state.type}
              </span>
              <span style={S.stateName}>{state.name}</span>
              {isCurrent && <span style={S.currentBadge}>CURRENT</span>}
            </div>
            {state.description && (
              <div style={S.stateDescription}>{state.description}</div>
            )}
            {state.transitions.length > 0 && (
              <div style={S.stateTransitions}>
                {state.transitions.map(t => (
                  <span key={t.id} style={S.transitionChip}>
                    {t.name} {'\u2192'} {definition.states.find(s => s.id === t.targetStateId)?.name || t.targetStateId}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Timeline Tab ───

function TimelineTab({ definition, instance }: {
  definition: WorkflowDefinition;
  instance: ApiInstance;
}) {
  if (!instance.history || instance.history.length === 0) {
    return <div style={S.emptyState}>No timeline events yet</div>;
  }

  return (
    <div style={S.timeline}>
      {(instance.history ?? []).map((entry, i) => {
        const toState = definition.states.find(s => s.id === entry.toStateId);
        const fromState = entry.fromStateId ? definition.states.find(s => s.id === entry.fromStateId) : null;
        return (
          <div key={i} style={S.timelineEntry}>
            <div style={S.timelineDot} />
            <div style={S.timelineContent}>
              <div style={S.timelineHeader}>
                <span style={S.timelineTime}>{fmtTime(entry.timestamp)}</span>
                {entry.transitionName && (
                  <span style={S.timelineTransition}>via {entry.transitionName}</span>
                )}
              </div>
              <div style={S.timelineStates}>
                {fromState && (
                  <>
                    <span style={S.timelineStateName}>{fromState.name}</span>
                    <span style={S.timelineArrow}>{'\u2192'}</span>
                  </>
                )}
                <span style={{ ...S.timelineStateName, fontWeight: 600 }}>
                  {toState?.name || entry.toStateId}
                </span>
              </div>
              {entry.details && (
                <div style={S.timelineDetails}>{entry.details}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Variables Tab ───

function VariablesTab({ variables }: { variables: Record<string, unknown> }) {
  const entries = Object.entries(variables);

  if (entries.length === 0) {
    return <div style={S.emptyState}>No variables set</div>;
  }

  const userVars = entries.filter(([k]) => !k.startsWith('wi_'));
  const internalVars = entries.filter(([k]) => k.startsWith('wi_'));

  return (
    <div style={S.variablesSection}>
      {userVars.length > 0 && (
        <div style={S.varGroup}>
          <div style={S.varGroupLabel}>Variables</div>
          {userVars.map(([key, value]) => (
            <div key={key} style={S.varRow}>
              <span style={S.varKey}>{key}</span>
              <span style={S.varValue}>
                {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
              </span>
            </div>
          ))}
        </div>
      )}
      {internalVars.length > 0 && (
        <div style={S.varGroup}>
          <div style={S.varGroupLabel}>Internal</div>
          {internalVars.map(([key, value]) => (
            <div key={key} style={S.varRow}>
              <span style={{ ...S.varKey, opacity: 0.6 }}>{key}</span>
              <span style={{ ...S.varValue, opacity: 0.6 }}>
                {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Inline Styles (Catppuccin Mocha) ───

const S: Record<string, React.CSSProperties> = {
  headerBadge: {
    fontSize: 10,
    fontWeight: 700,
    background: 'var(--accent-color, #cba6f7)',
    color: '#1e1e2e',
    borderRadius: 8,
    padding: '0 5px',
    marginLeft: 6,
    minWidth: 16,
    textAlign: 'center',
    lineHeight: '16px',
  },
  instanceList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '4px 4px 0',
    maxHeight: 180,
    overflowY: 'auto',
    flexShrink: 0,
    borderBottom: '1px solid var(--border-color, #313244)',
  },
  instanceRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: '5px 8px',
    border: '1px solid transparent',
    borderRadius: 4,
    background: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    width: '100%',
    color: 'inherit',
  },
  instanceRowSelected: {
    background: 'rgba(203, 166, 247, 0.08)',
    border: '1px solid var(--accent-color, #cba6f7)',
  },
  instanceRowTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  instanceRowBottom: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 12,
  },
  statusDot: {
    display: 'inline-block',
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
  },
  instanceName: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-primary, #cdd6f4)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
  },
  instanceStatus: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    flexShrink: 0,
  },
  instanceState: {
    fontSize: 10,
    color: 'var(--text-secondary, #a6adc8)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  instanceTime: {
    fontSize: 9,
    color: 'var(--text-secondary, #a6adc8)',
    opacity: 0.7,
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
    color: 'var(--text-secondary, #a6adc8)',
    fontSize: 12,
  },
  emptyIcon: {
    fontSize: 20,
    opacity: 0.5,
  },
  loadingText: {
    fontSize: 11,
    color: 'var(--text-secondary, #a6adc8)',
    fontStyle: 'italic',
  },
  instanceView: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    borderBottom: '1px solid var(--border-color, #313244)',
    flexShrink: 0,
  },
  statusBadge: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    border: '1px solid',
    borderRadius: 4,
    padding: '1px 6px',
    letterSpacing: '0.5px',
  },
  currentLabel: {
    fontSize: 12,
    color: 'var(--text-secondary, #a6adc8)',
  },
  transitionSection: {
    padding: '8px 12px',
    borderBottom: '1px solid var(--border-color, #313244)',
    flexShrink: 0,
  },
  transitionLabel: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    color: 'var(--text-secondary, #a6adc8)',
    marginBottom: 6,
    letterSpacing: '0.5px',
  },
  transitionButtons: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  transitionBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    padding: '6px 10px',
    border: '1px solid var(--accent-color, #cba6f7)',
    borderRadius: 4,
    background: 'transparent',
    color: 'var(--accent-color, #cba6f7)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 500,
    transition: 'background 0.15s',
  },
  transitionArrow: {
    fontSize: 10,
    opacity: 0.7,
    fontWeight: 400,
  },
  transitionError: {
    fontSize: 11,
    color: '#f38ba8',
    marginTop: 4,
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid var(--border-color, #313244)',
    flexShrink: 0,
  },
  tab: {
    flex: 1,
    padding: '6px 8px',
    border: 'none',
    borderBottom: '2px solid transparent',
    background: 'transparent',
    color: 'var(--text-secondary, #a6adc8)',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 500,
    textAlign: 'center',
  },
  tabActive: {
    color: 'var(--text-primary, #cdd6f4)',
    borderBottomColor: 'var(--accent-color, #cba6f7)',
  },
  tabContent: {
    flex: 1,
    overflow: 'auto',
    minHeight: 0,
  },
  stateList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    padding: 4,
  },
  stateItem: {
    padding: '6px 8px',
    borderRadius: 4,
    border: '1px solid transparent',
  },
  stateItemCurrent: {
    border: '1px solid var(--accent-color, #cba6f7)',
    background: 'rgba(203, 166, 247, 0.08)',
    boxShadow: '0 0 8px rgba(203, 166, 247, 0.15)',
  },
  stateHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  stateTypeBadge: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase',
    border: '1px solid',
    borderRadius: 3,
    padding: '0 4px',
    letterSpacing: '0.3px',
  },
  stateName: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-primary, #cdd6f4)',
  },
  currentBadge: {
    fontSize: 8,
    fontWeight: 700,
    color: '#cba6f7',
    background: 'rgba(203, 166, 247, 0.15)',
    borderRadius: 3,
    padding: '1px 4px',
    marginLeft: 'auto',
    letterSpacing: '0.5px',
  },
  stateDescription: {
    fontSize: 11,
    color: 'var(--text-secondary, #a6adc8)',
    marginTop: 3,
    paddingLeft: 2,
  },
  stateTransitions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  transitionChip: {
    fontSize: 9,
    color: 'var(--text-secondary, #a6adc8)',
    background: 'var(--surface-1, #313244)',
    borderRadius: 3,
    padding: '1px 5px',
  },
  timeline: {
    padding: '4px 8px',
  },
  timelineEntry: {
    display: 'flex',
    gap: 8,
    paddingBottom: 10,
    position: 'relative',
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'var(--accent-color, #cba6f7)',
    flexShrink: 0,
    marginTop: 3,
  },
  timelineContent: {
    flex: 1,
    minWidth: 0,
  },
  timelineHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  timelineTime: {
    fontSize: 10,
    color: 'var(--text-secondary, #a6adc8)',
    fontFamily: 'monospace',
  },
  timelineTransition: {
    fontSize: 10,
    color: '#89b4fa',
    fontStyle: 'italic',
  },
  timelineStates: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 11,
    color: 'var(--text-primary, #cdd6f4)',
  },
  timelineStateName: {
    fontWeight: 400,
  },
  timelineArrow: {
    color: 'var(--text-secondary, #a6adc8)',
    fontSize: 10,
  },
  timelineDetails: {
    fontSize: 10,
    color: 'var(--text-secondary, #a6adc8)',
    marginTop: 2,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  variablesSection: {
    padding: 4,
  },
  varGroup: {
    marginBottom: 8,
  },
  varGroupLabel: {
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    color: 'var(--text-secondary, #a6adc8)',
    padding: '4px 8px',
    letterSpacing: '0.5px',
  },
  varRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
    padding: '3px 8px',
    borderRadius: 3,
  },
  varKey: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#cba6f7',
    flexShrink: 0,
  },
  varValue: {
    fontSize: 11,
    fontFamily: 'monospace',
    color: 'var(--text-primary, #cdd6f4)',
    textAlign: 'right',
    wordBreak: 'break-all',
  },
};
