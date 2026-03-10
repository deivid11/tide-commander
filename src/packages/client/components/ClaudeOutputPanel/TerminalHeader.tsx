/**
 * TerminalHeader - Header component for the terminal panel
 *
 * Displays agent info, status, actions buttons, and view mode toggle.
 */

import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { store, useSupervisor, useSettings, useLastPrompt, useSubagentsForAgent, useCustomAgentClass } from '../../store';
import { STORAGE_KEYS, setStorageString } from '../../utils/storage';
import { agentDebugger } from '../../services/agentDebugger';
import { Tooltip } from '../shared/Tooltip';
import { WorkingIndicator } from '../shared/WorkingIndicator';
import type { Agent, AgentAnalysis } from '../../../shared/types';
import { BUILT_IN_AGENT_CLASSES } from '../../../shared/types';
import type { ViewMode } from './types';
import { VIEW_MODES } from './types';
import { themes, getTheme, applyTheme, getSavedTheme, type ThemeId } from '../../utils/themes';

export interface TerminalHeaderProps {
  selectedAgent: Agent;
  selectedAgentId: string;
  sortedAgents: Agent[];
  swipeOffset: number;
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
  headerRef: React.RefObject<HTMLDivElement | null>;
  /** Whether we're viewing a snapshot (read-only mode) */
  isSnapshotView?: boolean;
  /** Callback when user clicks star button to save snapshot */
  onSaveSnapshot?: () => void;
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
}

