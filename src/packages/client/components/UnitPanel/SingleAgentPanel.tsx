/**
 * SingleAgentPanel - Detailed view for a single selected agent
 * Includes stats, boss management, and action buttons
 */

import React, { useState, useRef, useEffect, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, store, useCustomAgentClassesArray } from '../../store';
import { getClassConfig } from '../../utils/classConfig';
import { AGENT_STATUS_COLORS } from '../../utils/colors';
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
  CurrentTask,
  WorkingDirectory,
  LastPrompt,
  LastResponse,
} from './AgentStatsRow';
import type {
  SingleAgentPanelProps,
  RememberedPattern,
  ContextAction,
  BossAgentSectionProps,
  DelegationDecisionItemProps,
  SubordinateBadgeProps,
  LinkToBossSectionProps,
} from './types';
import { AgentIcon } from '../AgentIcon';
import { Icon } from '../Icon';
import { ConfirmModal } from '../shared/ConfirmModal';
import { TaskListView } from '../shared/TaskListView';

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
  const { t } = useTranslation(['common']);
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
  const [showPatterns, setShowPatterns] = useState(false);
  const [rememberedPatterns, setRememberedPatterns] = useState<RememberedPattern[]>([]);
  const [contextConfirm, setContextConfirm] = useState<ContextAction>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showContextModal, setShowContextModal] = useState(false);
  const [clearPatternsConfirmOpen, setClearPatternsConfirmOpen] = useState(false);
  const [terminateConfirmOpen, setTerminateConfirmOpen] = useState(false);

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

  const handleClearAllPatterns = () => {
    setClearPatternsConfirmOpen(true);
  };

  const performClearAllPatterns = async () => {
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
    setTerminateConfirmOpen(true);
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
          width={180}
          height={130}
        />
      </div>

      {/* Agent Header */}
      <div className="unit-panel-header">
        <div className="unit-class-icon" style={{ background: `${classConfig.color}20` }}>
          <AgentIcon agent={agent} size={20} />
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
              title={t('unitPanel.clickToRename')}
            >
              {agent.name}
            </div>
          )}
          <div className="unit-status">
            <span style={{ color: AGENT_STATUS_COLORS[agent.status] || AGENT_STATUS_COLORS.default }}>
              {agent.status}
            </span>
            <span> • {agent.class} • {agent.provider}</span>
          </div>
          <div
            className="unit-id"
            title={t('unitPanel.clickToCopy')}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(agent.id);
                showToast('success', t('toast.copied'), agent.id, 2000);
              } catch {
                showToast('error', t('toast.errorTitle'), t('toast.failedToCopy'), 3000);
              }
            }}
          >
            {agent.id}
          </div>
          {/* Idle timer - shows how long agent has been idle */}
          {agent.status === 'idle' && agent.lastActivity > 0 && (
            <IdleTimer lastActivity={agent.lastActivity} />
          )}
        </div>
        <div className="unit-header-actions">
          <button className="unit-action-icon" onClick={() => onFocusAgent(agent.id)} title={t('unitPanel.focusOnAgent')}>
            <Icon name="target" size={16} />
          </button>
          <button
            className="unit-action-icon"
            onClick={() => setShowEditModal(true)}
            title={t('unitPanel.editProperties')}
          >
            <Icon name="edit" size={16} />
          </button>
          {(agent.isBoss || agent.class === 'boss') &&
            agent.subordinateIds &&
            agent.subordinateIds.length > 0 && (
              <button
                className="unit-action-icon"
                onClick={() => onCallSubordinates?.(agent.id)}
                title={t('unitPanel.callSubordinates')}
              >
                <Icon name="announce" size={16} />
              </button>
            )}
          <button
            className="unit-action-icon"
            onClick={() => setContextConfirm('collapse')}
            title={t('unitPanel.collapseContext')}
            disabled={agent.status !== 'idle'}
          >
            <Icon name="package" size={16} />
          </button>
          <button
            className="unit-action-icon warning"
            onClick={() => setContextConfirm('clear')}
            title={t('unitPanel.clearContext')}
          >
            <Icon name="clear" size={16} />
          </button>
          <button className="unit-action-icon danger" onClick={handleKill} title={t('unitPanel.killAgent')}>
            <Icon name="skull" size={16} />
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

      {/* Task Label */}
      {agent.taskLabel && (
        <div className="unit-task-label">
          <div className="unit-stat-label"><Icon name="task" size={12} /> Task</div>
          <div className="unit-task-label-value">{agent.taskLabel}</div>
        </div>
      )}

      {/* Current Task */}
      {agent.currentTask && <CurrentTask task={agent.currentTask} />}

      {/* Latest TodoWrite snapshot */}
      <div className="unit-task-list">
        {agent.latestTodos && agent.latestTodos.length > 0 ? (
          <TaskListView todos={agent.latestTodos} />
        ) : (
          <div className="unit-task-list-empty">{t('unitPanel.noActiveTasks')}</div>
        )}
      </div>

      {/* Working Directory */}
      <WorkingDirectory cwd={agent.cwd} />

      {/* Permission Mode */}
      <div className="unit-permission-mode">
        <div className="unit-stat-label">{t('unitPanel.permissions')}</div>
        <div className="unit-permission-mode-value" title={PERMISSION_MODES[agent.permissionMode]?.description}>
          <span className="unit-permission-mode-icon"><Icon name={agent.permissionMode === 'bypass' ? 'bolt' : 'lock'} size={12} /></span>
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
          <div className="unit-stat-label">{t('unitPanel.resumeSession')}</div>
          <div
            className="unit-resume-cmd-text"
            title={t('unitPanel.clickToCopy')}
            onClick={async () => {
              const resumeCmd = agent.provider === 'codex'
                ? `codex resume ${agent.sessionId}`
                : agent.provider === 'opencode'
                ? `opencode resume ${agent.sessionId}`
                : `claude --resume ${agent.sessionId}`;
              try {
                await navigator.clipboard.writeText(resumeCmd);
                showToast('success', t('toast.copied'), t('toast.resumeCommandCopied'), 2000);
              } catch {
                showToast('error', t('toast.errorTitle'), t('toast.failedToCopy'), 3000);
              }
            }}
          >
            {agent.provider === 'codex' ? 'codex resume' : agent.provider === 'opencode' ? 'opencode resume' : 'claude --resume'} {agent.sessionId}
          </div>
        </div>
      ) : (
        <div className="unit-resume-cmd">
          <div className="unit-stat-label">{t('unitPanel.session')}</div>
          <div className="unit-new-session-indicator">{t('unitPanel.newSession')}</div>
        </div>
      )}

      {/* Session History */}
      <SessionHistorySection agentId={agent.id} />

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

      <ConfirmModal
        isOpen={clearPatternsConfirmOpen}
        title={t('common:buttons.clearAll')}
        message={t('common:confirm.clearPatterns')}
        confirmLabel={t('common:buttons.clearAll')}
        cancelLabel={t('common:buttons.cancel')}
        variant="danger"
        onConfirm={performClearAllPatterns}
        onClose={() => setClearPatternsConfirmOpen(false)}
      />

      <ConfirmModal
        isOpen={terminateConfirmOpen}
        title={t('common:buttons.terminate')}
        message={t('common:confirm.terminateAgent')}
        note={t('common:confirm.cannotBeUndone')}
        confirmLabel={t('common:buttons.terminate')}
        cancelLabel={t('common:buttons.cancel')}
        variant="danger"
        onConfirm={() => onKillAgent(agent.id)}
        onClose={() => setTerminateConfirmOpen(false)}
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
  const { t } = useTranslation(['common']);
  return (
    <div className="unit-remembered-patterns">
      <div className="unit-remembered-patterns-header" onClick={onToggle}>
        <div className="unit-stat-label">{t('unitPanel.allowedPatterns')}</div>
        <span className="unit-remembered-patterns-toggle">
          {patterns.length > 0 && <span className="unit-remembered-patterns-count">{patterns.length}</span>}
          <Icon name={showPatterns ? 'caret-down' : 'caret-right'} size={10} />
        </span>
      </div>
      {showPatterns && (
        <div className="unit-remembered-patterns-list">
          {patterns.length === 0 ? (
            <div className="unit-remembered-patterns-empty">
              {t('unitPanel.noPatterns')}
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
                    title={t('unitPanel.removePattern')}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              ))}
              <button className="unit-patterns-clear-all" onClick={onClearAll}>
                {t('buttons.clearAll')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// SessionHistorySection Component
// ============================================================================

interface PreviewMessage {
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  toolName?: string;
}

interface SessionHistorySectionProps {
  agentId: string;
}

const SessionHistorySection = memo(function SessionHistorySection({ agentId }: SessionHistorySectionProps) {
  const { t } = useTranslation(['common']);
  const [collapsed, setCollapsed] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [previewSessionId, setPreviewSessionId] = useState<string | null>(null);
  const [previewMessages, setPreviewMessages] = useState<PreviewMessage[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const state = useStore();
  const entries = state.sessionHistories.get(agentId) || [];

  const handleToggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    if (!next && !loaded) {
      store.requestSessionHistory(agentId);
      setLoaded(true);
    }
  };

  const handleRestore = (sessionId: string) => {
    store.restoreSession(agentId, sessionId);
    setPreviewSessionId(null);
  };

  const handlePreview = async (sessionId: string) => {
    if (previewSessionId === sessionId) {
      setPreviewSessionId(null);
      return;
    }
    setPreviewSessionId(sessionId);
    setPreviewLoading(true);
    setPreviewMessages([]);
    try {
      const res = await authFetch(apiUrl(`/api/agents/${agentId}/session-preview/${sessionId}?limit=30`));
      if (!res.ok) {
        console.error(`Session preview failed: ${res.status}`);
        setPreviewMessages([]);
      } else {
        const data = await res.json();
        setPreviewMessages(data.messages || []);
      }
    } catch (err) {
      console.error('Session preview error:', err);
      setPreviewMessages([]);
    } finally {
      setPreviewLoading(false);
    }
  };

  const formatDate = (ts: number) => {
    const now = Date.now();
    const diff = now - ts;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <div className="unit-session-history">
      <div className="unit-session-history-header" onClick={handleToggle}>
        <div className="unit-stat-label">{t('unitPanel.sessionHistory', 'Session History')}</div>
        <span className="unit-session-history-toggle">
          {entries.length > 0 && (
            <span className="unit-session-history-count">{entries.length}</span>
          )}
          <Icon name={collapsed ? 'caret-right' : 'caret-down'} size={10} />
        </span>
      </div>
      {!collapsed && (
        <div className="unit-session-history-list">
          {entries.length === 0 ? (
            <div className="unit-session-history-empty">
              {t('unitPanel.noSessionHistory', 'No previous sessions')}
            </div>
          ) : (
            entries.map((entry) => (
              <div key={entry.sessionId}>
                <div className={`unit-session-history-item ${previewSessionId === entry.sessionId ? 'active' : ''}`}>
                  {entry.fileExists === false && (
                    <span className="unit-session-history-missing" title="Session file missing from disk"><Icon name="warn" size={12} /></span>
                  )}
                  <div
                    className="unit-session-history-item-info"
                    onClick={() => handlePreview(entry.sessionId)}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="unit-session-history-item-summary" title={entry.summary}>
                      {entry.summary.length > 60 ? entry.summary.slice(0, 60) + '...' : entry.summary}
                    </span>
                    <span className="unit-session-history-item-date">{formatDate(entry.endedAt)}</span>
                  </div>
                  <button
                    className="unit-session-history-restore-btn"
                    onClick={() => handleRestore(entry.sessionId)}
                    title={t('unitPanel.restoreSession', 'Restore this session')}
                    disabled={entry.fileExists === false}
                  >
                    <Icon name="revert" size={12} />
                  </button>
                </div>
                {previewSessionId === entry.sessionId && (
                  <div className="unit-session-preview">
                    {previewLoading ? (
                      <div className="unit-session-preview-loading">Loading...</div>
                    ) : previewMessages.length === 0 ? (
                      <div className="unit-session-preview-empty">No messages found</div>
                    ) : (
                      previewMessages
                        .filter((m) => m.type === 'user' || m.type === 'assistant' || m.type === 'tool_use')
                        .map((msg, i) => {
                          if (msg.type === 'tool_use') {
                            return (
                              <div key={i} className="unit-session-preview-msg tool">
                                <span className="unit-session-preview-tool-chip">{msg.toolName || 'Tool'}</span>
                              </div>
                            );
                          }
                          const maxLen = msg.type === 'user' ? 300 : 400;
                          const text = msg.content.length > maxLen ? msg.content.slice(0, maxLen) + '...' : msg.content;
                          return (
                            <div key={i} className={`unit-session-preview-msg ${msg.type}`}>
                              <div className="unit-session-preview-role-chip">
                                {msg.type === 'user' ? 'YOU' : 'AGENT'}
                              </div>
                              <div className="unit-session-preview-text">{text}</div>
                            </div>
                          );
                        })
                    )}
                  </div>
                )}
              </div>
            ))
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
  const { t } = useTranslation(['common']);
  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);
  return (
    <div className="modal-overlay visible" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
      <div className="modal confirm-modal">
        <div className="modal-header">{action === 'collapse' ? t('unitPanel.collapseContextTitle') : t('unitPanel.clearContextTitle')}</div>
        <div className="modal-body confirm-modal-body">
          {action === 'collapse' ? (
            <>
              <p dangerouslySetInnerHTML={{ __html: t('unitPanel.collapseContextMsg', { name: agentName }) }} />
              <p className="confirm-modal-note">
                {t('unitPanel.collapseContextNote')}
              </p>
            </>
          ) : (
            <>
              <p dangerouslySetInnerHTML={{ __html: t('unitPanel.clearContextMsg', { name: agentName }) }} />
              <p className="confirm-modal-note">
                {t('unitPanel.clearContextNote')}
              </p>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            {t('buttons.cancel')}
          </button>
          <button
            className={`btn ${action === 'clear' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            autoFocus
          >
            {action === 'collapse' ? t('unitPanel.collapseBtn') : t('unitPanel.clearContextBtn')}
          </button>
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// BossAgentSection Component
// ============================================================================

const BossAgentSection = memo(function BossAgentSection({ agent }: BossAgentSectionProps) {
  const { t } = useTranslation(['common']);
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
          <AgentIcon classId="boss" size={20} />
        </span>
        <span className="boss-title">{t('unitPanel.bossAgent')}</span>
      </div>

      {/* Subordinates List */}
      <div className="boss-subordinates">
        <div className="boss-subordinates-header" onClick={() => setShowSubordinates(!showSubordinates)}>
          <div className="unit-stat-label">{t('labels.team')} ({subordinates.length})</div>
          <span className="boss-toggle"><Icon name={showSubordinates ? 'caret-down' : 'caret-right'} size={10} /></span>
        </div>
        {showSubordinates && (
          <div className="boss-subordinates-list">
            {subordinates.length === 0 ? (
              <div className="boss-subordinates-empty">
                {t('unitPanel.noSubordinates')}
              </div>
            ) : (
              subordinates.map((sub) => {
                const subClassConfig = getClassConfig(sub.class, customClasses);
                const subordinateContextInfo = calculateContextInfo(sub);
                const subordinateContextPercent = Math.max(0, Math.min(100, Math.round(subordinateContextInfo.usedPercent)));
                const subordinateContextHue = Math.round((1 - subordinateContextPercent / 100) * 120); // 120=green, 0=red
                const subordinateContextStyle = {
                  width: `${subordinateContextPercent}%`,
                  '--boss-context-hue': `${subordinateContextHue}`,
                } as React.CSSProperties;
                return (
                  <div
                    key={sub.id}
                    className="boss-subordinate-item"
                    onClick={() => {
                      store.selectAgent(sub.id);
                      store.setTerminalOpen(true);
                    }}
                  >
                    <span className="boss-subordinate-icon" style={{ color: subClassConfig.color }}>
                      <AgentIcon agent={sub} size={16} customClasses={customClasses} />
                    </span>
                    <div className="boss-subordinate-meta">
                      <span className="boss-subordinate-name">{sub.name}</span>
                      <div className="boss-subordinate-context" title={`${subordinateContextPercent}% context used`}>
                        <div className="boss-subordinate-context-track">
                          <div
                            className="boss-subordinate-context-fill"
                            style={subordinateContextStyle}
                          />
                        </div>
                        <span className="boss-subordinate-context-value">{subordinateContextPercent}%</span>
                      </div>
                    </div>
                    <span className={`boss-subordinate-status status-${sub.status}`}>{sub.status}</span>
                    <button
                      className="boss-subordinate-unlink"
                      onClick={(e) => {
                        e.stopPropagation();
                        store.removeSubordinate(agent.id, sub.id);
                      }}
                      title={t('unitPanel.unlinkSubordinate')}
                    >
                      <Icon name="close" size={12} />
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
          <div className="unit-stat-label">{t('unitPanel.delegationHistory')} ({delegationHistory.length})</div>
          <span className="boss-toggle"><Icon name={showDelegationHistory ? 'caret-down' : 'caret-right'} size={10} /></span>
        </div>
        {showDelegationHistory && (
          <div className="boss-delegation-history-list">
            {isPendingForThisBoss && (
              <div className="boss-delegation-pending">
                <span className="delegation-spinner"><Icon name="status-starting" size={12} /></span>
                {t('unitPanel.analyzingRequest')}
              </div>
            )}
            {delegationHistory.length === 0 && !isPendingForThisBoss ? (
              <div className="boss-delegation-empty">
                {t('unitPanel.noDelegationHistory')}
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
  const { t } = useTranslation(['common']);
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
        <span className="delegation-decision-arrow"><Icon name={expanded ? 'caret-down' : 'caret-right'} size={10} /></span>
        {targetClassConfig && targetAgent && (
          <span className="delegation-decision-icon" style={{ color: targetClassConfig.color }}>
            <AgentIcon agent={targetAgent} size={14} />
          </span>
        )}
        <span className="delegation-decision-agent"><Icon name="subitem" size={10} /> {decision.selectedAgentName}</span>
        <span
          className="delegation-decision-confidence"
          style={{ color: confidenceColors[decision.confidence] }}
          title={t('unitPanel.confidence', { level: decision.confidence })}
        >
          {decision.confidence === 'high' ? '●●●' : decision.confidence === 'medium' ? '●●○' : '●○○'}
        </span>
        <span className="delegation-decision-time">{formatRelativeTime(decision.timestamp)}</span>
      </div>
      {expanded && (
        <div className="delegation-decision-details">
          <div className="delegation-decision-command">
            <strong>{t('labels.command')}:</strong>
            <div className="delegation-command-text">
              {decision.userCommand.length > 200 ? decision.userCommand.slice(0, 200) + '...' : decision.userCommand}
            </div>
          </div>
          <div className="delegation-decision-reasoning">
            <strong>{t('labels.reasoning')}:</strong> {decision.reasoning}
          </div>
          {decision.alternativeAgents.length > 0 && (
            <div className="delegation-decision-alternatives">
              <strong>{t('labels.alternatives')}:</strong> {decision.alternativeAgents.join(', ')}
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
  const { t } = useTranslation(['common']);
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
        <AgentIcon agent={boss} size={16} />
      </span>
      <span className="subordinate-badge-text">
        {t('labels.reportsTo')}: <strong>{boss.name}</strong>
      </span>
      <button className="subordinate-badge-goto" onClick={() => store.selectAgent(bossId)} title={t('unitPanel.goToBoss')}>
        <Icon name="subitem" size={12} />
      </button>
      <button className="subordinate-badge-unlink" onClick={handleUnlink} title={t('unitPanel.unlinkFromBoss')}>
        <Icon name="close" size={12} />
      </button>
    </div>
  );
});

// ============================================================================
// LinkToBossSection Component
// ============================================================================

const LinkToBossSection = memo(function LinkToBossSection({ agentId }: LinkToBossSectionProps) {
  const { t } = useTranslation(['common']);
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
            <AgentIcon classId="boss" size={16} />
          </span>
          <span>{t('unitPanel.linkToBoss')}</span>
        </button>
      ) : (
        <div className="link-to-boss-dropdown">
          <div className="link-to-boss-header">
            <span>{t('unitPanel.selectBoss')}</span>
            <button className="link-to-boss-close" onClick={() => setIsExpanded(false)}>
              <Icon name="close" size={12} />
            </button>
          </div>
          <div className="link-to-boss-list">
            {bossAgents.map((boss) => (
              <div key={boss.id} className="link-to-boss-item" onClick={() => handleLinkToBoss(boss.id)}>
                <span className="link-to-boss-item-icon" style={{ color: bossConfig.color }}>
                  <AgentIcon agent={boss} size={16} />
                </span>
                <span className="link-to-boss-item-name">{boss.name}</span>
                <span className="link-to-boss-item-count">{t('unitPanel.agentsCount', { count: boss.subordinateIds?.length || 0 })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

export {
  BossAgentSection,
  DelegationDecisionItem,
  SubordinateBadge,
  LinkToBossSection,
};
