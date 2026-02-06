/**
 * Agent Debug Panel Component
 *
 * Displays agent-specific debug messages in a side panel within the Guake Terminal
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  agentDebugger,
  type AgentDebugMessage,
  type AgentDebugStats,
  type DebugLog,
} from '../../services/agentDebugger';

/**
 * Syntax highlight JSON string with Dracula colors
 */
function highlightJson(json: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let key = 0;

  // Validate JSON first
  try {
    JSON.parse(json);
  } catch (e) {
    // If JSON is invalid, show error and raw content
    nodes.push(
      <span key={key++} className="json-error">
        [Invalid JSON: {String(e).slice(0, 50)}]
      </span>
    );
    nodes.push(<span key={key++}>{json}</span>);
    return nodes;
  }

  // Regex to match JSON tokens
  const tokenRegex = /("(?:\\.|[^"\\])*")\s*:|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}[\],:])/g;

  let lastIndex = 0;
  let match;

  while ((match = tokenRegex.exec(json)) !== null) {
    // Add any whitespace/text before this match
    if (match.index > lastIndex) {
      nodes.push(<span key={key++}>{json.slice(lastIndex, match.index)}</span>);
    }

    const [fullMatch, keyStr, str, num, bool, nullVal, punct] = match;

    if (keyStr) {
      // Property key (with colon) - purple
      nodes.push(
        <span key={key++} className="json-key">{keyStr.slice(0, -1)}</span>
      );
      nodes.push(<span key={key++} className="json-punct">:</span>);
    } else if (str) {
      // String value - yellow
      nodes.push(<span key={key++} className="json-string">{str}</span>);
    } else if (num) {
      // Number - cyan
      nodes.push(<span key={key++} className="json-number">{num}</span>);
    } else if (bool) {
      // Boolean - pink
      nodes.push(<span key={key++} className="json-boolean">{bool}</span>);
    } else if (nullVal) {
      // Null - orange
      nodes.push(<span key={key++} className="json-null">{nullVal}</span>);
    } else if (punct) {
      // Punctuation - comment color
      nodes.push(<span key={key++} className="json-punct">{punct}</span>);
    }

    lastIndex = match.index + fullMatch.length;
  }

  // Add any remaining text
  if (lastIndex < json.length) {
    nodes.push(<span key={key++}>{json.slice(lastIndex)}</span>);
  }

  return nodes;
}

interface AgentDebugPanelProps {
  agentId: string;
  onClose: () => void;
}