export const TerminalHeader = memo(function TerminalHeader({
  selectedAgent,
  selectedAgentId,
  sortedAgents,
  swipeOffset,
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
  headerRef,
  isSnapshotView = false,
  onSaveSnapshot,
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
}: TerminalHeaderProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const supervisor = useSupervisor();
  const _settings = useSettings();
  const lastPrompt = useLastPrompt(selectedAgentId);

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

  const agentAnalysis = supervisor.lastReport?.agentSummaries.find(
    (a: AgentAnalysis) => a.agentId === selectedAgent.id || a.agentName === selectedAgent.name
  );

  const progressColors: Record<string, string> = {
    on_track: '#4aff9e',
    stalled: '#ff9e4a',
    blocked: '#ff4a4a',
    completed: '#4a9eff',
    idle: '#888',
  };

  // Check if selected agent is a boss with subordinates
  const isBoss = selectedAgent.class === 'boss' || selectedAgent.isBoss;
  const hasSubordinates = isBoss && selectedAgent.subordinateIds && selectedAgent.subordinateIds.length > 0;

  // Check for active subagents (Claude Code Task tool subprocesses)
  const subagents = useSubagentsForAgent(selectedAgentId);

  // Get agent class emoji
  const customClass = useCustomAgentClass(
    selectedAgent.class in BUILT_IN_AGENT_CLASSES ? null : selectedAgent.class
  );
  const agentEmoji = customClass?.icon
    || (BUILT_IN_AGENT_CLASSES as Record<string, { icon: string }>)[selectedAgent.class]?.icon
    || '🤖';

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
  const viewModeIcon = viewMode === 'simple' ? '○' : viewMode === 'chat' ? '◐' : '◉';

  const closeMobileMenu = useCallback(() => {
    setMobileMenuOpen(false);
    setMobileThemeExpanded(false);
  }, []);

  const handleMobileThemeSelect = (themeId: ThemeId) => {
    const theme = getTheme(themeId);
    applyTheme(theme);
    setCurrentTheme(themeId);
  };

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
      className={`guake-header ${sortedAgents.length > 1 ? 'has-multiple-agents' : ''} ${swipeOffset > 0.1 ? 'swiping-right' : ''} ${swipeOffset < -0.1 ? 'swiping-left' : ''}`}
      ref={headerRef}
    >
      <div className="guake-header-left">
        <div className="guake-header-title-row">
          {selectedAgent.status === 'working' && (
            <WorkingIndicator detached={selectedAgent.isDetached} />
          )}
          {selectedAgent.isDetached && (
            <Tooltip
              content={
                <>
                  <div className="tide-tooltip__title">🔄 Reattaching Session...</div>
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
                <span className="guake-detached-spinner">🔄</span>
              </span>
            </Tooltip>
          )}
          {onToggleAgentInfo ? (
            <button
              className={`guake-title-btn ${agentInfoOpen ? 'active' : ''}`}
              onClick={onToggleAgentInfo}
              title={t('terminal:header.showAgentInfo')}
            >
              <span className="guake-agent-avatar">{agentEmoji}</span>
              <span className="guake-title-block">
                <span className="guake-title-main-row">
                  <span className="guake-title">{selectedAgent.name}</span>
                  {selectedAgent.taskLabel && (
                    <span className="guake-title-task-chip">{selectedAgent.taskLabel}</span>
                  )}
                </span>
                {mobileHeaderContext && (
                  <span className="guake-mobile-title-context">{mobileHeaderContext}</span>
                )}
              </span>
              <span className="guake-title-accessory">
                <img
                  src={selectedAgent.provider === 'codex' ? `${import.meta.env.BASE_URL}assets/codex.png` : `${import.meta.env.BASE_URL}assets/claude.png`}
                  alt={selectedAgent.provider}
                  className="guake-provider-icon"
                  title={selectedAgent.provider === 'codex' ? 'Codex Agent' : 'Claude Agent'}
                />
                <span className="guake-title-info">Info</span>
              </span>
            </button>
          ) : (
            <div className="guake-title-with-provider">
              <span className="guake-agent-avatar">{agentEmoji}</span>
              <span className="guake-title-block">
                <span className="guake-title-main-row">
                  <span className="guake-title">{selectedAgent.name}</span>
                  {selectedAgent.taskLabel && (
                    <span className="guake-title-task-chip">{selectedAgent.taskLabel}</span>
                  )}
                </span>
                {mobileHeaderContext && (
                  <span className="guake-mobile-title-context">{mobileHeaderContext}</span>
                )}
              </span>
              <span className="guake-title-accessory">
                <img
                  src={selectedAgent.provider === 'codex' ? `${import.meta.env.BASE_URL}assets/codex.png` : `${import.meta.env.BASE_URL}assets/claude.png`}
                  alt={selectedAgent.provider}
                  className="guake-provider-icon"
                  title={selectedAgent.provider === 'codex' ? 'Codex Agent' : 'Claude Agent'}
                />
              </span>
            </div>
          )}
        </div>
        <div className="guake-header-meta">
          {(lastInput || agentAnalysis || selectedAgent.taskLabel) && (
            <span
              className="guake-status-line"
              title={`${selectedAgent.taskLabel ? `📋 ${selectedAgent.taskLabel}\n` : ''}${lastInput || 'No task'}${agentAnalysis ? `\n\n🎖️ ${agentAnalysis.statusDescription}\n${agentAnalysis.recentWorkSummary}` : ''}`}
            >
              {agentAnalysis && (
                <span
                  className="guake-supervisor-badge"
                  style={{ color: progressColors[agentAnalysis.progress] || '#888' }}
                >
                  {agentAnalysis.progress.replace('_', ' ')}
                </span>
              )}
              {lastInput && <span className="guake-last-input">{lastInput}</span>}
            </span>
          )}
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
        <div className="guake-action-cluster guake-action-cluster--compact hide-on-mobile">
          {!isSnapshotView && onSaveSnapshot && outputsLength > 0 && (
            <Tooltip
              content={
                <>
                  <div className="tide-tooltip__title">{t('terminal:header.saveSnapshot')}</div>
                  <div className="tide-tooltip__text">
                    {t('terminal:header.saveSnapshotDesc')}
                  </div>
                </>
              }
              position="bottom"
            >
              <button
                className="guake-icon-action guake-snapshot-btn"
                onClick={onSaveSnapshot}
                title={t('terminal:header.saveSnapshot')}
              >
                <span className="guake-action-icon">⭐</span>
              </button>
            </Tooltip>
          )}
          {!isSnapshotView && (
            <>
              <button
                className="guake-icon-action guake-nav-btn"
                onClick={onNavigateBack}
                title="Back (Alt+Left)"
                disabled={!canNavigateBack}
              >
                <span className="guake-action-icon">←</span>
              </button>
              <button
                className="guake-icon-action guake-nav-btn"
                onClick={onNavigateForward}
                title="Forward (Alt+Right)"
                disabled={!canNavigateForward}
              >
                <span className="guake-action-icon">→</span>
              </button>
            </>
          )}
          {!isSnapshotView && setOverviewPanelOpen && (
            <button
              className={`guake-icon-action guake-overview-toggle ${overviewPanelOpen ? 'active' : ''}`}
              onClick={() => setOverviewPanelOpen(!overviewPanelOpen)}
              title={overviewPanelOpen ? t('terminal:header.hideOverview') : t('terminal:header.showOverview')}
            >
              <span className="guake-action-icon">📊</span>
            </button>
          )}
          {!isSnapshotView && (
            <button
              className={`guake-icon-action guake-debug-toggle ${debugPanelOpen ? 'active' : ''}`}
              onClick={handleDebugToggle}
              title={debugPanelOpen ? t('terminal:header.hideDebug') : t('terminal:header.showDebug')}
            >
              <span className="guake-action-icon">🐛</span>
            </button>
          )}
          <button
            className={`guake-icon-action guake-fullscreen-toggle ${isFullscreen ? 'active' : ''}`}
            onClick={onToggleFullscreen}
            title={isFullscreen ? t('terminal:header.exitFullscreen') : t('terminal:header.enterFullscreen')}
          >
            <span className="guake-action-icon">{isFullscreen ? '🗗' : '⛶'}</span>
          </button>
          <button
            className={`guake-icon-action guake-search-toggle ${searchMode ? 'active' : ''}`}
            onClick={handleSearchToggle}
            title={t('terminal:header.search')}
          >
            <span className="guake-action-icon">🔍</span>
          </button>
        </div>
        <button
          className={`guake-view-toggle hide-on-mobile ${viewMode !== 'simple' ? 'active' : ''} view-mode-${viewMode}`}
          onClick={handleViewModeToggle}
          title={
            viewMode === 'simple'
              ? t('terminal:header.simpleViewDesc')
              : viewMode === 'chat'
                ? t('terminal:header.chatViewDesc')
                : t('terminal:header.advancedViewDesc')
          }
        >
          <span className="guake-view-toggle__icon">{viewModeIcon}</span>
          <span className="guake-view-toggle__label">{viewModeLabel}</span>
        </button>
        {!isSnapshotView && (
          <div className="guake-action-cluster guake-action-cluster--context hide-on-mobile">
            <Tooltip content={t('terminal:header.collapseContext')} position="bottom">
              <button
                className="guake-icon-action guake-context-btn"
                onClick={() => setContextConfirm('collapse')}
                title={t('terminal:header.collapseContextDesc')}
                aria-label={t('terminal:header.collapseContext')}
                disabled={selectedAgent.status !== 'idle'}
              >
                <span className="guake-action-icon">📦</span>
              </button>
            </Tooltip>
            <Tooltip content={t('terminal:header.clearContext')} position="bottom">
              <button
                className="guake-icon-action guake-context-btn danger"
                onClick={() => setContextConfirm('clear')}
                title={t('terminal:header.clearContextDesc')}
                aria-label={t('terminal:header.clearContext')}
              >
                <span className="guake-action-icon">🧹</span>
              </button>
            </Tooltip>
            <Tooltip content={t('terminal:header.removeAgent')} position="bottom">
              <button
                className="guake-icon-action guake-remove-agent-btn"
                onClick={handleRemoveAgent}
                title={t('terminal:header.removeAgentDesc')}
                aria-label={t('terminal:header.removeAgent')}
              >
                <span className="guake-action-icon">❌</span>
              </button>
            </Tooltip>
            {/* Boss-only: Clear all subordinates' context */}
            {hasSubordinates && (
              <Tooltip content={t('terminal:header.clearAllSubordinates')} position="bottom">
                <button
                  className="guake-icon-action guake-context-btn danger"
                  onClick={() => setContextConfirm('clear-subordinates')}
                  title={t('terminal:header.clearAllSubordinatesDesc')}
                  aria-label={t('terminal:header.clearAllSubordinates')}
                >
                  <span className="guake-action-icon">👑</span>
                </button>
              </Tooltip>
            )}
          </div>
        )}
        {/* Mobile more-actions menu */}
        {!isSnapshotView && (
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
                  <span className="guake-mobile-menu-icon">←</span>
                  Back
                </button>
                <button
                  className="guake-mobile-menu-item"
                  onClick={() => { onNavigateForward?.(); closeMobileMenu(); }}
                  disabled={!canNavigateForward}
                >
                  <span className="guake-mobile-menu-icon">→</span>
                  Forward
                </button>
                <button
                  className="guake-mobile-menu-item"
                  onClick={() => { handleViewModeToggle(); closeMobileMenu(); }}
                >
                  <span className="guake-mobile-menu-icon">
                    {viewMode === 'simple' ? '○' : viewMode === 'chat' ? '◐' : '◉'}
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
                    <span className="guake-mobile-menu-icon">🗑</span>
                    {t('terminal:header.clearOutput')}
                  </button>
                )}
                {onSaveSnapshot && outputsLength > 0 && (
                  <button
                    className="guake-mobile-menu-item"
                    onClick={() => { onSaveSnapshot(); closeMobileMenu(); }}
                  >
                    <span className="guake-mobile-menu-icon">⭐</span>
                    {t('terminal:header.saveSnapshot')}
                  </button>
                )}
                <button
                  className={`guake-mobile-menu-item ${isFullscreen ? 'active' : ''}`}
                  onClick={() => { onToggleFullscreen?.(); closeMobileMenu(); }}
                >
                  <span className="guake-mobile-menu-icon">{isFullscreen ? '🗗' : '⛶'}</span>
                  {isFullscreen ? t('terminal:header.exitFullscreen') : t('terminal:header.enterFullscreen')}
                </button>
                <button
                  className="guake-mobile-menu-item"
                  onClick={() => { handleSearchToggle(); closeMobileMenu(); }}
                >
                  <span className="guake-mobile-menu-icon">{searchMode ? '✕' : '🔍'}</span>
                  {t('terminal:header.search')}
                </button>
                {setOverviewPanelOpen && (
                  <button
                    className={`guake-mobile-menu-item ${overviewPanelOpen ? 'active' : ''}`}
                    onClick={() => { setOverviewPanelOpen(!overviewPanelOpen); closeMobileMenu(); }}
                  >
                    <span className="guake-mobile-menu-icon">📊</span>
                    {overviewPanelOpen ? t('terminal:header.hideOverview') : t('terminal:header.showOverview')}
                  </button>
                )}
                <button
                  className={`guake-mobile-menu-item ${debugPanelOpen ? 'active' : ''}`}
                  onClick={() => { handleDebugToggle(); closeMobileMenu(); }}
                >
                  <span className="guake-mobile-menu-icon">🐛</span>
                  {debugPanelOpen ? t('terminal:header.hideDebug') : t('terminal:header.showDebug')}
                </button>
                <button
                  className={`guake-mobile-menu-item ${mobileThemeExpanded ? 'active' : ''}`}
                  onClick={() => setMobileThemeExpanded(!mobileThemeExpanded)}
                >
                  <span className="guake-mobile-menu-icon">🎨</span>
                  {t('terminal:themeSelector.selectTheme')}
                  <span className="guake-mobile-theme-arrow">{mobileThemeExpanded ? '▲' : '▼'}</span>
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
                        {theme.id === currentTheme && <span className="guake-mobile-theme-check">✓</span>}
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
                  <span className="guake-mobile-menu-icon">📦</span>
                  {t('terminal:header.collapseContext')}
                </button>
                <button
                  className="guake-mobile-menu-item danger"
                  onClick={() => { setContextConfirm('clear'); closeMobileMenu(); }}
                >
                  <span className="guake-mobile-menu-icon">🧹</span>
                  {t('terminal:header.clearContext')}
                </button>
                {hasSubordinates && (
                  <button
                    className="guake-mobile-menu-item danger"
                    onClick={() => { setContextConfirm('clear-subordinates'); closeMobileMenu(); }}
                  >
                    <span className="guake-mobile-menu-icon">👑🗑️</span>
                    {t('terminal:header.clearAllSubordinates')}
                  </button>
                )}
                <div className="guake-mobile-menu-divider" />
                <button
                  className="guake-mobile-menu-item danger"
                  onClick={() => { handleRemoveAgent(); closeMobileMenu(); }}
                >
                  <span className="guake-mobile-menu-icon">❌</span>
                  {t('terminal:header.removeAgent')}
                </button>
              </div>
            )}
          </div>
        )}
        {/* Mobile close button - switch to 3D view */}
        <button
          className="guake-close-btn show-on-mobile"
          onClick={() => store.setMobileView('3d')}
          title={t('terminal:header.closeTerminal')}
        >
          ✕
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
        ▲
      </button>
      <button
        className="guake-search-nav"
        onClick={navigateNext}
        disabled={matchCount === 0}
        title="Next match (Enter)"
      >
        ▼
      </button>
      <button
        className="guake-search-close"
        onClick={closeSearch}
        title="Close search (Escape)"
      >
        ✕
      </button>
    </div>
  );
}
