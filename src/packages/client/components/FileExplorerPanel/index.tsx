/**
 * FileExplorerPanel - Main orchestrator component
 *
 * IDE-style file explorer with file tree, git integration, and syntax highlighting.
 * Following ClaudeOutputPanel's architecture patterns.
 */

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore, store } from '../../store';
import { matchesShortcut } from '../../store/shortcuts';
import { DiffViewer } from '../DiffViewer';
import { apiUrl, authFetch } from '../../utils/storage';

// Types
import type {
  FileExplorerPanelProps,
  ViewMode,
  TreeNode,
  GitFileStatusType,
  FolderInfo,
  ContentMatch,
  FileTab,
  ConflictVersions,
  BranchCompareResult,
} from './types';

// Hooks
import { useFileTree } from './useFileTree';
import { useGitStatus, loadGitOriginalContent } from './useGitStatus';
import { useFileContent } from './useFileContent';
import { useFileExplorerStorage } from './useFileExplorerStorage';
import { useTreePanelResize } from './useTreePanelResize';
import { useGitBranches } from './useGitBranches';
import { useToast } from '../Toast';

// Components
import { TreeNodeItem } from './TreeNodeItem';
import { FileViewer } from './FileViewer';
import { UnifiedSearchResults } from './UnifiedSearchResults';
import { GitChanges } from './GitChanges';
import { FileTabs } from './FileTabs';
import { BranchWidget } from './BranchWidget';
import { ConflictResolver } from './ConflictResolver';
import { BranchComparison } from './BranchComparison';
import { ContextMenu } from '../ContextMenu';
import type { ContextMenuAction } from '../ContextMenu';

// Constants
import { EXTENSION_TO_LANGUAGE } from './constants';

interface RenameDialogState {
  isOpen: boolean;
  node: TreeNode | null;
  value: string;
  submitting: boolean;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function FileExplorerPanel({
  isOpen,
  areaId,
  onClose,
  onChangeArea,
  folderPath,
}: FileExplorerPanelProps) {
  const { t } = useTranslation(['terminal', 'common']);
  const state = useStore();

  // -------------------------------------------------------------------------
  // AREA & FOLDER STATE
  // -------------------------------------------------------------------------

  // Direct folder mode is used for standalone folder openings (e.g. folder buildings)
  // If areaId is also present, we stay in area mode and use folderPath as initial folder selection.
  const isDirectFolderMode = !!folderPath && !areaId;

  const area = !isDirectFolderMode && areaId ? state.areas.get(areaId) : null;
  const directories = isDirectFolderMode ? [folderPath] : (area?.directories || []);
  const allAreas = Array.from(state.areas.values());

  const [selectedFolderIndex, setSelectedFolderIndex] = useState(0);
  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(null);
  const [showFolderSelector, setShowFolderSelector] = useState(false);

  const currentFolder = directories[selectedFolderIndex] || directories[0] || null;
  const currentFolderName = currentFolder?.split('/').pop() || currentFolder || '';

  // Reset folder index when switching modes or folder path changes
  useEffect(() => {
    setSelectedFolderIndex(0);
  }, [folderPath, isDirectFolderMode]);

  // If a specific folder was requested with an area, use it as pending selection.
  useEffect(() => {
    if (!isDirectFolderMode && folderPath) {
      setPendingFolderPath(folderPath);
    }
  }, [isDirectFolderMode, folderPath]);

  // Persist last opened folder/area so re-opening without a target restores it
  useEffect(() => {
    if (!isOpen) return;
    try {
      if (isDirectFolderMode && folderPath) {
        localStorage.setItem('file-explorer-last-opened', JSON.stringify({ type: 'folder', path: folderPath }));
      } else if (areaId) {
        localStorage.setItem('file-explorer-last-opened', JSON.stringify({ type: 'area', areaId }));
      }
    } catch { /* ignore */ }
  }, [isOpen, isDirectFolderMode, folderPath, areaId]);

  // Get all folders from all areas for the folder selector
  const allFolders = useMemo<FolderInfo[]>(() => {
    const folders: FolderInfo[] = [];
    for (const a of allAreas) {
      for (const dir of a.directories) {
        folders.push({
          path: dir,
          areaId: a.id,
          areaName: a.name,
          areaColor: a.color,
        });
      }
    }
    return folders;
  }, [allAreas]);

  // -------------------------------------------------------------------------
  // HOOKS
  // -------------------------------------------------------------------------

  const {
    tree,
    loading: treeLoading,
    expandedPaths,
    loadTree,
    reloadDirectory,
    renamePathInTree,
    togglePath,
    expandToPath,
    setExpandedPaths,
  } = useFileTree(currentFolder);

  const {
    gitStatus,
    loading: gitLoading,
    loadGitStatus,
  } = useGitStatus(currentFolder);

  const {
    mergeBranch,
    mergeAbort,
    mergeContinue,
  } = useGitBranches();

  const { showToast } = useToast();

  const {
    file: selectedFile,
    loading: fileLoading,
    error: fileError,
    loadFile,
    clearFile,
    setFile: setSelectedFile,
  } = useFileContent();

  // Tree panel resize
  const { treePanelWidth, handleResizeStart, isResizing } = useTreePanelResize();

  // Storage hook for persistence
  const { loadStoredState, saveState } = useFileExplorerStorage({
    areaId: areaId || null,
    folderPath: folderPath || null,
    isOpen,
  });

  // -------------------------------------------------------------------------
  // LOCAL STATE
  // -------------------------------------------------------------------------

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('files');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TreeNode[]>([]);
  const [contentSearchResults, setContentSearchResults] = useState<ContentMatch[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [selectedGitStatus, setSelectedGitStatus] = useState<GitFileStatusType | null>(null);
  const [hasInitializedView, setHasInitializedView] = useState(false);
  const [hasRestoredState, setHasRestoredState] = useState(false);
  const [treePanelCollapsed, setTreePanelCollapsed] = useState(false);
  const [stagingPaths, setStagingPaths] = useState<Set<string>>(new Set());
  const [isFileSearchActive, setIsFileSearchActive] = useState(false);
  const [fileTreeContextMenu, setFileTreeContextMenu] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    node: TreeNode;
  } | null>(null);
  const [fileClipboard, setFileClipboard] = useState<{
    sourcePath: string;
    isDirectory: boolean;
    name: string;
  } | null>(null);
  const [renameDialog, setRenameDialog] = useState<RenameDialogState>({
    isOpen: false,
    node: null,
    value: '',
    submitting: false,
  });

  // File tabs state
  const [openTabs, setOpenTabs] = useState<FileTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);

