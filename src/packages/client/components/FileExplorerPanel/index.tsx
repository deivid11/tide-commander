/**
 * FileExplorerPanel - Main orchestrator component
 *
 * IDE-style file explorer with file tree, git integration, and syntax highlighting.
 * Following ClaudeOutputPanel's architecture patterns.
 */

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { useStore, store } from '../../store';
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

// Components
import { TreeNodeItem } from './TreeNodeItem';
import { FileViewer } from './FileViewer';
import { UnifiedSearchResults } from './UnifiedSearchResults';
import { GitChanges } from './GitChanges';
import { FileTabs } from './FileTabs';

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

  // Check if we're in "direct folder mode" (opened from a folder building)
  // folderPath takes priority over areaId when both are present
  const isDirectFolderMode = !!folderPath;

  const area = !isDirectFolderMode && areaId ? state.areas.get(areaId) : null;
  const directories = isDirectFolderMode ? [folderPath] : (area?.directories || []);
  const allAreas = Array.from(state.areas.values());

  const [selectedFolderIndex, setSelectedFolderIndex] = useState(0);
  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(null);
  const [showAreaSelector, setShowAreaSelector] = useState(false);
  const [showFolderSelector, setShowFolderSelector] = useState(false);

  const currentFolder = directories[selectedFolderIndex] || directories[0] || null;

  // Reset folder index when switching modes or folder path changes
  useEffect(() => {
    setSelectedFolderIndex(0);
  }, [folderPath, isDirectFolderMode]);

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
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState('');
  const [hasRestoredState, setHasRestoredState] = useState(false);
  const [treePanelCollapsed, setTreePanelCollapsed] = useState(false);

  // File tabs state
  const [openTabs, setOpenTabs] = useState<FileTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // REFS
  // -------------------------------------------------------------------------

  const searchInputRef = useRef<HTMLInputElement>(null);
  const addFolderInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // STORAGE PERSISTENCE
  // -------------------------------------------------------------------------

  // Restore state from localStorage when panel opens
  useEffect(() => {
    if (!isOpen || hasRestoredState) return;

    const restoreState = async () => {
      const stored = await loadStoredState();
      if (stored) {
        setOpenTabs(stored.tabs);
        setActiveTabPath(stored.activeTabPath);
        setViewMode(stored.viewMode);
        setSelectedFolderIndex(stored.selectedFolderIndex);
        setExpandedPaths(stored.expandedPaths);

        // Load the active tab's file content
        if (stored.activeTabPath) {
          setSelectedPath(stored.activeTabPath);
          loadFile(stored.activeTabPath);
        }
      }
      setHasRestoredState(true);
    };

    restoreState();
  }, [isOpen, hasRestoredState, loadStoredState, setExpandedPaths, loadFile]);

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

  // Handle unified search - both filename and content, prioritizing filename matches
  useEffect(() => {
    if (!searchQuery.trim() || !currentFolder) {
      setSearchResults([]);
      setContentSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    // Debounce search requests
    const timeoutId = setTimeout(async () => {
      try {
        const query = searchQuery.trim();

        // Always search by filename
        const filenamePromise = fetch(
          apiUrl(`/api/files/search?path=${encodeURIComponent(currentFolder)}&q=${encodeURIComponent(query)}&limit=20`)
        ).then(res => res.json()).catch(() => ({ results: [] }));

        // Only search content if query is at least 2 chars
        const contentPromise = query.length >= 2
          ? fetch(
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
  }, [searchQuery, currentFolder]);

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

  // Auto-select git tab if there are changes (only on initial load, and only if no stored state was restored)
  useEffect(() => {
    // Don't auto-switch if we restored state from storage (user's previous choice)
    if (!hasInitializedView && !hasRestoredState && gitStatus && gitStatus.isGitRepo && gitStatus.files.length > 0) {
      setViewMode('git');
      setHasInitializedView(true);
    } else if (!hasInitializedView && gitStatus) {
      setHasInitializedView(true);
    }
  }, [gitStatus, hasInitializedView, hasRestoredState]);

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

      // Check if there's a pending folder to select (takes priority over storage)
      if (pendingFolderPath) {
        const newArea = state.areas.get(areaId);
        if (newArea) {
          const folderIndex = newArea.directories.indexOf(pendingFolderPath);
          setSelectedFolderIndex(folderIndex >= 0 ? folderIndex : 0);
        }
        setPendingFolderPath(null);
      }
    }
  }, [areaId, pendingFolderPath, state.areas, clearFile]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      if (e.key === 'Escape') {
        const target = e.target as HTMLElement;
        const isInAddFolderInput = target === addFolderInputRef.current;

        if (isInAddFolderInput && isAddingFolder) {
          return;
        }

        if (showAreaSelector) {
          e.preventDefault();
          e.stopPropagation();
          setShowAreaSelector(false);
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

      // Alt+W: Close active tab
      if (e.altKey && e.key === 'w') {
        e.preventDefault();
        e.stopPropagation();
        if (activeTabPath) {
          handleCloseTab(activeTabPath);
        }
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (showAreaSelector) {
        if (
          !target.closest('.file-explorer-area-selector') &&
          !target.closest('.file-explorer-area-dropdown')
        ) {
          setShowAreaSelector(false);
        }
      }
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
  }, [isOpen, onClose, isAddingFolder, showAreaSelector, showFolderSelector]);

  // Focus add folder input when shown
  useEffect(() => {
    if (isAddingFolder && addFolderInputRef.current) {
      addFolderInputRef.current.focus();
    }
  }, [isAddingFolder]);

  // -------------------------------------------------------------------------
  // HANDLERS
  // -------------------------------------------------------------------------

  // Helper to open a file in a tab
  const openFileInTab = (filePath: string, filename: string, extension: string) => {
    // Check if tab already exists
    const existingTab = openTabs.find(t => t.path === filePath);
    if (!existingTab) {
      // Add new tab
      const newTab: FileTab = { path: filePath, filename, extension };
      setOpenTabs(prev => [...prev, newTab]);
    }
    setActiveTabPath(filePath);
    setSelectedPath(filePath);
    loadFile(filePath);
  };

  const handleSelect = (node: TreeNode) => {
    if (!node.isDirectory) {
      setSelectedGitStatus(null);
      setOriginalContent(null);
      openFileInTab(node.path, node.name, node.extension);
    }
  };

  const handleContentSearchSelect = (path: string, _line?: number) => {
    setSelectedGitStatus(null);
    setOriginalContent(null);
    const filename = path.split('/').pop() || path;
    const extension = path.substring(path.lastIndexOf('.')).toLowerCase();
    openFileInTab(path, filename, extension);
    // TODO: Could scroll to line if we implement line navigation
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

  const handleAddFolder = () => {
    if (newFolderPath.trim() && areaId) {
      store.addDirectoryToArea(areaId, newFolderPath.trim());
      setNewFolderPath('');
      setIsAddingFolder(false);
      loadTree();
    }
  };

  const handleRemoveFolder = (dirPath: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (areaId) {
      store.removeDirectoryFromArea(areaId, dirPath);
      loadTree();
    }
  };

  const handleAreaChange = (newAreaId: string) => {
    setShowAreaSelector(false);
    if (newAreaId !== areaId && onChangeArea) {
      onChangeArea(newAreaId);
    }
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
    // Clear search to show tree
    setSearchQuery('');

    // Build list of all parent paths to expand
    const pathsToExpand = new Set(expandedPaths);
    const parts = filePath.split('/');

    // Build each parent path and add to expanded set
    let currentPath = '';
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath += (i === 0 ? '' : '/') + parts[i];
      if (currentPath) {
        pathsToExpand.add(currentPath);
      }
    }

    setExpandedPaths(pathsToExpand);
    setSelectedPath(filePath);

    // Scroll the file into view after a short delay for DOM update
    setTimeout(() => {
      const fileElement = document.querySelector(`[data-path="${filePath}"]`);
      if (fileElement) {
        fileElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }, [expandedPaths, setExpandedPaths]);

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------

  // Allow rendering if we have an area OR we're in direct folder mode
  if (!isOpen || (!area && !isDirectFolderMode)) return null;

  const gitChangeCount = gitStatus?.files.length || 0;

  // Display name for the header
  const displayName = isDirectFolderMode
    ? (folderPath?.split('/').pop() || 'Folder')
    : (area?.name || 'Explorer');

  return (
    <div className="file-explorer-panel ide-style">
      {/* Header */}
      <div className="file-explorer-panel-header">
        <div className="file-explorer-panel-title">
          {/* Area selector (only shown when we have areas, not in direct folder mode) */}
          {!isDirectFolderMode && area ? (
            <div
              className="file-explorer-area-selector"
              onClick={() => allAreas.length > 1 && setShowAreaSelector(!showAreaSelector)}
              style={{ cursor: allAreas.length > 1 ? 'pointer' : 'default' }}
            >
              <span className="file-explorer-panel-dot" style={{ background: area.color }} />
              <span>{area.name}</span>
              {allAreas.length > 1 && (
                <span className="file-explorer-area-dropdown-icon">▼</span>
              )}
            </div>
          ) : (
            <div className="file-explorer-area-selector">
              <span className="file-explorer-panel-dot" style={{ background: '#ffd700' }} />
              <span>{displayName}</span>
            </div>
          )}

          {/* Folder selector (hide dropdown controls in direct folder mode) */}
          {currentFolder && !isDirectFolderMode && (
            <>
              <span className="file-explorer-path-separator">/</span>
              <div
                className="file-explorer-folder-selector"
                onClick={() => allFolders.length > 0 && setShowFolderSelector(!showFolderSelector)}
                style={{ cursor: allFolders.length > 0 ? 'pointer' : 'default' }}
              >
                <span className="file-explorer-folder-name">
                  {currentFolder.split('/').pop() || currentFolder}
                </span>
                {allFolders.length > 1 && (
                  <span className="file-explorer-folder-dropdown-icon">▼</span>
                )}
              </div>
            </>
          )}

          {selectedFile && (
            <span className="file-explorer-current-file">/ {selectedFile.filename}</span>
          )}

          {/* Area Selector Dropdown (not shown in direct folder mode) */}
          {!isDirectFolderMode && showAreaSelector && allAreas.length > 1 && (
            <div className="file-explorer-area-dropdown">
              {allAreas.map((a) => (
                <div
                  key={a.id}
                  className={`file-explorer-area-option ${a.id === areaId ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAreaChange(a.id);
                  }}
                >
                  <span className="file-explorer-area-option-dot" style={{ background: a.color }} />
                  <span className="file-explorer-area-option-name">{a.name}</span>
                  <span className="file-explorer-area-option-count">
                    {a.directories.length} folders
                  </span>
                </div>
              ))}
            </div>
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
                  <span
                    className="file-explorer-folder-option-dot"
                    style={{ background: folder.areaColor }}
                  />
                  <span className="file-explorer-folder-option-name">
                    {folder.path.split('/').pop() || folder.path}
                  </span>
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
        <div className={`file-explorer-tree-panel ${treePanelCollapsed ? 'collapsed' : ''}`}>
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

          {/* Folders Section (only in files mode, not in direct folder mode) */}
          {viewMode === 'files' && !isDirectFolderMode && (
            <div className="file-explorer-folders">
              <div className="file-explorer-folders-header">
                <span className="file-explorer-folders-title">Folders</span>
                <button
                  className="file-explorer-add-folder-btn"
                  onClick={() => setIsAddingFolder(true)}
                  title="Add folder"
                >
                  +
                </button>
              </div>
              <div className="file-explorer-folders-list">
                {directories.map((dir) => (
                  <div key={dir} className="file-explorer-folder-item">
                    <span className="file-explorer-folder-icon">📂</span>
                    <span className="file-explorer-folder-path">
                      {dir.split('/').pop() || dir}
                    </span>
                    <button
                      className="file-explorer-folder-remove"
                      onClick={(e) => handleRemoveFolder(dir, e)}
                      title="Remove folder"
                    >
                      ×
                    </button>
                    <div className="file-explorer-folder-tooltip">
                      <div className="file-explorer-folder-tooltip-label">Full Path</div>
                      <div className="file-explorer-folder-tooltip-path">{dir}</div>
                    </div>
                  </div>
                ))}
                {isAddingFolder && (
                  <div className="file-explorer-add-folder-input-wrapper">
                    <input
                      ref={addFolderInputRef}
                      type="text"
                      className="file-explorer-add-folder-input"
                      placeholder="/path/to/folder"
                      value={newFolderPath}
                      onChange={(e) => setNewFolderPath(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAddFolder();
                        if (e.key === 'Escape') {
                          setIsAddingFolder(false);
                          setNewFolderPath('');
                        }
                      }}
                      onBlur={() => {
                        if (!newFolderPath.trim()) {
                          setIsAddingFolder(false);
                        }
                      }}
                    />
                    <button
                      className="file-explorer-add-folder-confirm"
                      onClick={handleAddFolder}
                    >
                      ✓
                    </button>
                  </div>
                )}
                {directories.length === 0 && !isAddingFolder && (
                  <div className="file-explorer-no-folders">No folders added</div>
                )}
              </div>
            </div>
          )}

          {/* Search Bar and Toolbar (only in files mode) */}
          {viewMode === 'files' && (
            <div className="file-explorer-toolbar">
              <div className="file-explorer-search">
                <span className="file-explorer-search-icon">🔍</span>
                <input
                  ref={searchInputRef}
                  type="text"
                  className="file-explorer-search-input"
                  placeholder="Search files & content... (Cmd+P)"
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
              ) : searchQuery.trim() ? (
                isSearching ? (
                  <div className="tree-loading">Searching...</div>
                ) : (
                  <UnifiedSearchResults
                    filenameResults={searchResults}
                    contentResults={contentSearchResults}
                    onSelectFile={handleSelect}
                    onSelectContent={handleContentSearchSelect}
                    selectedPath={selectedPath}
                    query={searchQuery}
                  />
                )
              ) : (
                <div className="file-tree">
                  {tree.length === 0 ? (
                    <div className="tree-empty">No directories linked</div>
                  ) : (
                    tree.map((node) => (
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
              />
            )}
          </div>
        </div>

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
            <FileViewer file={selectedFile} loading={fileLoading} error={fileError} onRevealInTree={handleRevealInTree} />
          )}
        </div>
      </div>
    </div>
  );
}
