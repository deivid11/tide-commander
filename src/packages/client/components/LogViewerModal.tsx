/**
 * LogViewerModal - Shared real-time log viewer component
 *
 * Used by PM2LogsModal and BossLogsModal. Provides:
 * - Search with regex, context lines, All/Ctx modes
 * - Keyboard navigation (/, n/N, j/k, g/G, Ctrl+G, F3)
 * - Auto-scroll, line wrap, go-to-line
 * - Match highlighting with separators in context mode
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ansiToHtml } from '../utils/ansiToHtml';
import { useModalClose } from '../hooks';

export interface LogLine {
  text: string;
  lineNumber: number;
  sourceLabel?: string;
  sourceColor?: string;
  isError?: boolean;
}

interface LogViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon: string;
  lines: LogLine[];
  isStreaming: boolean;
  onClear: () => void;
  emptyMessage?: string;
  streamingIndicatorLabel?: string;
  extraToolbar?: React.ReactNode;
  extraFooter?: React.ReactNode;
  modalClassName?: string;
}

export function LogViewerModal({
  isOpen,
  onClose,
  title,
  icon,
  lines,
  isStreaming,
  onClear,
  emptyMessage,
  streamingIndicatorLabel,
  extraToolbar,
  extraFooter,
  modalClassName,
}: LogViewerModalProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showGoToLine, setShowGoToLine] = useState(false);
  const [goToLineValue, setGoToLineValue] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [lineWrap, setLineWrap] = useState(true);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const [searchMatches, setSearchMatches] = useState<number[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [useRegex, setUseRegex] = useState(false);
  const [contextLines, setContextLines] = useState(5);
  const [regexError, setRegexError] = useState<string | null>(null);
  const [showAllLines, setShowAllLines] = useState(true);

  const logsContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const goToLineInputRef = useRef<HTMLInputElement>(null);
  const isAutoScrollingRef = useRef(false);
  const lastLinesCountRef = useRef(0);

  // Extract text for searching
  const lineTexts = useMemo(() => lines.map(l => l.text), [lines]);

  // Build search regex
  const searchRegex = useMemo(() => {
    if (!searchQuery) { setRegexError(null); return null; }
    try {
      const pattern = useRegex ? searchQuery : searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const r = new RegExp(pattern, 'gi');
      setRegexError(null);
      return r;
    } catch (e) {
      setRegexError((e as Error).message);
      return null;
    }
  }, [searchQuery, useRegex]);

  // Find matching line indices
  const matchIndices = useMemo(() => {
    if (!searchRegex) return [];
    const matches: number[] = [];
    for (let i = 0; i < lineTexts.length; i++) {
      if (searchRegex.test(lineTexts[i])) {
        matches.push(i);
      }
      searchRegex.lastIndex = 0;
    }
    return matches;
  }, [lineTexts, searchRegex]);

  // Update searchMatches state for navigation
  useEffect(() => {
    setSearchMatches(matchIndices);
    if (currentMatchIndex >= matchIndices.length) {
      setCurrentMatchIndex(Math.max(0, matchIndices.length - 1));
    }
  }, [matchIndices]);

  // Build visible lines with context (grep -C style) or show all
  const filteredEntries = useMemo(() => {
    const allEntries = lines.map((line, index) => ({ entry: line, originalIndex: index }));
    if (!searchQuery || !searchRegex) return allEntries;

    if (showAllLines) return allEntries;

    if (matchIndices.length === 0) return [];

    const visibleSet = new Set<number>();
    for (const matchIdx of matchIndices) {
      const start = Math.max(0, matchIdx - contextLines);
      const end = Math.min(lines.length - 1, matchIdx + contextLines);
      for (let i = start; i <= end; i++) {
        visibleSet.add(i);
      }
    }

    const sortedVisible = Array.from(visibleSet).sort((a, b) => a - b);

    const result: Array<{ entry: LogLine; originalIndex: number; isSeparator?: boolean }> = [];
    for (let i = 0; i < sortedVisible.length; i++) {
      const idx = sortedVisible[i];
      if (i > 0 && idx - sortedVisible[i - 1] > 1) {
        result.push({ entry: { text: '', lineNumber: -1 }, originalIndex: -1, isSeparator: true });
      }
      result.push({ entry: lines[idx], originalIndex: idx });
    }

    return result;
  }, [lines, searchQuery, searchRegex, matchIndices, contextLines, showAllLines]);

  // Auto-scroll to bottom when new lines arrive
  useEffect(() => {
    if (autoScroll && logsContainerRef.current && lines.length > lastLinesCountRef.current) {
      isAutoScrollingRef.current = true;
      requestAnimationFrame(() => {
        if (logsContainerRef.current) {
          logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
        }
        setTimeout(() => {
          isAutoScrollingRef.current = false;
        }, 50);
      });
    }
    lastLinesCountRef.current = lines.length;
  }, [lines.length, autoScroll]);

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

  // Scroll to a specific line
  const scrollToLine = useCallback((lineIndex: number) => {
    if (!logsContainerRef.current) return;
    const lineHeight = 18;
    const scrollPosition = lineIndex * lineHeight;
    logsContainerRef.current.scrollTop = scrollPosition - 100;
    setHighlightedLine(lineIndex);
    setTimeout(() => setHighlightedLine(null), 2000);
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
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

      if (e.key === '/' && !showSearch && !showGoToLine) {
        e.preventDefault();
        setShowSearch(true);
      }

      if (e.key === 'g' && e.ctrlKey) {
        e.preventDefault();
        setShowGoToLine(true);
      }

      if (e.key === 'End' && e.ctrlKey && logsContainerRef.current) {
        logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
      }

      if (e.key === 'Home' && e.ctrlKey && logsContainerRef.current) {
        logsContainerRef.current.scrollTop = 0;
      }

      if ((e.key === 'F3' || (e.key === 'Enter' && showSearch)) && searchMatches.length > 0) {
        e.preventDefault();
        if (e.shiftKey) {
          const prevIndex = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
          setCurrentMatchIndex(prevIndex);
          scrollToLine(searchMatches[prevIndex]);
        } else {
          const nextIndex = (currentMatchIndex + 1) % searchMatches.length;
          setCurrentMatchIndex(nextIndex);
          scrollToLine(searchMatches[nextIndex]);
        }
      }

      // n/N vim-style search navigation (when not in input)
      if (!showSearch && !showGoToLine && searchMatches.length > 0) {
        if (e.key === 'n' && !e.ctrlKey) {
          e.preventDefault();
          const next = (currentMatchIndex + 1) % searchMatches.length;
          setCurrentMatchIndex(next);
          scrollToLine(searchMatches[next]);
        } else if (e.key === 'N') {
          e.preventDefault();
          const prev = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
          setCurrentMatchIndex(prev);
          scrollToLine(searchMatches[prev]);
        }
      }

      // j/k vim-style navigation (when not in input)
      if (!showSearch && !showGoToLine && logsContainerRef.current) {
        const scrollAmount = 60;
        if (e.key === 'j') {
          e.preventDefault();
          logsContainerRef.current.scrollTop += scrollAmount;
          setAutoScroll(false);
        } else if (e.key === 'k') {
          e.preventDefault();
          logsContainerRef.current.scrollTop -= scrollAmount;
          setAutoScroll(false);
        } else if (e.key === 'G' && !e.ctrlKey) {
          e.preventDefault();
          logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
          setAutoScroll(true);
        } else if (e.key === 'g' && !e.ctrlKey) {
          e.preventDefault();
          logsContainerRef.current.scrollTop = 0;
          setAutoScroll(false);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isOpen, showSearch, showGoToLine, searchMatches, currentMatchIndex, onClose, scrollToLine]);

  // Handle go to line submit
  const handleGoToLine = useCallback(() => {
    const lineNum = parseInt(goToLineValue, 10);
    if (!isNaN(lineNum) && lineNum > 0 && lineNum <= lines.length) {
      scrollToLine(lineNum - 1);
      setAutoScroll(false);
    }
    setShowGoToLine(false);
    setGoToLineValue('');
  }, [goToLineValue, lines.length, scrollToLine]);

  // Handle scroll to detect if user scrolled away from bottom
  const handleScroll = useCallback(() => {
    if (isAutoScrollingRef.current) return;
    if (!logsContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    }
    if (isAtBottom && !autoScroll) {
      setAutoScroll(true);
    }
  }, [autoScroll]);

  // Highlight search matches in text
  const highlightSearchMatch = useCallback((html: string): string => {
    if (!searchQuery || !searchRegex) return html;
    const pattern = useRegex ? searchQuery : searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      const regex = new RegExp(`(${pattern})`, 'gi');
      return html.replace(regex, '<mark class="search-highlight">$1</mark>');
    } catch {
      return html;
    }
  }, [searchQuery, searchRegex, useRegex]);

  const { handleMouseDown: handleBackdropMouseDown, handleClick: handleBackdropClick } = useModalClose(onClose);

  if (!isOpen) return null;

  return (
    <div className="pm2-logs-modal-overlay" onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick}>
      <div className={`pm2-logs-modal ${modalClassName || ''}`}>
        {/* Header */}
        <div className="pm2-logs-modal-header">
          <div className="header-left">
            <span className="modal-icon">{icon}</span>
            <span className="modal-title">{title}</span>
            {isStreaming && (
              <span className="streaming-indicator" title="Live streaming">
                <span className="pulse"></span>
                {streamingIndicatorLabel || t('terminal:logs.live')}
              </span>
            )}
          </div>
          <div className="header-right">
            <span className="line-count">{t('terminal:logs.lines', { count: lines.length })}</span>
            <button className="modal-close" onClick={onClose} title={t('terminal:logs.closeEsc')}>
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
              title={t('terminal:logs.searchShortcut')}
            >
              &#128269; {t('terminal:logs.search')}
            </button>
            <button
              className="toolbar-btn"
              onClick={() => setShowGoToLine(true)}
              title={t('terminal:logs.goToLineShortcut')}
            >
              &#9196; {t('terminal:logs.goToLine')}
            </button>
            {extraToolbar}
            <button
              className={`toolbar-btn ${lineWrap ? 'active' : ''}`}
              onClick={() => setLineWrap(!lineWrap)}
              title={t('terminal:logs.toggleWrap')}
            >
              &#8617; {t('terminal:logs.wrap')}
            </button>
            <button
              className={`toolbar-btn ${autoScroll ? 'active' : ''}`}
              onClick={() => setAutoScroll(!autoScroll)}
              title={t('terminal:logs.autoScrollToBottom')}
            >
              &#8595; {t('terminal:logs.auto')}
            </button>
          </div>
          <div className="toolbar-right">
            <button
              className="toolbar-btn danger"
              onClick={onClear}
              title={t('terminal:logs.clear')}
            >
              &#128465; {t('terminal:logs.clear')}
            </button>
          </div>
        </div>

        {/* Search Bar */}
        {showSearch && (
          <div className="pm2-logs-search-bar">
            <input
              ref={searchInputRef}
              type="text"
              placeholder={useRegex ? t('terminal:logs.regexPlaceholder') : t('terminal:logs.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentMatchIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setShowSearch(false);
                  setSearchQuery('');
                  setRegexError(null);
                }
              }}
            />
            <button
              className={`toolbar-btn small ${useRegex ? 'active' : ''}`}
              onClick={() => setUseRegex(!useRegex)}
              title="Toggle regex mode"
            >
              .*
            </button>
            <button
              className={`toolbar-btn small ${showAllLines ? 'active' : ''}`}
              onClick={() => setShowAllLines(!showAllLines)}
              title={showAllLines ? "Show all lines (highlight matches)" : "Show only context around matches"}
            >
              {showAllLines ? 'All' : 'Ctx'}
            </button>
            <div className={`context-control ${showAllLines ? 'hidden' : ''}`} title="Lines of context around matches">
              <label>&#177;</label>
              <input
                type="number"
                min="0"
                max="100"
                value={contextLines}
                onChange={(e) => setContextLines(Math.max(0, parseInt(e.target.value) || 0))}
                className="context-input"
              />
            </div>
            <button
              className="toolbar-btn small"
              onClick={() => {
                if (searchMatches.length === 0) return;
                const prev = (currentMatchIndex - 1 + searchMatches.length) % searchMatches.length;
                setCurrentMatchIndex(prev);
                scrollToLine(searchMatches[prev]);
              }}
              disabled={searchMatches.length === 0}
              title="Previous match (Shift+F3)"
            >
              &#9650;
            </button>
            <button
              className="toolbar-btn small"
              onClick={() => {
                if (searchMatches.length === 0) return;
                const next = (currentMatchIndex + 1) % searchMatches.length;
                setCurrentMatchIndex(next);
                scrollToLine(searchMatches[next]);
              }}
              disabled={searchMatches.length === 0}
              title="Next match (F3)"
            >
              &#9660;
            </button>
            {searchQuery && (
              <span className="match-count">
                {regexError
                  ? <span className="regex-error" title={regexError}>{t('terminal:logs.invalidRegex')}</span>
                  : searchMatches.length > 0
                    ? `${currentMatchIndex + 1}/${searchMatches.length}`
                    : t('terminal:logs.noMatches')}
              </span>
            )}
            <button
              className="search-close"
              onClick={() => {
                setShowSearch(false);
                setSearchQuery('');
                setRegexError(null);
              }}
            >
              &times;
            </button>
          </div>
        )}

        {/* Go To Line Dialog */}
        {showGoToLine && (
          <div className="pm2-logs-goto-line">
            <label>{t('terminal:logs.goToLineLabel')}:</label>
            <input
              ref={goToLineInputRef}
              type="number"
              min="1"
              max={lines.length}
              placeholder={`1-${lines.length}`}
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
            <button onClick={handleGoToLine}>{t('terminal:logs.go')}</button>
            <button onClick={() => setShowGoToLine(false)}>{t('common:buttons.cancel')}</button>
          </div>
        )}

        {/* Logs Content */}
        <div
          ref={logsContainerRef}
          className={`pm2-logs-content ${lineWrap ? 'wrap' : 'nowrap'}`}
          onScroll={handleScroll}
        >
          {lines.length === 0 ? (
            <div className="logs-empty">
              {emptyMessage || (isStreaming ? t('terminal:logs.waitingForLogs') : t('terminal:logs.noLogs'))}
            </div>
          ) : (
            <div className="logs-lines">
              {filteredEntries.map((item, idx) => {
                if ('isSeparator' in item && item.isSeparator) {
                  return (
                    <div key={`sep-${idx}`} className="log-separator">
                      <span className="separator-line"></span>
                      <span className="separator-label">&#8230;</span>
                      <span className="separator-line"></span>
                    </div>
                  );
                }
                const { entry, originalIndex } = item;
                const isMatch = searchQuery && matchIndices.includes(originalIndex);
                return (
                  <div
                    key={originalIndex}
                    className={`log-line ${highlightedLine === originalIndex ? 'highlighted' : ''} ${
                      searchMatches[currentMatchIndex] === originalIndex ? 'current-match' : ''
                    } ${isMatch ? 'match-line' : ''} ${entry.isError ? 'error-line' : ''}`}
                  >
                    <span className="line-number">{entry.lineNumber}</span>
                    {entry.sourceLabel && (
                      <span
                        className="boss-log-source"
                        style={{ color: entry.sourceColor }}
                      >
                        [{entry.sourceLabel}]
                      </span>
                    )}
                    <span
                      className="line-content"
                      dangerouslySetInnerHTML={{
                        __html: highlightSearchMatch(ansiToHtml(entry.text)),
                      }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with keyboard shortcuts */}
        <div className="pm2-logs-modal-footer">
          <span className="shortcut"><kbd>j</kbd>/<kbd>k</kbd> Scroll</span>
          <span className="shortcut"><kbd>g</kbd>/<kbd>G</kbd> Top/Bottom</span>
          <span className="shortcut"><kbd>/</kbd> Search</span>
          <span className="shortcut"><kbd>n</kbd>/<kbd>N</kbd> Next/Prev match</span>
          <span className="shortcut"><kbd>Ctrl+G</kbd> Go to line</span>
          <span className="shortcut"><kbd>Esc</kbd> Close</span>
          {extraFooter}
        </div>
      </div>
    </div>
  );
}
