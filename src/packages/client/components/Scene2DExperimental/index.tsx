/**
 * Scene2DExperimental - Flat UI layout with 3-column design
 *
 * Layout:
 * - Left sidebar: Navigation menu (settings, commander, etc.)
 * - Middle column: Agents, buildings, and areas
 * - Right column: Selected agent's chat view
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  useAgentsArray,
  useAreas,
  useBuildings,
  useSelectedAgentIds,
  useSelectedBuildingIds,
  useAgentsWithUnseenOutput,
  useAgent,
} from '../../store/selectors';
import { store } from '../../store';
import type { Agent, Building } from '@shared/types';
import { BUILDING_TYPES } from '@shared/building-types';
import { AgentIcon } from '../AgentIcon';
import { getAgentStatusColor } from '../../utils/colors';
import { AgentTerminalPane, type AgentTerminalPaneHandle } from '../ClaudeOutputPanel/AgentTerminalPane';
import { ImageModal, BashModal, type BashModalState } from '../ClaudeOutputPanel/TerminalModals';
import { useKeyboardHeight } from '../ClaudeOutputPanel/useKeyboardHeight';
import { ThemeSelector } from '../ClaudeOutputPanel/ThemeSelector';
import { SingleAgentPanel } from '../UnitPanel/SingleAgentPanel';
import type { ViewMode as TerminalViewMode } from '../ClaudeOutputPanel/types';
import {
  getStorageBoolean,
  setStorageBoolean,
  getStorageString,
  setStorageString,
  STORAGE_KEYS,
} from '../../utils/storage';
import './Scene2DExperimental.scss';

// ============================================================================
// Types
// ============================================================================

interface Scene2DExperimentalProps {
  onAgentClick: (agentId: string) => void;
  onAgentDoubleClick?: (agentId: string) => void;
  onBuildingClick: (buildingId: string) => void;
  onBuildingDoubleClick?: (buildingId: string) => void;
  onAreaClick?: (areaId: string) => void;
  onContextMenu?: (
    screenPos: { x: number; y: number },
    target: { type: string; id?: string }
  ) => void;
  // Creation modal callbacks
  onOpenSpawnModal?: () => void;
  onOpenBossSpawnModal?: () => void;
  onOpenBuildingModal?: () => void;
  onOpenAreaModal?: () => void;
}

type MenuSection = 'agents' | 'commander' | 'settings' | 'skills' | 'workflows';

// ============================================================================
// Sidebar Menu Component
// ============================================================================

interface SidebarMenuProps {
  activeSection: MenuSection;
  onSectionChange: (section: MenuSection) => void;
}

const SidebarMenu = React.memo(function SidebarMenu({
  activeSection,
  onSectionChange,
}: SidebarMenuProps) {
  const menuItems: { id: MenuSection; icon: string; label: string }[] = [
    { id: 'agents', icon: '👥', label: 'Agents' },
    { id: 'commander', icon: '🎮', label: 'Commander' },
    { id: 'workflows', icon: '🔄', label: 'Workflows' },
    { id: 'skills', icon: '⚡', label: 'Skills' },
    { id: 'settings', icon: '⚙️', label: 'Settings' },
  ];

  return (
    <div className="exp-sidebar">
      <div className="exp-sidebar__logo">
        <span className="exp-sidebar__logo-icon">🌊</span>
        <span className="exp-sidebar__logo-text">Tide</span>
      </div>
      <nav className="exp-sidebar__nav">
        {menuItems.map((item) => (
          <button
            key={item.id}
            className={`exp-sidebar__item ${activeSection === item.id ? 'exp-sidebar__item--active' : ''}`}
            onClick={() => onSectionChange(item.id)}
            title={item.label}
          >
            <span className="exp-sidebar__item-icon">{item.icon}</span>
            <span className="exp-sidebar__item-label">{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="exp-sidebar__footer">
        <button className="exp-sidebar__item" title="Help">
          <span className="exp-sidebar__item-icon">❓</span>
        </button>
      </div>
    </div>
  );
});

// ============================================================================
// Compact Agent Card
// ============================================================================

interface AgentCardProps {
  agent: Agent;
  isSelected: boolean;
  hasUnseen: boolean;
  onClick: () => void;
}

const AgentCard = React.memo(function AgentCard({
  agent,
  isSelected,
  hasUnseen,
  onClick,
}: AgentCardProps) {
  const statusColor = getAgentStatusColor(agent.status);

  return (
    <div
      className={`exp-agent-card ${isSelected ? 'exp-agent-card--selected' : ''} ${agent.isBoss ? 'exp-agent-card--boss' : ''}`}
      onClick={onClick}
      title={`${agent.name} - ${agent.status}`}
    >
      <div className="exp-agent-card__avatar">
        <AgentIcon agent={agent} size={24} />
        <span
          className="exp-agent-card__status-dot"
          style={{ backgroundColor: statusColor }}
        />
        {agent.isBoss && <span className="exp-agent-card__crown">👑</span>}
        {hasUnseen && <span className="exp-agent-card__unseen">!</span>}
      </div>
      <div className="exp-agent-card__info">
        <div className="exp-agent-card__name">{agent.name}</div>
        <div className="exp-agent-card__status" style={{ color: statusColor }}>
          {agent.status}
        </div>
      </div>
      <div className="exp-agent-card__context">
        <div
          className="exp-agent-card__context-fill"
          style={{
            width: `${Math.min(100, Math.round((agent.contextUsed / agent.contextLimit) * 100) || 0)}%`,
          }}
        />
      </div>
    </div>
  );
});

// ============================================================================
// Compact Building Card
// ============================================================================

interface BuildingCardProps {
  building: Building;
  isSelected: boolean;
  onClick: () => void;
}

const BuildingCard = React.memo(function BuildingCard({
  building,
  isSelected,
  onClick,
}: BuildingCardProps) {
  const typeConfig = BUILDING_TYPES[building.type] || BUILDING_TYPES.server;
  const statusClass = building.status || 'unknown';

  return (
    <div
      className={`exp-building-card exp-building-card--${statusClass} ${isSelected ? 'exp-building-card--selected' : ''}`}
      onClick={onClick}
      title={`${building.name} - ${building.status || 'unknown'}`}
    >
      <span className="exp-building-card__emoji">{typeConfig.icon}</span>
      <span className="exp-building-card__name">{building.name}</span>
      <span className="exp-building-card__status-dot" data-status={statusClass} />
    </div>
  );
});

// ============================================================================
// Collapsible Section
// ============================================================================

interface CollapsibleSectionProps {
  title: string;
  icon?: string;
  count?: number;
  color?: string;
  isCollapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const CollapsibleSection = React.memo(function CollapsibleSection({
  title,
  icon,
  count,
  color,
  isCollapsed,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  return (
    <div className="exp-collapsible">
      <div
        className="exp-collapsible__header"
        style={color ? { borderLeftColor: color } : undefined}
        onClick={onToggle}
      >
        <span className="exp-collapsible__toggle">{isCollapsed ? '▶' : '▼'}</span>
        {icon && <span className="exp-collapsible__icon">{icon}</span>}
        <span className="exp-collapsible__title">{title}</span>
        {count !== undefined && <span className="exp-collapsible__count">{count}</span>}
      </div>
      {!isCollapsed && <div className="exp-collapsible__content">{children}</div>}
    </div>
  );
});

// ============================================================================
// Rich Chat View — reuses AgentTerminalPane from 3D view
// ============================================================================

interface ChatViewProps {
  agentId: string;
  terminalViewMode: TerminalViewMode;
  onTerminalViewModeChange: (mode: TerminalViewMode) => void;
  inspectorOpen: boolean;
  onToggleInspector: () => void;
  onImageClick: (url: string, name: string) => void;
  onFileClick: (path: string, editData?: any) => void;
  onBashClick: (command: string, output: string) => void;
  onViewMarkdown: (content: string) => void;
  keyboard: ReturnType<typeof useKeyboardHeight>;
}

const TERMINAL_VIEW_MODES: TerminalViewMode[] = ['simple', 'chat', 'advanced'];
const TERMINAL_VIEW_MODE_LABELS: Record<TerminalViewMode, string> = {
  simple: 'Simple',
  chat: 'Chat',
  advanced: 'Advanced',
};
const TERMINAL_VIEW_MODE_ICONS: Record<TerminalViewMode, string> = {
  simple: '○',
  chat: '◐',
  advanced: '◉',
};
const TERMINAL_VIEW_MODE_DESCRIPTIONS: Record<TerminalViewMode, string> = {
  simple: 'Simple view — clean messages only',
  chat: 'Chat view — assistant replies (no tool calls)',
  advanced: 'Advanced view — everything including tools',
};

function formatCwdShort(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  if (parts.length === 0) return cwd;
  return parts.slice(-2).join('/');
}

const ChatView = React.memo(function ChatView({
  agentId,
  terminalViewMode,
  onTerminalViewModeChange,
  inspectorOpen,
  onToggleInspector,
  onImageClick,
  onFileClick,
  onBashClick,
  onViewMarkdown,
  keyboard,
}: ChatViewProps) {
  const agent = useAgent(agentId);
  const paneRef = useRef<AgentTerminalPaneHandle>(null);

  if (!agent) {
    return (
      <div className="exp-chat exp-chat--empty">
        <div className="exp-chat__placeholder">
          <span className="exp-chat__placeholder-icon">💬</span>
          <span className="exp-chat__placeholder-text">Select an agent to start chatting</span>
        </div>
      </div>
    );
  }

  // Context / token usage calculations (mirrors the 3D overlay footer widget)
  const contextStats = agent.contextStats;
  const contextHasData = !!contextStats;
  const contextTotalTokens = contextStats
    ? contextStats.totalTokens
    : agent.contextUsed || 0;
  const contextWindow = contextStats
    ? contextStats.contextWindow
    : agent.contextLimit || 200000;
  const contextUsedPercentRaw = contextStats
    ? contextStats.usedPercent
    : Math.round((contextTotalTokens / contextWindow) * 100);
  const contextUsedPercent = Math.max(0, Math.min(100, contextUsedPercentRaw));
  const contextColor =
    contextUsedPercent >= 80
      ? '#ff4a4a'
      : contextUsedPercent >= 60
        ? '#ff9e4a'
        : contextUsedPercent >= 40
          ? '#ffd700'
          : '#4aff9e';
  const contextUsedK = (contextTotalTokens / 1000).toFixed(1);
  const contextLimitK = (contextWindow / 1000).toFixed(1);

  const cwd = agent.cwd;
  const cwdShort = cwd ? formatCwdShort(cwd) : null;

  return (
    <div className="exp-terminal-wrapper">
      <div className="exp-terminal-wrapper__header">
        <div className="exp-terminal-wrapper__header-main">
          <AgentIcon agent={agent} size={28} />
          <div className="exp-terminal-wrapper__header-info">
            <span className="exp-terminal-wrapper__header-name">{agent.name}</span>
            <span
              className="exp-terminal-wrapper__header-status"
              style={{ color: getAgentStatusColor(agent.status) }}
            >
              {agent.status}
            </span>
          </div>
          {agent.taskLabel && (
            <span className="exp-terminal-wrapper__header-task" title={agent.taskLabel}>
              📋 {agent.taskLabel}
            </span>
          )}
        </div>
        <div className="exp-terminal-wrapper__header-meta">
          {cwd && cwdShort && (
            <span
              className="exp-terminal-wrapper__cwd"
              title={cwd}
              onClick={() => store.setFileViewerPath(cwd)}
            >
              <span className="exp-terminal-wrapper__cwd-icon">📁</span>
              <span className="exp-terminal-wrapper__cwd-text">{cwdShort}</span>
            </span>
          )}
          <span
            className="exp-terminal-wrapper__context"
            onClick={() => store.setContextModalAgentId(agentId)}
            title={
              contextHasData
                ? `Context usage: ${contextUsedK}k / ${contextLimitK}k tokens (${contextUsedPercent}% used). Click to view stats.`
                : 'Click to fetch context stats'
            }
          >
            <span className="exp-terminal-wrapper__context-icon">📊</span>
            <span className="exp-terminal-wrapper__context-bar">
              <span
                className="exp-terminal-wrapper__context-bar-fill"
                style={{ width: `${contextUsedPercent}%`, backgroundColor: contextColor }}
              />
            </span>
            <span
              className="exp-terminal-wrapper__context-tokens"
              style={{ color: contextColor }}
            >
              {contextUsedK}k/{contextLimitK}k
            </span>
            {!contextHasData && (
              <span className="exp-terminal-wrapper__context-warning" title="No context stats yet">
                ⚠️
              </span>
            )}
          </span>
          <div
            className="exp-terminal-wrapper__view-mode"
            role="group"
            aria-label="Message view mode"
          >
            {TERMINAL_VIEW_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={`exp-terminal-wrapper__view-mode-btn ${
                  terminalViewMode === mode ? 'exp-terminal-wrapper__view-mode-btn--active' : ''
                }`}
                onClick={() => onTerminalViewModeChange(mode)}
                title={TERMINAL_VIEW_MODE_DESCRIPTIONS[mode]}
                aria-pressed={terminalViewMode === mode}
              >
                <span className="exp-terminal-wrapper__view-mode-icon" aria-hidden="true">
                  {TERMINAL_VIEW_MODE_ICONS[mode]}
                </span>
                <span className="exp-terminal-wrapper__view-mode-label">
                  {TERMINAL_VIEW_MODE_LABELS[mode]}
                </span>
              </button>
            ))}
          </div>
          <div className="exp-terminal-wrapper__theme">
            <ThemeSelector />
          </div>
          <button
            type="button"
            className={`exp-terminal-wrapper__inspector-toggle ${
              inspectorOpen ? 'exp-terminal-wrapper__inspector-toggle--active' : ''
            }`}
            onClick={onToggleInspector}
            title={inspectorOpen ? 'Hide inspector panel' : 'Show inspector panel'}
            aria-label={inspectorOpen ? 'Hide inspector panel' : 'Show inspector panel'}
            aria-pressed={inspectorOpen}
          >
            <span className="exp-terminal-wrapper__inspector-icon" aria-hidden="true">
              {/* Sidebar-right icon */}
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
                <line x1="10" y1="2.5" x2="10" y2="13.5" />
              </svg>
            </span>
            <span className="exp-terminal-wrapper__inspector-label">Inspector</span>
          </button>
        </div>
      </div>
      <AgentTerminalPane
        ref={paneRef}
        agentId={agentId}
        agent={agent}
        viewMode={terminalViewMode}
        isOpen={true}
        isSnapshotView={false}
        currentSnapshot={null}
        onImageClick={onImageClick}
        onFileClick={onFileClick}
        onBashClick={onBashClick}
        onViewMarkdown={onViewMarkdown}
        keyboard={keyboard}
        hasModalOpen={false}
      />
    </div>
  );
});

