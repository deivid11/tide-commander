/**
 * useFileTree - Custom hook for file tree management
 *
 * Handles loading, caching, and navigation of file tree data.
 * Following ClaudeOutputPanel's useTerminalInput pattern.
 */

import { useState, useCallback } from 'react';
import type { TreeNode, UseFileTreeReturn } from './types';
import { DEFAULT_TREE_DEPTH } from './constants';

/**
 * Hook for managing file tree state and operations
 */
export function useFileTree(currentFolder: string | null): UseFileTreeReturn {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  /**
   * Load tree structure for the current folder
   */
  const loadTree = useCallback(async () => {
    if (!currentFolder) return;

    setLoading(true);

    try {
      const res = await fetch(
        `/api/files/tree?path=${encodeURIComponent(currentFolder)}&depth=${DEFAULT_TREE_DEPTH}`
      );
      const data = await res.json();

      if (res.ok && data.tree) {
        // Wrap in a root node for the directory
        const rootNode: TreeNode = {
          name: data.name,
          path: currentFolder,
          isDirectory: true,
          size: 0,
          extension: '',
          children: data.tree,
        };
        setTree([rootNode]);
        // Auto-expand root
        setExpandedPaths(new Set([currentFolder]));
      }
    } catch (err) {
      console.error('[FileExplorer] Failed to load tree:', err);
      setTree([]);
    }

    setLoading(false);
  }, [currentFolder]);

  /**
   * Toggle expansion state of a path
   */
  const togglePath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return {
    tree,
    loading,
    expandedPaths,
    loadTree,
    togglePath,
    setExpandedPaths,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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
