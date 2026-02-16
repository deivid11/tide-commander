/**
 * BranchComparison - IntelliJ-style branch comparison component
 *
 * Shows all file differences between two branches in a unified directory tree.
 * Unlike GitChanges which groups files by status category, this shows ALL files
 * in ONE directory tree with per-file status badges.
 */

import React, { memo, useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { GitFileStatusType, GitFileStatus, GitStatusCounts } from './types';
import { GIT_STATUS_CONFIG } from './constants';
import { buildGitTree, collectGitTreeDirPaths, getIconForExtension } from './fileUtils';
import type { GitTreeNode } from './fileUtils';

// ============================================================================
// PROPS
// ============================================================================

interface BranchComparisonProps {
  compareResult: {
    files: GitFileStatus[];
    counts: GitStatusCounts;
    baseBranch: string;
    currentBranch: string;
  } | null;
  loading: boolean;
  onFileSelect: (path: string, status: GitFileStatusType) => void;
  selectedPath: string | null;
  onClose: () => void;
}

type CompareViewMode = 'flat' | 'tree';

// ============================================================================
// COMPARE TREE NODE ITEM (recursive directory/file renderer)
// ============================================================================

interface CompareTreeNodeItemProps {
  node: GitTreeNode;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  selectedPath: string | null;
  onSelect: (path: string, status: GitFileStatusType) => void;
}

const COMPARE_TREE_INDENT = 16; // px per depth level

const CompareTreeNodeItem = memo(function CompareTreeNodeItem({
  node,
  depth,
  expandedDirs,
  onToggleDir,
  selectedPath,
  onSelect,
}: CompareTreeNodeItemProps) {
  const { t } = useTranslation(['terminal']);
  const indent = depth * COMPARE_TREE_INDENT;

  // File leaf node
  if (!node.isDirectory) {
    const fileStatus = node.file!.status;
    const config = GIT_STATUS_CONFIG[fileStatus];
    const isDeleted = fileStatus === 'deleted';
    const ext = node.file!.name.includes('.') ? '.' + node.file!.name.split('.').pop() : '';

    return (
      <div
        className={`git-file-item ${selectedPath === node.path ? 'selected' : ''}`}
        onClick={() => !isDeleted && onSelect(node.file!.path, fileStatus)}
        style={{ paddingLeft: `${indent + 4}px`, cursor: isDeleted ? 'not-allowed' : 'pointer' }}
        title={node.file!.path}
      >
        <span className="tree-arrow-spacer" />
        <img className="tree-icon" src={getIconForExtension(ext)} alt="file" />
        <span className="git-file-name">{node.file!.name}</span>
        <span className="git-file-status" style={{ color: config.color }}>
          {config.icon}
        </span>
        {node.file!.oldPath && (
          <span className="git-file-renamed">
            &larr; {node.file!.oldPath.split('/').pop()}
          </span>
        )}
      </div>
    );
  }

  // Directory node
  const isExpanded = expandedDirs.has(node.path);

  return (
    <div className="tree-node-wrapper">
      <div
        className={`tree-node directory ${isExpanded ? 'expanded' : ''}`}
        style={{ paddingLeft: `${indent + 4}px` }}
        onClick={() => onToggleDir(node.path)}
      >
        <span className={`tree-arrow ${isExpanded ? 'expanded' : ''}`}>&#9658;</span>
        <img
          className="tree-folder-icon"
          src={isExpanded ? '/assets/vscode-icons/default_folder_opened.svg' : '/assets/vscode-icons/default_folder.svg'}
          alt="folder"
        />
        <span className="tree-name">{node.name}</span>
        <span className="git-tree-file-count">
          {t('terminal:fileExplorer.fileCount', { count: node.fileCount })}
        </span>
      </div>
      {isExpanded && (
        <div className="tree-children">
          {node.children.map((child) => (
            <CompareTreeNodeItem
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              selectedPath={selectedPath}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
});

// ============================================================================
// COMPARE FILE ITEM (flat view row)
// ============================================================================

interface CompareFileItemProps {
  file: GitFileStatus;
  isSelected: boolean;
  onSelect: (path: string, status: GitFileStatusType) => void;
}

const CompareFileItem = memo(function CompareFileItem({
  file,
  isSelected,
  onSelect,
}: CompareFileItemProps) {
  const config = GIT_STATUS_CONFIG[file.status];
  const isDeleted = file.status === 'deleted';
  const ext = file.name.includes('.') ? '.' + file.name.split('.').pop() : '';
  const dirPath = file.path.includes('/')
    ? file.path.slice(0, file.path.lastIndexOf('/'))
    : '';

  return (
    <div
      className={`git-file-item ${isSelected ? 'selected' : ''}`}
      onClick={() => !isDeleted && onSelect(file.path, file.status)}
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
          &larr; {file.oldPath.split('/').pop()}
        </span>
      )}
    </div>
  );
});

// ============================================================================
// BRANCH COMPARISON COMPONENT
// ============================================================================

function BranchComparisonComponent({
  compareResult,
  loading,
  onFileSelect,
  selectedPath,
  onClose,
}: BranchComparisonProps) {
  const { t } = useTranslation(['terminal']);
  const [viewMode, setViewMode] = useState<CompareViewMode>('tree');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // Build unified tree from all files
  const tree = useMemo(() => {
    if (!compareResult || compareResult.files.length === 0) return [];
    return buildGitTree(compareResult.files);
  }, [compareResult]);

  // Collect all dir paths for auto-expand
  const allDirPaths = useMemo(() => {
    const dirs = new Set<string>();
    collectGitTreeDirPaths(tree, dirs);
    return dirs;
  }, [tree]);

  // Auto-expand all directories when tree changes
  useEffect(() => {
    setExpandedDirs(allDirPaths);
  }, [allDirPaths]);

  // Toggle directory expansion
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

  // Sort flat files by path
  const sortedFiles = useMemo(() => {
    if (!compareResult) return [];
    return [...compareResult.files].sort((a, b) =>
      a.path.toLowerCase().localeCompare(b.path.toLowerCase())
    );
  }, [compareResult]);

  // Loading state
  if (loading) {
    return (
      <div className="branch-comparison">
        <div className="branch-comparison-header">
          <span className="branch-comparison-title">{t('terminal:fileExplorer.comparingBranches')}</span>
          <button className="branch-comparison-close" onClick={onClose} title={t('terminal:fileExplorer.closeComparison')}>
            &times;
          </button>
        </div>
        <div className="branch-comparison-empty">
          <div className="branch-comparison-empty-text">{t('terminal:fileExplorer.comparingBranches')}</div>
        </div>
      </div>
    );
  }

  // No result
  if (!compareResult) return null;

  const { files, counts, baseBranch, currentBranch } = compareResult;
  const totalFiles = files.length;

  // Empty diff
  if (totalFiles === 0) {
    return (
      <div className="branch-comparison">
        <div className="branch-comparison-header">
          <span className="branch-comparison-title">
            {currentBranch} vs {baseBranch}
          </span>
          <button className="branch-comparison-close" onClick={onClose} title={t('terminal:fileExplorer.closeComparison')}>
            &times;
          </button>
        </div>
        <div className="branch-comparison-empty">
          <div className="branch-comparison-empty-icon">&#10024;</div>
          <div className="branch-comparison-empty-text">{t('terminal:fileExplorer.noDifferences')}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="branch-comparison">
      {/* Header: title, file count, status counts, view toggle, close */}
      <div className="branch-comparison-header">
        <span className="branch-comparison-title">
          &#8660; {currentBranch} vs {baseBranch}
        </span>
        <span className="branch-comparison-file-count">
          {t('terminal:fileExplorer.fileCount', { count: totalFiles })}
        </span>
        <div className="git-changes-summary">
          {counts.modified > 0 && (
            <span className="git-count modified">{counts.modified}M</span>
          )}
          {counts.added > 0 && (
            <span className="git-count added">{counts.added}A</span>
          )}
          {counts.deleted > 0 && (
            <span className="git-count deleted">{counts.deleted}D</span>
          )}
          {counts.renamed > 0 && (
            <span className="git-count renamed">{counts.renamed}R</span>
          )}
          {(counts.conflict ?? 0) > 0 && (
            <span className="git-count conflict">{counts.conflict}C</span>
          )}
        </div>
        <div className="git-view-toggle">
          <button
            className={`git-view-toggle-btn ${viewMode === 'flat' ? 'active' : ''}`}
            onClick={() => setViewMode('flat')}
            title={t('terminal:fileExplorer.flatList')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <rect x="2" y="3" width="12" height="1.5" rx="0.5" />
              <rect x="2" y="7" width="12" height="1.5" rx="0.5" />
              <rect x="2" y="11" width="12" height="1.5" rx="0.5" />
            </svg>
          </button>
          <button
            className={`git-view-toggle-btn ${viewMode === 'tree' ? 'active' : ''}`}
            onClick={() => setViewMode('tree')}
            title={t('terminal:fileExplorer.directoryTree')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <rect x="1" y="2" width="6" height="1.5" rx="0.5" />
              <rect x="4" y="5.5" width="8" height="1.5" rx="0.5" />
              <rect x="4" y="9" width="8" height="1.5" rx="0.5" />
              <rect x="7" y="12.5" width="7" height="1.5" rx="0.5" />
            </svg>
          </button>
        </div>
        <button className="branch-comparison-close" onClick={onClose} title={t('terminal:fileExplorer.closeComparison')}>
          &times;
        </button>
      </div>

      {/* File list */}
      <div className="branch-comparison-list">
        {viewMode === 'tree' ? (
          tree.map((node) => (
            <CompareTreeNodeItem
              key={node.path}
              node={node}
              depth={0}
              expandedDirs={expandedDirs}
              onToggleDir={toggleDir}
              selectedPath={selectedPath}
              onSelect={onFileSelect}
            />
          ))
        ) : (
          sortedFiles.map((file) => (
            <CompareFileItem
              key={file.path}
              file={file}
              isSelected={selectedPath === file.path}
              onSelect={onFileSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Memoized BranchComparison component
 */
export const BranchComparison = memo(BranchComparisonComponent);

BranchComparison.displayName = 'BranchComparison';
