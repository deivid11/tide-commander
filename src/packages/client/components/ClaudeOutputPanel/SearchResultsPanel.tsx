/**
 * SearchResultsPanel - Tabbed results dropdown for the Guake terminal search.
 *
 * Renders directly under the search bar as an overlay (it does not shrink the
 * terminal). Two tabs:
 *   - Content: ranked message/output matches with highlighted snippets. Clicking
 *     a row scrolls the output to that message.
 *   - Files:   files referenced across the conversation, fuzzy-matched against
 *     the query, with per-file operation counts. Clicking a row opens the file.
 *
 * Keyboard: ↑/↓ move the selection (content rows live-preview by scrolling the
 * output); Enter opens the selected file on the Files tab. Escape is handled by
 * the search bar / pane to close search entirely.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '../Icon';
import { highlightText } from './contentRendering';
import type { ContentResult, ContentRole, FileResult } from './searchIndexing';
import type { SearchResultsTab } from './useSearchHistory';

interface SearchResultsPanelProps {
  activeTab: SearchResultsTab;
  setActiveTab: (tab: SearchResultsTab) => void;
  contentResults: ContentResult[];
  fileResults: FileResult[];
  query: string;
  loadingFullHistory?: boolean;
  onSelectContent: (itemIndex: number) => void;
  /** Open the file in the FileViewer modal. */
  onSelectFile: (file: FileResult) => void;
  /** Jump the chat to the message that references this file. */
  onGoToFileMessage: (file: FileResult) => void;
  /** Report the panel's rendered height so the output can scroll clear of it. */
  onHeightChange?: (height: number) => void;
}

const ROLE_META: Record<ContentRole, { icon: IconName; label: string }> = {
  user: { icon: 'user-circle', label: 'You' },
  assistant: { icon: 'robot', label: 'Assistant' },
  tool: { icon: 'wrench', label: 'Tool' },
  command: { icon: 'terminal', label: 'Command' },
  output: { icon: 'chat', label: 'Output' },
};

