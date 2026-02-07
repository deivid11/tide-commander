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

import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
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
  useExecTasks,
  useFileViewerPath,
  useContextModalAgentId,
  useCurrentSnapshot,
  useOverviewPanelOpen,
} from '../../store';
import {
  STORAGE_KEYS,
  getStorageString,
} from '../../utils/storage';

// Import types
import type { ViewMode, EnrichedHistoryMessage } from './types';

// Import extracted hooks
import { useKeyboardHeight } from './useKeyboardHeight';
import { useTerminalResize } from './useTerminalResize';
import { useSwipeNavigation } from './useSwipeNavigation';
import { useHistoryLoader } from './useHistoryLoader';
import { useSearchHistory } from './useSearchHistory';
import { useTerminalInput } from './useTerminalInput';
import { useMessageNavigation } from './useMessageNavigation';
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
import { VirtualizedOutputList } from './VirtualizedOutputList';
import { GuakeAgentLink as _GuakeAgentLink } from './GuakeAgentLink';
import { AgentDebugPanel } from './AgentDebugPanel';
import { AgentOverviewPanel } from './AgentOverviewPanel';
import { agentDebugger } from '../../services/agentDebugger';
import { AgentProgressIndicator } from './AgentProgressIndicator';
import { ExecTasksContainer } from './ExecTaskIndicator';
import { ThemeSelector } from './ThemeSelector';
import { Tooltip } from '../shared/Tooltip';
import type { Agent } from '../../../shared/types';

export interface ClaudeOutputPanelProps {
  /** Callback when user clicks star button to save snapshot */
  onSaveSnapshot?: () => void;
}

