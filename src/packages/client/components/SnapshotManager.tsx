/**
 * SnapshotManager - List and manage all saved snapshots
 *
 * Shows a grid/table of all snapshots with filtering and actions.
 * Can view details, delete, restore files, or export snapshots.
 */

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SnapshotListItem } from '../../shared/types/snapshot';
import { BUILT_IN_AGENT_CLASSES, type BuiltInAgentClass } from '../../shared/types';

export interface SnapshotManagerProps {
  /** List of all snapshots */
  snapshots: SnapshotListItem[];
  /** Whether snapshots are loading */
  isLoading?: boolean;
  /** Callback when user clicks to view a snapshot */
  onViewSnapshot: (snapshotId: string) => void;
  /** Callback when user wants to delete a snapshot */
  onDeleteSnapshot: (snapshotId: string) => Promise<void>;
  /** Callback when user wants to restore files from a snapshot */
  onRestoreSnapshot: (snapshotId: string) => Promise<void>;
  /** Callback when user wants to export a snapshot */
  onExportSnapshot: (snapshotId: string) => Promise<void>;
  /** Currently selected snapshot for actions */
  selectedSnapshotId?: string;
  /** Callback to close manager */
  onClose: () => void;
}

type SortField = 'createdAt' | 'title' | 'agentName';
type SortDirection = 'asc' | 'desc';

