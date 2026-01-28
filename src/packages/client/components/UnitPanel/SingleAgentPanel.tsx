/**
 * SingleAgentPanel - Detailed view for a single selected agent
 * Includes stats, supervisor history, boss management, and action buttons
 */

import React, { useState, useRef, useEffect, useMemo, memo } from 'react';
import { useStore, store, useCustomAgentClassesArray } from '../../store';
import { filterCostText } from '../../utils/formatting';
import { getClassConfig } from '../../utils/classConfig';
import { PROGRESS_COLORS, AGENT_STATUS_COLORS } from '../../utils/colors';
import { ModelPreview } from '../ModelPreview';
import { AgentEditModal } from '../AgentEditModal';
import { ContextViewModal } from '../ContextViewModal';
import { useToast } from '../Toast';
import { PERMISSION_MODES, AGENT_CLASSES } from '../../../shared/types';
import { apiUrl, authFetch } from '../../utils/storage';
import { useModalClose } from '../../hooks';
import type { Agent } from '../../../shared/types';
import { calculateContextInfo } from './agentUtils';
import { formatRelativeTime } from './agentUtils';
import {
  AgentStatsGrid,
  ContextBar,
  IdleTimer,
  CurrentTool,
  CurrentTask,
  WorkingDirectory,
  LastPrompt,
  LastResponse,
} from './AgentStatsRow';
import type {
  SingleAgentPanelProps,
  RememberedPattern,
  ContextAction,
  SupervisorHistoryItemProps,
  BossAgentSectionProps,
  DelegationDecisionItemProps,
  SubordinateBadgeProps,
  LinkToBossSectionProps,
} from './types';

// ============================================================================
// SingleAgentPanel Component
// ============================================================================

