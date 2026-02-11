/**
 * GitChanges - Git status panel component
 *
 * Displays git status with modified, added, deleted, and untracked files.
 * Supports two view modes: flat list (grouped by status) and directory tree.
 */

import React, { memo, useState, useMemo, useEffect, useCallback } from 'react';
import type { GitChangesProps, GitFileStatusType, GitFileStatus } from './types';
import { GIT_STATUS_CONFIG } from './constants';
import { buildGitTree, collectGitTreeDirPaths, getIconForExtension } from './fileUtils';
import type { GitTreeNode } from './fileUtils';

type GitViewMode = 'flat' | 'tree';

// ============================================================================
// GIT FILE ITEM (used in both flat and tree modes)
// ============================================================================

interface GitFileItemProps {
  file: GitFileStatus;
  isSelected: boolean;
  onSelect: (path: string, status: GitFileStatusType) => void;
  status: GitFileStatusType;
  onStage?: (path: string) => void;
  isStaging?: boolean;
  showDirPath?: boolean;
}

const GitFileItem = memo(function GitFileItem({
  file,
  isSelected,
  onSelect,
  status,
  onStage,
  isStaging,
  showDirPath,
}: GitFileItemProps) {
  const config = GIT_STATUS_CONFIG[status];
  const isDeleted = status === 'deleted';
  const showStageBtn = status === 'untracked' && onStage;
  const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
  const dirPath = showDirPath && file.path.includes('/')
    ? file.path.slice(0, file.path.lastIndexOf('/'))
    : '';

  return (
    <div
      className={`git-file-item ${isSelected ? 'selected' : ''}`}
      onClick={() => !isDeleted && onSelect(file.path, status)}
      style={{ cursor: isDeleted ? 'not-allowed' : 'pointer' }}
      title={file.path}
    >
      <span className="tree-arrow-spacer" />
      <img className="tree-icon" src={getIconForExtension(ext)} alt="file" />
      <span className="git-file-name">
        {file.name}
        {dirPath && <span className="git-file-dir">{dirPath}</span>}
      </span>
      <span className="git-file-status" style={{ color: config.color }}>
        {config.icon}
      </span>
      {file.oldPath && (
        <span className="git-file-renamed">
          ← {file.oldPath.split('/').pop()}
        </span>
      )}
      {showStageBtn && (
        <button
          className={`git-stage-btn ${isStaging ? 'staging' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            if (!isStaging) onStage(file.path);
          }}
          title="Stage file (git add)"
          disabled={isStaging}
        >
          {isStaging ? '...' : '+'}
        </button>
      )}
    </div>
  );
});

// ============================================================================
// GIT TREE NODE ITEM (recursive directory/file renderer for tree mode)
// ============================================================================

interface GitTreeNodeItemProps {
  node: GitTreeNode;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  selectedPath: string | null;
  onSelect: (path: string, status: GitFileStatusType) => void;
  status: GitFileStatusType;
  onStage?: (path: string) => void;
  stagingPaths?: Set<string>;
}

const GIT_TREE_INDENT = 16; // px per depth level

const GitTreeNodeItem = memo(function GitTreeNodeItem({
  node,
  depth,
  expandedDirs,
  onToggleDir,
  selectedPath,
  onSelect,
  status,
  onStage,
  stagingPaths,
}: GitTreeNodeItemProps) {
  const indent = depth * GIT_TREE_INDENT;

  if (!node.isDirectory) {
    return (
      <div
        className={`git-file-item ${selectedPath === node.path ? 'selected' : ''}`}
        onClick={() => status !== 'deleted' && onSelect(node.file!.path, status)}
        style={{ paddingLeft: `${indent + 4}px`, cursor: status === 'deleted' ? 'not-allowed' : 'pointer' }}
        title={node.file!.path}
      >
        <span className="tree-arrow-spacer" />
        <img className="tree-icon" src={getIconForExtension(node.file!.name.includes('.') ? '.' + node.file!.name.split('.').pop() : '')} alt="file" />
        <span className="git-file-name">{node.file!.name}</span>
        <span className="git-file-status" style={{ color: GIT_STATUS_CONFIG[status].color }}>
          {GIT_STATUS_CONFIG[status].icon}
        </span>
        {node.file!.oldPath && (
          <span className="git-file-renamed">
            ← {node.file!.oldPath.split('/').pop()}
          </span>
        )}
        {status === 'untracked' && onStage && (
          <button
            className={`git-stage-btn ${stagingPaths?.has(node.path) ? 'staging' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!stagingPaths?.has(node.path)) onStage(node.file!.path);
            }}
            title="Stage file (git add)"
            disabled={stagingPaths?.has(node.path)}
          >
            {stagingPaths?.has(node.path) ? '...' : '+'}
          </button>
        )}
      </div>
    );
  }

  const isExpanded = expandedDirs.has(node.path);

  return (
    <div className="tree-node-wrapper">
      <div
        className={`tree-node directory ${isExpanded ? 'expanded' : ''}`}
        style={{ paddingLeft: `${indent + 4}px` }}
        onClick={() => onToggleDir(node.path)}
      >
        <span className={`tree-arrow ${isExpanded ? 'expanded' : ''}`}>▸</span>
        <img
          className="tree-folder-icon"
          src={isExpanded ? '/assets/vscode-icons/default_folder_opened.svg' : '/assets/vscode-icons/default_folder.svg'}
          alt="folder"
        />
        <span className="tree-name">{node.name}</span>
        <span className="git-tree-file-count">
          {node.fileCount} {node.fileCount === 1 ? 'file' : 'files'}
        </span>
      </div>
      {isExpanded && (
        <div className="tree-children">
          {node.children.map((child) => (
            <GitTreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              selectedPath={selectedPath}
              onSelect={onSelect}
              status={status}
              onStage={onStage}
              stagingPaths={stagingPaths}
            />
          ))}
        </div>
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
  treeNodes: GitTreeNode[];
  viewMode: GitViewMode;
  selectedPath: string | null;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onFileSelect: (path: string, status: GitFileStatusType) => void;
  onStageFile?: (path: string) => void;
  onStageAll?: () => void;
  stagingPaths?: Set<string>;
}

const GitStatusGroup = memo(function GitStatusGroup({
  status,
  files,
  treeNodes,
  viewMode,
  selectedPath,
  expandedDirs,
  onToggleDir,
  onFileSelect,
  onStageFile,
  onStageAll,
  stagingPaths,
}: GitStatusGroupProps) {
  if (files.length === 0) return null;

  const config = GIT_STATUS_CONFIG[status];
  const showStageAll = status === 'untracked' && onStageAll && files.length > 0;
  const isStagingAll = stagingPaths ? files.every(f => stagingPaths.has(f.path)) : false;

  return (
    <div className="git-status-group">
      <div className="git-status-group-header" style={{ color: config.color }}>
        <span className="git-status-badge" style={{ background: config.color }}>
          {config.icon}
        </span>
        {config.label} ({files.length})
        {showStageAll && (
          <button
            className={`git-stage-all-btn ${isStagingAll ? 'staging' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (!isStagingAll) onStageAll();
            }}
            title="Stage all untracked files"
            disabled={isStagingAll}
          >
            {isStagingAll ? '...' : 'Stage All'}
          </button>
        )}
      </div>

      {viewMode === 'tree' ? (
        <div className="git-tree-content">
          {treeNodes.map((node) => (
            <GitTreeNodeItem
              key={node.path}
              node={node}
              depth={0}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              selectedPath={selectedPath}
              onSelect={onFileSelect}
              status={status}
              onStage={status === 'untracked' ? onStageFile : undefined}
              stagingPaths={status === 'untracked' ? stagingPaths : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="git-flat-content">
          {files.map((file) => (
            <GitFileItem
              key={file.path}
              file={file}
              isSelected={selectedPath === file.path}
              onSelect={onFileSelect}
              status={status}
              onStage={status === 'untracked' ? onStageFile : undefined}
              isStaging={stagingPaths?.has(file.path)}
              showDirPath
            />
          ))}
        </div>
      )}
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
  onStageFiles,
  stagingPaths,
}: GitChangesProps) {
  const [gitViewMode, setGitViewMode] = useState<GitViewMode>('tree');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const toggleDir = useCallback((dirPath: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  // Build trees for each status group
  const { groupedTrees, grouped, allDirPaths } = useMemo(() => {
    if (!gitStatus || !gitStatus.isGitRepo || gitStatus.files.length === 0) {
      return {
        groupedTrees: {} as Record<GitFileStatusType, GitTreeNode[]>,
        grouped: {} as Record<GitFileStatusType, GitFileStatus[]>,
        allDirPaths: new Set<string>(),
      };
    }

    const statuses: GitFileStatusType[] = ['modified', 'added', 'deleted', 'renamed', 'untracked'];
    const grp: Record<string, GitFileStatus[]> = {};
    const trees: Record<string, GitTreeNode[]> = {};
    const dirs = new Set<string>();

    for (const s of statuses) {
      const files = gitStatus.files.filter(f => f.status === s);
      grp[s] = files;
      trees[s] = buildGitTree(files);
      collectGitTreeDirPaths(trees[s], dirs);
    }

    return {
      groupedTrees: trees as Record<GitFileStatusType, GitTreeNode[]>,
      grouped: grp as Record<GitFileStatusType, GitFileStatus[]>,
      allDirPaths: dirs,
    };
  }, [gitStatus]);

  // Auto-expand all directories when git status changes
  useEffect(() => {
    setExpandedDirs(allDirPaths);
  }, [allDirPaths]);

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

  const handleStageFile = (filePath: string) => {
    onStageFiles([filePath]);
  };

  const handleStageAllUntracked = () => {
    const untrackedPaths = (grouped.untracked || []).map(f => f.path);
    if (untrackedPaths.length > 0) {
      onStageFiles(untrackedPaths);
    }
  };

  return (
    <div className="git-changes">
      {/* Compact header: branch + counts + view toggle + refresh */}
      <div className="git-changes-header">
        <span className="git-branch">
          <span className="git-branch-icon">⎇</span>
          {gitStatus.branch}
        </span>
        {gitStatus.counts && (
          <div className="git-changes-summary">
            {gitStatus.counts.modified > 0 && (
              <span className="git-count modified">{gitStatus.counts.modified}M</span>
            )}
            {gitStatus.counts.added > 0 && (
              <span className="git-count added">{gitStatus.counts.added}A</span>
            )}
            {gitStatus.counts.deleted > 0 && (
              <span className="git-count deleted">{gitStatus.counts.deleted}D</span>
            )}
            {gitStatus.counts.untracked > 0 && (
              <span className="git-count untracked">{gitStatus.counts.untracked}?</span>
            )}
          </div>
        )}
        <div className="git-view-toggle">
          <button
            className={`git-view-toggle-btn ${gitViewMode === 'flat' ? 'active' : ''}`}
            onClick={() => setGitViewMode('flat')}
            title="Flat list"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="3" width="12" height="1.5" rx="0.5" />
              <rect x="2" y="7" width="12" height="1.5" rx="0.5" />
              <rect x="2" y="11" width="12" height="1.5" rx="0.5" />
            </svg>
          </button>
          <button
            className={`git-view-toggle-btn ${gitViewMode === 'tree' ? 'active' : ''}`}
            onClick={() => setGitViewMode('tree')}
            title="Directory tree"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="2" width="6" height="1.5" rx="0.5" />
              <rect x="4" y="5.5" width="8" height="1.5" rx="0.5" />
              <rect x="4" y="9" width="8" height="1.5" rx="0.5" />
              <rect x="7" y="12.5" width="7" height="1.5" rx="0.5" />
            </svg>
          </button>
        </div>
        <button
          className="git-refresh-btn"
          onClick={onRefresh}
          title="Refresh"
        >
          ↻
        </button>
      </div>

      {/* File list grouped by status */}
      <div className="git-changes-list">
        {(['modified', 'added', 'deleted', 'renamed', 'untracked'] as const).map(
          (status) => (
            <GitStatusGroup
              key={status}
              status={status}
              files={grouped[status] || []}
              treeNodes={groupedTrees[status] || []}
              viewMode={gitViewMode}
              selectedPath={selectedPath}
              expandedDirs={expandedDirs}
              onToggleDir={toggleDir}
              onFileSelect={onFileSelect}
              onStageFile={status === 'untracked' ? handleStageFile : undefined}
              onStageAll={status === 'untracked' ? handleStageAllUntracked : undefined}
              stagingPaths={status === 'untracked' ? stagingPaths : undefined}
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
  if (prev.stagingPaths !== next.stagingPaths) return false;

  // Compare git status
  if (prev.gitStatus === null && next.gitStatus === null) return true;
  if (prev.gitStatus === null || next.gitStatus === null) return false;
  if (prev.gitStatus.isGitRepo !== next.gitStatus.isGitRepo) return false;
  if (prev.gitStatus.branch !== next.gitStatus.branch) return false;
  if (prev.gitStatus.files.length !== next.gitStatus.files.length) return false;

  return true;
});

GitChanges.displayName = 'GitChanges';
