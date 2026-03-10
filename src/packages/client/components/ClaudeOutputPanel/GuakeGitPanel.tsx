/**
 * GuakeGitPanel - Git changes side panel for the Guake Terminal
 *
 * Shows git status for area directories assigned to the active agent.
 * Modeled after AgentDebugPanel — slides in from the right.
 * Clicking a modified/deleted file shows a diff modal; added/untracked shows content.
 * Supports flat and tree view modes.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { apiUrl, authFetch } from '../../utils/storage';
import { useAreas } from '../../store';
import { DiffViewer } from '../DiffViewer';
import { GIT_STATUS_CONFIG } from '../FileExplorerPanel/constants';
import { getIconForExtension, buildGitTree } from '../FileExplorerPanel/fileUtils';
import type { GitTreeNode } from '../FileExplorerPanel/fileUtils';
import type { GitStatus, GitFileStatus, GitFileStatusType } from '../FileExplorerPanel/types';
import type { Agent } from '../../../shared/types';

// ==========================================================================
// TYPES
// ==========================================================================

interface GuakeGitPanelProps {
  agentId: string;
  agents: Map<string, Agent>;
  onClose: () => void;
}

interface RepoStatus {
  dir: string;
  dirName: string;
  gitStatus: GitStatus;
}

interface DiffState {
  filePath: string;
  fileName: string;
  originalContent: string;
  modifiedContent: string;
  language: string;
}

interface ContentState {
  filePath: string;
  fileName: string;
  content: string;
  language: string;
}

type ModalState = { type: 'diff'; data: DiffState } | { type: 'content'; data: ContentState } | null;
type ViewMode = 'flat' | 'tree';

// ==========================================================================
// HELPERS
// ==========================================================================

function getLanguageForFile(filename: string): string {
  const ext = filename.lastIndexOf('.') >= 0 ? filename.substring(filename.lastIndexOf('.')) : '';
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
    '.css': 'css', '.scss': 'scss', '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml',
    '.md': 'markdown', '.mdx': 'markdown', '.py': 'python', '.sh': 'bash',
    '.rs': 'rust', '.go': 'go', '.sql': 'sql', '.toml': 'toml',
    '.html': 'markup', '.xml': 'markup', '.svg': 'markup',
  };
  return map[ext] || 'plaintext';
}

function isPositionInArea(pos: { x: number; z: number }, area: { center: { x: number; z: number }; width: number; height: number; type: string }): boolean {
  if (area.type === 'circle') {
    const dx = pos.x - area.center.x;
    const dz = pos.z - area.center.z;
    const r = Math.max(area.width, area.height) / 2;
    return dx * dx + dz * dz <= r * r;
  }
  const halfW = area.width / 2;
  const halfH = area.height / 2;
  return pos.x >= area.center.x - halfW && pos.x <= area.center.x + halfW
    && pos.z >= area.center.z - halfH && pos.z <= area.center.z + halfH;
}

/** Returns true for statuses that have a previous git version to diff against */
function hasDiff(status: GitFileStatusType): boolean {
  return status === 'modified' || status === 'renamed' || status === 'deleted' || status === 'conflict';
}

// ==========================================================================
// TREE NODE RENDERER
// ==========================================================================

interface TreeNodeProps {
  node: GitTreeNode;
  depth: number;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onFileClick: (file: GitFileStatus, repoDir: string) => void;
  repoDir: string;
}

