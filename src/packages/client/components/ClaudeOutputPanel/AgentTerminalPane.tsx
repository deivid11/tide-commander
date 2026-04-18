/**
 * AgentTerminalPane - Self-contained terminal pane for a single agent.
 *
 * Encapsulates history loading, output rendering (VirtualizedOutputList),
 * input area (TerminalInputArea), search, scroll management, and all
 * per-agent state. Can be instantiated multiple times with different
 * agentId props for split terminal views.
 *
 * Extracted from GuakeOutputPanel to enable multi-pane layouts.
 */

import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  memo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  useLastPrompts,
  useAgentOutputs,
  useAgentCompacting,
  useReconnectCount,
  useHistoryRefreshTrigger,
  useExecTasks,
  useSubagentsMapForAgent,
  usePermissionRequests,
  type ClaudeOutput,
} from '../../store';
import type { Agent } from '../../../shared/types';
import type { AttachedFile } from '../shared/outputTypes';

// Types
import type { ViewMode, EnrichedHistoryMessage } from './types';

// Hooks
import { useHistoryLoader } from './useHistoryLoader';
import { useSearchHistory, type UseSearchHistoryReturn } from './useSearchHistory';
import { useTerminalInput } from './useTerminalInput';
import { useMessageNavigation } from './useMessageNavigation';
import { useFilteredOutputsWithLogging } from '../shared/useFilteredOutputs';
import { parseBossContext, parseInjectedInstructions } from './BossContext';

// Components
import { SearchBar } from './TerminalHeader';
import { TerminalInputArea } from './TerminalInputArea';
import { VirtualizedOutputList } from './VirtualizedOutputList';

// ─── Constants ──────────────────────────────────────────────────────────────

const LIVE_DUPLICATE_WINDOW_MS = 10_000;
const HISTORY_OUTPUT_DUPLICATE_WINDOW_MS = 30_000;
const HISTORY_ASSISTANT_OUTPUT_DUPLICATE_WINDOW_MS = 120_000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function normalizeUserMessage(text: string): string {
  const parsedBoss = parseBossContext(text);
  const parsedInjected = parseInjectedInstructions(parsedBoss.userMessage);
  return parsedInjected.userMessage.trim().replace(/\r\n/g, '\n');
}

function normalizeAssistantMessage(text: string): string {
  return text.trim().replace(/\r\n/g, '\n');
}

function isToolOrSystemOutput(text: string): boolean {
  return text.startsWith('Using tool:')
    || text.startsWith('Tool input:')
    || text.startsWith('Tool result:')
    || text.startsWith('Bash output:')
    || text.startsWith('Session started:')
    || text.startsWith('[thinking]')
    || text.startsWith('Tokens:')
    || text.startsWith('Cost:')
    || text.startsWith('Context (estimated from Codex turn usage):')
    || text.startsWith('🔄 [System]')
    || text.startsWith('📋 [System]')
    || text.startsWith('[System]');
}

// ─── Props & Handle ─────────────────────────────────────────────────────────

export interface AgentTerminalPaneProps {
  /** The agent ID this pane displays */
  agentId: string;
  /** The agent object (resolved by parent) */
  agent: Agent;
  /** View mode (simple/chat/advanced) */
  viewMode: ViewMode;
  /** Whether the terminal is open/visible */
  isOpen: boolean;

  // ── Modal callbacks (parent owns modals) ──
  onImageClick: (url: string, name: string) => void;
  onFileClick: (path: string, editData?: { oldString?: string; newString?: string; operation?: string; unifiedDiff?: string; highlightRange?: { offset: number; limit: number }; targetLine?: number }) => void;
  onBashClick: (command: string, output: string) => void;
  onViewMarkdown: (content: string) => void;

  // ── Keyboard height handler (parent owns, shared) ──
  keyboard: {
    handleInputFocus: () => void;
    handleInputBlur: () => void;
    keyboardScrollLockRef: React.MutableRefObject<boolean>;
    cleanup: () => void;
  };

  // ── Mobile swipe close (for TerminalInputArea) ──
  canSwipeClose?: boolean;
  onSwipeCloseOffsetChange?: (offset: number) => void;
  onSwipeClose?: () => void;

  /** Whether any modal is open in the parent (disables message navigation) */
  hasModalOpen?: boolean;
}

