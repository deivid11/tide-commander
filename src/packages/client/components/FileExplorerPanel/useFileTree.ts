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
      const res = await fetch(
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

        // Auto-expand root and first two levels of subdirectories
        const pathsToExpand = new Set<string>([currentFolder]);
        for (const child of sortedTree) {
          if (child.isDirectory) {
            pathsToExpand.add(child.path);
            if (child.children) {
              for (const grandchild of child.children) {
                if (grandchild.isDirectory) {
                  pathsToExpand.add(grandchild.path);
                }
              }
            }
          }
        }
        setExpandedPaths(pathsToExpand);
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
  const loadChildren = useCallback(async (dirPath: string) => {
    try {
      const res = await fetch(
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
      }
    } catch (err) {
      console.error('[FileExplorer] Failed to load children:', err);
    }
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

      // Check if we need to load children (using refs for current state)
      const currentTree = treeRef.current;
      const currentLoadedPaths = loadedPathsRef.current;
      const node = findNodeByPath(currentTree, path);

      if (node && node.isDirectory) {
        const needsLoad = !currentLoadedPaths.has(path);
        if (needsLoad) {
          await loadChildren(path);
        }
      }
    }
  }, [loadChildren]); // Only depends on loadChildren which is stable

  return {
    tree,
    loading,
    expandedPaths,
    loadTree,
    togglePath,
    setExpandedPaths,
  };
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
