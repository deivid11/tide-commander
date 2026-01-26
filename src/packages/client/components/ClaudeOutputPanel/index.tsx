/**
 * ClaudeOutputPanel - Main component
 *
 * A Guake-style terminal interface for interacting with Claude agents.
 * Features:
 * - Conversation history with pagination
 * - Live streaming output
 * - Search functionality
 * - View modes (simple, chat, advanced)
 * - Permission request handling
 * - File attachments and image paste
 * - Resizable terminal height
 * - Agent switcher bar
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  useAgents,
  useAgent,
  useSelectedAgentIds,
  useTerminalOpen,
  useLastPrompts,
  useAgentOutputs,
  useMobileView,
  store,
  useReconnectCount,
  useAgentTaskProgress,
} from '../../store';
import {
  STORAGE_KEYS,
  getStorageString,
  setStorageString,
} from '../../utils/storage';

// Import types
import type { ViewMode, EnrichedHistoryMessage } from './types';
import { VIEW_MODES } from './types';

// Import extracted hooks
import { useKeyboardHeight } from './useKeyboardHeight';
import { useTerminalResize } from './useTerminalResize';
import { useSwipeNavigation } from './useSwipeNavigation';
import { useHistoryLoader } from './useHistoryLoader';
import { useSearchHistory } from './useSearchHistory';
import { useTerminalInput } from './useTerminalInput';
import { useFilteredOutputsWithLogging } from '../shared/useFilteredOutputs';

// Import extracted components
import { TerminalHeader, SearchBar } from './TerminalHeader';
import { TerminalInputArea } from './TerminalInputArea';
import {
  ImageModal,
  BashModal,
  ContextConfirmModal,
  ContextModalFromGuake,
  FileViewerFromGuake,
  AgentResponseModalWrapper,
  type BashModalState,
} from './TerminalModals';
import { HistoryLine } from './HistoryLine';
import { OutputLine } from './OutputLine';
import { GuakeAgentLink } from './GuakeAgentLink';
import { AgentDebugPanel } from './AgentDebugPanel';
import { agentDebugger } from '../../services/agentDebugger';
import { AgentProgressIndicator } from './AgentProgressIndicator';

export function ClaudeOutputPanel() {
  // Store selectors
  const agents = useAgents();
  const selectedAgentIds = useSelectedAgentIds();
  const terminalOpen = useTerminalOpen();
  const lastPrompts = useLastPrompts();
  const reconnectCount = useReconnectCount();
  const mobileView = useMobileView();

  // Get selected agent
  const selectedAgentIdsArray = Array.from(selectedAgentIds);
  const isSingleSelection = selectedAgentIdsArray.length === 1;
  const selectedAgentId = isSingleSelection ? selectedAgentIdsArray[0] : null;
  const selectedAgent = useAgent(selectedAgentId) || null;
  const hasSessionId = !!selectedAgent?.sessionId;

  // Use extracted hooks
  const { terminalHeight, terminalRef, handleResizeStart } = useTerminalResize();
  const keyboard = useKeyboardHeight();
  const outputs = useAgentOutputs(selectedAgentId);

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = getStorageString(STORAGE_KEYS.VIEW_MODE);
    if (saved === 'simple' || saved === 'chat' || saved === 'advanced') {
      return saved;
    }
    const oldSaved = getStorageString(STORAGE_KEYS.ADVANCED_VIEW);
    if (oldSaved === 'true') return 'advanced';
    return 'simple';
  });

  // Modal states
  const [imageModal, setImageModal] = useState<{ url: string; name: string } | null>(null);
  const [bashModal, setBashModal] = useState<BashModalState | null>(null);
  const [contextConfirm, setContextConfirm] = useState<'collapse' | 'clear' | null>(null);
  const [responseModalContent, setResponseModalContent] = useState<string | null>(null);

  // Debug panel state
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [debuggerEnabled, setDebuggerEnabled] = useState(() => agentDebugger.isEnabled());

  // Completion indicator state
  const [showCompletion, setShowCompletion] = useState(false);
  const prevStatusRef = useRef<string | null>(null);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // History fade-in state
  const [historyFadeIn, setHistoryFadeIn] = useState(false);

  // Use store's terminal state
  const isOpen = terminalOpen && selectedAgent !== null;

  // History loader hook
  const historyLoader = useHistoryLoader({
    selectedAgentId,
    hasSessionId,
    reconnectCount,
    lastPrompts,
  });

  // Search hook
  const search = useSearchHistory({
    selectedAgentId,
    isOpen,
  });

  // Swipe navigation hook
  const swipe = useSwipeNavigation({
    agents,
    selectedAgentId,
    isOpen,
    loadingHistory: historyLoader.loadingHistory,
    hasModalOpen: !!(imageModal || bashModal || responseModalContent),
  });

  // Terminal input hook
  const terminalInput = useTerminalInput({ selectedAgentId });

  // Get pending permission requests
  const pendingPermissions = selectedAgentId ? store.getPendingPermissionsForAgent(selectedAgentId) : [];

  // Check if selected agent is a boss
  const isBoss = selectedAgent?.class === 'boss' || selectedAgent?.isBoss;
  const agentTaskProgress = useAgentTaskProgress(isBoss ? selectedAgentId : null);

  // Auto-enable debugger when panel opens
  useEffect(() => {
    if (debugPanelOpen && !debuggerEnabled) {
      setDebuggerEnabled(true);
      agentDebugger.setEnabled(true);
    }
  }, [debugPanelOpen, debuggerEnabled]);

  // Detect completion state
  useEffect(() => {
    const currentStatus = selectedAgent?.status;
    const prevStatus = prevStatusRef.current;

    if (prevStatus === 'working' && currentStatus === 'idle') {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
      setShowCompletion(true);
      completionTimerRef.current = setTimeout(() => {
        setShowCompletion(false);
        completionTimerRef.current = null;
      }, 1000);
    } else if (currentStatus === 'working') {
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
      }
      setShowCompletion(false);
    }

    prevStatusRef.current = currentStatus || null;

    return () => {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    };
  }, [selectedAgent?.status]);

  // Memoized filtered history
  const filteredHistory = useMemo((): EnrichedHistoryMessage[] => {
    const { history } = historyLoader;
    const toolResultMap = new Map<string, string>();
    for (const msg of history) {
      if (msg.type === 'tool_result' && msg.toolUseId) {
        toolResultMap.set(msg.toolUseId, msg.content);
      }
    }

    const enrichHistory = (messages: typeof history): EnrichedHistoryMessage[] => {
      return messages.map((msg) => {
        if (msg.type === 'tool_use' && msg.toolName === 'Bash' && msg.toolUseId) {
          const bashOutput = toolResultMap.get(msg.toolUseId);
          let bashCommand: string | undefined;
          try {
            const input = msg.toolInput || (msg.content ? JSON.parse(msg.content) : {});
            bashCommand = input.command;
          } catch { /* ignore */ }
          return { ...msg, _bashOutput: bashOutput, _bashCommand: bashCommand };
        }
        return msg as EnrichedHistoryMessage;
      });
    };

    if (viewMode === 'advanced') return enrichHistory(history);
    if (viewMode === 'chat') {
      return enrichHistory(history.filter((msg, index, arr) => {
        if (msg.type === 'user') return true;
        if (msg.type === 'assistant') {
          const nextMsg = arr[index + 1];
          return !nextMsg || nextMsg.type === 'user';
        }
        return false;
      }));
    }
    return enrichHistory(history.filter((msg) => msg.type === 'user' || msg.type === 'assistant' || msg.type === 'tool_use'));
  }, [historyLoader.history, viewMode]);

  // Filtered outputs
  const filteredOutputs = useFilteredOutputsWithLogging({ outputs, viewMode });

  // Auto-update bash modal when output arrives
  useEffect(() => {
    if (!bashModal?.isLive || !bashModal.command) return;
    for (const output of filteredOutputs) {
      if (output._bashCommand === bashModal.command && output._bashOutput) {
        setBashModal({ command: bashModal.command, output: output._bashOutput, isLive: false });
        return;
      }
    }
  }, [bashModal, filteredOutputs]);

  // Memoized callbacks
  const handleImageClick = useCallback((url: string, name: string) => {
    setImageModal({ url, name });
  }, []);

  const handleFileClick = useCallback((path: string, editData?: { oldString: string; newString: string }) => {
    store.setFileViewerPath(path, editData);
  }, []);

  const handleBashClick = useCallback((command: string, output: string) => {
    const isLive = output === 'Running...';
    setBashModal({ command, output, isLive });
  }, []);

  const handleViewMarkdown = useCallback((content: string) => {
    setResponseModalContent(content);
  }, []);

  // Scroll helpers
  const scrollToBottom = useCallback(() => {
    if (keyboard.keyboardScrollLockRef.current) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (swipe.outputRef.current) {
          swipe.outputRef.current.scrollTop = swipe.outputRef.current.scrollHeight;
        }
      });
    });
  }, [keyboard.keyboardScrollLockRef, swipe.outputRef]);

  // Scroll handling
  const isUserScrolledUpRef = useRef(false);
  const handleScroll = useCallback(() => {
    if (!swipe.outputRef.current) return;
    if (keyboard.keyboardScrollLockRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = swipe.outputRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;
    isUserScrolledUpRef.current = !isAtBottom;

    historyLoader.handleScroll(keyboard.keyboardScrollLockRef);
  }, [swipe.outputRef, keyboard.keyboardScrollLockRef, historyLoader]);

  // Auto-scroll on new output
  const lastOutputLength = outputs.length > 0 ? outputs[outputs.length - 1]?.text?.length || 0 : 0;
  useEffect(() => {
    if (keyboard.keyboardScrollLockRef.current) return;
    requestAnimationFrame(() => {
      if (swipe.outputRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = swipe.outputRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;
        if (isAtBottom) {
          swipe.outputRef.current.scrollTop = scrollHeight;
        }
      }
    });
  }, [outputs.length, lastOutputLength, keyboard.keyboardScrollLockRef, swipe.outputRef]);

  // Scroll after history loads
  useEffect(() => {
    if (!isOpen || historyLoader.loadingHistory) return;
    setHistoryFadeIn(true);
    const timeoutId = setTimeout(scrollToBottom, 500);
    return () => clearTimeout(timeoutId);
  }, [selectedAgentId, historyLoader.loadingHistory, reconnectCount, isOpen, scrollToBottom]);

  // Keyboard shortcut to toggle terminal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' && !e.ctrlKey && !e.altKey && selectedAgent) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          store.toggleTerminal();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedAgent]);

  // Escape key handler for modals and search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (responseModalContent) setResponseModalContent(null);
        else if (bashModal) setBashModal(null);
        else if (imageModal) setImageModal(null);
        else if (search.searchMode) search.closeSearch();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [imageModal, bashModal, responseModalContent, search]);

  // Close terminal when clicking outside (desktop only)
  useEffect(() => {
    if (!isOpen) return;
    const isMobile = window.innerWidth <= 768;
    if (isMobile) return;

    let ignoreClicks = true;
    const timer = setTimeout(() => { ignoreClicks = false; }, 100);

    const handleClickOutside = (e: MouseEvent) => {
      if (ignoreClicks) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'CANVAS') return;
      if (terminalRef.current && !terminalRef.current.contains(target)) {
        store.setTerminalOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, terminalRef]);

  // Visibility change cleanup
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) keyboard.cleanup();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [keyboard]);

  // Mobile placeholder rendering
  const isMobileWidth = typeof window !== 'undefined' && window.innerWidth <= 768;

  if (!selectedAgent) {
    if (isMobileWidth && mobileView === 'terminal' && selectedAgentIds.size === 0) {
      return (
        <div ref={terminalRef} className="guake-terminal open" style={{ '--terminal-height': `${terminalHeight}%` } as React.CSSProperties}>
          <div className="guake-content">
            <div className="guake-output" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6272a4' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>👆</div>
                <div style={{ fontSize: '16px' }}>Tap an agent on the battlefield to view their terminal</div>
                <div style={{ fontSize: '14px', marginTop: '8px', opacity: 0.7 }}>Switch to 3D view using the menu button (☰)</div>
              </div>
            </div>
          </div>
        </div>
      );
    }
    if (isMobileWidth && mobileView === 'terminal' && selectedAgentIds.size > 0) {
      return (
        <div ref={terminalRef} className="guake-terminal open" style={{ '--terminal-height': `${terminalHeight}%` } as React.CSSProperties}>
          <div className="guake-content">
            <div className="guake-output" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6272a4' }}>
              <div className="guake-empty loading">Loading terminal<span className="loading-dots"><span></span><span></span><span></span></span></div>
            </div>
          </div>
        </div>
      );
    }
    return null;
  }

  // At this point selectedAgent exists, so selectedAgentId must exist too
  if (!selectedAgentId) return null;

  return (
    <div
      ref={terminalRef}
      className={`guake-terminal ${isOpen ? 'open' : 'collapsed'} ${debugPanelOpen && isOpen ? 'with-debug-panel' : ''}`}
      style={{ '--terminal-height': `${terminalHeight}%` } as React.CSSProperties}
    >
      {/* Debug Panel */}
      {debugPanelOpen && isOpen && selectedAgentId && (
        <AgentDebugPanel agentId={selectedAgentId} onClose={() => setDebugPanelOpen(false)} />
      )}

      <div className="guake-content">
        <TerminalHeader
          selectedAgent={selectedAgent}
          selectedAgentId={selectedAgentId}
          sortedAgents={swipe.sortedAgents}
          swipeOffset={swipe.swipeOffset}
          viewMode={viewMode}
          setViewMode={setViewMode}
          searchMode={search.searchMode}
          toggleSearch={search.toggleSearch}
          closeSearch={search.closeSearch}
          debugPanelOpen={debugPanelOpen}
          setDebugPanelOpen={setDebugPanelOpen}
          debuggerEnabled={debuggerEnabled}
          setDebuggerEnabled={setDebuggerEnabled}
          outputsLength={outputs.length}
          setContextConfirm={setContextConfirm}
          headerRef={swipe.headerRef}
        />

        {/* Search bar */}
        {search.searchMode && (
          <SearchBar
            searchInputRef={search.searchInputRef}
            searchQuery={search.searchQuery}
            setSearchQuery={search.setSearchQuery}
            handleSearch={search.handleSearch}
            closeSearch={search.closeSearch}
            searchLoading={search.searchLoading}
            searchResultsCount={search.searchResults.length}
          />
        )}

        {/* Swipe container */}
        <div
          className={`guake-swipe-container ${swipe.swipeAnimationClass}`}
          style={swipe.swipeOffset !== 0 ? { transform: `translateX(${swipe.swipeOffset * 40}%)` } : undefined}
        >
          {/* Swipe indicators */}
          {swipe.sortedAgents.length > 1 && swipe.swipeOffset !== 0 && (
            <>
              <div className={`swipe-indicator left ${swipe.swipeOffset > 0.3 ? 'visible' : ''}`}>
                <span className="indicator-icon">←</span>
                <span className="indicator-name">{swipe.prevAgent?.name}</span>
              </div>
              <div className={`swipe-indicator right ${swipe.swipeOffset < -0.3 ? 'visible' : ''}`}>
                <span className="indicator-name">{swipe.nextAgent?.name}</span>
                <span className="indicator-icon">→</span>
              </div>
            </>
          )}

          {/* Swipe dots */}
          {swipe.sortedAgents.length > 1 && swipe.sortedAgents.length <= 8 && swipe.swipeOffset !== 0 && (
            <div className={`swipe-dots ${Math.abs(swipe.swipeOffset) > 0.1 ? 'visible' : ''}`}>
              {swipe.sortedAgents.map((agent, index) => (
                <div key={agent.id} className={`swipe-dot ${index === swipe.currentAgentIndex ? 'active' : ''}`} />
              ))}
            </div>
          )}

          <div className="guake-output" ref={swipe.outputRef} onScroll={handleScroll}>
            {search.searchMode && search.searchResults.length > 0 ? (
              <>
                <div className="guake-search-header">Search Results:</div>
                {search.searchResults.map((msg, index) => (
                  <HistoryLine
                    key={`s-${index}`}
                    message={msg as EnrichedHistoryMessage}
                    agentId={selectedAgentId}
                    highlight={search.searchQuery}
                    onImageClick={handleImageClick}
                    onFileClick={(path) => store.setFileViewerPath(path)}
                    onBashClick={handleBashClick}
                    onViewMarkdown={handleViewMarkdown}
                  />
                ))}
              </>
            ) : historyLoader.loadingHistory ? (
              <div className="guake-empty loading">Loading conversation<span className="loading-dots"><span></span><span></span><span></span></span></div>
            ) : historyLoader.history.length === 0 && outputs.length === 0 && selectedAgent.status !== 'working' ? (
              <div className="guake-empty">No output yet. Send a command to this agent.</div>
            ) : (
              <>
                {historyLoader.hasMore && !search.searchMode && (
                  <div className="guake-load-more">
                    {historyLoader.loadingMore ? (
                      <span>Loading older messages...</span>
                    ) : (
                      <button onClick={historyLoader.loadMoreHistory}>
                        Load more ({historyLoader.totalCount - historyLoader.history.length} older messages)
                      </button>
                    )}
                  </div>
                )}
                <div className={`guake-history-content ${historyFadeIn ? 'fade-in' : ''}`}>
                  {filteredHistory.map((msg, index) => (
                    <HistoryLine
                      key={`h-${index}`}
                      message={msg}
                      agentId={selectedAgentId}
                      simpleView={viewMode !== 'advanced'}
                      onImageClick={handleImageClick}
                      onFileClick={handleFileClick}
                      onBashClick={handleBashClick}
                      onViewMarkdown={handleViewMarkdown}
                    />
                  ))}
                </div>
                {filteredOutputs.map((output, index) => (
                  <OutputLine
                    key={`o-${index}`}
                    output={output}
                    agentId={selectedAgentId}
                    onImageClick={handleImageClick}
                    onFileClick={handleFileClick}
                    onBashClick={handleBashClick}
                    onViewMarkdown={handleViewMarkdown}
                  />
                ))}
                {/* Boss agent progress indicators */}
                {isBoss && agentTaskProgress.size > 0 && (
                  <div className="agent-progress-container">
                    <div className="agent-progress-container-header">
                      <span className="progress-crown">👑</span>
                      <span>Subordinate Progress</span>
                      <span className="progress-count">({agentTaskProgress.size} active)</span>
                    </div>
                    {Array.from(agentTaskProgress.values()).map((progress) => (
                      <AgentProgressIndicator
                        key={progress.agentId}
                        progress={progress}
                        defaultExpanded={progress.status === 'working'}
                        onAgentClick={(agentId) => store.selectAgent(agentId)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <TerminalInputArea
          selectedAgent={selectedAgent}
          selectedAgentId={selectedAgentId}
          command={terminalInput.command}
          setCommand={terminalInput.setCommand}
          forceTextarea={terminalInput.forceTextarea}
          setForceTextarea={terminalInput.setForceTextarea}
          useTextarea={terminalInput.useTextarea}
          attachedFiles={terminalInput.attachedFiles}
          setAttachedFiles={terminalInput.setAttachedFiles}
          removeAttachedFile={terminalInput.removeAttachedFile}
          uploadFile={terminalInput.uploadFile}
          expandPastedTexts={terminalInput.expandPastedTexts}
          incrementPastedCount={terminalInput.incrementPastedCount}
          setPastedTexts={terminalInput.setPastedTexts}
          resetPastedCount={terminalInput.resetPastedCount}
          handleInputFocus={keyboard.handleInputFocus}
          handleInputBlur={keyboard.handleInputBlur}
          pendingPermissions={pendingPermissions}
          showCompletion={showCompletion}
          onImageClick={handleImageClick}
        />

        {/* Agent Status Bar (CWD + Context) */}
        <div className="guake-agent-status-bar">
          {selectedAgent?.cwd && (
            <span className="guake-agent-cwd">
              📁 {selectedAgent.cwd.split('/').filter(Boolean).slice(-2).join('/') || selectedAgent.cwd}
            </span>
          )}
          {selectedAgent && (() => {
            // Use contextStats if available (from /context command), otherwise fallback to basic
            const stats = selectedAgent.contextStats;
            const hasData = !!stats;
            const totalTokens = stats ? stats.totalTokens : (selectedAgent.contextUsed || 0);
            const contextWindow = stats ? stats.contextWindow : (selectedAgent.contextLimit || 200000);
            const usedPercent = stats ? stats.usedPercent : Math.round((totalTokens / contextWindow) * 100);
            const freePercent = Math.round(100 - usedPercent);
            const percentColor = usedPercent >= 80 ? '#ff4a4a' : usedPercent >= 60 ? '#ff9e4a' : usedPercent >= 40 ? '#ffd700' : '#4aff9e';
            const usedK = (totalTokens / 1000).toFixed(1);
            const limitK = (contextWindow / 1000).toFixed(1);
            return (
              <span
                className="guake-agent-context"
                onClick={() => store.setContextModalAgentId(selectedAgentId)}
                title={hasData ? "Click to view detailed context stats" : "Click to fetch context stats"}
              >
                <span className="context-icon">📊</span>
                <span className="context-label">Context:</span>
                <span className="context-bar-mini">
                  <span
                    className="context-bar-mini-fill"
                    style={{
                      width: `${Math.min(100, usedPercent)}%`,
                      backgroundColor: percentColor,
                    }}
                  />
                </span>
                <span className="context-tokens" style={{ color: percentColor }}>
                  {usedK}k/{limitK}k
                </span>
                <span className="context-free">({freePercent}% free)</span>
                {!hasData && (
                  <span className="context-warning" title="Click to fetch accurate stats">⚠️</span>
                )}
              </span>
            );
          })()}
        </div>
      </div>

      {/* Resize handle */}
      {isOpen && <div className="guake-resize-handle" onMouseDown={handleResizeStart} title="Drag to resize" />}

      {/* Terminal handle */}
      <div
        className="guake-handle"
        onClick={() => { if (isOpen) store.toggleTerminal(); }}
        onDoubleClick={() => { if (!isOpen) store.toggleTerminal(); }}
        style={{ top: isOpen ? `${terminalHeight}%` : '0' }}
      >
        <span className="guake-handle-icon">{isOpen ? '▲' : '▼'}</span>
        <span className="guake-handle-text">{selectedAgent.name}</span>
      </div>

      {/* Modals */}
      {imageModal && <ImageModal url={imageModal.url} name={imageModal.name} onClose={() => setImageModal(null)} />}
      {bashModal && <BashModal state={bashModal} onClose={() => setBashModal(null)} />}
      {contextConfirm && (
        <ContextConfirmModal
          action={contextConfirm}
          selectedAgentId={selectedAgentId}
          onClose={() => setContextConfirm(null)}
          onClearHistory={historyLoader.clearHistory}
        />
      )}
      <ContextModalFromGuake />
      <FileViewerFromGuake />
      <AgentResponseModalWrapper agent={selectedAgent} content={responseModalContent} onClose={() => setResponseModalContent(null)} />
    </div>
  );
}

// Re-export types for convenience
export type { HistoryMessage, AttachedFile, ViewMode, EditData } from './types';
