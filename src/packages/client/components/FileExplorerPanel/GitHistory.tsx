/**
 * GitHistory - Bottom panel git log viewer (GitKraken/SourceTree style)
 *
 * Horizontal table layout with commit list and inline file details.
 * Renders as a resizable bottom panel in the file explorer.
 */

import React, { memo, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { GitCommit, GitCommitFile } from './types';
import type { UseGitHistoryReturn } from './useGitHistory';
import { useGitBranches } from './useGitBranches';
import { GIT_STATUS_CONFIG } from './constants';
import { getIconForExtension } from './fileUtils';

// ============================================================================
// PROPS
// ============================================================================

interface GitHistoryProps {
  history: UseGitHistoryReturn;
  currentFolder: string | null;
  onFileSelect?: (path: string, commitHash: string) => void;
}

// ============================================================================
// DATE FORMATTING
// ============================================================================

function formatCommitDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr || '—';
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffDay < 4) {
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${diffDay}d ago`;
  }

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min}`;
}

// ============================================================================
// COMMIT TABLE ROW
// ============================================================================

interface CommitRowProps {
  commit: GitCommit;
  isSelected: boolean;
  onSelect: (commit: GitCommit) => void;
}

const CommitRow = memo(function CommitRow({ commit, isSelected, onSelect }: CommitRowProps) {
  return (
    <div
      className={`gh-row ${isSelected ? 'selected' : ''}`}
      onClick={() => onSelect(commit)}
    >
      <span className="gh-col-hash">{commit.shortHash}</span>
      <span className="gh-col-message">
        <span className="gh-subject">{commit.subject}</span>
        {commit.refs.isHead && (
          <span className="gh-badge gh-badge-head">HEAD</span>
        )}
        {commit.refs.branches.map(b => (
          <span key={b} className="gh-badge gh-badge-branch">{b}</span>
        ))}
        {commit.refs.tags.map(tag => (
          <span key={tag} className="gh-badge gh-badge-tag">{tag}</span>
        ))}
      </span>
      <span className="gh-col-author">{commit.author}</span>
      <span className="gh-col-date">{formatCommitDate(commit.date)}</span>
    </div>
  );
});

// ============================================================================
// CHANGED FILES LIST (flat, compact)
// ============================================================================

interface CommitFilesProps {
  files: GitCommitFile[];
  loading: boolean;
  selectedFilePath: string | null;
  onSelectFile?: (path: string) => void;
}