/**
 * Imperative handle exposed to parent for cross-component interactions
 * (swipe navigation, search-from-header, file drag-drop, etc.)
 */
export interface AgentTerminalPaneHandle {
  /** Scroll container ref — used by parent for swipe navigation */
  outputScrollRef: React.RefObject<HTMLDivElement | null>;
  /** Input refs — used by parent for focus management */
  inputRef: React.RefObject<HTMLInputElement | null>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** History loader — used by parent header for load-more button */
  historyLoader: {
    loadingHistory: boolean;
    fetchingHistory: boolean;
    historyLoadVersion: number;
    loadingMore: boolean;
    hasMore: boolean;
    totalCount: number;
    loadMoreHistory: () => Promise<void>;
    clearHistory: () => void;
    hasCachedHistory: (agentId: string) => boolean;
    history: Array<{ type: string; content: string; timestamp: string }>;
  };
  /** Search state — used by parent header for SearchBar */
  search: UseSearchHistoryReturn;
  /** Terminal input — used by parent for file drag-drop */
  terminalInput: {
    uploadFile: (file: File | Blob, filename?: string) => Promise<AttachedFile | null>;
    setAttachedFiles: (value: AttachedFile[] | ((prev: AttachedFile[]) => AttachedFile[])) => void;
    useTextarea: boolean;
  };
  /** Combined deduped data — used by parent for search all items */
  getDedupedHistory: () => EnrichedHistoryMessage[];
  getDedupedOutputs: () => ClaudeOutput[];
  /** Output count for header display */
  outputsLength: number;
}

// ─── Component ──────────────────────────────────────────────────────────────