// ============================================================================
// Placeholder Content for Other Sections
// ============================================================================

const CommanderPlaceholder = () => (
  <div className="exp-placeholder">
    <span className="exp-placeholder__icon">🎮</span>
    <span className="exp-placeholder__title">Commander View</span>
    <span className="exp-placeholder__text">Multi-agent terminal grid coming soon</span>
  </div>
);

const SettingsPlaceholder = () => (
  <div className="exp-placeholder">
    <span className="exp-placeholder__icon">⚙️</span>
    <span className="exp-placeholder__title">Settings</span>
    <span className="exp-placeholder__text">Configuration options coming soon</span>
  </div>
);

const SkillsPlaceholder = () => (
  <div className="exp-placeholder">
    <span className="exp-placeholder__icon">⚡</span>
    <span className="exp-placeholder__title">Skills</span>
    <span className="exp-placeholder__text">Manage agent skills coming soon</span>
  </div>
);

const WorkflowsPlaceholder = () => (
  <div className="exp-placeholder">
    <span className="exp-placeholder__icon">🔄</span>
    <span className="exp-placeholder__title">Workflows</span>
    <span className="exp-placeholder__text">Workflow automation coming soon</span>
  </div>
);

// ============================================================================
// Main Component
// ============================================================================

export function Scene2DExperimental({
  onAgentClick,
  onAgentDoubleClick,
  onBuildingClick,
  onBuildingDoubleClick,
  onAreaClick,
  onContextMenu,
  onOpenSpawnModal,
  onOpenBossSpawnModal,
  onOpenBuildingModal,
  onOpenAreaModal,
}: Scene2DExperimentalProps) {
  const agents = useAgentsArray();
  const areas = useAreas();
  const buildings = useBuildings();
  const selectedAgentIds = useSelectedAgentIds();
  const selectedBuildingIds = useSelectedBuildingIds();
  const agentsWithUnseen = useAgentsWithUnseenOutput();

  const [activeSection, setActiveSection] = useState<MenuSection>('agents');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Modal state for terminal integration (owned by parent, shown over everything)
  const [imageModal, setImageModal] = useState<{ url: string; name: string } | null>(null);
  const [bashModal, setBashModal] = useState<BashModalState | null>(null);

  // Terminal view-mode (simple/chat/advanced). Shared with the 3D overlay via
  // STORAGE_KEYS.VIEW_MODE so users don't have to re-configure their preference.
  const [terminalViewMode, setTerminalViewModeState] = useState<TerminalViewMode>(() => {
    const saved = getStorageString(STORAGE_KEYS.VIEW_MODE);
    if (saved === 'simple' || saved === 'chat' || saved === 'advanced') {
      return saved;
    }
    return 'simple';
  });

  // Persist changes and keep in sync if another surface (3D overlay) updates it.
  const handleTerminalViewModeChange = useCallback((mode: TerminalViewMode) => {
    setTerminalViewModeState(mode);
    setStorageString(STORAGE_KEYS.VIEW_MODE, mode);
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEYS.VIEW_MODE) return;
      const value = event.newValue;
      if (value === 'simple' || value === 'chat' || value === 'advanced') {
        setTerminalViewModeState(value);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Inspector side-panel state (pushes the chat column rather than overlaying)
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(() =>
    getStorageBoolean(STORAGE_KEYS.FLAT_INSPECTOR_OPEN, false)
  );

  const handleToggleInspector = useCallback(() => {
    setInspectorOpen((prev) => {
      const next = !prev;
      setStorageBoolean(STORAGE_KEYS.FLAT_INSPECTOR_OPEN, next);
      return next;
    });
  }, []);

  const handleCloseInspector = useCallback(() => {
    setInspectorOpen(false);
    setStorageBoolean(STORAGE_KEYS.FLAT_INSPECTOR_OPEN, false);
  }, []);

  // Shared keyboard-height hook for mobile (must be stable across rerenders)
  const keyboard = useKeyboardHeight();

  // Modal callbacks for the terminal pane
  const handleImageClick = useCallback((url: string, name: string) => {
    setImageModal({ url, name });
  }, []);

  const handleBashClick = useCallback((command: string, output: string) => {
    setBashModal({ command, output, isLive: false });
  }, []);

  const handleFileClick = useCallback((path: string, editData?: any) => {
    // Reuse the global file-viewer flow from the store
    store.setFileViewerPath(path, editData);
  }, []);

  const handleViewMarkdown = useCallback((_content: string) => {
    // No markdown modal wired in this view yet; no-op keeps the pane happy.
  }, []);

  // Get first selected agent for chat view
  const selectedAgentId = useMemo(() => {
    return selectedAgentIds.size > 0 ? Array.from(selectedAgentIds)[0] : null;
  }, [selectedAgentIds]);

  // Group agents by area
  const { areaAgents, unassignedAgents, bossAgents } = useMemo(() => {
    const areaMap = new Map<string, Agent[]>();
    const unassigned: Agent[] = [];
    const bosses: Agent[] = [];

    areas.forEach((_, areaId) => {
      areaMap.set(areaId, []);
    });

    agents.forEach((agent) => {
      if (agent.isBoss) {
        bosses.push(agent);
      }

      let assigned = false;
      areas.forEach((area, areaId) => {
        if (area.assignedAgentIds?.includes(agent.id)) {
          const list = areaMap.get(areaId) || [];
          list.push(agent);
          areaMap.set(areaId, list);
          assigned = true;
        }
      });

      if (!assigned && !agent.isBoss) {
        unassigned.push(agent);
      }
    });

    return { areaAgents: areaMap, unassignedAgents: unassigned, bossAgents: bosses };
  }, [agents, areas]);

  // Group buildings
  const buildingsArray = useMemo(() => Array.from(buildings.values()), [buildings]);

  const toggleSection = useCallback((section: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  const handleAgentClick = useCallback(
    (agentId: string) => {
      onAgentClick(agentId);
    },
    [onAgentClick]
  );

  const sortedAreas = useMemo(() => {
    return Array.from(areas.entries())
      .filter(([_, area]) => !area.archived)
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [areas]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (onContextMenu) {
        onContextMenu({ x: e.clientX, y: e.clientY }, { type: 'ground' });
      }
    },
    [onContextMenu]
  );

  // Render middle column content based on active section
  const renderMiddleContent = () => {
    if (activeSection !== 'agents') {
      return null;
    }

    return (
      <>
        {/* Boss Agents */}
        {bossAgents.length > 0 && (
          <CollapsibleSection
            title="Boss Agents"
            icon="👑"
            count={bossAgents.length}
            isCollapsed={collapsedSections.has('bosses')}
            onToggle={() => toggleSection('bosses')}
          >
            <div className="exp-agents-grid">
              {bossAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  isSelected={selectedAgentIds.has(agent.id)}
                  hasUnseen={agentsWithUnseen.has(agent.id)}
                  onClick={() => handleAgentClick(agent.id)}
                />
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Areas */}
        {sortedAreas.map(([areaId, area]) => {
          const areaAgentsList = areaAgents.get(areaId) || [];
          return (
            <CollapsibleSection
              key={areaId}
              title={area.name}
              count={areaAgentsList.length}
              color={area.color}
              isCollapsed={collapsedSections.has(areaId)}
              onToggle={() => toggleSection(areaId)}
            >
              {areaAgentsList.length === 0 ? (
                <div className="exp-empty-section">No agents</div>
              ) : (
                <div className="exp-agents-grid">
                  {areaAgentsList.map((agent) => (
                    <AgentCard
                      key={agent.id}
                      agent={agent}
                      isSelected={selectedAgentIds.has(agent.id)}
                      hasUnseen={agentsWithUnseen.has(agent.id)}
                      onClick={() => handleAgentClick(agent.id)}
                    />
                  ))}
                </div>
              )}
            </CollapsibleSection>
          );
        })}

        {/* Unassigned Agents */}
        {unassignedAgents.length > 0 && (
          <CollapsibleSection
            title="Unassigned"
            count={unassignedAgents.length}
            isCollapsed={collapsedSections.has('unassigned')}
            onToggle={() => toggleSection('unassigned')}
          >
            <div className="exp-agents-grid">
              {unassignedAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  isSelected={selectedAgentIds.has(agent.id)}
                  hasUnseen={agentsWithUnseen.has(agent.id)}
                  onClick={() => handleAgentClick(agent.id)}
                />
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Buildings */}
        {buildingsArray.length > 0 && (
          <CollapsibleSection
            title="Buildings"
            icon="🏗️"
            count={buildingsArray.length}
            isCollapsed={collapsedSections.has('buildings')}
            onToggle={() => toggleSection('buildings')}
          >
            <div className="exp-buildings-grid">
              {buildingsArray.map((building) => (
                <BuildingCard
                  key={building.id}
                  building={building}
                  isSelected={selectedBuildingIds.has(building.id)}
                  onClick={() => onBuildingClick(building.id)}
                />
              ))}
            </div>
          </CollapsibleSection>
        )}

        {/* Empty State */}
        {agents.length === 0 && buildingsArray.length === 0 && (
          <div className="exp-empty-state">
            <span className="exp-empty-state__icon">🚀</span>
            <span className="exp-empty-state__title">No agents yet</span>
            <span className="exp-empty-state__hint">Spawn agents to get started</span>
          </div>
        )}
      </>
    );
  };

  // Render right column content based on active section
  const renderRightContent = () => {
    switch (activeSection) {
      case 'agents':
        return selectedAgentId ? (
          <ChatView
            agentId={selectedAgentId}
            terminalViewMode={terminalViewMode}
            onTerminalViewModeChange={handleTerminalViewModeChange}
            inspectorOpen={inspectorOpen}
            onToggleInspector={handleToggleInspector}
            onImageClick={handleImageClick}
            onFileClick={handleFileClick}
            onBashClick={handleBashClick}
            onViewMarkdown={handleViewMarkdown}
            keyboard={keyboard}
          />
        ) : (
          <div className="exp-chat exp-chat--empty">
            <div className="exp-chat__placeholder">
              <span className="exp-chat__placeholder-icon">💬</span>
              <span className="exp-chat__placeholder-text">Select an agent to start chatting</span>
            </div>
          </div>
        );
      case 'commander':
        return <CommanderPlaceholder />;
      case 'settings':
        return <SettingsPlaceholder />;
      case 'skills':
        return <SkillsPlaceholder />;
      case 'workflows':
        return <WorkflowsPlaceholder />;
      default:
        return null;
    }
  };

  const showInspector = inspectorOpen && activeSection === 'agents' && !!selectedAgentId;

  return (
    <div
      className={`scene-2d-experimental ${showInspector ? 'scene-2d-experimental--with-inspector' : ''}`}
      onContextMenu={handleContextMenu}
    >
      {/* Left Sidebar - Navigation */}
      <SidebarMenu activeSection={activeSection} onSectionChange={setActiveSection} />

      {/* Middle Column - Agents/Buildings/Areas */}
      <div className="exp-middle">
        <div className="exp-middle__header">
          <h2 className="exp-middle__title">
            {activeSection === 'agents' && '👥 Agents & Buildings'}
            {activeSection === 'commander' && '🎮 Commander'}
            {activeSection === 'settings' && '⚙️ Settings'}
            {activeSection === 'skills' && '⚡ Skills'}
            {activeSection === 'workflows' && '🔄 Workflows'}
          </h2>
          {activeSection === 'agents' && (
            <div className="exp-middle__actions">
              <button
                className="exp-cta-btn exp-cta-btn--agent"
                onClick={onOpenSpawnModal}
                title="Create new agent"
              >
                + Agent
              </button>
              <button
                className="exp-cta-btn exp-cta-btn--boss"
                onClick={onOpenBossSpawnModal}
                title="Create new boss agent"
              >
                + Boss
              </button>
              <button
                className="exp-cta-btn exp-cta-btn--building"
                onClick={onOpenBuildingModal}
                title="Create new building"
              >
                + Building
              </button>
              <button
                className="exp-cta-btn exp-cta-btn--area"
                onClick={onOpenAreaModal}
                title="Create new area"
              >
                + Area
              </button>
            </div>
          )}
        </div>
        <div className="exp-middle__content">
          {activeSection === 'agents' ? (
            renderMiddleContent()
          ) : activeSection === 'commander' ? (
            <CommanderPlaceholder />
          ) : activeSection === 'settings' ? (
            <SettingsPlaceholder />
          ) : activeSection === 'skills' ? (
            <SkillsPlaceholder />
          ) : activeSection === 'workflows' ? (
            <WorkflowsPlaceholder />
          ) : null}
        </div>
      </div>

      {/* Right Column - Chat/Details */}
      <div className="exp-right">
        {renderRightContent()}
      </div>

      {/* Inspector Column - Pushes chat column rather than overlaying */}
      {showInspector && selectedAgentId && (
        <aside className="exp-inspector" aria-label="Inspector panel">
          <div className="exp-inspector__header">
            <span className="exp-inspector__title">
              <span className="exp-inspector__title-icon" aria-hidden="true">🔎</span>
              Inspector
            </span>
            <button
              type="button"
              className="exp-inspector__close"
              onClick={handleCloseInspector}
              title="Close inspector"
              aria-label="Close inspector"
            >
              ✕
            </button>
          </div>
          <div className="exp-inspector__body">
            {(() => {
              const selectedAgent = agents.find((a) => a.id === selectedAgentId);
              if (!selectedAgent) {
                return (
                  <div className="exp-inspector__empty">
                    <span>Agent not found</span>
                  </div>
                );
              }
              return (
                <SingleAgentPanel
                  agent={selectedAgent}
                  onFocusAgent={(agentId) => onAgentClick(agentId)}
                  onKillAgent={(agentId) => store.killAgent(agentId)}
                />
              );
            })()}
          </div>
        </aside>
      )}

      {/* Terminal modals — portal-based, so position here is fine */}
      {imageModal && (
        <ImageModal
          url={imageModal.url}
          name={imageModal.name}
          onClose={() => setImageModal(null)}
        />
      )}
      {bashModal && (
        <BashModal
          state={bashModal}
          onClose={() => setBashModal(null)}
        />
      )}
    </div>
  );
}