  // Line number to scroll to (from file:line search)
  const [scrollToLine, setScrollToLine] = useState<number | undefined>(undefined);

  // Merge/conflict state
  const [mergingBranch, setMergingBranch] = useState<string | null>(null);
  const [conflictFile, setConflictFile] = useState<string | null>(null);
  const [conflictVersions, setConflictVersions] = useState<ConflictVersions | null>(null);
  const [conflictLoading, setConflictLoading] = useState(false);

  // Branch comparison state
  const [compareResult, setCompareResult] = useState<BranchCompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const [compareBranch, setCompareBranch] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // REFS
  // -------------------------------------------------------------------------

  const searchInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // STORAGE PERSISTENCE
  // -------------------------------------------------------------------------

  // Ref to hold expanded paths that should be applied after loadTree completes
  const pendingExpandedPathsRef = useRef<Set<string> | null>(null);

  // Restore state from localStorage when panel opens
  useEffect(() => {
    if (!isOpen || hasRestoredState) return;

    const restoreState = async () => {
      const stored = await loadStoredState();
      if (stored) {
        let nextFolderIndex = stored.selectedFolderIndex;

        // If user selected a folder from another area, prioritize that explicit choice.
        if (pendingFolderPath) {
          const pendingIndex = directories.indexOf(pendingFolderPath);
          nextFolderIndex = pendingIndex >= 0 ? pendingIndex : 0;
          setPendingFolderPath(null);
        } else {
          // Clamp stale persisted index to current directories list.
          const maxIndex = Math.max(0, directories.length - 1);
          nextFolderIndex = Math.min(Math.max(0, nextFolderIndex), maxIndex);
        }

        setOpenTabs(stored.tabs);
        setActiveTabPath(stored.activeTabPath);
        setViewMode(stored.viewMode);
        setSelectedFolderIndex(nextFolderIndex);
        setExpandedPaths(stored.expandedPaths);
        // Store pending paths so they survive loadTree's reset
        pendingExpandedPathsRef.current = stored.expandedPaths;
        // Mark view as initialized so auto-switch to git tab doesn't override restored preference
        setHasInitializedView(true);

        // Load the active tab's file content
        if (stored.activeTabPath) {
          setSelectedPath(stored.activeTabPath);
          loadFile(stored.activeTabPath);
        }
      }
      setHasRestoredState(true);
    };

    restoreState();
  }, [isOpen, hasRestoredState, loadStoredState, setExpandedPaths, loadFile, pendingFolderPath, directories]);

  // Re-apply stored expanded paths after tree loads (loadTree resets expandedPaths to root-only)
  useEffect(() => {
    if (pendingExpandedPathsRef.current && !treeLoading && tree.length > 0) {
      setExpandedPaths(pendingExpandedPathsRef.current);
      pendingExpandedPathsRef.current = null;
    }
  }, [treeLoading, tree, setExpandedPaths]);

