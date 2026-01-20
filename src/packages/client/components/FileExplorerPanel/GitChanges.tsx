/**
 * GitChanges - Git status panel component
 *
 * Displays git status with modified, added, deleted, and untracked files.
 * Following ClaudeOutputPanel's component decomposition pattern.
 */

import React, { memo } from 'react';
import type { GitChangesProps, GitFileStatusType, GitFileStatus } from './types';
import { GIT_STATUS_CONFIG } from './constants';

// ============================================================================
// GIT FILE ITEM
// ============================================================================

interface GitFileItemProps {
  file: GitFileStatus;
  isSelected: boolean;
  onSelect: (path: string, status: GitFileStatusType) => void;
}

const GitFileItem = memo(function GitFileItem({
  file,
  isSelected,
  onSelect,
}: GitFileItemProps) {
  const config = GIT_STATUS_CONFIG[file.status];
  const isDeleted = file.status === 'deleted';

  return (
    <div
      className={`git-file-item ${isSelected ? 'selected' : ''}`}
      onClick={() => !isDeleted && onSelect(file.path, file.status)}
      style={{ cursor: isDeleted ? 'not-allowed' : 'pointer' }}
    >
      <span className="git-file-status" style={{ color: config.color }}>
        {config.icon}
      </span>
      <span className="git-file-name">{file.name}</span>
      {file.oldPath && (
        <span className="git-file-renamed">
          ← {file.oldPath.split('/').pop()}
        </span>
      )}
    </div>
  );
});

// ============================================================================
// GIT STATUS GROUP
// ============================================================================

interface GitStatusGroupProps {
  status: GitFileStatusType;
  files: GitFileStatus[];
  selectedPath: string | null;
  onFileSelect: (path: string, status: GitFileStatusType) => void;
}

const GitStatusGroup = memo(function GitStatusGroup({
  status,
  files,
  selectedPath,
  onFileSelect,
}: GitStatusGroupProps) {
  if (files.length === 0) return null;

  const config = GIT_STATUS_CONFIG[status];

  return (
    <div className="git-status-group">
      <div className="git-status-group-header" style={{ color: config.color }}>
        <span className="git-status-badge" style={{ background: config.color }}>
          {config.icon}
        </span>
        {config.label} ({files.length})
      </div>
      {files.map((file) => (
        <GitFileItem
          key={file.path}
          file={file}
          isSelected={selectedPath === file.path}
          onSelect={onFileSelect}
        />
      ))}
    </div>
  );
});

// ============================================================================
// GIT CHANGES COMPONENT
// ============================================================================

function GitChangesComponent({
  gitStatus,
  loading,
  onFileSelect,
  selectedPath,
  onRefresh,
}: GitChangesProps) {
  // Loading state
  if (loading) {
    return <div className="git-changes-loading">Loading git status...</div>;
  }

  // Not a git repo
  if (!gitStatus || !gitStatus.isGitRepo) {
    return (
      <div className="git-changes-empty">
        <div className="git-empty-icon">📦</div>
        <div className="git-empty-text">Not a git repository</div>
      </div>
    );
  }

  // Clean working tree
  if (gitStatus.files.length === 0) {
    return (
      <div className="git-changes-empty">
        <div className="git-empty-icon">✨</div>
        <div className="git-empty-text">Working tree clean</div>
        <div className="git-empty-branch">On branch {gitStatus.branch}</div>
      </div>
    );
  }

  // Group files by status
  const grouped: Record<GitFileStatusType, GitFileStatus[]> = {
    modified: gitStatus.files.filter((f) => f.status === 'modified'),
    added: gitStatus.files.filter((f) => f.status === 'added'),
    deleted: gitStatus.files.filter((f) => f.status === 'deleted'),
    renamed: gitStatus.files.filter((f) => f.status === 'renamed'),
    untracked: gitStatus.files.filter((f) => f.status === 'untracked'),
  };

  return (
    <div className="git-changes">
      {/* Header with branch and refresh */}
      <div className="git-changes-header">
        <span className="git-branch">
          <span className="git-branch-icon">⎇</span>
          {gitStatus.branch}
        </span>
        <button
          className="git-refresh-btn"
          onClick={onRefresh}
          title="Refresh"
        >
          ↻
        </button>
      </div>

      {/* Summary counts */}
      <div className="git-changes-summary">
        {gitStatus.counts && (
          <>
            {gitStatus.counts.modified > 0 && (
              <span className="git-count modified">
                {gitStatus.counts.modified} modified
              </span>
            )}
            {gitStatus.counts.added > 0 && (
              <span className="git-count added">
                {gitStatus.counts.added} added
              </span>
            )}
            {gitStatus.counts.deleted > 0 && (
              <span className="git-count deleted">
                {gitStatus.counts.deleted} deleted
              </span>
            )}
            {gitStatus.counts.untracked > 0 && (
              <span className="git-count untracked">
                {gitStatus.counts.untracked} untracked
              </span>
            )}
          </>
        )}
      </div>

      {/* File list grouped by status */}
      <div className="git-changes-list">
        {(['modified', 'added', 'deleted', 'renamed', 'untracked'] as const).map(
          (status) => (
            <GitStatusGroup
              key={status}
              status={status}
              files={grouped[status]}
              selectedPath={selectedPath}
              onFileSelect={onFileSelect}
            />
          )
        )}
      </div>
    </div>
  );
}

/**
 * Memoized GitChanges component
 */
export const GitChanges = memo(GitChangesComponent, (prev, next) => {
  if (prev.loading !== next.loading) return false;
  if (prev.selectedPath !== next.selectedPath) return false;

  // Compare git status
  if (prev.gitStatus === null && next.gitStatus === null) return true;
  if (prev.gitStatus === null || next.gitStatus === null) return false;
  if (prev.gitStatus.isGitRepo !== next.gitStatus.isGitRepo) return false;
  if (prev.gitStatus.branch !== next.gitStatus.branch) return false;
  if (prev.gitStatus.files.length !== next.gitStatus.files.length) return false;

  return true;
});

GitChanges.displayName = 'GitChanges';
