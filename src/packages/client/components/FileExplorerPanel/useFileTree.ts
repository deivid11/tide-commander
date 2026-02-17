/**
 * useFileTree - Custom hook for file tree management
 *
 * Handles loading, caching, and navigation of file tree data.
 * Supports lazy loading - directories load children on-demand when expanded.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { TreeNode, UseFileTreeReturn } from './types';
import { apiUrl, authFetch } from '../../utils/storage';

// Initial depth to load (shallow for fast initial load)
const INITIAL_DEPTH = 3;
// Depth to load when expanding a folder
const EXPAND_DEPTH = 3;

/**
 * Hook for managing file tree state and operations
 */
export function useFileTree(currentFolder: string | null): UseFileTreeReturn {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [loadedPaths, setLoadedPaths] = useState<Set<string>>(new Set());

  // Use refs to access current state in callbacks without stale closures
  const treeRef = useRef(tree);
  const loadedPathsRef = useRef(loadedPaths);
  const expandedPathsRef = useRef(expandedPaths);

  useEffect(() => {
    treeRef.current = tree;
  }, [tree]);

  useEffect(() => {
    loadedPathsRef.current = loadedPaths;
  }, [loadedPaths]);

  useEffect(() => {
    expandedPathsRef.current = expandedPaths;
  }, [expandedPaths]);

  /**
   * Load tree structure for the current folder
   */
  const loadTree = useCallback(async () => {
    if (!currentFolder) return;

    setLoading(true);

    try {
      const res = await authFetch(
        apiUrl(`/api/files/tree?path=${encodeURIComponent(currentFolder)}&depth=${INITIAL_DEPTH}`)
      );
      const data = await res.json();

      if (res.ok && data.tree) {
        // Sort the tree (folders first, then alphabetically)
        const sortedTree = sortTree(data.tree);

        // Wrap in a root node for the directory
        const rootNode: TreeNode = {
          name: data.name,
          path: currentFolder,
          isDirectory: true,
          size: 0,
          extension: '',
          children: sortedTree,
        };
        setTree([rootNode]);
        // Track that we've loaded this path
        const loaded = new Set<string>([currentFolder]);
        collectLoadedPaths(sortedTree, loaded);
        setLoadedPaths(loaded);

        // Auto-expand only the root folder by default (single nesting level visible)
        setExpandedPaths(new Set<string>([currentFolder]));
      }
    } catch (err) {
      console.error('[FileExplorer] Failed to load tree:', err);
      setTree([]);
    }

    setLoading(false);
  }, [currentFolder]);

  /**
   * Load children for a specific directory path (lazy loading)
   */
  const loadChildren = useCallback(async (dirPath: string): Promise<TreeNode[] | null> => {
    try {
      const res = await authFetch(
        apiUrl(`/api/files/tree?path=${encodeURIComponent(dirPath)}&depth=${EXPAND_DEPTH}`)
      );
      const data = await res.json();

      if (res.ok && data.tree) {
        // Sort the loaded children (folders first, then alphabetically)
        const sortedChildren = sortTree(data.tree);
        // Update the tree by finding the node and setting its children
        setTree((prevTree) => {
          const newTree = JSON.parse(JSON.stringify(prevTree)) as TreeNode[];
          const node = findNodeByPath(newTree, dirPath);
          if (node) {
            node.children = sortedChildren;
          }
          return newTree;
        });

        // Track loaded paths
        setLoadedPaths((prev) => {
          const next = new Set(prev);
          next.add(dirPath);
          collectLoadedPaths(data.tree, next);
          return next;
        });

        return sortedChildren;
      }
    } catch (err) {
      console.error('[FileExplorer] Failed to load children:', err);
    }

    return null;
  }, []);

  /**
   * Reload a single directory's children without resetting the entire tree.
   * Used to avoid full-tree flicker after targeted operations (paste/create/etc).
   */
  const reloadDirectory = useCallback(async (dirPath: string): Promise<void> => {
    await loadChildren(dirPath);
  }, [loadChildren]);

  /**
   * Rename a path in the current in-memory tree (and all descendants by prefix).
   * Keeps UI stable without forcing a full-tree reload.
   */
  const renamePathInTree = useCallback((oldPath: string, newPath: string): void => {
    if (!oldPath || !newPath || oldPath === newPath) return;

    const mapPath = (value: string): string => {
      if (value === oldPath) return newPath;
      if (value.startsWith(`${oldPath}/`)) {
        return `${newPath}${value.slice(oldPath.length)}`;
      }
      return value;
    };

    const updateNodes = (nodes: TreeNode[]): TreeNode[] => {
      const updated = nodes.map((node) => {
        const mappedPath = mapPath(node.path);
        const mappedChildren = node.children ? updateNodes(node.children) : undefined;
        return {
          ...node,
          path: mappedPath,
          name: mappedPath.split('/').pop() || node.name,
          extension: node.isDirectory ? '' : pathExt(mappedPath),
          children: mappedChildren,
        };
      });
      return sortTree(updated);
    };

    setTree((prevTree) => updateNodes(prevTree));

    setLoadedPaths((prev) => {
      const next = new Set<string>();
      for (const p of prev) next.add(mapPath(p));
      return next;
    });
  }, []);

  /**
   * Toggle expansion state of a path - loads children if needed
   * Uses refs to avoid stale closures and keep the function stable
   */
  const togglePath = useCallback(async (path: string) => {
    // Use ref to get current expansion state (avoids stale closure)
    const isCurrentlyExpanded = expandedPathsRef.current.has(path);

    if (isCurrentlyExpanded) {
      // Collapsing - just update expanded paths
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    } else {
      // Expanding - first expand, then load if needed
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.add(path);
        return next;
      });

      // IntelliJ-like behavior: when expanding, walk single-dir chains in one click.
      let currentNode = findNodeByPath(treeRef.current, path);

      while (currentNode && currentNode.isDirectory) {
        let children = currentNode.children;

        if ((!children || children.length === 0) && !loadedPathsRef.current.has(currentNode.path)) {
          const loadedChildren = await loadChildren(currentNode.path);
          children = loadedChildren || [];
        }

        if (!children || children.length === 0) break;

        const directoryChildren = children.filter((child) => child.isDirectory);
        const hasFiles = children.some((child) => !child.isDirectory);

        // Stop at branching points or when files exist.
        if (hasFiles || directoryChildren.length !== 1) break;

        const nextDirectory = directoryChildren[0];
        setExpandedPaths((prev) => {
          const next = new Set(prev);
          next.add(nextDirectory.path);
          return next;
        });
        currentNode = nextDirectory;
      }
    }
  }, [loadChildren]); // Only depends on loadChildren which is stable

  /**
   * Expand and lazy-load every segment to a target path.
   * Used by search/reveal flows where the target might not be loaded yet.
   *
   * KEY INSIGHT: TreeNodeItem uses compaction chains — single-child directory
   * chains are collapsed into one visual row (e.g., "src/packages/client").
   * The expansion check is `expandedPaths.has(compactChain.expansionPath)`
   * where expansionPath is the TERMINAL of the compacted chain.
   *
   * After lazy-loading children, compaction chains can extend further than
   * before, shifting the terminal. We must account for this by:
   * 1. Loading all needed children from root to target (top-down)
   * 2. Computing the FINAL compaction terminals after all loads complete
   * 3. Building the expandedPaths set using those final terminals
   *
   * Does NOT use togglePath to avoid double chain-walking and toggle-off.
   */
  const expandToPath = useCallback(async (targetPath: string) => {
    if (!targetPath) return;

    // Normalize: strip trailing slash from currentFolder to prevent double-slash paths.
    // Tree node paths never have trailing slashes, but currentFolder sometimes does.
    const rootFolder = currentFolder?.replace(/\/+$/, '') || null;

    const waitForPaint = () => new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    const waitForNode = async (path: string, maxFrames = 20): Promise<TreeNode | null> => {
      for (let i = 0; i < maxFrames; i++) {
        const node = findNodeByPath(treeRef.current, path);
        if (node) return node;
        await waitForPaint();
      }
      return null;
    };

    // Build the list of directory segments from root to target
    const segments: string[] = [];
    if (rootFolder && targetPath.startsWith(rootFolder)) {
      segments.push(rootFolder);
      const relativePath = targetPath.substring(rootFolder.length);
      const parts = relativePath.split('/').filter(Boolean);
      let currentPath = rootFolder;
      for (const part of parts) {
        currentPath = `${currentPath}/${part}`;
        segments.push(currentPath);
      }
    } else {
      segments.push(targetPath);
    }

    // PHASE 1: Ensure all ancestors have their children loaded.
    for (const segPath of segments) {
      const node = await waitForNode(segPath);
      if (!node?.isDirectory) continue;

      if (!loadedPathsRef.current.has(node.path)) {
        await loadChildren(node.path);
        await waitForPaint();
      }
    }

    // PHASE 2: Compute the correct expandedPaths set.
    // After all loads, tree structure is final. Walk from root to target,
    // computing compaction chains as TreeNodeItem would, and add the
    // terminal of each chain to expandedPaths.
    const pathsToExpand = new Set<string>(expandedPathsRef.current);

    let i = 0;
    while (i < segments.length) {
      const segPath = segments[i];
      const node = findNodeByPath(treeRef.current, segPath);
      if (!node?.isDirectory) {
        i++;
        continue;
      }

      // Walk the compaction chain (same logic as TreeNodeItem.getCompactChain)
      let terminal = node;
      while (
        terminal.children &&
        terminal.children.length === 1 &&
        terminal.children[0]?.isDirectory
      ) {
        terminal = terminal.children[0];
      }

      pathsToExpand.add(terminal.path);

      // Skip segments covered by this compaction chain
      while (i < segments.length) {
        if (segments[i] === terminal.path) {
          i++;
          break;
        }
        i++;
      }
    }

    setExpandedPaths(pathsToExpand);
    await waitForPaint();
  }, [currentFolder, loadChildren]);

  return {
    tree,
    loading,
    expandedPaths,
    loadTree,
    reloadDirectory,
    renamePathInTree,
    togglePath,
    expandToPath,
    setExpandedPaths,
  };
}

