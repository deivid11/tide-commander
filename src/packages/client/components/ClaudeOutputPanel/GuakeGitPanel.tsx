/**
 * GuakeGitPanel - Git changes side panel for the Guake Terminal
 *
 * Shows git status for area directories assigned to the active agent.
 * Modeled after AgentDebugPanel — slides in from the right.
 * Clicking a modified/deleted file shows a diff modal; added/untracked shows content.
 * Supports flat and tree view modes.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { apiUrl, authFetch, STORAGE_KEYS, getStorageString, setStorageString, getStorage, setStorage } from '../../utils/storage';
import { useAreas, useGitDirStatuses } from '../../store';
import { acquireGitWatch, requestGitRefresh } from '../../services/gitWatch';
import { DiffViewer } from '../DiffViewer';
import { GIT_STATUS_CONFIG } from '../FileExplorerPanel/constants';
import { getIconForFileName, buildGitTree } from '../FileExplorerPanel/fileUtils';
import { getLanguageForExtension } from '../FileExplorerPanel/syntaxHighlighting';
import type { GitTreeNode } from '../FileExplorerPanel/fileUtils';
import type { GitStatus, GitFileStatus, GitFileStatusType, TreeNode } from '../FileExplorerPanel/types';
import type { Agent } from '../../../shared/types';
import { useFileTree } from '../FileExplorerPanel/useFileTree';
import { TreeNodeItem } from '../FileExplorerPanel/TreeNodeItem';
import { parseFileFilter, filterFiles, scoreFile, highlightRanges } from './gitFileFilter';
import type { ParsedFileFilter } from './gitFileFilter';
import type { BranchInfo } from './useGitBranch';
import { ContextMenu, type ContextMenuAction } from '../ContextMenu';
import { Icon } from '../Icon';
import { useToast } from '../Toast';
import { useModalStackRegistration } from '../../hooks/useModalStack';
import { GitGraphModal } from './GitGraphModal';
import { prefetchGraph, buildGraphParams } from './gitGraphData';
import { loadGitGraphFilters } from '../../utils/gitGraphFilters';

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
  // When provided, renders a drag-to-resize handle glued to the panel's own
  // left edge. Used by surfaces (e.g. FlatView) where a sibling handle can't
  // reliably sit at the panel edge. Mouse-down starts the resize drag.
  onResizeStart?: (e: React.MouseEvent) => void;
}

interface RepoStatus {
  dir: string;
  dirName: string;
  gitStatus: GitStatus;
  /** Real change count — `gitStatus.files` is capped by the server watcher. */
  totalFiles: number;
  /** True when `gitStatus.files` holds only the first slice of the changes. */
  truncated: boolean;
}

/** A repo with the filter applied: `files` is the ranked, capped match list. */
interface DisplayRepo extends RepoStatus {
  /** Files to render — filter matches, ranked best-first and capped. */
  files: GitFileStatus[];
  /** How many files matched before the render cap was applied. */
  matchCount: number;
  /** Matches dropped by the render cap (0 when everything is shown). */
  hiddenMatches: number;
}

// A repo with this many changes is generated output (build dirs, caches), not
// work in progress: expanding it renders one row per file and would lock up the
// browser, so it stays collapsed until the user asks for it.
const AUTO_EXPAND_MAX_FILES = 500;

// Filter results auto-expand, so a loose query ("s") on a huge repo would
// otherwise paint every change at once. Beyond this the user refines instead.
const FILTER_RENDER_CAP = 300;

// The Files tab tree is lazy-loaded (3 levels), so a filter there also asks the
// server to walk the folder — debounced, and only once the seed term is usable.
const EXPLORER_SEARCH_LIMIT = 200;
const EXPLORER_SEARCH_DEBOUNCE_MS = 220;

const FILTER_HELP = [
  'Filter files:',
  '  runner          fuzzy match on the filename, then the path',
  '  server/claude   a term with "/" matches the full path',
  '  .tsx  *.tsx     extension',
  '  "exact text"    contiguous match, no fuzzy scatter',
  '  !test           exclude matches',
  '  status:mod      only that status (m/a/d/u/r/c)',
  'Terms combine with AND. Uppercase makes a term case-sensitive.',
].join('\n');

/** One filter hit in the Files tab — from the loaded tree or the server walk. */
interface ExplorerMatch {
  /** Node to open on click; absolute path, git status attached when known. */
  node: TreeNode;
  /** Path relative to the explorer folder — what gets matched and displayed. */
  relPath: string;
  status?: GitFileStatusType;
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

/** Recursively collect every changed file under a git-tree (Changes tab) directory node. */
function collectFilesFromGitNode(node: GitTreeNode): GitFileStatus[] {
  if (!node.isDirectory) return node.file ? [node.file] : [];
  const out: GitFileStatus[] = [];
  for (const child of node.children) out.push(...collectFilesFromGitNode(child));
  return out;
}

/** Recursively collect git-changed files under an explorer (Files tab) directory node. */
function collectGitFilesFromExplorerNode(node: TreeNode): Array<{ path: string; status: GitFileStatusType }> {
  if (!node.isDirectory) {
    return node.gitStatus ? [{ path: node.path, status: node.gitStatus as GitFileStatusType }] : [];
  }
  const out: Array<{ path: string; status: GitFileStatusType }> = [];
  for (const child of node.children || []) out.push(...collectGitFilesFromExplorerNode(child));
  return out;
}

// ==========================================================================
// FILTER MATCH HIGHLIGHT
// ==========================================================================

/** Renders `text` with the filter's matched characters wrapped in <mark>. */
function HighlightedText({ text, filter }: { text: string; filter: ParsedFileFilter }) {
  const ranges = useMemo(() => highlightRanges(filter, text), [filter, text]);
  if (ranges.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={start} className="guake-git-filter-hit">{text.slice(start, end)}</mark>
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
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
  onFolderContextMenu?: (e: React.MouseEvent, node: GitTreeNode, repoDir: string) => void;
  onDiscard?: (e: React.MouseEvent, file: GitFileStatus, repoDir: string) => void;
  repoDir: string;
  filter: ParsedFileFilter;
}

function TreeNodeView({ node, depth, expandedDirs, onToggleDir, onFileClick, onContextMenu, onFolderContextMenu, onDiscard, repoDir, filter }: TreeNodeProps) {
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
          onContextMenu={onFolderContextMenu ? (e) => onFolderContextMenu(e, node, repoDir) : undefined}
        >
          <span className="guake-git-repo-arrow" style={{ marginRight: 4 }}>
            <Icon name={isExpanded ? 'caret-down' : 'caret-right'} size={12} />
          </span>
          <img src={folderIconSrc} alt="" className="guake-git-file-icon guake-git-folder-icon" />
          <span className="guake-git-file-name"><HighlightedText text={node.name} filter={filter} /></span>
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
            onFolderContextMenu={onFolderContextMenu}
            onDiscard={onDiscard}
            repoDir={repoDir}
            filter={filter}
          />
        ))}
      </>
    );
  }

  // File node
  const file = node.file!;
  const cfg = GIT_STATUS_CONFIG[file.status];
  const iconSrc = getIconForFileName(file.name);
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
      <span className="guake-git-file-name"><HighlightedText text={file.name} filter={filter} /></span>
      <span className="guake-git-file-status" style={{ color: cfg.color, marginLeft: 'auto' }} title={cfg.label}>
        {cfg.icon}
      </span>
      {onDiscard && (
        <button
          className="guake-git-discard-btn"
          title={file.status === 'untracked' || file.status === 'added' ? 'Delete file' : 'Discard changes'}
          onClick={(e) => onDiscard(e, file, repoDir)}
        >
          <Icon name="revert" size={12} />
        </button>
      )}
    </div>
  );
}

