/**
 * AgentPanel component - displays a single agent's output and input in CommanderView
 *
 * This is a lightweight wrapper that reuses:
 * - HistoryLine/OutputLine from ClaudeOutputPanel for message rendering
 * - TerminalInput from shared components for input handling
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import type { Agent } from '../../../shared/types';
import { useSupervisor, store, ClaudeOutput } from '../../store';
import { formatTokens } from '../../utils/formatting';
import { HistoryLine } from '../ClaudeOutputPanel/HistoryLine';
import { OutputLine } from '../ClaudeOutputPanel/OutputLine';
import { ImageModal, BashModal, AgentResponseModalWrapper, type BashModalState } from '../ClaudeOutputPanel/TerminalModals';
import { TerminalInput } from '../shared/TerminalInput';
import { useFilteredOutputs } from '../shared/useFilteredOutputs';
import type { AgentHistory, AttachedFile } from './types';
import { STATUS_COLORS, SCROLL_THRESHOLD } from './types';
import { apiUrl, authFetch } from '../../utils/storage';
import { resolveAgentFileReference } from '../../utils/filePaths';

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
}: AgentPanelProps) {
  const supervisor = useSupervisor();
  const outputRef = useRef<HTMLDivElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollPositionRef = useRef<number>(0);
  const isUserScrolledUpRef = useRef(false);
  const [imageModal, setImageModal] = useState<{ url: string; name: string } | null>(null);
  const [bashModal, setBashModal] = useState<BashModalState | null>(null);
  const [responseModalContent, setResponseModalContent] = useState<string | null>(null);

  // Input state - simple local state since Commander panels don't persist
  const [command, setCommand] = useState('');
  const [forceTextarea, setForceTextarea] = useState(false);
  const [pastedTexts, setPastedTexts] = useState<Map<number, string>>(new Map());
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const pastedCountRef = useRef(0);
  const fileCountRef = useRef(0);

  // Computed values
  const useTextarea = forceTextarea || command.includes('\n') || command.length > 50;
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
    const report = supervisor?.lastReport;
    if (!report?.agentSummaries) return null;
    return report.agentSummaries.find(
      s => s.agentId === agent.id || s.agentName === agent.name
    );
  }, [supervisor?.lastReport, agent.id, agent.name]);

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

  // Handle scroll to detect when to load more and track if user scrolled up
  const handleScroll = useCallback(() => {
    if (!outputRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;
    isUserScrolledUpRef.current = !isAtBottom;

    if (!loadingMore && history?.hasMore && onLoadMore && scrollTop < SCROLL_THRESHOLD) {
      setLoadingMore(true);
      scrollPositionRef.current = scrollHeight - scrollTop;
      onLoadMore();
    }
  }, [loadingMore, history?.hasMore, onLoadMore]);

  // Reset loadingMore when history changes
  useEffect(() => {
    if (loadingMore && history && !history.loading) {
      setLoadingMore(false);
      requestAnimationFrame(() => {
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight - scrollPositionRef.current;
        }
      });
    }
  }, [history, loadingMore]);

  // Scroll to bottom when panel first opens or becomes expanded
  const prevExpandedRef = useRef(isExpanded);
  useEffect(() => {
    if (isExpanded && !prevExpandedRef.current) {
      isUserScrolledUpRef.current = false;
    }
    prevExpandedRef.current = isExpanded;

    requestAnimationFrame(() => {
      if (outputRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
      }
    });
  }, [isExpanded]);

  // Scroll to bottom when history finishes loading
  const prevLoadingRef = useRef(history?.loading);
  useEffect(() => {
    if (prevLoadingRef.current && !history?.loading) {
      isUserScrolledUpRef.current = false;
      requestAnimationFrame(() => {
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
      });
    }
    prevLoadingRef.current = history?.loading;
  }, [history?.loading]);

  // Auto-scroll on new content (only if user is at bottom)
  useEffect(() => {
    requestAnimationFrame(() => {
      if (outputRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;
        // Only auto-scroll if user is at (or near) bottom
        if (isAtBottom) {
          outputRef.current.scrollTop = scrollHeight;
        }
      }
    });
  }, [history?.messages.length, filteredOutputs.length]);

  // Input handlers
  const handleAddPastedText = useCallback((text: string): number => {
    pastedCountRef.current += 1;
    const id = pastedCountRef.current;
    setPastedTexts(prev => new Map(prev).set(id, text));
    return id;
  }, []);

  const handleAddFile = useCallback((file: AttachedFile) => {
    setAttachedFiles(prev => [...prev, file]);
  }, []);

  const handleRemoveFile = useCallback((id: number) => {
    setAttachedFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const uploadFile = useCallback(async (file: File | Blob, filename?: string): Promise<AttachedFile | null> => {
    try {
      const response = await authFetch(apiUrl('/api/files/upload'), {
        method: 'POST',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
          'X-Filename': filename || (file instanceof File ? file.name : ''),
        },
        body: file,
      });

      if (!response.ok) return null;

      const data = await response.json();
      fileCountRef.current += 1;

      return {
        id: fileCountRef.current,
        name: data.filename,
        path: data.absolutePath,
        isImage: data.isImage,
        size: data.size,
      };
    } catch {
      return null;
    }
  }, []);

  const handleSend = useCallback(() => {
    if (!canSend) return;

    // Expand pasted text placeholders
    let fullCommand = command.trim();
    for (const [id, pastedText] of pastedTexts) {
      const placeholder = new RegExp(`\\[Pasted text #${id} \\+\\d+ lines\\]`, 'g');
      fullCommand = fullCommand.replace(placeholder, pastedText);
    }

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
    pastedCountRef.current = 0;
  }, [agent.id, command, canSend, pastedTexts, attachedFiles]);

  const handleImageClick = useCallback((url: string, name: string) => {
    setImageModal({ url, name });
  }, []);

  const handleFileClick = useCallback((path: string, editData?: { oldString?: string; newString?: string; operation?: string; highlightRange?: { offset: number; limit: number }; targetLine?: number }) => {
    const ref = resolveAgentFileReference(path, agent.cwd);
    const mergedEditData = ref.line
      ? { ...(editData || {}), targetLine: ref.line }
      : editData;
    store.setFileViewerPath(ref.path, mergedEditData);
  }, [agent.cwd]);

  const handleBashClick = useCallback((commandText: string, output: string) => {
    const isLive = output === 'Running...';
    setBashModal({ command: commandText, output, isLive });
  }, []);

  const handleViewMarkdown = useCallback((content: string) => {
    setResponseModalContent(content);
  }, []);

  const statusColor = STATUS_COLORS[agent.status] || '#888888';
  const messages = history?.messages || [];

  return (
    <div
      className={`agent-panel ${agent.status === 'working' ? 'working' : ''} ${isExpanded ? 'expanded' : ''} ${isFocused ? 'focused' : ''}`}
      onClick={onFocus}
    >
      {/* Header */}
      <div className="agent-panel-header">
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
          <span className="agent-panel-class">{agent.class}</span>
          <span className="agent-panel-id" title={`ID: ${agent.id}`}>
            [{agent.id.substring(0, 4)}]
          </span>
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
          {agent.currentTask && (
            <div className="agent-panel-task" title={agent.currentTask}>
              {agent.currentTask.substring(0, 40)}...
            </div>
          )}
          <button
            className="agent-panel-expand"
            onClick={e => {
              e.stopPropagation();
              onExpand();
            }}
            title={isExpanded ? 'Collapse (Esc)' : 'Expand'}
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

      {/* Output Content */}
      <div className="agent-panel-content" ref={outputRef} onScroll={handleScroll}>
        {history?.loading ? (
          <div className="agent-panel-loading">Loading...</div>
        ) : (
          <>
            {history?.hasMore && (
              <div className="agent-panel-load-more">
                {loadingMore ? (
                  <span>Loading...</span>
                ) : (
                  <button onClick={onLoadMore}>
                    Load more ({(history?.totalCount || 0) - (history?.messages.length || 0)})
                  </button>
                )}
              </div>
            )}
            {messages.map((msg, i) => (
              <HistoryLine
                key={`h-${i}`}
                message={msg}
                agentId={agent.id}
                simpleView={!advancedView}
                onImageClick={handleImageClick}
                onFileClick={handleFileClick}
                onBashClick={handleBashClick}
                onViewMarkdown={handleViewMarkdown}
              />
            ))}
            {filteredOutputs.map((output, i) => (
              <OutputLine
                key={`o-${i}`}
                output={output}
                agentId={agent.id}
                onImageClick={handleImageClick}
                onFileClick={handleFileClick}
                onBashClick={handleBashClick}
                onViewMarkdown={handleViewMarkdown}
              />
            ))}
            {!messages.length && !filteredOutputs.length && (
              <div className="agent-panel-empty">
                No messages yet
                {!agent.sessionId && (
                  <div style={{ fontSize: '10px', color: '#666' }}>No session ID</div>
                )}
              </div>
            )}
            {agent.status === 'working' && (
              <div className="agent-panel-typing">
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
                <span className="typing-dot"></span>
                <button
                  className="agent-panel-stop-btn"
                  onClick={e => {
                    e.stopPropagation();
                    store.stopAgent(agent.id);
                  }}
                  title="Stop current operation"
                >
                  Stop
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Input - using shared TerminalInput */}
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
        onRemoveFile={handleRemoveFile}
        uploadFile={uploadFile}
        onAddPastedText={handleAddPastedText}
        placeholder={`Command ${agent.name}...`}
        compact={true}
        inputRef={inputRef}
      />

      {imageModal && <ImageModal url={imageModal.url} name={imageModal.name} onClose={() => setImageModal(null)} />}
      {bashModal && <BashModal state={bashModal} onClose={() => setBashModal(null)} />}
      <AgentResponseModalWrapper agent={agent} content={responseModalContent} onClose={() => setResponseModalContent(null)} />
    </div>
  );
}
