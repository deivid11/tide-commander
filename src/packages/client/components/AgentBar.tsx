import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, store, useCustomAgentClassesArray, useSettings } from '../store';
import type { Agent, DrawingArea, AgentSupervisorHistoryEntry } from '../../shared/types';
import { formatIdleTime } from '../utils/formatting';
import { getClassConfig } from '../utils/classConfig';
import { getIdleTimerColor, getAgentStatusColor } from '../utils/colors';
import { TOOL_ICONS } from '../utils/outputRendering';
import { useAgentOrder } from '../hooks';
import { useNpmVersionStatus } from '../hooks/useNpmVersionStatus';
import { hasPendingSceneChanges, refreshScene } from '../hooks/useSceneSetup';

interface AgentBarProps {
  onFocusAgent?: (agentId: string) => void;
  onSpawnClick?: () => void;
  onSpawnBossClick?: () => void;
  onNewBuildingClick?: () => void;
  onNewAreaClick?: () => void;
}

interface AgentGroup {
  area: DrawingArea | null;
  agents: Agent[];
}

export function AgentBar({ onFocusAgent, onSpawnClick, onSpawnBossClick, onNewBuildingClick, onNewAreaClick }: AgentBarProps) {
  const { t } = useTranslation(['common']);
  const state = useStore();
  const settings = useSettings();
  const customClasses = useCustomAgentClassesArray();
  const [hasPendingHmrChanges, setHasPendingHmrChanges] = useState(false);

  // Refs for scrolling to selected agent
  const agentBarRef = useRef<HTMLDivElement>(null);       // outer container (no overflow clip)
  const scrollRef = useRef<HTMLDivElement>(null);         // inner scrollable wrapper
  const listRef = useRef<HTMLDivElement>(null);
  const agentItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Poll for pending HMR changes (only in dev mode and 3D view)
  useEffect(() => {
    if (!import.meta.env.DEV || settings.experimental2DView) {
      setHasPendingHmrChanges(false);
      return;
    }

    const checkPending = () => {
      setHasPendingHmrChanges(hasPendingSceneChanges());
    };

    checkPending();
    const interval = setInterval(checkPending, 500);
    return () => clearInterval(interval);
  }, [settings.experimental2DView]);

  // Redirect vertical wheel events to horizontal scroll on the scroll wrapper
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onWheel = (e: WheelEvent) => {
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      e.preventDefault();
      scroller.scrollLeft += e.deltaY;
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, []);

  const [hoveredAgent, setHoveredAgent] = useState<Agent | null>(null);
  // Track tool bubbles with animation state
  const [toolBubbles, setToolBubbles] = useState<Map<string, { tool: string; key: number }>>(new Map());

  // Drag and drop state
  const [draggedAgent, setDraggedAgent] = useState<Agent | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const dragCounter = useRef(0);

  // Get agents sorted by creation time as base, then apply custom order
  // Filter out agents in archived areas
  const baseAgents = useMemo(() =>
    Array.from(state.agents.values())
      .filter(agent => !store.isAgentInArchivedArea(agent.id))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    [state.agents, state.areas] // Re-run when areas change (archived state may change)
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

  // Group agents by their area while preserving custom order within each group
  const agentGroups = useMemo(() => {
    const groups = new Map<string | null, AgentGroup>();

    for (const agent of agents) {
      const area = agentAreas.get(agent.id) || null;
      const areaKey = area?.id || null;

      if (!groups.has(areaKey)) {
        groups.set(areaKey, { area, agents: [] });
      }
      groups.get(areaKey)!.agents.push(agent);
    }

    // Convert to array and sort: areas first (alphabetically), then unassigned
    const groupArray = Array.from(groups.values());
    groupArray.sort((a, b) => {
      if (!a.area && b.area) return 1;
      if (a.area && !b.area) return -1;
      if (!a.area && !b.area) return 0;
      return (a.area?.name || '').localeCompare(b.area?.name || '');
    });

    return groupArray;
  }, [agents, agentAreas]);

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

  // Scroll selected agent into view (centered) when selection changes
  useEffect(() => {
    const selectedId = state.lastSelectedAgentId;
    if (!selectedId) return;

    const agentElement = agentItemRefs.current.get(selectedId);
    const scroller = scrollRef.current;

    if (agentElement && scroller) {
      requestAnimationFrame(() => {
        // Element's position relative to the scroll container
        const elRect = agentElement.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        const elOffsetInScroller = elRect.left - scrollerRect.left + scroller.scrollLeft;
        const elCenter = elOffsetInScroller + elRect.width / 2;
        const scrollerWidth = scroller.clientWidth;
        // Scroll so the element is centered
        scroller.scrollTo({ left: elCenter - scrollerWidth / 2, behavior: 'smooth' });
      });
    }
  }, [state.lastSelectedAgentId]);

  const handleAgentClick = (agent: Agent, e: React.MouseEvent) => {
    // Mark that selection came from direct click (not swipe gesture)
    // This prevents autofocus of input on mobile
    store.setLastSelectionViaDirectClick(true);

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

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();

    // Set cursor based on whether drop is allowed (same area)
    if (draggedAgent) {
      const fromArea = agentAreas.get(draggedAgent.id);
      const toAgent = agents[index];
      const toArea = toAgent ? agentAreas.get(toAgent.id) : null;

      const fromAreaId = fromArea?.id ?? null;
      const toAreaId = toArea?.id ?? null;

      e.dataTransfer.dropEffect = fromAreaId === toAreaId ? 'move' : 'none';
    } else {
      e.dataTransfer.dropEffect = 'move';
    }
  }, [draggedAgent, agents, agentAreas]);

  const handleDragEnter = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragCounter.current++;

    // Only show drag-over visual if in the same area as the dragged agent
    if (draggedAgent) {
      const fromArea = agentAreas.get(draggedAgent.id);
      const toAgent = agents[index];
      const toArea = toAgent ? agentAreas.get(toAgent.id) : null;

      const fromAreaId = fromArea?.id ?? null;
      const toAreaId = toArea?.id ?? null;

      if (fromAreaId === toAreaId) {
        setDragOverIndex(index);
      } else {
        setDragOverIndex(null);
      }
    } else {
      setDragOverIndex(index);
    }
  }, [draggedAgent, agents, agentAreas]);

  const handleDragLeave = useCallback((_e: React.DragEvent) => {
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
      // Check if both agents are in the same area (or both have no area)
      const fromArea = agentAreas.get(draggedAgent.id);
      const toAgent = agents[toIndex];
      const toArea = toAgent ? agentAreas.get(toAgent.id) : null;

      // Only allow reorder within the same group/area
      const fromAreaId = fromArea?.id ?? null;
      const toAreaId = toArea?.id ?? null;

      if (fromAreaId === toAreaId) {
        moveAgent(fromIndex, toIndex);
      }
      // If areas don't match, silently reject the drop
    }

    setDraggedAgent(null);
    setDragOverIndex(null);
    dragCounter.current = 0;
  }, [draggedAgent, agents, moveAgent, agentAreas]);

  // Use getAgentStatusColor from utils/colors.ts

  const getStatusLabel = (status: Agent['status']) => {
    const key = `common:status.${status}`;
    return t(key, { defaultValue: t('common:status.unknown') });
  };

  // Show current version against npm latest (same source as CLI update checks)
  const { currentVersion, latestVersion, relation, isChecking } = useNpmVersionStatus();
  const version = currentVersion;

  // Calculate global index for hotkeys (needs to be tracked across groups)
  let globalIndex = 0;

  return (
    <div className="agent-bar" ref={agentBarRef}>
      <div className="agent-bar-scroll" ref={scrollRef}>
      {/* Version indicator */}
      <div
        className="agent-bar-version"
        title={latestVersion ? `Tide Commander v${version} (npm: v${latestVersion})` : `Tide Commander v${version}`}
      >
        <span>v{version}</span>
        {relation === 'behind' && latestVersion ? (
          <span
            className="agent-bar-version-badge agent-bar-version-badge-behind"
            title={`Behind npm latest v${latestVersion}`}
          >
            npm v{latestVersion}
          </span>
        ) : relation === 'ahead' && latestVersion ? (
          <span
            className="agent-bar-version-badge agent-bar-version-badge-ahead"
            title={`Ahead of npm latest v${latestVersion}`}
          >
            npm v{latestVersion}
          </span>
        ) : null}
        {relation === 'behind' ? (
          <a
            href="https://github.com/deivid11/tide-commander/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="agent-bar-version-status agent-bar-version-status-behind"
            title={t('common:agentBar.behindNpmTooltip', { defaultValue: 'Current version is behind npm latest' })}
          >
            {t('common:agentBar.behindNpm', { defaultValue: '(behind npm)' })}
          </a>
        ) : relation === 'ahead' ? (
          <span
            className="agent-bar-version-status agent-bar-version-status-ahead"
            title={t('common:agentBar.aheadNpmTooltip', { defaultValue: 'Current version is newer than npm latest' })}
          >
            {t('common:agentBar.aheadNpm', { defaultValue: '(ahead of npm)' })}
          </span>
        ) : relation === 'equal' ? (
          <a
            href="https://github.com/deivid11/tide-commander/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="agent-bar-version-status"
          >
            {t('common:agentBar.updated')}
          </a>
        ) : isChecking ? (
          <span className="agent-bar-version-status">
            {t('common:agentBar.checkingNpm', { defaultValue: '(checking npm)' })}
          </span>
        ) : (
          <span className="agent-bar-version-status">
            {t('common:agentBar.unknownNpm', { defaultValue: '(npm unknown)' })}
          </span>
        )}
        {/* HMR Refresh button - only shows when there are pending 3D scene changes */}
        {hasPendingHmrChanges && (
          <button
            className="agent-bar-hmr-refresh"
            onClick={refreshScene}
            title="Refresh 3D Scene (HMR changes pending)"
          >
            ↻
          </button>
        )}
      </div>

      <div className="agent-bar-list" ref={listRef}>
        {/* New Agent button */}
        <button
          className="agent-bar-spawn-btn"
          onClick={onSpawnClick}
          title={t('common:agentBar.spawnNewAgent')}
        >
          <span className="agent-bar-spawn-icon">+</span>
          <span className="agent-bar-spawn-label">{t('common:agentBar.newAgent')}</span>
        </button>

        {/* New Boss button */}
        <button
          className="agent-bar-spawn-btn agent-bar-boss-btn"
          onClick={onSpawnBossClick}
          title={t('common:agentBar.spawnBoss')}
        >
          <span className="agent-bar-spawn-icon">👑</span>
          <span className="agent-bar-spawn-label">{t('common:agentBar.newBoss')}</span>
        </button>

        {/* New Building button */}
        <button
          className="agent-bar-spawn-btn agent-bar-building-btn"
          onClick={onNewBuildingClick}
          title={t('common:agentBar.addNewBuilding')}
        >
          <span className="agent-bar-spawn-icon">🏢</span>
          <span className="agent-bar-spawn-label">{t('common:agentBar.newBuilding')}</span>
        </button>

        {/* New Area button */}
        <button
          className="agent-bar-spawn-btn agent-bar-area-btn"
          onClick={onNewAreaClick}
          title={t('common:agentBar.drawNewArea')}
        >
          <span className="agent-bar-spawn-icon">▢</span>
          <span className="agent-bar-spawn-label">{t('common:agentBar.newArea')}</span>
        </button>
        {/* Agents grouped by area */}
        {agentGroups.map((group) => {
          const groupAgents = group.agents;
          const isUnassigned = !group.area;

          return (
            <div
              key={group.area?.id || 'unassigned'}
              className={`agent-bar-group ${isUnassigned ? 'unassigned' : ''}`}
              style={{
                borderColor: group.area?.color || undefined,
                background: group.area
                  ? `${group.area.color}15`
                  : undefined,
              }}
            >
              {/* Area label at top of group border */}
              <div className="agent-bar-area-label">
                <span
                  className="agent-bar-area-name"
                  style={{ color: group.area?.color || '#888' }}
                >
                  {group.area?.name || t('common:agentBar.unassigned')}
                </span>
              </div>

              {/* Area folders */}
              {group.area?.directories && group.area.directories.length > 0 && (
                <div className="agent-bar-folders">
                  {group.area.directories.map((dir, idx) => (
                    <div
                      key={idx}
                      className="agent-bar-folder-item"
                      onClick={(e) => {
                        e.stopPropagation();
                        store.openFileExplorer(dir);
                      }}
                    >
                      <span className="agent-bar-folder-icon">📁</span>
                      <div className="agent-bar-folder-tooltip">
                        <div className="agent-bar-folder-tooltip-path">{dir}</div>
                        <div className="agent-bar-folder-tooltip-hint">{t('common:agentBar.clickToOpen')}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Agents in this group */}
              {groupAgents.map((agent) => {
                const currentIndex = globalIndex++;
                const agentIndex = agents.findIndex(a => a.id === agent.id);
                const isSelected = state.selectedAgentIds.has(agent.id);
                const config = getClassConfig(agent.class, customClasses);
                const lastPrompt = state.lastPrompts.get(agent.id);

                const toolBubble = toolBubbles.get(agent.id);
                const _toolIcon = toolBubble
                  ? TOOL_ICONS[toolBubble.tool] || TOOL_ICONS.default
                  : null;

                // Truncate last query for display
                const _lastQueryShort = lastPrompt?.text
                  ? lastPrompt.text.length > 30
                    ? lastPrompt.text.substring(0, 30) + '...'
                    : lastPrompt.text
                  : null;

                const isDragging = draggedAgent?.id === agent.id;
                const isDragOver = dragOverIndex === agentIndex;

                return (
                  <div
                    key={agent.id}
                    ref={(el) => {
                      if (el) {
                        agentItemRefs.current.set(agent.id, el);
                      } else {
                        agentItemRefs.current.delete(agent.id);
                      }
                    }}
                    className={`agent-bar-item ${isSelected ? 'selected' : ''} ${agent.status} ${agent.isBoss ? 'is-boss' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, agent)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, agentIndex)}
                    onDragEnter={(e) => handleDragEnter(e, agentIndex)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, agentIndex)}
                    onClick={(e) => handleAgentClick(agent, e)}
                    onDoubleClick={() => handleAgentDoubleClick(agent)}
                    onMouseEnter={() => setHoveredAgent(agent)}
                    onMouseLeave={() => setHoveredAgent(null)}
                    title={`${agent.name} (${currentIndex + 1}) - Drag to reorder within group`}
                  >
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
                    <span className="agent-bar-hotkey" title={`Ctrl+${currentIndex + 1}`}>^{currentIndex + 1}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      </div>{/* end agent-bar-scroll */}

      {/* Tool bubbles — rendered outside scroll wrapper so they're not clipped */}
      {Array.from(toolBubbles.entries()).map(([agentId, bubble]) => {
        const el = agentItemRefs.current.get(agentId);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const icon = TOOL_ICONS[bubble.tool] || TOOL_ICONS.default;
        return (
          <div
            key={`tool-${agentId}-${bubble.key}`}
            className="agent-bar-tool-bubble"
            title={bubble.tool}
            style={{
              position: 'fixed',
              left: rect.left + rect.width / 2,
              bottom: window.innerHeight - rect.top + 8,
            }}
          >
            <span className="agent-bar-tool-icon">{icon}</span>
            <span className="agent-bar-tool-name">{bubble.tool}</span>
          </div>
        );
      })}

      {/* Hover tooltip — rendered outside scroll wrapper so it's not clipped */}
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

        // Position tooltip above the hovered agent element
        const hoveredEl = agentItemRefs.current.get(hoveredAgent.id);
        const tooltipStyle: React.CSSProperties = {};
        if (hoveredEl) {
          const rect = hoveredEl.getBoundingClientRect();
          tooltipStyle.position = 'fixed';
          tooltipStyle.left = rect.left + rect.width / 2;
          tooltipStyle.bottom = window.innerHeight - rect.top + 12;
        }

        return (
          <div className="agent-bar-tooltip" style={tooltipStyle}>
            <div className="agent-bar-tooltip-header">
              <span className="agent-bar-tooltip-icon">
                {config.icon}
              </span>
              <span className="agent-bar-tooltip-name">
                <img
                  src={hoveredAgent.provider === 'codex' ? '/assets/codex.png' : '/assets/claude.png'}
                  alt={hoveredAgent.provider}
                  className="agent-bar-provider-icon"
                  title={hoveredAgent.provider === 'codex' ? 'Codex Agent' : 'Claude Agent'}
                />
                {hoveredAgent.name}
              </span>
              <span
                className="agent-bar-tooltip-status"
                style={{ color: getAgentStatusColor(hoveredAgent.status) }}
              >
                {getStatusLabel(hoveredAgent.status)}
              </span>
            </div>
            <div className="agent-bar-tooltip-info">
              <div className="agent-bar-tooltip-row">
                <span className="agent-bar-tooltip-label">{t('common:labels.class')}:</span>
                <span className="agent-bar-tooltip-value">
                  {hoveredAgent.class} — {config.description}
                </span>
              </div>
              {hoveredArea && (
                <div className="agent-bar-tooltip-row">
                  <span className="agent-bar-tooltip-label">{t('common:agentPopup.area')}:</span>
                  <span
                    className="agent-bar-tooltip-value agent-bar-tooltip-area"
                    style={{ color: hoveredArea.color }}
                  >
                    {hoveredArea.name}
                  </span>
                </div>
              )}
              <div className="agent-bar-tooltip-row">
                <span className="agent-bar-tooltip-label">{t('common:agentPopup.directory')}:</span>
                <span className="agent-bar-tooltip-value agent-bar-tooltip-path">
                  {hoveredAgent.cwd}
                </span>
              </div>
              <div className="agent-bar-tooltip-row">
                <span className="agent-bar-tooltip-label">{t('common:labels.uptime')}:</span>
                <span className="agent-bar-tooltip-value">{uptimeStr}</span>
              </div>
              <div className="agent-bar-tooltip-row">
                <span className="agent-bar-tooltip-label">{t('common:labels.tokens')}:</span>
                <span className="agent-bar-tooltip-value">
                  {formatTokens(hoveredAgent.tokensUsed)} {t('common:agentPopup.used')}
                </span>
              </div>
              <div className="agent-bar-tooltip-row">
                <span className="agent-bar-tooltip-label">{t('common:labels.context')}:</span>
                <span className="agent-bar-tooltip-value" style={{
                  color: contextPercent > 80 ? '#ff4a4a' : contextPercent > 60 ? '#ff9e4a' : undefined
                }}>
                  {formatTokens(hoveredAgent.contextUsed)} / {formatTokens(hoveredAgent.contextLimit)} ({contextPercent}%)
                </span>
              </div>
              {hoveredAgent.currentTool && (
                <div className="agent-bar-tooltip-row">
                  <span className="agent-bar-tooltip-label">{t('common:agentPopup.tool')}:</span>
                  <span className="agent-bar-tooltip-value agent-bar-tooltip-tool">
                    {TOOL_ICONS[hoveredAgent.currentTool] || TOOL_ICONS.default} {hoveredAgent.currentTool}
                  </span>
                </div>
              )}
              {hoveredAgent.currentTask && (
                <div className="agent-bar-tooltip-row">
                  <span className="agent-bar-tooltip-label">{t('common:labels.task')}:</span>
                  <span className="agent-bar-tooltip-value">
                    {hoveredAgent.currentTask.substring(0, 150)}
                    {hoveredAgent.currentTask.length > 150 ? '...' : ''}
                  </span>
                </div>
              )}
              {hoveredAgent.lastAssignedTask && !hoveredAgent.currentTask && (
                <div className="agent-bar-tooltip-row">
                  <span className="agent-bar-tooltip-label">{t('common:agentPopup.assignedTask')}:</span>
                  <span className="agent-bar-tooltip-value agent-bar-tooltip-query">
                    {hoveredAgent.lastAssignedTask.substring(0, 200)}
                    {hoveredAgent.lastAssignedTask.length > 200 ? '...' : ''}
                  </span>
                </div>
              )}
              {hoveredLastPrompt && (
                <div className="agent-bar-tooltip-row">
                  <span className="agent-bar-tooltip-label">{t('common:agentPopup.lastQuery')}:</span>
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
                    <span className="agent-bar-tooltip-label">{t('common:agentPopup.supervisor')}:</span>
                    <span
                      className="agent-bar-tooltip-value"
                      style={{ color: getProgressColor(lastSupervisorEntry.analysis.progress) }}
                    >
                      {lastSupervisorEntry.analysis.progress.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="agent-bar-tooltip-row">
                    <span className="agent-bar-tooltip-label">{t('common:labels.status')}:</span>
                    <span className="agent-bar-tooltip-value agent-bar-tooltip-supervisor">
                      {lastSupervisorEntry.analysis.statusDescription}
                    </span>
                  </div>
                  {lastSupervisorEntry.analysis.recentWorkSummary && (
                    <div className="agent-bar-tooltip-row">
                      <span className="agent-bar-tooltip-label">{t('common:labels.summary')}:</span>
                      <span className="agent-bar-tooltip-value agent-bar-tooltip-supervisor">
                        {lastSupervisorEntry.analysis.recentWorkSummary.substring(0, 300)}
                        {lastSupervisorEntry.analysis.recentWorkSummary.length > 300 ? '...' : ''}
                      </span>
                    </div>
                  )}
                  {lastSupervisorEntry.analysis.concerns && lastSupervisorEntry.analysis.concerns.length > 0 && (
                    <div className="agent-bar-tooltip-row">
                      <span className="agent-bar-tooltip-label">{t('common:labels.concerns')}:</span>
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
