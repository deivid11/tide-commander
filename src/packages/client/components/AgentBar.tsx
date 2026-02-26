import React, { memo, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  store,
  useAgents,
  useAreas,
  useSelectedAgentIds,
  useLastSelectedAgentId,
  useLastPrompts,
  useCustomAgentClassesArray,
  useSettings,
  useAgentsWithUnseenOutput,
} from '../store';
import type { Agent, DrawingArea, AgentSupervisorHistoryEntry, CustomAgentClass } from '../../shared/types';
import { formatIdleTime } from '../utils/formatting';
import { getClassConfig } from '../utils/classConfig';
import { getIdleTimerColor, getAgentStatusColor } from '../utils/colors';
import { TOOL_ICONS } from '../utils/outputRendering';
import { useRenderCounter } from '../utils/profiling';
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

// Memoized individual agent item - only re-renders when its own agent data changes
interface AgentBarItemProps {
  agent: Agent;
  currentIndex: number;
  agentIndex: number;
  isTouchInput: boolean;
  isTouchDragEnabled: boolean;
  isSelected: boolean;
  hasUnseenOutput: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  customClasses: CustomAgentClass[];
  onDragStart: (e: React.DragEvent, agent: Agent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent, index: number) => void;
  onDragEnter: (e: React.DragEvent, index: number) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, index: number) => void;
  onAgentClick: (agent: Agent, e: React.MouseEvent) => void;
  onAgentDoubleClick: (agent: Agent) => void;
  onTouchStart: (e: React.TouchEvent, agentId: string) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
  onHoverEnter: (agent: Agent) => void;
  onHoverLeave: () => void;
  onItemRef: (agentId: string, el: HTMLDivElement | null) => void;
}

const AgentBarItem = memo(function AgentBarItem({
  agent, currentIndex, agentIndex, isTouchInput, isTouchDragEnabled, isSelected, hasUnseenOutput,
  isDragging, isDragOver, customClasses,
  onDragStart, onDragEnd, onDragOver, onDragEnter, onDragLeave, onDrop,
  onAgentClick, onAgentDoubleClick, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel, onHoverEnter, onHoverLeave, onItemRef,
}: AgentBarItemProps) {
  const config = useMemo(() => getClassConfig(agent.class, customClasses), [agent.class, customClasses]);
  const canDrag = !isTouchInput || isTouchDragEnabled;

  const handleRef = useCallback((el: HTMLDivElement | null) => {
    onItemRef(agent.id, el);
  }, [agent.id, onItemRef]);

  return (
    <div
      ref={handleRef}
      className={`agent-bar-item ${isSelected ? 'selected' : ''} ${agent.status} ${agent.isBoss ? 'is-boss' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''} ${isTouchDragEnabled ? 'touch-drag-enabled' : ''}`}
      draggable={canDrag}
      onDragStart={(e) => onDragStart(e, agent)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver(e, agentIndex)}
      onDragEnter={(e) => onDragEnter(e, agentIndex)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, agentIndex)}
      onTouchStart={(e) => onTouchStart(e, agent.id)}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
      onClick={(e) => onAgentClick(agent, e)}
      onDoubleClick={() => onAgentDoubleClick(agent)}
      onMouseEnter={() => onHoverEnter(agent)}
      onMouseLeave={onHoverLeave}
      title={isTouchInput
        ? `${agent.name} (${currentIndex + 1}) - Long press to reorder`
        : `${agent.name} (${currentIndex + 1}) - Drag to reorder within group`}
    >
      <div className="agent-bar-avatar">
        <span className="agent-bar-icon">{config.icon}</span>
        <span
          className="agent-bar-status"
          style={{ backgroundColor: getAgentStatusColor(agent.status) }}
        />
        {hasUnseenOutput && (
          <span
            className="agent-bar-notification-badge"
            title="New output available - click to view"
          />
        )}
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
});

