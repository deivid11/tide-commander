/**
 * FileExplorerPanel - Main orchestrator component
 *
 * IDE-style file explorer with file tree, git integration, and syntax highlighting.
 * Following ClaudeOutputPanel's architecture patterns.
 */

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
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
} from './types';

// Hooks
import { useFileTree } from './useFileTree';
import { useGitStatus, loadGitOriginalContent } from './useGitStatus';
import { useFileContent } from './useFileContent';
import { useFileExplorerStorage } from './useFileExplorerStorage';
import { useTreePanelResize } from './useTreePanelResize';

// Components
import { TreeNodeItem } from './TreeNodeItem';
import { FileViewer } from './FileViewer';
import { UnifiedSearchResults } from './UnifiedSearchResults';
import { GitChanges } from './GitChanges';
import { FileTabs } from './FileTabs';
import { BranchWidget } from './BranchWidget';

// Constants
import { EXTENSION_TO_LANGUAGE } from './constants';

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
    togglePath,
    setExpandedPaths,
  } = useFileTree(currentFolder);

  const {
    gitStatus,
    loading: gitLoading,
    loadGitStatus,
  } = useGitStatus(currentFolder);

  const {
    file: selectedFile,
    loading: fileLoading,
    error: fileError,
    loadFile,
    clearFile,
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

  // File tabs state
  const [openTabs, setOpenTabs] = useState<FileTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);

  // Line number to scroll to (from file:line search)
  const [scrollToLine, setScrollToLine] = useState<number | undefined>(undefined);

  // -------------------------------------------------------------------------
  // REFS
  // -------------------------------------------------------------------------

  const searchInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // STORAGE PERSISTENCE
  // -------------------------------------------------------------------------

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

    // Don't auto-switch if we restored state from storage (user's previous choice)
    // viewMode was already set from stored state above
    if (!hasInitializedView && viewMode === 'files' && gitStatus && gitStatus.isGitRepo && gitStatus.files.length > 0) {
      setViewMode('git');
      setHasInitializedView(true);
    } else if (!hasInitializedView && gitStatus) {
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

      if (e.key === 'Escape') {
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
  }, [isOpen, onClose, showFolderSelector, activeTabPath]);

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

  // Enrich tree nodes with git status
  const enrichedTree = useMemo(() => {
    const enrichNode = (node: TreeNode): TreeNode => ({
      ...node,
      gitStatus: gitStatusMap.get(node.path),
      children: node.children ? node.children.map(enrichNode) : undefined,
    });
    return tree.map(enrichNode);
  }, [tree, gitStatusMap]);

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

  const handleSelect = (node: TreeNode) => {
    if (!node.isDirectory) {
      setSelectedGitStatus(null);
      setOriginalContent(null);
      // If search has a :lineNumber suffix, pass it along
      openFileInTab(node.path, node.name, node.extension, parsedSearch.lineNumber);
    }
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

  // Reveal a file in the tree by expanding all parent directories
  const handleRevealInTree = useCallback((filePath: string) => {
    // Switch to files view and clear search to show tree
    setViewMode('files');
    setSearchQuery('');

    // Build list of all parent paths to expand - start with root folder
    const pathsToExpand = new Set<string>();
    if (currentFolder) {
      pathsToExpand.add(currentFolder);
    }

    // Get all parent directories by building up the path from currentFolder
    if (filePath.startsWith(currentFolder!)) {
      // Get relative path from currentFolder
      const relativePath = filePath.substring(currentFolder!.length);
      const parts = relativePath.split('/').filter(p => p);

      // Build each parent path relative to currentFolder
      let currentPath = currentFolder!;
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
              title={treePanelCollapsed ? 'Expand tree' : 'Collapse tree'}
            >
              {treePanelCollapsed ? '▼' : '▲'}
            </button>
            <button
              className={`file-explorer-tab ${viewMode === 'files' ? 'active' : ''}`}
              onClick={() => setViewMode('files')}
            >
              <span className="tab-icon">📁</span>
              Files
            </button>
            <button
              className={`file-explorer-tab ${viewMode === 'git' ? 'active' : ''}`}
              onClick={() => setViewMode('git')}
            >
              <span className="tab-icon">⎇</span>
              Git
              {gitChangeCount > 0 && <span className="tab-badge">{gitChangeCount}</span>}
            </button>
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
                  placeholder="Search files... (file:line) (Cmd+P)"
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
                  title="Collapse all folders"
                >
                  ⊟
                </button>
                {activeTabPath && (
                  <button
                    className="file-explorer-toolbar-btn"
                    onClick={() => handleRevealInTree(activeTabPath)}
                    title="Reveal active file in tree"
                  >
                    ◎
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Tree Content */}
          <div className="file-explorer-tree-content">
            {viewMode === 'files' ? (
              treeLoading ? (
                <div className="tree-loading">Loading...</div>
              ) : parsedSearch.query ? (
                isSearching ? (
                  <div className="tree-loading">Searching...</div>
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
                    <div className="tree-empty">No directories linked</div>
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
            <FileViewer file={selectedFile} loading={fileLoading} error={fileError} onRevealInTree={handleRevealInTree} scrollToLine={scrollToLine} />
          )}
        </div>
      </div>
    </div>
  );
}