// ==========================================================================
// MAIN COMPONENT
// ==========================================================================

export function GuakeGitPanel({ agentId, agents, onClose, branchInfoMap, fetchRemote, fetchingDirs, onResizeStart }: GuakeGitPanelProps) {
  const { t: _t } = useTranslation(['terminal', 'common']);
  const areas = useAreas();
  const { showToast } = useToast();

  const [expandedRepos, setExpandedRepos] = useState<Set<string>>(new Set());
  const [expandedTreeDirs, setExpandedTreeDirs] = useState<Set<string>>(new Set());
  const [modalState, setModalState] = useState<ModalState>(null);
  const [diffLoading, setDiffLoading] = useState(false);
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
  const [filterQuery, setFilterQuery] = useState('');
  // Paths (repo dirs, tree dirs) the user collapsed while a filter is active.
  // Matches auto-expand, so an explicit collapse needs its own bucket that
  // resets with the query instead of fighting the persistent expansion sets.
  const [filterCollapsed, setFilterCollapsed] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    actions: ContextMenuAction[];
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ path: string; name: string; status: GitFileStatusType; repoDir: string } | null>(null);
  const hasAutoExpanded = React.useRef(false);
  /** Once-per-agent guard for the changes-tree auto-expand-all. */
  const treeDirsAutoExpandedRef = React.useRef(false);
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

  const areaDirsKey = areaDirs.join('\n');

  // Register the area directories with the server-side git watcher; status
  // arrives as git_status_update pushes (no HTTP polling).
  useEffect(() => {
    if (areaDirs.length === 0) return;
    return acquireGitWatch(areaDirs);
  }, [areaDirsKey]);

  const gitStatuses = useGitDirStatuses();

  // Repos with pending changes, derived from server-pushed statuses.
  const repos = useMemo<RepoStatus[]>(() => {
    const results: RepoStatus[] = [];
    for (const dir of areaDirs) {
      const status = gitStatuses.get(dir);
      if (status?.isGitRepo && status.files.length > 0) {
        const dirName = dir.split('/').filter(Boolean).pop() || dir;
        results.push({
          dir,
          dirName,
          gitStatus: {
            isGitRepo: true,
            branch: status.branch ?? undefined,
            files: status.files,
            mergeInProgress: status.mergeInProgress,
          },
          totalFiles: status.totalFiles ?? status.files.length,
          truncated: status.truncated ?? false,
        });
      }
    }
    results.sort((a, b) => a.dirName.localeCompare(b.dirName));
    return results;
  }, [gitStatuses, areaDirsKey]);

  // Still waiting for the first push for every watched directory.
  const loading = areaDirs.length > 0 && areaDirs.every((dir) => !gitStatuses.has(dir));

  const fileFilter = useMemo(() => parseFileFilter(filterQuery), [filterQuery]);
  const filterActive = !fileFilter.isEmpty;

  // Drop the per-filter collapse overrides whenever the query changes — the new
  // result set has nothing to do with what was collapsed for the old one.
  useEffect(() => {
    setFilterCollapsed((prev) => (prev.size === 0 ? prev : new Set()));
  }, [filterQuery]);

  // Repos with the filename filter applied: matches ranked best-first, repos
  // with no match dropped, and the rendered slice capped so a loose query on a
  // huge repo can't paint tens of thousands of rows.
  const displayRepos = useMemo<DisplayRepo[]>(() => {
    if (!filterActive) {
      return repos.map((repo) => ({
        ...repo,
        files: repo.gitStatus.files,
        matchCount: repo.gitStatus.files.length,
        hiddenMatches: 0,
      }));
    }

    const out: DisplayRepo[] = [];
    for (const repo of repos) {
      const matches = filterFiles(fileFilter, repo.gitStatus.files);
      if (matches.length === 0) continue;
      out.push({
        ...repo,
        files: matches.length > FILTER_RENDER_CAP ? matches.slice(0, FILTER_RENDER_CAP) : matches,
        matchCount: matches.length,
        hiddenMatches: Math.max(0, matches.length - FILTER_RENDER_CAP),
      });
    }
    return out;
  }, [repos, fileFilter, filterActive]);

  const totalMatches = useMemo(
    () => displayRepos.reduce((sum, repo) => sum + repo.matchCount, 0),
    [displayRepos]
  );

  // While filtering, every matching repo starts expanded so hits are visible
  // without a click; explicit collapses live in filterCollapsed.
  const isRepoExpanded = useCallback(
    (dir: string) => (filterActive ? !filterCollapsed.has(dir) : expandedRepos.has(dir)),
    [filterActive, filterCollapsed, expandedRepos]
  );

  const toggleFilterCollapsed = useCallback((path: string) => {
    setFilterCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, []);
  // Every watched git repo, not just the ones with pending changes — the branch
  // graph is just as useful (arguably more) on a clean tree.
  const graphRepos = useMemo(() => {
    return areaDirs
      .filter((dir) => gitStatuses.get(dir)?.isGitRepo)
      .map((dir) => ({ dir, dirName: dir.split('/').filter(Boolean).pop() || dir }));
  }, [gitStatuses, areaDirsKey]);
  const [graphRepo, setGraphRepo] = useState<{ dir: string; dirName: string } | null>(null);

  // Current explorer folder
  const explorerFolder = areaDirs.length > 0 ? (areaDirs[explorerFolderIdx] || areaDirs[0]) : null;
  const fileTree = useFileTree(panelMode === 'explorer' ? explorerFolder : null);

  // Persist the Files-tab expanded folders per folder (localStorage), so
  // switching to another agent/area and back restores the tree as it was.
  //
  // Everything keys off fileTree.loadGeneration (bumped when a FULL loadTree
  // lands, which also resets expandedPaths to root-only). Gating on folder
  // alone raced the area switch: the restore effect fired against the PREVIOUS
  // area's still-mounted tree, marked the new folder restored, and the save
  // effect then overwrote its stored expansion with the fresh root-only set —
  // the "never remembers across areas" bug.
  const treeStorageKey = explorerFolder ? `tc-git-tree-expanded:${explorerFolder}` : null;
  /** Last loadGeneration whose stored expansion has been applied. */
  const treeRestoredGenRef = useRef(0);
  /** True while restoreExpandedPaths is applying — blocks saves of the
   *  transient root-only / partially-expanded states it passes through. */
  const treeRestoreInFlightRef = useRef(false);

  // Load tree when explorer mode is activated or folder changes
  useEffect(() => {
    if (panelMode === 'explorer' && explorerFolder) {
      fileTree.loadTree();
    }
  }, [panelMode, explorerFolder]);

  // "Collapse all" — reset the active tab's tree to its most compact state.
  const collapseAllTree = useCallback(() => {
    if (panelMode === 'explorer') {
      if (explorerFolder) fileTree.setExpandedPaths(new Set([explorerFolder]));
    } else {
      treeDirsAutoExpandedRef.current = true; // keep the auto-expander from undoing it
      setExpandedTreeDirs(new Set());
    }
  }, [panelMode, explorerFolder, fileTree.setExpandedPaths]);

  // The freshly-loaded tree belongs to the current folder only once its
  // single wrapper root carries exactly that path (loadTree wraps in one root).
  const treeMatchesFolder =
    !!explorerFolder && fileTree.tree.length === 1 && fileTree.tree[0].path === explorerFolder;

  // Re-apply the stored expansion exactly once per completed load.
  // restoreExpandedPaths (not a raw set) lazy-loads folders deeper than the
  // initial tree depth so nested stored dirs actually render.
  useEffect(() => {
    if (panelMode !== 'explorer' || !treeStorageKey || !treeMatchesFolder) return;
    if (fileTree.loading || fileTree.loadGeneration === 0) return;
    if (treeRestoredGenRef.current === fileTree.loadGeneration) return;
    treeRestoredGenRef.current = fileTree.loadGeneration;
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(treeStorageKey) || '[]');
      if (Array.isArray(stored) && stored.length > 0) {
        treeRestoreInFlightRef.current = true;
        void fileTree
          .restoreExpandedPaths(new Set(stored.filter((p): p is string => typeof p === 'string')))
          .finally(() => { treeRestoreInFlightRef.current = false; });
      }
    } catch { /* corrupt entry — start collapsed */ }
  }, [panelMode, treeStorageKey, treeMatchesFolder, fileTree.loading, fileTree.loadGeneration, fileTree.restoreExpandedPaths]);

  // Save on expansion changes, but only after this load's restore has run and
  // only while the mounted tree really is this folder's (never mid-switch).
  useEffect(() => {
    if (!treeStorageKey || !treeMatchesFolder) return;
    if (fileTree.loadGeneration === 0 || treeRestoredGenRef.current !== fileTree.loadGeneration) return;
    if (treeRestoreInFlightRef.current) return;
    try {
      localStorage.setItem(treeStorageKey, JSON.stringify(Array.from(fileTree.expandedPaths)));
    } catch { /* storage full — non-fatal */ }
  }, [treeStorageKey, treeMatchesFolder, fileTree.loadGeneration, fileTree.expandedPaths]);

  // Absolute file path → git status, for both the explorer tree overlay and
  // the explorer filter results.
  const explorerGitStatusMap = useMemo(() => {
    const statusMap = new Map<string, GitFileStatusType>();
    for (const repo of repos) {
      // Match repos that share the same git root as the explorer folder
      for (const file of repo.gitStatus.files) {
        const fullPath = file.path.startsWith('/') ? file.path : `${repo.dir.replace(/\/$/, '')}/${file.path}`;
        statusMap.set(fullPath, file.status);
      }
    }
    return statusMap;
  }, [repos]);

  // Overlay git status onto the explorer tree
  const explorerTreeWithGit = useMemo(() => {
    if (fileTree.tree.length === 0 || repos.length === 0 || !explorerFolder) return fileTree.tree;

    const statusMap = explorerGitStatusMap;
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
  }, [fileTree.tree, repos, explorerFolder, explorerGitStatusMap]);

  // ---- Files tab filter -------------------------------------------------
  // The loaded tree only reaches 3 levels deep, so the filter is fed by two
  // sources: the nodes already in memory (instant, fuzzy) and a server-side
  // name walk of the whole folder (deep, substring). Both get ranked together.
  const [explorerHits, setExplorerHits] = useState<TreeNode[]>([]);
  const [explorerSearching, setExplorerSearching] = useState(false);

  // Longest usable term drives the server query — it does plain substring
  // matching, so a scattered fuzzy term would just come back empty.
  const explorerSearchSeed = useMemo(() => {
    if (!filterActive) return '';
    let seed = '';
    for (const term of fileFilter.include) {
      const text = term.kind === 'path' ? (term.text.split('/').filter(Boolean).pop() ?? '') : term.text;
      if (text.length > seed.length) seed = text;
    }
    return seed.length >= 2 ? seed : '';
  }, [fileFilter, filterActive]);

  useEffect(() => {
    if (panelMode !== 'explorer' || !explorerFolder || !explorerSearchSeed) {
      setExplorerHits((prev) => (prev.length === 0 ? prev : []));
      setExplorerSearching(false);
      return;
    }

    let cancelled = false;
    setExplorerSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await authFetch(apiUrl(
          `/api/files/search?path=${encodeURIComponent(explorerFolder)}`
          + `&q=${encodeURIComponent(explorerSearchSeed)}&limit=${EXPLORER_SEARCH_LIMIT}`
        ));
        const data = res.ok ? await res.json() : null;
        if (!cancelled) setExplorerHits(Array.isArray(data?.results) ? data.results : []);
      } catch {
        if (!cancelled) setExplorerHits([]);
      } finally {
        if (!cancelled) setExplorerSearching(false);
      }
    }, EXPLORER_SEARCH_DEBOUNCE_MS);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [panelMode, explorerFolder, explorerSearchSeed]);

  const explorerMatches = useMemo<ExplorerMatch[]>(() => {
    if (panelMode !== 'explorer' || !filterActive || !explorerFolder) return [];

    const root = explorerFolder.replace(/\/$/, '');
    const seen = new Set<string>();
    const candidates: ExplorerMatch[] = [];

    const push = (node: TreeNode) => {
      if (node.isDirectory || seen.has(node.path)) return;
      seen.add(node.path);
      const status = (node.gitStatus as GitFileStatusType | undefined)
        ?? explorerGitStatusMap.get(node.path);
      candidates.push({
        node: status && !node.gitStatus ? { ...node, gitStatus: status } : node,
        relPath: node.path.startsWith(`${root}/`) ? node.path.slice(root.length + 1) : node.path,
        status,
      });
    };

    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        if (node.isDirectory) { if (node.children) walk(node.children); }
        else push(node);
      }
    };
    walk(fileTree.tree);
    for (const hit of explorerHits) push(hit);

    const scored: Array<{ match: ExplorerMatch; score: number }> = [];
    for (const candidate of candidates) {
      const score = scoreFile(fileFilter, {
        name: candidate.node.name,
        path: candidate.relPath,
        status: candidate.status,
      });
      if (score !== null) scored.push({ match: candidate, score });
    }
    scored.sort((a, b) => b.score - a.score || a.match.relPath.localeCompare(b.match.relPath));
    return scored.map((s) => s.match);
  }, [panelMode, filterActive, explorerFolder, fileTree.tree, explorerHits, fileFilter, explorerGitStatusMap]);

  // Reset state when agent changes (component stays mounted across agent switches)
  useEffect(() => {
    if (prevAgentIdRef.current !== agentId) {
      prevAgentIdRef.current = agentId;
      hasAutoExpanded.current = false;
      treeDirsAutoExpandedRef.current = false;
      setExpandedRepos(new Set());
      setExpandedTreeDirs(new Set());
      setModalState(null);
      setExplorerFolderIdx(0);
      setExplorerSelectedPath(null);
      setFilterQuery('');
    }
  }, [agentId]);

  // Ask the server-side watcher to recompute now and push the result.
  // Called after git actions (stage/discard/commit/...) so all connected
  // clients see the effect immediately instead of on the next poll cycle.
  const refresh = useCallback(async () => {
    if (areaDirs.length === 0) return;
    requestGitRefresh(areaDirs);
  }, [areaDirsKey]);

  // Auto-expand all repos the first time changes appear for this agent —
  // except oversized ones (see AUTO_EXPAND_MAX_FILES), which the user opens
  // deliberately.
  useEffect(() => {
    if (!hasAutoExpanded.current && repos.length > 0) {
      hasAutoExpanded.current = true;
      setExpandedRepos(new Set(
        repos.filter(r => r.totalFiles <= AUTO_EXPAND_MAX_FILES).map(r => r.dir)
      ));
    }
  }, [repos]);

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

  // Git trees for the expanded repos. Built once per (repo files × expansion)
  // change and shared by the rendering and the modal's prev/next ordering.
  const displayTrees = useMemo(() => {
    const map = new Map<string, GitTreeNode[]>();
    if (viewMode !== 'tree') return map;
    for (const repo of displayRepos) {
      if (!isRepoExpanded(repo.dir)) continue;
      map.set(repo.dir, buildGitTree(repo.files));
    }
    return map;
  }, [viewMode, displayRepos, isRepoExpanded]);

  // While filtering in tree view, every directory holding a match is expanded
  // so results aren't buried behind collapsed folders.
  const filterExpandedTreeDirs = useMemo(() => {
    if (!filterActive || viewMode !== 'tree') return null;
    const dirs = new Set<string>();
    const walk = (nodes: GitTreeNode[]) => {
      for (const node of nodes) {
        if (!node.isDirectory || filterCollapsed.has(node.path)) continue;
        dirs.add(node.path);
        walk(node.children);
      }
    };
    for (const tree of displayTrees.values()) walk(tree);
    return dirs;
  }, [filterActive, viewMode, displayTrees, filterCollapsed]);

  // Build a flat ordered list of all changed files across repos (for modal navigation).
  // Order matches the visual rendering: flat view uses the filter's ranking,
  // tree view uses the sorted tree structure (dirs first, alphabetical).
  const allChangedFiles = useMemo(() => {
    const list: { file: GitFileStatus; repoDir: string }[] = [];

    // Path → file map instead of a per-node `files.find`: the linear scan made
    // this walk O(files²), which is minutes of blocked main thread on a repo
    // with thousands of changes.
    const collectTreeFiles = (
      nodes: GitTreeNode[],
      byPath: Map<string, GitFileStatus>,
      repoDir: string
    ) => {
      for (const node of nodes) {
        if (node.isDirectory) {
          collectTreeFiles(node.children, byPath, repoDir);
        } else {
          const file = byPath.get(node.path);
          if (file) list.push({ file, repoDir });
        }
      }
    };

    for (const repo of displayRepos) {
      if (!isRepoExpanded(repo.dir)) continue;
      if (viewMode === 'tree') {
        const tree = displayTrees.get(repo.dir);
        if (!tree) continue;
        const byPath = new Map(repo.files.map(f => [f.path, f]));
        collectTreeFiles(tree, byPath, repo.dir);
      } else {
        for (const file of repo.files) {
          list.push({ file, repoDir: repo.dir });
        }
      }
    }
    return list;
  }, [displayRepos, viewMode, isRepoExpanded, displayTrees]);

  // Navigate to previous/next file in the modal
  const navigateModal = useCallback(async (direction: -1 | 1) => {
    if (!modalState) return;
    const currentPath = modalState.data.filePath;
    const idx = allChangedFiles.findIndex(({ file, repoDir }) => {
      const fullPath = file.path.startsWith('/') ? file.path : `${repoDir.replace(/\/$/, '')}/${file.path}`;
      return fullPath === currentPath;
    });
    if (idx < 0) return;
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= allChangedFiles.length) return;
    const { file, repoDir } = allChangedFiles[nextIdx];
    await handleFileClick(file, repoDir);
  }, [modalState, allChangedFiles, handleFileClick]);

  // Current file index in the list (for disabling arrows at edges)
  const currentFileIndex = useMemo(() => {
    if (!modalState) return -1;
    const currentPath = modalState.data.filePath;
    return allChangedFiles.findIndex(({ file, repoDir }) => {
      const fullPath = file.path.startsWith('/') ? file.path : `${repoDir.replace(/\/$/, '')}/${file.path}`;
      return fullPath === currentPath;
    });
  }, [modalState, allChangedFiles]);

  const closeModal = useCallback(() => setModalState(null), []);
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Delete file with confirmation dialog
  const executeDelete = useCallback(async (pending: { path: string; name: string; status: GitFileStatusType; repoDir: string }) => {
    try {
      const res = await authFetch(apiUrl('/api/files/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pending.path }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Delete failed:', data.error);
      } else if (pending.status === 'added') {
        // File was staged in git index — unstage it so it doesn't linger as AD
        try {
          await authFetch(apiUrl('/api/files/git-discard'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              files: [{ path: pending.path, status: 'added' }],
              directory: pending.repoDir,
            }),
          });
        } catch { /* best effort */ }
      }
      refresh();
      if (panelMode === 'explorer') fileTree.loadTree();
    } catch (err) {
      console.error('Delete request failed:', err);
    } finally {
      setPendingDelete(null);
    }
  }, [refresh, panelMode, fileTree]);

  // Inline discard for a single file (with confirmation via pendingDiscard state)
  const [pendingDiscard, setPendingDiscard] = useState<{ path: string; name: string; status: GitFileStatusType; repoDir: string } | null>(null);
  const executeDiscard = useCallback(async (pending: { path: string; name: string; status: GitFileStatusType; repoDir: string }) => {
    try {
      const res = await authFetch(apiUrl('/api/files/git-discard'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [{ path: pending.path, status: pending.status }],
          directory: pending.repoDir,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        showToast('error', 'Discard Failed', data.error || 'Could not discard changes');
      }
      refresh();
    } catch (err) {
      showToast('error', 'Discard Failed', err instanceof Error ? err.message : 'Could not discard changes');
    } finally {
      setPendingDiscard(null);
    }
  }, [refresh, showToast]);

  // Discard ALL uncommitted changes in a single repo (server runs
  // `git reset --hard HEAD` + `git clean -fd`, scoped to that repo).
  const [pendingDiscardAll, setPendingDiscardAll] = useState<{ repoDir: string; dirName: string; count: number; untracked: number; truncated: boolean } | null>(null);
  const executeDiscardAll = useCallback(async (pending: { repoDir: string; dirName: string; count: number; untracked: number; truncated: boolean }) => {
    try {
      const res = await authFetch(apiUrl('/api/files/git-discard-all'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: pending.repoDir }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        showToast('error', 'Discard All Failed', data.error || 'Could not discard changes');
      } else {
        const data = await res.json().catch(() => ({ discarded: pending.count }));
        showToast('success', 'Changes Discarded', `Reverted ${data.discarded ?? pending.count} change(s) in ${pending.dirName}`);
      }
      refresh();
    } catch (err) {
      showToast('error', 'Discard All Failed', err instanceof Error ? err.message : 'Could not discard changes');
    } finally {
      setPendingDiscardAll(null);
    }
  }, [refresh, showToast]);

  // Discard every changed file under one folder subtree (reuses the batch
  // /git-discard endpoint — mixed statuses handled server-side: modified files
  // revert to HEAD, untracked/added files are removed). Confirmed first.
  const [pendingDiscardFolder, setPendingDiscardFolder] = useState<{ folderName: string; repoDir: string; files: Array<{ path: string; status: GitFileStatusType }> } | null>(null);
  const executeDiscardFolder = useCallback(async (pending: { folderName: string; repoDir: string; files: Array<{ path: string; status: GitFileStatusType }> }) => {
    try {
      const res = await authFetch(apiUrl('/api/files/git-discard'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: pending.files, directory: pending.repoDir }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        showToast('error', 'Discard Failed', data.error || 'Could not discard changes');
      } else {
        const data = await res.json().catch(() => ({ discarded: pending.files.length }));
        showToast('success', 'Changes Discarded', `Reverted ${data.discarded ?? pending.files.length} change(s) in ${pending.folderName}`);
      }
      refresh();
      if (panelMode === 'explorer') fileTree.loadTree();
    } catch (err) {
      showToast('error', 'Discard Failed', err instanceof Error ? err.message : 'Could not discard changes');
    } finally {
      setPendingDiscardFolder(null);
    }
  }, [refresh, showToast, panelMode, fileTree]);

  // Delete an entire folder from disk (recursive). Destructive — removes the
  // real directory and everything in it, not just git-changed files. Confirmed first.
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<{ folderPath: string; folderName: string; repoDir: string } | null>(null);
  const executeDeleteFolder = useCallback(async (pending: { folderPath: string; folderName: string; repoDir: string }) => {
    try {
      const res = await authFetch(apiUrl('/api/files/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pending.folderPath, recursive: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        showToast('error', 'Delete Failed', data.error || 'Could not delete folder');
      } else {
        showToast('success', 'Folder Deleted', `Deleted ${pending.folderName}`);
      }
      refresh();
      if (panelMode === 'explorer') fileTree.loadTree();
    } catch (err) {
      showToast('error', 'Delete Failed', err instanceof Error ? err.message : 'Could not delete folder');
    } finally {
      setPendingDeleteFolder(null);
    }
  }, [refresh, showToast, panelMode, fileTree]);

  const handleInlineDiscard = useCallback((e: React.MouseEvent, file: GitFileStatus, repoDir: string) => {
    e.stopPropagation();
    const fullPath = file.path.startsWith('/') ? file.path : `${repoDir.replace(/\/$/, '')}/${file.path}`;
    if (file.status === 'untracked' || file.status === 'added') {
      // For untracked/added: delete file
      setPendingDelete({ path: fullPath, name: file.name, status: file.status, repoDir });
    } else {
      // For modified/deleted/renamed: discard changes
      setPendingDiscard({ path: fullPath, name: file.name, status: file.status, repoDir });
    }
  }, []);

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
      icon: <Icon name={hasDiff(file.status) ? 'git-diff' : 'file-text'} size={14} />,
      onClick: () => handleFileClick(file, repoDir),
    });

    actions.push({ id: 'div1', label: '', divider: true, onClick: () => {} });

    // Copy paths
    actions.push({
      id: 'copy-path',
      label: 'Copy Full Path',
      icon: <Icon name="pin" size={14} />,
      onClick: () => { navigator.clipboard.writeText(fullPath); },
    });
    actions.push({
      id: 'copy-rel',
      label: 'Copy Relative Path',
      icon: <Icon name="copy" size={14} />,
      onClick: () => { navigator.clipboard.writeText(file.path); },
    });

    // Open in editor
    if (file.status !== 'deleted') {
      actions.push({ id: 'div2', label: '', divider: true, onClick: () => {} });
      actions.push({
        id: 'open-editor',
        label: 'Open in Editor',
        icon: <Icon name="edit" size={14} />,
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
        icon: <Icon name="revert" size={14} />,
        danger: true,
        // Route through the confirmation dialog — discarding is irreversible.
        onClick: () => setPendingDiscard({ path: fullPath, name: file.name, status: file.status, repoDir }),
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
        icon: <Icon name="trash" size={14} />,
        danger: true,
        onClick: () => setPendingDelete({ path: fullPath, name: file.name, status: file.status, repoDir }),
      });
    }

    setContextMenu({ isOpen: true, position: { x: e.clientX, y: e.clientY }, actions });
  }, [handleFileClick]);

  // Context menu for a folder node in the Changes-tab tree view.
  // Offers "Discard Changes" (all changed files under the folder) and
  // "Delete Folder" (remove the real directory from disk). Both confirm first.
  const handleGitFolderContextMenu = useCallback((e: React.MouseEvent, node: GitTreeNode, repoDir: string) => {
    e.preventDefault();
    e.stopPropagation();
    const changed = collectFilesFromGitNode(node);
    const absFiles = changed.map((f) => ({
      path: f.path.startsWith('/') ? f.path : `${repoDir.replace(/\/$/, '')}/${f.path}`,
      status: f.status,
    }));
    // git-status returns absolute paths, so buildGitTree's directory node.path is
    // already absolute — guard against double-prefixing (which caused "File not found").
    const folderPath = node.path.startsWith('/') ? node.path : `${repoDir.replace(/\/$/, '')}/${node.path}`;
    const actions: ContextMenuAction[] = [];

    actions.push({
      id: 'copy-path',
      label: 'Copy Full Path',
      icon: <Icon name="pin" size={14} />,
      onClick: () => { navigator.clipboard.writeText(folderPath); },
    });

    actions.push({ id: 'div1', label: '', divider: true, onClick: () => {} });

    if (absFiles.length > 0) {
      actions.push({
        id: 'discard-folder',
        label: `Discard Changes (${absFiles.length})`,
        icon: <Icon name="revert" size={14} />,
        danger: true,
        onClick: () => setPendingDiscardFolder({ folderName: node.name, repoDir, files: absFiles }),
      });
    }

    actions.push({
      id: 'delete-folder',
      label: 'Delete Folder',
      icon: <Icon name="trash" size={14} />,
      danger: true,
      onClick: () => setPendingDeleteFolder({ folderPath, folderName: node.name, repoDir }),
    });

    setContextMenu({ isOpen: true, position: { x: e.clientX, y: e.clientY }, actions });
  }, []);

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
        icon: <Icon name="file-text" size={14} />,
        onClick: () => handleExplorerFileSelect(node),
      });
      actions.push({ id: 'div1', label: '', divider: true, onClick: () => {} });
    }

    // Copy path
    actions.push({
      id: 'copy-path',
      label: 'Copy Full Path',
      icon: <Icon name="pin" size={14} />,
      onClick: () => { navigator.clipboard.writeText(node.path); },
    });

    if (explorerFolder) {
      const relPath = node.path.startsWith(explorerFolder)
        ? node.path.slice(explorerFolder.replace(/\/$/, '').length + 1)
        : node.path;
      actions.push({
        id: 'copy-rel',
        label: 'Copy Relative Path',
        icon: <Icon name="copy" size={14} />,
        onClick: () => { navigator.clipboard.writeText(relPath); },
      });
    }

    if (!node.isDirectory) {
      actions.push({ id: 'div2', label: '', divider: true, onClick: () => {} });
      actions.push({
        id: 'open-editor',
        label: 'Open in Editor',
        icon: <Icon name="edit" size={14} />,
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
        icon: <Icon name="trash" size={14} />,
        danger: true,
        onClick: () => setPendingDelete({ path: node.path, name: node.name, status: (node.gitStatus as GitFileStatusType) || 'untracked', repoDir: explorerFolder || '' }),
      });
    } else {
      // Directory node: discard git changes under it + delete the folder from disk.
      const changed = collectGitFilesFromExplorerNode(node); // explorer node paths are absolute
      actions.push({ id: 'div-dir', label: '', divider: true, onClick: () => {} });
      if (changed.length > 0 && explorerFolder) {
        actions.push({
          id: 'discard-folder',
          label: `Discard Changes (${changed.length})`,
          icon: <Icon name="revert" size={14} />,
          danger: true,
          onClick: () => setPendingDiscardFolder({ folderName: node.name, repoDir: explorerFolder, files: changed }),
        });
      }
      actions.push({
        id: 'delete-folder',
        label: 'Delete Folder',
        icon: <Icon name="trash" size={14} />,
        danger: true,
        onClick: () => setPendingDeleteFolder({ folderPath: node.path, folderName: node.name, repoDir: explorerFolder || '' }),
      });
    }

    setContextMenu({ isOpen: true, position: { x: e.clientX, y: e.clientY }, actions });
  }, [handleExplorerFileSelect, explorerFolder]);

  const totalFiles = repos.reduce((sum, r) => sum + r.totalFiles, 0);

  // Escape inside the filter clears it (and only then hands Escape back to the
  // global shortcut, which would otherwise close the whole terminal — see the
  // data-escape-local opt-out in useKeyboardShortcuts).
  const handleFilterKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    if (e.currentTarget.value) setFilterQuery('');
    else e.currentTarget.blur();
  }, []);

  // Close modal on Escape — use stopImmediatePropagation so the global
  // useKeyboardShortcuts capture-phase listener (also on document) doesn't
  // also fire and close the guake terminal itself.
  useEffect(() => {
    if (!modalState && !pendingDelete && !pendingDiscard && !pendingDiscardAll && !pendingDiscardFolder && !pendingDeleteFolder) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (pendingDeleteFolder) {
          setPendingDeleteFolder(null);
        } else if (pendingDiscardFolder) {
          setPendingDiscardFolder(null);
        } else if (pendingDiscardAll) {
          setPendingDiscardAll(null);
        } else if (pendingDiscard) {
          setPendingDiscard(null);
        } else if (pendingDelete) {
          setPendingDelete(null);
        } else {
          closeModal();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [modalState, closeModal, pendingDelete, pendingDiscard, pendingDiscardAll, pendingDiscardFolder, pendingDeleteFolder]);

  // Register git modals on the modal stack so other Escape handlers
  // (e.g. useKeyboardShortcuts) know a modal is open and skip closing the terminal.
  useModalStackRegistration('guake-git-diff-modal', modalState !== null, closeModal);
  useModalStackRegistration('guake-git-delete-confirm', pendingDelete !== null, () => setPendingDelete(null));
  useModalStackRegistration('guake-git-discard-confirm', pendingDiscard !== null, () => setPendingDiscard(null));
  useModalStackRegistration('guake-git-discard-all-confirm', pendingDiscardAll !== null, () => setPendingDiscardAll(null));
  useModalStackRegistration('guake-git-discard-folder-confirm', pendingDiscardFolder !== null, () => setPendingDiscardFolder(null));
  useModalStackRegistration('guake-git-delete-folder-confirm', pendingDeleteFolder !== null, () => setPendingDeleteFolder(null));

  // Auto-expand tree dirs on first tree view. The ref makes it once-per-agent:
  // keying on size===0 alone would re-expand everything right after the
  // user's explicit "Collapse all".
  useEffect(() => {
    if (treeDirsAutoExpandedRef.current) return;
    if (viewMode === 'tree' && expandedTreeDirs.size === 0 && repos.length > 0) {
      treeDirsAutoExpandedRef.current = true;
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
    {/* Delete Confirmation */}
    {pendingDelete && (
      <div className="guake-git-diff-modal-overlay" onClick={() => setPendingDelete(null)}>
        <div className="guake-git-delete-confirm" onClick={(e) => e.stopPropagation()}>
          <p>Delete <strong>{pendingDelete.name}</strong>?</p>
          <p className="guake-git-delete-path">{pendingDelete.path}</p>
          <div className="guake-git-delete-actions">
            <button className="guake-git-delete-cancel" onClick={() => setPendingDelete(null)}>Cancel</button>
            <button className="guake-git-delete-btn" onClick={() => executeDelete(pendingDelete)}>Delete</button>
          </div>
        </div>
      </div>
    )}

    {/* Discard Confirmation */}
    {pendingDiscard && (
      <div className="guake-git-diff-modal-overlay" onClick={() => setPendingDiscard(null)}>
        <div className="guake-git-delete-confirm" onClick={(e) => e.stopPropagation()}>
          <p>Discard changes to <strong>{pendingDiscard.name}</strong>?</p>
          <p className="guake-git-delete-path">{pendingDiscard.path}</p>
          <div className="guake-git-delete-actions">
            <button className="guake-git-delete-cancel" onClick={() => setPendingDiscard(null)}>Cancel</button>
            <button className="guake-git-delete-btn" onClick={() => executeDiscard(pendingDiscard)}>Discard</button>
          </div>
        </div>
      </div>
    )}

    {/* Discard-All Confirmation — destructive, irreversible */}
    {pendingDiscardAll && (
      <div className="guake-git-diff-modal-overlay" onClick={() => setPendingDiscardAll(null)}>
        <div className="guake-git-delete-confirm" onClick={(e) => e.stopPropagation()}>
          <p>
            Permanently discard <strong>{pendingDiscardAll.count}</strong> uncommitted change{pendingDiscardAll.count === 1 ? '' : 's'} in <strong>{pendingDiscardAll.dirName}</strong>?
          </p>
          <p className="guake-git-delete-path">
            {/* On a truncated repo the untracked tally only covers the capped
                slice — never quote a number that understates what gets deleted. */}
            Resets all tracked files to HEAD
            {pendingDiscardAll.truncated
              ? ' and deletes every untracked file'
              : pendingDiscardAll.untracked > 0
                ? ` and deletes ${pendingDiscardAll.untracked} untracked file${pendingDiscardAll.untracked === 1 ? '' : 's'}`
                : ''}. This cannot be undone.
          </p>
          <div className="guake-git-delete-actions">
            <button className="guake-git-delete-cancel" onClick={() => setPendingDiscardAll(null)}>Cancel</button>
            <button className="guake-git-delete-btn" onClick={() => executeDiscardAll(pendingDiscardAll)}>Discard all</button>
          </div>
        </div>
      </div>
    )}

    {/* Discard-Folder Confirmation — reverts every changed file under the folder */}
    {pendingDiscardFolder && (
      <div className="guake-git-diff-modal-overlay" onClick={() => setPendingDiscardFolder(null)}>
        <div className="guake-git-delete-confirm" onClick={(e) => e.stopPropagation()}>
          <p>
            Discard <strong>{pendingDiscardFolder.files.length}</strong> change{pendingDiscardFolder.files.length === 1 ? '' : 's'} in <strong>{pendingDiscardFolder.folderName}</strong>?
          </p>
          <p className="guake-git-delete-path">
            Reverts tracked files to HEAD and removes any untracked/new files in this folder. This cannot be undone.
          </p>
          <div className="guake-git-delete-actions">
            <button className="guake-git-delete-cancel" onClick={() => setPendingDiscardFolder(null)}>Cancel</button>
            <button className="guake-git-delete-btn" onClick={() => executeDiscardFolder(pendingDiscardFolder)}>Discard</button>
          </div>
        </div>
      </div>
    )}

    {/* Delete-Folder Confirmation — removes the real directory from disk */}
    {pendingDeleteFolder && (
      <div className="guake-git-diff-modal-overlay" onClick={() => setPendingDeleteFolder(null)}>
        <div className="guake-git-delete-confirm" onClick={(e) => e.stopPropagation()}>
          <p>Delete folder <strong>{pendingDeleteFolder.folderName}</strong>?</p>
          <p className="guake-git-delete-path">{pendingDeleteFolder.folderPath}</p>
          <p className="guake-git-delete-path">
            Permanently removes this folder and everything inside it from disk. This cannot be undone.
          </p>
          <div className="guake-git-delete-actions">
            <button className="guake-git-delete-cancel" onClick={() => setPendingDeleteFolder(null)}>Cancel</button>
            <button className="guake-git-delete-btn" onClick={() => executeDeleteFolder(pendingDeleteFolder)}>Delete folder</button>
          </div>
        </div>
      </div>
    )}

    {/* Diff / Content Modal */}
    {modalState && (
      <div className="guake-git-diff-modal-overlay" onClick={closeModal}>
        <div className="guake-git-diff-modal" onClick={(e) => e.stopPropagation()}>
          <div className="guake-git-diff-modal-header">
            {panelMode === 'changes' && (
              <div className="guake-git-diff-nav">
                <button
                  className="guake-git-diff-nav-btn"
                  onClick={() => navigateModal(-1)}
                  disabled={currentFileIndex <= 0}
                  title="Previous file"
                >
                  <Icon name="caret-right" size={14} style={{ transform: 'rotate(180deg)' }} />
                </button>
                <button
                  className="guake-git-diff-nav-btn"
                  onClick={() => navigateModal(1)}
                  disabled={currentFileIndex < 0 || currentFileIndex >= allChangedFiles.length - 1}
                  title="Next file"
                >
                  <Icon name="caret-right" size={14} />
                </button>
                {currentFileIndex >= 0 && (
                  <span className="guake-git-diff-nav-counter">
                    {currentFileIndex + 1} / {allChangedFiles.length}
                  </span>
                )}
              </div>
            )}
            <span className="guake-git-diff-filename" title={modalState.data.filePath}>
              {modalState.data.filePath}
              {modalState.type === 'content' && modalState.isNewFile && (
                <span className="guake-git-content-badge">new file</span>
              )}
            </span>
            <button className="guake-git-close" onClick={closeModal} title="Close (Esc)"><Icon name="close" size={14} /></button>
          </div>
          <div className="guake-git-diff-content">
            {diffLoading && (
              <div className="guake-git-diff-loading-overlay">
                <div className="diff-image-spinner" />
              </div>
            )}
            {modalState.type === 'diff' ? (
              <DiffViewer
                originalContent={modalState.data.originalContent}
                modifiedContent={modalState.data.modifiedContent}
                filename={modalState.data.fileName}
                filePath={modalState.data.filePath}
                language={modalState.data.language}
              />
            ) : (
              <DiffViewer
                originalContent=""
                modifiedContent={modalState.data.content}
                filename={modalState.data.fileName}
                filePath={modalState.data.filePath}
                language={modalState.data.language}
                initialModifiedOnly
              />
            )}
          </div>
        </div>
      </div>
    )}

    <div className="guake-git-panel">
      {(fileTree.loading || diffLoading) && <div className="guake-git-panel-loadbar" />}
      {onResizeStart && (
        <div
          className="guake-side-panel-resize right guake-git-panel__resize"
          onMouseDown={onResizeStart}
          title="Drag to resize"
        />
      )}
      <div className="guake-git-header">
        <div className="guake-git-title">
          <div className="guake-git-tabs">
            <button
              className={`guake-git-tab ${panelMode === 'changes' ? 'active' : ''}`}
              onClick={() => setPanelMode('changes')}
            >
              <Icon name="git-branch" size={14} /> Changes
              {totalFiles > 0 && <span className="guake-git-badge">{totalFiles}</span>}
            </button>
            <button
              className={`guake-git-tab ${panelMode === 'explorer' ? 'active' : ''}`}
              onClick={() => setPanelMode('explorer')}
            >
              <Icon name="folder" size={14} /> Files
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
            {fetchingDirs.size > 0 ? <Icon name="status-starting" size={14} /> : <Icon name="arrow-down" size={14} />}
          </button>
          {graphRepos.length > 0 && (
            <button
              className="guake-git-graph-btn"
              onClick={() => setGraphRepo(graphRepos[0])}
              // Warm the first page while the pointer travels to the button, so
              // the modal opens from cache instead of a cold round trip.
              onMouseEnter={() => {
                const target = graphRepos[0];
                if (!target) return;
                prefetchGraph(target.dir, buildGraphParams(target.dir, loadGitGraphFilters(target.dir), 0));
              }}
              title="Branch graph"
            ><Icon name="git-branch" size={14} /></button>
          )}
          {panelMode === 'changes' && (
            <>
              <button
                className={`guake-git-view-toggle ${viewMode === 'flat' ? 'active' : ''}`}
                onClick={() => setViewMode('flat')}
                title="Flat view"
              ><Icon name="list" size={14} /></button>
              <button
                className={`guake-git-view-toggle ${viewMode === 'tree' ? 'active' : ''}`}
                onClick={() => setViewMode('tree')}
                title="Tree view"
              ><Icon name="tree" size={14} /></button>
              {viewMode === 'tree' && (
                <button className="guake-git-refresh" onClick={collapseAllTree} title="Collapse all">
                  <Icon name="caret-double-up" size={14} />
                </button>
              )}
              <button className="guake-git-refresh" onClick={refresh} title="Refresh" disabled={loading}>
                {loading ? <Icon name="status-starting" size={14} /> : <Icon name="refresh" size={14} />}
              </button>
            </>
          )}
          {panelMode === 'explorer' && (
            <>
              <button className="guake-git-refresh" onClick={collapseAllTree} title="Collapse all">
                <Icon name="caret-double-up" size={14} />
              </button>
              <button className="guake-git-refresh" onClick={() => fileTree.loadTree()} title="Refresh" disabled={fileTree.loading}>
                {fileTree.loading ? <Icon name="status-starting" size={14} /> : <Icon name="refresh" size={14} />}
              </button>
            </>
          )}
          <button className="guake-git-close" onClick={onClose} title="Close"><Icon name="close" size={14} /></button>
        </div>
      </div>

      {((panelMode === 'changes' && repos.length > 0) || (panelMode === 'explorer' && !!explorerFolder)) && (
        <div className="guake-git-filter" title={FILTER_HELP}>
          <span className="guake-git-filter-icon"><Icon name="search" size={12} /></span>
          <input
            className="guake-git-filter-input"
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            onKeyDown={handleFilterKeyDown}
            placeholder="Filter files —  src/  .tsx  !test  status:mod"
            spellCheck={false}
            autoComplete="off"
            data-escape-local="true"
          />
          {filterActive && (
            <span className="guake-git-filter-count">
              {panelMode === 'changes'
                ? `${totalMatches}/${totalFiles}`
                : explorerSearching ? '…' : explorerMatches.length}
            </span>
          )}
          {filterQuery && (
            <button
              className="guake-git-filter-clear"
              onClick={() => setFilterQuery('')}
              title="Clear filter (Esc)"
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}

      <div className={`guake-git-body${panelMode === 'explorer' ? ' explorer-compact' : ''}`}>
        {/* ===== CHANGES TAB ===== */}
        {panelMode === 'changes' && (
          <>
            {loading && repos.length === 0 && (
              <div className="guake-git-loading">Loading git status...</div>
            )}

            {!loading && repos.length === 0 && (
              <div className="guake-git-empty">No git changes found</div>
            )}

            {repos.length > 0 && displayRepos.length === 0 && (
              <div className="guake-git-empty">
                No changed file matches <code>{filterQuery.trim()}</code>
                <button className="guake-git-filter-reset" onClick={() => setFilterQuery('')}>
                  Clear filter
                </button>
              </div>
            )}

            {displayRepos.map(({ dir, dirName, gitStatus, files, matchCount, hiddenMatches, totalFiles: repoTotalFiles, truncated }) => {
              const bi = branchInfoMap.get(dir);
              const expanded = isRepoExpanded(dir);
              return (
              <div key={dir} className="guake-git-repo">
                <div
                  className={`guake-git-repo-header ${expanded ? 'expanded' : ''}`}
                  onClick={() => (filterActive ? toggleFilterCollapsed(dir) : toggleRepo(dir))}
                >
                  <span className="guake-git-repo-arrow"><Icon name={expanded ? 'caret-down' : 'caret-right'} size={12} /></span>
                  <span className="guake-git-repo-name">{dirName}</span>
                  {gitStatus.branch && (
                    <span className="guake-git-repo-branch"><Icon name="git-branch" size={10} /> {gitStatus.branch}</span>
                  )}
                  {bi && bi.ahead > 0 && <span className="guake-branch-ahead"><Icon name="arrow-up" size={9} />{bi.ahead}</span>}
                  {bi && bi.behind > 0 && <span className="guake-branch-behind"><Icon name="arrow-down" size={9} />{bi.behind}</span>}
                  <span className="guake-git-repo-count">
                    {filterActive ? `${matchCount}/${repoTotalFiles}` : repoTotalFiles}
                  </span>
                  <button
                    className="git-discard-all-btn"
                    title="Discard all changes in this repo"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDiscardAll({
                        repoDir: dir,
                        dirName,
                        count: repoTotalFiles,
                        untracked: gitStatus.files.filter((f) => f.status === 'untracked').length,
                        truncated,
                      });
                    }}
                  >
                    <Icon name="revert" size={12} />
                  </button>
                </div>

                {expanded && truncated && (
                  <div className="guake-git-truncated-notice">
                    Showing {gitStatus.files.length} of {repoTotalFiles} changes. Add the
                    generated paths to .gitignore to see the rest.
                  </div>
                )}

                {expanded && hiddenMatches > 0 && (
                  <div className="guake-git-truncated-notice">
                    Showing the top {FILTER_RENDER_CAP} of {matchCount} matches — refine the filter
                    to narrow it down.
                  </div>
                )}

                {expanded && viewMode === 'flat' && (
                  <div className="guake-git-file-list">
                    {files.map((file) => {
                      const cfg = GIT_STATUS_CONFIG[file.status];
                      const iconSrc = getIconForFileName(file.name);
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
                          <span className="guake-git-file-name">
                            <HighlightedText text={file.name} filter={fileFilter} />
                          </span>
                          <span className="guake-git-file-dir">
                            <HighlightedText
                              text={file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : ''}
                              filter={fileFilter}
                            />
                          </span>
                          <span className="guake-git-file-status" style={{ color: cfg.color }} title={cfg.label}>
                            {cfg.icon}
                          </span>
                          <button
                            className="guake-git-discard-btn"
                            title={file.status === 'untracked' || file.status === 'added' ? 'Delete file' : 'Discard changes'}
                            onClick={(e) => handleInlineDiscard(e, file, dir)}
                          >
                            <Icon name="revert" size={12} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {expanded && viewMode === 'tree' && (
                  <div className="guake-git-file-list">
                    {(displayTrees.get(dir) ?? []).map((node) => (
                      <TreeNodeView
                        key={node.path}
                        node={node}
                        depth={0}
                        expandedDirs={filterExpandedTreeDirs ?? expandedTreeDirs}
                        onToggleDir={filterActive ? toggleFilterCollapsed : toggleTreeDir}
                        onFileClick={handleFileClick}
                        onContextMenu={handleGitFileContextMenu}
                        onFolderContextMenu={handleGitFolderContextMenu}
                        onDiscard={handleInlineDiscard}
                        repoDir={dir}
                        filter={fileFilter}
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
                      <Icon name="folder-open" size={14} /> {name}
                      {folderBi && <span className="guake-git-folder-branch"> <Icon name="git-branch" size={10} /> {folderBi.branch}</span>}
                      {folderBi && folderBi.ahead > 0 && <span className="guake-branch-ahead"><Icon name="arrow-up" size={9} />{folderBi.ahead}</span>}
                      {folderBi && folderBi.behind > 0 && <span className="guake-branch-behind"><Icon name="arrow-down" size={9} />{folderBi.behind}</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {fileTree.loading && fileTree.tree.length === 0 && (
              <div className="guake-git-loading">Loading files...</div>
            )}

            {!fileTree.loading && fileTree.tree.length === 0 && !filterActive && (
              <div className="guake-git-empty">No files found</div>
            )}

            {/* Filtering flattens the tree into ranked results: the folder is
                lazy-loaded, so matches deeper than the loaded levels only exist
                as server hits and have no branch to hang off. */}
            {filterActive ? (
              <div className="guake-git-file-list">
                {explorerMatches.length === 0 ? (
                  <div className="guake-git-empty">
                    {explorerSearching ? 'Searching…' : (
                      <>
                        No file matches <code>{filterQuery.trim()}</code>
                        <button className="guake-git-filter-reset" onClick={() => setFilterQuery('')}>
                          Clear filter
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {explorerMatches.slice(0, FILTER_RENDER_CAP).map(({ node, relPath, status }) => {
                      const cfg = status ? GIT_STATUS_CONFIG[status] : null;
                      const iconSrc = getIconForFileName(node.name);
                      const dirPart = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '';
                      return (
                        <div
                          key={node.path}
                          className="guake-git-file"
                          data-status={status}
                          onClick={() => handleExplorerFileSelect(node)}
                          onContextMenu={(e) => handleExplorerContextMenu(e, node)}
                          title={node.path}
                        >
                          {iconSrc && <img src={iconSrc} alt="" className="guake-git-file-icon" />}
                          <span className="guake-git-file-name">
                            <HighlightedText text={node.name} filter={fileFilter} />
                          </span>
                          <span className="guake-git-file-dir">
                            <HighlightedText text={dirPart} filter={fileFilter} />
                          </span>
                          {cfg && (
                            <span className="guake-git-file-status" style={{ color: cfg.color }} title={cfg.label}>
                              {cfg.icon}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {explorerMatches.length > FILTER_RENDER_CAP && (
                      <div className="guake-git-truncated-notice">
                        Showing the top {FILTER_RENDER_CAP} of {explorerMatches.length} matches —
                        refine the filter to narrow it down.
                      </div>
                    )}
                  </>
                )}
              </div>
            ) : (
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
            )}
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

    {graphRepo && (
      <GitGraphModal
        repos={graphRepos}
        initialDir={graphRepo.dir}
        onClose={() => setGraphRepo(null)}
      />
    )}
    </>
  );
}
