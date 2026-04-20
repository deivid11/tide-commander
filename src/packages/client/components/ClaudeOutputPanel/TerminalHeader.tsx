/**
 * TerminalHeader - Header component for the terminal panel
 *
 * Displays agent info, status, actions buttons, and view mode toggle.
 */

import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useSettings, useLastPrompt, useSubagentsForAgent, useAreas } from '../../store';
import { STORAGE_KEYS, setStorageString } from '../../utils/storage';
import { agentDebugger } from '../../services/agentDebugger';
import { Tooltip } from '../shared/Tooltip';

import type { Agent } from '../../../shared/types';
import type { ViewMode } from './types';
import { VIEW_MODES } from './types';
import { themes, getTheme, applyTheme, getSavedTheme, type ThemeId } from '../../utils/themes';
import { AgentIcon } from '../AgentIcon';
import { Icon } from '../Icon';
import { useTwoClickConfirm } from '../../hooks';

export interface TerminalHeaderProps {
  selectedAgent: Agent;
  selectedAgentId: string;
  sortedAgents: Agent[];
  isSwipingLeft: boolean;
  isSwipingRight: boolean;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  searchMode: boolean;
  toggleSearch: () => void;
  closeSearch: () => void;
  debugPanelOpen: boolean;
  setDebugPanelOpen: (open: boolean) => void;
  debuggerEnabled: boolean;
  setDebuggerEnabled: (enabled: boolean) => void;
  outputsLength: number;
  setContextConfirm: (action: 'collapse' | 'clear' | 'clear-subordinates' | null) => void;
  onClearContextDirect: () => void;
  headerRef: React.RefObject<HTMLDivElement | null>;
  /** Agent overview panel open state */
  overviewPanelOpen?: boolean;
  setOverviewPanelOpen?: (open: boolean) => void;
  /** Agent info modal open state */
  agentInfoOpen?: boolean;
  /** Callback to open/close agent info modal */
  onToggleAgentInfo?: () => void;
  /** Fullscreen state for terminal */
  isFullscreen?: boolean;
  /** Toggle terminal fullscreen mode */
  onToggleFullscreen?: () => void;
  /** Navigate to previous agent in terminal history */
  onNavigateBack?: () => void;
  /** Navigate to next agent in terminal history */
  onNavigateForward?: () => void;
  /** Whether previous navigation is available */
  canNavigateBack?: boolean;
  /** Whether forward navigation is available */
  canNavigateForward?: boolean;
  /** Git panel open state */
  gitPanelOpen?: boolean;
  /** Toggle git panel */
  setGitPanelOpen?: (open: boolean) => void;
  /** Buildings panel open state */
  buildingsPanelOpen?: boolean;
  /** Toggle buildings panel */
  setBuildingsPanelOpen?: (open: boolean) => void;
  /** Workflow panel open state */
  workflowPanelOpen?: boolean;
  /** Toggle workflow panel */
  setWorkflowPanelOpen?: (open: boolean) => void;
  /** Whether this agent owns a workflow */
  hasWorkflow?: boolean;
  /** Tracking board panel open state */
  trackingBoardVisible?: boolean;
  /** Toggle tracking board panel */
  setTrackingBoardVisible?: (open: boolean) => void;
}