  // Save state to localStorage when it changes
  useEffect(() => {
    if (!isOpen || !hasRestoredState) return;

    // Debounce saves to avoid excessive writes
    const timeoutId = setTimeout(() => {
      saveState({
        tabs: openTabs,
        activeTabPath,
        viewMode,
        selectedFolderIndex,
        expandedPaths,
      });
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [isOpen, hasRestoredState, openTabs, activeTabPath, viewMode, selectedFolderIndex, expandedPaths, saveState]);

  // Reset restored state flag when area/folder changes
  useEffect(() => {
    setHasRestoredState(false);
  }, [areaId, folderPath]);

  useEffect(() => {
    if (!renameDialog.isOpen) return;
    const timer = window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [renameDialog.isOpen]);

  // -------------------------------------------------------------------------
  // SEARCH
  // -------------------------------------------------------------------------

  // Parse search query for file:line pattern (e.g., "Filename.java:135")
  const parsedSearch = useMemo(() => {
    const query = searchQuery.trim();
    const match = query.match(/^(.+):(\d+)$/);
    if (match) {
      return { query: match[1], lineNumber: parseInt(match[2], 10) };
    }
    return { query, lineNumber: undefined };
  }, [searchQuery]);

  // Handle unified search - both filename and content, prioritizing filename matches
  useEffect(() => {
    if (!parsedSearch.query || !currentFolder) {
      setSearchResults([]);
      setContentSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    // Debounce search requests
    const timeoutId = setTimeout(async () => {
      try {
        const query = parsedSearch.query;

        // Always search by filename
        const filenamePromise = authFetch(
          apiUrl(`/api/files/search?path=${encodeURIComponent(currentFolder)}&q=${encodeURIComponent(query)}&limit=20`)
        ).then(res => res.json()).catch(() => ({ results: [] }));

        // Only search content if query is at least 2 chars and no line number specified
        const contentPromise = query.length >= 2 && !parsedSearch.lineNumber
          ? authFetch(
              apiUrl(`/api/files/search-content?path=${encodeURIComponent(currentFolder)}&q=${encodeURIComponent(query)}&limit=20`)
            ).then(res => res.json()).catch(() => ({ results: [] }))
          : Promise.resolve({ results: [] });

        // Run both searches in parallel
        const [filenameData, contentData] = await Promise.all([filenamePromise, contentPromise]);

        setSearchResults(filenameData.results || []);
        setContentSearchResults(contentData.results || []);
      } catch (err) {
        console.error('[FileExplorer] Search failed:', err);
        setSearchResults([]);
        setContentSearchResults([]);
      }
      setIsSearching(false);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [parsedSearch.query, parsedSearch.lineNumber, currentFolder]);

  // -------------------------------------------------------------------------
  // EFFECTS
  // -------------------------------------------------------------------------

  // Load tree and git status when panel opens or folder changes
  useEffect(() => {
    if (isOpen && currentFolder) {
      // Clear previous state when folder changes
      clearFile();
      setSelectedPath(null);
      setOriginalContent(null);
      setSelectedGitStatus(null);
      setHasInitializedView(false);

      loadTree();
      loadGitStatus();
    }
  }, [isOpen, currentFolder, loadTree, loadGitStatus, clearFile]);

  // Listen for fileViewerPath from store
  useEffect(() => {
    if (state.fileViewerPath && isOpen) {
      loadFile(state.fileViewerPath);
      setSelectedPath(state.fileViewerPath);
      store.clearFileViewerPath();
    }
  }, [state.fileViewerPath, isOpen, loadFile]);

  // Auto-select git tab if there are changes (only if storage restore didn't load a saved view mode)
  useEffect(() => {
    // Wait for storage restore to complete before deciding on view mode
    if (!hasRestoredState) return;

    // Respect the user's tab choice (default: 'files'); never auto-switch to git
    if (!hasInitializedView && gitStatus) {
      setHasInitializedView(true);
    }
  }, [gitStatus, hasInitializedView, hasRestoredState, viewMode]);

  // Reset when area changes - clear transient state but let storage restore persistent state
  useEffect(() => {
    if (areaId) {
      clearFile();
      setSelectedPath(null);
      setSearchQuery('');
      setContentSearchResults([]);
      setSearchResults([]);
      setOriginalContent(null);
      setSelectedGitStatus(null);
      setHasInitializedView(false);
      // Don't clear tabs/viewMode/expandedPaths/folderIndex - let storage restore them
      // Mark as not restored so the storage effect will run
      setHasRestoredState(false);

      // Keep pending folder path until storage restore runs to avoid race conditions.
      if (pendingFolderPath) {
        const newArea = state.areas.get(areaId);
        if (!newArea?.directories.includes(pendingFolderPath)) {
          setPendingFolderPath(null);
        }
      }
    }
  }, [areaId, pendingFolderPath, state.areas, clearFile]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      // Alt+E closes the file explorer panel
      if (e.altKey && e.key === 'e') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if (e.key === 'Escape') {
        if (renameDialog.isOpen) {
          e.preventDefault();
          e.stopPropagation();
          if (!renameDialog.submitting) {
            setRenameDialog({ isOpen: false, node: null, value: '', submitting: false });
          }
          return;
        }

        // If search is active in the file viewer, don't close the panel
        // The hook will handle closing the search bar instead
        if (isFileSearchActive) {
          return;
        }

        if (showFolderSelector) {
          e.preventDefault();
          e.stopPropagation();
          setShowFolderSelector(false);
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }

      // Close active tab
      const closeTabShortcut = store.getShortcuts().find(s => s.id === 'file-explorer-close-tab');
      if (matchesShortcut(e, closeTabShortcut)) {
        if (e.repeat) return;
        e.preventDefault();
        e.stopPropagation();
        if (activeTabPath) {
          handleCloseTab(activeTabPath);
        }
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (showFolderSelector) {
        if (
          !target.closest('.file-explorer-folder-selector') &&
          !target.closest('.file-explorer-folder-dropdown')
        ) {
          setShowFolderSelector(false);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('click', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [isOpen, onClose, showFolderSelector, activeTabPath, isFileSearchActive, renameDialog]);

  // -------------------------------------------------------------------------
  // GIT STATUS ENRICHMENT
  // -------------------------------------------------------------------------

  // Create a map of file paths to git status for quick lookup
  const gitStatusMap = useMemo(() => {
    const map = new Map<string, GitFileStatusType>();
    if (gitStatus?.files) {
      for (const file of gitStatus.files) {
        map.set(file.path, file.status);
      }
    }
    return map;
  }, [gitStatus?.files]);

  // Create a map of folder paths to aggregated git status (propagate up from changed files)
  const folderGitStatusMap = useMemo(() => {
    const map = new Map<string, GitFileStatusType>();
    if (!gitStatus?.files) return map;

    const STATUS_PRIORITY: Record<GitFileStatusType, number> = {
      conflict: 0, modified: 1, added: 2, deleted: 3, untracked: 4, renamed: 5,
    };

    for (const file of gitStatus.files) {
      // Walk up parent directories from each changed file
      let dirPath = file.path;
      while (true) {
        const lastSlash = dirPath.lastIndexOf('/');
        if (lastSlash <= 0) break;
        dirPath = dirPath.substring(0, lastSlash);

        const existing = map.get(dirPath);
        if (!existing) {
          map.set(dirPath, file.status);
        } else if (STATUS_PRIORITY[file.status] < STATUS_PRIORITY[existing]) {
          map.set(dirPath, file.status);
        }
      }
    }
    return map;
  }, [gitStatus?.files]);

  // Enrich tree nodes with git status
  const enrichedTree = useMemo(() => {
    const enrichNode = (node: TreeNode): TreeNode => ({
      ...node,
      gitStatus: node.isDirectory
        ? folderGitStatusMap.get(node.path)
        : gitStatusMap.get(node.path),
      hasGitChanges: node.isDirectory
        ? folderGitStatusMap.has(node.path) || undefined
        : undefined,
      children: node.children ? node.children.map(enrichNode) : undefined,
    });
    return tree.map(enrichNode);
  }, [tree, gitStatusMap, folderGitStatusMap]);

  // -------------------------------------------------------------------------
  // HANDLERS
  // -------------------------------------------------------------------------

  // Helper to open a file in a tab
  const openFileInTab = (filePath: string, filename: string, extension: string, lineNumber?: number) => {
    // Check if tab already exists
    const existingTab = openTabs.find(t => t.path === filePath);
    if (!existingTab) {
      // Add new tab
      const newTab: FileTab = { path: filePath, filename, extension };
      setOpenTabs(prev => [...prev, newTab]);
    }
    setActiveTabPath(filePath);
    setSelectedPath(filePath);
    setScrollToLine(lineNumber);
    loadFile(filePath);
  };

  const handleSelect = async (node: TreeNode) => {
    if (node.isDirectory) {
      // Folder selected from search: switch back to tree and reveal the folder.
      setViewMode('files');
      setSearchQuery('');
      await expandToPath(node.path);

      setSelectedPath(node.path);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          let pathToFind = node.path;
          let folderElement = document.querySelector(`[data-path="${pathToFind}"]`);

          // Handle compacted directory chains by falling back to closest visible ancestor.
          while (!folderElement && pathToFind.includes('/')) {
            pathToFind = pathToFind.substring(0, pathToFind.lastIndexOf('/'));
            folderElement = document.querySelector(`[data-path="${pathToFind}"]`);
          }

          if (folderElement instanceof HTMLElement) {
            folderElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        });
      });
      return;
    }

    setSelectedGitStatus(null);
    setOriginalContent(null);
    // If search has a :lineNumber suffix, pass it along
    openFileInTab(node.path, node.name, node.extension, parsedSearch.lineNumber);
  };

  const handleContentSearchSelect = (path: string, line?: number) => {
    setSelectedGitStatus(null);
    setOriginalContent(null);
    const filename = path.split('/').pop() || path;
    const extension = path.substring(path.lastIndexOf('.')).toLowerCase();
    openFileInTab(path, filename, extension, line);
  };

  const handleGitFileSelect = async (path: string, status: GitFileStatusType) => {
    setSelectedGitStatus(status);
    setOriginalContent(null);

    const filename = path.split('/').pop() || path;
    const extension = path.substring(path.lastIndexOf('.')).toLowerCase();
    openFileInTab(path, filename, extension);

    if (status === 'modified') {
      const { content } = await loadGitOriginalContent(path);
      if (content !== null) {
        setOriginalContent(content);
      }
    }
  };

  // Tab handlers
  const handleSelectTab = (path: string) => {
    setActiveTabPath(path);
    setSelectedPath(path);
    setSelectedGitStatus(null);
    setOriginalContent(null);
    setScrollToLine(undefined);

    // Check if we have cached data
    const tab = openTabs.find(t => t.path === path);
    if (tab?.data) {
      // Use cached data - don't reload
    } else {
      loadFile(path);
    }
  };

  const handleCloseTab = (path: string) => {
    setOpenTabs(prev => {
      const newTabs = prev.filter(t => t.path !== path);
      const wasActive = prev.findIndex(t => t.path === path);
      const _isClosingActiveTab = wasActive !== -1 && prev[wasActive]?.path === path &&
                                  (activeTabPath === path || prev.find(t => t.path === activeTabPath) === undefined);

      // If we're closing the active tab, switch to another
      if (newTabs.length > 0) {
        // Check if the active tab is being closed or no longer exists
        const activeStillExists = newTabs.some(t => t.path === activeTabPath);
        if (!activeStillExists) {
          const closedIndex = prev.findIndex(t => t.path === path);
          // Try to switch to the tab to the left, or the first tab
          const newActiveIndex = Math.max(0, Math.min(closedIndex, newTabs.length - 1));
          const newActiveTab = newTabs[newActiveIndex];
          if (newActiveTab) {
            setActiveTabPath(newActiveTab.path);
            setSelectedPath(newActiveTab.path);
            loadFile(newActiveTab.path);
          }
        }
      } else {
        // No tabs left
        setActiveTabPath(null);
        setSelectedPath(null);
        clearFile();
      }

      return newTabs;
    });
  };

  const handleFolderSelect = (folder: FolderInfo) => {
    setShowFolderSelector(false);
    if (folder.areaId !== areaId) {
      setPendingFolderPath(folder.path);
      if (onChangeArea) {
        onChangeArea(folder.areaId);
      }
    } else {
      const folderIndex = directories.indexOf(folder.path);
      setSelectedFolderIndex(folderIndex >= 0 ? folderIndex : 0);
    }
  };

  const getParentDir = useCallback((targetPath: string): string => {
    const idx = targetPath.lastIndexOf('/');
    if (idx <= 0) return '/';
    return targetPath.slice(0, idx);
  }, []);

  const remapPathPrefix = useCallback((value: string, oldPrefix: string, newPrefix: string): string => {
    if (value === oldPrefix) return newPrefix;
    if (value.startsWith(`${oldPrefix}/`)) {
      return `${newPrefix}${value.slice(oldPrefix.length)}`;
    }
    return value;
  }, []);

  const handleTreeNodeContextMenu = useCallback((event: React.MouseEvent, node: TreeNode) => {
    setSelectedPath(node.path);
    setFileTreeContextMenu({
      isOpen: true,
      position: { x: event.clientX, y: event.clientY },
      node,
    });
  }, []);

  const handleOpenRenameDialog = useCallback((node: TreeNode) => {
    setRenameDialog({
      isOpen: true,
      node,
      value: node.name,
      submitting: false,
    });
  }, []);

  const handleCloseRenameDialog = useCallback(() => {
    setRenameDialog({ isOpen: false, node: null, value: '', submitting: false });
  }, []);

  const handleRenamePath = useCallback(async () => {
    const node = renameDialog.node;
    if (!node) return;

    const nextName = renameDialog.value.trim();
    if (!nextName || nextName === node.name) {
      handleCloseRenameDialog();
      return;
    }

    setRenameDialog((prev) => ({ ...prev, submitting: true }));

    try {
      const res = await authFetch(apiUrl('/api/files/rename'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: node.path, newName: nextName }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast('error', 'Rename Failed', data.error || 'Unable to rename item');
        setRenameDialog((prev) => ({ ...prev, submitting: false }));
        return;
      }

      const newPath = data.newPath as string;
      const oldPath = node.path;
      const remappedExpandedPaths = new Set(
        Array.from(expandedPaths).map((p) => remapPathPrefix(p, oldPath, newPath))
      );
      const oldParentDir = getParentDir(oldPath);
      const newParentDir = getParentDir(newPath);

      setOpenTabs((prev) => prev.map((tab) => {
        if (!tab.path.startsWith(oldPath)) return tab;
        const mappedPath = remapPathPrefix(tab.path, oldPath, newPath);
        const mappedName = mappedPath.split('/').pop() || mappedPath;
        const mappedExt = mappedName.includes('.') ? `.${mappedName.split('.').pop()}` : '';
        return {
          ...tab,
          path: mappedPath,
          filename: mappedName,
          extension: mappedExt.toLowerCase(),
          data: tab.data
            ? {
                ...tab.data,
                path: mappedPath,
                filename: mappedName,
                extension: mappedExt.toLowerCase(),
              }
            : tab.data,
        };
      }));

      if (activeTabPath) {
        setActiveTabPath(remapPathPrefix(activeTabPath, oldPath, newPath));
      }
      if (selectedPath) {
        setSelectedPath(remapPathPrefix(selectedPath, oldPath, newPath));
      }
      if (selectedFile?.path) {
        const mapped = remapPathPrefix(selectedFile.path, oldPath, newPath);
        if (mapped !== selectedFile.path) {
          const mappedName = mapped.split('/').pop() || mapped;
          const mappedExt = mappedName.includes('.') ? `.${mappedName.split('.').pop()}` : '';
          setSelectedFile({
            ...selectedFile,
            path: mapped,
            filename: mappedName,
            extension: mappedExt.toLowerCase(),
          });
        }
      }

      renamePathInTree(oldPath, newPath);
      setExpandedPaths(remappedExpandedPaths);
      await reloadDirectory(oldParentDir);
      if (newParentDir !== oldParentDir) {
        await reloadDirectory(newParentDir);
      }
      await loadGitStatus();
      showToast('success', 'Renamed', `${node.name} renamed`);
      handleCloseRenameDialog();
    } catch (err) {
      console.error('[FileExplorer] Rename failed:', err);
      showToast('error', 'Rename Failed', 'Unable to rename item');
      setRenameDialog((prev) => ({ ...prev, submitting: false }));
    }
  }, [renameDialog, handleCloseRenameDialog, activeTabPath, selectedPath, selectedFile, expandedPaths, remapPathPrefix, getParentDir, renamePathInTree, setExpandedPaths, reloadDirectory, loadGitStatus, showToast, setSelectedFile]);

  const handleCopyNode = useCallback((node: TreeNode) => {
    setFileClipboard({
      sourcePath: node.path,
      isDirectory: node.isDirectory,
      name: node.name,
    });
    showToast('info', 'Copied', `${node.name} ready to paste`);
  }, [showToast]);

  const handlePasteNode = useCallback(async (node: TreeNode) => {
    if (!fileClipboard) return;

    const targetDir = node.isDirectory ? node.path : getParentDir(node.path);
    const nextExpandedPaths = new Set(expandedPaths);
    nextExpandedPaths.add(targetDir);

    try {
      const res = await authFetch(apiUrl('/api/files/paste'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePath: fileClipboard.sourcePath,
          targetDir,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast('error', 'Paste Failed', data.error || 'Unable to paste item');
        return;
      }

      await reloadDirectory(targetDir);
      setExpandedPaths(nextExpandedPaths);
      await loadGitStatus();
      if (data.destinationPath) {
        setSelectedPath(data.destinationPath);
      }
      showToast('success', 'Pasted', `${fileClipboard.name} pasted`);
    } catch (err) {
      console.error('[FileExplorer] Paste failed:', err);
      showToast('error', 'Paste Failed', 'Unable to paste item');
    }
  }, [fileClipboard, getParentDir, expandedPaths, reloadDirectory, setExpandedPaths, loadGitStatus, showToast]);

  const handleCopyPath = useCallback(async (node: TreeNode) => {
    try {
      await navigator.clipboard.writeText(node.path);
      showToast('success', 'Copied', 'Full path copied');
    } catch (err) {
      console.error('[FileExplorer] Copy path failed:', err);
      showToast('error', 'Copy Failed', 'Could not copy path');
    }
  }, [showToast]);

  const fileTreeContextActions = useMemo((): ContextMenuAction[] => {
    if (!fileTreeContextMenu) return [];
    const node = fileTreeContextMenu.node;

    return [
      {
        id: 'rename',
        label: node.isDirectory ? 'Rename Folder' : 'Rename File',
        icon: '✏️',
        onClick: () => handleOpenRenameDialog(node),
      },
      {
        id: 'copy',
        label: node.isDirectory ? 'Copy Folder' : 'Copy File',
        icon: '📄',
        onClick: () => handleCopyNode(node),
      },
      {
        id: 'paste',
        label: node.isDirectory ? 'Paste Into Folder' : 'Paste Here',
        icon: '📋',
        disabled: !fileClipboard,
        onClick: () => { void handlePasteNode(node); },
      },
      { id: 'divider-1', label: '', divider: true, onClick: () => {} },
      {
        id: 'copy-full-path',
        label: 'Copy Full Path',
        icon: '🧷',
        onClick: () => { void handleCopyPath(node); },
      },
    ];
  }, [fileTreeContextMenu, fileClipboard, handleOpenRenameDialog, handleCopyNode, handlePasteNode, handleCopyPath]);

  // Reveal a file in the tree by expanding all parent directories
  const handleRevealInTree = useCallback((filePath: string) => {
    // Switch to files view and clear search to show tree
    setViewMode('files');
    setSearchQuery('');

    // Normalize: strip trailing slash to prevent double-slash paths
    const rootFolder = currentFolder?.replace(/\/+$/, '') || null;

    // Build list of all parent paths to expand - start with root folder
    const pathsToExpand = new Set<string>();
    if (rootFolder) {
      pathsToExpand.add(rootFolder);
    }

    // Get all parent directories by building up the path from rootFolder
    if (rootFolder && filePath.startsWith(rootFolder)) {
      // Get relative path from rootFolder
      const relativePath = filePath.substring(rootFolder.length);
      const parts = relativePath.split('/').filter(p => p);

      // Build each parent path relative to rootFolder
      let currentPath = rootFolder;
      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath + '/' + parts[i];
        pathsToExpand.add(currentPath);
      }
    }

    setExpandedPaths(pathsToExpand);
    setSelectedPath(filePath);

    // Scroll the file into view after DOM update - use longer timeout for reliability
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const fileElement = document.querySelector(`[data-path="${filePath}"]`);
        if (fileElement) {
          fileElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });
  }, [currentFolder]);

  // Stage files (git add)
  const handleStageFiles = useCallback(async (paths: string[]) => {
    if (!currentFolder || paths.length === 0) return;

    // Mark paths as staging
    setStagingPaths(prev => {
      const next = new Set(prev);
      for (const p of paths) next.add(p);
      return next;
    });

    try {
      const res = await authFetch(apiUrl('/api/files/git-add'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths, directory: currentFolder }),
      });

      if (res.ok) {
        // Refresh git status to reflect staged changes
        await loadGitStatus();
      } else {
        const data = await res.json();
        console.error('[FileExplorer] Git add failed:', data.error);
      }
    } catch (err) {
      console.error('[FileExplorer] Git add failed:', err);
    } finally {
      setStagingPaths(prev => {
        const next = new Set(prev);
        for (const p of paths) next.delete(p);
        return next;
      });
    }
  }, [currentFolder, loadGitStatus]);

  // -------------------------------------------------------------------------
  // MERGE / CONFLICT HANDLERS
  // -------------------------------------------------------------------------

  const handleMerge = useCallback(async (branch: string) => {
    if (!currentFolder) return;
    setMergingBranch(branch);
    const result = await mergeBranch(currentFolder, branch);
    await loadGitStatus();

    if (result.success) {
      setMergingBranch(null);
      showToast('success', 'Merge Complete', `Merged '${branch}' successfully`);
      loadTree();
    } else if (result.conflicts && result.conflicts.length > 0) {
      const n = result.conflicts.length;
      showToast('warning', 'Merge Conflicts', `${n} conflict${n > 1 ? 's' : ''} found — resolve to continue`);
      setViewMode('git');
    } else {
      setMergingBranch(null);
      showToast('error', 'Merge Failed', result.error || 'Merge failed');
    }
  }, [currentFolder, mergeBranch, loadGitStatus, loadTree, showToast]);

  const handleConflictOpen = useCallback(async (filePath: string) => {
    if (!currentFolder) return;
    setConflictFile(filePath);
    setConflictLoading(true);
    setConflictVersions(null);
    try {
      const res = await authFetch(
        apiUrl(`/api/files/git-conflict-file?path=${encodeURIComponent(currentFolder)}&file=${encodeURIComponent(filePath)}`)
      );
      const data = await res.json();
      if (res.ok) {
        setConflictVersions(data);
      } else {
        console.error('[FileExplorer] Failed to load conflict file:', data.error);
      }
    } catch (err) {
      console.error('[FileExplorer] Failed to load conflict file:', err);
    } finally {
      setConflictLoading(false);
    }
  }, [currentFolder]);

  const handleConflictResolve = useCallback(async (content: string) => {
    if (!currentFolder || !conflictFile) return;
    try {
      const res = await authFetch(apiUrl('/api/files/git-resolve-conflict'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: currentFolder, file: conflictFile, content }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setConflictFile(null);
        setConflictVersions(null);
        await loadGitStatus();
      } else {
        console.error('[FileExplorer] Failed to resolve conflict:', data.error);
      }
    } catch (err) {
      console.error('[FileExplorer] Failed to resolve conflict:', err);
    }
  }, [currentFolder, conflictFile, loadGitStatus]);

  const handleMergeContinue = useCallback(async () => {
    if (!currentFolder) return;
    const result = await mergeContinue(currentFolder);
    if (result.success) {
      setMergingBranch(null);
      setConflictFile(null);
      setConflictVersions(null);
      showToast('success', 'Merge Complete', 'Merge completed successfully');
      await loadGitStatus();
      loadTree();
    } else {
      showToast('error', 'Merge Failed', result.error || 'Merge continue failed');
    }
  }, [currentFolder, mergeContinue, loadGitStatus, loadTree, showToast]);

  const handleMergeAbort = useCallback(async () => {
    if (!currentFolder) return;
    const result = await mergeAbort(currentFolder);
    if (result.success) {
      setMergingBranch(null);
      setConflictFile(null);
      setConflictVersions(null);
      showToast('info', 'Merge Aborted', 'Merge has been aborted');
      await loadGitStatus();
      loadTree();
    } else {
      showToast('error', 'Abort Failed', result.error || 'Failed to abort merge');
    }
  }, [currentFolder, mergeAbort, loadGitStatus, loadTree, showToast]);

  // -------------------------------------------------------------------------
  // BRANCH COMPARISON HANDLERS
  // -------------------------------------------------------------------------

  const handleCompare = useCallback(async (branch: string) => {
    if (!currentFolder) return;
    setCompareBranch(branch);
    setCompareLoading(true);
    setCompareResult(null);
    setViewMode('compare');

    try {
      const res = await authFetch(
        apiUrl(`/api/files/git-branch-compare?directory=${encodeURIComponent(currentFolder)}&branch=${encodeURIComponent(branch)}`)
      );
      const data = await res.json();
      if (res.ok) {
        setCompareResult(data);
      } else {
        showToast('error', 'Compare Failed', data.error || 'Failed to compare branches');
        setViewMode('files');
        setCompareBranch(null);
      }
    } catch (err) {
      console.error('[FileExplorer] Branch compare failed:', err);
      showToast('error', 'Compare Failed', 'Network error during comparison');
      setViewMode('files');
      setCompareBranch(null);
    } finally {
      setCompareLoading(false);
    }
  }, [currentFolder, showToast]);

  const handleCompareFileSelect = useCallback(async (filePath: string, status: GitFileStatusType) => {
    if (!currentFolder || !compareBranch) return;

    const filename = filePath.split('/').pop() || filePath;
    const extension = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();

    // Set up tab without loading from disk
    const existingTab = openTabs.find(t => t.path === filePath);
    if (!existingTab) {
      setOpenTabs(prev => [...prev, { path: filePath, filename, extension }]);
    }
    setActiveTabPath(filePath);
    setSelectedPath(filePath);
    setScrollToLine(undefined);

    // Helper to fetch file content from a git ref
    const fetchRef = async (ref: string): Promise<string> => {
      try {
        const res = await authFetch(
          apiUrl(`/api/files/git-show?path=${encodeURIComponent(filePath)}&ref=${encodeURIComponent(ref)}`)
        );
        const data = await res.json();
        return res.ok ? (data.content ?? '') : '';
      } catch {
        return '';
      }
    };

    const makeFile = (content: string) => ({
      path: filePath, filename, extension, content, fileType: 'text' as const, size: content.length, modified: '',
    });

    if (status === 'modified' || status === 'renamed') {
      // Fetch both versions from git and show diff
      const [original, current] = await Promise.all([
        fetchRef(compareBranch),
        fetchRef('HEAD'),
      ]);
      setOriginalContent(original);
      setSelectedFile(makeFile(current));
      setSelectedGitStatus('modified');
    } else if (status === 'deleted') {
      // File only exists in comparison branch — diff shows full removal
      const original = await fetchRef(compareBranch);
      setOriginalContent(original);
      setSelectedFile(makeFile(''));
      setSelectedGitStatus('modified');
    } else if (status === 'added') {
      // File only exists in current branch — diff shows full addition
      const current = await fetchRef('HEAD');
      setOriginalContent('');
      setSelectedFile(makeFile(current));
      setSelectedGitStatus('modified');
    }
  }, [currentFolder, compareBranch, openTabs]);

  const handleCompareClose = useCallback(() => {
    setViewMode('files');
    setCompareResult(null);
    setCompareBranch(null);
    setCompareLoading(false);
  }, []);

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------

  // Allow rendering if we have an area OR we're in direct folder mode
  if (!isOpen || (!area && !isDirectFolderMode)) return null;

  const gitChangeCount = gitStatus?.files.length || 0;

  return (
    <div className="file-explorer-panel ide-style">
      {/* Header */}
      <div className="file-explorer-panel-header">
        <div className="file-explorer-panel-title">
          {/* Folder selector */}
          {currentFolder && (
            <div
              className="file-explorer-folder-selector"
              onClick={() => !isDirectFolderMode && allFolders.length > 0 && setShowFolderSelector(!showFolderSelector)}
              style={{ cursor: !isDirectFolderMode && allFolders.length > 0 ? 'pointer' : 'default' }}
              title={currentFolder}
            >
              <span className="file-explorer-panel-dot" style={{ background: area?.color || '#ffd700' }} />
              <span className="file-explorer-folder-name">
                {currentFolderName}
              </span>
              <span className="file-explorer-folder-path-hint">{currentFolder}</span>
              {!isDirectFolderMode && allFolders.length > 1 && (
                <span className="file-explorer-folder-dropdown-icon">▼</span>
              )}
            </div>
          )}

          {/* Branch Widget - show if current folder is a git repo */}
          {gitStatus?.isGitRepo && currentFolder && (
            <>
              <span className="file-explorer-path-separator">/</span>
              <BranchWidget
                currentFolder={currentFolder}
                gitStatus={gitStatus}
                onBranchChanged={() => {
                  loadGitStatus();
                  loadTree();
                }}
                onMerge={handleMerge}
                onCompare={handleCompare}
              />
            </>
          )}

          {selectedFile && (
            <span className="file-explorer-current-file">/ {selectedFile.filename}</span>
          )}

          {/* Folder Selector Dropdown (not shown in direct folder mode) */}
          {!isDirectFolderMode && showFolderSelector && allFolders.length > 0 && (
            <div className="file-explorer-folder-dropdown">
              {allFolders.map((folder) => (
                <div
                  key={`${folder.areaId}-${folder.path}`}
                  className={`file-explorer-folder-option ${
                    folder.path === currentFolder ? 'active' : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleFolderSelect(folder);
                  }}
                >
                  <span className="file-explorer-folder-option-name">
                    <span
                      className="file-explorer-folder-option-dot"
                      style={{ background: folder.areaColor }}
                    />
                    {folder.path.split('/').pop() || folder.path}
                  </span>
                  <span className="file-explorer-folder-option-path">{folder.path}</span>
                  <span className="file-explorer-folder-option-area">{folder.areaName}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="file-explorer-panel-close" onClick={onClose}>
          ×
        </button>
      </div>

      {/* Main Content */}
      <div className="file-explorer-main">
        {/* Tree Panel (Left) */}
        <div
          className={`file-explorer-tree-panel ${treePanelCollapsed ? 'collapsed' : ''}`}
          style={{ width: treePanelWidth }}
        >
          {/* Tab Bar */}
          <div className="file-explorer-tabs">
            <button
              className="file-explorer-tree-toggle"
              onClick={() => setTreePanelCollapsed(!treePanelCollapsed)}
              title={treePanelCollapsed ? t('terminal:fileExplorer.expandTree') : t('terminal:fileExplorer.collapseTree')}
            >
              {treePanelCollapsed ? '▼' : '▲'}
            </button>
            <button
              className={`file-explorer-tab ${viewMode === 'files' ? 'active' : ''}`}
              onClick={() => setViewMode('files')}
            >
              <span className="tab-icon">📁</span>
              {t('terminal:spotlight.files')}
            </button>
            <button
              className={`file-explorer-tab ${viewMode === 'git' ? 'active' : ''}`}
              onClick={() => setViewMode('git')}
            >
              <span className="tab-icon">⎇</span>
              {t('terminal:fileExplorer.gitChanges')}
              {gitChangeCount > 0 && <span className="tab-badge">{gitChangeCount}</span>}
            </button>
            {(compareResult || compareLoading) && (
              <button
                className={`file-explorer-tab ${viewMode === 'compare' ? 'active' : ''}`}
                onClick={() => setViewMode('compare')}
              >
                <span className="tab-icon">⇄</span>
                {t('terminal:fileExplorer.diffView')}
                {compareResult && <span className="tab-badge">{compareResult.files.length}</span>}
                <span
                  className="tab-close-btn"
                  onClick={(e) => { e.stopPropagation(); handleCompareClose(); }}
                >
                  ×
                </span>
              </button>
            )}
          </div>

          {/* Search Bar and Toolbar (only in files mode) */}
          {viewMode === 'files' && (
            <div className="file-explorer-toolbar">
              <div className="file-explorer-search">
                <span className="file-explorer-search-icon">🔍</span>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="file-explorer-search-input"
                  placeholder={t('terminal:fileExplorer.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    className="file-explorer-search-clear"
                    onClick={() => setSearchQuery('')}
                  >
                    ×
                  </button>
                )}
              </div>
              <div className="file-explorer-toolbar-buttons">
                <button
                  className="file-explorer-toolbar-btn"
                  onClick={() => setExpandedPaths(new Set())}
                  title={t('terminal:fileExplorer.collapseAll')}
                >
                  ⊟
                </button>
                {activeTabPath && (
                  <button
                    className="file-explorer-toolbar-btn"
                    onClick={() => handleRevealInTree(activeTabPath)}
                    title={t('terminal:fileExplorer.revealInTree')}
                  >
                    ◎
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Tree Content */}
          <div className="file-explorer-tree-content">
            {viewMode === 'compare' ? (
              <BranchComparison
                compareResult={compareResult}
                loading={compareLoading}
                onFileSelect={handleCompareFileSelect}
                selectedPath={selectedPath}
                onClose={handleCompareClose}
              />
            ) : viewMode === 'files' ? (
              treeLoading ? (
                <div className="tree-loading">{t('common:status.loading')}</div>
              ) : parsedSearch.query ? (
                isSearching ? (
                  <div className="tree-loading">{t('terminal:fileExplorer.searching')}</div>
                ) : (
                  <UnifiedSearchResults
                    filenameResults={searchResults}
                    contentResults={contentSearchResults}
                    onSelectFile={handleSelect}
                    onSelectContent={handleContentSearchSelect}
                    selectedPath={selectedPath}
                    query={parsedSearch.query}
                    lineNumber={parsedSearch.lineNumber}
                  />
                )
              ) : (
                <div className="file-tree">
                  {enrichedTree.length === 0 ? (
                    <div className="tree-empty">{t('terminal:fileExplorer.noDirectoriesLinked')}</div>
                  ) : (
                    enrichedTree.map((node) => (
                      <TreeNodeItem
                        key={node.path}
                        node={node}
                        depth={0}
                        selectedPath={selectedPath}
                        expandedPaths={expandedPaths}
                        onSelect={handleSelect}
                        onToggle={togglePath}
                        onContextMenu={handleTreeNodeContextMenu}
                        searchQuery=""
                      />
                    ))
                  )}
                </div>
              )
            ) : (
              <GitChanges
                gitStatus={gitStatus}
                loading={gitLoading}
                onFileSelect={handleGitFileSelect}
                selectedPath={selectedPath}
                onRefresh={loadGitStatus}
                onStageFiles={handleStageFiles}
                stagingPaths={stagingPaths}
                currentFolder={currentFolder}
                onCommitComplete={() => {
                  loadGitStatus();
                  loadTree();
                }}
                mergeInProgress={gitStatus?.mergeInProgress}
                mergingBranch={mergingBranch}
                onMergeContinue={handleMergeContinue}
                onMergeAbort={handleMergeAbort}
                onConflictOpen={handleConflictOpen}
              />
            )}
          </div>
        </div>

        {/* Resize Handle */}
        <div
          className={`file-explorer-resize-handle ${isResizing ? 'active' : ''}`}
          onMouseDown={handleResizeStart}
        />

        {/* File Viewer (Right) */}
        <div className="file-explorer-viewer-panel">
          {conflictFile ? (
            /* Conflict Resolver */
            <ConflictResolver
              file={conflictFile}
              versions={conflictVersions}
              loading={conflictLoading}
              onResolve={handleConflictResolve}
              onClose={() => {
                setConflictFile(null);
                setConflictVersions(null);
              }}
              currentBranch={gitStatus?.branch || 'HEAD'}
              mergingBranch={mergingBranch || 'incoming'}
            />
          ) : (
            <>
              {/* File Tabs */}
              <FileTabs
                tabs={openTabs}
                activeTabPath={activeTabPath}
                onSelectTab={handleSelectTab}
                onCloseTab={handleCloseTab}
              />

              {/* File Content */}
              {selectedGitStatus === 'modified' && originalContent !== null && selectedFile ? (
                <DiffViewer
                  originalContent={originalContent}
                  modifiedContent={selectedFile.content}
                  filename={selectedFile.filename}
                  language={EXTENSION_TO_LANGUAGE[selectedFile.extension] || 'plaintext'}
                />
              ) : (
                <FileViewer file={selectedFile} loading={fileLoading} error={fileError} onRevealInTree={handleRevealInTree} scrollToLine={scrollToLine} onSearchStateChange={setIsFileSearchActive} />
              )}
            </>
          )}
        </div>
      </div>

      {renameDialog.isOpen && renameDialog.node && (
        <div className="file-explorer-rename-overlay" onClick={handleCloseRenameDialog}>
          <div className="file-explorer-rename-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="file-explorer-rename-title">
              Rename {renameDialog.node.isDirectory ? 'Folder' : 'File'}
            </div>
            <div className="file-explorer-rename-path" title={renameDialog.node.path}>
              {renameDialog.node.path}
            </div>
            <input
              ref={renameInputRef}
              type="text"
              className="file-explorer-rename-input"
              value={renameDialog.value}
              onChange={(e) => setRenameDialog((prev) => ({ ...prev, value: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleRenamePath();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  handleCloseRenameDialog();
                }
              }}
              disabled={renameDialog.submitting}
            />
            <div className="file-explorer-rename-actions">
              <button
                className="file-explorer-rename-btn"
                onClick={handleCloseRenameDialog}
                disabled={renameDialog.submitting}
              >
                Cancel
              </button>
              <button
                className="file-explorer-rename-btn primary"
                onClick={() => { void handleRenamePath(); }}
                disabled={renameDialog.submitting || !renameDialog.value.trim()}
              >
                {renameDialog.submitting ? 'Renaming...' : 'Rename'}
              </button>
            </div>
          </div>
        </div>
      )}

      {fileTreeContextMenu && (
        <ContextMenu
          isOpen={fileTreeContextMenu.isOpen}
          position={fileTreeContextMenu.position}
          worldPosition={{ x: 0, z: 0 }}
          actions={fileTreeContextActions}
          onClose={() => setFileTreeContextMenu(null)}
        />
      )}
    </div>
  );
}
