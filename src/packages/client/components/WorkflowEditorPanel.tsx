/**
 * WorkflowEditorPanel
 * Visual state machine editor with drag-drop states, draw transitions,
 * configure actions, conditions, and variables.
 *
 * Supports state types: action (agent_task), decision, wait, end.
 * Editor canvas renders states as nodes and transitions as arrows.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiUrl, authFetch } from '../utils/storage';
import { useAgents } from '../store';
import type {
  WorkflowDefinition, WorkflowState, WorkflowTransition,
  WorkflowAction, WorkflowCondition, WorkflowStateType,
  WorkflowVariableSchema, WorkflowVariableType,
  CreateWorkflowPayload,
  CC_WORKFLOW_STATES as CC_STATES_TYPE,
} from '../../shared/workflow-types';
import { CC_WORKFLOW_STATES, CC_WORKFLOW_VARIABLES } from '../../shared/workflow-types';

// ─── Constants ───

const STATE_W = 200;
const STATE_H = 60;
const GRID_SNAP = 20;
const STATE_TYPE_COLORS: Record<WorkflowStateType, string> = {
  action: '#89b4fa',
  decision: '#f9e2af',
  wait: '#cba6f7',
  end: '#a6e3a1',
};
const STATE_TYPE_LABELS: Record<WorkflowStateType, string> = {
  action: 'Action',
  decision: 'Decision',
  wait: 'Wait',
  end: 'End',
};
const CONDITION_LABELS: Record<string, string> = {
  agent_complete: 'Agent Complete',
  trigger_fired: 'Trigger Fired',
  variable_check: 'Variable Check',
  timeout: 'Timeout',
  manual: 'Manual',
  cron: 'Cron',
};

interface WorkflowEditorPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Main Component ───

export function WorkflowEditorPanel({ isOpen, onClose }: WorkflowEditorPanelProps) {
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowDefinition | null>(null);
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await authFetch(apiUrl('/api/workflows/definitions'));
      if (resp.ok) {
        setWorkflows(await resp.json());
      }
    } catch {
      setError('Failed to load workflows');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) fetchWorkflows();
  }, [isOpen, fetchWorkflows]);

  const handleCreate = () => {
    const newWorkflow: WorkflowDefinition = {
      id: `wf-${Date.now()}`,
      name: 'New Workflow',
      description: '',
      version: 1,
      variables: [],
      states: [
        { id: 'start', name: 'Start', type: 'action', transitions: [], position: { x: 300, y: 60 } },
        { id: 'end', name: 'End', type: 'end', transitions: [], position: { x: 300, y: 260 } },
      ],
      initialStateId: 'start',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setActiveWorkflow(newWorkflow);
    setView('editor');
  };

  const handleLoadCCTemplate = () => {
    const ccWorkflow: WorkflowDefinition = {
      id: `wf-cc-${Date.now()}`,
      name: 'CC (Control de Cambios)',
      description: 'Full CC process: intake, Jira ticket, document, approval, release',
      version: 1,
      variables: [...CC_WORKFLOW_VARIABLES],
      states: CC_WORKFLOW_STATES.map((s) => ({ ...s, transitions: [...s.transitions] })),
      initialStateId: 'intake',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setActiveWorkflow(ccWorkflow);
    setView('editor');
  };

  const handleSave = async (workflow: WorkflowDefinition) => {
    try {
      const existing = workflows.find((w) => w.id === workflow.id);
      if (existing) {
        await authFetch(apiUrl(`/api/workflows/definitions/${workflow.id}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(workflow),
        });
      } else {
        await authFetch(apiUrl('/api/workflows/definitions'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(workflow),
        });
      }
      await fetchWorkflows();
    } catch {
      setError('Failed to save workflow');
    }
  };

  if (!isOpen) return null;

  return (
    <div style={styles.overlay}>
      <div style={styles.panel}>
        <div style={styles.header}>
          <h2 style={styles.title}>
            {view === 'list' ? 'Workflow Definitions' : activeWorkflow?.name || 'Editor'}
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {view === 'editor' && (
              <button style={styles.btnSecondary} onClick={() => setView('list')}>
                Back to List
              </button>
            )}
            <button style={styles.btnClose} onClick={onClose}>Close</button>
          </div>
        </div>

        {view === 'list' && (
          <WorkflowList
            workflows={workflows}
            loading={loading}
            error={error}
            onSelect={(wf) => { setActiveWorkflow(wf); setView('editor'); }}
            onCreate={handleCreate}
            onLoadCC={handleLoadCCTemplate}
          />
        )}

        {view === 'editor' && activeWorkflow && (
          <WorkflowEditor
            workflow={activeWorkflow}
            onChange={setActiveWorkflow}
            onSave={handleSave}
          />
        )}
      </div>
    </div>
  );
}

// ─── Workflow List ───

function WorkflowList({
  workflows, loading, error, onSelect, onCreate, onLoadCC,
}: {
  workflows: WorkflowDefinition[];
  loading: boolean;
  error: string | null;
  onSelect: (wf: WorkflowDefinition) => void;
  onCreate: () => void;
  onLoadCC: () => void;
}) {
  return (
    <div style={styles.content}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button style={styles.btnPrimary} onClick={onCreate}>New Workflow</button>
        <button style={styles.btnSecondary} onClick={onLoadCC}>Load CC Template</button>
      </div>

      {loading && <div style={{ color: '#a6adc8' }}>Loading...</div>}
      {error && <div style={{ color: '#f38ba8' }}>{error}</div>}

      {workflows.map((wf) => (
        <div key={wf.id} style={styles.card} onClick={() => onSelect(wf)}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#cdd6f4', fontWeight: 600, fontSize: 14 }}>{wf.name}</span>
            <span style={{ color: '#a6adc8', fontSize: 11 }}>v{wf.version} | {wf.states.length} states</span>
          </div>
          {wf.description && <div style={{ color: '#a6adc8', fontSize: 12, marginTop: 4 }}>{wf.description}</div>}
        </div>
      ))}

      {!loading && workflows.length === 0 && (
        <div style={{ color: '#6c7086', textAlign: 'center', padding: 40 }}>
          No workflows yet. Create one or load the CC template.
        </div>
      )}
    </div>
  );
}

// ─── Workflow Editor ───

function WorkflowEditor({
  workflow, onChange, onSave,
}: {
  workflow: WorkflowDefinition;
  onChange: (wf: WorkflowDefinition) => void;
  onSave: (wf: WorkflowDefinition) => Promise<void>;
}) {
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [selectedTransitionId, setSelectedTransitionId] = useState<string | null>(null);
  const [sidePanel, setSidePanel] = useState<'none' | 'state' | 'transition' | 'variables' | 'settings'>('none');
  const [drawingFrom, setDrawingFrom] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [canvasOffset, setCanvasOffset] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLDivElement>(null);
  const agentsMap = useAgents();
  const agents = useMemo(() => Array.from(agentsMap.values()).map((a) => ({ id: a.id, name: a.name })), [agentsMap]);

  const selectedState = workflow.states.find((s) => s.id === selectedStateId);

  // Find transition by ID across all states
  const findTransition = useCallback((): { state: WorkflowState; transition: WorkflowTransition } | null => {
    for (const s of workflow.states) {
      const t = s.transitions.find((tr) => tr.id === selectedTransitionId);
      if (t) return { state: s, transition: t };
    }
    return null;
  }, [workflow, selectedTransitionId]);

  const updateStates = (newStates: WorkflowState[]) => {
    onChange({ ...workflow, states: newStates, updatedAt: Date.now() });
  };

  const updateState = (stateId: string, updates: Partial<WorkflowState>) => {
    updateStates(workflow.states.map((s) => (s.id === stateId ? { ...s, ...updates } : s)));
  };

  // ─── State CRUD ───

  const addState = (type: WorkflowStateType) => {
    const id = `state-${Date.now()}`;
    const newState: WorkflowState = {
      id,
      name: `New ${STATE_TYPE_LABELS[type]}`,
      type,
      transitions: [],
      position: { x: 300, y: (workflow.states.length) * 100 + 60 },
    };
    updateStates([...workflow.states, newState]);
    setSelectedStateId(id);
    setSidePanel('state');
  };

  const deleteState = (stateId: string) => {
    // Remove state and any transitions pointing to it
    const newStates = workflow.states
      .filter((s) => s.id !== stateId)
      .map((s) => ({
        ...s,
        transitions: s.transitions.filter((t) => t.targetStateId !== stateId),
      }));
    updateStates(newStates);
    setSelectedStateId(null);
    setSidePanel('none');
  };

  // ─── Transition CRUD ───

  const addTransition = (fromStateId: string, toStateId: string) => {
    const id = `t-${Date.now()}`;
    updateStates(workflow.states.map((s) => {
      if (s.id !== fromStateId) return s;
      return {
        ...s,
        transitions: [
          ...s.transitions,
          { id, name: 'New Transition', targetStateId: toStateId, condition: { type: 'agent_complete' as const } },
        ],
      };
    }));
    setSelectedTransitionId(id);
    setSidePanel('transition');
  };

  const updateTransition = (stateId: string, transitionId: string, updates: Partial<WorkflowTransition>) => {
    updateStates(workflow.states.map((s) => {
      if (s.id !== stateId) return s;
      return {
        ...s,
        transitions: s.transitions.map((t) => (t.id === transitionId ? { ...t, ...updates } : t)),
      };
    }));
  };

  const deleteTransition = (stateId: string, transitionId: string) => {
    updateStates(workflow.states.map((s) => {
      if (s.id !== stateId) return s;
      return { ...s, transitions: s.transitions.filter((t) => t.id !== transitionId) };
    }));
    setSelectedTransitionId(null);
    setSidePanel('none');
  };

  // ─── Drag ───

  const handleStateDrag = (stateId: string, dx: number, dy: number) => {
    updateStates(workflow.states.map((s) => {
      if (s.id !== stateId) return s;
      const pos = s.position || { x: 0, y: 0 };
      return {
        ...s,
        position: {
          x: Math.round((pos.x + dx) / GRID_SNAP) * GRID_SNAP,
          y: Math.round((pos.y + dy) / GRID_SNAP) * GRID_SNAP,
        },
      };
    }));
  };

  // ─── Canvas click to create transition ───

  const handleCanvasStateClick = (stateId: string) => {
    if (drawingFrom) {
      if (drawingFrom !== stateId) {
        addTransition(drawingFrom, stateId);
      }
      setDrawingFrom(null);
    } else {
      setSelectedStateId(stateId);
      setSelectedTransitionId(null);
      setSidePanel('state');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(workflow);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#a6adc8', fontSize: 10, textTransform: 'uppercase', marginBottom: 6, letterSpacing: 1 }}>Add State</div>
          {(['action', 'decision', 'wait', 'end'] as WorkflowStateType[]).map((type) => (
            <button
              key={type}
              style={{ ...styles.toolBtn, borderLeft: `3px solid ${STATE_TYPE_COLORS[type]}` }}
              onClick={() => addState(type)}
            >
              {STATE_TYPE_LABELS[type]}
            </button>
          ))}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#a6adc8', fontSize: 10, textTransform: 'uppercase', marginBottom: 6, letterSpacing: 1 }}>Tools</div>
          <button
            style={{ ...styles.toolBtn, background: drawingFrom ? '#45475a' : 'transparent' }}
            onClick={() => setDrawingFrom(drawingFrom ? null : (selectedStateId || null))}
            title="Click a source state, then click a target state"
          >
            {drawingFrom ? 'Drawing... (click target)' : 'Draw Transition'}
          </button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ color: '#a6adc8', fontSize: 10, textTransform: 'uppercase', marginBottom: 6, letterSpacing: 1 }}>Panels</div>
          <button style={styles.toolBtn} onClick={() => setSidePanel(sidePanel === 'variables' ? 'none' : 'variables')}>
            Variables ({workflow.variables.length})
          </button>
          <button style={styles.toolBtn} onClick={() => setSidePanel(sidePanel === 'settings' ? 'none' : 'settings')}>
            Settings
          </button>
        </div>

        <div style={{ marginTop: 'auto' }}>
          <button style={styles.btnPrimary} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div style={styles.canvas} ref={canvasRef}>
        <EditorCanvas
          states={workflow.states}
          initialStateId={workflow.initialStateId}
          selectedStateId={selectedStateId}
          drawingFrom={drawingFrom}
          onStateClick={handleCanvasStateClick}
          onStateDrag={handleStateDrag}
          onTransitionClick={(tid) => { setSelectedTransitionId(tid); setSidePanel('transition'); }}
          selectedTransitionId={selectedTransitionId}
        />
      </div>

      {/* Side Panel */}
      {sidePanel !== 'none' && (
        <div style={styles.sidePanel}>
          {sidePanel === 'state' && selectedState && (
            <StateEditor
              state={selectedState}
              agents={agents}
              isInitial={workflow.initialStateId === selectedState.id}
              onUpdate={(updates) => updateState(selectedState.id, updates)}
              onDelete={() => deleteState(selectedState.id)}
              onSetInitial={() => onChange({ ...workflow, initialStateId: selectedState.id })}
              onStartDrawing={() => setDrawingFrom(selectedState.id)}
              onClose={() => setSidePanel('none')}
            />
          )}
          {sidePanel === 'transition' && selectedTransitionId && (() => {
            const found = findTransition();
            if (!found) return null;
            return (
              <TransitionEditor
                transition={found.transition}
                parentState={found.state}
                allStates={workflow.states}
                variables={workflow.variables}
                onUpdate={(updates) => updateTransition(found.state.id, found.transition.id, updates)}
                onDelete={() => deleteTransition(found.state.id, found.transition.id)}
                onClose={() => setSidePanel('none')}
              />
            );
          })()}
          {sidePanel === 'variables' && (
            <VariablesEditor
              variables={workflow.variables}
              onChange={(vars) => onChange({ ...workflow, variables: vars })}
              onClose={() => setSidePanel('none')}
            />
          )}
          {sidePanel === 'settings' && (
            <WorkflowSettings
              workflow={workflow}
              onChange={onChange}
              onClose={() => setSidePanel('none')}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Editor Canvas (SVG + HTML overlay for states) ───

function EditorCanvas({
  states, initialStateId, selectedStateId, drawingFrom,
  onStateClick, onStateDrag, onTransitionClick, selectedTransitionId,
}: {
  states: WorkflowState[];
  initialStateId: string;
  selectedStateId: string | null;
  drawingFrom: string | null;
  onStateClick: (id: string) => void;
  onStateDrag: (id: string, dx: number, dy: number) => void;
  onTransitionClick: (id: string) => void;
  selectedTransitionId: string | null;
}) {
  const dragRef = useRef<{ id: string; startX: number; startY: number } | null>(null);

  const handleMouseDown = (e: React.MouseEvent, stateId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragRef.current = { id: stateId, startX: e.clientX, startY: e.clientY };

    const handleMouseMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        onStateDrag(dragRef.current.id, dx, dy);
        dragRef.current.startX = ev.clientX;
        dragRef.current.startY = ev.clientY;
      }
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Calculate SVG bounds
  const maxX = Math.max(...states.map((s) => (s.position?.x ?? 0) + STATE_W), 600) + 100;
  const maxY = Math.max(...states.map((s) => (s.position?.y ?? 0) + STATE_H), 400) + 100;

  // Get center point for a state
  const cx = (s: WorkflowState) => (s.position?.x ?? 0) + STATE_W / 2;
  const cy = (s: WorkflowState) => (s.position?.y ?? 0) + STATE_H / 2;

  return (
    <div style={{ position: 'relative', width: maxX, height: maxY, minWidth: '100%', minHeight: '100%' }}>
      {/* SVG for transitions (arrows) */}
      <svg style={{ position: 'absolute', top: 0, left: 0, width: maxX, height: maxY, pointerEvents: 'none' }}>
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#6c7086" />
          </marker>
          <marker id="arrow-selected" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#89b4fa" />
          </marker>
        </defs>
        {states.flatMap((fromState) =>
          fromState.transitions.map((t) => {
            const toState = states.find((s) => s.id === t.targetStateId);
            if (!toState) return null;

            const x1 = cx(fromState);
            const y1 = (fromState.position?.y ?? 0) + STATE_H;
            const x2 = cx(toState);
            const y2 = toState.position?.y ?? 0;

            const isSelected = t.id === selectedTransitionId;
            const midY = (y1 + y2) / 2;

            return (
              <g key={t.id} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onClick={() => onTransitionClick(t.id)}>
                <path
                  d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
                  fill="none"
                  stroke={isSelected ? '#89b4fa' : '#6c7086'}
                  strokeWidth={isSelected ? 2.5 : 1.5}
                  markerEnd={`url(#${isSelected ? 'arrow-selected' : 'arrow'})`}
                />
                {/* Label */}
                <text
                  x={(x1 + x2) / 2 + 8}
                  y={midY}
                  fill={isSelected ? '#89b4fa' : '#6c7086'}
                  fontSize={10}
                  dominantBaseline="middle"
                >
                  {t.name}
                </text>
              </g>
            );
          })
        )}
      </svg>

      {/* State nodes */}
      {states.map((state) => {
        const isSelected = state.id === selectedStateId;
        const isInitial = state.id === initialStateId;
        const isDrawTarget = drawingFrom && drawingFrom !== state.id;
        const color = STATE_TYPE_COLORS[state.type];

        return (
          <div
            key={state.id}
            style={{
              position: 'absolute',
              left: state.position?.x ?? 0,
              top: state.position?.y ?? 0,
              width: STATE_W,
              height: STATE_H,
              borderRadius: state.type === 'decision' ? 8 : state.type === 'end' ? 30 : 8,
              background: isSelected ? 'rgba(137,180,250,0.12)' : '#313244',
              border: `2px solid ${isSelected ? '#89b4fa' : isDrawTarget ? '#a6e3a1' : color}`,
              cursor: drawingFrom ? 'crosshair' : 'grab',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              userSelect: 'none',
              boxShadow: isSelected ? '0 0 12px rgba(137,180,250,0.2)' : 'none',
              transition: 'box-shadow 0.15s',
            }}
            onMouseDown={(e) => handleMouseDown(e, state.id)}
            onClick={(e) => { e.stopPropagation(); onStateClick(state.id); }}
          >
            {isInitial && (
              <div style={{ position: 'absolute', top: -8, left: 8, fontSize: 9, color: '#a6e3a1', fontWeight: 600, background: '#1e1e2e', padding: '0 4px', borderRadius: 3 }}>
                START
              </div>
            )}
            <div style={{ color, fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {STATE_TYPE_LABELS[state.type]}
            </div>
            <div style={{ color: '#cdd6f4', fontSize: 12, fontWeight: 600, textAlign: 'center', padding: '0 8px', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: STATE_W - 16 }}>
              {state.name}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── State Editor Side Panel ───

function StateEditor({
  state, agents, isInitial, onUpdate, onDelete, onSetInitial, onStartDrawing, onClose,
}: {
  state: WorkflowState;
  agents: Array<{ id: string; name: string }>;
  isInitial: boolean;
  onUpdate: (updates: Partial<WorkflowState>) => void;
  onDelete: () => void;
  onSetInitial: () => void;
  onStartDrawing: () => void;
  onClose: () => void;
}) {
  const action = state.action;

  const updateAction = (updates: Partial<WorkflowAction>) => {
    onUpdate({ action: { ...action, ...updates } as WorkflowAction });
  };

  return (
    <div>
      <div style={styles.sidePanelHeader}>
        <span style={{ color: STATE_TYPE_COLORS[state.type], fontWeight: 600 }}>
          {STATE_TYPE_LABELS[state.type]} State
        </span>
        <button style={styles.btnClose} onClick={onClose}>x</button>
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.fieldLabel}>Name</label>
        <input
          style={styles.fieldInput}
          value={state.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
        />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.fieldLabel}>Description</label>
        <textarea
          style={{ ...styles.fieldInput, height: 60, resize: 'vertical' }}
          value={state.description || ''}
          onChange={(e) => onUpdate({ description: e.target.value })}
        />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.fieldLabel}>Type</label>
        <select
          style={styles.fieldInput}
          value={state.type}
          onChange={(e) => onUpdate({ type: e.target.value as WorkflowStateType })}
        >
          {Object.entries(STATE_TYPE_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {/* Action configuration */}
      {state.type !== 'end' && (
        <>
          <div style={{ ...styles.fieldLabel, marginTop: 12, marginBottom: 8, fontSize: 11, color: '#a6adc8', textTransform: 'uppercase', letterSpacing: 1 }}>
            Action
          </div>

          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>Action Type</label>
            <select
              style={styles.fieldInput}
              value={action?.type || 'agent_task'}
              onChange={(e) => {
                const type = e.target.value;
                if (type === 'agent_task') onUpdate({ action: { type: 'agent_task', agentId: '', promptTemplate: '', skills: [] } });
                else if (type === 'wait_for_trigger') onUpdate({ action: { type: 'wait_for_trigger', timeoutMs: 3600000 } });
                else if (type === 'set_variables') onUpdate({ action: { type: 'set_variables', assignments: {} } });
                else if (type === 'trigger_setup') onUpdate({ action: { type: 'trigger_setup', triggerConfig: {} } });
              }}
            >
              <option value="agent_task">Agent Task</option>
              <option value="wait_for_trigger">Wait for Trigger</option>
              <option value="set_variables">Set Variables</option>
              <option value="trigger_setup">Trigger Setup</option>
            </select>
          </div>

          {action?.type === 'agent_task' && (
            <>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>Agent</label>
                <select
                  style={styles.fieldInput}
                  value={action.agentId}
                  onChange={(e) => updateAction({ agentId: e.target.value })}
                >
                  <option value="">Select agent...</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>Prompt Template</label>
                <textarea
                  style={{ ...styles.fieldInput, height: 120, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }}
                  value={action.promptTemplate}
                  onChange={(e) => updateAction({ promptTemplate: e.target.value })}
                  placeholder="Use {{variable}} for interpolation"
                />
              </div>
              <div style={styles.fieldGroup}>
                <label style={styles.fieldLabel}>Skills (comma-separated)</label>
                <input
                  style={styles.fieldInput}
                  value={(action.skills || []).join(', ')}
                  onChange={(e) => updateAction({ skills: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                  placeholder="slack-messaging, jira-service-desk"
                />
              </div>
            </>
          )}

          {action?.type === 'wait_for_trigger' && (
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Timeout (ms)</label>
              <input
                type="number"
                style={styles.fieldInput}
                value={action.timeoutMs || ''}
                onChange={(e) => updateAction({ timeoutMs: e.target.value ? Number(e.target.value) : undefined })}
              />
            </div>
          )}

          {action?.type === 'set_variables' && (
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Assignments (JSON)</label>
              <textarea
                style={{ ...styles.fieldInput, height: 80, fontFamily: 'monospace', fontSize: 11 }}
                value={JSON.stringify(action.assignments || {}, null, 2)}
                onChange={(e) => {
                  try { updateAction({ assignments: JSON.parse(e.target.value) }); } catch { /* ignore parse errors while typing */ }
                }}
              />
            </div>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        {!isInitial && <button style={styles.btnSecondary} onClick={onSetInitial}>Set as Start</button>}
        <button style={styles.btnSecondary} onClick={onStartDrawing}>Add Transition From Here</button>
        {state.type !== 'end' && !isInitial && (
          <button style={{ ...styles.btnSecondary, color: '#f38ba8', borderColor: '#f38ba8' }} onClick={onDelete}>Delete</button>
        )}
      </div>
    </div>
  );
}

// ─── Transition Editor ───

function TransitionEditor({
  transition, parentState, allStates, variables, onUpdate, onDelete, onClose,
}: {
  transition: WorkflowTransition;
  parentState: WorkflowState;
  allStates: WorkflowState[];
  variables: WorkflowVariableSchema[];
  onUpdate: (updates: Partial<WorkflowTransition>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const condition = transition.condition;

  return (
    <div>
      <div style={styles.sidePanelHeader}>
        <span style={{ color: '#89b4fa', fontWeight: 600 }}>Transition</span>
        <button style={styles.btnClose} onClick={onClose}>x</button>
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.fieldLabel}>Name</label>
        <input style={styles.fieldInput} value={transition.name} onChange={(e) => onUpdate({ name: e.target.value })} />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.fieldLabel}>From</label>
        <div style={{ color: '#cdd6f4', fontSize: 12, padding: '6px 0' }}>{parentState.name}</div>
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.fieldLabel}>Target State</label>
        <select
          style={styles.fieldInput}
          value={transition.targetStateId}
          onChange={(e) => onUpdate({ targetStateId: e.target.value })}
        >
          {allStates.filter((s) => s.id !== parentState.id).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div style={{ ...styles.fieldLabel, marginTop: 12, marginBottom: 8, fontSize: 11, color: '#a6adc8', textTransform: 'uppercase', letterSpacing: 1 }}>
        Condition
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.fieldLabel}>Condition Type</label>
        <select
          style={styles.fieldInput}
          value={condition.type}
          onChange={(e) => {
            const type = e.target.value;
            if (type === 'agent_complete') onUpdate({ condition: { type: 'agent_complete' } });
            else if (type === 'trigger_fired') onUpdate({ condition: { type: 'trigger_fired' } });
            else if (type === 'variable_check') onUpdate({ condition: { type: 'variable_check', variable: '', operator: 'equals', value: '' } });
            else if (type === 'timeout') onUpdate({ condition: { type: 'timeout', afterMs: 3600000 } });
            else if (type === 'manual') onUpdate({ condition: { type: 'manual' } });
            else if (type === 'cron') onUpdate({ condition: { type: 'cron', expression: '* * * * *' } });
          }}
        >
          {Object.entries(CONDITION_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {condition.type === 'variable_check' && (
        <>
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>Variable</label>
            <select style={styles.fieldInput} value={condition.variable} onChange={(e) => onUpdate({ condition: { ...condition, variable: e.target.value } })}>
              <option value="">Select...</option>
              {variables.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>Operator</label>
            <select style={styles.fieldInput} value={condition.operator} onChange={(e) => onUpdate({ condition: { ...condition, operator: e.target.value as any } })}>
              <option value="equals">Equals</option>
              <option value="not_equals">Not Equals</option>
              <option value="contains">Contains</option>
              <option value="greater_than">Greater Than</option>
              <option value="less_than">Less Than</option>
              <option value="is_true">Is True</option>
            </select>
          </div>
          {condition.operator !== 'is_true' && (
            <div style={styles.fieldGroup}>
              <label style={styles.fieldLabel}>Value</label>
              <input style={styles.fieldInput} value={String(condition.value ?? '')} onChange={(e) => onUpdate({ condition: { ...condition, value: e.target.value } })} />
            </div>
          )}
        </>
      )}

      {condition.type === 'timeout' && (
        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Timeout (ms)</label>
          <input type="number" style={styles.fieldInput} value={condition.afterMs} onChange={(e) => onUpdate({ condition: { ...condition, afterMs: Number(e.target.value) } })} />
        </div>
      )}

      {condition.type === 'cron' && (
        <>
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>Cron Expression</label>
            <input style={styles.fieldInput} value={condition.expression} onChange={(e) => onUpdate({ condition: { ...condition, expression: e.target.value } })} placeholder="*/5 * * * *" />
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.fieldLabel}>Timezone</label>
            <input style={styles.fieldInput} value={condition.timezone || ''} onChange={(e) => onUpdate({ condition: { ...condition, timezone: e.target.value } })} placeholder="UTC" />
          </div>
        </>
      )}

      {condition.type === 'trigger_fired' && (
        <div style={styles.fieldGroup}>
          <label style={styles.fieldLabel}>Trigger ID (optional)</label>
          <input style={styles.fieldInput} value={condition.triggerId || ''} onChange={(e) => onUpdate({ condition: { ...condition, triggerId: e.target.value || undefined } })} />
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <button style={{ ...styles.btnSecondary, color: '#f38ba8', borderColor: '#f38ba8' }} onClick={onDelete}>Delete Transition</button>
      </div>
    </div>
  );
}

// ─── Variables Editor ───

function VariablesEditor({
  variables, onChange, onClose,
}: {
  variables: WorkflowVariableSchema[];
  onChange: (vars: WorkflowVariableSchema[]) => void;
  onClose: () => void;
}) {
  const addVariable = () => {
    onChange([...variables, { name: '', type: 'string', description: '' }]);
  };

  const updateVar = (index: number, updates: Partial<WorkflowVariableSchema>) => {
    onChange(variables.map((v, i) => (i === index ? { ...v, ...updates } : v)));
  };

  const deleteVar = (index: number) => {
    onChange(variables.filter((_, i) => i !== index));
  };

  return (
    <div>
      <div style={styles.sidePanelHeader}>
        <span style={{ color: '#cba6f7', fontWeight: 600 }}>Variables ({variables.length})</span>
        <button style={styles.btnClose} onClick={onClose}>x</button>
      </div>

      {variables.map((v, i) => (
        <div key={i} style={{ marginBottom: 12, padding: 8, background: '#313244', borderRadius: 6 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
            <input
              style={{ ...styles.fieldInput, flex: 1 }}
              value={v.name}
              onChange={(e) => updateVar(i, { name: e.target.value })}
              placeholder="Variable name"
            />
            <select
              style={{ ...styles.fieldInput, width: 80 }}
              value={v.type}
              onChange={(e) => updateVar(i, { type: e.target.value as WorkflowVariableType })}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="date">date</option>
              <option value="email">email</option>
              <option value="json">json</option>
            </select>
            <button style={{ ...styles.btnClose, padding: '2px 6px' }} onClick={() => deleteVar(i)}>x</button>
          </div>
          <input
            style={{ ...styles.fieldInput, fontSize: 11 }}
            value={v.description || ''}
            onChange={(e) => updateVar(i, { description: e.target.value })}
            placeholder="Description"
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, color: '#a6adc8', fontSize: 11 }}>
            <input type="checkbox" checked={!!v.required} onChange={(e) => updateVar(i, { required: e.target.checked })} />
            Required
          </label>
        </div>
      ))}

      <button style={styles.btnSecondary} onClick={addVariable}>Add Variable</button>
    </div>
  );
}

// ─── Workflow Settings ───

function WorkflowSettings({
  workflow, onChange, onClose,
}: {
  workflow: WorkflowDefinition;
  onChange: (wf: WorkflowDefinition) => void;
  onClose: () => void;
}) {
  return (
    <div>
      <div style={styles.sidePanelHeader}>
        <span style={{ color: '#cdd6f4', fontWeight: 600 }}>Settings</span>
        <button style={styles.btnClose} onClick={onClose}>x</button>
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.fieldLabel}>Name</label>
        <input style={styles.fieldInput} value={workflow.name} onChange={(e) => onChange({ ...workflow, name: e.target.value })} />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.fieldLabel}>Description</label>
        <textarea
          style={{ ...styles.fieldInput, height: 60, resize: 'vertical' }}
          value={workflow.description || ''}
          onChange={(e) => onChange({ ...workflow, description: e.target.value })}
        />
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.fieldLabel}>Initial State</label>
        <select style={styles.fieldInput} value={workflow.initialStateId} onChange={(e) => onChange({ ...workflow, initialStateId: e.target.value })}>
          {workflow.states.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div style={styles.fieldGroup}>
        <label style={styles.fieldLabel}>Color</label>
        <input type="color" value={workflow.color || '#89b4fa'} onChange={(e) => onChange({ ...workflow, color: e.target.value })} style={{ width: 40, height: 30, padding: 0, border: 'none', cursor: 'pointer' }} />
      </div>

      <div style={{ color: '#6c7086', fontSize: 11, marginTop: 16 }}>
        Version: {workflow.version} | States: {workflow.states.length} | Transitions: {workflow.states.reduce((n, s) => n + s.transitions.length, 0)}
      </div>
    </div>
  );
}

// ─── Styles ───

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)', zIndex: 1000,
    display: 'flex', justifyContent: 'center', alignItems: 'center',
  },
  panel: {
    background: '#1e1e2e', borderRadius: 12, border: '1px solid #313244',
    width: '95vw', height: '90vh', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 20px', borderBottom: '1px solid #313244', flexShrink: 0,
  },
  title: { color: '#cdd6f4', fontSize: 16, fontWeight: 600, margin: 0 },
  content: { padding: 20, flex: 1, overflow: 'auto' },
  card: {
    background: '#313244', borderRadius: 8, padding: '12px 16px',
    marginBottom: 8, cursor: 'pointer', border: '1px solid transparent',
    transition: 'border-color 0.15s',
  },
  toolbar: {
    width: 180, borderRight: '1px solid #313244', padding: 12,
    display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'auto',
  },
  toolBtn: {
    display: 'block', width: '100%', background: 'transparent',
    border: '1px solid #45475a', borderRadius: 6, padding: '6px 10px',
    color: '#cdd6f4', fontSize: 11, cursor: 'pointer', textAlign: 'left',
    marginBottom: 4,
  },
  canvas: {
    flex: 1, overflow: 'auto', background: '#181825', position: 'relative',
    backgroundImage: 'radial-gradient(circle, #313244 1px, transparent 1px)',
    backgroundSize: '20px 20px',
  },
  sidePanel: {
    width: 300, borderLeft: '1px solid #313244', padding: 12,
    overflow: 'auto', flexShrink: 0,
  },
  sidePanelHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #313244',
  },
  fieldGroup: { marginBottom: 10 },
  fieldLabel: { display: 'block', color: '#a6adc8', fontSize: 11, marginBottom: 4 },
  fieldInput: {
    display: 'block', width: '100%', background: '#313244',
    border: '1px solid #45475a', borderRadius: 6, padding: '6px 8px',
    color: '#cdd6f4', fontSize: 12, outline: 'none',
    boxSizing: 'border-box' as const,
  },
  btnPrimary: {
    background: '#89b4fa', border: 'none', borderRadius: 6,
    padding: '8px 16px', color: '#1e1e2e', fontWeight: 600,
    cursor: 'pointer', fontSize: 12, width: '100%',
  },
  btnSecondary: {
    background: 'transparent', border: '1px solid #45475a',
    borderRadius: 6, padding: '6px 12px', color: '#cdd6f4',
    cursor: 'pointer', fontSize: 11,
  },
  btnClose: {
    background: 'transparent', border: 'none', color: '#6c7086',
    cursor: 'pointer', fontSize: 14, padding: '4px 8px',
  },
};