export function ClaudeOutputPanel({ onSaveSnapshot }: ClaudeOutputPanelProps = {}) {
  // Store selectors
  const agents = useAgents();
  const selectedAgentIds = useSelectedAgentIds();
  const terminalOpen = useTerminalOpen();
  const lastPrompts = useLastPrompts();
  const reconnectCount = useReconnectCount();
  const mobileView = useMobileView();
  const fileViewerPath = useFileViewerPath();
  const contextModalAgentId = useContextModalAgentId();

  // Get current snapshot from store
  const currentSnapshot = useCurrentSnapshot();
  const isSnapshotView = !!currentSnapshot;

  // Snapshots should be viewable even when no agent is selected/running.
  const snapshotAgent = useMemo<Agent | null>(() => {
    if (!currentSnapshot) return null;
      return {
        id: currentSnapshot.agentId,
        name: currentSnapshot.agentName,
        class: currentSnapshot.agentClass as Agent['class'],
        status: 'idle',
        provider: 'claude',
      position: { x: 0, y: 0, z: 0 },
      cwd: currentSnapshot.cwd,
      permissionMode: 'interactive',
      tokensUsed: 0,
      contextUsed: 0,
      contextLimit: 200000,
      taskCount: 0,
      createdAt: currentSnapshot.createdAt,
      lastActivity: currentSnapshot.createdAt,
    };
  }, [currentSnapshot]);

  // Get selected agent
  const selectedAgentIdsArray = Array.from(selectedAgentIds);
  const isSingleSelection = selectedAgentIdsArray.length === 1;
  const selectedAgentId = isSingleSelection ? selectedAgentIdsArray[0] : null;
  const selectedAgent = useAgent(selectedAgentId) || null;

  const activeAgent = selectedAgent ?? (isSnapshotView ? snapshotAgent : null);
  const activeAgentId = selectedAgentId ?? (isSnapshotView ? currentSnapshot?.agentId ?? null : null);
  const hasSessionId = !!activeAgent?.sessionId && !isSnapshotView;

  // Use extracted hooks
  const { terminalHeight, terminalRef, handleResizeStart } = useTerminalResize();
  const keyboard = useKeyboardHeight();
  const outputs = useAgentOutputs(activeAgentId);

  // Use snapshot outputs if viewing a snapshot, otherwise use agent outputs
  const displayOutputs = isSnapshotView && currentSnapshot
    ? currentSnapshot.outputs.map((output: any) => {
        // Log for debugging empty messages
        if (!output.text || !output.text.trim()) {
          console.warn('[ClaudeOutputPanel] Empty snapshot output:', output);
        }
        return {
          text: output.text || '',
          timestamp: output.timestamp,
          isStreaming: false,
          isUserPrompt: false,
        };
      })
    : outputs;

  // Shared ref for output scroll container (used by history loader and swipe)
  const outputScrollRef = useRef<HTMLDivElement>(null);

  // Refs for terminal input elements (shared with message navigation for focus-on-type)
  const terminalInputRef = useRef<HTMLInputElement>(null);
  const terminalTextareaRef = useRef<HTMLTextAreaElement>(null);

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
  const [contextConfirm, setContextConfirm] = useState<'collapse' | 'clear' | 'clear-subordinates' | null>(null);
  const [responseModalContent, setResponseModalContent] = useState<string | null>(null);

  // Debug panel state
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [debuggerEnabled, setDebuggerEnabled] = useState(() => agentDebugger.isEnabled());

  // Agent overview panel state (persisted in store across agent switches)
  const overviewPanelOpen = useOverviewPanelOpen();
  const setOverviewPanelOpen = useCallback((open: boolean) => store.setOverviewPanelOpen(open), []);

  // Completion indicator state
  const [showCompletion, setShowCompletion] = useState(false);
  const prevStatusRef = useRef<string | null>(null);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // History fade-in state
  const [historyFadeIn, setHistoryFadeIn] = useState(false);
  const [pinToBottom, setPinToBottom] = useState(false);

  // Use store's terminal state
  const isOpen = terminalOpen && activeAgent !== null;

  // History loader hook
  const historyLoader = useHistoryLoader({
    selectedAgentId: activeAgentId,
    hasSessionId,
    reconnectCount,
    lastPrompts,
    outputScrollRef,
  });

  // Search hook
  const search = useSearchHistory({
    selectedAgentId: activeAgentId,
    isOpen,
  });

  // Swipe navigation hook
  const swipe = useSwipeNavigation({
    agents,
    selectedAgentId: activeAgentId,
    isOpen,
    // Use in-flight flag so swipe-in animation waits even when the UI loading flag is delayed
    loadingHistory: historyLoader.fetchingHistory,
    hasModalOpen: !!(imageModal || bashModal || responseModalContent || fileViewerPath || contextModalAgentId),
    outputRef: outputScrollRef,
  });

  // Terminal input hook
  const terminalInput = useTerminalInput({ selectedAgentId });

  // Get pending permission requests
  const pendingPermissions = !isSnapshotView && activeAgentId
    ? store.getPendingPermissionsForAgent(activeAgentId)
    : [];

  // Check if selected agent is a boss
  const isBoss = activeAgent?.class === 'boss' || activeAgent?.isBoss;
  const agentTaskProgress = useAgentTaskProgress(!isSnapshotView && isBoss ? activeAgentId : null);

  // Get exec tasks for the selected agent
  const execTasks = useExecTasks(!isSnapshotView ? activeAgentId : null);

  // Auto-enable debugger when panel opens
  useEffect(() => {
    if (debugPanelOpen && !debuggerEnabled) {
      setDebuggerEnabled(true);
      agentDebugger.setEnabled(true);
    }
  }, [debugPanelOpen, debuggerEnabled]);

  // Detect completion state
  useEffect(() => {
    const currentStatus = activeAgent?.status;
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
  }, [activeAgent?.status]);

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
  const filteredOutputs = useFilteredOutputsWithLogging({ outputs: displayOutputs, viewMode });

  // Total navigable messages count (history + live outputs)
  const totalNavigableMessages = filteredHistory.length + filteredOutputs.length;

  // Message navigation hook (Alt+J/K)
  const messageNav = useMessageNavigation({
    totalMessages: totalNavigableMessages,
    isOpen,
    hasModalOpen: !!(imageModal || bashModal || responseModalContent || fileViewerPath),
    scrollContainerRef: outputScrollRef,
    selectedAgentId: activeAgentId,
    inputRef: terminalInputRef,
    textareaRef: terminalTextareaRef,
    useTextarea: terminalInput.useTextarea,
  });

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

  const resolveFilePath = useCallback((filePath: string): string => {
    if (!filePath) return filePath;
    if (filePath.startsWith('/')) return filePath;

    const cwd = activeAgent?.cwd;
    if (!cwd || !cwd.startsWith('/')) return filePath;

    const rel = filePath.replace(/^\.\//, '');
    const cwdParts = cwd.split('/').filter(Boolean);
    const relParts = rel.split('/').filter(Boolean);
    const stack = [...cwdParts];

    for (const part of relParts) {
      if (part === '.') continue;
      if (part === '..') {
        if (stack.length > 0) stack.pop();
        continue;
      }
      stack.push(part);
    }

    return `/${stack.join('/')}`;
  }, [activeAgent?.cwd]);

  const handleFileClick = useCallback((path: string, editData?: { oldString?: string; newString?: string; highlightRange?: { offset: number; limit: number } }) => {
    store.setFileViewerPath(resolveFilePath(path), editData);
  }, [resolveFilePath]);

  const handleBashClick = useCallback((command: string, output: string) => {
    const isLive = output === 'Running...';
    setBashModal({ command, output, isLive });
  }, []);

  const handleViewMarkdown = useCallback((content: string) => {
    setResponseModalContent(content);
  }, []);

  // Scroll handling - track if user scrolled up to disable auto-scroll
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const isUserScrolledUpRef = useRef(false);
  // Grace period after agent switch - don't detect user scroll during this time
  const agentSwitchGraceRef = useRef(false);

  const handleUserScrollUp = useCallback(() => {
    // Don't disable auto-scroll during grace period after agent switch
    if (agentSwitchGraceRef.current) return;
    isUserScrolledUpRef.current = true;
    setShouldAutoScroll(false);
  }, []);

  // Reset auto-scroll when agent changes (NOT on new outputs - that would override user scroll-up)
  useEffect(() => {
    setShouldAutoScroll(true);
    isUserScrolledUpRef.current = false;
    // Start grace period - for 3 seconds after agent change, don't detect user scroll
    agentSwitchGraceRef.current = true;
    const timeout = setTimeout(() => {
      agentSwitchGraceRef.current = false;
    }, 3000);
    return () => clearTimeout(timeout);
  }, [activeAgentId]);

  const handleScroll = useCallback(() => {
    if (!outputScrollRef.current) return;
    if (keyboard.keyboardScrollLockRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = outputScrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;

    // Only track user scroll state outside of grace period
    if (!agentSwitchGraceRef.current) {
      isUserScrolledUpRef.current = !isAtBottom;

      if (isAtBottom) {
        setShouldAutoScroll(true);
      }
    }

    historyLoader.handleScroll(keyboard.keyboardScrollLockRef);
  }, [outputScrollRef, keyboard.keyboardScrollLockRef, historyLoader]);

  // Auto-scroll on new output (only if user hasn't scrolled up)
  const lastOutputLength = outputs.length > 0 ? outputs[outputs.length - 1]?.text?.length || 0 : 0;
  useEffect(() => {
    if (keyboard.keyboardScrollLockRef.current) return;
    if (isUserScrolledUpRef.current) return;
    requestAnimationFrame(() => {
      if (outputScrollRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = outputScrollRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;
        if (isAtBottom) {
          outputScrollRef.current.scrollTop = scrollHeight;
        }
      }
    });
  }, [outputs.length, lastOutputLength, keyboard.keyboardScrollLockRef, outputScrollRef]);

  // Hide content immediately when agent changes (useLayoutEffect to avoid flicker)
  // Also clear snapshot view when switching agents
  const prevSelectedAgentIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    setHistoryFadeIn(false);
    const prev = prevSelectedAgentIdRef.current;
    const changed = prev !== selectedAgentId;
    prevSelectedAgentIdRef.current = selectedAgentId;
    if (changed && store.getState().currentSnapshot) {
      store.setCurrentSnapshot(null);
    }
  }, [selectedAgentId]);

  // Track when we need to scroll and fade in (to avoid stale closure issues)
  const pendingFadeInRef = useRef(false);

  // Mark pending fade-in when agent changes
  useEffect(() => {
    pendingFadeInRef.current = true;
    setPinToBottom(true);
  }, [activeAgentId, reconnectCount]);

  // If history fetching starts after agent selection (e.g., session establishment),
  // ensure we still perform the post-load scroll.
  useEffect(() => {
    if (historyLoader.fetchingHistory) {
      pendingFadeInRef.current = true;
      setPinToBottom(true);
    }
  }, [historyLoader.fetchingHistory]);

  // Release pinning once the scroll container stabilizes at the bottom after a load.
  useEffect(() => {
    if (!pinToBottom) return;
    if (!isOpen) return;
    if (historyLoader.fetchingHistory) return;

    const container = outputScrollRef.current;
    if (!container) return;

    let rafId: number | null = null;
    const start = performance.now();
    let stableFrames = 0;
    let lastScrollHeight = -1;

    const isAtBottom = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      return scrollHeight - scrollTop - clientHeight <= 2;
    };

    const tick = () => {
      const now = performance.now();
      const currentScrollHeight = container.scrollHeight;
      const heightStable = Math.abs(currentScrollHeight - lastScrollHeight) <= 1;
      const atBottom = isAtBottom();

      if (heightStable && atBottom) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }

      lastScrollHeight = currentScrollHeight;

      // If we've been stable at the bottom for a few frames, stop pinning.
      if (stableFrames >= 8) {
        setPinToBottom(false);
        rafId = null;
        return;
      }

      // Hard cap so we don't pin forever on pathological content.
      if (now - start > 8000) {
        setPinToBottom(false);
        rafId = null;
        return;
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [pinToBottom, isOpen, historyLoader.fetchingHistory, historyLoader.historyLoadVersion]);

  // After content loads: scroll first, then fade in
  useEffect(() => {
    // Wait until open
    if (!isOpen) return;

    // Check if we have a pending fade-in
    if (!pendingFadeInRef.current) {
      return;
    }

    // Use timeout + RAF to ensure content is fully rendered before fade-in
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(() => {
        // Mark as no longer pending and trigger fade-in
        pendingFadeInRef.current = false;
        setHistoryFadeIn(true);
      });
    }, 50);
    return () => clearTimeout(timeoutId);
  }, [historyLoader.historyLoadVersion, isOpen, outputScrollRef]);

  // Keyboard shortcut to toggle terminal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`' && !e.ctrlKey && !e.altKey && activeAgent) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
          e.preventDefault();
          store.toggleTerminal();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeAgent]);

  // Escape key handler for modals and search (higher priority than message navigation)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Handle modals first - stop propagation to prevent message nav from also handling
        // Priority: store-controlled modals first (FileViewer, ContextModal), then local state modals
        if (fileViewerPath) {
          e.stopPropagation();
          store.clearFileViewerPath();
        } else if (contextModalAgentId) {
          e.stopPropagation();
          store.closeContextModal();
        } else if (responseModalContent) {
          e.stopPropagation();
          setResponseModalContent(null);
        } else if (bashModal) {
          e.stopPropagation();
          setBashModal(null);
        } else if (imageModal) {
          e.stopPropagation();
          setImageModal(null);
        } else if (search.searchMode) {
          e.stopPropagation();
          search.closeSearch();
        }
      }
    };
    // Use capture phase to handle before message navigation
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [imageModal, bashModal, responseModalContent, search, fileViewerPath, contextModalAgentId]);

  // Refs to track state in event handlers
  const isOpenRef = useRef(isOpen);
  const isMouseDownOutsideRef = useRef(false);

  // Keep isOpenRef in sync with isOpen
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // Close terminal when clicking outside
  // Use refs to avoid closure issues with event listeners
  useEffect(() => {
    const isMobile = window.innerWidth <= 768;
    if (isMobile) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Only track if terminal is currently open
      if (!isOpenRef.current) {
        isMouseDownOutsideRef.current = false;
        return;
      }

      const target = e.target as HTMLElement;
      const isInTerminal = terminalRef.current?.contains(target);
      const isAgentBar = target.closest('.agent-bar');

      isMouseDownOutsideRef.current = !isInTerminal && !isAgentBar;
    };

    const handleMouseUp = (e: MouseEvent) => {
      // Only close if mousedown was outside (and terminal was open at that time)
      if (!isMouseDownOutsideRef.current) {
        return;
      }

      const target = e.target as HTMLElement;
      const isInTerminal = terminalRef.current?.contains(target);
      const isAgentBar = target.closest('.agent-bar');

      if (!isInTerminal && !isAgentBar) {
        store.setTerminalOpen(false);
      }
      isMouseDownOutsideRef.current = false;
    };

    // Attach listeners once and keep them attached throughout component lifetime
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('mouseup', handleMouseUp, true);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
      document.removeEventListener('mouseup', handleMouseUp, true);
    };
  }, []);

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

  if (!activeAgent) {
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

  // At this point activeAgent exists, so activeAgentId must exist too
  if (!activeAgentId) return null;

  return (
    <div
      ref={terminalRef}
      className={`guake-terminal ${isOpen ? 'open' : 'collapsed'} ${debugPanelOpen && isOpen ? 'with-debug-panel' : ''} ${overviewPanelOpen && isOpen ? 'with-overview-panel' : ''}`}
      style={{ '--terminal-height': `${terminalHeight}%` } as React.CSSProperties}
    >
      {/* Debug Panel */}
      {!isSnapshotView && debugPanelOpen && isOpen && activeAgentId && (
        <AgentDebugPanel agentId={activeAgentId} onClose={() => setDebugPanelOpen(false)} />
      )}

      {/* Agent Overview Panel */}
      {!isSnapshotView && overviewPanelOpen && isOpen && activeAgentId && (
        <AgentOverviewPanel
          activeAgentId={activeAgentId}
          onClose={() => setOverviewPanelOpen(false)}
          onSelectAgent={(agentId) => {
            store.selectAgent(agentId);
          }}
        />
      )}

      <div className="guake-content">
        <TerminalHeader
          selectedAgent={activeAgent}
          selectedAgentId={activeAgentId}
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
          overviewPanelOpen={overviewPanelOpen}
          setOverviewPanelOpen={setOverviewPanelOpen}
          outputsLength={displayOutputs.length + filteredHistory.length}
          setContextConfirm={setContextConfirm}
          headerRef={swipe.headerRef}
          onSaveSnapshot={isSnapshotView ? undefined : onSaveSnapshot}
          isSnapshotView={isSnapshotView}
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

          <div className="guake-output" ref={outputScrollRef} onScroll={handleScroll}>
            {search.searchMode && search.searchResults.length > 0 ? (
              <>
                <div className="guake-search-header">Search Results:</div>
                {search.searchResults.map((msg, index) => (
                  <HistoryLine
                    key={`s-${index}`}
                    message={msg as EnrichedHistoryMessage}
                    agentId={activeAgentId}
                    highlight={search.searchQuery}
                    onImageClick={handleImageClick}
                    onFileClick={handleFileClick}
                    onBashClick={handleBashClick}
                    onViewMarkdown={handleViewMarkdown}
                  />
                ))}
              </>
            ) : (
              <div className={`guake-history-content ${historyFadeIn ? 'fade-in' : ''}`}>
                {historyLoader.loadingHistory && historyLoader.history.length === 0 && outputs.length === 0 && (
                  <div className="guake-empty loading">Loading conversation<span className="loading-dots"><span></span><span></span><span></span></span></div>
                )}
                {!historyLoader.loadingHistory && historyLoader.history.length === 0 && displayOutputs.length === 0 && activeAgent.status !== 'working' && (
                  <div className="guake-empty">No output yet. Send a command to this agent.</div>
                )}
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
                {/* Virtualized rendering - only renders visible items + overscan buffer */}
                <VirtualizedOutputList
                  historyMessages={filteredHistory}
                  liveOutputs={filteredOutputs}
                  agentId={activeAgentId}
                  viewMode={viewMode}
                  selectedMessageIndex={messageNav.selectedIndex}
                  isMessageSelected={messageNav.isSelected}
                  onImageClick={handleImageClick}
                  onFileClick={handleFileClick}
                  onBashClick={handleBashClick}
                  onViewMarkdown={handleViewMarkdown}
                  scrollContainerRef={outputScrollRef}
                  onScrollTopReached={historyLoader.loadMoreHistory}
                  isLoadingMore={historyLoader.loadingMore}
                  hasMore={historyLoader.hasMore}
                  shouldAutoScroll={shouldAutoScroll}
                  onUserScroll={handleUserScrollUp}
                  pinToBottom={pinToBottom}
                  onPinCancel={() => setPinToBottom(false)}
                  // Use in-flight flag so the virtualized list can reliably detect load completion
                  // (the spinner flag is intentionally delayed and may never toggle true on fast loads).
                  isLoadingHistory={historyLoader.fetchingHistory}
                />
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
                {/* Exec tasks (streaming command output) */}
                {!isSnapshotView && execTasks.length > 0 && activeAgentId && (
                  <ExecTasksContainer
                    tasks={execTasks}
                    onClearCompleted={() => store.clearCompletedExecTasks(activeAgentId)}
                    onDismiss={(taskId) => {
                      // Remove completed task from the map
                      const task = store.getExecTask(taskId);
                      if (task && task.status !== 'running') {
                        store.clearCompletedExecTasks(activeAgentId);
                      }
                    }}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        <TerminalInputArea
          selectedAgent={activeAgent}
          selectedAgentId={activeAgentId}
          isOpen={isOpen}
          command={terminalInput.command}
          setCommand={terminalInput.setCommand}
          forceTextarea={terminalInput.forceTextarea}
          setForceTextarea={terminalInput.setForceTextarea}
          useTextarea={terminalInput.useTextarea}
          attachedFiles={terminalInput.attachedFiles}
          setAttachedFiles={terminalInput.setAttachedFiles}
          removeAttachedFile={terminalInput.removeAttachedFile}
          uploadFile={terminalInput.uploadFile}
          pastedTexts={terminalInput.pastedTexts}
          expandPastedTexts={terminalInput.expandPastedTexts}
          incrementPastedCount={terminalInput.incrementPastedCount}
          setPastedTexts={terminalInput.setPastedTexts}
          resetPastedCount={terminalInput.resetPastedCount}
          handleInputFocus={keyboard.handleInputFocus}
          handleInputBlur={keyboard.handleInputBlur}
          pendingPermissions={pendingPermissions}
          showCompletion={showCompletion}
          onImageClick={handleImageClick}
          inputRef={terminalInputRef}
          textareaRef={terminalTextareaRef}
          isSnapshotView={isSnapshotView}
        />

        {/* Agent Status Bar (CWD + Context) */}
        <div className="guake-agent-status-bar">
          {!isSnapshotView && activeAgent?.isDetached && (
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
              position="top"
              className="tide-tooltip--detached"
            >
              <span className="guake-detached-badge" title="Agent is detached - reattaching...">
                <span className="guake-detached-spinner">🔄</span> Reattaching...
              </span>
            </Tooltip>
          )}
          {activeAgent?.cwd && (
            <span className="guake-agent-cwd">
              📁 {activeAgent.cwd.split('/').filter(Boolean).slice(-2).join('/') || activeAgent.cwd}
            </span>
          )}
          {!isSnapshotView && activeAgent && (() => {
            // Use contextStats if available (from /context command), otherwise fallback to basic
            const stats = activeAgent.contextStats;
            const hasData = !!stats;
            const totalTokens = stats ? stats.totalTokens : (activeAgent.contextUsed || 0);
            const contextWindow = stats ? stats.contextWindow : (activeAgent.contextLimit || 200000);
            const usedPercent = stats ? stats.usedPercent : Math.round((totalTokens / contextWindow) * 100);
            const freePercent = Math.round(100 - usedPercent);
            const percentColor = usedPercent >= 80 ? '#ff4a4a' : usedPercent >= 60 ? '#ff9e4a' : usedPercent >= 40 ? '#ffd700' : '#4aff9e';
            const usedK = (totalTokens / 1000).toFixed(1);
            const limitK = (contextWindow / 1000).toFixed(1);
            return (
              <span
                className="guake-agent-context"
                onClick={() => store.setContextModalAgentId(activeAgentId)}
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
          <ThemeSelector />
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
        <span className="guake-handle-text">{activeAgent.name}</span>
      </div>

      {/* Modals */}
      {imageModal && <ImageModal url={imageModal.url} name={imageModal.name} onClose={() => setImageModal(null)} />}
      {bashModal && <BashModal state={bashModal} onClose={() => setBashModal(null)} />}
      {contextConfirm && (
        <ContextConfirmModal
          action={contextConfirm}
          selectedAgentId={activeAgentId}
          subordinateCount={activeAgent?.subordinateIds?.length || 0}
          onClose={() => setContextConfirm(null)}
          onClearHistory={historyLoader.clearHistory}
        />
      )}
      <ContextModalFromGuake />
      <FileViewerFromGuake />
      {!isSnapshotView && (
        <AgentResponseModalWrapper agent={activeAgent} content={responseModalContent} onClose={() => setResponseModalContent(null)} />
      )}
    </div>
  );
}

// Re-export types for convenience
export type { HistoryMessage, AttachedFile, ViewMode, EditData } from './types';