export const AgentDebugPanel: React.FC<AgentDebugPanelProps> = ({
  agentId,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'messages' | 'logs'>('messages');
  const [messages, setMessages] = useState<AgentDebugMessage[]>([]);
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [stats, setStats] = useState<AgentDebugStats>({
    total: 0,
    sent: 0,
    received: 0,
    messageTypes: [],
  });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  const [directionFilter, setDirectionFilter] = useState<'all' | 'sent' | 'received'>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [logLevelFilter, setLogLevelFilter] = useState<'all' | 'debug' | 'info' | 'warn' | 'error'>('all');
  const [textOnlyMode, setTextOnlyMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const logsScrollRef = useRef<HTMLDivElement>(null);

  // Load messages from debugger
  const loadMessages = useCallback(() => {
    const msgs = agentDebugger.getMessages(agentId);
    setMessages([...msgs]); // Create new array reference to trigger re-render
    setStats(agentDebugger.getStats(agentId));
  }, [agentId]);

  // Load logs from debugger
  const loadLogs = useCallback(() => {
    const logEntries = agentDebugger.getLogs();
    setLogs([...logEntries]);
  }, []);

  // Subscribe to debugger updates
  useEffect(() => {
    loadMessages();
    const unsubscribe = agentDebugger.subscribe((updatedAgentId) => {
      if (updatedAgentId === agentId || updatedAgentId === 'all') {
        loadMessages();
      }
    });
    return unsubscribe;
  }, [agentId, loadMessages]);

  // Subscribe to logs updates
  useEffect(() => {
    loadLogs();
    const unsubscribe = agentDebugger.subscribeLogs(() => {
      loadLogs();
    });
    return unsubscribe;
  }, [loadLogs]);

  // Filter messages - must be before auto-scroll effect
  const filteredMessages = useMemo(() => {
    return messages.filter((msg) => {
      // Text only mode - only show messages with text field
      if (textOnlyMode) {
        const payload = msg.payload as any;
        if (!payload?.text || typeof payload.text !== 'string') {
          return false;
        }
      }

      // Direction filter
      if (directionFilter !== 'all' && msg.direction !== directionFilter) {
        return false;
      }

      // Type filter
      if (typeFilter !== 'all' && msg.type !== typeFilter) {
        return false;
      }

      // Search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesType = msg.type.toLowerCase().includes(query);
        const matchesPayload = JSON.stringify(msg.payload)
          .toLowerCase()
          .includes(query);
        return matchesType || matchesPayload;
      }

      return true;
    });
  }, [messages, directionFilter, typeFilter, textOnlyMode, searchQuery]);

  // Filter logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Level filter
      if (logLevelFilter !== 'all' && log.level !== logLevelFilter) {
        return false;
      }

      // Search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesMessage = log.message.toLowerCase().includes(query);
        const matchesSource = log.source?.toLowerCase().includes(query) || false;
        const matchesData = log.data ? JSON.stringify(log.data).toLowerCase().includes(query) : false;
        return matchesMessage || matchesSource || matchesData;
      }

      return true;
    });
  }, [logs, logLevelFilter, searchQuery]);

  // Auto-scroll to bottom when filtered messages change
  useEffect(() => {
    if (autoScroll && scrollRef.current && activeTab === 'messages') {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredMessages, autoScroll, activeTab]);

  // Auto-scroll logs
  useEffect(() => {
    if (autoScroll && logsScrollRef.current && activeTab === 'logs') {
      logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll, activeTab]);

  // Toggle message expansion
  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Expand/collapse all
  const expandAll = () => {
    setExpandedIds(new Set(filteredMessages.map((m) => m.id)));
  };

  const collapseAll = () => {
    setExpandedIds(new Set());
  };

  // Copy message
  const copyMessage = (msg: AgentDebugMessage) => {
    navigator.clipboard.writeText(msg.raw);
  };

  // Copy all filtered messages
  const copyAllMessages = () => {
    const text = filteredMessages.map((m) => m.raw).join('\n\n');
    navigator.clipboard.writeText(text);
  };

  // Clear messages
  const clearMessages = () => {
    agentDebugger.clearMessages(agentId);
  };

  // Clear logs
  const clearLogs = () => {
    agentDebugger.clearLogs();
  };

  // Toggle log expansion
  const toggleLogExpanded = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Get log level icon and color class
  const getLogLevelInfo = (level: DebugLog['level']) => {
    switch (level) {
      case 'debug': return { icon: '🔍', className: 'log-debug' };
      case 'info': return { icon: 'ℹ️', className: 'log-info' };
      case 'warn': return { icon: '⚠️', className: 'log-warn' };
      case 'error': return { icon: '❌', className: 'log-error' };
    }
  };

  // Format timestamp
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  // Format size
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  return (
    <div className="agent-debug-panel">
      {/* Header */}
      <div className="agent-debug-header">
        <div className="agent-debug-title">
          <span className="icon">🐛</span>
          Agent Debugger
        </div>
        <button className="close-btn" onClick={onClose} title="Close debugger">
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div className="agent-debug-tabs">
        <button
          className={`tab ${activeTab === 'messages' ? 'active' : ''}`}
          onClick={() => setActiveTab('messages')}
        >
          📨 Messages ({stats.total})
        </button>
        <button
          className={`tab ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          📋 Logs ({logs.length})
        </button>
      </div>

      {activeTab === 'messages' && (
        <>
          {/* Stats Bar */}
          <div className="agent-debug-stats">
            <span className="stat stat-sent">↑ {stats.sent}</span>
            <span className="stat stat-received">↓ {stats.received}</span>
            <span className="stat">Types: {stats.messageTypes.length}</span>
            <button
              className={`text-only-toggle ${textOnlyMode ? 'active' : ''}`}
              onClick={() => setTextOnlyMode(!textOnlyMode)}
              title={textOnlyMode ? 'Show all messages' : 'Show only text messages'}
            >
              💬 {textOnlyMode ? 'Text Only' : 'All'}
            </button>
          </div>

          {/* Controls */}
          <div className="agent-debug-controls">
        {/* Direction filter */}
        <select
          value={directionFilter}
          onChange={(e) =>
            setDirectionFilter(e.target.value as 'all' | 'sent' | 'received')
          }
          className="filter-select"
        >
          <option value="all">All Directions</option>
          <option value="sent">Sent Only</option>
          <option value="received">Received Only</option>
        </select>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Types</option>
          {stats.messageTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        {/* Search */}
        <input
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="search-input"
        />
      </div>

      {/* Action buttons */}
      <div className="agent-debug-actions">
        <button onClick={expandAll} className="action-btn" title="Expand all messages">
          Expand All
        </button>
        <button onClick={collapseAll} className="action-btn" title="Collapse all messages">
          Collapse All
        </button>
        <button onClick={copyAllMessages} className="action-btn" title="Copy all filtered messages">
          Copy All
        </button>
        <button onClick={clearMessages} className="action-btn clear-btn" title="Clear all messages">
          Clear
        </button>
        <label className="auto-scroll-label">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          <span className="toggle-switch" />
          Auto-scroll
        </label>
      </div>

          {/* Messages */}
          <div className="agent-debug-messages" ref={scrollRef}>
            {filteredMessages.length === 0 ? (
              <div className="no-messages">
                {messages.length === 0
                  ? 'No messages captured yet'
                  : 'No messages match filters'}
              </div>
            ) : (
              filteredMessages.map((msg) => {
            const isExpanded = expandedIds.has(msg.id);
            const payload = msg.payload as any;
            const textContent = payload?.text && typeof payload.text === 'string' ? payload.text : '';

            // Detect tool events from 'event' type
            const isToolStartEvent = msg.type === 'event' && payload?.type === 'tool_start';
            const isToolResultEvent = msg.type === 'event' && payload?.type === 'tool_result';

            // Detect tool info from 'output' type (text-based tool messages)
            const isToolOutputMessage = msg.type === 'output' && (
              textContent.startsWith('Using tool:') ||
              textContent.startsWith('Tool input:') ||
              textContent.startsWith('Tool result:')
            );
            const isUsingToolMsg = textContent.startsWith('Using tool:');
            const isToolInputMsg = textContent.startsWith('Tool input:');
            const isToolResultMsg = textContent.startsWith('Tool result:');

            // Parse tool info from text messages
            let parsedToolName = '';
            let parsedToolInput: Record<string, unknown> | null = null;
            let parsedToolResult = '';

            if (isUsingToolMsg) {
              parsedToolName = textContent.replace('Using tool:', '').trim();
            } else if (isToolInputMsg) {
              try {
                const jsonStr = textContent.replace('Tool input:', '').trim();
                parsedToolInput = JSON.parse(jsonStr);
              } catch {
                // Not valid JSON, keep as text
              }
            } else if (isToolResultMsg) {
              parsedToolResult = textContent.replace('Tool result:', '').trim();
            }

            // Combined detection
            const isToolEvent = isToolStartEvent || isToolResultEvent;
            const isTool = isToolEvent || isToolOutputMessage;
            const isToolStart = isToolStartEvent || isUsingToolMsg || isToolInputMsg;
            const isToolResult = isToolResultEvent || isToolResultMsg;

            // Get tool info from either source
            const toolName = payload?.toolName || parsedToolName;
            const toolInput = payload?.toolInput || parsedToolInput;
            const toolOutput = payload?.toolOutput || parsedToolResult;

            // Check for regular text (not tool-related)
            const hasText = textContent && !isToolOutputMessage;

            // Get event subtype for 'event' messages (init, text, step_complete, etc.)
            const eventSubtype = msg.type === 'event' ? payload?.type : null;

            // Get meaningful summary for different event types
            const getEventSummary = (): string | null => {
              if (msg.type !== 'event' || !payload) return null;

              switch (eventSubtype) {
                case 'init':
                  return payload.model ? `model: ${payload.model}` : null;
                case 'text':
                  return payload.text ? payload.text.slice(0, 50) + (payload.text.length > 50 ? '...' : '') : null;
                case 'step_complete':
                  const tokens = payload.tokens;
                  if (tokens) {
                    return `${tokens.input || 0} in / ${tokens.output || 0} out`;
                  }
                  return null;
                case 'error':
                  return payload.errorMessage?.slice(0, 40) || null;
                case 'thinking':
                  return payload.text ? `"${payload.text.slice(0, 30)}..."` : null;
                default:
                  return null;
              }
            };

            const eventSummary = getEventSummary();

            // Format tool input preview (show key fields)
            const getToolInputPreview = () => {
              if (!toolInput) return null;
              const keys = Object.keys(toolInput);
              if (keys.length === 0) return null;

              // Show important fields first
              const priorityKeys = ['file_path', 'path', 'pattern', 'command', 'content', 'query'];
              const sortedKeys = keys.sort((a, b) => {
                const aIdx = priorityKeys.indexOf(a);
                const bIdx = priorityKeys.indexOf(b);
                if (aIdx === -1 && bIdx === -1) return 0;
                if (aIdx === -1) return 1;
                if (bIdx === -1) return -1;
                return aIdx - bIdx;
              });

              return sortedKeys.slice(0, 3).map((key) => {
                let value = toolInput[key];
                if (typeof value === 'string') {
                  // Truncate long strings
                  if (value.length > 60) {
                    value = value.slice(0, 60) + '...';
                  }
                } else if (typeof value === 'object') {
                  value = JSON.stringify(value).slice(0, 40) + '...';
                }
                return { key, value };
              });
            };

            const inputPreview = (isToolStart && toolInput) ? getToolInputPreview() : null;

            return (
              <div
                key={msg.id}
                className={`debug-message debug-message-${msg.direction} ${hasText ? 'has-text-preview' : ''} ${isTool ? 'is-tool-event' : ''} ${isToolStart ? 'tool-start' : ''} ${isToolResult ? 'tool-result' : ''}`}
              >
                <div
                  className="message-header"
                  onClick={() => toggleExpanded(msg.id)}
                >
                  <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                  <span className={`direction direction-${msg.direction}`}>
                    {msg.direction === 'sent' ? '↑ SENT' : '↓ RECEIVED'}
                  </span>
                  <span className="message-type">
                    {isTool ? (
                      <>
                        <span className="tool-icon">{isToolStart ? '🔧' : '✅'}</span>
                        {isToolStart ? 'tool_start' : 'tool_result'}
                      </>
                    ) : eventSubtype ? (
                      <>
                        <span className="event-base">{msg.type}</span>
                        <span className="event-subtype">{eventSubtype}</span>
                      </>
                    ) : (
                      msg.type
                    )}
                  </span>
                  {/* Show tool name inline in header for compact collapsed view */}
                  {isTool && toolName && (
                    <span className="tool-name-inline">{toolName}</span>
                  )}
                  {/* Show event summary for non-tool events */}
                  {!isTool && eventSummary && (
                    <span className="event-summary">{eventSummary}</span>
                  )}
                  <span className="message-time">{formatTime(msg.timestamp)}</span>
                  <span className="message-size">{formatSize(msg.size)}</span>
                  <button
                    className="copy-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyMessage(msg);
                    }}
                    title="Copy message"
                  >
                    📋
                  </button>
                </div>

                {isExpanded && (
                  <div className="message-body">
                    {/* Tool inputs when expanded */}
                    {isToolStart && (toolInput || (isToolInputMsg && !parsedToolInput)) && (
                      <div className="tool-preview">
                        {inputPreview && inputPreview.length > 0 && (
                          <div className="tool-inputs">
                            {inputPreview.map(({ key, value }) => (
                              <div key={key} className="tool-input-item">
                                <span className="tool-input-key">{key}:</span>
                                <span className="tool-input-value">{String(value)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Show raw text for Tool input messages without parsed JSON */}
                        {isToolInputMsg && !parsedToolInput && (
                          <div className="tool-raw-input">
                            {textContent.replace('Tool input:', '').trim().slice(0, 200)}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Tool result output when expanded */}
                    {isToolResult && toolOutput && (
                      <div className="tool-preview tool-result-preview">
                        <div className="tool-output-preview">
                          {typeof toolOutput === 'string'
                            ? toolOutput.slice(0, 200) + (toolOutput.length > 200 ? '...' : '')
                            : JSON.stringify(toolOutput).slice(0, 200)}
                        </div>
                      </div>
                    )}

                    {/* Text content when expanded */}
                    {hasText && !isTool && (
                      <div className="message-text-preview expanded">
                        <span className="text-content">{payload.text}</span>
                      </div>
                    )}

                    {/* Full JSON payload */}
                    <pre>
                      {highlightJson(
                        JSON.stringify(msg.payload, (key, value) => {
                          // Safeguard: ensure all values are serializable
                          if (value === undefined) return null;
                          if (typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value) && typeof value[Symbol.iterator] === 'function') {
                            // Iterator (like Set, Map) - convert to array
                            return Array.from(value as Iterable<unknown>);
                          }
                          if (typeof value === 'function') return `[Function: ${(value as Function).name || 'anonymous'}]`;
                          return value;
                        }, 2)
                      )}
                    </pre>
                  </div>
                )}
              </div>
            );
              })
            )}
          </div>
        </>
      )}

      {activeTab === 'logs' && (
        <>
          {/* Log Controls */}
          <div className="agent-debug-controls">
            <select
              value={logLevelFilter}
              onChange={(e) => setLogLevelFilter(e.target.value as typeof logLevelFilter)}
              className="filter-select"
            >
              <option value="all">All Levels</option>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
            </select>

            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>

          {/* Log Actions */}
          <div className="agent-debug-actions">
            <button onClick={clearLogs} className="action-btn clear-btn" title="Clear all logs">
              Clear Logs
            </button>
            <label className="auto-scroll-label">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              <span className="toggle-switch" />
              Auto-scroll
            </label>
          </div>

          {/* Logs */}
          <div className="agent-debug-messages agent-debug-logs" ref={logsScrollRef}>
            {filteredLogs.length === 0 ? (
              <div className="no-messages">
                {logs.length === 0
                  ? 'No logs yet. Use debugLog.info(), debugLog.warn(), etc.'
                  : 'No logs match filters'}
              </div>
            ) : (
              filteredLogs.map((log) => {
                const isExpanded: boolean = expandedLogIds.has(log.id);
                const levelInfo = getLogLevelInfo(log.level);

                return (
                  <div
                    key={log.id}
                    className={`debug-message debug-log ${levelInfo.className}`}
                  >
                    <div
                      className="message-header"
                      onClick={() => toggleLogExpanded(log.id)}
                    >
                      <span className="expand-icon">{isExpanded ? '▼' : '▶'}</span>
                      <span className="log-level-icon">{levelInfo.icon}</span>
                      <span className="log-level">{log.level.toUpperCase()}</span>
                      {log.source && <span className="log-source">[{log.source}]</span>}
                      <span className="log-message">{log.message}</span>
                      <span className="message-time">{formatTime(log.timestamp)}</span>
                    </div>

                    {isExpanded && log.data !== undefined ? (
                      <div className="message-body">
                        <pre><>{highlightJson(JSON.stringify(log.data as Record<string, unknown>, (key, value) => {
                          // Safeguard: ensure all values are serializable
                          if (value === undefined) return null;
                          if (typeof value === 'object' && value !== null && !(value instanceof Date) && !Array.isArray(value) && typeof value[Symbol.iterator] === 'function') {
                            // Iterator (like Set, Map) - convert to array
                            return Array.from(value as Iterable<unknown>);
                          }
                          if (typeof value === 'function') return `[Function: ${(value as Function).name || 'anonymous'}]`;
                          return value;
                        }, 2))}</></pre>
                      </div>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
};