export function SingleAgentPanel({
  agent: agentProp,
  onFocusAgent,
  onKillAgent,
  onCallSubordinates,
  onOpenAreaExplorer: _onOpenAreaExplorer,
}: SingleAgentPanelProps) {
  const state = useStore();
  const customClasses = useCustomAgentClassesArray();
  const { showToast } = useToast();

  // Get the latest agent data from the store to ensure we have current values
  const agent = state.agents.get(agentProp.id) || agentProp;
  const classConfig = getClassConfig(agent.class, customClasses);

  // Get model file for custom classes
  const customClass = customClasses.find(c => c.id === agent.class);
  const modelFile = customClass?.model;
  // Check if custom class has an uploaded custom model
  const customModelUrl = customClass?.customModelPath ? apiUrl(`/api/custom-models/${customClass.id}`) : undefined;
  const modelScale = customClass?.modelScale;

  // Name editing state
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(agent.name);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // UI state
  const [, setTick] = useState(0); // For forcing re-render of idle timer
  const [showHistory, setShowHistory] = useState(true);
  const [showPatterns, setShowPatterns] = useState(false);
  const [rememberedPatterns, setRememberedPatterns] = useState<RememberedPattern[]>([]);
  const [contextConfirm, setContextConfirm] = useState<ContextAction>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showContextModal, setShowContextModal] = useState(false);

  // Get supervisor history for this agent
  const supervisorHistory = store.getAgentSupervisorHistory(agent.id);
  const isLoadingHistory = store.isLoadingHistoryForAgent(agent.id);

  // Fetch supervisor history when agent is selected (only if not already fetched/loading)
  useEffect(() => {
    if (!store.hasHistoryBeenFetched(agent.id) && !isLoadingHistory) {
      store.requestAgentSupervisorHistory(agent.id);
    }
  }, [agent.id, isLoadingHistory]);

  // Update editName when agent changes
  useEffect(() => {
    setEditName(agent.name);
  }, [agent.name]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [isEditingName]);

  // Update idle timer every 15 seconds when agent is idle
  useEffect(() => {
    if (agent.status === 'idle') {
      const interval = setInterval(() => {
        setTick((t) => t + 1);
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [agent.status]);

  // Fetch remembered patterns for interactive mode agents
  useEffect(() => {
    if (agent.permissionMode === 'interactive') {
      authFetch(apiUrl('/api/remembered-patterns'))
        .then((res) => res.json())
        .then(setRememberedPatterns)
        .catch((err) => console.error('Failed to fetch remembered patterns:', err));
    }
  }, [agent.permissionMode]);

  // Calculate context info
  const contextInfo = useMemo(
    () => calculateContextInfo(agent),
    [agent.contextStats, agent.contextUsed, agent.contextLimit]
  );

  // Get assigned area for this agent
  const assignedArea = store.getAreaForAgent(agent.id);

  // Get last output message for this agent
  const agentOutputs = state.agentOutputs.get(agent.id) || [];
  const lastOutput = agentOutputs.length > 0 ? agentOutputs[agentOutputs.length - 1] : null;

  // Get last prompt for this agent
  const lastPrompt = state.lastPrompts.get(agent.id);

  // Handlers
  const handleRemovePattern = async (tool: string, pattern: string) => {
    try {
      const res = await authFetch(
        apiUrl(`/api/remembered-patterns/${tool}/${encodeURIComponent(pattern)}`),
        { method: 'DELETE' }
      );
      if (res.ok) {
        setRememberedPatterns((prev) => prev.filter((p) => !(p.tool === tool && p.pattern === pattern)));
      }
    } catch (err) {
      console.error('Failed to remove pattern:', err);
    }
  };

  const handleClearAllPatterns = async () => {
    if (!confirm('Clear all remembered permission patterns?')) return;
    try {
      const res = await authFetch(apiUrl('/api/remembered-patterns'), { method: 'DELETE' });
      if (res.ok) {
        setRememberedPatterns([]);
      }
    } catch (err) {
      console.error('Failed to clear patterns:', err);
    }
  };

  const handleKill = () => {
    if (confirm('Are you sure you want to terminate this agent?')) {
      onKillAgent(agent.id);
    }
  };

  const handleNameSave = () => {
    const trimmedName = editName.trim();
    if (trimmedName && trimmedName !== agent.name) {
      store.renameAgent(agent.id, trimmedName);
    } else {
      setEditName(agent.name);
    }
    setIsEditingName(false);
  };

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSave();
    } else if (e.key === 'Escape') {
      setEditName(agent.name);
      setIsEditingName(false);
    }
  };

  return (
    <div className="unit-panel">
      {/* Model Preview */}
      <div className="unit-model-preview">
        <ModelPreview
          agentClass={agent.class}
          modelFile={modelFile}
          customModelUrl={customModelUrl}
          modelScale={modelScale}
          status={agent.status}
          width={80}
          height={80}
        />
      </div>

      {/* Agent Header */}
      <div className="unit-panel-header">
        <div className="unit-class-icon" style={{ background: `${classConfig.color}20` }}>
          {classConfig.icon}
        </div>
        <div className="unit-header-info">
          {isEditingName ? (
            <input
              ref={nameInputRef}
              type="text"
              className="unit-name-input"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleNameSave}
              onKeyDown={handleNameKeyDown}
            />
          ) : (
            <div
              className="unit-name unit-name-editable"
              onClick={() => setIsEditingName(true)}
              title="Click to rename"
            >
              {agent.name}
            </div>
          )}
          <div className="unit-status">
            <span style={{ color: AGENT_STATUS_COLORS[agent.status] || AGENT_STATUS_COLORS.default }}>
              {agent.status}
            </span>
            <span> • {agent.class}</span>
          </div>
          {/* Idle timer - shows how long agent has been idle */}
          {agent.status === 'idle' && agent.lastActivity > 0 && (
            <IdleTimer lastActivity={agent.lastActivity} />
          )}
        </div>
        <div className="unit-header-actions">
          <button className="unit-action-icon" onClick={() => onFocusAgent(agent.id)} title="Focus on agent">
            🎯
          </button>
          <button
            className="unit-action-icon"
            onClick={() => setShowEditModal(true)}
            title="Edit agent properties"
          >
            ✏️
          </button>
          {(agent.isBoss || agent.class === 'boss') &&
            agent.subordinateIds &&
            agent.subordinateIds.length > 0 && (
              <button
                className="unit-action-icon"
                onClick={() => onCallSubordinates?.(agent.id)}
                title="Call subordinates"
              >
                📢
              </button>
            )}
          <button
            className="unit-action-icon"
            onClick={() => setContextConfirm('collapse')}
            title="Collapse context"
            disabled={agent.status !== 'idle'}
          >
            📦
          </button>
          <button
            className="unit-action-icon warning"
            onClick={() => setContextConfirm('clear')}
            title="Clear context"
          >
            🗑️
          </button>
          <button className="unit-action-icon danger" onClick={handleKill} title="Kill agent">
            ☠️
          </button>
        </div>
      </div>

      {/* Assigned Area */}
      {assignedArea && (
        <div className="unit-area">
          <span className="unit-area-dot" style={{ background: assignedArea.color }} />
          <span className="unit-area-name">{assignedArea.name}</span>
        </div>
      )}

      {/* Last Prompt */}
      {lastPrompt && <LastPrompt text={lastPrompt.text} />}

      {/* Last Response */}
      {lastOutput && <LastResponse text={lastOutput.text} />}

      {/* Stats Grid */}
      <AgentStatsGrid tokensUsed={agent.tokensUsed} createdAt={agent.createdAt} />

      {/* Context Bar */}
      <ContextBar contextInfo={contextInfo} onClick={() => setShowContextModal(true)} />

      {/* Current Tool */}
      {agent.currentTool && <CurrentTool toolName={agent.currentTool} />}

      {/* Current Task */}
      {agent.currentTask && <CurrentTask task={agent.currentTask} />}

      {/* Working Directory */}
      <WorkingDirectory cwd={agent.cwd} />

      {/* Permission Mode */}
      <div className="unit-permission-mode">
        <div className="unit-stat-label">Permissions</div>
        <div className="unit-permission-mode-value" title={PERMISSION_MODES[agent.permissionMode]?.description}>
          <span className="unit-permission-mode-icon">{agent.permissionMode === 'bypass' ? '⚡' : '🔐'}</span>
          <span className="unit-permission-mode-label">
            {PERMISSION_MODES[agent.permissionMode]?.label || agent.permissionMode}
          </span>
        </div>
      </div>

      {/* Remembered Patterns (only for interactive mode) */}
      {agent.permissionMode === 'interactive' && (
        <RememberedPatternsSection
          patterns={rememberedPatterns}
          showPatterns={showPatterns}
          onToggle={() => setShowPatterns(!showPatterns)}
          onRemovePattern={handleRemovePattern}
          onClearAll={handleClearAllPatterns}
        />
      )}

      {/* Resume Session Command */}
      {agent.sessionId ? (
        <div className="unit-resume-cmd">
          <div className="unit-stat-label">Resume Session</div>
          <div
            className="unit-resume-cmd-text"
            title="Click to copy"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(`claude --resume ${agent.sessionId}`);
                showToast('success', 'Copied!', 'Resume command copied to clipboard', 2000);
              } catch {
                showToast('error', 'Error', 'Failed to copy to clipboard', 3000);
              }
            }}
          >
            claude --resume {agent.sessionId}
          </div>
        </div>
      ) : (
        <div className="unit-resume-cmd">
          <div className="unit-stat-label">Session</div>
          <div className="unit-new-session-indicator">New agent, new session</div>
        </div>
      )}

      {/* Supervisor History */}
      <div className="unit-supervisor-history">
        <div className="unit-supervisor-history-header" onClick={() => setShowHistory(!showHistory)}>
          <div className="unit-stat-label">Supervisor History</div>
          <span className="unit-supervisor-history-toggle">
            {supervisorHistory.length > 0 && (
              <span className="unit-supervisor-history-count">{supervisorHistory.length}</span>
            )}
            {showHistory ? '▼' : '▶'}
          </span>
        </div>
        {showHistory && (
          <div className="unit-supervisor-history-list">
            {isLoadingHistory ? (
              <div className="unit-supervisor-history-loading">Loading...</div>
            ) : supervisorHistory.length === 0 ? (
              <div className="unit-supervisor-history-empty">No supervisor reports yet</div>
            ) : (
              supervisorHistory
                .slice(0, 10)
                .map((entry, index) => (
                  <SupervisorHistoryItem key={entry.id} entry={entry} defaultExpanded={index === 0} />
                ))
            )}
          </div>
        )}
      </div>

      {/* Boss-Specific Section */}
      {(agent.isBoss || agent.class === 'boss') && <BossAgentSection agent={agent} />}

      {/* Subordinate Badge (if agent has a boss) */}
      {agent.bossId && <SubordinateBadge agentId={agent.id} bossId={agent.bossId} />}

      {/* Link to Boss option (if agent is not a boss and has no boss) */}
      {agent.class !== 'boss' && !agent.isBoss && !agent.bossId && <LinkToBossSection agentId={agent.id} />}

      {/* Context Action Confirmation Modal */}
      {contextConfirm && (
        <ContextConfirmModal
          action={contextConfirm}
          agentName={agent.name}
          onClose={() => setContextConfirm(null)}
          onConfirm={() => {
            if (contextConfirm === 'collapse') {
              store.collapseContext(agent.id);
            } else {
              store.clearContext(agent.id);
            }
            setContextConfirm(null);
          }}
        />
      )}

      {/* Agent Edit Modal */}
      <AgentEditModal agent={agent} isOpen={showEditModal} onClose={() => setShowEditModal(false)} />

      {/* Context View Modal */}
      <ContextViewModal
        agent={agent}
        isOpen={showContextModal}
        onClose={() => setShowContextModal(false)}
        onRefresh={() => {
          store.refreshAgentContext(agent.id);
        }}
      />
    </div>
  );
}