function formatRowTime(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function SearchResultsPanel({
  activeTab,
  setActiveTab,
  contentResults,
  fileResults,
  query,
  loadingFullHistory,
  onSelectContent,
  onSelectFile,
  onGoToFileMessage,
  onHeightChange,
}: SearchResultsPanelProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Report the panel height (and reset to 0 on unmount) so the output list can
  // keep the scrolled-to match clear of this overlay.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onHeightChange) return;
    const report = () => onHeightChange(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => {
      ro.disconnect();
      onHeightChange(0);
    };
  }, [onHeightChange]);

  const rowCount = activeTab === 'content' ? contentResults.length : fileResults.length;

  // Reset the highlighted row when the visible list changes.
  useEffect(() => {
    setSelected(0);
  }, [activeTab, query]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.guake-search-result-row.selected');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selected, activeTab]);

  const openRow = useCallback(
    (index: number) => {
      if (activeTab === 'content') {
        const r = contentResults[index];
        if (r) onSelectContent(r.itemIndex);
      } else {
        const f = fileResults[index];
        if (f) onSelectFile(f);
      }
    },
    [activeTab, contentResults, fileResults, onSelectContent, onSelectFile]
  );

  // Arrow navigation. Uses a capture-phase document listener so it runs while
  // the search input keeps focus. Enter is only intercepted on the Files tab
  // (Content-tab Enter stays with the input = next-match navigation).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (rowCount === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => {
          const next = Math.min(rowCount - 1, s + 1);
          if (activeTab === 'content') {
            const r = contentResults[next];
            if (r) onSelectContent(r.itemIndex);
          }
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => {
          const prev = Math.max(0, s - 1);
          if (activeTab === 'content') {
            const r = contentResults[prev];
            if (r) onSelectContent(r.itemIndex);
          }
          return prev;
        });
      } else if (e.key === 'Enter' && activeTab === 'files') {
        e.preventDefault();
        e.stopPropagation();
        const f = fileResults[selected];
        if (f) onSelectFile(f);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [activeTab, rowCount, selected, contentResults, fileResults, onSelectContent, onSelectFile]);

  return (
    <div className="guake-search-results" ref={rootRef}>
      <div className="guake-search-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={activeTab === 'content'}
          className={`guake-search-tab${activeTab === 'content' ? ' active' : ''}`}
          onClick={() => setActiveTab('content')}
        >
          <Icon name="chat" size={13} />
          {t('search.tabContent', 'Content')}
          <span className="guake-search-tab-count">{contentResults.length}</span>
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'files'}
          className={`guake-search-tab${activeTab === 'files' ? ' active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          <Icon name="file-text" size={13} />
          {t('search.tabFiles', 'Files')}
          <span className="guake-search-tab-count">{fileResults.length}</span>
        </button>
      </div>

      <div className="guake-search-results-list" ref={listRef}>
        {activeTab === 'content' ? (
          contentResults.length === 0 ? (
            <div className="guake-search-empty">
              {loadingFullHistory
                ? t('search.indexing', 'Indexing conversation…')
                : query.trim().length < 2
                  ? t('search.typeToSearch', 'Type at least 2 characters to search')
                  : t('search.noContent', 'No matching messages')}
            </div>
          ) : (
            contentResults.map((r, i) => {
              const meta = ROLE_META[r.role];
              const label = r.role === 'tool' && r.toolName ? r.toolName : meta.label;
              return (
                <button
                  key={`${r.itemIndex}-${i}`}
                  className={`guake-search-result-row${i === selected ? ' selected' : ''}`}
                  onClick={() => {
                    setSelected(i);
                    openRow(i);
                  }}
                >
                  <span className="guake-search-result-icon">
                    <Icon name={meta.icon} size={13} />
                  </span>
                  <span className="guake-search-result-body">
                    <span className="guake-search-result-meta">
                      <span className="guake-search-result-role">{label}</span>
                      {r.matchCount > 1 && (
                        <span className="guake-search-result-count">{r.matchCount}×</span>
                      )}
                      {r.timestamp && (
                        <span className="guake-search-result-time">{formatRowTime(r.timestamp)}</span>
                      )}
                    </span>
                    <span className="guake-search-result-snippet">
                      {highlightText(r.snippet, query.trim())}
                    </span>
                  </span>
                </button>
              );
            })
          )
        ) : fileResults.length === 0 ? (
          <div className="guake-search-empty">
            {loadingFullHistory
              ? t('search.indexing', 'Indexing conversation…')
              : t('search.noFiles', 'No referenced files match')}
          </div>
        ) : (
          fileResults.map((f, i) => (
            <div
              key={`${f.path}-${i}`}
              className={`guake-search-result-row file${i === selected ? ' selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              title={f.path}
            >
              <span className="guake-search-result-icon">
                <Icon name="file-text" size={13} />
              </span>
              <button
                className="guake-search-result-body file-open"
                onClick={() => {
                  setSelected(i);
                  onSelectFile(f);
                }}
                title={t('search.openFile', 'Open file in a modal')}
              >
                <span className="guake-search-file-name">{highlightText(f.basename, query.trim())}</span>
                {f.dir && <span className="guake-search-file-dir">{f.dir}</span>}
              </button>
              <span className="guake-search-file-ops">
                {f.ops.read > 0 && (
                  <span className="guake-search-file-op read" title={t('search.opRead', 'Read')}>
                    R{f.ops.read}
                  </span>
                )}
                {f.ops.edit > 0 && (
                  <span className="guake-search-file-op edit" title={t('search.opEdit', 'Edited')}>
                    E{f.ops.edit}
                  </span>
                )}
                {f.ops.write > 0 && (
                  <span className="guake-search-file-op write" title={t('search.opWrite', 'Written')}>
                    W{f.ops.write}
                  </span>
                )}
              </span>
              <span className="guake-search-file-actions">
                <button
                  className="guake-search-file-action"
                  onClick={() => {
                    setSelected(i);
                    onGoToFileMessage(f);
                  }}
                  title={t('search.goToMessage', 'Go to the message in chat')}
                >
                  <Icon name="chat" size={13} />
                </button>
                <button
                  className="guake-search-file-action"
                  onClick={() => {
                    setSelected(i);
                    onSelectFile(f);
                  }}
                  title={t('search.openFile', 'Open file in a modal')}
                >
                  <Icon name="eye" size={13} />
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
