/**
 * FileExplorerPanel - Main orchestrator component
 *
 * IDE-style file explorer with file tree, git integration, and syntax highlighting.
 * Following ClaudeOutputPanel's architecture patterns.
 */

import React, { useEffect, useState, useMemo, useRef } from 'react';
import Fuse from 'fuse.js';
import { useStore, store } from '../../store';
import { DiffViewer } from '../DiffViewer';

// Types
import type {
  FileExplorerPanelProps,
  ViewMode,
  TreeNode,
  GitFileStatusType,
  FolderInfo,
} from './types';

// Hooks
import { useFileTree, flattenTree } from './useFileTree';
import { useGitStatus, loadGitOriginalContent } from './useGitStatus';
import { useFileContent } from './useFileContent';

// Components
import { TreeNodeItem } from './TreeNodeItem';
import { FileViewer } from './FileViewer';
import { SearchResults } from './SearchResults';
import { GitChanges } from './GitChanges';

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
}: FileExplorerPanelProps) {
  const state = useStore();

  // -------------------------------------------------------------------------
  // AREA & FOLDER STATE
  // -------------------------------------------------------------------------

  const area = areaId ? state.areas.get(areaId) : null;
  const directories = area?.directories || [];
  const allAreas = Array.from(state.areas.values());

  const [selectedFolderIndex, setSelectedFolderIndex] = useState(0);
  const [pendingFolderPath, setPendingFolderPath] = useState<string | null>(null);
  const [showAreaSelector, setShowAreaSelector] = useState(false);
  const [showFolderSelector, setShowFolderSelector] = useState(false);

  const currentFolder = directories[selectedFolderIndex] || directories[0] || null;

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

  // -------------------------------------------------------------------------
  // LOCAL STATE
  // -------------------------------------------------------------------------

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('files');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TreeNode[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [originalContent, setOriginalContent] = useState<string | null>(null);
  const [selectedGitStatus, setSelectedGitStatus] = useState<GitFileStatusType | null>(null);
  const [hasInitializedView, setHasInitializedView] = useState(false);
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [newFolderPath, setNewFolderPath] = useState('');

  // -------------------------------------------------------------------------
  // REFS
  // -------------------------------------------------------------------------

  const searchInputRef = useRef<HTMLInputElement>(null);
  const addFolderInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // SEARCH
  // -------------------------------------------------------------------------

  // Flatten tree for fuzzy search
  const flattenedFiles = useMemo(() => flattenTree(tree), [tree]);

  // Fuse.js instance for fuzzy search
  const fuse = useMemo(() => {
    return new Fuse(flattenedFiles, {
      keys: ['name', 'path'],
      threshold: 0.4,
      includeScore: true,
    });
  }, [flattenedFiles]);

  // Handle search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const results = fuse
      .search(searchQuery)
      .map((r) => r.item)
      .filter((n) => !n.isDirectory)
      .slice(0, 20);
    setSearchResults(results);
  }, [searchQuery, fuse]);

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

  // Auto-select git tab if there are changes (only on initial load)
  useEffect(() => {
    if (!hasInitializedView && gitStatus && gitStatus.isGitRepo && gitStatus.files.length > 0) {
      setViewMode('git');
      setHasInitializedView(true);
    } else if (!hasInitializedView && gitStatus) {
      setHasInitializedView(true);
    }
  }, [gitStatus, hasInitializedView]);

  // Reset when area changes
  useEffect(() => {
    if (areaId) {
      clearFile();
      setSelectedPath(null);
      setSearchQuery('');
      setExpandedPaths(new Set());
      setViewMode('files');
      setOriginalContent(null);
      setSelectedGitStatus(null);
      setHasInitializedView(false);

      // Check if there's a pending folder to select
      if (pendingFolderPath) {
        const newArea = state.areas.get(areaId);
        if (newArea) {
          const folderIndex = newArea.directories.indexOf(pendingFolderPath);
          setSelectedFolderIndex(folderIndex >= 0 ? folderIndex : 0);
        }
        setPendingFolderPath(null);
      } else {
        setSelectedFolderIndex(0);
      }
    }
  }, [areaId, pendingFolderPath, state.areas, clearFile, setExpandedPaths]);

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

  const handleSelect = (node: TreeNode) => {
    if (!node.isDirectory) {
      setSelectedGitStatus(null);
      setOriginalContent(null);
      setSelectedPath(node.path);
      loadFile(node.path);
    }
  };

  const handleGitFileSelect = async (path: string, status: GitFileStatusType) => {
    setSelectedGitStatus(status);
    setOriginalContent(null);
    setSelectedPath(path);

    await loadFile(path);

    if (status === 'modified') {
      const { content } = await loadGitOriginalContent(path);
      if (content !== null) {
        setOriginalContent(content);
      }
    }
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

  // -------------------------------------------------------------------------
  // RENDER
  // -------------------------------------------------------------------------

  if (!isOpen || !area) return null;

  const gitChangeCount = gitStatus?.files.length || 0;

  return (
    <div className="file-explorer-panel ide-style">
      {/* Header */}
      <div className="file-explorer-panel-header">
        <div className="file-explorer-panel-title">
          {/* Area selector */}
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

          {/* Folder selector */}
          {currentFolder && (
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

          {/* Area Selector Dropdown */}
          {showAreaSelector && allAreas.length > 1 && (
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

          {/* Folder Selector Dropdown */}
          {showFolderSelector && allFolders.length > 0 && (
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
        <div className="file-explorer-tree-panel">
          {/* Tab Bar */}
          <div className="file-explorer-tabs">
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

          {/* Folders Section (only in files mode) */}
          {viewMode === 'files' && (
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
                  <div key={dir} className="file-explorer-folder-item" title={dir}>
                    <span className="file-explorer-folder-icon">📁</span>
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

          {/* Search Bar (only in files mode) */}
          {viewMode === 'files' && (
            <div className="file-explorer-search">
              <input
                ref={searchInputRef}
                type="text"
                className="file-explorer-search-input"
                placeholder="Search... (Cmd+P)"
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
          )}

          {/* Tree Content */}
          <div className="file-explorer-tree-content">
            {viewMode === 'files' ? (
              treeLoading ? (
                <div className="tree-loading">Loading...</div>
              ) : isSearching && searchQuery ? (
                <SearchResults
                  results={searchResults}
                  onSelect={handleSelect}
                  selectedPath={selectedPath}
                  query={searchQuery}
                />
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
          {selectedGitStatus === 'modified' && originalContent !== null && selectedFile ? (
            <DiffViewer
              originalContent={originalContent}
              modifiedContent={selectedFile.content}
              filename={selectedFile.filename}
              language={EXTENSION_TO_LANGUAGE[selectedFile.extension] || 'plaintext'}
            />
          ) : (
            <FileViewer file={selectedFile} loading={fileLoading} error={fileError} />
          )}
        </div>
      </div>
    </div>
  );
}