export function SnapshotManager({
  snapshots,
  isLoading = false,
  onViewSnapshot,
  onDeleteSnapshot,
  onRestoreSnapshot,
  onExportSnapshot,
  selectedSnapshotId,
  onClose,
}: SnapshotManagerProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Filter and sort snapshots
  const filteredSnapshots = useMemo(() => {
    let result = [...snapshots];

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(query) ||
          s.agentName.toLowerCase().includes(query) ||
          s.descriptionPreview?.toLowerCase().includes(query)
      );
    }

    // Sort
    result.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'createdAt':
          comparison = a.createdAt - b.createdAt;
          break;
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'agentName':
          comparison = a.agentName.localeCompare(b.agentName);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [snapshots, searchQuery, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const handleDelete = async (snapshotId: string) => {
    setActionLoading(snapshotId);
    try {
      await onDeleteSnapshot(snapshotId);
      setDeleteConfirmId(null);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestore = async (snapshotId: string) => {
    setActionLoading(snapshotId);
    try {
      await onRestoreSnapshot(snapshotId);
    } finally {
      setActionLoading(null);
    }
  };

  const handleExport = async (snapshotId: string) => {
    setActionLoading(snapshotId);
    try {
      await onExportSnapshot(snapshotId);
    } finally {
      setActionLoading(null);
    }
  };

  const getAgentClassInfo = (agentClass: string) => {
    if (agentClass in BUILT_IN_AGENT_CLASSES) {
      return BUILT_IN_AGENT_CLASSES[agentClass as BuiltInAgentClass];
    }
    return { icon: '🤖', color: '#888888', description: 'Custom agent' };
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    } else if (diffDays === 1) {
      return t('common:time.daysAgo', { count: 1 });
    } else if (diffDays < 7) {
      return t('common:time.daysAgo', { count: diffDays });
    } else {
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      });
    }
  };

  return (
    <div className="snapshot-manager">
      <div className="snapshot-manager-header">
        <div className="snapshot-manager-title">
          <span className="snapshot-manager-icon">📸</span>
          {t('terminal:snapshot.title')}
          <span className="snapshot-manager-count">{snapshots.length}</span>
        </div>
        <button className="snapshot-manager-close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      {/* Search and filters */}
      <div className="snapshot-manager-toolbar">
        <div className="snapshot-search">
          <span className="snapshot-search-icon">🔍</span>
          <input
            type="text"
            className="snapshot-search-input"
            placeholder={t('terminal:snapshot.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="snapshot-search-clear"
              onClick={() => setSearchQuery('')}
              title="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="snapshot-sort">
          <button
            className={`snapshot-sort-btn ${sortField === 'createdAt' ? 'active' : ''}`}
            onClick={() => handleSort('createdAt')}
          >
            {t('terminal:snapshot.sortDate')} {sortField === 'createdAt' && (sortDirection === 'desc' ? '↓' : '↑')}
          </button>
          <button
            className={`snapshot-sort-btn ${sortField === 'title' ? 'active' : ''}`}
            onClick={() => handleSort('title')}
          >
            {t('terminal:snapshot.sortTitle')} {sortField === 'title' && (sortDirection === 'desc' ? '↓' : '↑')}
          </button>
          <button
            className={`snapshot-sort-btn ${sortField === 'agentName' ? 'active' : ''}`}
            onClick={() => handleSort('agentName')}
          >
            {t('terminal:snapshot.sortAgent')} {sortField === 'agentName' && (sortDirection === 'desc' ? '↓' : '↑')}
          </button>
        </div>
      </div>

      {/* Snapshot list */}
      <div className="snapshot-manager-content">
        {isLoading && (
          <div className="snapshot-loading">
            <div className="snapshot-loading-spinner"></div>
            {t('terminal:snapshot.loadingSnapshots')}
          </div>
        )}

        {!isLoading && filteredSnapshots.length === 0 && (
          <div className="snapshot-empty">
            {searchQuery ? (
              <>
                <span className="snapshot-empty-icon">🔍</span>
                <span className="snapshot-empty-text">{t('terminal:snapshot.noSnapshotsMatch')}</span>
              </>
            ) : (
              <>
                <span className="snapshot-empty-icon">📸</span>
                <span className="snapshot-empty-text">{t('terminal:snapshot.noSnapshotsYet')}</span>
                <span className="snapshot-empty-hint">
                  {t('terminal:snapshot.snapshotHint')}
                </span>
              </>
            )}
          </div>
        )}

        {!isLoading && filteredSnapshots.length > 0 && (
          <div className="snapshot-grid">
            {filteredSnapshots.map((snapshot) => {
              const classInfo = getAgentClassInfo(snapshot.agentClass);
              const isSelected = snapshot.id === selectedSnapshotId;
              const isDeleting = deleteConfirmId === snapshot.id;
              const isActionLoading = actionLoading === snapshot.id;

              return (
                <div
                  key={snapshot.id}
                  className={`snapshot-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => onViewSnapshot(snapshot.id)}
                >
                  {/* Card header */}
                  <div className="snapshot-card-header">
                    <span
                      className="snapshot-card-agent-icon"
                      style={{ color: classInfo.color }}
                      title={snapshot.agentName}
                    >
                      {classInfo.icon}
                    </span>
                    <span className="snapshot-card-agent-name">{snapshot.agentName}</span>
                    <span className="snapshot-card-date">{formatDate(snapshot.createdAt)}</span>
                  </div>

                  {/* Card title */}
                  <div className="snapshot-card-title">{snapshot.title}</div>

                  {/* Card description preview */}
                  {snapshot.descriptionPreview && (
                    <div className="snapshot-card-description">{snapshot.descriptionPreview}</div>
                  )}

                  {/* Card stats */}
                  <div className="snapshot-card-stats">
                    <span className="snapshot-card-stat">
                      💬 {snapshot.outputCount}
                    </span>
                    <span className="snapshot-card-stat">
                      📄 {snapshot.fileCount}
                    </span>
                  </div>

                  {/* Card actions */}
                  <div
                    className="snapshot-card-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isDeleting ? (
                      <div className="snapshot-delete-confirm">
                        <span>{t('terminal:snapshot.deleteConfirm')}</span>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDelete(snapshot.id)}
                          disabled={isActionLoading}
                        >
                          {isActionLoading ? '...' : t('common:buttons.yes')}
                        </button>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => setDeleteConfirmId(null)}
                          disabled={isActionLoading}
                        >
                          {t('common:buttons.no')}
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          className="snapshot-action-btn"
                          onClick={() => handleRestore(snapshot.id)}
                          title={t('terminal:snapshot.restoreFiles')}
                          disabled={isActionLoading}
                        >
                          🔄
                        </button>
                        <button
                          className="snapshot-action-btn"
                          onClick={() => handleExport(snapshot.id)}
                          title={t('terminal:snapshot.exportSnapshot')}
                          disabled={isActionLoading}
                        >
                          📤
                        </button>
                        <button
                          className="snapshot-action-btn danger"
                          onClick={() => setDeleteConfirmId(snapshot.id)}
                          title={t('terminal:snapshot.deleteSnapshot')}
                          disabled={isActionLoading}
                        >
                          🗑️
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
