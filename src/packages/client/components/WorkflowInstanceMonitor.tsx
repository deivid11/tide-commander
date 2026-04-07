/**
 * Workflow Instance Monitor
 *
 * Debugging interface for viewing workflow instances with:
 * - Instance list with status filtering
 * - Timeline of steps/transitions with timestamps
 * - Agent reasoning and summary display per step
 * - Variable inspection (wi_* debug view)
 * - Real-time updates via store subscription
 */

import React, { useState, useMemo, useSyncExternalStore } from 'react';
import { store } from '../store';
import type { WorkflowDefinition, WorkflowHistoryEntry, WorkflowInstanceStatus } from '../../shared/workflow-types';
import type { WorkflowInstanceRow, WorkflowStoreState } from '../store/workflows';
import type { StoreState } from '../store/types';

// ─── Store Hook ───

// Memoized snapshot to prevent infinite re-renders.
// useSyncExternalStore compares by reference (Object.is), so getSnapshot
// must return the same object when the underlying data hasn't changed.
let _cachedSnap: { definitions: Map<string, WorkflowDefinition>; instances: Map<string, WorkflowInstanceRow> } | null = null;
let _prevDefs: Map<string, WorkflowDefinition> | undefined;
let _prevInsts: Map<string, WorkflowInstanceRow> | undefined;

function getWorkflowSnapshot() {
  const s = store.getState() as StoreState & WorkflowStoreState;
  const defs = s.workflowDefinitions ?? new Map<string, WorkflowDefinition>();
  const insts = s.workflowInstances ?? new Map<string, WorkflowInstanceRow>();
  if (_cachedSnap && _prevDefs === defs && _prevInsts === insts) {
    return _cachedSnap;
  }
  _prevDefs = defs;
  _prevInsts = insts;
  _cachedSnap = { definitions: defs, instances: insts };
  return _cachedSnap;
}

function useWorkflowStore() {
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    getWorkflowSnapshot,
    getWorkflowSnapshot
  );
}

// ─── Types ───

type StatusFilter = 'all' | WorkflowInstanceStatus;

interface WorkflowInstanceMonitorProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Status Colors ───