export const AgentTerminalPane = memo(forwardRef<AgentTerminalPaneHandle, AgentTerminalPaneProps>(function AgentTerminalPane(
  {
    agentId,
    agent,
    viewMode,
    isOpen,
    onImageClick,
    onFileClick,
    onBashClick,
    onViewMarkdown,
    keyboard,
    canSwipeClose,
    onSwipeCloseOffsetChange,
    onSwipeClose,
    hasModalOpen,
  },
  ref,
) {
  const { t } = useTranslation(['terminal', 'common']);

  // ── Per-agent store subscriptions ──
  const reconnectCount = useReconnectCount();
  const historyRefreshTrigger = useHistoryRefreshTrigger();
  const lastPrompts = useLastPrompts();
  const outputs = useAgentOutputs(agentId);
  const isCompacting = useAgentCompacting(agentId);
  const hasSessionId = !!agent?.sessionId;

  // Exec tasks & subagents
  const execTasks = useExecTasks(agentId);
  const subagents = useSubagentsMapForAgent(agentId);

  // Pending permission requests
  const permissionRequests = usePermissionRequests();
  const pendingPermissions = useMemo(() => {
    if (!agentId) return [];
    return Array.from(permissionRequests.values()).filter(
      (r) => r.agentId === agentId && r.status === 'pending'
    );
  }, [agentId, permissionRequests]);

  // ── Refs ──
  const outputScrollRef = useRef<HTMLDivElement>(null);
  const terminalInputRef = useRef<HTMLInputElement>(null);
  const terminalTextareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Display outputs ──
  const displayOutputs = outputs;

  // ── History loader ──
  const historyLoader = useHistoryLoader({
    selectedAgentId: agentId,
    hasSessionId,
    reconnectCount,
    historyRefreshTrigger,
    lastPrompts,
    outputScrollRef,
  });

  // ── Terminal input ──
  const terminalInput = useTerminalInput({ selectedAgentId: agentId });

  // ── Filtered & deduped history ──
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

    return enrichHistory(history);
  }, [historyLoader.history]);

  const filteredOutputs = useFilteredOutputsWithLogging({ outputs: displayOutputs, viewMode });

  // Remove duplicate user prompts from history
  const dedupedHistory = useMemo((): EnrichedHistoryMessage[] => {
    const result: EnrichedHistoryMessage[] = [];
    const seenAssistantKeys = new Set<string>();
    const seenUserUuidKeys = new Set<string>();
    let lastUserKey: string | null = null;
    let lastUserTs = 0;

    for (const msg of filteredHistory) {
      if (msg.type === 'assistant') {
        const assistantKey = msg.uuid
          ? `uuid:${msg.uuid}:${normalizeAssistantMessage(msg.content)}`
          : `sig:${msg.timestamp}:${normalizeAssistantMessage(msg.content)}`;
        if (seenAssistantKeys.has(assistantKey)) {
          continue;
        }
        seenAssistantKeys.add(assistantKey);
        result.push(msg);
        continue;
      }

      if (msg.type !== 'user') {
        result.push(msg);
        continue;
      }

      const key = normalizeUserMessage(msg.content);
      const userUuidKey = msg.uuid ? `uuid:${msg.uuid}:${key}` : null;
      if (userUuidKey && seenUserUuidKeys.has(userUuidKey)) {
        continue;
      }
      const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
      if (lastUserKey === key && Math.abs(ts - lastUserTs) <= LIVE_DUPLICATE_WINDOW_MS) {
        continue;
      }

      result.push(msg);
      if (userUuidKey) {
        seenUserUuidKeys.add(userUuidKey);
      }
      lastUserKey = key;
      lastUserTs = ts;
    }

    return result;
  }, [filteredHistory]);

  // Remove live outputs that duplicate history
  const dedupedOutputs = useMemo(() => {
    const latestHistoryUserTsByKey = new Map<string, number>();
    const historyAssistantUuidSet = new Set<string>();
    const latestHistoryAssistantTsByKey = new Map<string, number>();
    for (const msg of dedupedHistory) {
      const ts = msg.timestamp ? new Date(msg.timestamp).getTime() : 0;
      if (msg.type === 'user') {
        const key = normalizeUserMessage(msg.content);
        const prev = latestHistoryUserTsByKey.get(key) ?? 0;
        if (ts > prev) latestHistoryUserTsByKey.set(key, ts);
        continue;
      }
      if (msg.type !== 'assistant') continue;
      if (msg.uuid) {
        historyAssistantUuidSet.add(msg.uuid);
      }
      const key = normalizeAssistantMessage(msg.content);
      const prev = latestHistoryAssistantTsByKey.get(key) ?? 0;
      if (ts > prev) latestHistoryAssistantTsByKey.set(key, ts);
    }

    const result: typeof filteredOutputs = [];
    let lastLiveUserKey: string | null = null;
    let lastLiveUserTs = 0;

    for (const output of filteredOutputs) {
      if (!output.isUserPrompt) {
        if (!output.isStreaming && !isToolOrSystemOutput(output.text)) {
          if (output.uuid && historyAssistantUuidSet.has(output.uuid)) {
            continue;
          }
          const key = normalizeAssistantMessage(output.text);
          const ts = output.timestamp || 0;
          const historyTs = latestHistoryAssistantTsByKey.get(key);
          if (historyTs && Math.abs(ts - historyTs) <= HISTORY_ASSISTANT_OUTPUT_DUPLICATE_WINDOW_MS) {
            continue;
          }
        }
        result.push(output);
        continue;
      }

      const key = normalizeUserMessage(output.text);
      const ts = output.timestamp || 0;
      const latestHistoryTs = latestHistoryUserTsByKey.get(key);

      if (latestHistoryTs && ts >= latestHistoryTs && ts - latestHistoryTs <= HISTORY_OUTPUT_DUPLICATE_WINDOW_MS) {
        continue;
      }

      if (lastLiveUserKey === key && Math.abs(ts - lastLiveUserTs) <= LIVE_DUPLICATE_WINDOW_MS) {
        continue;
      }

      result.push(output);
      lastLiveUserKey = key;
      lastLiveUserTs = ts;
    }

    return result;
  }, [filteredOutputs, dedupedHistory]);

  // ── Search ──
  const allSearchItems = useMemo(
    () => [...dedupedHistory, ...dedupedOutputs],
    [dedupedHistory, dedupedOutputs]
  );

  const search = useSearchHistory({
    selectedAgentId: agentId,
    isOpen,
    allItems: allSearchItems,
    viewMode,
    hasMoreHistory: historyLoader.hasMore,
    loadAllHistory: historyLoader.loadAllHistory,
    loadingMore: historyLoader.loadingMore,
  });

  // ── Message navigation ──
  const totalNavigableMessages = dedupedHistory.length + dedupedOutputs.length;
  const messageNav = useMessageNavigation({
    totalMessages: totalNavigableMessages,
    isOpen,
    hasModalOpen: hasModalOpen || search.searchMode,
    scrollContainerRef: outputScrollRef,
    selectedAgentId: agentId,
    inputRef: terminalInputRef,
    textareaRef: terminalTextareaRef,
    useTextarea: terminalInput.useTextarea,
  });

  // ── Completion indicator ──
  const [showCompletion, setShowCompletion] = useState(false);
  const [completionElapsed, setCompletionElapsed] = useState<number | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  const completionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const currentStatus = agent?.status;
    const prevStatus = prevStatusRef.current;

    if (prevStatus === 'working' && currentStatus === 'idle') {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
      const prompt = lastPrompts.get(agentId);
      setCompletionElapsed(prompt?.timestamp ? Date.now() - prompt.timestamp : null);
      setShowCompletion(true);
      completionTimerRef.current = setTimeout(() => {
        setShowCompletion(false);
        setCompletionElapsed(null);
        completionTimerRef.current = null;
      }, 4000);
    } else if (currentStatus === 'working') {
      if (completionTimerRef.current) {
        clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
      }
      setShowCompletion(false);
      setCompletionElapsed(null);
    }

    prevStatusRef.current = currentStatus || null;

    return () => {
      if (completionTimerRef.current) clearTimeout(completionTimerRef.current);
    };
  }, [agent?.status]);

  // ── Auto-update bash modal state from parent ──
  // (Bash modal is owned by parent; this effect was previously in GuakeOutputPanel.
  //  We expose dedupedOutputs via ref so parent can do this if needed.)

  // ── Scroll management ──
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const isUserScrolledUpRef = useRef(false);
  const pendingSelectionScrollRef = useRef(false);
  const agentSwitchGraceRef = useRef(false);

  const handleUserScrollUp = useCallback(() => {
    if (agentSwitchGraceRef.current) return;
    isUserScrolledUpRef.current = true;
    setShouldAutoScroll(false);
  }, []);

  const [pinToBottom, setPinToBottom] = useState(false);
  const handlePinCancel = useCallback(() => setPinToBottom(false), []);

  const handleSendCommand = useCallback(() => {
    isUserScrolledUpRef.current = false;
    setShouldAutoScroll(true);
  }, []);

  // Reset auto-scroll on agent change
  useEffect(() => {
    setShouldAutoScroll(true);
    isUserScrolledUpRef.current = false;
    pendingSelectionScrollRef.current = true;
    agentSwitchGraceRef.current = true;
    const timeout = setTimeout(() => {
      agentSwitchGraceRef.current = false;
    }, 3000);
    return () => clearTimeout(timeout);
  }, [agentId]);

  // Keep historyLoader.handleScroll in a ref so handleScroll callback stays stable
  const historyLoaderHandleScrollRef = useRef(historyLoader.handleScroll);
  historyLoaderHandleScrollRef.current = historyLoader.handleScroll;

  const handleScroll = useCallback(() => {
    if (!outputScrollRef.current) return;
    if (keyboard.keyboardScrollLockRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = outputScrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;

    if (!agentSwitchGraceRef.current) {
      isUserScrolledUpRef.current = !isAtBottom;
      if (isAtBottom) {
        setShouldAutoScroll(true);
      }
    }

    historyLoaderHandleScrollRef.current(keyboard.keyboardScrollLockRef);
  }, [outputScrollRef, keyboard.keyboardScrollLockRef]);

  // Auto-scroll on new output
  const lastOutputLength = outputs.length > 0 ? outputs[outputs.length - 1]?.text?.length || 0 : 0;
  useEffect(() => {
    if (keyboard.keyboardScrollLockRef.current) return;
    if (isUserScrolledUpRef.current) return;
    requestAnimationFrame(() => {
      if (outputScrollRef.current) {
        outputScrollRef.current.scrollTop = outputScrollRef.current.scrollHeight;
      }
    });
  }, [outputs.length, lastOutputLength, keyboard.keyboardScrollLockRef, outputScrollRef]);

  // ── History fade-in & agent switching ──
  const [historyFadeIn, setHistoryFadeIn] = useState(false);
  const [isAgentSwitching, setIsAgentSwitching] = useState(false);

  // Hide content immediately on agent change
  const prevSelectedAgentIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const prev = prevSelectedAgentIdRef.current;
    const changed = prev !== null && prev !== agentId;

    if (changed) {
      setHistoryFadeIn(false);
      const hasCached = historyLoader.hasCachedHistory(agentId);
      if (!hasCached) {
        setIsAgentSwitching(true);
      }
    } else if (!agentId) {
      setHistoryFadeIn(false);
    }

    prevSelectedAgentIdRef.current = agentId;
  }, [agentId]);

  // Resolve agent switching after history loads
  useEffect(() => {
    if (!isAgentSwitching) return;
    if (historyLoader.fetchingHistory) return;
    const raf = requestAnimationFrame(() => {
      if (outputScrollRef.current) {
        outputScrollRef.current.scrollTop = outputScrollRef.current.scrollHeight;
      }
      setIsAgentSwitching(false);
    });
    return () => cancelAnimationFrame(raf);
  }, [isAgentSwitching, historyLoader.fetchingHistory, historyLoader.historyLoadVersion]);

  // Scroll-to-bottom after agent change
  useEffect(() => {
    if (!pendingSelectionScrollRef.current) return;
    if (!agentId) return;
    if (isAgentSwitching) return;
    if (historyLoader.fetchingHistory) return;

    let rafId = 0;
    let rafId2 = 0;
    rafId = requestAnimationFrame(() => {
      rafId2 = requestAnimationFrame(() => {
        if (outputScrollRef.current) {
          outputScrollRef.current.scrollTop = outputScrollRef.current.scrollHeight;
        }
        pendingSelectionScrollRef.current = false;
      });
    });

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(rafId2);
    };
  }, [agentId, isAgentSwitching, historyLoader.fetchingHistory, historyLoader.historyLoadVersion]);

  // ── Pin to bottom (stabilization loop) ──
  const pendingFadeInRef = useRef(false);

  useEffect(() => {
    pendingFadeInRef.current = true;
    setPinToBottom(true);
  }, [agentId, reconnectCount]);

  useEffect(() => {
    if (historyLoader.fetchingHistory) {
      pendingFadeInRef.current = true;
      setPinToBottom(true);
    }
  }, [historyLoader.fetchingHistory]);

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

      if (stableFrames >= 3) {
        setPinToBottom(false);
        rafId = null;
        return;
      }

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

  // Fade in after scroll stabilization
  const prevPinToBottomRef = useRef(false);
  useEffect(() => {
    if (prevPinToBottomRef.current && !pinToBottom && pendingFadeInRef.current) {
      pendingFadeInRef.current = false;
      setHistoryFadeIn(true);
    }
    prevPinToBottomRef.current = pinToBottom;
  }, [pinToBottom]);

  // Fallback fade-in
  useEffect(() => {
    if (!isOpen) return;
    if (!pendingFadeInRef.current) return;
    if (pinToBottom) return;
    if (historyLoader.fetchingHistory) return;

    const rafId = requestAnimationFrame(() => {
      if (pendingFadeInRef.current) {
        pendingFadeInRef.current = false;
        setHistoryFadeIn(true);
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [historyLoader.historyLoadVersion, isOpen, pinToBottom, historyLoader.fetchingHistory]);

  // ── Escape key for search ──
  useEffect(() => {
    if (!search.searchMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        search.closeSearch();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [search.searchMode, search.closeSearch]);

  // ── Clean up keyboard styles on agent change ──
  useEffect(() => {
    return () => keyboard.cleanup();
  }, [agentId, keyboard]);

  // ── Imperative handle ──
  useImperativeHandle(ref, () => ({
    outputScrollRef,
    inputRef: terminalInputRef,
    textareaRef: terminalTextareaRef,
    historyLoader: {
      loadingHistory: historyLoader.loadingHistory,
      fetchingHistory: historyLoader.fetchingHistory,
      historyLoadVersion: historyLoader.historyLoadVersion,
      loadingMore: historyLoader.loadingMore,
      hasMore: historyLoader.hasMore,
      totalCount: historyLoader.totalCount,
      loadMoreHistory: historyLoader.loadMoreHistory,
      clearHistory: historyLoader.clearHistory,
      hasCachedHistory: historyLoader.hasCachedHistory,
      history: historyLoader.history,
    },
    search,
    terminalInput: {
      uploadFile: terminalInput.uploadFile,
      setAttachedFiles: terminalInput.setAttachedFiles,
      useTextarea: terminalInput.useTextarea,
    },
    getDedupedHistory: () => dedupedHistory,
    getDedupedOutputs: () => dedupedOutputs,
    outputsLength: dedupedHistory.length + dedupedOutputs.length,
  }), [
    historyLoader, search, terminalInput, dedupedHistory, dedupedOutputs,
  ]);

  // ── Render ──
  return (
    <>
      {/* Search bar (per-pane) */}
      {search.searchMode && (
        <SearchBar
          searchInputRef={search.searchInputRef}
          searchQuery={search.searchQuery}
          setSearchQuery={search.setSearchQuery}
          closeSearch={search.closeSearch}
          matchCount={search.matchIndices.length}
          currentMatch={search.currentMatch}
          navigateNext={search.navigateNext}
          navigatePrev={search.navigatePrev}
          loadingFullHistory={search.loadingFullHistory}
        />
      )}

      {/* Output area */}
      <div className="guake-output" ref={outputScrollRef} onScroll={handleScroll}>
        <div className={`guake-history-content ${historyFadeIn ? 'fade-in' : ''}`}>
          {isAgentSwitching && (
            <div className="guake-empty loading">{t('terminal:empty.loadingConversation')}<span className="loading-dots"><span></span><span></span><span></span></span></div>
          )}
          {!isAgentSwitching && historyLoader.loadingHistory && historyLoader.history.length === 0 && outputs.length === 0 && (
            <div className="guake-empty loading">{t('terminal:empty.loadingConversation')}<span className="loading-dots"><span></span><span></span><span></span></span></div>
          )}
          {!isAgentSwitching && !historyLoader.loadingHistory && historyLoader.history.length === 0 && displayOutputs.length === 0 && agent.status !== 'working' && (
            <div className="guake-empty">{t('terminal:empty.noOutput')}</div>
          )}
          {!isAgentSwitching && historyLoader.hasMore && !search.searchMode && (
            <div className="guake-load-more">
              {historyLoader.loadingMore ? (
                <span>{t('terminal:empty.loadingOlder')}</span>
              ) : (
                <button onClick={historyLoader.loadMoreHistory}>
                  {t('terminal:empty.loadMore', { count: historyLoader.totalCount - historyLoader.history.length })}
                </button>
              )}
            </div>
          )}
          {/* Virtualized rendering */}
          {!isAgentSwitching && (
            <VirtualizedOutputList
              key={agentId}
              historyMessages={dedupedHistory}
              liveOutputs={dedupedOutputs}
              agentId={agentId}
              execTasks={execTasks}
              subagents={subagents}
              viewMode={viewMode}
              searchHighlight={search.highlightQuery}
              searchActiveIndex={search.scrollToIndex}
              selectedMessageIndex={messageNav.selectedIndex}
              isMessageSelected={messageNav.isSelected}
              onImageClick={onImageClick}
              onFileClick={onFileClick}
              onBashClick={onBashClick}
              onViewMarkdown={onViewMarkdown}
              scrollContainerRef={outputScrollRef}
              onScrollTopReached={historyLoader.loadMoreHistory}
              isLoadingMore={historyLoader.loadingMore}
              hasMore={historyLoader.hasMore}
              shouldAutoScroll={shouldAutoScroll}
              onUserScroll={handleUserScrollUp}
              pinToBottom={pinToBottom}
              onPinCancel={handlePinCancel}
              isLoadingHistory={historyLoader.fetchingHistory}
            />
          )}
          {/* Context compaction indicator */}
          {!isAgentSwitching && isCompacting && (
            <div className="compacting-indicator">
              <div className="compacting-bar">
                <div className="compacting-bar-fill" />
              </div>
              <span className="compacting-label">Compacting context...</span>
            </div>
          )}
          {/* Subordinate progress indicators now render inline within each DelegationBlock */}
        </div>
      </div>

      {/* Terminal input */}
      <TerminalInputArea
        selectedAgent={agent}
        selectedAgentId={agentId}
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
        completionElapsed={completionElapsed}
        onImageClick={onImageClick}
        inputRef={terminalInputRef}
        textareaRef={terminalTextareaRef}
        onClearHistory={historyLoader.clearHistory}
        onSendCommand={handleSendCommand}
        canSwipeClose={canSwipeClose}
        onSwipeCloseOffsetChange={onSwipeCloseOffsetChange}
        onSwipeClose={onSwipeClose}
      />
    </>
  );
}));