const CommitFilesList = memo(function CommitFilesList({
  files,
  loading,
  selectedFilePath,
  onSelectFile,
}: CommitFilesProps) {
  const { t } = useTranslation(['common']);

  if (loading) {
    return <div className="gh-files-loading">{t('common:status.loading')}</div>;
  }

  if (files.length === 0) {
    return <div className="gh-files-empty">No changed files</div>;
  }

  return (
    <div className="gh-files-list">
      {files.map(f => {
        const name = f.path.split('/').pop() || f.path;
        const dir = f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : '';
        const config = GIT_STATUS_CONFIG[f.status];
        const ext = name.includes('.') ? '.' + name.split('.').pop() : '';

        return (
          <div
            key={f.path}
            className={`gh-file-row ${selectedFilePath === f.path ? 'selected' : ''}`}
            onClick={() => onSelectFile?.(f.path)}
            title={f.path}
          >
            <span className="gh-file-status" style={{ color: config.color }}>{config.icon}</span>
            <img className="gh-file-icon" src={getIconForExtension(ext)} alt="" />
            <span className="gh-file-name">{name}</span>
            {dir && <span className="gh-file-dir">{dir}</span>}
          </div>
        );
      })}
    </div>
  );
});

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const GitHistory = memo(function GitHistory({
  history,
  currentFolder,
  onFileSelect,
}: GitHistoryProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const {
    commits,
    loading,
    loadingMore,
    error,
    hasMore,
    total,
    filters,
    setFilter,
    resetFilters,
    selectedCommit,
    selectCommit,
    commitFiles,
    commitFilesLoading,
    loadHistory,
    loadMore,
    authors,
    loadAuthors,
  } = history;

  const { branches, loadBranches } = useGitBranches();

  // Load on mount / folder change
  useEffect(() => {
    if (currentFolder) {
      loadHistory(currentFolder);
      loadAuthors(currentFolder);
      loadBranches(currentFolder);
    }
  }, [currentFolder, loadHistory, loadAuthors, loadBranches]);

  // Virtualizer for commit list
  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 28,
    overscan: 20,
  });

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el || loadingMore || !hasMore || !currentFolder) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      loadMore(currentFolder);
    }
  }, [loadingMore, hasMore, currentFolder, loadMore]);

  const handleFileSelect = useCallback((path: string) => {
    setSelectedFilePath(path);
    if (onFileSelect && selectedCommit) {
      onFileSelect(path, selectedCommit.hash);
    }
  }, [onFileSelect, selectedCommit]);

  const localBranches = useMemo(() =>
    branches.filter(b => !b.isRemote).map(b => b.name),
    [branches]
  );

  const hasActiveFilters = !!(filters.branch || filters.author || filters.since || filters.until || filters.searchPath || filters.search);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="gh-panel">
      {/* Compact toolbar */}
      <div className="gh-toolbar">
        <span className="gh-toolbar-title">{t('terminal:fileExplorer.gitHistory.title')}</span>
        <span className="gh-toolbar-count">
          {loading ? '...' : total > 0 ? total : commits.length}
        </span>
        <input
          type="text"
          className="gh-search-input"
          placeholder={t('terminal:fileExplorer.gitHistory.searchPlaceholder')}
          value={filters.search}
          onChange={e => setFilter('search', e.target.value)}
        />
        <button
          className={`gh-filter-toggle ${showFilters ? 'active' : ''} ${hasActiveFilters ? 'has-filters' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
          title="Filters"
        >
          ⚙
        </button>
        {hasActiveFilters && (
          <button className="gh-reset-btn" onClick={resetFilters}>
            {t('terminal:fileExplorer.gitHistory.resetFilters')}
          </button>
        )}
      </div>

      {/* Expandable filter row */}
      {showFilters && (
        <div className="gh-filters-row">
          <select
            className="gh-filter-select"
            value={filters.branch}
            onChange={e => setFilter('branch', e.target.value)}
          >
            <option value="">{t('terminal:fileExplorer.gitHistory.allBranches')}</option>
            {localBranches.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
          <select
            className="gh-filter-select"
            value={filters.author}
            onChange={e => setFilter('author', e.target.value)}
          >
            <option value="">{t('terminal:fileExplorer.gitHistory.allAuthors')}</option>
            {authors.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <input
            type="date"
            className="gh-filter-input gh-date-input"
            value={filters.since}
            onChange={e => setFilter('since', e.target.value)}
            title={t('terminal:fileExplorer.gitHistory.since')}
          />
          <input
            type="date"
            className="gh-filter-input gh-date-input"
            value={filters.until}
            onChange={e => setFilter('until', e.target.value)}
            title={t('terminal:fileExplorer.gitHistory.until')}
          />
          <input
            type="text"
            className="gh-filter-input"
            placeholder={t('terminal:fileExplorer.gitHistory.pathFilter')}
            value={filters.searchPath}
            onChange={e => setFilter('searchPath', e.target.value)}
          />
        </div>
      )}

      {/* Main content area */}
      <div className="gh-body">
        {/* Commit table */}
        <div className="gh-commits-section">
          {/* Table header */}
          <div className="gh-header-row">
            <span className="gh-col-hash">Hash</span>
            <span className="gh-col-message">Message</span>
            <span className="gh-col-author">Author</span>
            <span className="gh-col-date">Date</span>
          </div>

          {/* Commit rows */}
          {loading && commits.length === 0 ? (
            <div className="gh-state-msg">{t('common:status.loading')}</div>
          ) : error ? (
            <div className="gh-state-msg gh-error">{error}</div>
          ) : commits.length === 0 ? (
            <div className="gh-state-msg">{t('terminal:fileExplorer.gitHistory.noCommits')}</div>
          ) : (
            <div
              className="gh-commit-scroll"
              ref={scrollContainerRef}
              onScroll={handleScroll}
            >
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualItems.map(virtualItem => (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <CommitRow
                      commit={commits[virtualItem.index]}
                      isSelected={selectedCommit?.hash === commits[virtualItem.index].hash}
                      onSelect={selectCommit}
                    />
                  </div>
                ))}
              </div>
              {loadingMore && (
                <div className="gh-loading-more">{t('common:status.loading')}</div>
              )}
            </div>
          )}
        </div>

        {/* Files detail panel (right side) */}
        {selectedCommit && (
          <div className="gh-files-section">
            <div className="gh-files-header">
              <span className="gh-files-title">
                {commitFiles.length} {commitFiles.length === 1 ? 'file' : 'files'}
              </span>
              <span className="gh-files-commit-info">{selectedCommit.shortHash}</span>
            </div>
            <CommitFilesList
              files={commitFiles}
              loading={commitFilesLoading}
              selectedFilePath={selectedFilePath}
              onSelectFile={handleFileSelect}
            />
          </div>
        )}
      </div>
    </div>
  );
});