const STATUS_COLORS: Record<string, string> = {
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

// ─── Main Component ───

export function WorkflowInstanceMonitor({ isOpen, onClose }: WorkflowInstanceMonitorProps) {
  const { definitions, instances } = useWorkflowStore();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [defFilter, setDefFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expandedInstanceId, setExpandedInstanceId] = useState<string | null>(null);
  const [expandedStepIdx, setExpandedStepIdx] = useState<number | null>(null);
  const [debugInstanceId, setDebugInstanceId] = useState<string | null>(null);

  const allInstances = useMemo(() => Array.from(instances.values()), [instances]);
  const allDefs = useMemo(() => Array.from(definitions.values()), [definitions]);

  const filtered = useMemo(() => {
    return allInstances
      .filter((inst) => {
        if (statusFilter !== 'all' && inst.status !== statusFilter) return false;
        if (defFilter !== 'all' && inst.workflowDefId !== defFilter) return false;
        if (search) {
          const s = search.toLowerCase();
          const match =
            inst.workflowName.toLowerCase().includes(s) ||
            inst.id.toLowerCase().includes(s) ||
            inst.currentStateId.toLowerCase().includes(s) ||
            JSON.stringify(inst.variables).toLowerCase().includes(s);
          if (!match) return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [allInstances, statusFilter, defFilter, search]);

  if (!isOpen) return null;

  const expandedInstance = expandedInstanceId ? instances.get(expandedInstanceId) : null;
  const expandedDef = expandedInstance ? definitions.get(expandedInstance.workflowDefId) : null;
  const debugInstance = debugInstanceId ? instances.get(debugInstanceId) : null;

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={S.header}>
          <div style={S.headerTitle}>
            <span>Workflow Instance Monitor</span>
            <span style={{ fontSize: 11, color: '#6c7086', fontWeight: 400 }}>
              {allInstances.length} instance{allInstances.length !== 1 ? 's' : ''}
            </span>
          </div>
          <button style={S.closeBtn} onClick={onClose} title="Close">&times;</button>
        </div>

        {/* Filters */}
        <div style={S.filters}>
          <select
            style={S.select}
            value={defFilter}
            onChange={(e) => setDefFilter(e.target.value)}
          >
            <option value="all">All Workflows</option>
            {allDefs.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'running', 'paused', 'completed', 'failed', 'cancelled'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                style={{
                  ...S.filterBtn,
                  background: statusFilter === s
                    ? (s === 'all' ? '#89b4fa' : STATUS_COLORS[s] || '#89b4fa')
                    : 'transparent',
                  color: statusFilter === s ? '#1e1e2e' : '#a6adc8',
                  borderColor: statusFilter === s ? 'transparent' : '#45475a',
                }}
                onClick={() => setStatusFilter(s)}
              >
                {s}
              </button>
            ))}
          </div>

          <input
            style={S.searchInput}
            placeholder="Search instances..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Content */}
        <div style={S.content}>
          {debugInstance ? (
            <DebugView
              instance={debugInstance}
              definition={definitions.get(debugInstance.workflowDefId)}
              onBack={() => setDebugInstanceId(null)}
            />
          ) : expandedInstance ? (
            <InstanceTimeline
              instance={expandedInstance}
              definition={expandedDef ?? null}
              expandedStepIdx={expandedStepIdx}
              onToggleStep={(idx) => setExpandedStepIdx(expandedStepIdx === idx ? null : idx)}
              onBack={() => { setExpandedInstanceId(null); setExpandedStepIdx(null); }}
              onDebug={() => setDebugInstanceId(expandedInstance.id)}
            />
          ) : (
            <InstanceList
              instances={filtered}
              definitions={definitions}
              onSelect={(id) => setExpandedInstanceId(id)}
              onDebug={(id) => setDebugInstanceId(id)}
            />
          )}
        </div>

        {/* Footer */}
        <div style={S.footer}>
          <span style={{ color: '#6c7086', fontSize: 11 }}>
            {filtered.length} of {allInstances.length} instance{allInstances.length !== 1 ? 's' : ''}
            {(statusFilter !== 'all' || defFilter !== 'all' || search) && ' (filtered)'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Instance List ───

function InstanceList({
  instances,
  definitions,
  onSelect,
  onDebug,
}: {
  instances: WorkflowInstanceRow[];
  definitions: Map<string, WorkflowDefinition>;
  onSelect: (id: string) => void;
  onDebug: (id: string) => void;
}) {
  if (instances.length === 0) {
    return (
      <div style={{ color: '#6c7086', textAlign: 'center', padding: 40 }}>
        No workflow instances found.
      </div>
    );
  }

  return (
    <>
      {instances.map((inst) => {
        const def = definitions.get(inst.workflowDefId);
        const statusColor = STATUS_COLORS[inst.status] || '#6c7086';
        const currentState = def?.states.find(s => s.id === inst.currentStateId);
        const stateTypeColor = currentState ? STATE_TYPE_COLORS[currentState.type] || '#6c7086' : '#6c7086';

        return (
          <div
            key={inst.id}
            style={S.instanceRow}
            onClick={() => onSelect(inst.id)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
              <span style={{ ...S.statusDot, background: statusColor }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: '#cdd6f4', fontSize: 13, fontWeight: 500 }}>
                    {inst.workflowName}
                  </span>
                  <span style={{ ...S.tag, background: `${statusColor}22`, color: statusColor }}>
                    {inst.status}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <span style={{ color: '#6c7086', fontSize: 10, fontFamily: 'monospace' }}>
                    {inst.id.slice(0, 8)}
                  </span>
                  {currentState && (
                    <span style={{ color: stateTypeColor, fontSize: 10 }}>
                      @ {currentState.name}
                    </span>
                  )}
                  <span style={{ color: '#45475a', fontSize: 10 }}>
                    {(inst.history?.length ?? 0)} step{(inst.history?.length ?? 0) !== 1 ? 's' : ''}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#6c7086', fontSize: 10, whiteSpace: 'nowrap' }}>
                {formatTime(inst.updatedAt)}
              </span>
              <button
                style={S.debugBtn}
                onClick={(e) => { e.stopPropagation(); onDebug(inst.id); }}
                title="Debug view"
              >
                {'{..}'}
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

// ─── Instance Timeline ───

function InstanceTimeline({
  instance,
  definition,
  expandedStepIdx,
  onToggleStep,
  onBack,
  onDebug,
}: {
  instance: WorkflowInstanceRow;
  definition: WorkflowDefinition | null;
  expandedStepIdx: number | null;
  onToggleStep: (idx: number) => void;
  onBack: () => void;
  onDebug: () => void;
}) {
  const statusColor = STATUS_COLORS[instance.status] || '#6c7086';

  return (
    <div style={{ padding: '0 4px' }}>
      {/* Breadcrumb */}
      <div style={S.breadcrumb}>
        <button style={S.breadcrumbBtn} onClick={onBack}>Instances</button>
        <span style={{ color: '#45475a' }}>/</span>
        <span style={{ color: '#cdd6f4', fontSize: 12 }}>{instance.workflowName}</span>
        <span style={{ color: '#6c7086', fontSize: 10, fontFamily: 'monospace' }}>
          ({instance.id.slice(0, 8)})
        </span>
        <span style={{ ...S.tag, background: `${statusColor}22`, color: statusColor, marginLeft: 4 }}>
          {instance.status}
        </span>
        <div style={{ flex: 1 }} />
        <button style={S.debugBtn} onClick={onDebug} title="Debug view">{'{..}'}</button>
      </div>

      {/* Instance Info */}
      <div style={S.infoBar}>
        <span>Created: {formatTimeFull(instance.createdAt)}</span>
        <span>Updated: {formatTimeFull(instance.updatedAt)}</span>
        {instance.completedAt && <span>Completed: {formatTimeFull(instance.completedAt)}</span>}
        {instance.error && <span style={{ color: '#f38ba8' }}>Error: {instance.error}</span>}
      </div>

      {/* Timeline */}
      <div style={{ marginTop: 12 }}>
        <div style={{ color: '#a6adc8', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
          Timeline ({instance.history.length} step{instance.history.length !== 1 ? 's' : ''})
        </div>

        {instance.history.length === 0 && (
          <div style={{ color: '#6c7086', fontSize: 12, padding: 16 }}>No steps recorded yet.</div>
        )}

        {instance.history.map((entry, idx) => {
          const state = definition?.states.find(s => s.id === entry.toStateId);
          const isExpanded = expandedStepIdx === idx;
          const stateColor = state ? STATE_TYPE_COLORS[state.type] || '#6c7086' : '#6c7086';

          return (
            <div
              key={idx}
              style={{
                ...S.timelineEntry,
                borderLeftColor: stateColor,
                background: isExpanded ? 'rgba(137,180,250,0.05)' : 'transparent',
              }}
              onClick={() => onToggleStep(idx)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ ...S.timelineDot, background: stateColor }} />
                <span style={{ color: '#cdd6f4', fontSize: 12, fontWeight: 500 }}>
                  {state?.name || entry.toStateId}
                </span>
                {state && (
                  <span style={{ ...S.tag, background: `${stateColor}22`, color: stateColor }}>
                    {state.type}
                  </span>
                )}
                {entry.transitionName && (
                  <span style={{ color: '#6c7086', fontSize: 10 }}>
                    via "{entry.transitionName}"
                  </span>
                )}
                <div style={{ flex: 1 }} />
                <span style={{ color: '#6c7086', fontSize: 10, whiteSpace: 'nowrap' }}>
                  {formatTimeFull(entry.timestamp)}
                </span>
              </div>

              {isExpanded && (
                <StepDetailPanel entry={entry} state={state ?? null} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Step Detail (Reasoning / Summary) ───

function StepDetailPanel({
  entry,
  state,
}: {
  entry: WorkflowHistoryEntry;
  state: import('../../shared/workflow-types').WorkflowState | null;
}) {
  return (
    <div style={{ marginTop: 8, paddingLeft: 20 }}>
      {/* Transition details */}
      {entry.fromStateId && (
        <div style={S.detailRow}>
          <span style={S.detailLabel}>From:</span>
          <span style={S.detailValue}>{entry.fromStateId}</span>
        </div>
      )}
      <div style={S.detailRow}>
        <span style={S.detailLabel}>To:</span>
        <span style={S.detailValue}>{entry.toStateId}</span>
      </div>

      {/* Agent reasoning (stored in details field) */}
      {entry.details && (
        <div style={{ marginTop: 6 }}>
          <div style={{ ...S.detailLabel, marginBottom: 4 }}>Agent Reasoning / Summary:</div>
          <div style={S.reasoningBlock}>
            {entry.details}
          </div>
        </div>
      )}

      {/* State description */}
      {state?.description && (
        <div style={{ marginTop: 6 }}>
          <div style={{ ...S.detailLabel, marginBottom: 4 }}>State Description:</div>
          <div style={{ color: '#a6adc8', fontSize: 11 }}>{state.description}</div>
        </div>
      )}

      {/* Action info */}
      {state?.action && (
        <div style={{ marginTop: 6 }}>
          <div style={{ ...S.detailLabel, marginBottom: 4 }}>Action ({state.action.type}):</div>
          <pre style={S.codeBlock}>
            {JSON.stringify(state.action, null, 2)}
          </pre>
        </div>
      )}

      {/* Variable snapshot at this step */}
      {entry.variables && Object.keys(entry.variables).length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ ...S.detailLabel, marginBottom: 4 }}>Variables at this step:</div>
          <pre style={S.codeBlock}>
            {JSON.stringify(entry.variables, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Debug View (Variables / State) ───

function DebugView({
  instance,
  definition,
  onBack,
}: {
  instance: WorkflowInstanceRow;
  definition: WorkflowDefinition | undefined;
  onBack: () => void;
}) {
  const statusColor = STATUS_COLORS[instance.status] || '#6c7086';
  const currentState = definition?.states.find(s => s.id === instance.currentStateId);

  // Separate wi_ (workflow internal) variables from user variables
  const wiVars: Record<string, unknown> = {};
  const userVars: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(instance.variables)) {
    if (key.startsWith('wi_')) {
      wiVars[key] = val;
    } else {
      userVars[key] = val;
    }
  }

  return (
    <div style={{ padding: '0 4px' }}>
      {/* Breadcrumb */}
      <div style={S.breadcrumb}>
        <button style={S.breadcrumbBtn} onClick={onBack}>Back</button>
        <span style={{ color: '#45475a' }}>/</span>
        <span style={{ color: '#cdd6f4', fontSize: 12 }}>Debug: {instance.workflowName}</span>
        <span style={{ color: '#6c7086', fontSize: 10, fontFamily: 'monospace' }}>
          ({instance.id.slice(0, 8)})
        </span>
      </div>

      {/* Instance State */}
      <div style={S.section}>
        <h3 style={S.sectionTitle}>Instance State</h3>
        <div style={S.debugGrid}>
          <DebugField label="ID" value={instance.id} />
          <DebugField label="Workflow" value={instance.workflowName} />
          <DebugField label="Def ID" value={instance.workflowDefId} />
          <DebugField label="Status" value={instance.status} color={statusColor} />
          <DebugField label="Current State" value={currentState?.name || instance.currentStateId} />
          <DebugField label="State Type" value={currentState?.type || 'unknown'} />
          <DebugField label="Created" value={formatTimeFull(instance.createdAt)} />
          <DebugField label="Updated" value={formatTimeFull(instance.updatedAt)} />
          {instance.completedAt && <DebugField label="Completed" value={formatTimeFull(instance.completedAt)} />}
          {instance.error && <DebugField label="Error" value={instance.error} color="#f38ba8" />}
          <DebugField label="History Steps" value={String(instance.history.length)} />
        </div>
      </div>

      {/* User Variables */}
      <div style={S.section}>
        <h3 style={S.sectionTitle}>User Variables ({Object.keys(userVars).length})</h3>
        {Object.keys(userVars).length === 0 ? (
          <div style={{ color: '#6c7086', fontSize: 12 }}>No user variables set.</div>
        ) : (
          <pre style={S.codeBlock}>{JSON.stringify(userVars, null, 2)}</pre>
        )}
      </div>

      {/* Internal wi_ Variables */}
      <div style={S.section}>
        <h3 style={S.sectionTitle}>Internal Variables (wi_*) ({Object.keys(wiVars).length})</h3>
        {Object.keys(wiVars).length === 0 ? (
          <div style={{ color: '#6c7086', fontSize: 12 }}>No internal variables set.</div>
        ) : (
          <pre style={S.codeBlock}>{JSON.stringify(wiVars, null, 2)}</pre>
        )}
      </div>

      {/* Available Transitions */}
      {currentState && currentState.transitions.length > 0 && (
        <div style={S.section}>
          <h3 style={S.sectionTitle}>Available Transitions</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {currentState.transitions.map((t) => {
              const targetState = definition?.states.find(s => s.id === t.targetStateId);
              return (
                <div key={t.id} style={S.transitionRow}>
                  <span style={{ color: '#cdd6f4', fontSize: 12 }}>{t.name}</span>
                  <span style={{ color: '#6c7086', fontSize: 10 }}>
                    {t.condition.type} &rarr; {targetState?.name || t.targetStateId}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Raw JSON */}
      <div style={S.section}>
        <h3 style={S.sectionTitle}>Raw Instance JSON</h3>
        <pre style={{ ...S.codeBlock, maxHeight: 400 }}>
          {JSON.stringify(instance, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function DebugField({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={S.debugField}>
      <span style={{ color: '#6c7086', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </span>
      <span style={{ color: color || '#cdd6f4', fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }}>
        {value}
      </span>
    </div>
  );
}

// ─── Helpers ───

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatTimeFull(ts: number): string {
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
    gap: 12,
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
  filters: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    padding: '10px 20px',
    borderBottom: '1px solid var(--border, #313244)',
    flexWrap: 'wrap' as const,
  },
  select: {
    background: '#313244',
    border: '1px solid #45475a',
    borderRadius: 6,
    padding: '5px 10px',
    color: '#cdd6f4',
    fontSize: 12,
    outline: 'none',
  } as React.CSSProperties,
  filterBtn: {
    border: '1px solid #45475a',
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer',
    textTransform: 'capitalize' as const,
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
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '0 20px',
  } as React.CSSProperties,
  footer: {
    padding: '8px 20px',
    borderTop: '1px solid #313244',
  } as React.CSSProperties,

  // Instance list
  instanceRow: {
    padding: '10px 12px',
    borderBottom: '1px solid #313244',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    transition: 'background 0.1s',
  } as React.CSSProperties,
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  } as React.CSSProperties,
  tag: {
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: 4,
    whiteSpace: 'nowrap' as const,
  } as React.CSSProperties,
  debugBtn: {
    background: 'transparent',
    border: '1px solid #45475a',
    borderRadius: 4,
    padding: '3px 6px',
    color: '#6c7086',
    fontSize: 10,
    fontFamily: 'monospace',
    cursor: 'pointer',
    flexShrink: 0,
  } as React.CSSProperties,

  // Timeline
  breadcrumb: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 0',
    borderBottom: '1px solid #313244',
  } as React.CSSProperties,
  breadcrumbBtn: {
    background: 'none',
    border: 'none',
    color: '#89b4fa',
    fontSize: 12,
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
  } as React.CSSProperties,
  infoBar: {
    display: 'flex',
    gap: 16,
    padding: '8px 0',
    color: '#6c7086',
    fontSize: 11,
    flexWrap: 'wrap' as const,
  } as React.CSSProperties,
  timelineEntry: {
    padding: '10px 12px',
    borderLeft: '3px solid #6c7086',
    borderBottom: '1px solid #313244',
    cursor: 'pointer',
    transition: 'background 0.1s',
    marginLeft: 8,
  } as React.CSSProperties,
  timelineDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  } as React.CSSProperties,

  // Step detail
  detailRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    marginBottom: 2,
  } as React.CSSProperties,
  detailLabel: {
    color: '#6c7086',
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  } as React.CSSProperties,
  detailValue: {
    color: '#a6adc8',
    fontSize: 11,
    fontFamily: 'monospace',
  } as React.CSSProperties,
  reasoningBlock: {
    padding: 10,
    background: '#181825',
    borderRadius: 6,
    border: '1px solid #313244',
    fontSize: 12,
    color: '#cdd6f4',
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  } as React.CSSProperties,
  codeBlock: {
    padding: 10,
    background: '#181825',
    borderRadius: 6,
    fontSize: 11,
    fontFamily: 'monospace',
    color: '#a6adc8',
    overflow: 'auto',
    maxHeight: 200,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-all' as const,
    border: '1px solid #313244',
    margin: 0,
  } as React.CSSProperties,

  // Debug view
  section: {
    marginBottom: 20,
    marginTop: 12,
  } as React.CSSProperties,
  sectionTitle: {
    color: '#a6adc8',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 8,
    margin: '0 0 8px 0',
  } as React.CSSProperties,
  debugGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: 8,
  } as React.CSSProperties,
  debugField: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    padding: '8px 10px',
    background: '#313244',
    borderRadius: 6,
  } as React.CSSProperties,
  transitionRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 10px',
    background: '#313244',
    borderRadius: 4,
  } as React.CSSProperties,
};
