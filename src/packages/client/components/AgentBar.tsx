import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useStore, store, useCustomAgentClassesArray } from '../store';
import type { Agent, DrawingArea, AgentSupervisorHistoryEntry } from '../../shared/types';
import { formatIdleTime } from '../utils/formatting';
import { getClassConfig } from '../utils/classConfig';
import { getIdleTimerColor, getAgentStatusColor } from '../utils/colors';
import { TOOL_ICONS } from '../utils/outputRendering';
import { useAgentOrder } from '../hooks';

interface AgentBarProps {
  onFocusAgent?: (agentId: string) => void;
  onSpawnClick?: () => void;
  onSpawnBossClick?: () => void;
  onNewBuildingClick?: () => void;
  onNewAreaClick?: () => void;
}

export function AgentBar({ onFocusAgent, onSpawnClick, onSpawnBossClick, onNewBuildingClick, onNewAreaClick }: AgentBarProps) {
  const state = useStore();
  const customClasses = useCustomAgentClassesArray();
  const [hoveredAgent, setHoveredAgent] = useState<Agent | null>(null);
  // Track tool bubbles with animation state
  const [toolBubbles, setToolBubbles] = useState<Map<string, { tool: string; key: number }>>(new Map());

  // Drag and drop state
  const [draggedAgent, setDraggedAgent] = useState<Agent | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragCounter = useRef(0);

  // Get agents sorted by creation time as base, then apply custom order
  const baseAgents = useMemo(() =>
    Array.from(state.agents.values()).sort(
      (a, b) => (a.createdAt || 0) - (b.createdAt || 0)
    ),
    [state.agents]
  );

  // Use the reorder hook for persistent ordering
  const { orderedAgents, moveAgent } = useAgentOrder(baseAgents);
  const agents = orderedAgents;

  // Get area info for each agent (for display purposes)
  const agentAreas = useMemo(() => {
    const areaMap = new Map<string, DrawingArea | null>();
    for (const agent of agents) {
      areaMap.set(agent.id, store.getAreaForAgent(agent.id));
    }
    return areaMap;
  }, [agents, state.areas]);

  // Watch for tool changes on agents
  useEffect(() => {
    const newBubbles = new Map(toolBubbles);
    let changed = false;

    for (const agent of agents) {
      const currentBubble = toolBubbles.get(agent.id);

      if (agent.currentTool) {
        // Agent has a tool active
        if (!currentBubble || currentBubble.tool !== agent.currentTool) {
          // New tool or different tool - create/update bubble with new key for animation
          newBubbles.set(agent.id, {
            tool: agent.currentTool,
            key: Date.now()
          });
          changed = true;
        }
      } else if (currentBubble) {
        // Tool finished - remove bubble after a short delay
        // Keep it for a moment so user sees it
        setTimeout(() => {
          setToolBubbles(prev => {
            const updated = new Map(prev);
            updated.delete(agent.id);
            return updated;
          });
        }, 1500);
      }
    }

    if (changed) {
      setToolBubbles(newBubbles);
    }
  }, [agents.map(a => a.currentTool).join(',')]);

  const handleAgentClick = (agent: Agent, e: React.MouseEvent) => {
    if (e.shiftKey) {
      // Shift+click to add/remove from selection
      store.addToSelection(agent.id);
    } else {
      // Normal click to select only this agent
      store.selectAgent(agent.id);
    }

    // On mobile, open terminal immediately when agent is clicked
    // On desktop, keep terminal open if it was already open (switch to clicked agent's terminal)
    const isMobile = window.innerWidth <= 768;
    if (isMobile || state.terminalOpen) {
      store.setTerminalOpen(true);
    }
  };

  const handleAgentDoubleClick = (agent: Agent) => {
    // Double-click to focus camera on agent and open terminal
    onFocusAgent?.(agent.id);
    store.setTerminalOpen(true);
  };

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent, agent: Agent) => {
    setDraggedAgent(agent);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', agent.id);
    // Add a slight delay to allow the drag image to be captured
    requestAnimationFrame(() => {
      (e.target as HTMLElement).classList.add('dragging');
    });
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    setDraggedAgent(null);
    setDragOverIndex(null);
    dragCounter.current = 0;
    (e.target as HTMLElement).classList.remove('dragging');
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragCounter.current++;
    setDragOverIndex(index);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOverIndex(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    if (!draggedAgent) return;

    const fromIndex = agents.findIndex(a => a.id === draggedAgent.id);
    if (fromIndex !== -1 && fromIndex !== toIndex) {
      moveAgent(fromIndex, toIndex);
    }

    setDraggedAgent(null);
    setDragOverIndex(null);
    dragCounter.current = 0;
  }, [draggedAgent, agents, moveAgent]);

  // Use getAgentStatusColor from utils/colors.ts

  const getStatusLabel = (status: Agent['status']) => {
    switch (status) {
      case 'idle': return 'Idle';
      case 'working': return 'Working';
      case 'waiting': return 'Waiting';
      case 'error': return 'Error';
      case 'offline': return 'Offline';
      default: return 'Unknown';
    }
  };

  // Get app version
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

  return (
    <div className="agent-bar">
      {/* Version indicator */}
      <div className="agent-bar-version" title={`Tide Commander v${version}`}>
        v{version}
      </div>

      <div className="agent-bar-list">
        {/* New Agent button */}
        <button
          className="agent-bar-spawn-btn"
          onClick={onSpawnClick}
          title="Spawn New Agent (Alt+N)"
        >
          <span className="agent-bar-spawn-icon">+</span>
          <span className="agent-bar-spawn-label">New Agent</span>
        </button>

        {/* New Boss button */}
        <button
          className="agent-bar-spawn-btn agent-bar-boss-btn"
          onClick={onSpawnBossClick}
          title="Spawn Boss Agent"
        >
          <span className="agent-bar-spawn-icon">👑</span>
          <span className="agent-bar-spawn-label">New Boss</span>
        </button>

        {/* New Building button */}
        <button
          className="agent-bar-spawn-btn agent-bar-building-btn"
          onClick={onNewBuildingClick}
          title="Add New Building"
        >
          <span className="agent-bar-spawn-icon">🏢</span>
          <span className="agent-bar-spawn-label">New Building</span>
        </button>

        {/* New Area button */}
        <button
          className="agent-bar-spawn-btn agent-bar-area-btn"
          onClick={onNewAreaClick}
          title="Draw New Area"
        >
          <span className="agent-bar-spawn-icon">▢</span>
          <span className="agent-bar-spawn-label">New Area</span>
        </button>
        {/* Flat list of draggable agents */}
        {agents.map((agent, index) => {
          const isSelected = state.selectedAgentIds.has(agent.id);
          const config = getClassConfig(agent.class, customClasses);
          const lastPrompt = state.lastPrompts.get(agent.id);
          const area = agentAreas.get(agent.id);

          const toolBubble = toolBubbles.get(agent.id);
          const toolIcon = toolBubble
            ? TOOL_ICONS[toolBubble.tool] || TOOL_ICONS.default
            : null;

          // Truncate last query for display
          const lastQueryShort = lastPrompt?.text
            ? lastPrompt.text.length > 30
              ? lastPrompt.text.substring(0, 30) + '...'
              : lastPrompt.text
            : null;

          const isDragging = draggedAgent?.id === agent.id;
          const isDragOver = dragOverIndex === index;

          return (
            <div
              key={agent.id}
              className={`agent-bar-item ${isSelected ? 'selected' : ''} ${agent.status} ${agent.isBoss ? 'is-boss' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, agent)}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDragEnter={(e) => handleDragEnter(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onClick={(e) => handleAgentClick(agent, e)}
              onDoubleClick={() => handleAgentDoubleClick(agent)}
              onMouseEnter={() => setHoveredAgent(agent)}
              onMouseLeave={() => setHoveredAgent(null)}
              title={`${agent.name} (${index + 1}) - Drag to reorder`}
              style={{
                borderColor: area?.color || undefined,
              }}
            >
              {/* Area indicator dot */}
              {area && (
                <div
                  className="agent-bar-area-dot"
                  style={{ backgroundColor: area.color }}
                  title={area.name}
                />
              )}
              <div className="agent-bar-avatar">
                <span className="agent-bar-icon">{config.icon}</span>
                <span
                  className="agent-bar-status"
                  style={{ backgroundColor: getAgentStatusColor(agent.status) }}
                />
                {agent.status === 'idle' && agent.lastActivity > 0 && (
                  <span
                    className="agent-bar-idle-clock"
                    style={{ color: getIdleTimerColor(agent.lastActivity) }}
                    title={formatIdleTime(agent.lastActivity)}
                  >
                    ⏱
                  </span>
                )}
              </div>
              <span className="agent-bar-hotkey" title={`Ctrl+${index + 1}`}>^{index + 1}</span>
              {toolBubble && (
                <div
                  key={toolBubble.key}
                  className="agent-bar-tool-bubble"
                  title={toolBubble.tool}
                >
                  <span className="agent-bar-tool-icon">{toolIcon}</span>
                  <span className="agent-bar-tool-name">{toolBubble.tool}</span>
                </div>
              )}
              {/* Last query preview */}
              {lastQueryShort && !toolBubble && (
                <div className="agent-bar-last-query" title={lastPrompt?.text}>
                  {lastQueryShort}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Hover tooltip */}
      {hoveredAgent && (() => {
        const hoveredArea = store.getAreaForAgent(hoveredAgent.id);
        const hoveredLastPrompt = state.lastPrompts.get(hoveredAgent.id);
        const config = getClassConfig(hoveredAgent.class, customClasses);

        // Get last supervisor analysis for this agent
        const supervisorHistory = store.getAgentSupervisorHistory(hoveredAgent.id);
        const lastSupervisorEntry: AgentSupervisorHistoryEntry | undefined =
          supervisorHistory.length > 0 ? supervisorHistory[supervisorHistory.length - 1] : undefined;

        // Format uptime
        const uptimeMs = Date.now() - (hoveredAgent.createdAt || Date.now());
        const uptimeMinutes = Math.floor(uptimeMs / 60000);
        const uptimeHours = Math.floor(uptimeMinutes / 60);
        const uptimeStr = uptimeHours > 0
          ? `${uptimeHours}h ${uptimeMinutes % 60}m`
          : `${uptimeMinutes}m`;

        // Format tokens
        const formatTokens = (n: number) => {
          if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
          if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
          return n.toString();
        };

        // Context usage percentage
        const contextPercent = hoveredAgent.contextLimit > 0
          ? Math.round((hoveredAgent.contextUsed / hoveredAgent.contextLimit) * 100)
          : 0;

        // Get progress color for supervisor status
        const getProgressColor = (progress: string) => {
          switch (progress) {
            case 'on_track': return '#4aff9e';
            case 'completed': return '#4a9eff';
            case 'stalled': return '#ff9e4a';
            case 'blocked': return '#ff4a4a';
            case 'idle': return '#888888';
            default: return '#888888';
          }
        };

        return (
          <div className="agent-bar-tooltip">
            <div className="agent-bar-tooltip-header">
              <span className="agent-bar-tooltip-icon">
                {config.icon}
              </span>
              <span className="agent-bar-tooltip-name">{hoveredAgent.name}</span>
              <span
                className="agent-bar-tooltip-status"
                style={{ color: getAgentStatusColor(hoveredAgent.status) }}
              >
                {getStatusLabel(hoveredAgent.status)}
              </span>
            </div>
            <div className="agent-bar-tooltip-info">
              <div className="agent-bar-tooltip-row">
                <span className="agent-bar-tooltip-label">Class:</span>
                <span className="agent-bar-tooltip-value">
                  {hoveredAgent.class} — {config.description}
                </span>
              </div>
              {hoveredArea && (
                <div className="agent-bar-tooltip-row">
                  <span className="agent-bar-tooltip-label">Area:</span>
                  <span
                    className="agent-bar-tooltip-value agent-bar-tooltip-area"
                    style={{ color: hoveredArea.color }}
                  >
                    {hoveredArea.name}
                  </span>
                </div>
              )}
              <div className="agent-bar-tooltip-row">
                <span className="agent-bar-tooltip-label">Directory:</span>
                <span className="agent-bar-tooltip-value agent-bar-tooltip-path">
                  {hoveredAgent.cwd}
                </span>
              </div>
              <div className="agent-bar-tooltip-row">
                <span className="agent-bar-tooltip-label">Uptime:</span>
                <span className="agent-bar-tooltip-value">{uptimeStr}</span>
              </div>
              <div className="agent-bar-tooltip-row">
                <span className="agent-bar-tooltip-label">Tokens:</span>
                <span className="agent-bar-tooltip-value">
                  {formatTokens(hoveredAgent.tokensUsed)} used
                </span>
              </div>
              <div className="agent-bar-tooltip-row">
                <span className="agent-bar-tooltip-label">Context:</span>
                <span className="agent-bar-tooltip-value" style={{
                  color: contextPercent > 80 ? '#ff4a4a' : contextPercent > 60 ? '#ff9e4a' : undefined
                }}>
                  {formatTokens(hoveredAgent.contextUsed)} / {formatTokens(hoveredAgent.contextLimit)} ({contextPercent}%)
                </span>
              </div>
              {hoveredAgent.currentTool && (
                <div className="agent-bar-tooltip-row">
                  <span className="agent-bar-tooltip-label">Tool:</span>
                  <span className="agent-bar-tooltip-value agent-bar-tooltip-tool">
                    {TOOL_ICONS[hoveredAgent.currentTool] || TOOL_ICONS.default} {hoveredAgent.currentTool}
                  </span>
                </div>
              )}
              {hoveredAgent.currentTask && (
                <div className="agent-bar-tooltip-row">
                  <span className="agent-bar-tooltip-label">Task:</span>
                  <span className="agent-bar-tooltip-value">
                    {hoveredAgent.currentTask.substring(0, 150)}
                    {hoveredAgent.currentTask.length > 150 ? '...' : ''}
                  </span>
                </div>
              )}
              {hoveredAgent.lastAssignedTask && !hoveredAgent.currentTask && (
                <div className="agent-bar-tooltip-row">
                  <span className="agent-bar-tooltip-label">Assigned Task:</span>
                  <span className="agent-bar-tooltip-value agent-bar-tooltip-query">
                    {hoveredAgent.lastAssignedTask.substring(0, 200)}
                    {hoveredAgent.lastAssignedTask.length > 200 ? '...' : ''}
                  </span>
                </div>
              )}
              {hoveredLastPrompt && (
                <div className="agent-bar-tooltip-row">
                  <span className="agent-bar-tooltip-label">Last Query:</span>
                  <span className="agent-bar-tooltip-value agent-bar-tooltip-query">
                    {hoveredLastPrompt.text.substring(0, 300)}
                    {hoveredLastPrompt.text.length > 300 ? '...' : ''}
                  </span>
                </div>
              )}
              {/* Supervisor Analysis Section */}
              {lastSupervisorEntry && (
                <>
                  <div className="agent-bar-tooltip-divider" />
                  <div className="agent-bar-tooltip-row">
                    <span className="agent-bar-tooltip-label">Supervisor:</span>
                    <span
                      className="agent-bar-tooltip-value"
                      style={{ color: getProgressColor(lastSupervisorEntry.analysis.progress) }}
                    >
                      {lastSupervisorEntry.analysis.progress.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="agent-bar-tooltip-row">
                    <span className="agent-bar-tooltip-label">Status:</span>
                    <span className="agent-bar-tooltip-value agent-bar-tooltip-supervisor">
                      {lastSupervisorEntry.analysis.statusDescription}
                    </span>
                  </div>
                  {lastSupervisorEntry.analysis.recentWorkSummary && (
                    <div className="agent-bar-tooltip-row">
                      <span className="agent-bar-tooltip-label">Summary:</span>
                      <span className="agent-bar-tooltip-value agent-bar-tooltip-supervisor">
                        {lastSupervisorEntry.analysis.recentWorkSummary.substring(0, 300)}
                        {lastSupervisorEntry.analysis.recentWorkSummary.length > 300 ? '...' : ''}
                      </span>
                    </div>
                  )}
                  {lastSupervisorEntry.analysis.concerns && lastSupervisorEntry.analysis.concerns.length > 0 && (
                    <div className="agent-bar-tooltip-row">
                      <span className="agent-bar-tooltip-label">Concerns:</span>
                      <span className="agent-bar-tooltip-value agent-bar-tooltip-concerns">
                        {lastSupervisorEntry.analysis.concerns.join('; ')}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
