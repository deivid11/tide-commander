/**
 * PM2LogsModal - Real-time streaming log viewer for PM2-managed buildings
 *
 * Features:
 * - Real-time streaming logs from PM2
 * - Search/filter capability
 * - Line navigation (go to line)
 * - Auto-scroll toggle
 * - Line wrap toggle
 * - Clear logs button
 * - Keyboard shortcuts (/, Ctrl+G, Ctrl+End)
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { store, useStore } from '../store';
import { ansiToHtml } from '../utils/ansiToHtml';
import type { Building } from '../../shared/types';

interface PM2LogsModalProps {
  building: Building;
  isOpen: boolean;
  onClose: () => void;
}

export function PM2LogsModal({ building, isOpen, onClose }: PM2LogsModalProps) {
  const { streamingBuildingLogs, streamingBuildingIds } = useStore();
  const logs = streamingBuildingLogs.get(building.id) || '';
  const isStreaming = streamingBuildingIds.has(building.id);

  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showGoToLine, setShowGoToLine] = useState(false);
  const [goToLineValue, setGoToLineValue] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [lineWrap, setLineWrap] = useState(true);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  const logsContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const goToLineInputRef = useRef<HTMLInputElement>(null);
  const isAutoScrollingRef = useRef(false); // Track programmatic scrolls
  const lastLogsLengthRef = useRef(0); // Track logs length for auto-scroll

  // Split logs into lines
  const logLines = useMemo(() => {
    return logs.split('\n');
  }, [logs]);

  // Filter lines based on search query
  const filteredLines = useMemo(() => {
    if (!searchQuery) {
      return logLines.map((line, index) => ({ line, originalIndex: index }));
    }
    const matches: number[] = [];
    const filtered = logLines
      .map((line, index) => ({ line, originalIndex: index }))
      .filter(({ line, originalIndex }) => {
        const match = line.toLowerCase().includes(searchQuery.toLowerCase());
        if (match) {
          matches.push(originalIndex);
        }
        return match;
      });
    setSearchMatches(matches);
    return filtered;
  }, [logLines, searchQuery]);

  // Start streaming when modal opens
  useEffect(() => {
    if (isOpen && building.pm2?.enabled) {
      store.startLogStreaming(building.id, 200);
    }

    return () => {
      if (building.id) {
        store.stopLogStreaming(building.id);
      }
    };
  }, [isOpen, building.id, building.pm2?.enabled]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logsContainerRef.current && logs.length > lastLogsLengthRef.current) {
      isAutoScrollingRef.current = true;
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (logsContainerRef.current) {
          logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
        // Reset flag after a short delay to allow scroll event to fire
        setTimeout(() => {
          isAutoScrollingRef.current = false;
        }, 50);
      });
    }
    lastLogsLengthRef.current = logs.length;
  }, [logs, autoScroll]);

  // Focus search input when shown
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  // Focus go to line input when shown
  useEffect(() => {
    if (showGoToLine && goToLineInputRef.current) {
      goToLineInputRef.current.focus();
    }
  }, [showGoToLine]);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close - stop propagation to prevent closing other modals (like Guake terminal)
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (showSearch) {
          setShowSearch(false);
        } else if (showGoToLine) {
          setShowGoToLine(false);
        } else {
          onClose();
        }
        return;
      }

      // / to search (when not in input)
      if (e.key === '/' && !showSearch && !showGoToLine) {
        e.preventDefault();
        setShowSearch(true);
      }

      // Ctrl+G to go to line
      if (e.key === 'g' && e.ctrlKey) {
        e.preventDefault();
        setShowGoToLine(true);
      }

      // Ctrl+End to scroll to bottom
      if (e.key === 'End' && e.ctrlKey && logsContainerRef.current) {
        logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
      }

      // Ctrl+Home to scroll to top
      if (e.key === 'Home' && e.ctrlKey && logsContainerRef.current) {
        logsContainerRef.current.scrollTop = 0;
      }

      // F3 or Enter in search to find next
      if ((e.key === 'F3' || (e.key === 'Enter' && showSearch)) && searchMatches.length > 0) {
        e.preventDefault();
        const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
        setCurrentMatchIndex(nextIndex);
        scrollToLine(searchMatches[nextIndex]);
      }

      // Shift+F3 to find previous
      if (e.key === 'F3' && e.shiftKey && searchMatches.length > 0) {
        e.preventDefault();
        const prevIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
        setCurrentMatchIndex(prevIndex);
        scrollToLine(searchMatches[prevIndex]);
      }

      // j/k vim-style navigation (when not in input)
      if (!showSearch && !showGoToLine && logsContainerRef.current) {
        const scrollAmount = 60; // ~3 lines
        if (e.key === 'j') {
          e.preventDefault();
          logsContainerRef.current.scrollTop += scrollAmount;
          setAutoScroll(false);
        } else if (e.key === 'k') {
          e.preventDefault();
          logsContainerRef.current.scrollTop -= scrollAmount;
          setAutoScroll(false);
        } else if (e.key === 'G' && !e.ctrlKey) {
          // Shift+G to go to end (vim style)
          e.preventDefault();
          logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
          setAutoScroll(true);
        } else if (e.key === 'g' && !e.ctrlKey) {
          // gg to go to start (need to detect double g, for now just single g)
          e.preventDefault();
          logsContainerRef.current.scrollTop = 0;
          setAutoScroll(false);
        }
      }
    };

    // Use capture phase to intercept before other handlers
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen, showSearch, showGoToLine, searchMatches, currentMatchIndex, onClose]);

  // Scroll to a specific line
  const scrollToLine = useCallback((lineNumber: number) => {
    if (!logsContainerRef.current) return;
    const lineHeight = 18; // Approximate line height in pixels
    const scrollPosition = lineNumber * lineHeight;
    logsContainerRef.current.scrollTop = scrollPosition - 100; // Offset to show context
    setHighlightedLine(lineNumber);
    // Clear highlight after 2 seconds
    setTimeout(() => setHighlightedLine(null), 2000);
  }, []);

  // Handle go to line submit
  const handleGoToLine = useCallback(() => {
    const lineNum = parseInt(goToLineValue, 10);
    if (!isNaN(lineNum) && lineNum > 0 && lineNum <= logLines.length) {
      scrollToLine(lineNum - 1); // Convert to 0-indexed
      setAutoScroll(false); // Disable auto-scroll when navigating
    }
    setShowGoToLine(false);
    setGoToLineValue('');
  }, [goToLineValue, logLines.length, scrollToLine]);

  // Handle scroll to detect if user scrolled away from bottom
  const handleScroll = useCallback(() => {
    // Ignore scroll events triggered by auto-scroll
    if (isAutoScrollingRef.current) return;
    if (!logsContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

    // Only disable auto-scroll if user scrolled up (away from bottom)
    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    }
    // Re-enable auto-scroll if user scrolled back to bottom
    if (isAtBottom && !autoScroll) {
      setAutoScroll(true);
    }
  }, [autoScroll]);

  // Clear logs
  const handleClearLogs = useCallback(() => {
    store.clearStreamingLogs(building.id);
  }, [building.id]);

  // Highlight search matches in text
  const highlightSearchMatch = useCallback((html: string): string => {
    if (!searchQuery) return html;
    // Simple highlight - wrap matches with mark tag
    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return html.replace(regex, '<mark class="search-highlight">$1</mark>');
  }, [searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="pm2-logs-modal-overlay" onClick={onClose}>
      <div className="pm2-logs-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="pm2-logs-modal-header">
          <div className="header-left">
            <span className="modal-icon">&#128196;</span>
            <span className="modal-title">{building.name} - Logs</span>
            {isStreaming && (
              <span className="streaming-indicator" title="Live streaming">
                <span className="pulse"></span>
                LIVE
              </span>
            )}
          </div>
          <div className="header-right">
            <span className="line-count">{logLines.length} lines</span>
            <button className="modal-close" onClick={onClose} title="Close (Esc)">
              &times;
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="pm2-logs-modal-toolbar">
          <div className="toolbar-left">
            <button
              className={`toolbar-btn ${showSearch ? 'active' : ''}`}
              onClick={() => setShowSearch(!showSearch)}
              title="Search (/)"
            >
              &#128269; Search
            </button>
            <button
              className="toolbar-btn"
              onClick={() => setShowGoToLine(true)}
              title="Go to line (Ctrl+G)"
            >
              &#9196; Go to Line
            </button>
            <button
              className={`toolbar-btn ${lineWrap ? 'active' : ''}`}
              onClick={() => setLineWrap(!lineWrap)}
              title="Toggle line wrap"
            >
              &#8617; Wrap
            </button>
            <button
              className={`toolbar-btn ${autoScroll ? 'active' : ''}`}
              onClick={() => setAutoScroll(!autoScroll)}
              title="Auto-scroll to bottom"
            >
              &#8595; Auto
            </button>
          </div>
          <div className="toolbar-right">
            <button
              className="toolbar-btn danger"
              onClick={handleClearLogs}
              title="Clear logs"
            >
              &#128465; Clear
            </button>
          </div>
        </div>

        {/* Search Bar */}
        {showSearch && (
          <div className="pm2-logs-search-bar">
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search logs... (Enter for next, Esc to close)"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentMatchIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setShowSearch(false);
                  setSearchQuery('');
                }
              }}
            />
            {searchQuery && (
              <span className="match-count">
                {searchMatches.length > 0
                  ? `${currentMatchIndex + 1}/${searchMatches.length}`
                  : 'No matches'}
              </span>
            )}
            <button
              className="search-close"
              onClick={() => {
                setShowSearch(false);
                setSearchQuery('');
              }}
            >
              &times;
            </button>
          </div>
        )}

        {/* Go To Line Dialog */}
        {showGoToLine && (
          <div className="pm2-logs-goto-line">
            <label>Go to line:</label>
            <input
              ref={goToLineInputRef}
              type="number"
              min="1"
              max={logLines.length}
              placeholder={`1-${logLines.length}`}
              value={goToLineValue}
              onChange={(e) => setGoToLineValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleGoToLine();
                } else if (e.key === 'Escape') {
                  setShowGoToLine(false);
                  setGoToLineValue('');
                }
              }}
            />
            <button onClick={handleGoToLine}>Go</button>
            <button onClick={() => setShowGoToLine(false)}>Cancel</button>
          </div>
        )}

        {/* Logs Content */}
        <div
          ref={logsContainerRef}
          className={`pm2-logs-content ${lineWrap ? 'wrap' : 'nowrap'}`}
          onScroll={handleScroll}
        >
          {logs.length === 0 ? (
            <div className="logs-empty">
              {isStreaming ? 'Waiting for logs...' : 'No logs available'}
            </div>
          ) : (
            <div className="logs-lines">
              {(searchQuery ? filteredLines : filteredLines).map(({ line, originalIndex }) => (
                <div
                  key={originalIndex}
                  className={`log-line ${highlightedLine === originalIndex ? 'highlighted' : ''} ${
                    searchMatches[currentMatchIndex] === originalIndex ? 'current-match' : ''
                  }`}
                >
                  <span className="line-number">{originalIndex + 1}</span>
                  <span
                    className="line-content"
                    dangerouslySetInnerHTML={{
                      __html: highlightSearchMatch(ansiToHtml(line)),
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer with keyboard shortcuts */}
        <div className="pm2-logs-modal-footer">
          <span className="shortcut"><kbd>j</kbd>/<kbd>k</kbd> Scroll</span>
          <span className="shortcut"><kbd>g</kbd>/<kbd>G</kbd> Top/Bottom</span>
          <span className="shortcut"><kbd>/</kbd> Search</span>
          <span className="shortcut"><kbd>Ctrl+G</kbd> Go to line</span>
          <span className="shortcut"><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