function pathExt(filePath: string): string {
  const idx = filePath.lastIndexOf('.');
  if (idx === -1) return '';
  return filePath.slice(idx).toLowerCase();
}

/**
 * Find a node in the tree by its path
 */
function findNodeByPath(nodes: TreeNode[], targetPath: string): TreeNode | null {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node;
    }
    if (node.children) {
      const found = findNodeByPath(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Collect directory paths that have been fully loaded (have children with content)
 * Directories at the edge of loading (empty children) are NOT marked as loaded
 * so they can trigger lazy loading when expanded.
 */
function collectLoadedPaths(nodes: TreeNode[], paths: Set<string>): void {
  for (const node of nodes) {
    if (node.isDirectory && node.children && node.children.length > 0) {
      // Only mark as loaded if it has actual children
      paths.add(node.path);
      collectLoadedPaths(node.children, paths);
    }
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Sort tree nodes: folders first, then files, both alphabetically (case-insensitive)
 */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    // Folders first
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    // Alphabetical (case-insensitive)
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

/**
 * Recursively sort all nodes in the tree (creates new array, doesn't mutate)
 */
function sortTree(nodes: TreeNode[]): TreeNode[] {
  const sorted = sortNodes(nodes);
  return sorted.map(node => {
    if (node.isDirectory && node.children) {
      return { ...node, children: sortTree(node.children) };
    }
    return node;
  });
}

/**
 * Flatten tree structure for search
 */
export function flattenTree(nodes: TreeNode[]): TreeNode[] {
  const result: TreeNode[] = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}
