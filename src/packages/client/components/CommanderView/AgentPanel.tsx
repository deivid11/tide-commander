/**
 * AgentPanel component - displays a single agent's output and input in CommanderView
 * Uses shared components from ClaudeOutputPanel (Guake) for consistent rendering
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import type { Agent } from '../../../shared/types';
import { useStore, store, ClaudeOutput } from '../../store';
import { formatTokens } from '../../utils/formatting';
import { useAgentInput } from './useAgentInput';
// Reuse components from ClaudeOutputPanel (Guake) for consistent rendering
import { HistoryLine } from '../ClaudeOutputPanel/HistoryLine';
import { OutputLine } from '../ClaudeOutputPanel/OutputLine';
import type { AgentHistory } from './types';
import { STATUS_COLORS, SCROLL_THRESHOLD } from './types';

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
  const state = useStore();
  const outputRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollPositionRef = useRef<number>(0);

  // Use the custom hook for input management
  const {
    command,
    setCommand,
    forceTextarea,
    setForceTextarea,
    useTextarea,
    getTextareaRows,
    addPastedText,
    expandPastedTexts,
    attachedFiles,
    addAttachedFile,
    removeAttachedFile,
    uploadFile,
    resetInput,
  } = useAgentInput();

  // Get supervisor status for this agent
  const supervisorStatus = useMemo(() => {
    const report = state.supervisor?.lastReport;
    if (!report?.agentSummaries) return null;
    return report.agentSummaries.find(
      s => s.agentId === agent.id || s.agentName === agent.name
    );
  }, [state.supervisor?.lastReport, agent.id, agent.name]);

  // Calculate context usage info
  const contextInfo = useMemo(() => {
    const stats = agent.contextStats;
    if (stats) {
      const usedPercent = stats.usedPercent;
      const freePercent = 100 - usedPercent;
      return {
        usedPercent,
        freePercent,
        hasData: true,
        totalTokens: stats.totalTokens,
        contextWindow: stats.contextWindow,
      };
    }
    // Fallback to basic calculation
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

  // Handle scroll to detect when to load more
  const handleScroll = useCallback(() => {
    if (!outputRef.current || loadingMore || !history?.hasMore || !onLoadMore) return;

    // Check if scrolled near top
    if (outputRef.current.scrollTop < SCROLL_THRESHOLD) {
      setLoadingMore(true);
      // Save scroll position
      scrollPositionRef.current = outputRef.current.scrollHeight - outputRef.current.scrollTop;
      onLoadMore();
    }
  }, [loadingMore, history?.hasMore, onLoadMore]);

  // Reset loadingMore when history changes
  useEffect(() => {
    if (loadingMore && history && !history.loading) {
      setLoadingMore(false);
      // Restore scroll position after new messages are prepended
      requestAnimationFrame(() => {
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight - scrollPositionRef.current;
        }
      });
    }
  }, [history, loadingMore]);

  // Auto-scroll on new content
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history?.messages.length, outputs.length]);

  // Handle paste event - collapse large pastes into variables or upload images
  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;

    // Check for images first
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const attached = await uploadFile(blob);
          if (attached) {
            addAttachedFile(attached);
          }
        }
        return;
      }
    }

    // Check for files
    const files = e.clipboardData.files;
    if (files.length > 0) {
      e.preventDefault();
      for (const file of files) {
        const attached = await uploadFile(file);
        if (attached) {
          addAttachedFile(attached);
        }
      }
      return;
    }

    // Handle text paste (collapse large text)
    const pastedText = e.clipboardData.getData('text');
    const lineCount = (pastedText.match(/\n/g) || []).length + 1;

    // If pasting more than 5 lines, collapse into a variable
    if (lineCount > 5) {
      e.preventDefault();
      const pasteId = addPastedText(pastedText);

      // Insert placeholder in command
      const placeholder = `[Pasted text #${pasteId} +${lineCount} lines]`;
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      const start = target.selectionStart || 0;
      const end = target.selectionEnd || 0;
      const newCommand = command.slice(0, start) + placeholder + command.slice(end);
      setCommand(newCommand);

      // Auto-expand to textarea if needed
      if (!useTextarea) {
        setForceTextarea(true);
      }
    }
  };

  // Handle file input change
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of files) {
      const attached = await uploadFile(file);
      if (attached) {
        addAttachedFile(attached);
      }
    }

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSend = () => {
    if (!command.trim() && attachedFiles.length === 0) return;

    // Build the full command with attachments
    let fullCommand = expandPastedTexts(command.trim());

    // Add file references for Claude to read
    if (attachedFiles.length > 0) {
      const fileRefs = attachedFiles
        .map(f => {
          if (f.isImage) {
            return `[Image: ${f.path}]`;
          } else {
            return `[File: ${f.path}]`;
          }
        })
        .join('\n');

      if (fullCommand) {
        fullCommand = `${fullCommand}\n\n${fileRefs}`;
      } else {
        fullCommand = fileRefs;
      }
    }

    store.sendCommand(agent.id, fullCommand);
    resetInput();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Shift+Enter: switch to textarea mode (from input) or add newline (in textarea)
    if (e.key === 'Enter' && e.shiftKey) {
      if (!useTextarea) {
        e.preventDefault();
        setForceTextarea(true);
      }
      // In textarea, let default behavior add newline
      return;
    }
    // Regular Enter: send command
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const statusColor = STATUS_COLORS[agent.status] || '#888888';

  // In simple mode (advancedView=false), we show all messages but HistoryLine renders them simplified
  // In advanced mode, we show everything with full details
  const messages = history?.messages || [];

  // Convert live outputs to the format expected by Guake's OutputLine
  // The Guake OutputLine expects agentId for certain features
  const liveOutputs = outputs;

  return (
    <div
      className={`agent-panel ${agent.status === 'working' ? 'working' : ''} ${isExpanded ? 'expanded' : ''} ${isFocused ? 'focused' : ''}`}
      onClick={onFocus}
    >
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
        {/* Context usage indicator */}
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
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="4 14 10 14 10 20" />
                <polyline points="20 10 14 10 14 4" />
                <line x1="14" y1="10" x2="21" y2="3" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
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

      <div className="agent-panel-content" ref={outputRef} onScroll={handleScroll}>
        {history?.loading ? (
          <div className="agent-panel-loading">Loading...</div>
        ) : (
          <>
            {/* Load more indicator */}
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
              />
            ))}
            {liveOutputs.map((output, i) => (
              <OutputLine
                key={`o-${i}`}
                output={output}
                agentId={agent.id}
              />
            ))}
            {!messages.length && !liveOutputs.length && (
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

      {/* Attached files display */}
      {attachedFiles.length > 0 && (
        <div className="agent-panel-attachments">
          {attachedFiles.map(file => (
            <div
              key={file.id}
              className={`agent-panel-attachment ${file.isImage ? 'is-image' : ''}`}
            >
              <span className="agent-panel-attachment-icon">{file.isImage ? '🖼️' : '📎'}</span>
              <span className="agent-panel-attachment-name" title={file.path}>
                {file.name}
              </span>
              <button
                className="agent-panel-attachment-remove"
                onClick={() => removeAttachedFile(file.id)}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className={`agent-panel-input ${useTextarea ? 'agent-panel-input-expanded' : ''}`}>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          style={{ display: 'none' }}
          accept="image/*,.txt,.md,.json,.js,.ts,.tsx,.jsx,.py,.sh,.css,.scss,.html,.xml,.yaml,.yml,.toml,.ini,.cfg,.conf"
        />
        <button
          className="agent-panel-attach-btn"
          onClick={() => fileInputRef.current?.click()}
          title="Attach file (or paste image)"
        >
          📎
        </button>
        {useTextarea ? (
          <textarea
            ref={inputRef as React.RefCallback<HTMLTextAreaElement>}
            placeholder={`Command ${agent.name}... (paste image)`}
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={getTextareaRows()}
          />
        ) : (
          <input
            ref={inputRef as React.RefCallback<HTMLInputElement>}
            type="text"
            placeholder={`Command ${agent.name}... (paste image)`}
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
        )}
        <button onClick={handleSend} disabled={!command.trim() && attachedFiles.length === 0}>
          Send
        </button>
      </div>
    </div>
  );
}