export const TerminalHeader = memo(function TerminalHeader({
  selectedAgent,
  selectedAgentId,
  sortedAgents,
  isSwipingLeft,
  isSwipingRight,
  viewMode,
  setViewMode,
  searchMode,
  toggleSearch,
  closeSearch,
  debugPanelOpen,
  setDebugPanelOpen,
  debuggerEnabled,
  setDebuggerEnabled,
  outputsLength,
  setContextConfirm,
  onClearContextDirect,
  headerRef,
  overviewPanelOpen = false,
  setOverviewPanelOpen,
  agentInfoOpen = false,
  onToggleAgentInfo,
  isFullscreen = false,
  onToggleFullscreen,
  onNavigateBack,
  onNavigateForward,
  canNavigateBack = false,
  canNavigateForward = false,
  gitPanelOpen = false,
  setGitPanelOpen,
  buildingsPanelOpen = false,
  setBuildingsPanelOpen,
  workflowPanelOpen = false,
  setWorkflowPanelOpen,
  hasWorkflow = false,
  trackingBoardVisible = false,
  setTrackingBoardVisible,
}: TerminalHeaderProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const _settings = useSettings();
  const lastPrompt = useLastPrompt(selectedAgentId);
  const clearContextConfirm = useTwoClickConfirm();
  const clearContextConfirmId = `clear-context:${selectedAgentId}`;
  const isClearContextPending = clearContextConfirm.isPending(clearContextConfirmId);

  const handleViewModeToggle = () => {
    const currentIndex = VIEW_MODES.indexOf(viewMode);
    const nextMode = VIEW_MODES[(currentIndex + 1) % VIEW_MODES.length];
    setViewMode(nextMode);
    setStorageString(STORAGE_KEYS.VIEW_MODE, nextMode);
  };

  const handleDebugToggle = () => {
    const newOpen = !debugPanelOpen;
    setDebugPanelOpen(newOpen);
    if (newOpen && !debuggerEnabled) {
      setDebuggerEnabled(true);
      agentDebugger.setEnabled(true);
    }
  };

  const handleSearchToggle = () => {
    if (searchMode) {
      closeSearch();
    } else {
      toggleSearch();
    }
  };

  const handleRemoveAgent = () => {
    const confirmed = window.confirm(t('common:confirm.removeAgent', { name: selectedAgent.name }));
    if (!confirmed) return;
    store.removeAgentFromServer(selectedAgentId);
  };

  // Get status info
  const lastInput =
    selectedAgent.currentTask ||
    selectedAgent.lastAssignedTask ||
    lastPrompt?.text;
  const mobileHeaderContext = selectedAgent.taskLabel || lastInput;

  // Check if selected agent is a boss with subordinates
  const isBoss = selectedAgent.class === 'boss' || selectedAgent.isBoss;
  const hasSubordinates = isBoss && selectedAgent.subordinateIds && selectedAgent.subordinateIds.length > 0;

  // Check for active subagents (Claude Code Task tool subprocesses)
  const subagents = useSubagentsForAgent(selectedAgentId);

  // Find the area this agent belongs to (for colored border)
  const areas = useAreas();
  const agentArea = React.useMemo(() => {
    for (const area of areas.values()) {
      if (area.assignedAgentIds?.includes(selectedAgentId)) return area;
    }
    return null;
  }, [areas, selectedAgentId]);

  // Desktop kebab menu state (for context actions + less-used toggles)
  const [desktopMenuOpen, setDesktopMenuOpen] = useState(false);
  const desktopMenuRef = useRef<HTMLDivElement>(null);

  // Mobile overflow menu state
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileThemeExpanded, setMobileThemeExpanded] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeId>(() => getSavedTheme());
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const viewModeLabel = viewMode === 'simple'
    ? t('terminal:header.simpleView')
    : viewMode === 'chat'
      ? t('terminal:header.chatView')
      : t('terminal:header.advancedView');
  const viewModeIconEl = viewMode === 'simple'
    ? <Icon name="status-pending" size={14} />
    : viewMode === 'chat'
      ? <Icon name="status-pending" size={14} weight="duotone" />
      : <Icon name="target" size={14} />;

  const closeDesktopMenu = useCallback(() => {
    setDesktopMenuOpen(false);
  }, []);

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
    setMobileThemeExpanded(false);
  }, []);

  const handleMobileThemeSelect = (themeId: ThemeId) => {
    const theme = getTheme(themeId);
    applyTheme(theme);
    setCurrentTheme(themeId);
  };

  // Close desktop kebab menu on outside click
  useEffect(() => {
    if (!desktopMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (desktopMenuRef.current && !desktopMenuRef.current.contains(e.target as Node)) {
        closeDesktopMenu();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [desktopMenuOpen, closeDesktopMenu]);

  // Close menu on outside click
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) {
        closeMobileMenu();
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('touchstart', handleClick as EventListener);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('touchstart', handleClick as EventListener);
    };
  }, [mobileMenuOpen, closeMobileMenu]);

  return (
    <div
      className={`guake-header ${sortedAgents.length > 1 ? 'has-multiple-agents' : ''} ${isSwipingRight ? 'swiping-right' : ''} ${isSwipingLeft ? 'swiping-left' : ''}`}
      ref={headerRef}
      style={agentArea ? { borderBottomColor: `color-mix(in srgb, ${agentArea.color} 50%, var(--border-color))` } as React.CSSProperties : undefined}
    >
      <div className="guake-header-left">
        <div className="guake-header-title-row">
          {selectedAgent.isDetached && (
            <Tooltip
              content={
                <>
                  <div className="tide-tooltip__title"><Icon name="refresh" size={14} /> Reattaching Session...</div>
                  <div className="tide-tooltip__text">
                    This agent's Claude process is running independently. Tide Commander is automatically
                    attempting to reattach to the existing session. If reattachment fails, send a new message
                    to manually resume the session.
                    <br /><br />
                    <strong>Status:</strong> Recovering session context and output history...
                  </div>
                </>
              }
              position="bottom"
              className="tide-tooltip--detached"
            >
              <span className="guake-detached-badge" title="Agent is detached - reattaching...">
                <span className="guake-detached-spinner"><Icon name="refresh" size={12} /></span>
              </span>
            </Tooltip>
          )}
          {onToggleAgentInfo ? (
            <button
              className={`guake-title-btn ${agentInfoOpen ? 'active' : ''}`}
              onClick={onToggleAgentInfo}
              title={t('terminal:header.showAgentInfo')}
            >
              <span className="guake-agent-avatar"><AgentIcon agent={selectedAgent} size="100%" /></span>
              <span className="guake-title-block">
                <span className="guake-title-main-row">
                  <span className="guake-title">{selectedAgent.name}</span>
                  {(selectedAgent.taskLabel || lastInput) && (
                    <span className="guake-title-task-chip">{selectedAgent.taskLabel || lastInput}</span>
                  )}
                </span>
                {mobileHeaderContext && (
                  <span className="guake-mobile-title-context">{mobileHeaderContext}</span>
                )}
              </span>
              <span className="guake-title-accessory">
                <img
                  src={selectedAgent.provider === 'codex' ? `${import.meta.env.BASE_URL}assets/codex.png` : selectedAgent.provider === 'opencode' ? `${import.meta.env.BASE_URL}assets/opencode.png` : `${import.meta.env.BASE_URL}assets/claude.png`}
                  alt={selectedAgent.provider}
                  className="guake-provider-icon"
                  title={selectedAgent.provider === 'codex' ? 'Codex Agent' : selectedAgent.provider === 'opencode' ? 'OpenCode Agent' : 'Claude Agent'}
                />
              </span>
            </button>
          ) : (
            <div className="guake-title-with-provider">
              <span className="guake-agent-avatar"><AgentIcon agent={selectedAgent} size="100%" /></span>
              <span className="guake-title-block">
                <span className="guake-title-main-row">
                  <span className="guake-title">{selectedAgent.name}</span>
                  {(selectedAgent.taskLabel || lastInput) && (
                    <span className="guake-title-task-chip">{selectedAgent.taskLabel || lastInput}</span>
                  )}
                </span>
                {mobileHeaderContext && (
                  <span className="guake-mobile-title-context">{mobileHeaderContext}</span>
                )}
              </span>
              <span className="guake-title-accessory">
                <img
                  src={selectedAgent.provider === 'codex' ? `${import.meta.env.BASE_URL}assets/codex.png` : selectedAgent.provider === 'opencode' ? `${import.meta.env.BASE_URL}assets/opencode.png` : `${import.meta.env.BASE_URL}assets/claude.png`}
                  alt={selectedAgent.provider}
                  className="guake-provider-icon"
                  title={selectedAgent.provider === 'codex' ? 'Codex Agent' : selectedAgent.provider === 'opencode' ? 'OpenCode Agent' : 'Claude Agent'}
                />
              </span>
            </div>
          )}
        </div>
        <div className="guake-header-meta">
          {subagents.filter(s => s.status === 'spawning' || s.status === 'working').length > 0 && (
            <span className="guake-subagents-indicator">
              {subagents
                .filter(s => s.status === 'spawning' || s.status === 'working')
                .map(sub => (
                  <span
                    key={sub.id}
                    className="guake-subagent-badge active"
                    title={`${sub.name} (${sub.subagentType}) - ${sub.status}`}
                  >
                    <span className="guake-subagent-icon">⑂</span>
                    <span className="guake-subagent-name">{sub.name}</span>
                  </span>
                ))}
            </span>
          )}
        </div>
      </div>
      <div className="guake-actions">
        {/* Primary actions - always visible on desktop */}
        <div className="guake-action-cluster guake-action-cluster--compact hide-on-mobile">
          <button
            className="guake-icon-action guake-nav-btn"
            onClick={onNavigateBack}
            title="Back (Alt+Left)"
            disabled={!canNavigateBack}
          >
            <span className="guake-action-icon"><Icon name="arrow-left" size={14} /></span>
          </button>
          <button
            className="guake-icon-action guake-nav-btn"
            onClick={onNavigateForward}
            title="Forward (Alt+Right)"
            disabled={!canNavigateForward}
          >
            <span className="guake-action-icon"><Icon name="arrow-right" size={14} /></span>
          </button>
          {setOverviewPanelOpen && (
            <button
              className={`guake-icon-action guake-overview-toggle ${overviewPanelOpen ? 'active' : ''}`}
              onClick={() => setOverviewPanelOpen(!overviewPanelOpen)}
              title={overviewPanelOpen ? t('terminal:header.hideOverview') : t('terminal:header.showOverview')}
            >
              <span className="guake-action-icon"><Icon name="dashboard" size={16} /></span>
            </button>
          )}
          {setGitPanelOpen && (
            <button
              className={`guake-icon-action guake-git-toggle ${gitPanelOpen ? 'active' : ''}`}
              onClick={() => setGitPanelOpen(!gitPanelOpen)}
              title={gitPanelOpen ? 'Hide Git Changes' : 'Show Git Changes'}
            >
              <span className="guake-action-icon"><Icon name="git-branch" size={16} /></span>
            </button>
          )}
          {hasWorkflow && setWorkflowPanelOpen && (
            <button
              className={`guake-icon-action guake-workflow-toggle ${workflowPanelOpen ? 'active' : ''}`}
              onClick={() => setWorkflowPanelOpen(!workflowPanelOpen)}
              title={workflowPanelOpen ? 'Hide Workflow' : 'Show Workflow'}
            >
              <span className="guake-action-icon"><Icon name="refresh" size={16} /></span>
            </button>
          )}
          {setTrackingBoardVisible && (
            <button
              className={`guake-icon-action guake-tracking-board-toggle ${trackingBoardVisible ? 'active' : ''}`}
              onClick={() => setTrackingBoardVisible(!trackingBoardVisible)}
              title={trackingBoardVisible ? 'Hide Tracking Board' : 'Show Tracking Board'}
            >
              <span className="guake-action-icon"><Icon name="list-checks" size={16} /></span>
            </button>
          )}
          <button
            className={`guake-icon-action guake-fullscreen-toggle ${isFullscreen ? 'active' : ''}`}
            onClick={onToggleFullscreen}
            title={isFullscreen ? t('terminal:header.exitFullscreen') : t('terminal:header.enterFullscreen')}
          >
            <span className="guake-action-icon"><Icon name={isFullscreen ? 'exit-fullscreen' : 'fullscreen'} size={16} /></span>
          </button>
          <button
            className={`guake-icon-action guake-search-toggle ${searchMode ? 'active' : ''}`}
            onClick={handleSearchToggle}
            title={t('terminal:header.search')}
          >
            <span className="guake-action-icon"><Icon name="search" size={16} /></span>
          </button>
          <button
            className={`guake-icon-action danger${isClearContextPending ? ' confirm-pending' : ''}`}
            onClick={() => clearContextConfirm.handleClick(clearContextConfirmId, onClearContextDirect)}
            title={isClearContextPending ? t('terminal:header.clearContextConfirm', { defaultValue: 'Click again to confirm' }) : t('terminal:header.clearContext')}
          >
            <span className="guake-action-icon">{isClearContextPending ? <Icon name="question" size={16} /> : <Icon name="clear" size={16} />}</span>
          </button>
        </div>
        {/* Desktop kebab menu - view toggle + context actions + less-used toggles */}
        <div className="guake-desktop-more hide-on-mobile" ref={desktopMenuRef}>
          <button
            className={`guake-desktop-more-btn ${desktopMenuOpen ? 'active' : ''}`}
            onClick={() => setDesktopMenuOpen(!desktopMenuOpen)}
            title={t('terminal:header.moreActions', 'More actions')}
          >
            ⋮
          </button>
          {desktopMenuOpen && (
            <div className="guake-desktop-menu">
              <button
                className="guake-desktop-menu-item"
                onClick={() => { handleViewModeToggle(); closeDesktopMenu(); }}
              >
                <span className="guake-desktop-menu-icon">{viewModeIconEl}</span>
                View: {viewModeLabel}
              </button>
              {setBuildingsPanelOpen && (
                  <button
                    className={`guake-desktop-menu-item ${buildingsPanelOpen ? 'active' : ''}`}
                    onClick={() => { setBuildingsPanelOpen(!buildingsPanelOpen); closeDesktopMenu(); }}
                  >
                    <span className="guake-desktop-menu-icon"><Icon name="package" size={16} /></span>
                    {buildingsPanelOpen ? 'Hide Buildings' : 'Show Buildings'}
                  </button>
                )}
                <button
                  className={`guake-desktop-menu-item ${debugPanelOpen ? 'active' : ''}`}
                  onClick={() => { handleDebugToggle(); closeDesktopMenu(); }}
                >
                  <span className="guake-desktop-menu-icon"><Icon name="bug" size={16} /></span>
                  {debugPanelOpen ? t('terminal:header.hideDebug') : t('terminal:header.showDebug')}
                </button>
                <div className="guake-desktop-menu-divider" />
                <button
                  className="guake-desktop-menu-item"
                  onClick={() => { setContextConfirm('collapse'); closeDesktopMenu(); }}
                  disabled={selectedAgent.status !== 'idle'}
                >
                  <span className="guake-desktop-menu-icon"><Icon name="package" size={16} /></span>
                  {t('terminal:header.collapseContext')}
                </button>
                {hasSubordinates && (
                  <button
                    className="guake-desktop-menu-item danger"
                    onClick={() => { setContextConfirm('clear-subordinates'); closeDesktopMenu(); }}
                  >
                    <span className="guake-desktop-menu-icon"><Icon name="crown" size={16} /></span>
                    {t('terminal:header.clearAllSubordinates')}
                  </button>
                )}
                <div className="guake-desktop-menu-divider" />
                <button
                  className="guake-desktop-menu-item danger"
                  onClick={() => { handleRemoveAgent(); closeDesktopMenu(); }}
                >
                  <span className="guake-desktop-menu-icon"><Icon name="cross" size={16} /></span>
                  {t('terminal:header.removeAgent')}
                </button>
              </div>
            )}
          </div>
        {/* Mobile more-actions menu */}
        <div className="guake-mobile-more show-on-mobile" ref={mobileMenuRef}>
            <button
              className={`guake-mobile-more-btn ${mobileMenuOpen ? 'active' : ''}`}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              title={t('terminal:header.moreActions', 'More actions')}
            >
              ⋮
            </button>
            {mobileMenuOpen && (
              <div className="guake-mobile-menu">
                <button
                  className="guake-mobile-menu-item"
                  onClick={() => { onNavigateBack?.(); closeMobileMenu(); }}
                  disabled={!canNavigateBack}
                >
                  <span className="guake-mobile-menu-icon"><Icon name="arrow-left" size={16} /></span>
                  Back
                </button>
                <button
                  className="guake-mobile-menu-item"
                  onClick={() => { onNavigateForward?.(); closeMobileMenu(); }}
                  disabled={!canNavigateForward}
                >
                  <span className="guake-mobile-menu-icon"><Icon name="arrow-right" size={16} /></span>
                  Forward
                </button>
                <button
                  className="guake-mobile-menu-item"
                  onClick={() => { handleViewModeToggle(); closeMobileMenu(); }}
                >
                  <span className="guake-mobile-menu-icon">
                    {viewMode === 'simple'
                      ? <Icon name="status-pending" size={12} />
                      : viewMode === 'chat'
                        ? <Icon name="status-pending" size={12} weight="duotone" />
                        : <Icon name="target" size={12} />}
                  </span>
                  {viewMode === 'simple'
                    ? t('terminal:header.simpleView')
                    : viewMode === 'chat'
                      ? t('terminal:header.chatView')
                      : t('terminal:header.advancedView')}
                </button>
                {outputsLength > 0 && (
                  <button
                    className="guake-mobile-menu-item"
                    onClick={() => { store.clearOutputs(selectedAgentId); closeMobileMenu(); }}
                  >
                    <span className="guake-mobile-menu-icon"><Icon name="trash" size={16} /></span>
                    {t('terminal:header.clearOutput')}
                  </button>
                )}
                <button
                  className={`guake-mobile-menu-item ${isFullscreen ? 'active' : ''}`}
                  onClick={() => { onToggleFullscreen?.(); closeMobileMenu(); }}
                >
                  <span className="guake-mobile-menu-icon"><Icon name={isFullscreen ? 'exit-fullscreen' : 'fullscreen'} size={16} /></span>
                  {isFullscreen ? t('terminal:header.exitFullscreen') : t('terminal:header.enterFullscreen')}
                </button>
                <button
                  className="guake-mobile-menu-item"
                  onClick={() => { handleSearchToggle(); closeMobileMenu(); }}
                >
                  <span className="guake-mobile-menu-icon"><Icon name={searchMode ? 'cross' : 'search'} size={16} /></span>
                  {t('terminal:header.search')}
                </button>
                {setOverviewPanelOpen && (
                  <button
                    className={`guake-mobile-menu-item ${overviewPanelOpen ? 'active' : ''}`}
                    onClick={() => { setOverviewPanelOpen(!overviewPanelOpen); closeMobileMenu(); }}
                  >
                    <span className="guake-mobile-menu-icon"><Icon name="dashboard" size={16} /></span>
                    {overviewPanelOpen ? t('terminal:header.hideOverview') : t('terminal:header.showOverview')}
                  </button>
                )}
                {setGitPanelOpen && (
                  <button
                    className={`guake-mobile-menu-item ${gitPanelOpen ? 'active' : ''}`}
                    onClick={() => { setGitPanelOpen(!gitPanelOpen); closeMobileMenu(); }}
                  >
                    <span className="guake-mobile-menu-icon"><Icon name="git-branch" size={16} /></span>
                    {gitPanelOpen ? 'Hide Git Changes' : 'Show Git Changes'}
                  </button>
                )}
                {hasWorkflow && setWorkflowPanelOpen && (
                  <button
                    className={`guake-mobile-menu-item ${workflowPanelOpen ? 'active' : ''}`}
                    onClick={() => { setWorkflowPanelOpen(!workflowPanelOpen); closeMobileMenu(); }}
                  >
                    <span className="guake-mobile-menu-icon"><Icon name="refresh" size={16} /></span>
                    {workflowPanelOpen ? 'Hide Workflow' : 'Show Workflow'}
                  </button>
                )}
                {setBuildingsPanelOpen && (
                  <button
                    className={`guake-mobile-menu-item ${buildingsPanelOpen ? 'active' : ''}`}
                    onClick={() => { setBuildingsPanelOpen(!buildingsPanelOpen); closeMobileMenu(); }}
                  >
                    <span className="guake-mobile-menu-icon"><Icon name="package" size={16} /></span>
                    {buildingsPanelOpen ? 'Hide Buildings' : 'Show Buildings'}
                  </button>
                )}
                <button
                  className={`guake-mobile-menu-item ${debugPanelOpen ? 'active' : ''}`}
                  onClick={() => { handleDebugToggle(); closeMobileMenu(); }}
                >
                  <span className="guake-mobile-menu-icon"><Icon name="bug" size={16} /></span>
                  {debugPanelOpen ? t('terminal:header.hideDebug') : t('terminal:header.showDebug')}
                </button>
                <button
                  className={`guake-mobile-menu-item ${mobileThemeExpanded ? 'active' : ''}`}
                  onClick={() => setMobileThemeExpanded(!mobileThemeExpanded)}
                >
                  <span className="guake-mobile-menu-icon"><Icon name="palette" size={16} /></span>
                  {t('terminal:themeSelector.selectTheme')}
                  <span className="guake-mobile-theme-arrow"><Icon name={mobileThemeExpanded ? 'caret-up' : 'caret-down'} size={11} /></span>
                </button>
                {mobileThemeExpanded && (
                  <div className="guake-mobile-theme-list">
                    {themes.map((theme) => (
                      <button
                        key={theme.id}
                        className={`guake-mobile-theme-option ${theme.id === currentTheme ? 'active' : ''}`}
                        onClick={() => handleMobileThemeSelect(theme.id)}
                      >
                        <span
                          className="guake-mobile-theme-preview"
                          style={{
                            background: `linear-gradient(135deg, ${theme.colors.bgPrimary} 0%, ${theme.colors.bgSecondary} 50%, ${theme.colors.accentPurple} 100%)`,
                          }}
                        />
                        <span className="guake-mobile-theme-name">{theme.name}</span>
                        {theme.id === currentTheme && <span className="guake-mobile-theme-check"><Icon name="check" size={14} /></span>}
                      </button>
                    ))}
                  </div>
                )}
                <div className="guake-mobile-menu-divider" />
                <button
                  className="guake-mobile-menu-item"
                  onClick={() => { setContextConfirm('collapse'); closeMobileMenu(); }}
                  disabled={selectedAgent.status !== 'idle'}
                >
                  <span className="guake-mobile-menu-icon"><Icon name="package" size={16} /></span>
                  {t('terminal:header.collapseContext')}
                </button>
                <button
                  className="guake-mobile-menu-item danger"
                  onClick={() => { setContextConfirm('clear'); closeMobileMenu(); }}
                >
                  <span className="guake-mobile-menu-icon"><Icon name="clear" size={16} /></span>
                  {t('terminal:header.clearContext')}
                </button>
                {hasSubordinates && (
                  <button
                    className="guake-mobile-menu-item danger"
                    onClick={() => { setContextConfirm('clear-subordinates'); closeMobileMenu(); }}
                  >
                    <span className="guake-mobile-menu-icon"><Icon name="crown" size={16} /><Icon name="trash" size={16} /></span>
                    {t('terminal:header.clearAllSubordinates')}
                  </button>
                )}
                <div className="guake-mobile-menu-divider" />
                <button
                  className="guake-mobile-menu-item danger"
                  onClick={() => { handleRemoveAgent(); closeMobileMenu(); }}
                >
                  <span className="guake-mobile-menu-icon"><Icon name="cross" size={16} /></span>
                  {t('terminal:header.removeAgent')}
                </button>
              </div>
            )}
          </div>
        {/* Mobile close button - switch to 3D view */}
        <button
          className="guake-close-btn show-on-mobile"
          onClick={() => store.setMobileView('3d')}
          title={t('terminal:header.closeTerminal')}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
});

