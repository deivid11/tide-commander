/**
 * AgentPanel component - displays a single agent's output and input in CommanderView
 *
 * This is a lightweight wrapper that reuses:
 * - HistoryLine/OutputLine from ClaudeOutputPanel for message rendering
 * - TerminalInput from shared components for input handling
 */

import React, { useRef, useEffect, useState, useMemo, useCallback, memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '../../../shared/types';
import { useSupervisorLastReport, useLastPrompt, store, ClaudeOutput } from '../../store';
import { formatTokens } from '../../utils/formatting';
import { VirtualizedOutputList } from '../ClaudeOutputPanel/VirtualizedOutputList';
import { ImageModal, BashModal, AgentResponseModalWrapper, type BashModalState } from '../ClaudeOutputPanel/TerminalModals';
import { useTerminalInput } from '../ClaudeOutputPanel/useTerminalInput';
import { TerminalInput } from '../shared/TerminalInput';
import { useFilteredOutputs } from '../shared/useFilteredOutputs';
import type { AgentHistory } from './types';
import { STATUS_COLORS } from './types';
import { resolveAgentFileReference } from '../../utils/filePaths';
import { useModalStackRegistration } from '../../hooks/useModalStack';

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Isolated elapsed timer + stop button — same style as Guake terminal.
 * Owns its own 1-second interval so the parent AgentPanel is NOT re-rendered every tick.
 */
const ElapsedTimer = memo(function ElapsedTimer({
  agentId,
  isWorking,
  timestamp,
}: {
  agentId: string;
  isWorking: boolean;
  timestamp: number | undefined;
}) {
  const { t } = useTranslation(['terminal']);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isWorking || !timestamp) {
      setElapsed(0);
      return;
    }
    setElapsed(Date.now() - timestamp);
    const interval = setInterval(() => {
      setElapsed(Date.now() - timestamp);
    }, 1000);
    return () => clearInterval(interval);
  }, [isWorking, timestamp]);

  if (!isWorking) return null;

  return (
    <div className="guake-stop-bar">
      <span className="guake-elapsed-timer">{formatElapsed(elapsed)}</span>
      <button
        className="guake-stop-btn"
        onClick={() => store.stopAgent(agentId)}
        title={t('terminal:input.stopOperation')}
      >
        <span className="stop-icon">■</span>
        <span className="stop-label">{t('terminal:input.stop')}</span>
      </button>
    </div>
  );
});