export const AgentBar = memo(function AgentBar({ onFocusAgent, onSpawnClick, onSpawnBossClick, onNewBuildingClick, onNewAreaClick }: AgentBarProps) {
  const { t } = useTranslation(['common']);
  const agentsMap = useAgents();
  const areas = useAreas();
  const selectedAgentIds = useSelectedAgentIds();
  const lastSelectedAgentId = useLastSelectedAgentId();
  const lastPrompts = useLastPrompts();
  const settings = useSettings();
  const customClasses = useCustomAgentClassesArray();
  const agentsWithUnseenOutput = useAgentsWithUnseenOutput();
  const [hasPendingHmrChanges, setHasPendingHmrChanges] = useState(false);

  useRenderCounter('AgentBar');

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
  const [touchDragEnabledAgentId, setTouchDragEnabledAgentId] = useState<string | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ agentId: string; x: number; y: number } | null>(null);
  const suppressNextClickAgentIdRef = useRef<string | null>(null);
  const suppressClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const TOUCH_LONG_PRESS_MS = 350;
  const TOUCH_MOVE_CANCEL_PX = 8;
  const isTouchInput = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return ('ontouchstart' in window) || window.matchMedia('(pointer: coarse)').matches;
  }, []);

  // Get agents sorted by creation time as base, then apply custom order
  // Filter out agents in archived areas
  const baseAgents = useMemo(() =>
    Array.from(agentsMap.values())
      .filter(agent => !store.isAgentInArchivedArea(agent.id))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    [agentsMap, areas] // Re-run when areas change (archived state may change)
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
  }, [agents, areas]);

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

  // Refs for stable callbacks (avoid re-creating closures on every render)
  const onFocusAgentRef = useRef(onFocusAgent);
  onFocusAgentRef.current = onFocusAgent;
  const draggedAgentRef = useRef(draggedAgent);
  draggedAgentRef.current = draggedAgent;
  const agentsFlatRef = useRef(agents);
  agentsFlatRef.current = agents;
  const agentAreasRef = useRef(agentAreas);
  agentAreasRef.current = agentAreas;
  const moveAgentRef = useRef(moveAgent);
  moveAgentRef.current = moveAgent;

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
    const selectedId = lastSelectedAgentId;
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
  }, [lastSelectedAgentId]);

  // Stabilized click handlers (read reactive values from store/refs to avoid deps)
  const handleAgentClick = useCallback((agent: Agent, e: React.MouseEvent) => {
    if (suppressNextClickAgentIdRef.current === agent.id) {
      suppressNextClickAgentIdRef.current = null;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    store.setLastSelectionViaDirectClick(true);
    if (e.shiftKey) {
      store.addToSelection(agent.id);
    } else {
      store.selectAgent(agent.id);
    }
    store.setTerminalOpen(true);
  }, []);

  const handleAgentDoubleClick = useCallback((agent: Agent) => {
    onFocusAgentRef.current?.(agent.id);
    store.setTerminalOpen(true);
  }, []);

  const handleHoverLeave = useCallback(() => setHoveredAgent(null), []);

  const handleItemRef = useCallback((agentId: string, el: HTMLDivElement | null) => {
    if (el) {
      agentItemRefs.current.set(agentId, el);
    } else {
      agentItemRefs.current.delete(agentId);
    }
  }, []);

  // Drag and drop handlers (stabilized with refs)
  const handleDragStart = useCallback((e: React.DragEvent, agent: Agent) => {
    setDraggedAgent(agent);
    setTouchDragEnabledAgentId(agent.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', agent.id);
    requestAnimationFrame(() => {
      (e.target as HTMLElement).classList.add('dragging');
    });
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    setDraggedAgent(null);
    setDragOverIndex(null);
    setTouchDragEnabledAgentId(null);
    dragCounter.current = 0;
    (e.target as HTMLElement).classList.remove('dragging');
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    const currentDraggedAgent = draggedAgentRef.current;
    if (currentDraggedAgent) {
      const fromArea = agentAreasRef.current.get(currentDraggedAgent.id);
      const toAgent = agentsFlatRef.current[index];
      const toArea = toAgent ? agentAreasRef.current.get(toAgent.id) : null;
      const fromAreaId = fromArea?.id ?? null;
      const toAreaId = toArea?.id ?? null;
      e.dataTransfer.dropEffect = fromAreaId === toAreaId ? 'move' : 'none';
    } else {
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    dragCounter.current++;
    const currentDraggedAgent = draggedAgentRef.current;
    if (currentDraggedAgent) {
      const fromArea = agentAreasRef.current.get(currentDraggedAgent.id);
      const toAgent = agentsFlatRef.current[index];
      const toArea = toAgent ? agentAreasRef.current.get(toAgent.id) : null;
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
  }, []);

  const handleDragLeave = useCallback((_e: React.DragEvent) => {
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOverIndex(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const currentDraggedAgent = draggedAgentRef.current;
    if (!currentDraggedAgent) return;
    const currentAgents = agentsFlatRef.current;
    const currentAgentAreas = agentAreasRef.current;
    const fromIndex = currentAgents.findIndex(a => a.id === currentDraggedAgent.id);
    if (fromIndex !== -1 && fromIndex !== toIndex) {
      const fromArea = currentAgentAreas.get(currentDraggedAgent.id);
      const toAgent = currentAgents[toIndex];
      const toArea = toAgent ? currentAgentAreas.get(toAgent.id) : null;
      const fromAreaId = fromArea?.id ?? null;
      const toAreaId = toArea?.id ?? null;
      if (fromAreaId === toAreaId) {
        moveAgentRef.current(fromIndex, toIndex);
      }
    }
    setDraggedAgent(null);
    setDragOverIndex(null);
    setTouchDragEnabledAgentId(null);
    dragCounter.current = 0;
  }, []);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const clearSuppressClickTimer = useCallback(() => {
    if (suppressClearTimerRef.current) {
      clearTimeout(suppressClearTimerRef.current);
      suppressClearTimerRef.current = null;
    }
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent, agentId: string) => {
    if (!isTouchInput || e.touches.length !== 1) return;
    clearLongPressTimer();
    clearSuppressClickTimer();
    setTouchDragEnabledAgentId(null);
    const touch = e.touches[0];
    touchStartRef.current = { agentId, x: touch.clientX, y: touch.clientY };
    longPressTimerRef.current = setTimeout(() => {
      setTouchDragEnabledAgentId(agentId);
      suppressNextClickAgentIdRef.current = agentId;
      longPressTimerRef.current = null;
    }, TOUCH_LONG_PRESS_MS);
  }, [clearLongPressTimer, clearSuppressClickTimer, isTouchInput]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isTouchInput || e.touches.length !== 1) return;
    const start = touchStartRef.current;
    if (!start || !longPressTimerRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const distance = Math.sqrt((dx * dx) + (dy * dy));
    if (distance > TOUCH_MOVE_CANCEL_PX) {
      clearLongPressTimer();
      touchStartRef.current = null;
    }
  }, [clearLongPressTimer, isTouchInput]);

  const handleTouchEnd = useCallback(() => {
    clearLongPressTimer();
    touchStartRef.current = null;
    if (!draggedAgentRef.current) {
      setTouchDragEnabledAgentId(null);
    }
    clearSuppressClickTimer();
    suppressClearTimerRef.current = setTimeout(() => {
      suppressNextClickAgentIdRef.current = null;
      suppressClearTimerRef.current = null;
    }, 450);
  }, [clearLongPressTimer, clearSuppressClickTimer]);

  useEffect(() => {
    return () => {
      clearLongPressTimer();
      clearSuppressClickTimer();
    };
  }, [clearLongPressTimer, clearSuppressClickTimer]);

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
          <span className="agent-bar-spawn-icon">🔲</span>
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
                return (
                  <AgentBarItem
                    key={agent.id}
                    agent={agent}
                    currentIndex={currentIndex}
                    agentIndex={agentIndex}
                    isTouchInput={isTouchInput}
                    isTouchDragEnabled={touchDragEnabledAgentId === agent.id}
                    isSelected={selectedAgentIds.has(agent.id)}
                    hasUnseenOutput={agentsWithUnseenOutput.has(agent.id)}
                    isDragging={draggedAgent?.id === agent.id}
                    isDragOver={dragOverIndex === agentIndex}
                    customClasses={customClasses}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onDragOver={handleDragOver}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onAgentClick={handleAgentClick}
                    onAgentDoubleClick={handleAgentDoubleClick}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                    onTouchCancel={handleTouchEnd}
                    onHoverEnter={setHoveredAgent}
                    onHoverLeave={handleHoverLeave}
                    onItemRef={handleItemRef}
                  />
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
        const hoveredLastPrompt = lastPrompts.get(hoveredAgent.id);
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
                  src={hoveredAgent.provider === 'codex' ? `${import.meta.env.BASE_URL}assets/codex.png` : `${import.meta.env.BASE_URL}assets/claude.png`}
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
              {hoveredAgent.taskLabel && (
                <div className="agent-bar-tooltip-row">
                  <span className="agent-bar-tooltip-label">📋 Task:</span>
                  <span className="agent-bar-tooltip-value agent-bar-tooltip-tool">
                    {hoveredAgent.taskLabel}
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
});
