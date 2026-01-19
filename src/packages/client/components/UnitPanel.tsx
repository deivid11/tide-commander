import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useStore, store, useCustomAgentClassesArray } from '../store';
import { AGENT_CLASS_CONFIG } from '../scene/config';
import { formatNumber, intToHex, formatTokens, formatTimeAgo, formatIdleTime, getIdleTimerColor, filterCostText } from '../utils/formatting';
import { ModelPreview } from './ModelPreview';
import { AgentEditModal } from './AgentEditModal';
import { ContextViewModal } from './ContextViewModal';
import type { Agent, DrawingArea, AgentSupervisorHistoryEntry, PermissionMode, DelegationDecision, CustomAgentClass } from '../../shared/types';
import { PERMISSION_MODES, AGENT_CLASSES } from '../../shared/types';

// Helper to normalize color to hex string
function normalizeColor(color: number | string): string {
  if (typeof color === 'string') return color;
  return intToHex(color);
}

// Helper to get class config (built-in or custom)
function getClassConfig(agentClass: string, customClasses: CustomAgentClass[]): { icon: string; color: string; description?: string } {
  const builtIn = AGENT_CLASS_CONFIG[agentClass];
  if (builtIn) {
    return {
      icon: builtIn.icon,
      color: normalizeColor(builtIn.color),
      description: builtIn.description,
    };
  }

  const custom = customClasses.find(c => c.id === agentClass);
  if (custom) {
    return {
      icon: custom.icon,
      color: custom.color,
      description: custom.description,
    };
  }

  // Fallback
  return { icon: '🤖', color: '#888888' };
}

// Progress indicator colors (used by supervisor status components)
const PROGRESS_COLORS: Record<string, string> = {
  on_track: '#4aff9e',
  stalled: '#ff9e4a',
  blocked: '#ff4a4a',
  completed: '#4a9eff',
  idle: '#888888',
};

interface UnitPanelProps {
  onFocusAgent: (agentId: string) => void;
  onKillAgent: (agentId: string) => void;
  onCallSubordinates?: (bossId: string) => void;
  onOpenAreaExplorer?: (areaId: string) => void;
}

export function UnitPanel({ onFocusAgent, onKillAgent, onCallSubordinates, onOpenAreaExplorer }: UnitPanelProps) {
  const state = useStore();
  const selectedAgents = store.getSelectedAgents();

  if (state.selectedAgentIds.size === 0) {
    return <AgentsList onOpenAreaExplorer={onOpenAreaExplorer} />;
  }

  if (state.selectedAgentIds.size === 1) {
    const agent = selectedAgents[0];
    if (!agent) return <AgentsList onOpenAreaExplorer={onOpenAreaExplorer} />;
    return (
      <SingleAgentPanel
        agent={agent}
        onFocusAgent={onFocusAgent}
        onKillAgent={onKillAgent}
        onCallSubordinates={onCallSubordinates}
        onOpenAreaExplorer={onOpenAreaExplorer}
      />
    );
  }

  return <MultiAgentPanel agents={selectedAgents} />;
}

interface AgentsListProps {
  onOpenAreaExplorer?: (areaId: string) => void;
}