// Search bar component - WhatsApp-style in-thread search navigator
export interface SearchBarProps {
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  closeSearch: () => void;
  matchCount: number;
  currentMatch: number;
  navigateNext: () => void;
  navigatePrev: () => void;
  loadingFullHistory?: boolean;
}

export function SearchBar({
  searchInputRef,
  searchQuery,
  setSearchQuery,
  closeSearch,
  matchCount,
  currentMatch,
  navigateNext,
  navigatePrev,
  loadingFullHistory,
}: SearchBarProps) {
  const { t } = useTranslation(['terminal', 'common']);
  return (
    <div className="guake-search">
      <input
        ref={searchInputRef}
        type="text"
        placeholder={t('terminal:header.searchPlaceholder')}
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            closeSearch();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) {
              navigatePrev();
            } else {
              navigateNext();
            }
          }
        }}
      />
      {searchQuery.trim().length >= 2 && (
        <span className="guake-search-count">
          {loadingFullHistory
            ? `${matchCount > 0 ? `${currentMatch + 1} / ${matchCount}` : '...'} loading`
            : matchCount > 0
              ? `${currentMatch + 1} / ${matchCount}`
              : t('terminal:header.searchNoResults', 'No results')}
        </span>
      )}
      <button
        className="guake-search-nav"
        onClick={navigatePrev}
        disabled={matchCount === 0}
        title="Previous match (Shift+Enter)"
      >
        <Icon name="caret-up" size={14} />
      </button>
      <button
        className="guake-search-nav"
        onClick={navigateNext}
        disabled={matchCount === 0}
        title="Next match (Enter)"
      >
        <Icon name="caret-down" size={14} />
      </button>
      <button
        className="guake-search-close"
        onClick={closeSearch}
        title="Close search (Escape)"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
