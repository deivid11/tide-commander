/**
 * GitChanges - Git status panel component
 *
 * Displays git status with modified, added, deleted, and untracked files.
 * Supports two view modes: flat list (grouped by status) and directory tree.
 */

import React, { memo, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { GitChangesProps, GitFileStatusType, GitFileStatus } from './types';
import { GIT_STATUS_CONFIG } from './constants';
import { buildGitTree, collectGitTreeDirPaths, getIconForExtension } from './fileUtils';
import type { GitTreeNode } from './fileUtils';
import { apiUrl, authFetch } from '../../utils/storage';

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
  isChecked?: boolean;
  onToggleCheck?: (path: string) => void;
}

const GitFileItem = memo(function GitFileItem({
  file,
  isSelected,
  onSelect,
  status,
  onStage,
  isStaging,
  showDirPath,
  isChecked,
  onToggleCheck,
}: GitFileItemProps) {
  const { t } = useTranslation(['terminal']);
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
      {onToggleCheck && (
        <input
          type="checkbox"
          className="git-file-checkbox"
          checked={isChecked || false}
          onChange={(e) => {
            e.stopPropagation();
            onToggleCheck(file.path);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      )}
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
          title={t('terminal:fileExplorer.stageFile')}
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
  checkedFiles?: Set<string>;
  onToggleCheck?: (path: string) => void;
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
  checkedFiles,
  onToggleCheck,
}: GitTreeNodeItemProps) {
  const { t } = useTranslation(['terminal']);
  const indent = depth * GIT_TREE_INDENT;

  if (!node.isDirectory) {
    return (
      <div
        className={`git-file-item ${selectedPath === node.path ? 'selected' : ''}`}
        onClick={() => status !== 'deleted' && onSelect(node.file!.path, status)}
        style={{ paddingLeft: `${indent + 4}px`, cursor: status === 'deleted' ? 'not-allowed' : 'pointer' }}
        title={node.file!.path}
      >
        {onToggleCheck && (
          <input
            type="checkbox"
            className="git-file-checkbox"
            checked={checkedFiles?.has(node.file!.path) || false}
            onChange={(e) => {
              e.stopPropagation();
              onToggleCheck(node.file!.path);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
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
            title={t('terminal:fileExplorer.stageFile')}
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
          src={isExpanded ? `${import.meta.env.BASE_URL}assets/vscode-icons/default_folder_opened.svg` : `${import.meta.env.BASE_URL}assets/vscode-icons/default_folder.svg`}
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
              checkedFiles={checkedFiles}
              onToggleCheck={onToggleCheck}
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
  checkedFiles?: Set<string>;
  onToggleCheck?: (path: string) => void;
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
  checkedFiles,
  onToggleCheck,
}: GitStatusGroupProps) {
  const { t } = useTranslation(['terminal']);
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
            title={t('terminal:fileExplorer.stageAllUntracked')}
            disabled={isStagingAll}
          >
            {isStagingAll ? '...' : t('terminal:fileExplorer.stageAll')}
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
              checkedFiles={checkedFiles}
              onToggleCheck={onToggleCheck}
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
              isChecked={checkedFiles?.has(file.path)}
              onToggleCheck={onToggleCheck}
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
  currentFolder,
  onCommitComplete,
  mergeInProgress,
  mergingBranch,
  onMergeContinue,
  onMergeAbort,
  onConflictOpen,
}: GitChangesProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const [gitViewMode, setGitViewMode] = useState<GitViewMode>('tree');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // Commit panel state
  const [commitMessage, setCommitMessage] = useState('');
  const [savedMessage, setSavedMessage] = useState(''); // saved user message when toggling amend
  const [isAmend, setIsAmend] = useState(false);
  const [checkedFiles, setCheckedFiles] = useState<Set<string>>(new Set());
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitStatus, setCommitStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const commitTextareaRef = useRef<HTMLTextAreaElement>(null);

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

    const statuses: GitFileStatusType[] = ['conflict', 'modified', 'added', 'deleted', 'renamed', 'untracked'];
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

  // Select all files by default when git status changes
  useEffect(() => {
    if (gitStatus?.files) {
      setCheckedFiles(new Set(gitStatus.files.map(f => f.path)));
    }
  }, [gitStatus?.files]);

  const hasConflicts = gitStatus?.files.some(f => f.status === 'conflict') ?? false;

  // Auto-clear commit status
  useEffect(() => {
    if (commitStatus) {
      const timeout = commitStatus.type === 'error' ? 8000 : 4000;
      const timer = setTimeout(() => setCommitStatus(null), timeout);
      return () => clearTimeout(timer);
    }
  }, [commitStatus]);

  // Toggle amend - fetch last commit message
  const handleAmendToggle = useCallback(async () => {
    const newAmend = !isAmend;
    setIsAmend(newAmend);
    if (newAmend && currentFolder) {
      // Save current message and fetch last commit message
      setSavedMessage(commitMessage);
      try {
        const res = await authFetch(apiUrl(`/api/files/git-log-message?path=${encodeURIComponent(currentFolder)}`));
        const data = await res.json();
        if (data.message) {
          setCommitMessage(data.message);
        }
      } catch {
        // ignore - keep current message
      }
    } else {
      // Restore saved message
      setCommitMessage(savedMessage);
    }
  }, [isAmend, currentFolder, commitMessage, savedMessage]);

  // Toggle file check
  const handleToggleCheck = useCallback((filePath: string) => {
    setCheckedFiles(prev => {
      const next = new Set(prev);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return next;
    });
  }, []);

  // Toggle all checks
  const handleToggleAllChecks = useCallback(() => {
    if (!gitStatus?.files) return;
    const allPaths = gitStatus.files.map(f => f.path);
    const allChecked = allPaths.every(p => checkedFiles.has(p));
    if (allChecked) {
      setCheckedFiles(new Set());
    } else {
      setCheckedFiles(new Set(allPaths));
    }
  }, [gitStatus?.files, checkedFiles]);

  // Commit
  const handleCommit = useCallback(async (andPush: boolean) => {
    if (!currentFolder || !commitMessage.trim() || checkedFiles.size === 0 || isCommitting) return;

    setIsCommitting(true);
    setCommitStatus(null);

    try {
      const res = await authFetch(apiUrl('/api/files/git-commit'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directory: currentFolder,
          message: commitMessage.trim(),
          amend: isAmend,
          paths: Array.from(checkedFiles),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setCommitStatus({ type: 'error', text: data.error || 'Commit failed' });
        setIsCommitting(false);
        return;
      }

      // Commit succeeded
      if (andPush) {
        // Now push
        try {
          const pushRes = await authFetch(apiUrl('/api/files/git-push'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ directory: currentFolder }),
          });
          const pushData = await pushRes.json();

          if (pushRes.ok && pushData.success) {
            setCommitStatus({ type: 'success', text: t('terminal:fileExplorer.committedAndPushed') });
          } else {
            setCommitStatus({ type: 'error', text: t('terminal:fileExplorer.committedButPushFailed', { error: pushData.error || 'Unknown error' }) });
          }
        } catch {
          setCommitStatus({ type: 'error', text: t('terminal:fileExplorer.committedButPushFailed', { error: 'Network error' }) });
        }
      } else {
        setCommitStatus({ type: 'success', text: t('terminal:fileExplorer.committedSuccessfully') });
      }

      // Clear state after successful commit
      setCommitMessage('');
      setSavedMessage('');
      setIsAmend(false);
      onRefresh();
      onCommitComplete?.();
    } catch (err: any) {
      setCommitStatus({ type: 'error', text: err.message || 'Commit failed' });
    } finally {
      setIsCommitting(false);
    }
  }, [currentFolder, commitMessage, isAmend, checkedFiles, isCommitting, onRefresh, onCommitComplete]);

  // Loading state
  if (loading) {
    return <div className="git-changes-loading">{t('terminal:fileExplorer.loadingGitStatus')}</div>;
  }

  // Not a git repo
  if (!gitStatus || !gitStatus.isGitRepo) {
    return (
      <div className="git-changes-empty">
        <div className="git-empty-icon">📦</div>
        <div className="git-empty-text">{t('terminal:fileExplorer.notGitRepo')}</div>
      </div>
    );
  }

  // Clean working tree
  if (gitStatus.files.length === 0) {
    return (
      <div className="git-changes-empty">
        <div className="git-empty-icon">✨</div>
        <div className="git-empty-text">{t('terminal:fileExplorer.workingTreeClean')}</div>
        <div className="git-empty-branch">{t('terminal:fileExplorer.onBranch', { branch: gitStatus.branch })}</div>
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
            {(gitStatus.counts.conflict ?? 0) > 0 && (
              <span className="git-count conflict">{gitStatus.counts.conflict}C</span>
            )}
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
            title={t('terminal:fileExplorer.flatList')}
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
        <button
          className="git-refresh-btn"
          onClick={onRefresh}
          title={t('common:buttons.refresh')}
        >
          ↻
        </button>
      </div>

      {/* Merge in-progress banner */}
      {mergeInProgress && (
        <div className="git-merge-banner">
          <span className="git-merge-banner-icon">&#9888;</span>
          <span className="git-merge-banner-text">
            {t('terminal:fileExplorer.mergeInProgress', { branch: mergingBranch ? ` (${mergingBranch})` : '' })}
          </span>
          <div className="git-merge-actions">
            <button
              className="git-merge-continue-btn"
              onClick={onMergeContinue}
              disabled={hasConflicts}
              title={hasConflicts ? t('terminal:fileExplorer.resolveAllConflictsFirst') : t('terminal:fileExplorer.continueMerge')}
            >
              {t('terminal:fileExplorer.continue')}
            </button>
            <button
              className="git-merge-abort-btn"
              onClick={onMergeAbort}
              title={t('terminal:fileExplorer.abortMerge')}
            >
              {t('terminal:fileExplorer.abort')}
            </button>
          </div>
        </div>
      )}

      {/* File list grouped by status */}
      <div className="git-changes-list">
        {(['conflict', 'modified', 'added', 'deleted', 'renamed', 'untracked'] as const).map(
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
              onFileSelect={status === 'conflict' && onConflictOpen
                ? (path: string, _status: GitFileStatusType) => onConflictOpen(path)
                : onFileSelect
              }
              onStageFile={status === 'untracked' ? handleStageFile : undefined}
              onStageAll={status === 'untracked' ? handleStageAllUntracked : undefined}
              stagingPaths={status === 'untracked' ? stagingPaths : undefined}
              checkedFiles={checkedFiles}
              onToggleCheck={handleToggleCheck}
            />
          )
        )}
      </div>

      {/* Commit Panel */}
      <div className="git-commit-panel">
        {/* Options row: Amend + file count + select toggle */}
        <div className="git-commit-options">
          <label className="git-commit-amend-label">
            <input
              type="checkbox"
              className="git-commit-amend-checkbox"
              checked={isAmend}
              onChange={handleAmendToggle}
            />
            {t('terminal:fileExplorer.amend')}
          </label>
          <span className="git-commit-file-count">
            {t('terminal:fileExplorer.fileCount', { count: checkedFiles.size })}
          </span>
          <button
            className="git-commit-select-toggle"
            onClick={handleToggleAllChecks}
            title={checkedFiles.size === gitStatus.files.length ? t('terminal:fileExplorer.deselectAll') : t('terminal:fileExplorer.selectAll')}
          >
            {checkedFiles.size === gitStatus.files.length ? t('terminal:fileExplorer.deselectAll') : t('terminal:fileExplorer.selectAll')}
          </button>
        </div>

        {/* Commit message */}
        <textarea
          ref={commitTextareaRef}
          className="git-commit-message"
          placeholder={t('terminal:fileExplorer.commitMessagePlaceholder')}
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl/Cmd+Enter to commit
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              handleCommit(false);
            }
            // Ctrl/Cmd+Shift+Enter to commit & push
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Enter') {
              e.preventDefault();
              handleCommit(true);
            }
            e.stopPropagation();
          }}
          rows={3}
          disabled={isCommitting}
        />

        {/* Status message */}
        {commitStatus && (
          <div className={`git-commit-status ${commitStatus.type}`}>
            {commitStatus.text}
          </div>
        )}

        {/* Action buttons */}
        <div className="git-commit-actions">
          <button
            className="git-commit-btn"
            onClick={() => handleCommit(false)}
            disabled={!commitMessage.trim() || checkedFiles.size === 0 || isCommitting}
            title={t('terminal:fileExplorer.commitCtrlEnter')}
          >
            {isCommitting ? t('terminal:fileExplorer.committing') : t('terminal:fileExplorer.commitAction')}
          </button>
          <button
            className="git-commit-push-btn"
            onClick={() => handleCommit(true)}
            disabled={!commitMessage.trim() || checkedFiles.size === 0 || isCommitting}
            title={t('terminal:fileExplorer.commitAndPushCtrlShiftEnter')}
          >
            {isCommitting ? '...' : t('terminal:fileExplorer.commitAndPush')}
          </button>
        </div>
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
  if (prev.currentFolder !== next.currentFolder) return false;
  if (prev.mergeInProgress !== next.mergeInProgress) return false;
  if (prev.mergingBranch !== next.mergingBranch) return false;
  // Compare git status
  if (prev.gitStatus === null && next.gitStatus === null) return true;
  if (prev.gitStatus === null || next.gitStatus === null) return false;
  if (prev.gitStatus.isGitRepo !== next.gitStatus.isGitRepo) return false;
  if (prev.gitStatus.branch !== next.gitStatus.branch) return false;
  if (prev.gitStatus.files.length !== next.gitStatus.files.length) return false;
  if (prev.gitStatus.mergeInProgress !== next.gitStatus.mergeInProgress) return false;

  return true;
});

GitChanges.displayName = 'GitChanges';