function AgentsList({ onOpenAreaExplorer }: AgentsListProps) {
  const state = useStore();
  const agentsArray = Array.from(state.agents.values());
  const areasArray = Array.from(state.areas.values());

  // Create a stable key for agent IDs to avoid re-running effect on every render
  const agentIds = useMemo(() => agentsArray.map(a => a.id).sort().join(','), [agentsArray]);

  // Track which agents we've already requested history for (avoid duplicate requests)
  const requestedHistoryRef = useRef<Set<string>>(new Set());

  // Request supervisor history for all agents that don't have it yet (only once per agent)
  useEffect(() => {
    for (const agent of agentsArray) {
      // Skip if we've already requested this agent's history
      if (requestedHistoryRef.current.has(agent.id)) continue;

      const history = store.getAgentSupervisorHistory(agent.id);
      if (history.length === 0 && !store.isLoadingHistoryForAgent(agent.id)) {
        requestedHistoryRef.current.add(agent.id);
        store.requestAgentSupervisorHistory(agent.id);
      }
    }
  }, [agentIds]);

  // Group agents by area
  const agentsByArea = new Map<string | null, Agent[]>();

  for (const agent of agentsArray) {
    const area = store.getAreaForAgent(agent.id);
    const areaId = area?.id || null;
    if (!agentsByArea.has(areaId)) {
      agentsByArea.set(areaId, []);
    }
    agentsByArea.get(areaId)!.push(agent);
  }

  // Make sure all areas are included (even empty ones)
  for (const area of areasArray) {
    if (!agentsByArea.has(area.id)) {
      agentsByArea.set(area.id, []);
    }
  }

  // Sort: areas first (alphabetically), then unassigned
  const sortedAreaIds = Array.from(agentsByArea.keys()).sort((a, b) => {
    if (a === null) return 1;
    if (b === null) return -1;
    const areaA = state.areas.get(a);
    const areaB = state.areas.get(b);
    return (areaA?.name || '').localeCompare(areaB?.name || '');
  });

  // Show empty state only if no agents AND no areas
  if (agentsArray.length === 0 && areasArray.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">⚔️</div>
        <div className="empty-state-title">No Agents Deployed</div>
        <div className="empty-state-desc">Click "+ New Agent" to deploy your first agent</div>
      </div>
    );
  }

  return (
    <div className="agents-list">
      <div className="agents-list-header">Areas & Agents</div>
      {sortedAreaIds.map((areaId) => {
        const agents = agentsByArea.get(areaId)!;
        const area = areaId ? state.areas.get(areaId) : null;

        return (
          <div key={areaId || 'unassigned'} className="agents-group">
            <div
              className="agents-group-header"
              style={area ? {
                borderLeftColor: area.color,
                background: `${area.color}15`
              } : undefined}
            >
              {area ? (
                <>
                  <span className="agents-group-dot" style={{ background: area.color }} />
                  <span className="agents-group-name">{area.name}</span>
                  {area.directories.length > 0 && (
                    <button
                      className="area-browse-btn"
                      onClick={() => onOpenAreaExplorer?.(area.id)}
                      title="Browse files"
                    >
                      📂
                    </button>
                  )}
                </>
              ) : (
                <span className="agents-group-name unassigned">Unassigned</span>
              )}
              <span className="agents-group-count">{agents.length}</span>
            </div>

            {agents.length > 0 && (
              <div
                className="agents-group-items"
                style={area ? { background: `${area.color}08` } : undefined}
              >
                {agents.map((agent) => (
                  <AgentListItem key={agent.id} agent={agent} area={area} />
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Global Supervisor Status - show latest status for all agents from history */}
      {agentsArray.length > 0 && (
        <GlobalSupervisorStatus agents={agentsArray} />
      )}
    </div>
  );
}

interface AgentListItemProps {
  agent: Agent;
  area?: DrawingArea | null;
}

function AgentListItem({ agent, area }: AgentListItemProps) {
  const state = useStore();
  const customClasses = useCustomAgentClassesArray();
  const classConfig = getClassConfig(agent.class, customClasses);
  const isSelected = state.selectedAgentIds.has(agent.id);
  const [, setTick] = useState(0);

  // Update idle timer every 15 seconds when agent is idle
  useEffect(() => {
    if (agent.status === 'idle') {
      const interval = setInterval(() => {
        setTick(t => t + 1);
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [agent.status]);

  const handleClick = () => {
    store.selectAgent(agent.id);
  };

  // Get idle timer color
  const showIdleClock = agent.status === 'idle' && agent.lastActivity > 0;
  const idleColor = agent.lastActivity > 0 ? getIdleTimerColor(agent.lastActivity) : undefined;

  // Format compact idle time (e.g., "2m", "1h")
  const formatIdleCompact = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  return (
    <div className={`agent-item ${isSelected ? 'selected' : ''}`} onClick={handleClick}>
      <div className="agent-item-icon" style={{ background: `${classConfig.color}20` }}>
        {classConfig.icon}
      </div>
      <div className="agent-item-info">
        <div className="agent-item-name">{agent.name}</div>
        <div className="agent-item-status">
          {agent.status}
          {agent.currentTool ? ` • ${agent.currentTool}` : ''}
          {showIdleClock && (
            <span className="agent-item-idle" style={{ color: idleColor }} title={formatIdleTime(agent.lastActivity)}>
              {' '}⏱ {formatIdleCompact(agent.lastActivity)}
            </span>
          )}
        </div>
      </div>
      <div className={`agent-status-dot ${agent.status}`}></div>
    </div>
  );
}

// Global supervisor status shown when no agent is selected
interface GlobalSupervisorStatusProps {
  agents: Agent[];
}

function GlobalSupervisorStatus({ agents }: GlobalSupervisorStatusProps) {
  const state = useStore();
  const customClasses = useCustomAgentClassesArray();
  const hideCost = state.settings.hideCost;
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('tide-global-supervisor-collapsed') === 'true';
  });

  const handleToggle = () => {
    const newValue = !collapsed;
    setCollapsed(newValue);
    localStorage.setItem('tide-global-supervisor-collapsed', String(newValue));
  };

  // Format relative time
  const formatRelativeTime = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  // Get the most recent supervisor history entry for each agent
  const agentStatuses = useMemo(() => {
    return agents
      .map(agent => {
        const history = store.getAgentSupervisorHistory(agent.id);
        const latestEntry = history.length > 0 ? history[0] : null;
        return {
          agent,
          entry: latestEntry,
          timestamp: latestEntry?.timestamp || agent.lastActivity || 0,
        };
      })
      .filter(item => item.entry !== null)
      .sort((a, b) => b.timestamp - a.timestamp); // Most recent first
  }, [agents, state.supervisor.agentHistories]);

  // Find the most recent timestamp for the header
  const mostRecentTimestamp = agentStatuses.length > 0 ? agentStatuses[0].timestamp : Date.now();

  if (agentStatuses.length === 0) {
    return null;
  }

  return (
    <div className="global-supervisor-status">
      <div className="global-supervisor-header" onClick={handleToggle}>
        <span className="global-supervisor-toggle">{collapsed ? '▶' : '▼'}</span>
        <span className="global-supervisor-title">Supervisor Status</span>
        <span className="global-supervisor-time">{formatRelativeTime(mostRecentTimestamp)}</span>
      </div>
      {!collapsed && (
        <div className="global-supervisor-list">
          {agentStatuses.map(({ agent, entry }) => {
            const classConfig = getClassConfig(agent.class, customClasses);
            const analysis = entry!.analysis;

            return (
              <div
                key={agent.id}
                className="global-supervisor-item"
                onClick={() => store.selectAgent(agent.id)}
              >
                <div className="global-supervisor-item-header">
                  <span
                    className="global-supervisor-progress-dot"
                    style={{ background: PROGRESS_COLORS[analysis.progress] || '#888' }}
                  />
                  <span className="global-supervisor-agent-icon">{classConfig.icon}</span>
                  <span className="global-supervisor-agent-name">{agent.name}</span>
                  <span className="global-supervisor-item-time">
                    {formatRelativeTime(entry!.timestamp)}
                  </span>
                </div>
                <div className="global-supervisor-status-line">
                  {filterCostText(analysis.statusDescription, hideCost)}
                </div>
                <div className="global-supervisor-summary-text">
                  {filterCostText(analysis.recentWorkSummary, hideCost)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SingleAgentPanelProps {
  agent: Agent;
  onFocusAgent: (agentId: string) => void;
  onKillAgent: (agentId: string) => void;
  onCallSubordinates?: (bossId: string) => void;
  onOpenAreaExplorer?: (areaId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  idle: '#4aff9e',
  working: '#4a9eff',
  waiting: '#ff9e4a',
  waiting_permission: '#ffcc00', // Yellow/gold for awaiting permission
  error: '#ff4a4a',
  offline: '#888888',
  orphaned: '#ff00ff', // Magenta for orphaned (untracked) processes
};

// Remembered pattern type (matches server)
interface RememberedPattern {
  tool: string;
  pattern: string;
  description: string;
  createdAt: number;
}

function SingleAgentPanel({ agent: agentProp, onFocusAgent, onKillAgent, onCallSubordinates, onOpenAreaExplorer }: SingleAgentPanelProps) {
  const state = useStore();
  const customClasses = useCustomAgentClassesArray();
  // Get the latest agent data from the store to ensure we have current values
  const agent = state.agents.get(agentProp.id) || agentProp;
  const classConfig = getClassConfig(agent.class, customClasses);
  const [isEditingName, setIsEditingName] = useState(false);
  const [editName, setEditName] = useState(agent.name);
  const [, setTick] = useState(0); // For forcing re-render of idle timer
  const [showHistory, setShowHistory] = useState(true);
  const [showPatterns, setShowPatterns] = useState(false);
  const [rememberedPatterns, setRememberedPatterns] = useState<RememberedPattern[]>([]);
  const [contextConfirm, setContextConfirm] = useState<'collapse' | 'clear' | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showContextModal, setShowContextModal] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

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
        setTick(t => t + 1);
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [agent.status]);

  // Fetch remembered patterns for interactive mode agents
  useEffect(() => {
    if (agent.permissionMode === 'interactive') {
      fetch('http://localhost:5174/api/remembered-patterns')
        .then(res => res.json())
        .then(setRememberedPatterns)
        .catch(err => console.error('Failed to fetch remembered patterns:', err));
    }
  }, [agent.permissionMode]);

  // Handler to remove a remembered pattern
  const handleRemovePattern = async (tool: string, pattern: string) => {
    try {
      const res = await fetch(`http://localhost:5174/api/remembered-patterns/${tool}/${encodeURIComponent(pattern)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setRememberedPatterns(prev => prev.filter(p => !(p.tool === tool && p.pattern === pattern)));
      }
    } catch (err) {
      console.error('Failed to remove pattern:', err);
    }
  };

  // Handler to clear all patterns
  const handleClearAllPatterns = async () => {
    if (!confirm('Clear all remembered permission patterns?')) return;
    try {
      const res = await fetch('http://localhost:5174/api/remembered-patterns', {
        method: 'DELETE',
      });
      if (res.ok) {
        setRememberedPatterns([]);
      }
    } catch (err) {
      console.error('Failed to clear patterns:', err);
    }
  };

  // Calculate remaining context from contextStats (from /context command) or fallback to basic
  const contextInfo = useMemo(() => {
    const stats = agent.contextStats;
    if (stats) {
      // Use data from /context command
      // NOTE: freeSpace.percent is just one category (excludes autocompact buffer)
      // The actual remaining context is 100 - usedPercent
      const usedPercent = stats.usedPercent;
      const freePercent = 100 - usedPercent;
      const freeTokens = stats.contextWindow - stats.totalTokens;
      return {
        remainingPercent: freePercent,
        usedPercent,
        hasData: true,
        totalTokens: stats.totalTokens,
        contextWindow: stats.contextWindow,
        freeTokens: freeTokens,
      };
    }
    // Fallback to basic calculation if no /context data
    const used = agent.contextUsed || 0;
    const limit = agent.contextLimit || 200000;
    const remaining = Math.max(0, limit - used);
    return {
      remainingPercent: (remaining / limit) * 100,
      usedPercent: (used / limit) * 100,
      hasData: false,
      totalTokens: used,
      contextWindow: limit,
      freeTokens: remaining,
    };
  }, [agent.contextStats, agent.contextUsed, agent.contextLimit]);

  // Keep old variable for backwards compatibility
  const contextRemainingPercent = contextInfo.remainingPercent;

  // Get assigned area for this agent
  const assignedArea = store.getAreaForAgent(agent.id);

  // Get last output message for this agent
  const agentOutputs = state.agentOutputs.get(agent.id) || [];
  const lastOutput = agentOutputs.length > 0 ? agentOutputs[agentOutputs.length - 1] : null;

  // Get last prompt for this agent
  const lastPrompt = state.lastPrompts.get(agent.id);

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
            <span style={{ color: STATUS_COLORS[agent.status] }}>{agent.status}</span>
            <span> • {agent.class}</span>
          </div>
          {/* Idle timer - shows how long agent has been idle */}
          {agent.status === 'idle' && agent.lastActivity > 0 && (
            <div
              className="unit-idle-timer"
              title="Time since last activity"
              style={{ color: getIdleTimerColor(agent.lastActivity) }}
            >
              ⏱ {formatIdleTime(agent.lastActivity)}
            </div>
          )}
        </div>
        <div className="unit-header-actions">
          <button
            className="unit-action-icon"
            onClick={() => onFocusAgent(agent.id)}
            title="Focus on agent"
          >
            🎯
          </button>
          <button
            className="unit-action-icon"
            onClick={() => setShowEditModal(true)}
            title="Edit agent properties"
          >
            ✏️
          </button>
          {agent.class === 'boss' && agent.subordinateIds && agent.subordinateIds.length > 0 && (
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
          <button
            className="unit-action-icon danger"
            onClick={handleKill}
            title="Kill agent"
          >
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
      {lastPrompt && (
        <div className="unit-last-prompt">
          <div className="unit-stat-label">Last Prompt</div>
          <div className="unit-last-prompt-text">
            {lastPrompt.text.length > 150
              ? lastPrompt.text.slice(0, 150) + '...'
              : lastPrompt.text}
          </div>
        </div>
      )}

      {/* Last Response */}
      {lastOutput && (
        <div className="unit-last-message">
          <div className="unit-stat-label">Last Response</div>
          <div className="unit-last-message-text">
            {lastOutput.text.length > 200
              ? lastOutput.text.slice(0, 200) + '...'
              : lastOutput.text}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="unit-stats">
        <div className="unit-stat">
          <div className="unit-stat-label">Tokens</div>
          <div className="unit-stat-value">{formatTokens(agent.tokensUsed)}</div>
        </div>
        <div className="unit-stat">
          <div className="unit-stat-label">Uptime</div>
          <div className="unit-stat-value">{formatTimeAgo(agent.createdAt)}</div>
        </div>
      </div>

      {/* Context Bar - shows remaining context like the mana bar */}
      <div
        className="unit-context unit-context-clickable"
        onClick={() => setShowContextModal(true)}
        title={contextInfo.hasData ? "Click for detailed context breakdown" : "Click to fetch context stats"}
        style={{ cursor: 'pointer' }}
      >
        <div className="unit-stat-label" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span>Remaining Context</span>
          {contextInfo.hasData ? (
            <span style={{ fontSize: '10px', opacity: 0.6 }}>📊</span>
          ) : (
            <span style={{ fontSize: '9px', color: '#ff9e4a', opacity: 0.8 }} title="Click to fetch accurate stats">⚠️</span>
          )}
        </div>
        {contextInfo.hasData ? (
          <>
            <div className="unit-context-bar">
              <div
                className="unit-context-fill"
                style={{
                  width: `${contextRemainingPercent}%`,
                  background:
                    contextRemainingPercent < 20
                      ? '#ff4a4a'
                      : contextRemainingPercent < 50
                        ? '#ff9e4a'
                        : '#4aff9e',
                }}
              />
            </div>
            <span className="unit-context-value">{Math.round(contextRemainingPercent)}%</span>
          </>
        ) : (
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            Not retrieved yet
          </div>
        )}
      </div>

      {/* Current Tool */}
      {agent.currentTool && (
        <div className="unit-current-tool">
          <span className="unit-stat-label">Using:</span>
          <span className="unit-tool-name">{agent.currentTool}</span>
        </div>
      )}

      {/* Current Task */}
      {agent.currentTask && (
        <div className="unit-task">
          <div className="unit-stat-label">Task</div>
          <div className="unit-task-text">{agent.currentTask}</div>
        </div>
      )}

      {/* Working Directory */}
      <div className="unit-cwd">
        <div className="unit-stat-label">CWD</div>
        <div className="unit-cwd-path" title={agent.cwd}>{agent.cwd}</div>
      </div>

      {/* Permission Mode */}
      <div className="unit-permission-mode">
        <div className="unit-stat-label">Permissions</div>
        <div className="unit-permission-mode-value" title={PERMISSION_MODES[agent.permissionMode]?.description}>
          <span className="unit-permission-mode-icon">
            {agent.permissionMode === 'bypass' ? '⚡' : '🔐'}
          </span>
          <span className="unit-permission-mode-label">
            {PERMISSION_MODES[agent.permissionMode]?.label || agent.permissionMode}
          </span>
        </div>
      </div>

      {/* Remembered Patterns (only for interactive mode) */}
      {agent.permissionMode === 'interactive' && (
        <div className="unit-remembered-patterns">
          <div
            className="unit-remembered-patterns-header"
            onClick={() => setShowPatterns(!showPatterns)}
          >
            <div className="unit-stat-label">Allowed Patterns</div>
            <span className="unit-remembered-patterns-toggle">
              {rememberedPatterns.length > 0 && (
                <span className="unit-remembered-patterns-count">{rememberedPatterns.length}</span>
              )}
              {showPatterns ? '▼' : '▶'}
            </span>
          </div>
          {showPatterns && (
            <div className="unit-remembered-patterns-list">
              {rememberedPatterns.length === 0 ? (
                <div className="unit-remembered-patterns-empty">
                  No patterns remembered yet. Click ✓+ when approving to remember.
                </div>
              ) : (
                <>
                  {rememberedPatterns.map((p, i) => (
                    <div key={i} className="unit-remembered-pattern-item">
                      <span className="unit-pattern-tool">{p.tool}</span>
                      <span className="unit-pattern-desc" title={p.pattern}>{p.description}</span>
                      <button
                        className="unit-pattern-remove"
                        onClick={() => handleRemovePattern(p.tool, p.pattern)}
                        title="Remove this pattern"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    className="unit-patterns-clear-all"
                    onClick={handleClearAllPatterns}
                  >
                    Clear All
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Resume Session Command */}
      {agent.sessionId && (
        <div className="unit-resume-cmd">
          <div className="unit-stat-label">Resume Session</div>
          <div
            className="unit-resume-cmd-text"
            title="Click to copy"
            onClick={() => {
              navigator.clipboard.writeText(`claude --resume ${agent.sessionId}`);
            }}
          >
            claude --resume {agent.sessionId}
          </div>
        </div>
      )}

      {/* Supervisor History */}
      <div className="unit-supervisor-history">
        <div
          className="unit-supervisor-history-header"
          onClick={() => setShowHistory(!showHistory)}
        >
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
              supervisorHistory.slice(0, 10).map((entry, index) => (
                <SupervisorHistoryItem key={entry.id} entry={entry} defaultExpanded={index === 0} />
              ))
            )}
          </div>
        )}
      </div>

      {/* Boss-Specific Section */}
      {agent.class === 'boss' && (
        <BossAgentSection agent={agent} />
      )}

      {/* Subordinate Badge (if agent has a boss) */}
      {agent.bossId && (
        <SubordinateBadge agentId={agent.id} bossId={agent.bossId} />
      )}

      {/* Link to Boss option (if agent is not a boss and has no boss) */}
      {agent.class !== 'boss' && !agent.bossId && (
        <LinkToBossSection agentId={agent.id} />
      )}

      {/* Context Action Confirmation Modal */}
      {contextConfirm && (
        <div className="modal-overlay visible" onClick={() => setContextConfirm(null)}>
          <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              {contextConfirm === 'collapse' ? 'Collapse Context' : 'Clear Context'}
            </div>
            <div className="modal-body confirm-modal-body">
              {contextConfirm === 'collapse' ? (
                <>
                  <p>Collapse the conversation context for <strong>{agent.name}</strong>?</p>
                  <p className="confirm-modal-note">
                    This will summarize the conversation to save tokens while preserving important information.
                  </p>
                </>
              ) : (
                <>
                  <p>Clear all context for <strong>{agent.name}</strong>?</p>
                  <p className="confirm-modal-note">
                    This will start a fresh session on the next command. All conversation history will be lost.
                  </p>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setContextConfirm(null)}>
                Cancel
              </button>
              <button
                className={`btn ${contextConfirm === 'clear' ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => {
                  if (contextConfirm === 'collapse') {
                    store.collapseContext(agent.id);
                  } else {
                    store.clearContext(agent.id);
                  }
                  setContextConfirm(null);
                }}
                autoFocus
              >
                {contextConfirm === 'collapse' ? 'Collapse' : 'Clear Context'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Agent Edit Modal */}
      <AgentEditModal
        agent={agent}
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
      />

      {/* Context View Modal */}
      <ContextViewModal
        agent={agent}
        isOpen={showContextModal}
        onClose={() => setShowContextModal(false)}
        onRefresh={() => {
          // Request context refresh via /context command
          store.refreshAgentContext(agent.id);
        }}
      />
    </div>
  );
}

interface MultiAgentPanelProps {
  agents: Agent[];
}

function MultiAgentPanel({ agents }: MultiAgentPanelProps) {
  const customClasses = useCustomAgentClassesArray();
  const totalTokens = agents.reduce((sum, a) => sum + a.tokensUsed, 0);
  const workingCount = agents.filter((a) => a.status === 'working').length;

  return (
    <div className="unit-panel">
      <div className="unit-panel-header">
        <div className="unit-class-icon" style={{ background: '#4a9eff20' }}>
          👥
        </div>
        <div>
          <div className="unit-name">{agents.length} Agents Selected</div>
          <div className="unit-status">Group selection</div>
        </div>
      </div>

      <div className="unit-stats">
        <div className="unit-stat">
          <div className="unit-stat-label">Total Tokens</div>
          <div className="unit-stat-value">{formatNumber(totalTokens)}</div>
        </div>
        <div className="unit-stat">
          <div className="unit-stat-label">Working</div>
          <div className="unit-stat-value">{workingCount}</div>
        </div>
      </div>

      <div style={{ padding: '8px 0', maxHeight: 100, overflowY: 'auto' }}>
        {agents.map((a) => {
          const cfg = getClassConfig(a.class, customClasses);
          return (
            <div
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 0',
                fontSize: 12,
              }}
            >
              <span>{cfg.icon}</span>
              <span style={{ flex: 1 }}>{a.name}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{a.status}</span>
            </div>
          );
        })}
      </div>

      <div className="unit-actions">
        <button className="unit-action-btn" onClick={() => store.deselectAll()}>
          Deselect All
        </button>
      </div>
    </div>
  );
}

interface SupervisorHistoryItemProps {
  entry: AgentSupervisorHistoryEntry;
  defaultExpanded?: boolean;
}

function SupervisorHistoryItem({ entry, defaultExpanded = false }: SupervisorHistoryItemProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const state = useStore();
  const { analysis } = entry;
  const hideCost = state.settings.hideCost;

  // Format timestamp as relative time
  const formatRelativeTime = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const statusDescription = filterCostText(analysis.statusDescription, hideCost);
  const recentWorkSummary = filterCostText(analysis.recentWorkSummary, hideCost);
  const concerns = analysis.concerns?.map(c => filterCostText(c, hideCost)).filter(c => c.length > 0);

  return (
    <div className="supervisor-history-item">
      <div
        className="supervisor-history-item-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span
          className="supervisor-history-progress-dot"
          style={{ background: PROGRESS_COLORS[analysis.progress] || '#888' }}
          title={analysis.progress}
        />
        <span className="supervisor-history-status">
          {statusDescription}
        </span>
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
}

// ============================================================================
// Boss Agent Components
// ============================================================================

interface BossAgentSectionProps {
  agent: Agent;
}

function BossAgentSection({ agent }: BossAgentSectionProps) {
  const state = useStore();
  const customClasses = useCustomAgentClassesArray();
  const [showSubordinates, setShowSubordinates] = useState(true);
  const [showDelegationHistory, setShowDelegationHistory] = useState(true);

  const subordinates = store.getSubordinates(agent.id);
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
        <div
          className="boss-subordinates-header"
          onClick={() => setShowSubordinates(!showSubordinates)}
        >
          <div className="unit-stat-label">
            Team ({subordinates.length})
          </div>
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
                  <div
                    key={sub.id}
                    className="boss-subordinate-item"
                    onClick={() => store.selectAgent(sub.id)}
                  >
                    <span
                      className="boss-subordinate-icon"
                      style={{ color: subClassConfig.color }}
                    >
                      {subClassConfig.icon}
                    </span>
                    <span className="boss-subordinate-name">{sub.name}</span>
                    <span className={`boss-subordinate-status status-${sub.status}`}>
                      {sub.status}
                    </span>
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
          <div className="unit-stat-label">
            Delegation History ({delegationHistory.length})
          </div>
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
              delegationHistory.slice(0, 10).map((decision) => (
                <DelegationDecisionItem key={decision.id} decision={decision} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface DelegationDecisionItemProps {
  decision: DelegationDecision;
}

function DelegationDecisionItem({ decision }: DelegationDecisionItemProps) {
  const [expanded, setExpanded] = useState(false);
  const state = useStore();

  // Format timestamp
  const formatTime = (timestamp: number): string => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const targetAgent = state.agents.get(decision.selectedAgentId);
  const targetClassConfig = targetAgent ? AGENT_CLASSES[targetAgent.class as keyof typeof AGENT_CLASSES] : null;

  const confidenceColors = {
    high: '#4aff9e',
    medium: '#ff9e4a',
    low: '#ff4a4a',
  };

  return (
    <div className="delegation-decision-item">
      <div
        className="delegation-decision-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="delegation-decision-arrow">
          {expanded ? '▼' : '▶'}
        </span>
        {targetClassConfig && (
          <span
            className="delegation-decision-icon"
            style={{ color: targetClassConfig.color }}
          >
            {targetClassConfig.icon}
          </span>
        )}
        <span className="delegation-decision-agent">
          → {decision.selectedAgentName}
        </span>
        <span
          className="delegation-decision-confidence"
          style={{ color: confidenceColors[decision.confidence] }}
          title={`Confidence: ${decision.confidence}`}
        >
          {decision.confidence === 'high' ? '●●●' :
           decision.confidence === 'medium' ? '●●○' : '●○○'}
        </span>
        <span className="delegation-decision-time">{formatTime(decision.timestamp)}</span>
      </div>
      {expanded && (
        <div className="delegation-decision-details">
          <div className="delegation-decision-command">
            <strong>Command:</strong>
            <div className="delegation-command-text">
              {decision.userCommand.length > 200
                ? decision.userCommand.slice(0, 200) + '...'
                : decision.userCommand}
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
}

interface SubordinateBadgeProps {
  agentId: string;
  bossId: string;
}

function SubordinateBadge({ agentId, bossId }: SubordinateBadgeProps) {
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
      <button
        className="subordinate-badge-goto"
        onClick={() => store.selectAgent(bossId)}
        title="Go to boss"
      >
        →
      </button>
      <button
        className="subordinate-badge-unlink"
        onClick={handleUnlink}
        title="Unlink from boss"
      >
        ✕
      </button>
    </div>
  );
}

interface LinkToBossSectionProps {
  agentId: string;
}

function LinkToBossSection({ agentId }: LinkToBossSectionProps) {
  const state = useStore();
  const [isExpanded, setIsExpanded] = useState(false);

  // Get all boss agents
  const bossAgents = Array.from(state.agents.values()).filter(
    (a) => a.class === 'boss'
  );

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
        <button
          className="link-to-boss-btn"
          onClick={() => setIsExpanded(true)}
        >
          <span className="link-to-boss-icon" style={{ color: bossConfig.color }}>
            {bossConfig.icon}
          </span>
          <span>Link to Boss</span>
        </button>
      ) : (
        <div className="link-to-boss-dropdown">
          <div className="link-to-boss-header">
            <span>Select a Boss</span>
            <button
              className="link-to-boss-close"
              onClick={() => setIsExpanded(false)}
            >
              ✕
            </button>
          </div>
          <div className="link-to-boss-list">
            {bossAgents.map((boss) => (
              <div
                key={boss.id}
                className="link-to-boss-item"
                onClick={() => handleLinkToBoss(boss.id)}
              >
                <span
                  className="link-to-boss-item-icon"
                  style={{ color: bossConfig.color }}
                >
                  {bossConfig.icon}
                </span>
                <span className="link-to-boss-item-name">{boss.name}</span>
                <span className="link-to-boss-item-count">
                  {boss.subordinateIds?.length || 0} agents
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
