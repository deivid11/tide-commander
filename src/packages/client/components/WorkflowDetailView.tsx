/**
 * Workflow Detail View
 *
 * Full-screen panel with 3-level drill-down:
 *   Level 1: Workflow Overview (definition + executions list)
 *   Level 2: Execution Detail (timeline, steps, variables)
 *   Level 3: Step Detail / Reasoning Trace
 *
 * Includes a persistent chat panel for conversational audit.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ModalPortal } from './shared/ModalPortal';
import { apiUrl, authFetch } from '../utils/storage';
import type {
  WorkflowDefinition,
  WorkflowState,
  WorkflowModelStatus,
  ChatMessage,
  SourceRef,
} from '../../shared/workflow-types';
import type { WorkflowInstanceRow, WorkflowDetailLevel } from '../store/workflows';

// ─── Props ───

interface WorkflowDetailViewProps {
  workflow: WorkflowDefinition;
  instances: WorkflowInstanceRow[];
  detailLevel: WorkflowDetailLevel;
  status: WorkflowModelStatus;
  chatMessages: ChatMessage[];
  chatLoading: boolean;
  onClose: () => void;
  onNavigateToExecution: (instanceId: string) => void;
  onNavigateToStep: (instanceId: string, stepId: string) => void;
  onNavigateBack: () => void;
  onStartWorkflow: () => void;
  onPauseWorkflow: (instanceId: string) => void;
  onResumeWorkflow: (instanceId: string) => void;
  onCancelWorkflow: (instanceId: string) => void;
  onManualTransition: (instanceId: string, transitionId: string) => void;
  onSendChatMessage: (message: string) => void;
}

// ─── Status Badge ───

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    idle: '#888',
    running: '#4aff9e',
    completed: '#4a9eff',
    error: '#ff4a4a',
    failed: '#ff4a4a',
    paused: '#ffaa00',
    cancelled: '#888',
  };
  const color = colorMap[status] || '#888';

  return (
    <span className="wf-status-badge" style={{ color, borderColor: color }}>
      {status}
    </span>
  );
}

// ─── Breadcrumb Navigation ───

function Breadcrumb({
  workflow,
  level,
  instances,
  onNavigateBack,
}: {
  workflow: WorkflowDefinition;
  level: WorkflowDetailLevel;
  instances: WorkflowInstanceRow[];
  onNavigateBack: () => void;
}) {
  const parts: { label: string; onClick?: () => void }[] = [
    { label: workflow.name },
  ];

  if (level.level === 'execution' || level.level === 'step') {
    const inst = instances.find(i => i.id === level.instanceId);
    parts[0].onClick = onNavigateBack;
    parts.push({
      label: inst ? `Execution ${inst.id.slice(0, 8)}` : 'Execution',
      onClick: level.level === 'step' ? onNavigateBack : undefined,
    });
  }

  if (level.level === 'step') {
    const state = workflow.states.find(s => s.id === level.stepId);
    parts.push({ label: state ? `Step: ${state.name}` : 'Step' });
  }

  return (
    <div className="wf-breadcrumb">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="wf-breadcrumb-sep">&rsaquo;</span>}
          {part.onClick ? (
            <button className="wf-breadcrumb-link" onClick={part.onClick}>
              {part.label}
            </button>
          ) : (
            <span className="wf-breadcrumb-current">{part.label}</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════
// Level 1: Workflow Overview
// ═════════════════════════════════════════

function WorkflowOverview({
  workflow,
  instances,
  status,
  onStartWorkflow,
  onNavigateToExecution,
}: {
  workflow: WorkflowDefinition;
  instances: WorkflowInstanceRow[];
  status: WorkflowModelStatus;
  onStartWorkflow: () => void;
  onNavigateToExecution: (id: string) => void;
}) {
  const [tab, setTab] = useState<'definition' | 'executions'>('definition');

  return (
    <div className="wf-overview">
      <div className="wf-overview-header">
        <div className="wf-overview-info">
          <h2>{workflow.name}</h2>
          <StatusBadge status={status} />
          {workflow.description && (
            <p className="wf-overview-description">{workflow.description}</p>
          )}
        </div>
        <button className="wf-btn wf-btn-primary" onClick={onStartWorkflow}>
          Start Workflow
        </button>
      </div>

      <div className="wf-tabs">
        <button
          className={`wf-tab ${tab === 'definition' ? 'active' : ''}`}
          onClick={() => setTab('definition')}
        >
          Definition
        </button>
        <button
          className={`wf-tab ${tab === 'executions' ? 'active' : ''}`}
          onClick={() => setTab('executions')}
        >
          Executions ({instances.length})
        </button>
      </div>

      {tab === 'definition' && (
        <DefinitionTab workflow={workflow} />
      )}

      {tab === 'executions' && (
        <ExecutionsTab
          instances={instances}
          onSelect={onNavigateToExecution}
        />
      )}
    </div>
  );
}

function DefinitionTab({ workflow }: { workflow: WorkflowDefinition }) {
  return (
    <div className="wf-definition-tab">
      {/* State list */}
      <div className="wf-section">
        <h3>States ({workflow.states.length})</h3>
        <div className="wf-state-list">
          {workflow.states.map(state => (
            <div key={state.id} className="wf-state-item">
              <span className={`wf-state-type wf-state-type-${state.type}`}>
                {state.type}
              </span>
              <span className="wf-state-name">{state.name}</span>
              {state.description && (
                <span className="wf-state-desc">{state.description}</span>
              )}
              {state.transitions.length > 0 && (
                <span className="wf-state-transitions">
                  {state.transitions.map(t => t.name).join(', ')}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Variable schema */}
      {workflow.variables.length > 0 && (
        <div className="wf-section">
          <h3>Variables ({workflow.variables.length})</h3>
          <table className="wf-var-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Required</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {workflow.variables.map(v => (
                <tr key={v.name}>
                  <td className="wf-var-name">{v.name}</td>
                  <td className="wf-var-type">{v.type}</td>
                  <td>{v.required ? 'Yes' : ''}</td>
                  <td>{v.description || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExecutionsTab({
  instances,
  onSelect,
}: {
  instances: WorkflowInstanceRow[];
  onSelect: (id: string) => void;
}) {
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = statusFilter === 'all'
    ? instances
    : instances.filter(i => i.status === statusFilter);

  const sorted = [...filtered].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="wf-executions-tab">
      <div className="wf-filter-row">
        <select
          className="wf-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="paused">Paused</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {sorted.length === 0 ? (
        <div className="wf-empty">No executions found.</div>
      ) : (
        <div className="wf-execution-list">
          {sorted.map(inst => (
            <div
              key={inst.id}
              className="wf-execution-row"
              onClick={() => onSelect(inst.id)}
            >
              <span className="wf-exec-id">{inst.id.slice(0, 8)}</span>
              <StatusBadge status={inst.status} />
              <span className="wf-exec-state">{inst.currentStateId}</span>
              <span className="wf-exec-time">
                {new Date(inst.createdAt).toLocaleString()}
              </span>
              {inst.error && (
                <span className="wf-exec-error" title={inst.error}>
                  {inst.error.slice(0, 50)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════
// Level 2: Execution Detail
// ═════════════════════════════════════════

function ExecutionDetail({
  workflow,
  instance,
  onNavigateToStep,
  onPause,
  onResume,
  onCancel,
  onManualTransition,
}: {
  workflow: WorkflowDefinition;
  instance: WorkflowInstanceRow;
  onNavigateToStep: (stepId: string) => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onManualTransition: (transitionId: string) => void;
}) {
  const [tab, setTab] = useState<'timeline' | 'steps' | 'variables'>('timeline');

  const currentState = workflow.states.find(s => s.id === instance.currentStateId);

  return (
    <div className="wf-execution-detail">
      <div className="wf-exec-header">
        <div className="wf-exec-meta">
          <StatusBadge status={instance.status} />
          <span>Current: <strong>{currentState?.name || instance.currentStateId}</strong></span>
          <span>Started: {new Date(instance.createdAt).toLocaleString()}</span>
          {instance.completedAt && (
            <span>Completed: {new Date(instance.completedAt).toLocaleString()}</span>
          )}
        </div>
        <div className="wf-exec-controls">
          {instance.status === 'running' && (
            <>
              <button className="wf-btn" onClick={onPause}>Pause</button>
              <button className="wf-btn wf-btn-danger" onClick={onCancel}>Cancel</button>
            </>
          )}
          {instance.status === 'paused' && (
            <button className="wf-btn wf-btn-primary" onClick={onResume}>Resume</button>
          )}
        </div>
      </div>

      {/* Manual transition buttons for current state */}
      {currentState && instance.status === 'running' && (
        <div className="wf-manual-transitions">
          {currentState.transitions
            .filter(t => t.condition.type === 'manual')
            .map(t => (
              <button
                key={t.id}
                className="wf-btn wf-btn-outline"
                onClick={() => onManualTransition(t.id)}
              >
                {t.name}
              </button>
            ))}
        </div>
      )}

      <div className="wf-tabs">
        <button className={`wf-tab ${tab === 'timeline' ? 'active' : ''}`} onClick={() => setTab('timeline')}>
          Timeline
        </button>
        <button className={`wf-tab ${tab === 'steps' ? 'active' : ''}`} onClick={() => setTab('steps')}>
          Steps
        </button>
        <button className={`wf-tab ${tab === 'variables' ? 'active' : ''}`} onClick={() => setTab('variables')}>
          Variables
        </button>
      </div>

      {tab === 'timeline' && (
        <TimelineView history={instance.history} workflow={workflow} />
      )}

      {tab === 'steps' && (
        <StepsView
          history={instance.history}
          workflow={workflow}
          currentStateId={instance.currentStateId}
          onSelectStep={onNavigateToStep}
        />
      )}

      {tab === 'variables' && (
        <VariablesView variables={instance.variables} />
      )}
    </div>
  );
}

function TimelineView({
  history,
  workflow,
}: {
  history: WorkflowInstanceRow['history'];
  workflow: WorkflowDefinition;
}) {
  if (history.length === 0) {
    return <div className="wf-empty">No timeline events yet.</div>;
  }

  return (
    <div className="wf-timeline">
      {history.map((entry, i) => {
        const state = workflow.states.find(s => s.id === entry.toStateId);
        return (
          <div key={i} className="wf-timeline-entry">
            <div className="wf-timeline-dot" />
            <div className="wf-timeline-content">
              <span className="wf-timeline-time">
                {new Date(entry.timestamp).toLocaleString()}
              </span>
              {entry.fromStateId && (
                <span className="wf-timeline-from">
                  From: {workflow.states.find(s => s.id === entry.fromStateId)?.name || entry.fromStateId}
                </span>
              )}
              <span className="wf-timeline-to">
                To: {state?.name || entry.toStateId}
              </span>
              {entry.transitionName && (
                <span className="wf-timeline-transition">
                  via: {entry.transitionName}
                </span>
              )}
              {entry.details && (
                <div className="wf-timeline-details">{entry.details}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StepsView({
  history,
  workflow,
  currentStateId,
  onSelectStep,
}: {
  history: WorkflowInstanceRow['history'];
  workflow: WorkflowDefinition;
  currentStateId: string;
  onSelectStep: (stepId: string) => void;
}) {
  // Deduplicate by toStateId (show each state visited)
  const visitedStates = new Map<string, typeof history[number]>();
  for (const entry of history) {
    visitedStates.set(entry.toStateId, entry);
  }

  return (
    <div className="wf-steps">
      {Array.from(visitedStates.entries()).map(([stateId, entry]) => {
        const state = workflow.states.find(s => s.id === stateId);
        const isCurrent = stateId === currentStateId;
        return (
          <div
            key={stateId}
            className={`wf-step-row ${isCurrent ? 'wf-step-current' : ''}`}
            onClick={() => onSelectStep(stateId)}
          >
            <span className={`wf-state-type wf-state-type-${state?.type || 'action'}`}>
              {state?.type || '?'}
            </span>
            <span className="wf-step-name">{state?.name || stateId}</span>
            <span className="wf-step-time">
              {new Date(entry.timestamp).toLocaleTimeString()}
            </span>
            {isCurrent && <span className="wf-step-badge">Current</span>}
          </div>
        );
      })}
    </div>
  );
}

function VariablesView({ variables }: { variables: Record<string, unknown> }) {
  const entries = Object.entries(variables);

  if (entries.length === 0) {
    return <div className="wf-empty">No variables set.</div>;
  }

  return (
    <div className="wf-variables">
      <table className="wf-var-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key}>
              <td className="wf-var-name">{key}</td>
              <td className="wf-var-value">
                {typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ═════════════════════════════════════════
// Level 3: Step Detail / Reasoning Trace
// ═════════════════════════════════════════

function StepDetail({
  workflow,
  instance,
  stepId,
}: {
  workflow: WorkflowDefinition;
  instance: WorkflowInstanceRow;
  stepId: string;
}) {
  const state = workflow.states.find(s => s.id === stepId);
  const historyEntry = instance.history.find(h => h.toStateId === stepId);

  if (!state) {
    return <div className="wf-empty">Step not found.</div>;
  }

  return (
    <div className="wf-step-detail">
      <div className="wf-step-detail-header">
        <h3>{state.name}</h3>
        <span className={`wf-state-type wf-state-type-${state.type}`}>{state.type}</span>
      </div>

      {state.description && (
        <p className="wf-step-description">{state.description}</p>
      )}

      {/* Action details */}
      {state.action && (
        <div className="wf-section">
          <h4>Action ({state.action.type})</h4>
          {state.action.type === 'agent_task' && (
            <div className="wf-prompt-block">
              <div className="wf-prompt-label">Prompt Template:</div>
              <pre className="wf-prompt-text">{state.action.promptTemplate}</pre>
              {state.action.skills && state.action.skills.length > 0 && (
                <div className="wf-prompt-skills">
                  Skills: {state.action.skills.join(', ')}
                </div>
              )}
            </div>
          )}
          {state.action.type === 'wait_for_trigger' && (
            <div className="wf-prompt-block">
              <div className="wf-prompt-label">Waiting for trigger</div>
              {state.action.timeoutMs && (
                <div>Timeout: {Math.round(state.action.timeoutMs / 60000)}min</div>
              )}
            </div>
          )}
          {state.action.type === 'set_variables' && (
            <div className="wf-prompt-block">
              <div className="wf-prompt-label">Variable Assignments:</div>
              <pre className="wf-prompt-text">
                {JSON.stringify(state.action.assignments, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Transitions */}
      {state.transitions.length > 0 && (
        <div className="wf-section">
          <h4>Transitions</h4>
          <div className="wf-transition-list">
            {state.transitions.map(t => (
              <div key={t.id} className="wf-transition-item">
                <span className="wf-transition-name">{t.name}</span>
                <span className="wf-transition-target">
                  &rarr; {workflow.states.find(s => s.id === t.targetStateId)?.name || t.targetStateId}
                </span>
                <span className="wf-transition-condition">
                  ({t.condition.type})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Variable snapshot from history */}
      {historyEntry?.variables && Object.keys(historyEntry.variables).length > 0 && (
        <div className="wf-section">
          <h4>Variables at this step</h4>
          <VariablesView variables={historyEntry.variables} />
        </div>
      )}

      {/* Details from history entry */}
      {historyEntry?.details && (
        <div className="wf-section">
          <h4>Details</h4>
          <pre className="wf-details-block">{historyEntry.details}</pre>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════
// Chat Panel
// ═════════════════════════════════════════

function WorkflowChatPanel({
  messages,
  loading,
  onSend,
}: {
  messages: ChatMessage[];
  loading: boolean;
  onSend: (text: string) => void;
}) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    onSend(text);
    setInput('');
  };

  return (
    <div className="wf-chat-panel">
      <div className="wf-chat-header">
        <span>Workflow Chat</span>
      </div>
      <div className="wf-chat-messages">
        {messages.length === 0 && (
          <div className="wf-chat-placeholder">
            Ask questions about this workflow...
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`wf-chat-msg wf-chat-msg-${msg.role}`}>
            <div className="wf-chat-msg-content">{msg.content}</div>
            {msg.sources && msg.sources.length > 0 && (
              <div className="wf-chat-sources">
                {msg.sources.map((src, j) => (
                  <span key={j} className="wf-chat-source-ref" title={`${src.type}: ${src.id}`}>
                    {src.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="wf-chat-msg wf-chat-msg-assistant">
            <div className="wf-chat-typing">Thinking...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
      <form className="wf-chat-input" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this workflow..."
          disabled={loading}
        />
        <button type="submit" className="wf-btn wf-btn-primary" disabled={loading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

// ═════════════════════════════════════════
// Main Component
// ═════════════════════════════════════════

export function WorkflowDetailView({
  workflow,
  instances,
  detailLevel,
  status,
  chatMessages,
  chatLoading,
  onClose,
  onNavigateToExecution,
  onNavigateToStep,
  onNavigateBack,
  onStartWorkflow,
  onPauseWorkflow,
  onResumeWorkflow,
  onCancelWorkflow,
  onManualTransition,
  onSendChatMessage,
}: WorkflowDetailViewProps) {
  const selectedInstance = detailLevel.level !== 'overview'
    ? instances.find(i => i.id === detailLevel.instanceId)
    : null;

  return (
    <ModalPortal>
      <div className="wf-detail-overlay">
        <div className="wf-detail-container">
          {/* Top bar with breadcrumb and close */}
          <div className="wf-detail-topbar">
            <Breadcrumb
              workflow={workflow}
              level={detailLevel}
              instances={instances}
              onNavigateBack={onNavigateBack}
            />
            <button className="wf-close-btn" onClick={onClose} title="Close">
              &times;
            </button>
          </div>

          <div className="wf-detail-body">
            {/* Main content area */}
            <div className="wf-detail-main">
              {detailLevel.level === 'overview' && (
                <WorkflowOverview
                  workflow={workflow}
                  instances={instances}
                  status={status}
                  onStartWorkflow={onStartWorkflow}
                  onNavigateToExecution={onNavigateToExecution}
                />
              )}

              {detailLevel.level === 'execution' && selectedInstance && (
                <ExecutionDetail
                  workflow={workflow}
                  instance={selectedInstance}
                  onNavigateToStep={(stepId) => onNavigateToStep(selectedInstance.id, stepId)}
                  onPause={() => onPauseWorkflow(selectedInstance.id)}
                  onResume={() => onResumeWorkflow(selectedInstance.id)}
                  onCancel={() => onCancelWorkflow(selectedInstance.id)}
                  onManualTransition={(tid) => onManualTransition(selectedInstance.id, tid)}
                />
              )}

              {detailLevel.level === 'step' && selectedInstance && (
                <StepDetail
                  workflow={workflow}
                  instance={selectedInstance}
                  stepId={detailLevel.stepId}
                />
              )}
            </div>

            {/* Chat sidebar */}
            <WorkflowChatPanel
              messages={chatMessages}
              loading={chatLoading}
              onSend={onSendChatMessage}
            />
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
