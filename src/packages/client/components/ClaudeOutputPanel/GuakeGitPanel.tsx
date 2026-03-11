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
import { apiUrl, authFetch, STORAGE_KEYS, getStorageString, setStorageString, getStorage, setStorage } from '../../utils/storage';
import { useAreas } from '../../store';
import { DiffViewer } from '../DiffViewer';
import { GIT_STATUS_CONFIG } from '../FileExplorerPanel/constants';
import { getIconForExtension, buildGitTree } from '../FileExplorerPanel/fileUtils';
import { getLanguageForExtension } from '../FileExplorerPanel/syntaxHighlighting';
import type { GitTreeNode } from '../FileExplorerPanel/fileUtils';
import type { GitStatus, GitFileStatus, GitFileStatusType, TreeNode } from '../FileExplorerPanel/types';
import type { Agent } from '../../../shared/types';
import { useFileTree } from '../FileExplorerPanel/useFileTree';
import { TreeNodeItem } from '../FileExplorerPanel/TreeNodeItem';
import type { BranchInfo } from './useGitBranch';
import { ContextMenu, type ContextMenuAction } from '../ContextMenu';

// ==========================================================================
// TYPES
// ==========================================================================

interface GuakeGitPanelProps {
  agentId: string;
  agents: Map<string, Agent>;
  onClose: () => void;
  branchInfoMap: Map<string, BranchInfo>;
  fetchRemote: (dir: string) => Promise<void>;
  fetchingDirs: Set<string>;
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

type ModalState = { type: 'diff'; data: DiffState } | { type: 'content'; data: ContentState; isNewFile?: boolean } | null;
type ViewMode = 'flat' | 'tree';
type PanelMode = 'changes' | 'explorer';

// ==========================================================================
// HELPERS
// ==========================================================================

function getLanguageForFile(filename: string): string {
  const ext = filename.lastIndexOf('.') >= 0 ? filename.substring(filename.lastIndexOf('.')) : '';
  return getLanguageForExtension(ext);
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
  onContextMenu?: (e: React.MouseEvent, file: GitFileStatus, repoDir: string) => void;
  repoDir: string;
}

function TreeNodeView({ node, depth, expandedDirs, onToggleDir, onFileClick, onContextMenu, repoDir }: TreeNodeProps) {
  if (node.isDirectory) {
    const isExpanded = expandedDirs.has(node.path);
    const folderIconSrc = isExpanded
      ? `${import.meta.env.BASE_URL}assets/vscode-icons/default_folder_opened.svg`
      : `${import.meta.env.BASE_URL}assets/vscode-icons/default_folder.svg`;
    return (
      <>
        <div
          className="guake-git-file guake-git-tree-dir"
          style={{ paddingLeft: `${12 + depth * 20}px` }}
          onClick={() => onToggleDir(node.path)}
        >
          <span className="guake-git-repo-arrow" style={{ marginRight: 4 }}>
            {isExpanded ? '▼' : '▶'}
          </span>
          <img src={folderIconSrc} alt="" className="guake-git-file-icon guake-git-folder-icon" />
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
            onContextMenu={onContextMenu}
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
      style={{ paddingLeft: `${28 + depth * 20}px` }}
      onClick={() => onFileClick(file, repoDir)}
      onContextMenu={onContextMenu ? (e) => onContextMenu(e, file, repoDir) : undefined}
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

export function GuakeGitPanel({ agentId, agents, onClose, branchInfoMap, fetchRemote, fetchingDirs }: GuakeGitPanelProps) {
  const { t: _t } = useTranslation(['terminal', 'common']);
  const areas = useAreas();

  const [repos, setRepos] = useState<RepoStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [expandedTreeDirs, setExpandedTreeDirs] = useState<Set<string>>(new Set());
  const [modalState, setModalState] = useState<ModalState>(null);
  const [_diffLoading, setDiffLoading] = useState(false);
  const [viewMode, setViewModeRaw] = useState<ViewMode>(() => {
    const stored = getStorageString(STORAGE_KEYS.GIT_PANEL_VIEW_MODE, 'flat');
    return stored === 'tree' ? 'tree' : 'flat';
  });
  const [panelMode, setPanelModeRaw] = useState<PanelMode>(() => {
    const stored = getStorageString(STORAGE_KEYS.GIT_PANEL_MODE, 'changes');
    return stored === 'explorer' ? 'explorer' : 'changes';
  });
  const [explorerFolderIdx, setExplorerFolderIdxRaw] = useState(() =>
    getStorage<number>(STORAGE_KEYS.GIT_PANEL_FOLDER_IDX, 0)
  );

  const setViewMode = useCallback((v: ViewMode) => {
    setViewModeRaw(v);
    setStorageString(STORAGE_KEYS.GIT_PANEL_VIEW_MODE, v);
  }, []);
  const setPanelMode = useCallback((m: PanelMode) => {
    setPanelModeRaw(m);
    setStorageString(STORAGE_KEYS.GIT_PANEL_MODE, m);
  }, []);
  const setExplorerFolderIdx = useCallback((idx: number) => {
    setExplorerFolderIdxRaw(idx);
    setStorage(STORAGE_KEYS.GIT_PANEL_FOLDER_IDX, idx);
  }, []);
  const [explorerSelectedPath, setExplorerSelectedPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    actions: ContextMenuAction[];
  } | null>(null);
  const hasAutoExpanded = React.useRef(false);
  const prevAgentIdRef = React.useRef(agentId);

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

  // Current explorer folder
  const explorerFolder = areaDirs.length > 0 ? (areaDirs[explorerFolderIdx] || areaDirs[0]) : null;
  const fileTree = useFileTree(panelMode === 'explorer' ? explorerFolder : null);

  // Load tree when explorer mode is activated or folder changes
  useEffect(() => {
    if (panelMode === 'explorer' && explorerFolder) {
      fileTree.loadTree();
    }
  }, [panelMode, explorerFolder]);

  // Overlay git status onto the explorer tree
  const explorerTreeWithGit = useMemo(() => {
    if (fileTree.tree.length === 0 || repos.length === 0 || !explorerFolder) return fileTree.tree;

    // Build a map of file paths → git status for the current explorer folder
    const statusMap = new Map<string, GitFileStatusType>();
    for (const repo of repos) {
      // Match repos that share the same git root as the explorer folder
      for (const file of repo.gitStatus.files) {
        const fullPath = file.path.startsWith('/') ? file.path : `${repo.dir.replace(/\/$/, '')}/${file.path}`;
        statusMap.set(fullPath, file.status);
      }
    }

    if (statusMap.size === 0) return fileTree.tree;

    // Recursively annotate tree nodes with git status
    const annotate = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.map(node => {
        if (node.isDirectory) {
          const children = node.children ? annotate(node.children) : undefined;
          const hasGitChanges = children ? children.some(c => c.gitStatus || c.hasGitChanges) : false;
          if (hasGitChanges || children !== node.children) {
            return { ...node, children, hasGitChanges };
          }
          return node;
        }
        const status = statusMap.get(node.path);
        if (status) {
          return { ...node, gitStatus: status };
        }
        return node;
      });
    };

    return annotate(fileTree.tree);
  }, [fileTree.tree, repos, explorerFolder]);

  // Reset state when agent changes (component stays mounted across agent switches)
  useEffect(() => {
    if (prevAgentIdRef.current !== agentId) {
      prevAgentIdRef.current = agentId;
      hasAutoExpanded.current = false;
      setRepos([]);
      setExpandedRepos(new Set());
      setExpandedTreeDirs(new Set());
      setModalState(null);
      setExplorerFolderIdx(0);
      setExplorerSelectedPath(null);
    }
  }, [agentId]);

  // Fetch git status with cancellation guard
  const refreshGenRef = React.useRef(0);
  const refresh = useCallback(async () => {
    if (areaDirs.length === 0) return;
    const gen = ++refreshGenRef.current;
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
      // Discard results if a newer refresh was triggered (agent switch)
      if (gen !== refreshGenRef.current) return;
      results.sort((a, b) => a.dirName.localeCompare(b.dirName));
      setRepos(results);
      if (!hasAutoExpanded.current && results.length > 0) {
        hasAutoExpanded.current = true;
        setExpandedRepos(new Set(results.map(r => r.dir)));
      }
    } finally {
      if (gen === refreshGenRef.current) setLoading(false);
    }
  }, [areaDirs]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  // Git fetch all area directories then refresh
  const gitFetchAll = useCallback(async () => {
    if (areaDirs.length === 0) return;
    await Promise.all(areaDirs.map((dir) => fetchRemote(dir)));
    await refresh();
  }, [areaDirs, fetchRemote, refresh]);

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
          isNewFile: true,
        });
      }
    } catch { /* skip */ } finally {
      setDiffLoading(false);
    }
  }, []);

  // Handle file select from explorer tree
  const handleExplorerFileSelect = useCallback(async (node: TreeNode) => {
    if (node.isDirectory) return;
    setExplorerSelectedPath(node.path);
    setDiffLoading(true);
    try {
      const fileName = node.name;
      const language = getLanguageForFile(fileName);

      // If the file has a diffable git status, show original vs modified
      if (node.gitStatus && hasDiff(node.gitStatus)) {
        let originalContent = '';
        let modifiedContent = '';

        if (node.gitStatus !== 'deleted') {
          try {
            const curRes = await authFetch(apiUrl(`/api/files/read?path=${encodeURIComponent(node.path)}`));
            if (curRes.ok) {
              const curData = await curRes.json();
              if (curData.content != null) modifiedContent = curData.content;
            }
          } catch { /* skip */ }
        }

        try {
          const origRes = await authFetch(apiUrl(`/api/files/git-original?path=${encodeURIComponent(node.path)}`));
          if (origRes.ok) {
            const origData = await origRes.json();
            if (origData.content != null) originalContent = origData.content;
          }
        } catch { /* skip */ }

        setModalState({
          type: 'diff',
          data: { filePath: node.path, fileName, originalContent, modifiedContent, language },
        });
      } else {
        // Plain file view or added/untracked files
        let content = '';
        try {
          const res = await authFetch(apiUrl(`/api/files/read?path=${encodeURIComponent(node.path)}`));
          if (res.ok) {
            const data = await res.json();
            if (data.content != null) content = data.content;
          }
        } catch { /* skip */ }

        setModalState({
          type: 'content',
          data: { filePath: node.path, fileName, content, language },
          isNewFile: node.gitStatus === 'added' || node.gitStatus === 'untracked',
        });
      }
    } finally {
      setDiffLoading(false);
    }
  }, []);

  const closeModal = useCallback(() => setModalState(null), []);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Context menu for git-changed files (Changes tab)
  const handleGitFileContextMenu = useCallback((e: React.MouseEvent, file: GitFileStatus, repoDir: string) => {
    e.preventDefault();
    e.stopPropagation();
    const fullPath = file.path.startsWith('/') ? file.path : `${repoDir.replace(/\/$/, '')}/${file.path}`;
    const actions: ContextMenuAction[] = [];

    // View diff/content
    actions.push({
      id: 'view',
      label: hasDiff(file.status) ? 'View Diff' : 'View File',
      icon: hasDiff(file.status) ? '📊' : '📄',
      onClick: () => handleFileClick(file, repoDir),
    });

    actions.push({ id: 'div1', label: '', divider: true, onClick: () => {} });

    // Copy paths
    actions.push({
      id: 'copy-path',
      label: 'Copy Full Path',
      icon: '🧷',
      onClick: () => { navigator.clipboard.writeText(fullPath); },
    });
    actions.push({
      id: 'copy-rel',
      label: 'Copy Relative Path',
      icon: '📋',
      onClick: () => { navigator.clipboard.writeText(file.path); },
    });

    // Open in editor
    if (file.status !== 'deleted') {
      actions.push({ id: 'div2', label: '', divider: true, onClick: () => {} });
      actions.push({
        id: 'open-editor',
        label: 'Open in Editor',
        icon: '✏️',
        onClick: async () => {
          try {
            await authFetch(apiUrl('/api/files/open-in-editor'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: fullPath }),
            });
          } catch { /* skip */ }
        },
      });
    }

    // Discard changes
    if (file.status === 'modified' || file.status === 'deleted' || file.status === 'renamed') {
      actions.push({ id: 'div3', label: '', divider: true, onClick: () => {} });
      actions.push({
        id: 'discard',
        label: 'Discard Changes',
        icon: '↩️',
        danger: true,
        onClick: async () => {
          try {
            await authFetch(apiUrl('/api/files/git-discard'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: fullPath }),
            });
            refresh();
          } catch { /* skip */ }
        },
      });
    }

    // Delete file
    if (file.status !== 'deleted') {
      if (!(file.status === 'modified' || file.status === 'renamed')) {
        actions.push({ id: 'div-del', label: '', divider: true, onClick: () => {} });
      }
      actions.push({
        id: 'delete',
        label: 'Delete File',
        icon: '🗑️',
        danger: true,
        onClick: async () => {
          try {
            await authFetch(apiUrl('/api/files/delete'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: fullPath }),
            });
            refresh();
          } catch { /* skip */ }
        },
      });
    }

    setContextMenu({ isOpen: true, position: { x: e.clientX, y: e.clientY }, actions });
  }, [handleFileClick, refresh]);

  // Context menu for explorer tree nodes
  const handleExplorerContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    const actions: ContextMenuAction[] = [];

    if (!node.isDirectory) {
      // View file
      actions.push({
        id: 'view',
        label: 'View File',
        icon: '📄',
        onClick: () => handleExplorerFileSelect(node),
      });
      actions.push({ id: 'div1', label: '', divider: true, onClick: () => {} });
    }

    // Copy path
    actions.push({
      id: 'copy-path',
      label: 'Copy Full Path',
      icon: '🧷',
      onClick: () => { navigator.clipboard.writeText(node.path); },
    });

    if (explorerFolder) {
      const relPath = node.path.startsWith(explorerFolder)
        ? node.path.slice(explorerFolder.replace(/\/$/, '').length + 1)
        : node.path;
      actions.push({
        id: 'copy-rel',
        label: 'Copy Relative Path',
        icon: '📋',
        onClick: () => { navigator.clipboard.writeText(relPath); },
      });
    }

    if (!node.isDirectory) {
      actions.push({ id: 'div2', label: '', divider: true, onClick: () => {} });
      actions.push({
        id: 'open-editor',
        label: 'Open in Editor',
        icon: '✏️',
        onClick: async () => {
          try {
            await authFetch(apiUrl('/api/files/open-in-editor'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: node.path }),
            });
          } catch { /* skip */ }
        },
      });

      // Delete file
      actions.push({ id: 'div-del', label: '', divider: true, onClick: () => {} });
      actions.push({
        id: 'delete',
        label: 'Delete File',
        icon: '🗑️',
        danger: true,
        onClick: async () => {
          try {
            await authFetch(apiUrl('/api/files/delete'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: node.path }),
            });
            fileTree.loadTree();
            refresh();
          } catch { /* skip */ }
        },
      });
    }

    setContextMenu({ isOpen: true, position: { x: e.clientX, y: e.clientY }, actions });
  }, [handleExplorerFileSelect, explorerFolder, fileTree, refresh]);

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
  }, [viewMode, repos]);

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
              {modalState.isNewFile && <span className="guake-git-content-badge">new file</span>}
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
          <div className="guake-git-tabs">
            <button
              className={`guake-git-tab ${panelMode === 'changes' ? 'active' : ''}`}
              onClick={() => setPanelMode('changes')}
            >
              🌿 Changes
              {totalFiles > 0 && <span className="guake-git-badge">{totalFiles}</span>}
            </button>
            <button
              className={`guake-git-tab ${panelMode === 'explorer' ? 'active' : ''}`}
              onClick={() => setPanelMode('explorer')}
            >
              📁 Files
            </button>
          </div>
        </div>
        <div className="guake-git-header-actions">
          <button
            className={`guake-git-fetch-btn ${fetchingDirs.size > 0 ? 'fetching' : ''}`}
            onClick={gitFetchAll}
            title="Git fetch"
            disabled={fetchingDirs.size > 0}
          >
            {fetchingDirs.size > 0 ? '⏳' : '⇣'}
          </button>
          {panelMode === 'changes' && (
            <>
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
            </>
          )}
          {panelMode === 'explorer' && (
            <button className="guake-git-refresh" onClick={() => fileTree.loadTree()} title="Refresh" disabled={fileTree.loading}>
              {fileTree.loading ? '⏳' : '↻'}
            </button>
          )}
          <button className="guake-git-close" onClick={onClose} title="Close">×</button>
        </div>
      </div>

      <div className="guake-git-body">
        {/* ===== CHANGES TAB ===== */}
        {panelMode === 'changes' && (
          <>
            {loading && repos.length === 0 && (
              <div className="guake-git-loading">Loading git status...</div>
            )}

            {!loading && repos.length === 0 && (
              <div className="guake-git-empty">No git changes found</div>
            )}

            {repos.map(({ dir, dirName, gitStatus }) => {
              const bi = branchInfoMap.get(dir);
              return (
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
                  {bi && bi.ahead > 0 && <span className="guake-branch-ahead">↑{bi.ahead}</span>}
                  {bi && bi.behind > 0 && <span className="guake-branch-behind">↓{bi.behind}</span>}
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
                          onContextMenu={(e) => handleGitFileContextMenu(e, file, dir)}
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
                        onContextMenu={handleGitFileContextMenu}
                        repoDir={dir}
                      />
                    ))}
                  </div>
                )}
              </div>
              );
            })}
          </>
        )}

        {/* ===== EXPLORER TAB ===== */}
        {panelMode === 'explorer' && (
          <>
            {/* Folder selector when multiple area dirs */}
            {areaDirs.length > 1 && (
              <div className="guake-git-folder-selector">
                {areaDirs.map((dir, idx) => {
                  const name = dir.split('/').filter(Boolean).pop() || dir;
                  const folderBi = branchInfoMap.get(dir);
                  return (
                    <button
                      key={dir}
                      className={`guake-git-folder-btn ${idx === explorerFolderIdx ? 'active' : ''}`}
                      onClick={() => setExplorerFolderIdx(idx)}
                      title={dir}
                    >
                      📂 {name}
                      {folderBi && <span className="guake-git-folder-branch"> ⎇ {folderBi.branch}</span>}
                      {folderBi && folderBi.ahead > 0 && <span className="guake-branch-ahead">↑{folderBi.ahead}</span>}
                      {folderBi && folderBi.behind > 0 && <span className="guake-branch-behind">↓{folderBi.behind}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {fileTree.loading && fileTree.tree.length === 0 && (
              <div className="guake-git-loading">Loading files...</div>
            )}

            {!fileTree.loading && fileTree.tree.length === 0 && (
              <div className="guake-git-empty">No files found</div>
            )}

            <div className="guake-git-explorer-tree">
              {explorerTreeWithGit.map((node) => (
                <TreeNodeItem
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedPath={explorerSelectedPath}
                  expandedPaths={fileTree.expandedPaths}
                  onSelect={handleExplorerFileSelect}
                  onToggle={fileTree.togglePath}
                  onContextMenu={handleExplorerContextMenu}
                  searchQuery=""
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>

    {/* Context Menu */}
    {contextMenu && (
      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        worldPosition={{ x: 0, z: 0 }}
        actions={contextMenu.actions}
        onClose={closeContextMenu}
      />
    )}
    </>
  );
}