function TreeNodeView({ node, depth, expandedDirs, onToggleDir, onFileClick, repoDir }: TreeNodeProps) {
  if (node.isDirectory) {
    const isExpanded = expandedDirs.has(node.path);
    return (
      <>
        <div
          className="guake-git-file guake-git-tree-dir"
          style={{ paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => onToggleDir(node.path)}
        >
          <span className="guake-git-repo-arrow" style={{ marginRight: 4 }}>
            {isExpanded ? '▼' : '▶'}
          </span>
          <span className="guake-git-file-name">{node.name}</span>
          <span className="guake-git-repo-count" style={{ marginLeft: 'auto' }}>{node.fileCount}</span>
        </div>
        {isExpanded && node.children.map((child) => (
          <TreeNodeView
            key={child.path}
            node={child}
            depth={depth + 1}
            expandedDirs={expandedDirs}
            onToggleDir={onToggleDir}
            onFileClick={onFileClick}
            repoDir={repoDir}
          />
        ))}
      </>
    );
  }

  // File node
  const file = node.file!;
  const cfg = GIT_STATUS_CONFIG[file.status];
  const iconSrc = getIconForExtension(file.name);
  return (
    <div
      className="guake-git-file"
      data-status={file.status}
      style={{ paddingLeft: `${12 + depth * 16}px` }}
      onClick={() => onFileClick(file, repoDir)}
      title={file.path}
    >
      {iconSrc && <img src={iconSrc} alt="" className="guake-git-file-icon" />}
      <span className="guake-git-file-name">{file.name}</span>
      <span className="guake-git-file-status" style={{ color: cfg.color, marginLeft: 'auto' }} title={cfg.label}>
        {cfg.icon}
      </span>
    </div>
  );
}

// ==========================================================================
// MAIN COMPONENT
// ==========================================================================

export function GuakeGitPanel({ agentId, agents, onClose }: GuakeGitPanelProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const areas = useAreas();

  const [repos, setRepos] = useState<RepoStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [expandedTreeDirs, setExpandedTreeDirs] = useState<Set<string>>(new Set());
  const [modalState, setModalState] = useState<ModalState>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('flat');

  // Compute area directories for this agent
  const areaDirs = useMemo(() => {
    const matchedAreaIds = new Set<string>();
    const dirs: string[] = [];

    for (const area of areas.values()) {
      if (area.archived || area.directories.length === 0) continue;
      if (area.assignedAgentIds.includes(agentId)) {
        matchedAreaIds.add(area.id);
        for (const d of area.directories) {
          if (d && d.trim()) dirs.push(d);
        }
      }
    }

    const agent = agents.get(agentId);
    if (agent) {
      for (const area of areas.values()) {
        if (area.archived || area.directories.length === 0 || matchedAreaIds.has(area.id)) continue;
        if (isPositionInArea({ x: agent.position.x, z: agent.position.z }, area as any)) {
          for (const d of area.directories) {
            if (d && d.trim()) dirs.push(d);
          }
        }
      }
    }

    if (agent?.cwd && !dirs.includes(agent.cwd)) {
      dirs.unshift(agent.cwd);
    }

    return [...new Set(dirs)];
  }, [agentId, agents, areas]);

  // Fetch git status
  const refresh = useCallback(async () => {
    if (areaDirs.length === 0) return;
    setLoading(true);
    try {
      const results: RepoStatus[] = [];
      await Promise.all(
        areaDirs.map(async (dir) => {
          try {
            const res = await authFetch(apiUrl(`/api/files/git-status?path=${encodeURIComponent(dir)}`));
            if (res.ok) {
              const data: GitStatus = await res.json();
              if (data.isGitRepo && data.files.length > 0) {
                const dirName = dir.split('/').filter(Boolean).pop() || dir;
                results.push({ dir, dirName, gitStatus: data });
              }
            }
          } catch { /* skip */ }
        })
      );
      results.sort((a, b) => a.dirName.localeCompare(b.dirName));
      setRepos(results);
      if (expandedRepos.size === 0 && results.length > 0) {
        setExpandedRepos(new Set(results.map(r => r.dir)));
      }
    } finally {
      setLoading(false);
    }
  }, [areaDirs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const toggleRepo = useCallback((dir: string) => {
    setExpandedRepos(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir); else next.add(dir);
      return next;
    });
  }, []);

  const toggleTreeDir = useCallback((path: string) => {
    setExpandedTreeDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);

  // Handle file click
  const handleFileClick = useCallback(async (file: GitFileStatus, repoDir: string) => {
    const fullPath = file.path.startsWith('/') ? file.path : `${repoDir.replace(/\/$/, '')}/${file.path}`;
    setDiffLoading(true);
    try {
      if (hasDiff(file.status)) {
        // Show diff modal for modified/renamed/deleted/conflict
        let originalContent = '';
        let modifiedContent = '';

        if (file.status !== 'deleted') {
          try {
            const curRes = await authFetch(apiUrl(`/api/files/read?path=${encodeURIComponent(fullPath)}`));
            if (curRes.ok) {
              const curData = await curRes.json();
              if (curData.content != null) modifiedContent = curData.content;
            }
          } catch { /* skip */ }
        }

        try {
          const origRes = await authFetch(apiUrl(`/api/files/git-original?path=${encodeURIComponent(fullPath)}`));
          if (origRes.ok) {
            const origData = await origRes.json();
            if (origData.content != null) originalContent = origData.content;
          }
        } catch { /* skip */ }

        setModalState({
          type: 'diff',
          data: { filePath: fullPath, fileName: file.name, originalContent, modifiedContent, language: getLanguageForFile(file.name) },
        });
      } else {
        // Show content viewer for added/untracked
        let content = '';
        try {
          const curRes = await authFetch(apiUrl(`/api/files/read?path=${encodeURIComponent(fullPath)}`));
          if (curRes.ok) {
            const curData = await curRes.json();
            if (curData.content != null) content = curData.content;
          }
        } catch { /* skip */ }

        setModalState({
          type: 'content',
          data: { filePath: fullPath, fileName: file.name, content, language: getLanguageForFile(file.name) },
        });
      }
    } catch { /* skip */ } finally {
      setDiffLoading(false);
    }
  }, []);

  const closeModal = useCallback(() => setModalState(null), []);

  const totalFiles = repos.reduce((sum, r) => sum + r.gitStatus.files.length, 0);

  // Close modal on Escape
  useEffect(() => {
    if (!modalState) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeModal();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [modalState, closeModal]);

  // Auto-expand tree dirs on first tree view
  useEffect(() => {
    if (viewMode === 'tree' && expandedTreeDirs.size === 0 && repos.length > 0) {
      const allDirs = new Set<string>();
      for (const repo of repos) {
        const tree = buildGitTree(repo.gitStatus.files);
        const collectDirs = (nodes: GitTreeNode[]) => {
          for (const n of nodes) {
            if (n.isDirectory) {
              allDirs.add(n.path);
              collectDirs(n.children);
            }
          }
        };
        collectDirs(tree);
      }
      setExpandedTreeDirs(allDirs);
    }
  }, [viewMode, repos]); // eslint-disable-line react-hooks/exhaustive-deps

  // ========================================================================
  // RENDER
  // ========================================================================
  return (
    <>
    {/* Diff Modal */}
    {modalState?.type === 'diff' && (
      <div className="guake-git-diff-modal-overlay" onClick={closeModal}>
        <div className="guake-git-diff-modal" onClick={(e) => e.stopPropagation()}>
          <div className="guake-git-diff-modal-header">
            <span className="guake-git-diff-filename" title={modalState.data.filePath}>
              {modalState.data.fileName}
            </span>
            <button className="guake-git-close" onClick={closeModal} title="Close (Esc)">×</button>
          </div>
          <div className="guake-git-diff-content">
            <DiffViewer
              originalContent={modalState.data.originalContent}
              modifiedContent={modalState.data.modifiedContent}
              filename={modalState.data.fileName}
              language={modalState.data.language}
            />
          </div>
        </div>
      </div>
    )}

    {/* Content Modal (for added/untracked files — uses DiffViewer with empty original for syntax highlighting) */}
    {modalState?.type === 'content' && (
      <div className="guake-git-diff-modal-overlay" onClick={closeModal}>
        <div className="guake-git-diff-modal" onClick={(e) => e.stopPropagation()}>
          <div className="guake-git-diff-modal-header">
            <span className="guake-git-diff-filename" title={modalState.data.filePath}>
              {modalState.data.fileName}
              <span className="guake-git-content-badge">new file</span>
            </span>
            <button className="guake-git-close" onClick={closeModal} title="Close (Esc)">×</button>
          </div>
          <div className="guake-git-diff-content">
            <DiffViewer
              originalContent=""
              modifiedContent={modalState.data.content}
              filename={modalState.data.fileName}
              language={modalState.data.language}
              initialModifiedOnly
            />
          </div>
        </div>
      </div>
    )}

    <div className="guake-git-panel">
      <div className="guake-git-header">
        <div className="guake-git-title">
          <span className="guake-git-icon">🌿</span>
          <span>Git Changes</span>
          {totalFiles > 0 && <span className="guake-git-badge">{totalFiles}</span>}
        </div>
        <div className="guake-git-header-actions">
          <button
            className={`guake-git-view-toggle ${viewMode === 'flat' ? 'active' : ''}`}
            onClick={() => setViewMode('flat')}
            title="Flat view"
          >☰</button>
          <button
            className={`guake-git-view-toggle ${viewMode === 'tree' ? 'active' : ''}`}
            onClick={() => setViewMode('tree')}
            title="Tree view"
          >🌲</button>
          <button className="guake-git-refresh" onClick={refresh} title="Refresh" disabled={loading}>
            {loading ? '⏳' : '↻'}
          </button>
          <button className="guake-git-close" onClick={onClose} title="Close">×</button>
        </div>
      </div>

      <div className="guake-git-body">
        {loading && repos.length === 0 && (
          <div className="guake-git-loading">Loading git status...</div>
        )}

        {!loading && repos.length === 0 && (
          <div className="guake-git-empty">No git changes found</div>
        )}

        {repos.map(({ dir, dirName, gitStatus }) => (
          <div key={dir} className="guake-git-repo">
            <div
              className={`guake-git-repo-header ${expandedRepos.has(dir) ? 'expanded' : ''}`}
              onClick={() => toggleRepo(dir)}
            >
              <span className="guake-git-repo-arrow">{expandedRepos.has(dir) ? '▼' : '▶'}</span>
              <span className="guake-git-repo-name">{dirName}</span>
              {gitStatus.branch && (
                <span className="guake-git-repo-branch">⎇ {gitStatus.branch}</span>
              )}
              <span className="guake-git-repo-count">{gitStatus.files.length}</span>
            </div>

            {expandedRepos.has(dir) && viewMode === 'flat' && (
              <div className="guake-git-file-list">
                {gitStatus.files.map((file) => {
                  const cfg = GIT_STATUS_CONFIG[file.status];
                  const iconSrc = getIconForExtension(file.name);
                  return (
                    <div
                      key={file.path}
                      className="guake-git-file"
                      data-status={file.status}
                      onClick={() => handleFileClick(file, dir)}
                      title={file.path}
                    >
                      {iconSrc && <img src={iconSrc} alt="" className="guake-git-file-icon" />}
                      <span className="guake-git-file-name">{file.name}</span>
                      <span className="guake-git-file-dir">
                        {file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : ''}
                      </span>
                      <span className="guake-git-file-status" style={{ color: cfg.color }} title={cfg.label}>
                        {cfg.icon}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {expandedRepos.has(dir) && viewMode === 'tree' && (
              <div className="guake-git-file-list">
                {buildGitTree(gitStatus.files).map((node) => (
                  <TreeNodeView
                    key={node.path}
                    node={node}
                    depth={0}
                    expandedDirs={expandedTreeDirs}
                    onToggleDir={toggleTreeDir}
                    onFileClick={handleFileClick}
                    repoDir={dir}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
    </>
  );
}