// ============================================================================
// RememberedPatternsSection Component
// ============================================================================

interface RememberedPatternsSectionProps {
  patterns: RememberedPattern[];
  showPatterns: boolean;
  onToggle: () => void;
  onRemovePattern: (tool: string, pattern: string) => void;
  onClearAll: () => void;
}

const RememberedPatternsSection = memo(function RememberedPatternsSection({
  patterns,
  showPatterns,
  onToggle,
  onRemovePattern,
  onClearAll,
}: RememberedPatternsSectionProps) {
  return (
    <div className="unit-remembered-patterns">
      <div className="unit-remembered-patterns-header" onClick={onToggle}>
        <div className="unit-stat-label">Allowed Patterns</div>
        <span className="unit-remembered-patterns-toggle">
          {patterns.length > 0 && <span className="unit-remembered-patterns-count">{patterns.length}</span>}
          {showPatterns ? '▼' : '▶'}
        </span>
      </div>
      {showPatterns && (
        <div className="unit-remembered-patterns-list">
          {patterns.length === 0 ? (
            <div className="unit-remembered-patterns-empty">
              No patterns remembered yet. Click ✓+ when approving to remember.
            </div>
          ) : (
            <>
              {patterns.map((p, i) => (
                <div key={i} className="unit-remembered-pattern-item">
                  <span className="unit-pattern-tool">{p.tool}</span>
                  <span className="unit-pattern-desc" title={p.pattern}>
                    {p.description}
                  </span>
                  <button
                    className="unit-pattern-remove"
                    onClick={() => onRemovePattern(p.tool, p.pattern)}
                    title="Remove this pattern"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button className="unit-patterns-clear-all" onClick={onClearAll}>
                Clear All
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// ContextConfirmModal Component
// ============================================================================

interface ContextConfirmModalProps {
  action: 'collapse' | 'clear';
  agentName: string;
  onClose: () => void;
  onConfirm: () => void;
}

const ContextConfirmModal = memo(function ContextConfirmModal({
  action,
  agentName,
  onClose,
  onConfirm,
}: ContextConfirmModalProps) {
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  return (
    <div className="modal-overlay visible" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
      <div className="modal confirm-modal">
        <div className="modal-header">{action === 'collapse' ? 'Collapse Context' : 'Clear Context'}</div>
        <div className="modal-body confirm-modal-body">
          {action === 'collapse' ? (
            <>
              <p>
                Collapse the conversation context for <strong>{agentName}</strong>?
              </p>
              <p className="confirm-modal-note">
                This will summarize the conversation to save tokens while preserving important information.
              </p>
            </>
          ) : (
            <>
              <p>
                Clear all context for <strong>{agentName}</strong>?
              </p>
              <p className="confirm-modal-note">
                This will start a fresh session on the next command. All conversation history will be lost.
              </p>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className={`btn ${action === 'clear' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            autoFocus
          >
            {action === 'collapse' ? 'Collapse' : 'Clear Context'}
          </button>
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// SupervisorHistoryItem Component
// ============================================================================

const SupervisorHistoryItem = memo(function SupervisorHistoryItem({
  entry,
  defaultExpanded = false,
}: SupervisorHistoryItemProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const state = useStore();
  const { analysis } = entry;
  const hideCost = state.settings.hideCost;

  const statusDescription = filterCostText(analysis.statusDescription, hideCost);
  const recentWorkSummary = filterCostText(analysis.recentWorkSummary, hideCost);
  const concerns = analysis.concerns?.map((c) => filterCostText(c, hideCost)).filter((c) => c.length > 0);

  return (
    <div className="supervisor-history-item">
      <div className="supervisor-history-item-header" onClick={() => setExpanded(!expanded)}>
        <span
          className="supervisor-history-progress-dot"
          style={{ background: PROGRESS_COLORS[analysis.progress] || '#888' }}
          title={analysis.progress}
        />
        <span className="supervisor-history-status">{statusDescription}</span>
        <span className="supervisor-history-time">{formatRelativeTime(entry.timestamp)}</span>
      </div>
      {expanded && (
        <div className="supervisor-history-item-details">
          <div className="supervisor-history-summary">
            <strong>Summary:</strong> {recentWorkSummary}
          </div>
          {concerns && concerns.length > 0 && (
            <div className="supervisor-history-concerns">
              <strong>Concerns:</strong>
              <ul>
                {concerns.map((concern, i) => (
                  <li key={i}>{concern}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// BossAgentSection Component
// ============================================================================

const BossAgentSection = memo(function BossAgentSection({ agent }: BossAgentSectionProps) {
  const state = useStore();
  const customClasses = useCustomAgentClassesArray();
  const [showSubordinates, setShowSubordinates] = useState(true);
  const [showDelegationHistory, setShowDelegationHistory] = useState(true);

  // Get subordinates reactively from the agent's subordinateIds
  // This ensures re-render when subordinateIds change via WebSocket
  const subordinates = useMemo(() => {
    const boss = state.agents.get(agent.id);
    // Check for isBoss flag OR class === 'boss' to support both boss types
    if (!boss || (!boss.isBoss && boss.class !== 'boss') || !boss.subordinateIds) return [];
    return boss.subordinateIds
      .map((id) => state.agents.get(id))
      .filter((a): a is Agent => a !== undefined);
  }, [state.agents, agent.id]);

  const delegationHistory = store.getDelegationHistory(agent.id);
  const pendingDelegation = state.pendingDelegation;
  const isPendingForThisBoss = pendingDelegation?.bossId === agent.id;

  // Request delegation history when boss is selected
  useEffect(() => {
    store.requestDelegationHistory(agent.id);
  }, [agent.id]);

  const bossConfig = AGENT_CLASSES.boss;

  return (
    <div className="boss-section">
      {/* Boss Header */}
      <div className="boss-header">
        <span className="boss-crown-icon" style={{ color: bossConfig.color }}>
          {bossConfig.icon}
        </span>
        <span className="boss-title">Boss Agent</span>
      </div>

      {/* Subordinates List */}
      <div className="boss-subordinates">
        <div className="boss-subordinates-header" onClick={() => setShowSubordinates(!showSubordinates)}>
          <div className="unit-stat-label">Team ({subordinates.length})</div>
          <span className="boss-toggle">{showSubordinates ? '▼' : '▶'}</span>
        </div>
        {showSubordinates && (
          <div className="boss-subordinates-list">
            {subordinates.length === 0 ? (
              <div className="boss-subordinates-empty">
                No subordinates assigned. Use "Manage Team" to add agents.
              </div>
            ) : (
              subordinates.map((sub) => {
                const subClassConfig = getClassConfig(sub.class, customClasses);
                return (
                  <div key={sub.id} className="boss-subordinate-item" onClick={() => store.selectAgent(sub.id)}>
                    <span className="boss-subordinate-icon" style={{ color: subClassConfig.color }}>
                      {subClassConfig.icon}
                    </span>
                    <span className="boss-subordinate-name">{sub.name}</span>
                    <span className={`boss-subordinate-status status-${sub.status}`}>{sub.status}</span>
                    <button
                      className="boss-subordinate-unlink"
                      onClick={(e) => {
                        e.stopPropagation();
                        store.removeSubordinate(agent.id, sub.id);
                      }}
                      title="Unlink subordinate"
                    >
                      ✕
                    </button>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Delegation History */}
      <div className="boss-delegation-history">
        <div
          className="boss-delegation-history-header"
          onClick={() => setShowDelegationHistory(!showDelegationHistory)}
        >
          <div className="unit-stat-label">Delegation History ({delegationHistory.length})</div>
          <span className="boss-toggle">{showDelegationHistory ? '▼' : '▶'}</span>
        </div>
        {showDelegationHistory && (
          <div className="boss-delegation-history-list">
            {isPendingForThisBoss && (
              <div className="boss-delegation-pending">
                <span className="delegation-spinner">⏳</span>
                Analyzing request...
              </div>
            )}
            {delegationHistory.length === 0 && !isPendingForThisBoss ? (
              <div className="boss-delegation-empty">
                No delegation history yet. Send commands to this boss to delegate tasks.
              </div>
            ) : (
              delegationHistory.slice(0, 10).map((decision) => <DelegationDecisionItem key={decision.id} decision={decision} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ============================================================================
// DelegationDecisionItem Component
// ============================================================================

const DelegationDecisionItem = memo(function DelegationDecisionItem({ decision }: DelegationDecisionItemProps) {
  const [expanded, setExpanded] = useState(false);
  const state = useStore();

  const targetAgent = state.agents.get(decision.selectedAgentId);
  const targetClassConfig = targetAgent ? AGENT_CLASSES[targetAgent.class as keyof typeof AGENT_CLASSES] : null;

  const confidenceColors: Record<string, string> = {
    high: '#4aff9e',
    medium: '#ff9e4a',
    low: '#ff4a4a',
  };

  return (
    <div className="delegation-decision-item">
      <div className="delegation-decision-header" onClick={() => setExpanded(!expanded)}>
        <span className="delegation-decision-arrow">{expanded ? '▼' : '▶'}</span>
        {targetClassConfig && (
          <span className="delegation-decision-icon" style={{ color: targetClassConfig.color }}>
            {targetClassConfig.icon}
          </span>
        )}
        <span className="delegation-decision-agent">→ {decision.selectedAgentName}</span>
        <span
          className="delegation-decision-confidence"
          style={{ color: confidenceColors[decision.confidence] }}
          title={`Confidence: ${decision.confidence}`}
        >
          {decision.confidence === 'high' ? '●●●' : decision.confidence === 'medium' ? '●●○' : '●○○'}
        </span>
        <span className="delegation-decision-time">{formatRelativeTime(decision.timestamp)}</span>
      </div>
      {expanded && (
        <div className="delegation-decision-details">
          <div className="delegation-decision-command">
            <strong>Command:</strong>
            <div className="delegation-command-text">
              {decision.userCommand.length > 200 ? decision.userCommand.slice(0, 200) + '...' : decision.userCommand}
            </div>
          </div>
          <div className="delegation-decision-reasoning">
            <strong>Reasoning:</strong> {decision.reasoning}
          </div>
          {decision.alternativeAgents.length > 0 && (
            <div className="delegation-decision-alternatives">
              <strong>Alternatives:</strong> {decision.alternativeAgents.join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// SubordinateBadge Component
// ============================================================================

const SubordinateBadge = memo(function SubordinateBadge({ agentId, bossId }: SubordinateBadgeProps) {
  const state = useStore();
  const boss = state.agents.get(bossId);

  if (!boss) return null;

  const bossConfig = AGENT_CLASSES.boss;

  const handleUnlink = (e: React.MouseEvent) => {
    e.stopPropagation();
    store.removeSubordinate(bossId, agentId);
  };

  return (
    <div className="subordinate-badge">
      <span className="subordinate-badge-icon" style={{ color: bossConfig.color }}>
        {bossConfig.icon}
      </span>
      <span className="subordinate-badge-text">
        Reports to: <strong>{boss.name}</strong>
      </span>
      <button className="subordinate-badge-goto" onClick={() => store.selectAgent(bossId)} title="Go to boss">
        →
      </button>
      <button className="subordinate-badge-unlink" onClick={handleUnlink} title="Unlink from boss">
        ✕
      </button>
    </div>
  );
});

// ============================================================================
// LinkToBossSection Component
// ============================================================================

const LinkToBossSection = memo(function LinkToBossSection({ agentId }: LinkToBossSectionProps) {
  const state = useStore();
  const [isExpanded, setIsExpanded] = useState(false);

  // Get all boss agents
  const bossAgents = Array.from(state.agents.values()).filter((a) => a.isBoss === true || a.class === 'boss');

  if (bossAgents.length === 0) {
    return null; // No bosses available
  }

  const bossConfig = AGENT_CLASSES.boss;

  const handleLinkToBoss = (bossId: string) => {
    const boss = state.agents.get(bossId);
    if (!boss) return;

    // Add this agent to the boss's subordinates
    const currentSubs = boss.subordinateIds || [];
    store.assignSubordinates(bossId, [...currentSubs, agentId]);
    setIsExpanded(false);
  };

  return (
    <div className="link-to-boss-section">
      {!isExpanded ? (
        <button className="link-to-boss-btn" onClick={() => setIsExpanded(true)}>
          <span className="link-to-boss-icon" style={{ color: bossConfig.color }}>
            {bossConfig.icon}
          </span>
          <span>Link to Boss</span>
        </button>
      ) : (
        <div className="link-to-boss-dropdown">
          <div className="link-to-boss-header">
            <span>Select a Boss</span>
            <button className="link-to-boss-close" onClick={() => setIsExpanded(false)}>
              ✕
            </button>
          </div>
          <div className="link-to-boss-list">
            {bossAgents.map((boss) => (
              <div key={boss.id} className="link-to-boss-item" onClick={() => handleLinkToBoss(boss.id)}>
                <span className="link-to-boss-item-icon" style={{ color: bossConfig.color }}>
                  {bossConfig.icon}
                </span>
                <span className="link-to-boss-item-name">{boss.name}</span>
                <span className="link-to-boss-item-count">{boss.subordinateIds?.length || 0} agents</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export {
  SupervisorHistoryItem,
  BossAgentSection,
  DelegationDecisionItem,
  SubordinateBadge,
  LinkToBossSection,
};
