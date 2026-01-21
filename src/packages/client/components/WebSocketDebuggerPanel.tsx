import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { wsDebugger, type DebugMessage } from '../websocket/debugger';

interface WebSocketDebuggerPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type DirectionFilter = 'all' | 'incoming' | 'outgoing';

export function WebSocketDebuggerPanel({ isOpen, onClose }: WebSocketDebuggerPanelProps) {
  const [messages, setMessages] = useState<DebugMessage[]>([]);
  const [enabled, setEnabled] = useState(wsDebugger.isEnabled());
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  // Subscribe to debugger updates
  useEffect(() => {
    const update = () => {
      setMessages([...wsDebugger.getMessages()]);
      setEnabled(wsDebugger.isEnabled());
    };
    update();
    return wsDebugger.subscribe(update);
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, autoScroll]);

  const handleToggleEnabled = useCallback(() => {
    wsDebugger.setEnabled(!enabled);
  }, [enabled]);

  const handleClear = useCallback(() => {
    wsDebugger.clear();
  }, []);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedMessages(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedMessages(new Set(filteredMessages.map(m => m.id)));
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedMessages(new Set());
  }, []);

  // Get unique types for filter dropdown
  const uniqueTypes = useMemo(() => wsDebugger.getUniqueTypes(), [messages]);

  // Filter messages
  const filteredMessages = useMemo(() => {
    return messages.filter(msg => {
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
        const matchesPayload = JSON.stringify(msg.payload).toLowerCase().includes(query);
        if (!matchesType && !matchesPayload) {
          return false;
        }
      }
      return true;
    });
  }, [messages, directionFilter, typeFilter, searchQuery]);

  const stats = useMemo(() => wsDebugger.getStats(), [messages]);

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatPayload = (payload: unknown): string => {
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const copyAllMessages = useCallback(() => {
    const allJson = filteredMessages.map(msg => ({
      direction: msg.direction,
      type: msg.type,
      timestamp: msg.timestamp,
      payload: msg.payload,
    }));
    navigator.clipboard.writeText(JSON.stringify(allJson, null, 2));
  }, [filteredMessages]);

  if (!isOpen) return null;

  return (
    <>
      <div className="panel-overlay" onClick={onClose} />
      <div className="ws-debugger-panel side-panel">
        <div className="panel-header">
          <h3>WebSocket Debugger</h3>
          <div className="header-actions">
            <button
              className={`btn btn-sm ${enabled ? 'btn-success' : 'btn-secondary'}`}
              onClick={handleToggleEnabled}
              title={enabled ? 'Capturing messages' : 'Not capturing'}
            >
              {enabled ? '● Recording' : '○ Paused'}
            </button>
            <button className="btn btn-sm btn-secondary" onClick={handleClear} title="Clear all messages">
              Clear
            </button>
          </div>
          <button className="panel-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Stats bar */}
        <div className="debugger-stats">
          <span className="stat">
            <span className="stat-value">{stats.total}</span> total
          </span>
          <span className="stat incoming">
            <span className="stat-value">{stats.incoming}</span> in
          </span>
          <span className="stat outgoing">
            <span className="stat-value">{stats.outgoing}</span> out
          </span>
          <span className="stat">
            <span className="stat-value">{stats.types}</span> types
          </span>
        </div>

        {/* Filters */}
        <div className="debugger-filters">
          <div className="filter-row">
            <select
              className="filter-select"
              value={directionFilter}
              onChange={(e) => setDirectionFilter(e.target.value as DirectionFilter)}
            >
              <option value="all">All Directions</option>
              <option value="incoming">↓ Incoming</option>
              <option value="outgoing">↑ Outgoing</option>
            </select>

            <select
              className="filter-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">All Types</option>
              {uniqueTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>

            <input
              type="text"
              className="filter-search"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="filter-actions">
            <label className="auto-scroll-label">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              Auto-scroll
            </label>
            <button className="btn-link" onClick={expandAll}>Expand All</button>
            <button className="btn-link" onClick={collapseAll}>Collapse All</button>
            <button className="btn-link" onClick={copyAllMessages} title="Copy all filtered messages as JSON">
              Copy All
            </button>
          </div>
        </div>

        {/* Messages list */}
        <div className="debugger-messages" ref={listRef}>
          {!enabled && messages.length === 0 ? (
            <div className="empty-state">
              <p>Click "Recording" to start capturing WebSocket messages</p>
            </div>
          ) : filteredMessages.length === 0 ? (
            <div className="empty-state">
              <p>No messages match your filters</p>
            </div>
          ) : (
            filteredMessages.map(msg => {
              const isExpanded = expandedMessages.has(msg.id);
              return (
                <div
                  key={msg.id}
                  className={`message-item ${msg.direction}`}
                  onClick={() => toggleExpanded(msg.id)}
                >
                  <div className="message-header">
                    <span className={`direction-badge ${msg.direction}`}>
                      {msg.direction === 'incoming' ? '↓' : '↑'}
                    </span>
                    <span className="message-type">{msg.type}</span>
                    <span className="message-time">{formatTime(msg.timestamp)}</span>
                    <span className="message-size">{formatSize(msg.size)}</span>
                    <button
                      className="copy-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(msg.raw);
                      }}
                      title="Copy raw message"
                    >
                      📋
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="message-payload">
                      <pre>{formatPayload(msg.payload)}</pre>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="panel-footer">
          <span className="footer-info">
            Showing {filteredMessages.length} of {messages.length} messages
          </span>
        </div>
      </div>
    </>
  );
}