interface AgentPanelProps {
  agent: Agent;
  history?: AgentHistory;
  outputs: ClaudeOutput[];
  isExpanded: boolean;
  isFocused: boolean;
  advancedView: boolean;
  onExpand: () => void;
  onFocus?: () => void;
  inputRef: (el: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onLoadMore?: () => void;
  onClearHistory: () => void;
}

export function AgentPanel({
  agent,
  history,
  outputs,
  isExpanded,
  isFocused,
  advancedView,
  onExpand,
  onFocus,
  inputRef,
  onLoadMore,
  onClearHistory,
}: AgentPanelProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const lastReport = useSupervisorLastReport();
  const lastPrompt = useLastPrompt(agent.id);
  const outputRef = useRef<HTMLDivElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollPositionRef = useRef<number>(0);
  const isUserScrolledUpRef = useRef(false);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [pinToBottom, setPinToBottom] = useState(false);
  const [imageModal, setImageModal] = useState<{ url: string; name: string } | null>(null);
  const [bashModal, setBashModal] = useState<BashModalState | null>(null);
  const [responseModalContent, setResponseModalContent] = useState<string | null>(null);

  useModalStackRegistration(`commander-image-modal-${agent.id}`, imageModal !== null, () => setImageModal(null));

  const {
    command,
    setCommand,
    forceTextarea,
    setForceTextarea,
    useTextarea,
    setPastedTexts,
    incrementPastedCount,
    resetPastedCount,
    attachedFiles,
    setAttachedFiles,
    removeAttachedFile,
    uploadFile,
    expandPastedTexts,
  } = useTerminalInput({ selectedAgentId: agent.id });

  // Computed values
  const canSend = command.trim().length > 0 || attachedFiles.length > 0;

  // Filter outputs based on view mode (same as Guake terminal)
  const viewFilteredOutputs = useFilteredOutputs({
    outputs,
    viewMode: advancedView ? 'advanced' : 'simple',
  });

  // Just use the filtered outputs directly - no dedup
  const filteredOutputs = viewFilteredOutputs;

  // Get supervisor status for this agent
  const supervisorStatus = useMemo(() => {
    if (!lastReport?.agentSummaries) return null;
    return lastReport.agentSummaries.find(
      s => s.agentId === agent.id || s.agentName === agent.name
    );
  }, [lastReport, agent.id, agent.name]);

  // Calculate context usage info
  const contextInfo = useMemo(() => {
    const stats = agent.contextStats;
    if (stats) {
      return {
        usedPercent: stats.usedPercent,
        freePercent: 100 - stats.usedPercent,
        hasData: true,
        totalTokens: stats.totalTokens,
        contextWindow: stats.contextWindow,
      };
    }
    const used = agent.contextUsed || 0;
    const limit = agent.contextLimit || 200000;
    const usedPercent = (used / limit) * 100;
    return {
      usedPercent,
      freePercent: 100 - usedPercent,
      hasData: false,
      totalTokens: used,
      contextWindow: limit,
    };
  }, [agent.contextStats, agent.contextUsed, agent.contextLimit]);

  // Handle load-more when VirtualizedOutputList detects scroll near top
  const handleScrollTopReached = useCallback(() => {
    if (!loadingMore && history?.hasMore && onLoadMore) {
      setLoadingMore(true);
      scrollPositionRef.current = outputRef.current
        ? outputRef.current.scrollHeight - outputRef.current.scrollTop
        : 0;
      onLoadMore();
    }
  }, [loadingMore, history?.hasMore, onLoadMore]);

  // Reset loadingMore when history changes
  useEffect(() => {
    if (loadingMore && history && !history.loading) {
      setLoadingMore(false);
    }
  }, [history, loadingMore]);

  // Handle user scrolling up (disables auto-scroll)
  const handleUserScrollUp = useCallback(() => {
    isUserScrolledUpRef.current = true;
    setShouldAutoScroll(false);
  }, []);

  // Pin to bottom when panel expands or becomes focused
  const prevExpandedRef = useRef(isExpanded);
  const prevFocusedRef = useRef(isFocused);
  useEffect(() => {
    if ((isExpanded && !prevExpandedRef.current) || (isFocused && !prevFocusedRef.current)) {
      isUserScrolledUpRef.current = false;
      setShouldAutoScroll(true);
      setPinToBottom(true);
    }
    prevExpandedRef.current = isExpanded;
    prevFocusedRef.current = isFocused;
  }, [isExpanded, isFocused]);

  // Pin to bottom when history finishes loading
  const prevLoadingRef = useRef(history?.loading);
  useEffect(() => {
    if (prevLoadingRef.current && !history?.loading) {
      isUserScrolledUpRef.current = false;
      setShouldAutoScroll(true);
      setPinToBottom(true);
    }
    prevLoadingRef.current = history?.loading;
  }, [history?.loading]);

  // Re-enable auto-scroll when new outputs arrive and user is at bottom
  useEffect(() => {
    if (!isUserScrolledUpRef.current) {
      setShouldAutoScroll(true);
    }
  }, [filteredOutputs.length]);

  // No-op for message selection (CommanderView doesn't use keyboard message nav)
  const noopIsMessageSelected = useCallback(() => false, []);

  // Input handlers
  const handleAddPastedText = useCallback((text: string): number => {
    const id = incrementPastedCount();
    setPastedTexts(prev => new Map(prev).set(id, text));
    return id;
  }, [incrementPastedCount, setPastedTexts]);

  const handleAddFile = useCallback((file: (typeof attachedFiles)[number]) => {
    setAttachedFiles(prev => [...prev, file]);
  }, [setAttachedFiles]);

  const handleSend = useCallback(() => {
    if (!canSend) return;

    if (command.trim() === '/clear' && attachedFiles.length === 0) {
      store.clearContext(agent.id);
      onClearHistory();
      setCommand('');
      setForceTextarea(false);
      setPastedTexts(new Map());
      setAttachedFiles([]);
      resetPastedCount();
      return;
    }

    // Expand pasted text placeholders before sending
    let fullCommand = expandPastedTexts(command.trim());

    // Add file references
    if (attachedFiles.length > 0) {
      const fileRefs = attachedFiles
        .map(f => f.isImage ? `[Image: ${f.path}]` : `[File: ${f.path}]`)
        .join('\n');
      fullCommand = fullCommand ? `${fullCommand}\n\n${fileRefs}` : fileRefs;
    }

    store.sendCommand(agent.id, fullCommand);

    // Reset input state
    setCommand('');
    setForceTextarea(false);
    setPastedTexts(new Map());
    setAttachedFiles([]);
    resetPastedCount();
  }, [agent.id, command, canSend, attachedFiles, expandPastedTexts, onClearHistory, resetPastedCount, setCommand, setForceTextarea, setPastedTexts, setAttachedFiles]);

  const handleImageClick = useCallback((url: string, name: string) => {
    setImageModal({ url, name });
  }, []);

  const handleFileClick = useCallback((path: string, editData?: { oldString?: string; newString?: string; operation?: string; highlightRange?: { offset: number; limit: number }; targetLine?: number }) => {
    const ref = resolveAgentFileReference(path, agent.cwd);
    const mergedEditData = ref.line
      ? { ...(editData || {}), targetLine: ref.line }
      : editData;
    store.setFileViewerPath(ref.path, mergedEditData, agent.cwd);
  }, [agent.cwd]);

  const handleBashClick = useCallback((commandText: string, output: string) => {
    const isLive = output === 'Running...';
    setBashModal({ command: commandText, output, isLive });
  }, []);

  const handleViewMarkdown = useCallback((content: string) => {
    setResponseModalContent(content);
  }, []);

  const handlePinCancel = useCallback(() => setPinToBottom(false), []);

  const handleCloseImageModal = useCallback(() => setImageModal(null), []);
  const handleCloseBashModal = useCallback(() => setBashModal(null), []);
  const handleCloseResponseModal = useCallback(() => setResponseModalContent(null), []);

  const handleExpandClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onExpand();
  }, [onExpand]);

  const statusColor = STATUS_COLORS[agent.status] || '#888888';
  const messages = history?.messages || [];

  return (
    <div
      className={`agent-panel ${agent.status === 'working' ? 'working' : ''} ${isExpanded ? 'expanded' : ''} ${isFocused ? 'focused' : ''}`}
      onClick={!isFocused ? onFocus : undefined}
    >
      {/* Header */}
      <div className="agent-panel-header" onClick={isFocused ? onFocus : undefined}>
        <div className="agent-panel-info">
          <span
            className="agent-panel-status"
            style={{ background: statusColor }}
            title={agent.status}
          />
          <span className="agent-panel-name">
            {(agent.isBoss || agent.class === 'boss') && (
              <span className="agent-panel-boss-crown">👑</span>
            )}
            {agent.name}
          </span>
          <span className={`agent-panel-status-label ${agent.status}`}>{agent.status}</span>
          <span className="agent-panel-class">{agent.class}</span>
          <span className={`agent-panel-provider ${agent.provider === 'codex' ? 'codex' : 'claude'}`}>
            {agent.provider === 'codex' ? 'codex' : 'claude'}
          </span>
          <span className="agent-panel-id" title={`ID: ${agent.id}`}>
            [{agent.id.substring(0, 4)}]
          </span>
          {agent.taskLabel ? (
            <div className="agent-panel-task agent-panel-task-label" title={agent.taskLabel}>
              📋 {agent.taskLabel}
            </div>
          ) : agent.currentTask ? (
            <div className="agent-panel-task" title={agent.currentTask}>
              {agent.currentTask.substring(0, 40)}...
            </div>
          ) : null}
        </div>
        <div
          className="agent-panel-context"
          title={`Context: ${Math.round(contextInfo.usedPercent)}% used (${formatTokens(contextInfo.totalTokens)} / ${formatTokens(contextInfo.contextWindow)})`}
        >
          <div
            className="agent-panel-context-bar"
            style={{
              background:
                contextInfo.freePercent < 20
                  ? '#ff4a4a'
                  : contextInfo.freePercent < 50
                    ? '#ff9e4a'
                    : '#4aff9e',
              width: `${contextInfo.freePercent}%`,
            }}
          />
          <span className="agent-panel-context-text">{Math.round(contextInfo.freePercent)}%</span>
        </div>
        <div className="agent-panel-actions">
          <button
            className="agent-panel-expand"
            onClick={handleExpandClick}
            title={isExpanded ? t('commander.collapsePanel') : t('commander.expandPanel')}
          >
            {isExpanded ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Supervisor Status */}
      {supervisorStatus && (
        <div className="agent-panel-supervisor-status">{supervisorStatus.statusDescription}</div>
      )}

      {/* Output Content - Virtualized scroll rendering */}
      <div className="agent-panel-content" ref={outputRef}>
        {history?.loading ? (
          <div className="agent-panel-loading">{t('common:status.loading')}</div>
        ) : (
          <>
            {!messages.length && !filteredOutputs.length ? (
              <div className="agent-panel-empty">
                {t('commander.noMessages')}
                {!agent.sessionId && (
                  <div style={{ fontSize: '10px', color: '#666' }}>{t('commander.noSessionId')}</div>
                )}
              </div>
            ) : (
              <VirtualizedOutputList
                historyMessages={messages}
                liveOutputs={filteredOutputs}
                agentId={agent.id}
                viewMode={advancedView ? 'advanced' : 'simple'}
                selectedMessageIndex={null}
                isMessageSelected={noopIsMessageSelected}
                onImageClick={handleImageClick}
                onFileClick={handleFileClick}
                onBashClick={handleBashClick}
                onViewMarkdown={handleViewMarkdown}
                scrollContainerRef={outputRef}
                onScrollTopReached={handleScrollTopReached}
                isLoadingMore={loadingMore}
                hasMore={history?.hasMore}
                shouldAutoScroll={shouldAutoScroll}
                onUserScroll={handleUserScrollUp}
                pinToBottom={pinToBottom}
                onPinCancel={handlePinCancel}
                isLoadingHistory={history?.loading}
              />
            )}
          </>
        )}
      </div>

      {/* Input - using shared TerminalInput with guake wrapper state classes */}
      <div className={`guake-input-wrapper ${agent.status === 'working' ? 'has-stop-btn is-working' : ''}`}>
        <ElapsedTimer
          agentId={agent.id}
          isWorking={agent.status === 'working'}
          timestamp={lastPrompt?.timestamp}
        />
        <TerminalInput
          command={command}
          onCommandChange={setCommand}
          useTextarea={useTextarea}
          forceTextarea={forceTextarea}
          onForceTextarea={setForceTextarea}
          onSend={handleSend}
          canSend={canSend}
          attachedFiles={attachedFiles}
          onAddFile={handleAddFile}
          onRemoveFile={removeAttachedFile}
          uploadFile={uploadFile}
          onAddPastedText={handleAddPastedText}
          placeholder={t('commander.command', { name: agent.name })}
          compact={false}
          inputRef={inputRef}
        />
      </div>

      {imageModal && <ImageModal url={imageModal.url} name={imageModal.name} onClose={handleCloseImageModal} />}
      {bashModal && <BashModal state={bashModal} onClose={handleCloseBashModal} />}
      <AgentResponseModalWrapper agent={agent} content={responseModalContent} onClose={handleCloseResponseModal} />
    </div>
  );
}
